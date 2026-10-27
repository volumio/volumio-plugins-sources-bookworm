#!/usr/bin/env python3
"""Build the bundled font previews (development tool; requires Pillow).

Run from any directory with:
    python tools/generate_font_previews.py

The plugin uses the generated files directly and does not run this tool.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PLUGIN_DIR = Path(__file__).resolve().parents[1]
FONT_DIR = PLUGIN_DIR / "python" / "volumio_screensaver" / "fonts"
PREVIEW_SIZE = (280, 100)
PREVIEW_PADDING = 16
PREVIEW_TEXT = "12:34"


def read_catalog() -> list[dict[str, str]]:
    catalog = json.loads((FONT_DIR / "catalog.json").read_text(encoding="utf-8"))
    if not isinstance(catalog, list) or not catalog:
        raise ValueError("Font catalog must be a non-empty array")
    seen_ids: set[str] = set()
    for entry in catalog:
        if not isinstance(entry, dict):
            raise ValueError("Each font catalog entry must be an object")
        font_id = entry.get("id", "")
        filename = entry.get("filename", "")
        label = entry.get("label", "")
        if not isinstance(font_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", font_id):
            raise ValueError(f"Invalid font ID: {font_id!r}")
        if font_id in seen_ids:
            raise ValueError(f"Duplicate font ID: {font_id}")
        seen_ids.add(font_id)
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise ValueError(f"Invalid font filename for {font_id}")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"Missing font label for {font_id}")
        if not (FONT_DIR / filename).is_file():
            raise FileNotFoundError(FONT_DIR / filename)
    return catalog


def render_preview(font_path: Path) -> Image.Image:
    image = Image.new("RGB", PREVIEW_SIZE, "black")
    draw = ImageDraw.Draw(image)
    max_width = PREVIEW_SIZE[0] - 2 * PREVIEW_PADDING
    max_height = PREVIEW_SIZE[1] - 2 * PREVIEW_PADDING
    lower, upper = 1, 512
    best_font = None
    best_bbox = None

    # Fit the ink bounds, including fonts whose glyphs extend above the
    # baseline or to the left of their nominal origin.
    while lower <= upper:
        size = (lower + upper) // 2
        font = ImageFont.truetype(str(font_path), size=size)
        bbox = draw.textbbox((0, 0), PREVIEW_TEXT, font=font)
        width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if width <= max_width and height <= max_height:
            best_font, best_bbox = font, bbox
            lower = size + 1
        else:
            upper = size - 1

    if best_font is None or best_bbox is None:
        raise ValueError(f"Unable to fit preview for {font_path.name}")
    width = best_bbox[2] - best_bbox[0]
    height = best_bbox[3] - best_bbox[1]
    if width <= 0 or height <= 0:
        raise ValueError(f"Font has no visible clock glyphs: {font_path.name}")
    x = (PREVIEW_SIZE[0] - width) // 2 - best_bbox[0]
    y = (PREVIEW_SIZE[1] - height) // 2 - best_bbox[1]
    draw.text((x, y), PREVIEW_TEXT, font=best_font, fill="white")
    return image


def gallery_html(catalog: list[dict[str, str]]) -> str:
    cards = []
    for entry in catalog:
        label = html.escape(entry["label"])
        font_id = html.escape(entry["id"], quote=True)
        cards.append(
            f'      <figure><img src="{font_id}.png" width="280" height="100" '
            f'alt="12:34 — {label}"><figcaption>{label}</figcaption></figure>'
        )
    return """<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Polices de l’horloge — Pirate Audio Screensaver</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 20px; background: #121518; color: #f5f7fa;
           font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1000px; margin: auto; }
    h1 { font-size: clamp(24px, 4vw, 34px); line-height: 1.2; margin: 0 0 12px; }
    p { margin: 0 0 24px; color: #bfc8d0; line-height: 1.6; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
               gap: 16px; }
    figure { margin: 0; border: 1px solid #35414a; border-radius: 12px; overflow: hidden;
             background: #000; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 14 / 5; object-fit: contain; }
    figcaption { padding: 12px 16px; background: #20262c; font-weight: 600; line-height: 1.4; }
    @media (max-width: 320px) { body { padding: 20px 12px; } .gallery { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Polices de l’horloge</h1>
    <p>Un aperçu « 12:34 » de chaque police incluse. Retrouvez leurs interrupteurs
       dans les réglages du plugin pour choisir celles que l’horloge peut utiliser.</p>
    <div class="gallery">
""" + "\n".join(cards) + """
    </div>
  </main>
</body>
</html>
"""


def save_contact_sheet(catalog: list[dict[str, str]], output_dir: Path, path: Path) -> None:
    columns = 3
    card_width, card_height = 300, 140
    rows = (len(catalog) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * card_width, rows * card_height), "#121518")
    draw = ImageDraw.Draw(sheet)
    label_font = ImageFont.load_default(size=17)
    for index, entry in enumerate(catalog):
        x, y = (index % columns) * card_width, (index // columns) * card_height
        with Image.open(output_dir / f"{entry['id']}.png") as preview:
            sheet.paste(preview, (x + 10, y + 5))
        draw.text((x + 14, y + 111), entry["label"], font=label_font, fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=PLUGIN_DIR / "previews")
    parser.add_argument("--contact-sheet", type=Path, help="Optional QA sheet, outside packaged previews")
    args = parser.parse_args()
    catalog = read_catalog()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for entry in catalog:
        preview = render_preview(FONT_DIR / entry["filename"])
        preview.save(args.output_dir / f"{entry['id']}.png", optimize=True)
    (args.output_dir / "index.html").write_text(gallery_html(catalog), encoding="utf-8", newline="\n")
    if args.contact_sheet:
        save_contact_sheet(catalog, args.output_dir, args.contact_sheet)
    print(f"Generated {len(catalog)} font previews in {args.output_dir}")


if __name__ == "__main__":
    main()
