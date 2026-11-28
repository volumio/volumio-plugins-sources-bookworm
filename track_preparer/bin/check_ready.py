#!/usr/bin/env python3
# check_ready.py <album_dir>
# Решает, нужна ли альбому полная обработка. Альбом «готов», если ВСЕ его
# flac/mp3 (включая подпапки cd1/cd2) уже имеют теги title, album, artist или
# albumartist И встроенную обложку, а необработанных cue не осталось.
# Готовый альбом только переименовывается (номер -> тег) и переносится:
# без обрезки тишины и поиска обложки (ReplayGain считается всем альбомам).
# Последняя строка вывода: "READY: ..." или "FULL: ..." (читает run_pipeline).
import sys
from pathlib import Path

from common import audio_files, get_easy_tag, natural_key
from process_tracks import has_cover

MUSIC_EXTS = (".flac", ".mp3")


def missing(f):
    """Что отсутствует у файла (список строк)."""
    out = []
    if not get_easy_tag(f, "title"):
        out.append("title")
    if not get_easy_tag(f, "album"):
        out.append("album")
    if not (get_easy_tag(f, "artist") or get_easy_tag(f, "albumartist")):
        out.append("artist")
    try:
        if not has_cover(f):
            out.append("cover")
    except Exception:                                   # noqa: BLE001
        out.append("cover")
    return out


def main():
    album = Path(sys.argv[1])
    files = [p for p in sorted(album.rglob("*"), key=natural_key)
             if p.is_file() and not p.name.startswith(".")
             and p.suffix.lower() in MUSIC_EXTS]
    if not files:
        print("FULL: no flac/mp3 files")
        return
    if any(p.suffix.lower() == ".cue" for p in album.rglob("*") if p.is_file()):
        print("FULL: unprocessed cue present")
        return
    for f in files:
        m = missing(f)
        if m:
            print(f"FULL: {f.name} lacks {', '.join(m)}")
            return
    print(f"READY: {len(files)} track(s) already tagged with embedded cover — only renaming and moving")


if __name__ == "__main__":
    main()
