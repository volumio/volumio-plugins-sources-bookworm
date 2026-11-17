#!/usr/bin/env python3
# prepare_cue.py <dir|file.cue>
# CUE -> UTF-8, образ -> треки с тегами.
# Работает с любой структурой каталогов (рекурсивно, регистронезависимо).
# Исходники удаляются только после ПОЛНОГО успеха.
#
# Поддерживаются случаи:
#   * один cue + один образ;
#   * cue для уже порезанных файлов (по FILE на трек / файлов столько же, сколько треков);
#   * один cue с несколькими FILE-образами (сторона A / сторона B, CD1 / CD2 в одном cue);
#   * один cue (один FILE) и образ, разрезанный на части (side A.flac + side B.flac),
#     а также cue, у которого таймкоды второй стороны начинаются заново;
#   * несколько cue в одной папке (каждый со своим образом): диски кладутся в
#     подпапки CD1, CD2, ... (дальше их сводит merge_discs) либо, если у cue разные
#     альбомы, в подпапки по имени cue.
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from common import (DISC_SUFFIX, get_easy_tag, natural_key, note, problem, progress,
                    rm, safe_move, safe_target, set_easy_tags)

AUDIO_EXTS = ("flac", "wav", "m4a", "aiff", "mp3", "ape", "wv")
# порядок предпочтения, если в каталоге несколько аудиофайлов
IMAGE_PRIORITY = ("flac", "wav", "m4a", "aiff", "mp3", "ape", "wv")
CUE_ENCODINGS = ("utf-8-sig", "utf-8", "cp1251", "cp866",
                 "koi8-r", "cp1252", "latin-1")
WORK_DIR = ".tp_cue_work"   # временная папка нарезки (внутри папки альбома)


def safe_name(s):
    return re.sub(r'[\\/:*?"<>|]', "_", s).strip() or "Track"


def read_cue(path):
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for enc in CUE_ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    problem(f"cannot decode cue (tried {CUE_ENCODINGS}): {path}")
    return None


def atomic_write(path, text):
    fd, name = tempfile.mkstemp(dir=str(path.parent), prefix=".cue.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, str(path))
    except Exception:
        rm(name)
        raise


def convert_to_utf8(cue):
    text = read_cue(cue)
    if text is None:
        return False
    atomic_write(cue, text.lstrip("\ufeff"))
    return True


def audio_files(d):
    """Аудиофайлы в каталоге (не рекурсивно), без скрытых, в естественном порядке."""
    if not d.is_dir():
        return []
    return sorted((p for p in d.iterdir()
                   if p.is_file() and not p.name.startswith(".")
                   and p.suffix[1:].lower() in AUDIO_EXTS), key=natural_key)


_CUE_FILE_RE = re.compile(r'(?im)^\s*FILE\s+(?:"([^"]*)"|(\S+))')


def _basename(m):
    return (m.group(1) or m.group(2) or "").replace("\\", "/").split("/")[-1]


def cue_file_name(cue):
    """Имя файла из первой директивы FILE (только basename) или ''."""
    m = _CUE_FILE_RE.search(cue.read_text(encoding="utf-8"))
    return _basename(m) if m else ""


_KNOWN_EXTS = {"flac", "wv", "ape", "wav", "wave", "tta", "m4a", "mp3", "aiff", "aif",
               "ogg", "opus", "wma", "iso", "cue", "image", "img"}


def norm_name(name):
    """Имя без цепочки известных расширений и без знаков: 'Album.iso.wv' -> 'album',
    'Album.flac' -> 'album' (образ мог быть переименован/сконвертирован)."""
    s = name.lower()
    while True:
        base, dot, ext = s.rpartition(".")
        if dot and base and ext in _KNOWN_EXTS:
            s = base
        else:
            break
    return re.sub(r"[\W_]+", "", s)


def file_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, stdin=subprocess.DEVNULL)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def _val(line, key):
    m = re.match(rf'\s*{key}\s+"(.*)"\s*$', line, re.I)
    if m:
        return m.group(1).strip()
    m = re.match(rf"\s*{key}\s+(\S.*?)\s*$", line, re.I)
    return m.group(1).strip() if m else None


