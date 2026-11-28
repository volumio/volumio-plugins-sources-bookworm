#!/usr/bin/env python3
# unpack_images.py <album_dir>
# Первый этап: приведение форматов. Рекурсивно ищет аудио любого формата,
# кроме flac и mp3 (образы вида Album.iso.wv, .ape, .wav, .aiff, .tta, m4a,
# ogg, opus, wma, aac, ...) — как образы с cue, так и уже нарезанные треки:
#   * lossless (ape, wv, wav, aiff, tta, alac, pcm, wmalossless, ...) -> flac;
#   * lossy    (aac, vorbis, opus, wma, ac3, mp2, ...)               -> mp3 (VBR V0);
#   * теги и встроенная обложка исходника переносятся в результат;
#   * если cue рядом нет, но он встроен в файл (тег CUESHEET/Cuesheet) —
#     выписывается в <имя>.cue;
#   * исходник удаляется только после проверки длительности результата.
import json
import re
import subprocess
import sys
from pathlib import Path

from common import (ANY_AUDIO, cancel_requested, natural_key, note, problem,
                    progress, rm)

SKIP_EXTS = {".flac", ".mp3", ".m4b"}          # m4b — аудиокниги, плагин их не ведёт
CONVERT = ANY_AUDIO - SKIP_EXTS
LOSSLESS_CODECS = {"ape", "wavpack", "tta", "alac", "flac", "wmalossless",
                   "mlp", "truehd", "shorten", "tak"}
MP3_QUALITY = "0"                              # libmp3lame VBR V0 (~245 kbit/s)
PIC = ["-map", "0:v:0?", "-c:v", "copy", "-disposition:v", "attached_pic"]


def is_lossless(codec):
    return codec in LOSSLESS_CODECS or codec.startswith("pcm_")


def run(cmd):
    return subprocess.run([str(c) for c in cmd], capture_output=True,
                          text=True, stdin=subprocess.DEVNULL)


def probe(path):
    """-> (codec, duration, tags{lower: value}, channels) или None."""
    r = run(["ffprobe", "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=codec_name,channels:format=duration:format_tags",
             "-of", "json", path])
    try:
        d = json.loads(r.stdout)
        st = d["streams"][0]
        codec = st["codec_name"]
    except (ValueError, KeyError, IndexError):
        return None
    try:
        dur = float(d["format"]["duration"])
    except (KeyError, ValueError):
        dur = None
    tags = {k.lower(): v for k, v in d.get("format", {}).get("tags", {}).items()}
    return codec, dur, tags, int(st.get("channels") or 2)


def candidates(root):
    out = []
    for p in root.rglob("*"):
        try:
            if (p.is_file() and not p.name.startswith(".")
                    and p.suffix.lower() in CONVERT):
                out.append(p)
        except OSError:
            continue
    return sorted(out, key=natural_key)


def has_cue(d):
    return any(p.is_file() and p.suffix.lower() == ".cue" for p in d.iterdir())


def audio_siblings(d):
    return [p for p in d.iterdir() if p.is_file() and not p.name.startswith(".")
            and p.suffix.lower() in ANY_AUDIO]


_FILE_RE = re.compile(r'(?im)^(\s*FILE\s+)(?:"[^"]*"|\S+)(\s+\S+\s*)$')


def write_embedded_cue(src, dst, tags, alone):
    """Встроенный cue -> <stem>.cue рядом (только если файл один в папке и cue нет)."""
    cue_text = tags.get("cuesheet")
    if not alone or not cue_text or "TRACK" not in cue_text.upper():
        return
    text = _FILE_RE.sub(lambda m: f'{m.group(1)}"{dst.name}"{m.group(2)}',
                        cue_text, count=1)
    if not _FILE_RE.search(text):
        text = f'FILE "{dst.name}" WAVE\n' + text
    (src.parent / (src.stem + ".cue")).write_text(text, encoding="utf-8")
    note(f"embedded cue extracted: {src.name}")


def drop_cuesheet_tag(path):
    try:
        from mutagen import File
        a = File(str(path))
        if a is not None and a.tags:
            for k in [k for k in a.keys() if k.lower() == "cuesheet"]:
                del a[k]
            a.save()
    except Exception:                                   # noqa: BLE001
        pass


def convert(src, dur, lossless, channels):
    ext = ".flac" if lossless else ".mp3"
    dst = src.with_suffix(ext)
    if dst.exists():
        dst = src.with_name(src.stem + ".conv" + ext)
    tmp = src.with_name("." + dst.name + ".tmp" + ext)
    if lossless:
        codec = ["-c:a", "flac", "-compression_level", "8"]
        attempts = [(PIC, []), ([], []),
                    ([], ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"])]
    else:
        codec = ["-c:a", "libmp3lame", "-q:a", MP3_QUALITY, "-id3v2_version", "3"]
        if channels > 2:
            codec += ["-ac", "2"]
        attempts = [(PIC, []), ([], [])]
    err = ""
    for pic, extra in attempts:
        r = run(["ffmpeg", "-loglevel", "error", "-i", src, "-map", "0:a:0",
                 *pic, "-map_metadata", "0", *codec, *extra, "-y", tmp])
        if r.returncode == 0 and tmp.is_file():
            break
        err = r.stderr.strip()[-300:]
        rm(tmp)
    else:
        raise RuntimeError(err or "ffmpeg failed")
    res = probe(tmp)
    if res is None or res[1] is None or (dur and abs(res[1] - dur) > 1.0):
        rm(tmp)
        raise RuntimeError(f"bad duration after convert: {res and res[1]} vs {dur}")
    tmp.replace(dst)
    if lossless:
        drop_cuesheet_tag(dst)
    return dst


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    root = Path(sys.argv[1])
    if not root.is_dir():
        return
    for tmp in list(root.rglob(".*.tmp.flac")) + list(root.rglob(".*.tmp.mp3")):
        rm(tmp)                                          # остатки прерванного запуска
    files = candidates(root)
    n_flac = n_mp3 = 0
    for i, f in enumerate(files):
        if cancel_requested():
            note("stopped on request")
            return
        progress(i=i, n=len(files), file=f.name)
        info = probe(f)
        if info is None:
            problem(f"cannot read audio, left as is: {f}")
            continue
        codec, dur, tags, channels = info
        lossless = is_lossless(codec)
        alone = not has_cue(f.parent) and len(audio_siblings(f.parent)) == 1
        try:
            dst = convert(f, dur, lossless, channels)
            write_embedded_cue(f, dst, tags, alone)
            f.unlink()
            n_flac += lossless
            n_mp3 += not lossless
            print(f"✓ {f.name} -> {dst.name} ({'lossless' if lossless else 'lossy'})")
        except Exception as e:                            # noqa: BLE001
            problem(f"convert {f}: {e}")
    progress(i=len(files), n=len(files))
    if n_flac or n_mp3:
        note(f"converted in {root.name}: {n_flac} -> flac, {n_mp3} -> mp3")


if __name__ == "__main__":
    main()
