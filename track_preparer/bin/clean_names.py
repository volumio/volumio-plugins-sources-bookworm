#!/usr/bin/env python3
# clean_names.py <album_dir>
# Убирает номер трека из имён файлов ("01 - Title.flac" -> "Title.flac").
# Порядок не теряется: номер записывается в тег TRACKNUMBER (если его нет),
# название — в TITLE (если его нет).
#
# Номер считается номером трека (а не частью названия, как "99 Luftballons"),
# если выполнено хотя бы одно:
#   * он совпадает с тегом TRACKNUMBER;
#   * остаток имени совпадает с тегом TITLE;
#   * тега TRACKNUMBER нет, а номер не больше разумного (до 2×числа файлов);
#   * тега TITLE нет, а номер не больше числа файлов в папке
#     (TRACKNUMBER после объединения дисков сквозной, потому не сверяется).
# Остальные файлы (картинки и т.п.) не затрагиваются.
import re
import sys
from pathlib import Path

from common import (audio_files, get_easy_tag, natural_key, note, problem,
                    safe_filename, safe_target, set_easy_tags)

MUSIC_EXTS = (".flac", ".mp3")
# номер + разделитель (" - ", ". ", ".", "_", "-", ")", пробел) + название
PREFIX = re.compile(r"^\s*(\d{1,3})\s*(?:[-._)]+\s*|\s+)(\S.*)$")
BAD_CHARS = re.compile(r'[\\/:*?"<>|]')
DUP_SUFFIX = re.compile(r"\(\d{2}\)$")


def norm(s):
    return BAD_CHARS.sub("_", s).strip().casefold()


def track_no(tag):
    m = re.match(r"\s*(\d+)", tag or "")
    return int(m.group(1)) if m else None


def decide(f, total):
    """-> (num, title) если префикс надо убрать, иначе None."""
    m = PREFIX.match(f.stem)
    if not m:
        return None
    num, rest = int(m.group(1)), m.group(2).strip()
    rest = DUP_SUFFIX.sub("", rest) or rest        # "Same(01)" -> "Same" (суффикс от объединения дисков)
    tag_no = track_no(get_easy_tag(f, "tracknumber"))
    tag_title = get_easy_tag(f, "title")
    if tag_no is not None and tag_no == num:
        return num, rest
    if tag_title and norm(tag_title) == norm(rest):
        return num, rest
    # тега номера нет: номер из имени — это номер трека (записывается в тег)
    if tag_no is None and num <= max(total, 1) * 2:
        return num, rest
    # нет названия в тегах (тег номера может быть сквозным после объединения дисков)
    if not tag_title and num <= total:
        return num, rest
    return None


def process_folder(folder):
    files = audio_files(folder, MUSIC_EXTS)
    if not files:
        note(f"no music files: {folder.name}")
        return
    renamed = 0
    # порядок обработки — по номеру трека, чтобы при одинаковых названиях
    # суффиксы (01), (02) шли в порядке треков
    order = {f: (track_no(get_easy_tag(f, "tracknumber")) or 9999) for f in files}
    for f in sorted(files, key=lambda f: (order[f], natural_key(f))):
        d = decide(f, len(files))
        if d is None:
            continue
        num, title = d
        tags = {}
        if not get_easy_tag(f, "title"):
            tags["title"] = title
        if track_no(get_easy_tag(f, "tracknumber")) is None:
            tags["tracknumber"] = num
        try:
            if tags:
                set_easy_tags(f, **tags)       # сначала теги, потом имя
        except Exception as e:                  # noqa: BLE001
            problem(f"cannot tag {f.name}, name untouched: {e}")
            continue
        dst = safe_target(folder, safe_filename(title) + f.suffix)
        if dst is None:
            problem(f"name collision: {f.name}")
            continue
        try:
            f.rename(dst)
            renamed += 1
            print(f"-> {f.name} -> {dst.name}")
        except OSError as e:
            problem(f"rename {f}: {e}")
    note(f"names cleaned: {renamed}/{len(files)} in {folder.name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: clean_names.py <album_dir>", file=sys.stderr)
        sys.exit(1)
    process_folder(Path(sys.argv[1]))