def parse_cue(cue, need_start=True):
    """-> (meta, tracks); tracks = [{num, title, performer, start, ref}].
    ref — имя файла из последней директивы FILE перед треком ('' если её не было).
    need_start=False оставляет и треки без INDEX 01 (cue для уже порезанных файлов)."""
    meta = {"performer": "", "title": "", "date": "", "genre": ""}
    tracks, cur, ref = [], None, ""
    for line in cue.read_text(encoding="utf-8").splitlines():
        fm = _CUE_FILE_RE.match(line)
        if fm:
            ref = _basename(fm)
            continue
        m = re.match(r"\s*TRACK\s+(\d+)\s+AUDIO", line, re.I)
        if m:
            if cur:
                tracks.append(cur)
            cur = {"num": int(m.group(1)), "title": "", "performer": "",
                   "start": None, "ref": ref}
            continue
        target = cur if cur is not None else meta
        v = _val(line, "TITLE")
        if v is not None and not target["title"]:
            target["title"] = v
            continue
        v = _val(line, "PERFORMER")
        if v is not None and not target["performer"]:
            target["performer"] = v
            continue
        if cur is None:
            v = _val(line, r"REM\s+DATE")
            if v is not None:
                meta["date"] = v.strip('"')
            v = _val(line, r"REM\s+GENRE")
            if v is not None:
                meta["genre"] = v.strip('"')
            continue
        m = re.match(r"\s*INDEX\s+01\s+(\d+):(\d+):(\d+)", line, re.I)
        if m:
            cur["start"] = (int(m.group(1)) * 60 + int(m.group(2))
                            + int(m.group(3)) / 75)
    if cur:
        tracks.append(cur)
    return meta, [t for t in tracks if not need_start or t["start"] is not None]


def parse_cue_tracks(cue):
    return parse_cue(cue)[1]


def make_runs(tracks):
    """Делит треки на секции: новая секция — смена FILE либо таймкоды начались заново
    (сторона B в cue с одним FILE). Каждая секция = один физический файл-образ."""
    runs = []
    for t in tracks:
        if runs:
            prev = runs[-1][-1]
            restart = (t["start"] is not None and prev["start"] is not None
                       and t["start"] < prev["start"] - 1.0)
            if t["ref"] == prev["ref"] and not restart:
                runs[-1].append(t)
                continue
        runs.append([t])
    return runs


def _rank(p):
    ext = p.suffix[1:].lower()
    return IMAGE_PRIORITY.index(ext) if ext in IMAGE_PRIORITY else len(IMAGE_PRIORITY)


def find_image_by_name(cue, files):
    """Образ по именам: 1) точное имя из FILE; 2) имя из FILE после нормализации
    (Album.iso.wv ~ Album.flac); 3) имя самого cue после нормализации. Иначе None."""
    ref = cue_file_name(cue)
    if ref:
        exact = [p for p in files if p.name.lower() == ref.lower()]
        if exact:
            return exact[0]
        n = norm_name(ref)
        same = [p for p in files if n and norm_name(p.name) == n]
        if same:
            return sorted(same, key=_rank)[0]
    n = norm_name(cue.name)
    same = [p for p in files if n and norm_name(p.name) == n]
    if same:
        return sorted(same, key=_rank)[0]
    return None


