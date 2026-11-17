#!/usr/bin/env python3
# find_cover.py <album_dir>
# Ищет обложку рекурсивно, приводит к квадрату 1000-1024 px,
# сохраняет как <album_dir>/.cover.png|jpg (что меньше) и печатает путь.
import sys
from pathlib import Path

from PIL import Image

from common import IMAGE_EXTS, rm

COVER_STEMS = {"cover", "folder", "front", "album", "albumart"}
MIN_SIDE, MAX_SIDE = 1000, 1024
CROP_HALF = "right"            # какая половина у разворота 2:1 — лицевая сторона
LANCZOS = getattr(Image, "Resampling", Image).LANCZOS


def classify(path):
    try:
        with Image.open(path) as im:
            w, h = im.size
    except Exception:
        return None
    if min(w, h) == 0:
        return None
    ratio = max(w, h) / min(w, h)
    is_1to1 = 0.95 <= ratio <= 1.05
    is_2to1 = 1.90 <= ratio <= 2.10
    is_jpg = path.suffix.lower() in (".jpg", ".jpeg")
    named = path.stem.lower() in COVER_STEMS
    if   named and is_1to1 and is_jpg: prio = 0
    elif named and is_1to1:            prio = 1
    elif named and is_2to1:            prio = 2
    elif is_1to1 and is_jpg:           prio = 3
    elif is_1to1:                      prio = 4
    elif is_2to1:                      prio = 5
    elif named:                        prio = 6      # любой формат, но с «обложечным» именем
    else:
        return None                                  # случайные картинки не берём
    return (prio, -(w * h), str(path), w, h)


def find_cover(album):
    scored = []
    for p in album.rglob("*"):
        if (p.is_file() and not p.name.startswith(".")
                and p.suffix.lower() in IMAGE_EXTS):
            c = classify(p)
            if c:
                scored.append(c)
    return min(scored) if scored else None


def crop_to_square(im):
    w, h = im.size
    ratio = max(w, h) / min(w, h)
    if w > h and 1.90 <= ratio <= 2.10:
        left = 0 if CROP_HALF == "left" else w - h
        return im.crop((left, 0, left + h, h))
    if w != h:
        m = min(w, h)
        l, t = (w - m) // 2, (h - m) // 2
        return im.crop((l, t, l + m, t + m))
    return im


def flatten_rgb(im):
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


# EXIF-ориентация -> операция, которая делает картинку «правильной» (как её показывает просмотрщик)
EXIF_FIX = {2: Image.FLIP_LEFT_RIGHT, 3: Image.ROTATE_180, 4: Image.FLIP_TOP_BOTTOM,
            5: Image.TRANSPOSE, 6: Image.ROTATE_270, 7: Image.TRANSVERSE,
            8: Image.ROTATE_90}


def apply_orientation(im, orientation):
    op = EXIF_FIX.get(orientation)
    return im.transpose(op) if op is not None else im


def standardize(src, album):
    with Image.open(src) as im:
        try:
            orientation = im.getexif().get(0x0112, 1)   # скан «лёжа» с пометкой поворота
        except Exception:                               # noqa: BLE001
            orientation = 1
        # Сначала вырезаем нужную половину/квадрат в исходных координатах
        # (как и раньше), и только потом поворачиваем вырезку в правильное положение.
        im = apply_orientation(crop_to_square(flatten_rgb(im)), orientation)
        side = max(MIN_SIDE, min(im.width, MAX_SIDE))
        if im.width != side:
            im = im.resize((side, side), LANCZOS)
        out_png = album / ".cover.png"
        out_jpg = album / ".cover.jpg"
        im.save(out_png, "PNG", optimize=True)
        im.save(out_jpg, "JPEG", quality=90, optimize=True)
    if out_png.stat().st_size <= out_jpg.stat().st_size:
        rm(out_jpg)
        return out_png
    rm(out_png)
    return out_jpg


def main():
    album = Path(sys.argv[1])
    found = find_cover(album)
    if found:
        print(standardize(Path(found[2]), album))


if __name__ == "__main__":
    main()
