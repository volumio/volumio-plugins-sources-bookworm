#!/usr/bin/env python3
# replaygain.py <album_dir>
# ReplayGain 2.0 (эталон -18 LUFS) через ffmpeg ebur128 + mutagen.
# ТОЛЬКО track gain (библиотека играет в shuffle, album gain не нужен и не пишется;
# старые album-теги из входных файлов вычищаются). Каждый файл измеряется заново и
# теги перезаписываются принудительно: входным данным не доверяем.
# Для треков с True Peak выше 0 dBTP выводится рекомендация заменить источник.
# Единственный расчётчик ReplayGain в плагине (внешних утилит не требуется).
import math
import re
import subprocess
import sys
from pathlib import Path

from common import (advice, audio_files, cancel_requested, log_only, note,
                    problem, progress)

REF_LUFS = -18.0
CLIP_PROTECT = True             # занижать gain в ТЕГЕ, если пик после gain выйдет за MAX_TP_DB
MAX_TP_DB = -1.0                # потолок True Peak после gain, dBTP (как loudgain -k)
MAX_TP = 10 ** (MAX_TP_DB / 20)
SILENCE_LUFS = -69.0            # ffmpeg пишет -70.0, если ни один блок не прошёл гейт (тишина)
MAX_PLAUSIBLE_LUFS = -1.0       # громче у реальной музыки не бывает: 0.0 = сбой декодирования/замера
def run(cmd):
    # utf-8 + replace: ffmpeg печатает теги файлов, а в «кривых» тегах (cp1251)
    # строгая декодировка валила замер UnicodeDecodeError
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", stdin=subprocess.DEVNULL)


def _ffmpeg(args, af, vn=True):
    r = run(["ffmpeg", "-hide_banner", "-nostats", *args, *(["-vn"] if vn else []),
             "-af", af, "-f", "null", "-"])
    return r.returncode, (r.stdout or "") + "\n" + (r.stderr or "")


def parse_lufs(out):
    """Интегральная громкость ТОЛЬКО из итогового блока Summary (покадровые строки
    с «I:» и сводка от неудачно запущенного фильтра не годятся) -> float или None."""
    if "Summary:" not in out:
        return None
    tail = out[out.rfind("Summary:"):]
    m = re.search(r"\bI:\s+(-?[\d.]+|-inf)\s+LUFS", tail)
    return float(m.group(1)) if m else None


def parse_peak_db(out):
    """Максимум по всем строкам 'Peak level dB' (astats) -> dBFS или None."""
    vals = [v for v in re.findall(r"Peak level dB:\s*(-?[\d.]+|-inf)", out)]
    nums = [float(v) for v in vals if v != "-inf"]
    if nums:
        return max(nums)
    return None if not vals else float("-inf")


def parse_volumedetect(out):
    m = re.search(r"max_volume:\s*(-?[\d.]+|-inf)\s*dB", out)
    return float(m.group(1)) if m else None


def parse_true_peak(out):
    """True Peak из итога ebur128=peak=true ('True peak: / Peak: x dBFS') ->
    dBFS, -inf либо None, если блока нет (старый ffmpeg или фильтр без peak)."""
    if "Summary:" not in out:
        return None
    tail = out[out.rfind("Summary:"):]
    m = re.search(r"True peak:\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS", tail)
    return float(m.group(1)) if m else None


def measure(args):
    """-> (LUFS, True Peak линейный или None) либо None, если громкость измерить нельзя
    (ошибка ffmpeg, тишина, неправдоподобное значение); причина — в measure.last_error.
    Громкость и истинный пик — за ОДИН проход ebur128=peak=true. Если ffmpeg не напечатал
    пик, он (уже сэмпловый) добирается запасными фильтрами astats/volumedetect:
    нулевой пик в тегах хуже, чем его отсутствие.

    Важно: код возврата ffmpeg проверяется. В ffmpeg 4.x-5.1 (в т. ч. Debian 12) опция
    ebur128=framelog=quiet не принимается: фильтр не запускается, ffmpeg завершается
    с ошибкой, но всё равно печатает пустую сводку «I: 0.0 LUFS, Peak: -inf». Раньше её
    принимали за результат и писали gain -18.00 dB всем трекам. Поэтому framelog не
    используется, а результат принимается только при rc == 0."""
    measure.last_error = ""
    lufs = None
    peak_db = None
    err = ""
    for af in ("ebur128=peak=true", "ebur128"):
        rc, out = _ffmpeg(args, af)
        if rc != 0:
            err = f"ffmpeg rc={rc}: " + out.strip()[-250:]
            continue
        lufs = parse_lufs(out)
        if lufs is not None:
            peak_db = parse_true_peak(out)
            break
        err = "no ebur128 summary: " + out.strip()[-250:]
    if lufs is None:
        measure.last_error = err
        return None
    if not math.isfinite(lufs) or lufs <= SILENCE_LUFS:
        measure.last_error = "silence"       # иначе gain вышел бы около +52 dB
        return None
    if lufs >= MAX_PLAUSIBLE_LUFS:
        # подстраховка: 0.0 LUFS = gain ровно -18.00 dB — след сбойного замера
        measure.last_error = f"implausible loudness {lufs} LUFS"
        return None
    if peak_db is None:
        for af, parser in (("astats", parse_peak_db), ("volumedetect", parse_volumedetect)):
            rc, out = _ffmpeg(args, af)
            peak_db = parser(out) if rc == 0 else None
            if peak_db is not None:
                break
    peak = None
    if peak_db is not None and peak_db != float("-inf"):
        peak = 10 ** (peak_db / 20)
    return lufs, peak