def find_image(cue, exclude=(), tracks=None):
    """Образ для cue. Порядок поиска (расширение и «хвосты» вроде .iso.wv не важны):
      1-3. по именам (см. find_image_by_name);
      4. единственный (из не занятых другими cue) аудиофайл в папке;
      5. единственный файл, длинный настолько, что в него укладывается cue
         (или заметно длиннее остальных) — образ среди нескольких аудиофайлов.
    Иначе None — чтобы не принять за образ один из уже нарезанных треков."""
    files = [p for p in audio_files(cue.parent) if p not in exclude]
    if not files:
        return None
    img = find_image_by_name(cue, files)
    if img is not None:
        return img
    if len(files) == 1:
        return files[0]
    # несколько аудиофайлов: образ — тот, в который укладывается cue и который заметно длиннее
    starts = [t["start"] for t in (tracks or parse_cue_tracks(cue)) if t["start"] is not None]
    if not starts:
        return None
    last_start = max(starts)
    durs = sorted(((file_duration(p) or 0.0, p) for p in files),
                  key=lambda x: x[0], reverse=True)
    fits = [(d, p) for d, p in durs if d > last_start]
    if len(fits) == 1 and durs[0][1] == fits[0][1]:
        return fits[0][1]
    if fits and len(durs) > 1 and durs[0][0] >= 1.5 * durs[1][0] and durs[0][0] > last_start:
        return durs[0][1]
    return None


def match_split_files(refs, files):
    """Файлы для имён из FILE (точное имя, иначе совпадение после norm_name:
    cue мог ссылаться на .wav, а лежит .flac). Любая неоднозначность -> None."""
    exact = {p.name.lower(): p for p in files}
    norm = {}
    for p in files:
        norm.setdefault(norm_name(p.name), []).append(p)
    out = []
    for r in refs:
        p = exact.get(r.lower())
        if p is None:
            c = norm.get(norm_name(r), [])
            p = c[0] if len(c) == 1 else None
        if p is None or p in out:
            return None
        out.append(p)
    return out


def concat_parts(files, tracks):
    """Один FILE в cue, а образ лежит частями (side A.flac + side B.flac): таймкоды cue
    сквозные. -> (группы [{image, tracks (время относительно части), pass}], причина):
    при неудаче группы None, а причина объясняет, почему части не подошли.
    Файлов должно быть меньше, чем треков (иначе это уже нарезанные треки)."""
    cand = sorted(files, key=natural_key)
    if len(cand) < 2 or len(cand) >= len(tracks):
        return None, ""
    durs = [file_duration(p) for p in cand]
    starts = [t["start"] for t in tracks]
    if any(d is None for d in durs) or any(s is None for s in starts):
        return None, ""
    total = sum(durs)
    if max(starts) >= total:
        return None, (f"cue timeline ({max(starts):.0f}s) is longer than the audio files "
                      f"together ({total:.0f}s)")
    offs, acc = [], 0.0
    for d in durs:
        offs.append(acc)
        acc += d
    groups = [[] for _ in cand]
    for k, t in enumerate(tracks):
        i = max(j for j, o in enumerate(offs) if o <= t["start"] + 0.01)
        end = tracks[k + 1]["start"] if k + 1 < len(tracks) else total
        if end > offs[i] + durs[i] + 0.5:
            return None, (f"track {t['num']} crosses the boundary between "
                          f"{cand[i].name} and the next file")
        groups[i].append(dict(t, start=t["start"] - offs[i]))
    empty = [cand[i].name for i, g in enumerate(groups) if not g]
    if empty:
        return None, f"no cue tracks fall into {empty[0]}"
    return [{"image": p, "tracks": g, "pass": False} for p, g in zip(cand, groups)], ""


def _is_pass(run):
    """Секция из одного трека с началом в нуле: файл уже и есть этот трек."""
    return len(run) == 1 and (run[0]["start"] is None or run[0]["start"] < 1.0)


def resolve_groups(cue, tracks, exclude=(), hint=None):
    """Сопоставляет секции cue с файлами папки.
    -> (groups, error); group = {image, tracks, pass}; pass=True — резать не нужно."""
    files = [p for p in audio_files(cue.parent) if p not in exclude]
    runs = make_runs(tracks)
    if len(runs) == 1:
        run = runs[0]
        image = hint or find_image(cue, exclude, run)
        if image is not None:
            return [{"image": image, "tracks": run, "pass": False}], None
        # образа нет, а файлов столько же, сколько треков: уже порезано
        if len(files) == len(tracks) and len(files) > 1:
            return [{"image": f, "tracks": [t], "pass": True}
                    for f, t in zip(files, tracks)], None
        parts, why = concat_parts(files, run)
        if parts:
            return parts, None
        return None, (f"image for cue not identified ({len(files)} audio files in folder"
                      + (f"; {why}" if why else "") + ")")
    refs = [r[0]["ref"] for r in runs]
    if all(refs) and len({r.lower() for r in refs}) == len(refs):
        images = match_split_files(refs, files)
        if images is None:
            return None, "FILE entries of cue do not match audio files of the folder"
    else:
        # таймкоды секций начинаются заново без отдельных FILE: образы по порядку
        if len(files) != len(runs):
            return None, (f"cue has {len(runs)} sections, but the folder has "
                          f"{len(files)} audio files")
        images = files
    return [{"image": img, "tracks": run, "pass": _is_pass(run)}
            for img, run in zip(images, runs)], None


