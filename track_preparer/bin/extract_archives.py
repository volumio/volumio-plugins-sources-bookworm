#!/usr/bin/env python3
# extract_archives.py <in_music_dir>
# ПЕРВЫЙ шаг конвейера (до планирования папок). Ищет во входной папке файлы-контейнеры
# с расширениями .iso.wv / .zip / .iso и распаковывает их в соседнюю папку <имя>/:
#   * тип определяется по СОДЕРЖИМОМУ, а не по расширению: "Album.iso.wv", который на
#     самом деле zip, распаковывается (то же самое, что переименовать в .zip);
#   * настоящий WavPack-образ (сигнатура "wvpk") не трогается — его конвертирует unpack_images;
#   * ISO9660 распаковывается через 7z/bsdtar, если они установлены;
#   * имена внутри zip без флага UTF-8 (cp437-"кракозябры" от Windows) восстанавливаются
#     (cp866/cp1251), опасные пути (../, абсолютные) отбрасываются, символы,
#     запрещённые на NTFS/exFAT/FAT, заменяются на "_";
#   * архив удаляется только после проверки числа и размеров извлечённых файлов;
#   * вложенные архивы распаковываются повторно (до 3 проходов).
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from common import (cancel_requested, natural_key, note, problem, progress,
                    safe_filename, visible_dirs)

EXTS = (".iso.wv", ".zip", ".iso")
MAX_PASSES = 3


def kind_of(path):
    """'zip' | 'iso' | 'wavpack' | None — по сигнатуре файла."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(4)
            if head[:2] == b"PK" and head[2:4] in (b"\x03\x04", b"\x05\x06"):
                return "zip"
            if head == b"wvpk":
                return "wavpack"
            fh.seek(0x8001)
            if fh.read(5) == b"CD001":
                return "iso"
            fh.seek(0)
            sample = fh.read(8192)
            if (b"\x00" not in sample and re.search(rb"(?im)^\s*TRACK\s+\d+\s+AUDIO", sample)
                    and re.search(rb"(?im)^\s*INDEX\s+01", sample)):
                return "cue"                     # текстовый cue с «чужим» расширением
    except OSError:
        pass
    return None


def candidates(root):
    out = []
    for p in root.rglob("*"):
        try:
            if (p.is_file() and not p.name.startswith(".")
                    and p.name.lower().endswith(EXTS)):
                out.append(p)
        except OSError:
            continue
    return sorted(out, key=natural_key)


def stem_of(p):
    n = p.name
    for e in EXTS:
        if n.lower().endswith(e):
            return n[: -len(e)] or "archive"
    return p.stem


def fix_name(info):
    """Имя файла из zip -> нормальная строка (UTF-8 / cp866 / cp1251)."""
    name = info.filename
    if info.flag_bits & 0x800:
        return name
    try:
        raw = name.encode("cp437")
    except UnicodeEncodeError:
        return name
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass
    for enc in ("cp866", "cp1251"):
        txt = raw.decode(enc, errors="replace")
        # cp1251-текст, прочитанный как cp866, даёт символы псевдографики
        if enc == "cp866" and re.search(r"[\u2500-\u257f]", txt):
            continue
        return txt
    return name


def clean_parts(name):
    parts = []
    for part in name.replace("\\", "/").split("/"):
        if part in ("", ".", ".."):
            continue
        parts.append(safe_filename(part, "_"))
    return parts


def unique_dir(parent, name):
    d = parent / safe_filename(name, "archive")
    n = 1
    while d.exists():
        d = parent / f"{safe_filename(name, 'archive')}_{n}"
        n += 1
    return d


def extract_zip(arc, dest):
    with zipfile.ZipFile(str(arc)) as z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        need = sum(i.file_size for i in infos)
        free = shutil.disk_usage(str(dest.parent)).free
        if need * 1.05 > free:
            raise OSError(f"not enough disk space: need {need >> 20} MB, free {free >> 20} MB")
        dest.mkdir(parents=True)
        written = {}
        for i in infos:
            parts = clean_parts(fix_name(i))
            if not parts:
                continue
            target = dest.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():                      # одинаковые имена после чистки
                target = target.with_name(f"{target.stem}_{len(written)}{target.suffix}")
            with z.open(i) as src, open(str(target), "wb") as out:
                shutil.copyfileobj(src, out, 1 << 20)
            written[target] = i.file_size
    bad = [t.name for t, size in written.items()
           if not t.is_file() or t.stat().st_size != size]
    if bad:
        raise OSError(f"size check failed: {bad[0]}")
    return len(written)


def extract_iso(arc, dest):
    tool = next((t for t in ("7z", "7za", "7zr") if shutil.which(t)), None)
    if tool:
        cmd = [tool, "x", "-y", f"-o{dest}", str(arc)]
    elif shutil.which("bsdtar"):
        dest.mkdir(parents=True)
        cmd = ["bsdtar", "-xf", str(arc), "-C", str(dest)]
    else:
        raise OSError("ISO image found, but neither 7z nor bsdtar is installed "
                      "(apt-get install p7zip-full)")
    r = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise OSError((r.stderr or r.stdout).strip()[-300:] or f"{cmd[0]} failed")
    return sum(1 for p in dest.rglob("*") if p.is_file())


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    root = Path(sys.argv[1])
    if not root.is_dir():
        return
    total = 0
    # cue, у которого расширение .iso.wv/.zip/.iso (например "Album.cue.iso.wv") -> "Album.cue"
    for p in candidates(root):
        if kind_of(p) == "cue":
            name = stem_of(p)
            dst = p.with_name(name if name.lower().endswith(".cue") else name + ".cue")
            if not dst.exists():
                p.rename(dst)
                note(f"cue with wrong extension renamed: {p.name} -> {dst.name}")
    failed = set()                               # неудачные архивы не пробуем повторно
    for _ in range(MAX_PASSES):
        found = [(p, kind_of(p)) for p in candidates(root) if str(p) not in failed]
        found = [(p, k) for p, k in found if k in ("zip", "iso")]
        if not found:
            break
        for i, (arc, kind) in enumerate(found):
            if cancel_requested():
                note("stopped on request")
                return
            progress(i=i, n=len(found), file=arc.name)
            dest = unique_dir(arc.parent, stem_of(arc))
            try:
                n = extract_zip(arc, dest) if kind == "zip" else extract_iso(arc, dest)
                if n == 0:
                    raise OSError("archive is empty")
                arc.unlink()
                total += 1
                print(f"✓ {arc.name} ({kind}) -> {dest.name}/ ({n} files)")
            except Exception as e:                        # noqa: BLE001
                shutil.rmtree(str(dest), ignore_errors=True)
                failed.add(str(arc))
                problem(f"extract {arc}: {type(e).__name__}: {e} — archive kept")
    if total:
        note(f"archives extracted: {total}")


if __name__ == "__main__":
    main()
