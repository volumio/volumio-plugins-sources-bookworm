#!/usr/bin/env python3
# sort_library.py <in_music_dir>
# Любая папка во входной -> треки в out/<артист>/<альбом>/ по ТЕГАМ (структура входа не важна;
# только треки, без файлов обложки)
# Папка-источник удаляется ТОЛЬКО если в ней не осталось аудио.
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

from common import (DISC_SUFFIX, MUSIC_EXTS, OUT_MUSIC, audio_files, get_easy_tag, leftover_audio,
                    note, problem, safe_filename, safe_move, safe_target)

UNKNOWN = "_unknown"
UNSORTED = "_unsorted"


def move_files(files, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    moved = 0
    for f in files:
        dst = safe_target(out_dir, f.name)
        if dst is None:
            problem(f"collision limit: {f}")
            continue
        try:
            size = f.stat().st_size
            safe_move(f, dst)
            # убеждаемся, что файл реально появился в назначении целиком
            if not dst.is_file() or dst.stat().st_size != size:
                problem(f"move verify failed (size/exists): {f} -> {dst}")
                continue
            moved += 1
        except OSError as e:
            problem(f"move {f}: {type(e).__name__}: {e}")
    return moved


VARIOUS = "Various Artists"


def _top(values):
    values = [v.strip() for v in values if v and v.strip()]
    if not values:
        return "", 0, 0
    value, n = Counter(values).most_common(1)[0]
    return value, n, len(values)


def destination(files, folder_name):
    """Папка в выходной библиотеке: out/<артист>/<альбом>/ по тегам файлов.
    Альбом — самый частый тег album (без суффикса "(Disc 1)"), иначе имя папки.
    Артист — самый частый albumartist; если его нет — самый частый artist,
    когда он у >=60% треков; если исполнители разные — "Various Artists";
    тегов нет вовсе — _unknown. Структура входных папок не используется."""
    album, _, _ = _top(get_easy_tag(f, "album") for f in files)
    album = DISC_SUFFIX.sub("", album) or folder_name
    artist, _, _ = _top(get_easy_tag(f, "albumartist") for f in files)
    if not artist:
        top, n, total = _top(get_easy_tag(f, "artist") for f in files)
        if total:
            artist = top if n / len(files) >= 0.6 else VARIOUS
    return (OUT_MUSIC / (safe_filename(artist, UNKNOWN)[:120])
            / safe_filename(album, UNSORTED)[:120])


DESTS = []          # папки назначения этого запуска (печатаются в конце как '→ путь')


def process_album(album_dir):
    files = audio_files(album_dir, MUSIC_EXTS)
    if not files:
        left = leftover_audio(album_dir)
        if left:
            problem(f"left in place ({len(left)} audio files, e.g. "
                    f"{left[0].relative_to(album_dir)}): {album_dir}")
        return
    out_dir = destination(files, album_dir.name)
    moved = move_files(files, out_dir)      # обложка встроена в треки, файл обложки не переносим
    note(f"moved {moved}/{len(files)} file(s) -> {out_dir}")
    if moved:
        DESTS.append(out_dir)
    if moved < len(files):
        problem(f"left in place (not all files moved): {album_dir}")
        return
    left = leftover_audio(album_dir)
    if left:
        problem(f"left in place ({len(left)} audio files remain, e.g. "
                f"{left[0].relative_to(album_dir)}): {album_dir}")
        return
    try:
        shutil.rmtree(str(album_dir))
        print(f"🗑 {album_dir}")
    except OSError as e:
        problem(f"rmtree {album_dir}: {e}")


def process_root_files(in_music):
    """Одиночные файлы прямо в корне входной папки: каждый — по своим тегам."""
    files = audio_files(in_music, MUSIC_EXTS)
    n = 0
    for f in files:
        dest = destination([f], UNSORTED)
        got = move_files([f], dest)
        n += got
        if got and dest not in DESTS:
            DESTS.append(dest)
    if files:
        note(f"{n}/{len(files)} loose files sorted by tags")


# Мусор, который не мешает удалить папку, если в ней не осталось музыки
JUNK_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff",
             ".nfo", ".txt", ".log", ".m3u", ".m3u8", ".db", ".ini", ".url",
             ".sfv", ".md5", ".ffp", ".accurip"}


def is_junk(p):
    return p.name.startswith(".") or p.suffix.lower() in JUNK_EXTS


def prune_empty(root):
    """Снизу вверх убирает папки под root, в которых нет музыки и cue:
    пустые, а также содержащие только картинки/служебные файлы (JUNK_EXTS,
    скрытые). Папка с аудио, cue или прочими файлами остаётся (+ запись в лог).
    Сам root не удаляется."""
    for d in sorted((p for p in Path(root).rglob("*") if p.is_dir()),
                    key=lambda p: len(p.parts), reverse=True):
        try:
            items = list(d.iterdir())
        except OSError:
            continue
        if any(i.is_dir() for i in items):
            continue                                   # внутри ещё что-то осталось
        keep = [i for i in items if not is_junk(i)]
        if keep:
            note(f"folder kept (non-junk files left, e.g. {keep[0].name}): {d}")
            continue
        try:
            for i in items:
                i.unlink()
            d.rmdir()
            print(f"🗑 {d}/")
        except OSError as e:
            problem(f"cannot remove {d}: {e}")


def print_dests():
    seen = []
    for d in DESTS:
        if d not in seen:
            seen.append(d)
            print(f"→ {d}")


def main():
    in_music = Path(sys.argv[1])
    if not in_music.is_dir():
        return
    if len(sys.argv) >= 4 and sys.argv[2] == "--album":
        album = Path(sys.argv[3])
        if album.is_dir():
            process_album(album)
        print_dests()
        return
    # --loose (или без флага): одиночные файлы в корне + уборка пустых папок.
    # Альбомы, оставшиеся после обработки, сюда НЕ переносятся — они лежат
    # во входной папке с записью [PROBLEM] в логе.
    process_root_files(in_music)
    prune_empty(in_music)
    print_dests()


if __name__ == "__main__":
    main()