# ---------- нарезка ----------

def to_flac(src):
    dst = src.with_suffix(".flac")
    # не перезаписываем возможный исходный flac с тем же именем
    if dst.exists() and dst.resolve() != src.resolve():
        dst = src.with_name(src.stem + ".conv.flac")
    r = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(src), "-vn",
         "-c:a", "flac", "-compression_level", "8",
         "-map_metadata", "0", "-y", str(dst)],
        capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if r.returncode or not dst.is_file():
        rm(dst)
        problem(f"to_flac {src}: {r.stderr.strip()}")
        return None
    return dst


def fmt_index(sec):
    """секунды -> MM:SS:FF (75 кадров в секунду), как в INDEX cue."""
    frames = round(sec * 75)
    mm, rem = divmod(frames, 75 * 60)
    ss, ff = divmod(rem, 75)
    return f"{mm:02d}:{ss:02d}:{ff:02d}"


def split_ffmpeg(image, tracks, ext, gdir):
    """mp3 — копированием потока, flac — lossless-перекодированием.
    Файлы 01.ext, 02.ext ... (по порядку треков) в gdir."""
    dur = file_duration(image)
    if dur is None:
        problem(f"no duration: {image}")
        return []
    codec = (["-c:a", "flac", "-compression_level", "8"] if ext == ".flac"
             else ["-c", "copy"])
    starts = [t["start"] for t in tracks] + [dur]
    new = []
    for i, t in enumerate(tracks):
        progress(i=i, n=len(tracks), file=t["title"] or f"track {t['num']}")
        out = gdir / f"{i + 1:02d}{ext}"
        r = subprocess.run(
            ["ffmpeg", "-loglevel", "error",
             "-ss", f"{starts[i]:.6f}", "-i", str(image),
             "-t", f"{starts[i + 1] - starts[i]:.6f}",
             "-vn", "-map_metadata", "-1", *codec, "-y", str(out)],
            capture_output=True, text=True, stdin=subprocess.DEVNULL)
        if r.returncode or not out.is_file():
            problem(f"split track {t['num']}: {r.stderr.strip()}")
            rm(out)
            continue
        new.append(out)
    return new


def split_lossless(image, tracks, gdir):
    """shnsplit (если установлен и справился), иначе ffmpeg.
    shnsplit не понимает hi-res/многоканальный flac (WAVE_FORMAT_EXTENSIBLE, 0xfffe)
    и некоторые cue — тогда нарезка автоматически идёт через ffmpeg.
    shnsplit получает свой короткий cue (только эта секция, нумерация с 1)."""
    if shutil.which("shnsplit"):
        mini = gdir / "split.cue"
        text = f'FILE "{image.name}" WAVE\n' + "".join(
            f"  TRACK {i:02d} AUDIO\n    INDEX 01 {fmt_index(t['start'])}\n"
            for i, t in enumerate(tracks, 1))
        atomic_write(mini, text)
        try:
            r = subprocess.run(
                ["shnsplit", "-O", "always", "-f", str(mini), "-d", str(gdir),
                 "-t", "%n", "-o", "flac", str(image)],
                cwd=str(image.parent), capture_output=True, text=True,
                stdin=subprocess.DEVNULL)
        finally:
            rm(mini)
        new = sorted(gdir.glob("*.flac"), key=natural_key)
        if r.returncode == 0 and len(new) >= len(tracks):
            return new
        reason = (r.stderr.strip().splitlines() or ["incomplete result"])[0][:160]
        note(f"shnsplit failed ({reason}), splitting with ffmpeg instead")
        for f in new:                               # убрать недоделанное
            rm(f)
    else:
        note("shnsplit not found, splitting with ffmpeg")
    return split_ffmpeg(image, tracks, ".flac", gdir)