measure.last_error = ""


def measure_file(path):
    return measure(["-i", str(path)])


def fmt_gain(g):
    r = round(g, 2)
    if r == 0:
        r = 0.0                                          # без "-0.00 dB"
    return f"{r:.2f} dB"


def clamp_gain(gain_db, peak):
    """Не даёт gain вытолкнуть пик выше MAX_TP (аналог loudgain -k).
    Правится только значение тега, аудио не трогается."""
    if not CLIP_PROTECT or not peak:
        return gain_db
    return min(gain_db, 20 * math.log10(MAX_TP / peak))


def _is_rg_key(k):
    """True, если тег относится к ReplayGain/R128 — в любом регистре и формате.

    Понимает:
      - ID3: TXXX:..., PRIV:..., RVA2:track / RVAD / RVA, COMM:...iTunNORM...
      - Vorbis: REPLAYGAIN_*, R128_*, replaygain-*, replaygain.*, просто replaygain
    """
    kl = k.lower().strip()
    # ID3-префиксы — анализируем сам desc/owner
    for pre in ("txxx:", "priv:"):
        if kl.startswith(pre):
            kl = kl[len(pre):]
            break
    # Старые ID3-фреймы относительной громкости. Ключи mutagen: "RVA2:track",
    # "RVA2:album", "RVAD", "RVA" (раньше RVA2/RVAD из-за kl[3] не находились).
    if kl in ("rva", "rvad", "rva2") or kl.startswith(("rva2:", "rvad:", "rva:")):
        return True
    # iTunNORM — тоже RG-подобный тег
    if "itunnorm" in kl:
        return True
    # Стандартные префиксы в любом разделителе + «голые» имена
    for base in ("replaygain", "r128"):
        if kl == base:
            return True
        for sep in ("_", "-", ".", " ", "/"):
            if kl.startswith(base + sep):
                return True
    return False


def _strip_ape(path):
    """mp3gain/foobar кладут ReplayGain в APEv2 — убираем только RG-ключи, чтобы
    плееры не читали старые значения рядом с новыми."""
    from mutagen.apev2 import APENoHeaderError, APEv2
    try:
        a = APEv2(str(path))
    except APENoHeaderError:
        return
    keys = [k for k in a.keys() if _is_rg_key(k)]
    if keys:
        for k in keys:
            del a[k]
        a.save()


def write_tags(path, tags):
    """Принудительно перезаписывает ReplayGain-теги.

    Порядок: (1) удалить ВСЕ старые RG-теги (в любом регистре/формате,
    включая чужие и нулевые), (2) записать новые, (3) сохранить файл
    безусловно.
    """
    path = Path(path)

    if path.suffix.lower() == ".flac":
        from mutagen.flac import FLAC
        audio = FLAC(str(path))
        if audio.tags is None:
            audio.add_tags()
        for k in [k for k in audio.keys() if _is_rg_key(k)]:
            del audio[k]
        for k, v in tags.items():
            audio[k] = [v] if isinstance(v, str) else list(v)   # Vorbis: список строк
        audio.save()
        return

    # ID3 (mp3)
    from mutagen.id3 import ID3, ID3NoHeaderError, TXXX
    try:
        t = ID3(str(path))
    except ID3NoHeaderError:
        t = ID3()
    for k in [k for k in t.keys() if _is_rg_key(k)]:
        del t[k]
    for k, v in tags.items():
        t.add(TXXX(encoding=3, desc=k, text=[v]))
    t.save(str(path), v2_version=4)
    try:
        _strip_ape(path)
    except Exception:                                    # noqa: BLE001
        pass                                             # APE — необязательная чистка


