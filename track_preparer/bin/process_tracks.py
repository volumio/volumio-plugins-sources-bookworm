#!/usr/bin/env python3
# process_tracks.py <dir> [--cover <path>]
# Для каждого flac/mp3 в папке:
#   1) обрезать тишину в начале и в конце (без лишнего перекодирования:
#      flac — lossless-перекодирование, mp3 — копирование потока);
#      если тишины нет, файл не трогается;
#   2) пересчитать seektable (flac);
#   3) встроить обложку, если её нет.
import re
import subprocess
import sys
from pathlib import Path

from common import audio_files, cancel_requested, note, problem, progress, rm

SILENCE_DB = -50      # порог тишины
MIN_SILENCE = 0.1     # минимальная длина тишины, сек
MARGIN = 0.05         # запас, чтобы не срезать атаку, сек
MIN_TRIM = 0.15       # меньше этого не трогаем файл, сек


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL)


def duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def detect_trim(path, dur):
    """-> (start, end) в секундах или None, если резать нечего."""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn",
             "-af", f"silencedetect=noise={SILENCE_DB}dB:d={MIN_SILENCE}",
             "-f", "null", "-"])
    if r.returncode:
        raise RuntimeError("silencedetect: " + r.stderr.strip()[-300:])
    periods = []
    for line in r.stderr.splitlines():
        m = re.search(r"silence_start:\s*(-?[\d.eE+-]+)", line)
        if m:
            periods.append([max(0.0, float(m.group(1))), None])
            continue
        m = re.search(r"silence_end:\s*(-?[\d.eE+-]+)", line)
        if m and periods and periods[-1][1] is None:
            periods[-1][1] = float(m.group(1))
    start, end = 0.0, dur
    if periods:
        first, last = periods[0], periods[-1]
        if first[0] <= 0.05 and first[1] is not None:
            start = max(0.0, first[1] - MARGIN)
        if last[1] is None or last[1] >= dur - 0.05:
            end = min(dur, last[0] + MARGIN)
    if end - start < 1.0:            # файл целиком «тишина» — не трогаем
        return None
    if start < MIN_TRIM:
        start = 0.0
    if dur - end < MIN_TRIM:
        end = dur
    if start == 0.0 and end == dur:
        return None
    return start, end


def copy_flac_meta(src, dst):
    from mutagen.flac import FLAC
    s, d = FLAC(str(src)), FLAC(str(dst))
    if d.tags is None:
        d.add_tags()
    d.tags.clear()
    for kv in list(s.tags or []):
        d.tags.append(kv)
    d.clear_pictures()
    for p in s.pictures:
        d.add_picture(p)
    d.save()


def copy_mp3_meta(src, dst):
    from mutagen.id3 import ID3, ID3NoHeaderError
    try:
        tags = ID3(str(src))
    except ID3NoHeaderError:
        return
    tags.delall("TLEN")
    tags.save(str(dst), v2_version=4)


def trim_file(path, start, end):
    is_flac = path.suffix.lower() == ".flac"
    tmp = path.with_name("." + path.name + ".tmp" + path.suffix)
    codec = (["-c:a", "flac", "-compression_level", "8"] if is_flac
             else ["-c:a", "copy", "-write_xing", "1"])
    r = run(["ffmpeg", "-loglevel", "error", "-ss", f"{start:.3f}",
             "-i", str(path), "-t", f"{end - start:.3f}",
             "-map", "0:a", "-vn", "-map_metadata", "-1", *codec,
             "-y", str(tmp)])
    if r.returncode or not tmp.is_file():
        rm(tmp)
        raise RuntimeError("trim: " + r.stderr.strip()[-300:])
    new_dur = duration(tmp)
    if new_dur is None or abs(new_dur - (end - start)) > 1.0:
        rm(tmp)
        raise RuntimeError(f"trim: bad duration {new_dur} vs {end - start:.2f}")
    try:
        (copy_flac_meta if is_flac else copy_mp3_meta)(path, tmp)
    except Exception:
        rm(tmp)
        raise
    tmp.replace(path)


def recalc_seektable(path):
    if path.suffix.lower() != ".flac":
        return
    try:
        subprocess.run(["metaflac", "--remove", "--block-type=SEEKTABLE",
                        "--dont-use-padding", str(path)],
                       capture_output=True, stdin=subprocess.DEVNULL)
        subprocess.run(["metaflac", "--add-seekpoint=10s", str(path)],
                       capture_output=True, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        pass


def has_cover(path):
    if path.suffix.lower() == ".flac":
        from mutagen.flac import FLAC
        return bool(FLAC(str(path)).pictures)
    from mutagen.id3 import ID3, ID3NoHeaderError
    try:
        return bool(ID3(str(path)).getall("APIC"))
    except ID3NoHeaderError:
        return False


def embed_cover(path, image):
    from PIL import Image
    data = image.read_bytes()
    jpg = image.suffix.lower() in (".jpg", ".jpeg")
    mime = "image/jpeg" if jpg else "image/png"
    if path.suffix.lower() == ".flac":
        from mutagen.flac import FLAC, Picture
        with Image.open(image) as im:
            w, h = im.size
        pic = Picture()
        pic.data, pic.type, pic.mime = data, 3, mime
        pic.width, pic.height, pic.depth = w, h, 24
        a = FLAC(str(path))
        a.add_picture(pic)
        a.save()
    else:
        from mutagen.id3 import ID3, ID3NoHeaderError, APIC
        try:
            t = ID3(str(path))
        except ID3NoHeaderError:
            t = ID3()
        t.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
        t.save(str(path), v2_version=4)


def process_one(path, cover):
    dur = duration(path)
    if dur is None:
        raise RuntimeError("cannot read duration")
    trim = detect_trim(path, dur)
    if trim:
        trim_file(path, *trim)
        note(f"trimmed silence: {path.name} ({trim[0]:.2f}s / {dur - trim[1]:.2f}s)")
    recalc_seektable(path)
    if cover and cover.is_file() and not has_cover(path):
        embed_cover(path, cover)


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.exit(1)
    album = Path(argv[0])
    cover = Path(argv[2]) if len(argv) >= 3 and argv[1] == "--cover" else None
    if not album.is_dir():
        return
    for tmp in album.glob(".*.tmp.*"):          # остатки прерванного запуска
        rm(tmp)
    files = audio_files(album)
    for idx, f in enumerate(files):
        if cancel_requested():
            note('stopped on request')
            return
        progress(i=idx, n=len(files), file=f.name)
        for attempt in (1, 2):
            try:
                process_one(f, cover)
                print("✓", f.name)
                break
            except Exception as e:
                note(f"[try {attempt}] {f.name}: {e}")
        else:
            problem(f"file left unprocessed: {f}")
    progress(i=len(files), n=len(files))


if __name__ == "__main__":
    main()