def split_group(image, tracks, gdir, intermediates):
    """Режет один образ в gdir. -> список файлов по числу треков (лишние короткие
    «pregap»-файлы выброшены, длинные оставлены как «00») либо None (ошибка записана)."""
    gdir.mkdir(parents=True, exist_ok=True)
    expected = len(tracks)
    if image.suffix.lower() == ".mp3":
        new = split_ffmpeg(image, tracks, ".mp3", gdir)
    else:
        if image.suffix.lower() == ".flac":
            flac = image
        else:
            flac = to_flac(image)
            if flac is None:
                return None
            intermediates.append(flac)
        new = split_lossless(flac, tracks, gdir)
    if len(new) < expected:
        problem(f"incomplete split ({len(new)}/{expected}): {image.name}")
        return None
    for extra in new[:len(new) - expected]:
        d = file_duration(extra)
        if d is not None and d < 15:
            note(f"pregap removed: {extra.name}")
            rm(extra)
    return new[len(new) - expected:]


# ---------- теги ----------

def _want_tags(meta, t):
    return {"title": t["title"], "tracknumber": t["num"],
            "artist": t["performer"] or meta["performer"],
            "albumartist": meta["performer"], "album": meta["title"],
            "date": meta["date"], "genre": meta["genre"]}


def tag_tracks(files, meta, tracks, extra=None):
    for f, t in zip(files, tracks):
        tags = _want_tags(meta, t)
        tags.update(extra or {})
        try:
            set_easy_tags(f, **{k: v for k, v in tags.items() if str(v) != ""})
        except Exception as e:
            problem(f"tagging {f.name}: {e}")


def fill_missing_tags(files, meta, tracks, extra=None):
    """Дописывает теги из cue ТОЛЬКО в пустые поля (уже заполненные не трогаем)."""
    ok = True
    for f, t in zip(files, tracks):
        want = _want_tags(meta, t)
        want.update(extra or {})
        add = {k: v for k, v in want.items()
               if str(v) != "" and not get_easy_tag(f, k)}
        if add:
            try:
                set_easy_tags(f, **add)
            except Exception as e:                      # noqa: BLE001
                problem(f"tagging {f.name}: {e}")
                ok = False
    return ok


FAILED = []        # cue, для которых образ найден, но нарезать не удалось


def fail_image(cue, msg):
    problem(msg)
    if cue not in FAILED:
        FAILED.append(cue)


# ---------- один cue ----------

