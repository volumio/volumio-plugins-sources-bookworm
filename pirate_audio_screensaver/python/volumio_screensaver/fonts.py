from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

LOGGER = logging.getLogger(__name__)
FONTS_DIR = Path(__file__).resolve().parent / "fonts"
FONT_CATALOG_PATH = FONTS_DIR / "catalog.json"


@dataclass(frozen=True)
class BundledFont:
    id: str
    filename: str
    label: str


@lru_cache(maxsize=1)
def load_font_catalog() -> tuple[BundledFont, ...]:
    """Read the same stable font IDs used by the plugin settings and previews."""
    with FONT_CATALOG_PATH.open(encoding="utf-8") as source:
        entries = json.load(source)
    fonts = tuple(BundledFont(**entry) for entry in entries)
    ids = [font.id for font in fonts]
    if len(ids) != len(set(ids)):
        raise ValueError("Bundled font catalog contains duplicate IDs")
    for font in fonts:
        if Path(font.filename).name != font.filename:
            raise ValueError("Bundled font catalog filenames must not contain paths")
    return fonts


def normalize_enabled_fonts(
    enabled_fonts: tuple[str, ...] | None,
) -> tuple[str, ...] | None:
    """Keep known selections; None preserves the pre-selection default of all fonts."""
    if enabled_fonts is None:
        return None
    known_ids = {font.id for font in load_font_catalog()}
    valid_ids = []
    for font_id in enabled_fonts:
        if font_id not in known_ids:
            LOGGER.warning("Ignoring unknown enabled clock font ID: %s", font_id)
        elif font_id not in valid_ids:
            valid_ids.append(font_id)
    return tuple(valid_ids)


def parse_enabled_fonts(value: str | None) -> tuple[str, ...] | None:
    """Absent environment value means all; an explicit empty value means none."""
    if value is None:
        return None
    return normalize_enabled_fonts(
        tuple(part.strip() for part in value.split(",") if part.strip())
    )


def bundled_font_paths(enabled_fonts: tuple[str, ...] | None = None) -> list[Path]:
    selected_ids = normalize_enabled_fonts(enabled_fonts)
    return [
        FONTS_DIR / font.filename
        for font in load_font_catalog()
        if (selected_ids is None or font.id in selected_ids)
        and (FONTS_DIR / font.filename).is_file()
    ]


def is_disabled_bundled_font(
    path: Path, enabled_fonts: tuple[str, ...] | None
) -> bool:
    """Prevent a fallback path from bypassing a disabled bundled font switch."""
    if enabled_fonts is None:
        return False
    resolved_path = path.resolve()
    return any(
        font.id not in enabled_fonts
        and (FONTS_DIR / font.filename).resolve() == resolved_path
        for font in load_font_catalog()
    )
