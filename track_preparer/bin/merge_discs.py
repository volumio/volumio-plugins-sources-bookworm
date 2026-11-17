#!/usr/bin/env python3
# merge_discs.py <album_dir>
# cd1/ cd2/ ... -> в корень альбома. Нумерация треков сквозная (TRACKNUMBER),
# чтобы порядок «диск 1, затем диск 2» сохранился в Volumio.
import re
import sys
from pathlib import Path

from common import (DISC, audio_files, get_easy_tag, natural_key, note, problem,
                    safe_move, safe_target, set_easy_tags)


def main():
    album = Path(sys.argv[1])
    if not album.is_dir():
        return
    discs = sorted((p for p in album.iterdir()
                    if p.is_dir() and DISC.match(p.name)), key=natural_key)
    if not discs:
        return
    start = len(audio_files(album))          # файлы, уже лежащие в корне
    moved = []
    disc_no = {}
    for d in discs:
        dn = re.search(r"(\d+)", d.name)
        for f in audio_files(d):
            dst = safe_target(album, f.name)
            if dst is None:
                problem(f"collision limit, file left in {d.name}: {f}")
                continue
            try:
                safe_move(f, dst)
                moved.append(dst)
                if dn:
                    disc_no[dst] = dn.group(1).lstrip("0") or "0"
                print(f"→ {d.name}/{f.name} -> {dst.name}")
            except OSError as e:
                problem(f"move {f}: {e}")
        try:
            d.rmdir()
            print(f"🗑 {d.name}/")
        except OSError:
            pass                              # остались не-аудио файлы — не страшно
    if len(discs) > 1 or start:
        for i, p in enumerate(moved, start + 1):
            try:
                tags = {"tracknumber": i}
                if p in disc_no and not get_easy_tag(p, "discnumber"):
                    tags["discnumber"] = disc_no[p]       # диск из имени папки cd1/cd2
                set_easy_tags(p, **tags)
            except Exception as e:
                problem(f"tracknumber {p.name}: {e}")
    note(f"merged {len(discs)} disc folder(s), {len(moved)} files: {album.name}")


if __name__ == "__main__":
    main()