def process_cue(cue, exclude=(), hint=None, subdir=None, discno=None):
    """exclude — образы, занятые другими cue этой папки; hint — образ, найденный по
    имени; subdir — подпапка для дорожек (нужна, когда в папке несколько cue)."""
    meta, tracks = parse_cue(cue, need_start=False)
    if not tracks:
        problem(f"no TRACK in cue, sources kept: {cue}")
        return
    groups, err = resolve_groups(cue, tracks, exclude, hint)
    if err:
        problem(f"{err}, sources kept: {cue}")
        return

    # --- всё уже порезано: теги из cue (только в пустые поля), cue удаляем ---
    if all(g["pass"] for g in groups):
        files = [g["image"] for g in groups]
        if len(files) < 2 or any(f.suffix.lower() not in (".flac", ".mp3") for f in files):
            problem(f"cue for split files not applicable, sources kept: {cue}")
            return
        if not fill_missing_tags(files, meta, [g["tracks"][0] for g in groups]):
            problem(f"cue kept (tags not written): {cue}")
            return
        try:
            cue.unlink()
            print("🗑", cue.name)
        except OSError as e:
            problem(f"rm {cue}: {e}")
        note(f"cue for already split tracks ({len(files)}): "
             f"tags filled where empty, cue removed")
        return

    # --- проверки секций, которые надо резать ---
    for g in groups:
        if g["pass"]:
            continue
        g["tracks"] = [t for t in g["tracks"] if t["start"] is not None]
        if not g["tracks"]:
            fail_image(cue, f"no INDEX 01 in cue, sources kept: {cue}")
            return
        dur = file_duration(g["image"])
        if dur is not None and g["tracks"][-1]["start"] >= dur:
            fail_image(cue, f"cue does not fit image {g['image'].name} (last track starts "
                            f"at {g['tracks'][-1]['start']:.0f}s, image {dur:.0f}s), "
                            f"sources kept: {cue}")
            return

    folder = cue.parent
    work = folder / WORK_DIR
    shutil.rmtree(str(work), ignore_errors=True)
    intermediates, produced = [], []     # produced: [(файл во временной папке, трек, секция)]
    to_delete = {cue}
    try:
        # 1. нарезаем всё во временную папку; при любой ошибке ничего не тронуто
        for gi, g in enumerate(groups):
            if g["pass"]:
                continue
            files = split_group(g["image"], g["tracks"], work / str(gi), intermediates)
            if files is None:
                fail_image(cue, f"cannot split {g['image'].name}, sources kept: {cue}")
                return
            to_delete.add(g["image"])
            produced.append((g, files))

        # чего нет в cue — берём из тегов первого образа (артист, альбом, год, жанр)
        first = produced[0][0]["image"]
        for key, tag in (("performer", "albumartist"), ("title", "album"),
                         ("date", "date"), ("genre", "genre")):
            if not meta[key]:
                meta[key] = (get_easy_tag(first, tag)
                             or (get_easy_tag(first, "artist") if key == "performer" else ""))

        # 2. раскладываем: NN - Название.ext (безопасные для NTFS/exFAT/FAT имена)
        target = folder / subdir if subdir else folder
        target.mkdir(exist_ok=True)
        extra = {"discnumber": discno} if discno else None
        final, final_tracks = [], []
        for g, files in produced:
            for f, t in zip(files, g["tracks"]):
                name = f"{t['num']:02d} - {safe_name(t['title'] or 'Track')}{f.suffix}"
                dst = safe_target(target, name)
                if dst is None:
                    problem(f"collision limit, track left in work dir: {name}")
                    fail_image(cue, f"cannot place {name}, sources kept: {cue}")
                    return
                safe_move(f, dst)
                final.append(dst)
                final_tracks.append(t)
        tag_tracks(final, meta, final_tracks, extra)
        for g in groups:                 # секции «уже трек» внутри смешанного cue
            if g["pass"]:
                fill_missing_tags([g["image"]], meta, g["tracks"], extra)

        # 3. исходники удаляем, только убедившись, что все треки реально на месте
        bad = [f.name for f in final if not f.is_file() or f.stat().st_size == 0]
        if bad:
            fail_image(cue, f"split result missing/empty ({bad[0]} ...), sources kept: {cue}")
            for f in final:
                rm(f)
            return
        for f in list(to_delete) + intermediates:
            try:
                f.unlink()
                print("🗑", f.name)
            except FileNotFoundError:
                pass
            except OSError as e:
                problem(f"rm {f}: {e}")
        if len(groups) > 1:
            note(f"cue with {len(groups)} image files split: {len(final)} tracks")
    finally:
        shutil.rmtree(str(work), ignore_errors=True)
        for f in intermediates:          # при неудаче промежуточный flac не оставляем
            if f.exists() and cue in FAILED:
                rm(f)


