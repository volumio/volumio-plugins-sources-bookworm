#!/usr/bin/env python3
"""Build RGB565 splash frames for /dev/fb1 (320x240).

Maintainer tool — output is committed under assets/splash/*.raw and shipped
with the plugin (no runtime generation on device).

Requires: Pillow (pip install Pillow)
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)

WIDTH = 320
HEIGHT = 240
FRAME_SIZE = WIDTH * HEIGHT * 2
STATUS_Y = 208
STATUS_FONT_SIZE = 14

PLUGIN_DIR = Path(__file__).resolve().parent.parent
SPLASH_DIR = PLUGIN_DIR / "assets" / "splash"
LOGO_PATH = SPLASH_DIR / "volumio-logo.png"

FRAMES = (
    ("boot", "Booting..."),
    ("starting", "Starting..."),
    ("shutdown", "Shutting down..."),
    ("reboot", "Restarting..."),
)


def rgb888_to_rgb565(rgba: bytes) -> bytes:
    """Match native/rgb565/rgb565.cpp conversion."""
    out = bytearray(len(rgba) // 2)
    j = 0
    half = len(out) // 2
    for i in range(0, len(rgba), 4):
        r, g, b = rgba[i], rgba[i + 1], rgba[i + 2]
        rgb565 = (r >> 3) | ((g >> 2) << 5) | ((b >> 3) << 11)
        if j < half:
            out[j * 2 : j * 2 + 2] = struct.pack("<H", rgb565)
        j += 1
    return bytes(out)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render_frame(text: str) -> Image.Image:
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 255))

    if LOGO_PATH.is_file():
        logo = Image.open(LOGO_PATH).convert("RGBA")
        max_w = WIDTH - 40
        max_h = HEIGHT - 80
        scale = min(max_w / logo.width, max_h / logo.height, 1.0)
        new_size = (max(1, int(logo.width * scale)), max(1, int(logo.height * scale)))
        logo = logo.resize(new_size, Image.Resampling.LANCZOS)
        x = (WIDTH - logo.width) // 2
        y = (HEIGHT - logo.height) // 2 - 16
        img.paste(logo, (x, y), logo)
    else:
        draw = ImageDraw.Draw(img)
        font = load_font(28)
        draw.text((WIDTH // 2, HEIGHT // 2 - 20), "VOLUMIO", fill=(255, 255, 255, 255), anchor="mm", font=font)

    draw = ImageDraw.Draw(img)
    font = load_font(STATUS_FONT_SIZE)
    draw.text((WIDTH // 2, STATUS_Y), text, fill=(255, 255, 255, 255), anchor="mb", font=font)
    return img


def main() -> int:
    if not LOGO_PATH.is_file():
        print(f"Warning: logo missing at {LOGO_PATH}", file=sys.stderr)

    SPLASH_DIR.mkdir(parents=True, exist_ok=True)

    for name, label in FRAMES:
        img = render_frame(label)
        raw = rgb888_to_rgb565(img.tobytes())
        out = SPLASH_DIR / f"{name}.raw"
        out.write_bytes(raw)
        print(f"[splash] Wrote {out} ({len(raw)} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
