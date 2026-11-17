#!/usr/bin/env python3
"""Общие настройки и утилиты для всех скриптов Track Preparer."""
import errno
import shutil
import json
import os
import re
import sys
import time
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent


def _path(env, default):
    return Path(os.environ.get(env) or default)


# Пути задаются из index.js через переменные окружения (настройки в UI).
IN_MUSIC      = _path("TP_IN_MUSIC",      "/mnt/HDD/in/music")
OUT_MUSIC     = _path("TP_OUT_MUSIC",     "/mnt/HDD/out/music")
LOG_DIR       = _path("TP_LOG_DIR",       PLUGIN_DIR / "log")
LOG_FILE      = LOG_DIR / "errors.log"
STATUS_FILE   = _path("TP_STATUS_FILE", LOG_DIR / "status.json")   # состояние для окна выполнения
RUN_LOG       = _path("TP_RUN_LOG",     LOG_DIR / "run.log")       # живой лог текущего запуска
CANCEL_FLAG   = _path("TP_CANCEL_FLAG", LOG_DIR / "cancel.flag")    # «остановить после шага»
LOG_MAX_BYTES = 1_000_000

DISC        = re.compile(r"^(cd|disc|disk|d)[\s._-]*\d+$", re.I)
# суффикс "(Disc 1)" / "[CD2]" в теге album: общий для sort_library и replaygain
DISC_SUFFIX = re.compile(r"\s*[\(\[]\s*(?:cd|disc|disk|диск)\s*\d+\s*[\)\]]\s*$", re.I)
MUSIC_EXTS  = (".flac", ".mp3")
IMAGE_EXTS  = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp")
# Любое аудио: нужно, чтобы НИЧЕГО не удалить по ошибке
ANY_AUDIO   = {".flac", ".mp3", ".wav", ".ape", ".wv", ".m4a", ".m4b", ".aac",
               ".ogg", ".oga", ".opus", ".wma", ".ac3", ".dts", ".aiff", ".aif",
               ".tta", ".mpc", ".mp2", ".mka", ".shn"}

PROBLEM = "[PROBLEM]"   # строки с этим маркером считаются в итоговом тосте


def _write(line):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if LOG_FILE.exists() and LOG_FILE.stat().st_size > LOG_MAX_BYTES:
        old = LOG_FILE.with_suffix(".log.1")
        if old.exists():
            old.unlink()
        LOG_FILE.replace(old)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")


def note(msg):
    """Информационная запись: в лог и на stdout."""
    _write(f"[INFO] {msg}")
    print("·", msg)
    sys.stdout.flush()


def problem(msg):
    """Проблема (файл пропущен / не обработан): учитывается в тосте."""
    _write(f"{PROBLEM} {msg}")
    print("✖", msg)
    sys.stdout.flush()


def advice(msg):
    """Рекомендация пользователю (не ошибка и не в счётчике проблем):
    в лог ([ADVICE]) и в окно выполнения (строка с ⚠, янтарная)."""
    _write(f"[ADVICE] {msg}")
    print("⚠", msg)
    sys.stdout.flush()


def progress(i=None, n=None, file=None):
    """Сообщить оркестратору о ходе работы (строка вида @@{json})."""
    d = {}
    if i is not None and n:
        d["i"], d["n"] = i, n
    if file is not None:
        d["file"] = file
    print("@@" + json.dumps(d, ensure_ascii=False))
    sys.stdout.flush()


def cancel_requested():
    return CANCEL_FLAG.exists()


def rm(path):
    """unlink без ошибки, если файла уже нет."""
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass


def safe_filename(s, default="Track"):
    """Имя файла, допустимое и на ext4, и на NTFS/exFAT/FAT (/mnt/HDD часто такой):
    без \\ / : * ? " < > |, управляющих символов, хвостовых точек и пробелов."""
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", s or "")
    s = s.strip().rstrip(". ")
    return s or default


def safe_move(src, dst):
    """Перенос файла, устойчивый к разным файловым системам.
    Та же ФС — обычное переименование. Другая ФС (EXDEV) — копирование только
    данных (shutil.copyfile, БЕЗ copystat: на FAT/exFAT/NTFS chmod/utime часто
    падают с PermissionError, и shutil.move бросал дубль в назначении, а
    оригинал оставлял), проверка размера, и лишь потом удаление оригинала."""
    src, dst = Path(src), Path(dst)
    try:
        os.rename(str(src), str(dst))
        return
    except OSError as e:
        if e.errno != errno.EXDEV:
            raise
    size = src.stat().st_size
    tmp = dst.with_name(f".tp_{os.getpid()}.part")
    try:
        shutil.copyfile(str(src), str(tmp))
        if tmp.stat().st_size != size:
            raise OSError("size mismatch after copy")
        os.replace(str(tmp), str(dst))
    except BaseException:
        rm(tmp)
        raise
    try:                                   # время изменения — по возможности
        st = src.stat()
        os.utime(str(dst), (st.st_atime, st.st_mtime))
    except OSError:
        pass
    src.unlink()


def natural_key(p):
    s = p.name if hasattr(p, "name") else str(p)
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def safe_target(dir_path, name):
    """name -> name, либо name(01).ext, name(02).ext ... Никогда не затирает."""
    dst = Path(dir_path) / name
    if not dst.exists():
        return dst
    stem, suf = dst.stem, dst.suffix
    for n in range(1, 100):
        cand = Path(dir_path) / f"{stem}({n:02d}){suf}"
        if not cand.exists():
            return cand
    return None


def audio_files(d, exts=MUSIC_EXTS):
    """Файлы нужных форматов прямо в папке d (без скрытых), в естественном порядке."""
    return sorted((p for p in Path(d).iterdir()
                   if p.is_file() and not p.name.startswith(".")
                   and p.suffix.lower() in exts), key=natural_key)


def leftover_audio(d):
    """Любое аудио (любых форматов, на любой глубине) внутри d."""
    return [p for p in Path(d).rglob("*")
            if p.is_file() and not p.name.startswith(".")
            and p.suffix.lower() in ANY_AUDIO]


def visible_dirs(d):
    return sorted((p for p in Path(d).iterdir()
                   if p.is_dir() and not p.name.startswith(".")), key=natural_key)


def set_easy_tags(path, **tags):
    """Записать простые теги (title, tracknumber, ...) в flac/mp3."""
    from mutagen import File as MutagenFile
    m = MutagenFile(str(path), easy=True)
    if m is None:
        raise RuntimeError("unsupported file")
    if m.tags is None:
        m.add_tags()
    for k, v in tags.items():
        m[k] = [str(v)]
    m.save()


def get_easy_tag(path, key):
    from mutagen import File as MutagenFile
    try:
        m = MutagenFile(str(path), easy=True)
        v = m.get(key) if m else None
        if isinstance(v, list):
            v = v[0] if v else None
        return str(v).strip() if v else ""
    except Exception:
        return ""