def looks_unsplit(folder, cues):
    """В папке остался cue, а аудио похоже на неразрезанный образ — конвейер тогда не
    должен переносить файлы (после переноса папка удаляется вместе с cue).
    Признаки: 1–3 длинных файла (>15 мин); либо cue описывает больше треков, чем
    файлов, а какой-то файл вмещает минимум два типичных трека cue (стороны A/B)."""
    files = audio_files(folder)
    if not files:
        return False
    if len(files) <= 3 and any((file_duration(f) or 0) > 900 for f in files):
        return True
    n, lens = 0, []
    for c in cues:
        try:
            tr = parse_cue(c)[1]
        except (OSError, UnicodeDecodeError):
            continue
        n += len(tr)
        lens += [b["start"] - a["start"] for a, b in zip(tr, tr[1:])
                 if b["start"] > a["start"]]
    if n > len(files) and lens:
        med = sorted(lens)[len(lens) // 2]
        return any((file_duration(f) or 0) >= 2 * med for f in files)
    return False


def find_cues(root):
    """Регистронезависимый рекурсивный поиск .cue."""
    out = []
    for p in root.rglob("*"):
        try:
            if p.is_file() and p.suffix.lower() == ".cue":
                out.append(p)
        except OSError:
            continue
    return sorted(out)


def handle_one(cue, **kw):
    """Обработать один cue. Не зависит от того, как назван каталог."""
    note(f"cue: {cue}")
    if convert_to_utf8(cue):
        process_cue(cue, **kw)


def album_key(title):
    return DISC_SUFFIX.sub("", title or "").strip().casefold()


def handle_folder_cues(d, cues):
    """Несколько cue в одной папке: каждый — со своим образом."""
    cues = sorted(cues, key=natural_key)
    note(f"{len(cues)} cue files in one folder: {d}")
    ok = [c for c in cues if convert_to_utf8(c)]
    if not ok:
        return
    info = {c: parse_cue(c, need_start=False) for c in ok}
    files = audio_files(d)
    # 1. образы, однозначно найденные по именам (только для cue с одной секцией)
    hints, claimed = {}, set()
    for c in ok:
        if len(make_runs(info[c][1])) == 1:
            img = find_image_by_name(c, [p for p in files if p not in claimed])
            if img is not None:
                hints[c] = img
                claimed.add(img)
    # 2. остальные cue и остальные файлы — по порядку, если их поровну
    rest_c = [c for c in ok if c not in hints and len(make_runs(info[c][1])) == 1]
    rest_f = [p for p in files if p not in claimed]
    if rest_c and len(rest_c) == len(rest_f):
        for c, p in zip(rest_c, rest_f):
            hints[c] = p
            claimed.add(p)
    # 3. подпапки: один альбом -> CD1, CD2 (их сводит merge_discs), разные -> по имени cue
    keys = {album_key(info[c][0]["title"]) for c in ok if info[c][0]["title"]}
    same_album = len(keys) <= 1
    for i, c in enumerate(ok, 1):
        subdir = f"CD{i}" if same_album else safe_name(c.stem)
        note(f"cue: {c}")
        own = hints.get(c)
        process_cue(c, exclude=claimed - ({own} if own else set()), hint=own,
                    subdir=subdir, discno=i if same_album else None)


def main():
    if len(sys.argv) < 2:
        problem("usage: prepare_cue.py <dir|file.cue>")
        return
    root = Path(sys.argv[1])
    if not root.exists():
        problem(f"not found: {root}")
        return

    if root.is_file():
        if root.suffix.lower() == ".cue":
            handle_one(root)
        else:
            problem(f"not a cue file: {root}")
        return

    cues = find_cues(root)
    if not cues:
        note(f"no cue files under: {root}")
        return

    by_dir = {}
    for cue in cues:
        by_dir.setdefault(cue.parent, []).append(cue)
    for d, cs in by_dir.items():
        if len(cs) > 1:
            handle_folder_cues(d, cs)
        else:
            handle_one(cs[0])

    # cue остались, а образ не порезан -> просим конвейер не трогать эту папку
    for d in by_dir:
        left = [p for p in d.iterdir() if p.is_file() and p.suffix.lower() == ".cue"]
        if left and looks_unsplit(d, left) and not any(c.parent == d for c in FAILED):
            problem(f"image not split (cue left, long audio file), folder kept: {d}")
            FAILED.append(d / "?")
    if FAILED:
        print(f"CUE_FAILED: {len(FAILED)}")      # последняя строка вывода


if __name__ == "__main__":
    main()
