#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


def center_crop_square(img):
    width, height = img.size
    side = min(width, height)
    if side <= 0:
        raise ValueError("image has invalid dimensions")
    left = int((width - side) / 2)
    top = int((height - side) / 2)
    return img.crop((left, top, left + side, top + side))


def safe_stem(name):
    stem = Path(name or "photo").stem.lower()
    stem = re.sub(r"[^a-z0-9_-]+", "-", stem).strip("-_")
    return stem or "photo"


def unique_destination(destination, source_name, digest):
    base = "%s-%s" % (safe_stem(source_name), digest[:8])
    path = destination / ("%s.png" % base)
    if not path.exists():
        return path

    for index in range(2, 1000):
        candidate = destination / ("%s-%d.png" % (base, index))
        if not candidate.exists():
            return candidate
    raise RuntimeError("could not allocate unique destination filename")


def open_source_image(source, source_name):
    try:
        img = Image.open(source)
        img.load()
        return img
    except UnidentifiedImageError:
        suffix = Path(source_name or source.name).suffix.lower()
        if suffix not in (".heic", ".heif"):
            raise
        return open_heic_with_heif_convert(source)


def open_heic_with_heif_convert(source):
    heif_convert = shutil.which("heif-convert")
    if not heif_convert:
        raise RuntimeError(
            "HEIC/HEIF photos require heif-convert (apt install libheif-examples)"
        )

    with tempfile.TemporaryDirectory(prefix="vinyltron-heic-") as tmp:
        converted = Path(tmp) / "converted.png"
        result = subprocess.run(
            [heif_convert, str(source), str(converted)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "heif-convert failed (exit %d): %s"
                % (result.returncode, result.stderr.decode("utf-8", "replace").strip())
            )

        # heif-convert appends "-1", "-2", ... to the output stem for
        # multi-image containers (e.g. iPhone "Live Photo" HEIC files with an
        # embedded thumbnail). Prefer the plain name, else the first numbered one.
        if not converted.exists():
            numbered = sorted(converted.parent.glob(converted.stem + "-*" + converted.suffix))
            if not numbered:
                raise RuntimeError("heif-convert did not produce an output file")
            converted = numbered[0]

        with Image.open(converted) as img:
            img.load()
            return img.copy()


def convert_image(source, destination, source_name, size):
    data = source.read_bytes()
    digest = hashlib.sha1(data).hexdigest()
    output = unique_destination(destination, source_name or source.name, digest)

    with open_source_image(source, source_name) as img:
        original_size = img.size
        img = ImageOps.exif_transpose(img).convert("RGB")
        img = center_crop_square(img)
        img = img.resize((size, size), Image.LANCZOS)
        destination.mkdir(parents=True, exist_ok=True)
        img.save(output, format="PNG", optimize=True)

    return {
        "filename": output.name,
        "path": str(output),
        "source_name": source_name or source.name,
        "source_size": list(original_size),
        "size": [size, size],
        "sha1": digest,
    }


def main():
    parser = argparse.ArgumentParser(description="Convert one uploaded Vinyltron idle photo.")
    parser.add_argument("source", help="Temporary uploaded source image")
    parser.add_argument("destination", help="Idle image destination folder")
    parser.add_argument("--source-name", default="", help="Original upload filename")
    parser.add_argument("--size", type=int, default=64, help="Output square size in pixels")
    args = parser.parse_args()

    if args.size <= 0:
        raise SystemExit("--size must be greater than zero")

    result = convert_image(
        Path(args.source).expanduser().resolve(),
        Path(args.destination).expanduser().resolve(),
        args.source_name,
        args.size,
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
