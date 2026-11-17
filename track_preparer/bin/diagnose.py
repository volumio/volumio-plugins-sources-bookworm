#!/usr/bin/env python3
# diagnose.py [входная_папка] [выходная_папка]
# Самопроверка окружения Volumio: версии, инструменты, замер громкости,
# запись тегов, файловая система входной/выходной папок.
# Запуск:  python3 diagnose.py /mnt/HDD/in/music /mnt/HDD/out/music
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
OK, BAD = "[ OK ]", "[FAIL]"


def sh(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError:
        return 127, ""


def line(ok, msg):
    print(f"{OK if ok else BAD} {msg}")
    return ok


def tool(name, opt="-version"):
    path = shutil.which(name)
    if not path:
        return line(False, f"{name}: не найден")
    rc, out = sh([name, opt])
    first = out.strip().splitlines()[0] if out.strip() else ""
    return line(True, f"{name}: {first[:90]}")


def check_python():
    print(f"Python {sys.version.split()[0]}")
    for mod in ("mutagen", "PIL"):
        try:
            m = __import__(mod)
            v = getattr(m, "version_string", None) or getattr(m, "__version__", "?")
            line(True, f"модуль {mod} {v}")
        except ImportError:
            line(False, f"модуль {mod} НЕ установлен (pip3 install {'mutagen' if mod=='mutagen' else 'pillow'})")


def check_ffmpeg():
    tool("ffmpeg"); tool("ffprobe")
    for name in ("shnsplit", "flac", "metaflac"):
        p = shutil.which(name)
        line(bool(p), f"{name}: {'есть' if p else 'нет (необязателен для shnsplit/metaflac; резка пойдёт через ffmpeg)'}")
    p = next((x for x in ("7z", "7za", "bsdtar") if shutil.which(x)), None)
    line(bool(p), "распаковщик ISO: " + (p if p else "нет (zip распаковывается и без него; настоящие .iso — нет)"))
    _, flt = sh(["ffmpeg", "-hide_banner", "-filters"])
    for f in ("ebur128", "astats", "volumedetect", "silencedetect"):
        line(bool(re.search(rf"\b{f}\b", flt)), f"фильтр {f}")
    _, enc = sh(["ffmpeg", "-hide_banner", "-encoders"])
    for e in ("flac", "libmp3lame"):
        line(bool(re.search(rf"\b{e}\b", enc)), f"кодировщик {e}")
    _, dec = sh(["ffmpeg", "-hide_banner", "-decoders"])
    for d in ("ape", "wavpack", "tta", "alac", "aac", "vorbis", "opus"):
        line(bool(re.search(rf"\b{d}\b", dec)), f"декодер {d}")


def selftest(tmp):
    import replaygain as rg
    from common import get_easy_tag
    flac, mp3 = tmp / "t.flac", tmp / "t.mp3"
    for f, extra in ((flac, []), (mp3, ["-c:a", "libmp3lame"])):
        rc, out = sh(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                      "sine=f=440:d=3:r=44100", "-af", "volume=0.3", "-ac", "2", *extra, str(f)])
        if not line(rc == 0 and f.exists(), f"создан тестовый {f.suffix}: {out.strip()[-120:]}"):
            return
    for f in (flac, mp3):
        res = rg.measure_file(f)
        if res is None:
            line(False, f"замер громкости {f.suffix}: не удался: {rg.measure.last_error[-200:]}")
            continue
        lufs, peak = res
        line(True, f"замер громкости {f.suffix}: {lufs} LUFS, пик {'не определён' if peak is None else round(peak, 6)}")
        try:
            rg.write_tags(f, {"REPLAYGAIN_TRACK_GAIN": rg.fmt_gain(rg.REF_LUFS - lufs),
                              "REPLAYGAIN_REFERENCE_LOUDNESS": "-18.00 LUFS"})
            from mutagen import File
            m = File(str(f))
            keys = [k for k in m.tags.keys() if "REPLAYGAIN" in k.upper()]
            line(bool(keys), f"запись ReplayGain-тегов {f.suffix}: {keys}")
        except Exception as e:                           # noqa: BLE001
            line(False, f"запись ReplayGain-тегов {f.suffix}: {type(e).__name__}: {e}")