def read_tag(path, key):
    """Значение ReplayGain-тега из файла (после записи), '' если его нет. Без учёта регистра."""
    path = Path(path)
    key = key.lower()
    if path.suffix.lower() == ".flac":
        from mutagen.flac import FLAC
        audio = FLAC(str(path))
        for k in audio.keys():
            if k.lower() == key:
                return str(audio[k][0])
        return ""
    from mutagen.id3 import ID3
    for k, fr in ID3(str(path)).items():
        if k.lower() == "txxx:" + key and getattr(fr, "text", None):
            return str(fr.text[0])
    return ""


def _default_step(i, n, name):
    progress(i=i, n=n, file=name)


def process_folder(folder, on_step=_default_step, verbose=False):
    """Track gain + пик для всех flac/mp3 папки. Измеряется КАЖДЫЙ файл, теги
    перезаписываются принудительно (старые, нулевые и album-теги удаляются).
    -> (записано, всего) либо None, если остановлено пользователем.
    on_step(i, n, имя) — сообщение о ходе работы."""
    folder = Path(folder)
    files = audio_files(folder)
    if not files:
        return 0, 0
    written = 0
    hot = []                                    # (имя, True Peak dBTP) выше 0 dBTP
    failed = []                                 # (имя, причина): громкость не измерена
    for idx, f in enumerate(files):
        if cancel_requested():
            note("stopped on request")
            return None
        on_step(idx, len(files), f.name)
        res = measure_file(f)
        if res is None:
            # Не измерено — значит, старые ReplayGain-теги в файле недостоверны (например,
            # -18.00 dB из чужого инструмента): лучше без тегов, чем с ложными.
            failed.append((f.name, measure.last_error or "unknown error"))
            try:
                write_tags(f, {})
            except Exception as e:              # noqa: BLE001
                problem(f"replaygain tags {f}: {type(e).__name__}: {e}")
            continue
        lufs, peak = res
        tags = {
            "REPLAYGAIN_TRACK_GAIN": fmt_gain(clamp_gain(REF_LUFS - lufs, peak)),
            "REPLAYGAIN_REFERENCE_LOUDNESS": f"{REF_LUFS:.2f} LUFS",
        }
        if peak:
            tags["REPLAYGAIN_TRACK_PEAK"] = f"{peak:.6f}"
            tp_db = 20 * math.log10(peak)
            if round(tp_db, 2) > 0:
                hot.append((f.name, tp_db))
        else:
            note(f"replaygain: peak unavailable for {f.name}, peak tag skipped")
        try:
            write_tags(f, tags)                 # всегда force-rewrite
            got = read_tag(f, "REPLAYGAIN_TRACK_GAIN")      # проверка: записалось ли
            if got != tags["REPLAYGAIN_TRACK_GAIN"]:
                problem(f"replaygain: tag not written to {f.name} "
                        f"(wrote {tags['REPLAYGAIN_TRACK_GAIN']}, read back '{got}')")
                continue
            written += 1
            if verbose:
                print("✓ RG", f.name)
        except Exception as e:                  # noqa: BLE001
            problem(f"replaygain tags {f}: {type(e).__name__}: {e}")
    if failed:
        # подробности — только в лог; в окне одна спокойная строка на папку, а не на трек
        for name, why in failed:
            log_only(f"replaygain: no tags for {name}: {why[:300]}")
        silent = [n for n, why in failed if why == "silence"]
        broken = [n for n, why in failed if why != "silence"]
        if broken and len(broken) == len(files):
            advice(f"ReplayGain: «{folder.name}» — громкость не измерена ни у одного трека, "
                   f"теги не записаны (старые удалены). Проверьте ffmpeg: "
                   f"python3 bin/diagnose.py (подробности в errors.log)")
        elif broken:
            advice(f"ReplayGain: «{folder.name}» — не измерено {len(broken)} из {len(files)} "
                   f"треков, они остались без тегов (подробности в errors.log)")
        if silent:
            log_only(f"replaygain: {len(silent)} silent track(s) skipped in {folder.name}")
    if hot:
        advice(f"{folder.name}: True Peak выше 0 dBTP у {len(hot)} из {len(files)} треков "
               f"(макс. {max(d for _, d in hot):+.2f} dBTP) — вероятен клиппинг мастера/кодирования, "
               f"рекомендуется заменить на качественные версии:")
        for name, d in sorted(hot, key=lambda x: -x[1]):
            advice(f"    {name}  {d:+.2f} dBTP")
    log_only(f"replaygain: {written}/{len(files)} tracks rewritten: {folder}")
    return written, len(files)


def main():
    if len(sys.argv) < 2:
        print("usage: replaygain.py <album_dir>", file=sys.stderr)
        sys.exit(1)
    folder = Path(sys.argv[1])
    if folder.is_dir():
        process_folder(folder, verbose=True)
        progress(i=1, n=1)


if __name__ == "__main__":
    main()