def selftest_e2e(tmp):
    """Весь путь ReplayGain как в конвейере: flac со ВСТРОЕННОЙ ОБЛОЖКОЙ и «мусорными» старыми
    тегами (-18.00 dB, album gain, без пиков) + mp3 -> process_folder -> чтение тегов."""
    import replaygain as rg
    alb = tmp / "alb"
    alb.mkdir(exist_ok=True)
    fl, mp = alb / "a.flac", alb / "b.mp3"
    for f, extra in ((fl, ["-sample_fmt", "s16"]), (mp, ["-c:a", "libmp3lame"])):
        rc, out = sh(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                      "anoisesrc=d=5:c=pink:r=44100:a=0.2", "-ac", "2", *extra, str(f)])
        if not line(rc == 0 and f.exists(), f"e2e: создан {f.name}: {out.strip()[-100:]}"):
            return
    try:
        from mutagen.flac import FLAC, Picture
        from PIL import Image
        import io
        buf = io.BytesIO()
        Image.new("RGB", (600, 600), (90, 30, 30)).save(buf, "JPEG")
        a = FLAC(str(fl))
        pic = Picture()
        pic.type, pic.mime, pic.width, pic.height, pic.depth = 3, "image/jpeg", 600, 600, 24
        pic.data = buf.getvalue()
        a.add_picture(pic)
        a["REPLAYGAIN_TRACK_GAIN"] = ["-18.00 dB"]
        a["REPLAYGAIN_ALBUM_GAIN"] = ["-18.00 dB"]
        a["REPLAYGAIN_REFERENCE_LOUDNESS"] = ["-18.00 LUFS"]
        a.save()
    except Exception as e:                               # noqa: BLE001
        line(False, f"e2e: подготовка flac с обложкой: {type(e).__name__}: {e}")
        return
    res = rg.process_folder(alb, on_step=lambda *a: None)
    line(res == (2, 2), f"e2e: process_folder -> {res} (ожидалось (2, 2))")
    for f in (fl, mp):
        vals = {k: rg.read_tag(f, k) for k in ("REPLAYGAIN_TRACK_GAIN", "REPLAYGAIN_TRACK_PEAK",
                                               "REPLAYGAIN_ALBUM_GAIN")}
        good = (vals["REPLAYGAIN_TRACK_GAIN"] not in ("", "-18.00 dB")
                and vals["REPLAYGAIN_TRACK_PEAK"] != "" and vals["REPLAYGAIN_ALBUM_GAIN"] == "")
        line(good, f"e2e {f.suffix}: gain={vals['REPLAYGAIN_TRACK_GAIN']!r} "
                   f"peak={vals['REPLAYGAIN_TRACK_PEAK']!r} album_gain={vals['REPLAYGAIN_ALBUM_GAIN']!r}"
                   + ("" if good else "  <- ОЖИДАЛОСЬ: gain не -18.00, пик есть, album gain удалён"))


def check_dir(label, d):
    d = Path(d)
    if not d.is_dir():
        line(False, f"{label}: папки нет: {d}")
        return
    _, df = sh(["df", "-T", str(d)])
    fs = df.strip().splitlines()[-1].split()[1] if len(df.strip().splitlines()) > 1 else "?"
    line(True, f"{label}: {d} (файловая система: {fs})")
    t = d / ".tp_diag.tmp"
    try:
        t.write_text("x"); t.unlink()
        line(True, f"{label}: запись разрешена")
    except OSError as e:
        line(False, f"{label}: запись запрещена: {e}")
        return
    a, b = d / ".tp_diag_a.tmp", d / ".tp_diag_b.tmp"
    try:
        a.write_text("x"); a.rename(b); b.unlink()
        line(True, f"{label}: переименование работает")
    except OSError as e:
        line(False, f"{label}: переименование: {e}")
    c = d / ".tp_diag: colon?.tmp"
    try:
        c.write_text("x"); c.unlink()
        line(True, f"{label}: символы ':' '?' в именах допустимы")
    except OSError:
        line(True, f"{label}: символы ':' '?' в именах НЕДОПУСТИМЫ (NTFS/exFAT/FAT) — плагин заменяет их на '_'")


def main():
    print("=== Track Preparer: диагностика ===")
    check_python()
    check_ffmpeg()
    tmp = Path(tempfile.mkdtemp(prefix="tp_diag_"))
    try:
        selftest(tmp)
        selftest_e2e(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if len(sys.argv) > 1:
        check_dir("вход", sys.argv[1])
    if len(sys.argv) > 2:
        check_dir("выход", sys.argv[2])
    print("=== конец ===")


if __name__ == "__main__":
    main()
