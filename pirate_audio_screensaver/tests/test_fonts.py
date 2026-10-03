from __future__ import annotations

import os
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from volumio_screensaver.config import Config
from volumio_screensaver.display import ClockDisplay
from volumio_screensaver.fonts import (
    FONTS_DIR,
    bundled_font_paths,
    load_font_catalog,
    normalize_enabled_fonts,
    parse_enabled_fonts,
)


class FontSelectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.display = ClockDisplay.__new__(ClockDisplay)

    def test_catalog_covers_every_shipped_font_with_unique_ids(self) -> None:
        catalog = load_font_catalog()
        self.assertEqual(len(catalog), 15)
        self.assertEqual(len({font.id for font in catalog}), len(catalog))
        self.assertEqual(
            {font.filename for font in catalog},
            {path.name for path in FONTS_DIR.iterdir() if path.suffix.lower() in {".ttf", ".otf"}},
        )

    def test_existing_installation_and_constructor_enable_all_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = Config.from_env()
        self.assertIsNone(config.enabled_fonts)
        legacy_fields = dict(vars(config))
        legacy_fields.pop("enabled_fonts")
        self.assertIsNone(Config(**legacy_fields).enabled_fonts)
        paths = self.display._discover_font_paths(config.font_path, config.enabled_fonts)
        self.assertEqual(len(paths), 15)

    def test_environment_subset_excludes_every_unselected_font(self) -> None:
        with patch.dict(os.environ, {"ENABLED_FONTS": " digital-7, poxel ,digital-7 "}, clear=True):
            config = Config.from_env()
        self.assertEqual(config.enabled_fonts, ("digital-7", "poxel"))
        paths = self.display._discover_font_paths(config.font_path, config.enabled_fonts)
        self.assertEqual({path.name for path in paths}, {"digital-7.ttf", "poxel-font.ttf"})
        self.assertEqual(len(paths), 2)

    def test_unknown_ids_are_warned_and_never_enable_other_fonts(self) -> None:
        with self.assertLogs("volumio_screensaver.fonts", level="WARNING") as logs:
            selected = parse_enabled_fonts("unknown-font, poxel, ../DS-DIGI.TTF")
        self.assertEqual(selected, ("poxel",))
        self.assertEqual(len(logs.output), 2)
        self.assertEqual([path.name for path in bundled_font_paths(selected)], ["poxel-font.ttf"])
        with self.assertLogs("volumio_screensaver.fonts", level="WARNING"):
            self.assertEqual(normalize_enabled_fonts(("unknown-font",)), ())
        self.assertEqual(bundled_font_paths(()), [])

    def test_explicit_empty_selection_uses_configured_fallback_with_warning(self) -> None:
        with patch.dict(os.environ, {"ENABLED_FONTS": ""}, clear=True):
            self.assertEqual(Config.from_env().enabled_fonts, ())
        self.assertEqual(parse_enabled_fonts(" , "), ())
        with tempfile.TemporaryDirectory() as directory:
            fallback = Path(directory) / "custom.ttf"
            fallback.touch()
            with self.assertLogs("volumio_screensaver.display", level="WARNING") as logs:
                paths = self.display._discover_font_paths(str(fallback), ())
            self.assertIn(fallback, paths)
            self.assertTrue(all(path.parent != FONTS_DIR for path in paths))
            self.assertTrue(any("fallback" in message for message in logs.output))

    def test_invalid_only_selection_falls_back_instead_of_enabling_all(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fallback = Path(directory) / "custom.ttf"
            fallback.touch()
            with self.assertLogs(level="WARNING"):
                paths = self.display._discover_font_paths(str(fallback), ("unknown-font",))
            self.assertIn(fallback, paths)
            self.assertTrue(all(path.parent != FONTS_DIR for path in paths))

    def test_disabled_bundled_font_cannot_return_through_fallback_path(self) -> None:
        disabled_font = FONTS_DIR / "digital-7.ttf"
        with self.assertLogs("volumio_screensaver.display", level="WARNING"):
            paths = self.display._discover_font_paths(str(disabled_font), ())
        self.assertNotIn(disabled_font, paths)
        self.assertTrue(all(path.parent != FONTS_DIR for path in paths))

    def test_missing_enabled_font_uses_fallback_without_loading_unselected_font(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            empty_fonts_dir = Path(directory) / "fonts"
            empty_fonts_dir.mkdir()
            (empty_fonts_dir / "digital-7.ttf").touch()
            fallback = Path(directory) / "custom.ttf"
            fallback.touch()
            with patch("volumio_screensaver.fonts.FONTS_DIR", empty_fonts_dir):
                with self.assertLogs("volumio_screensaver.display", level="WARNING"):
                    paths = self.display._discover_font_paths(str(fallback), ("poxel",))
            self.assertIn(fallback, paths)
            self.assertNotIn(empty_fonts_dir / "digital-7.ttf", paths)

    def test_random_style_draws_only_from_enabled_pool(self) -> None:
        self.display._font_paths = bundled_font_paths(("digital-7", "poxel"))
        self.display._load_fitted_font = Mock(return_value=object())
        rng = random.Random(1234)
        selected = set()
        for _ in range(100):
            self.display.choose_random_style(rng)
            selected.add(self.display._selected_font_path.name)
        self.assertEqual(selected, {"digital-7.ttf", "poxel-font.ttf"})
        self.assertEqual(self.display._load_fitted_font.call_count, 100)
        self.assertTrue(
            all(call.args[0] in self.display._font_paths for call in self.display._load_fitted_font.call_args_list)
        )

    def test_no_font_paths_uses_pillow_default_and_keeps_color_changes(self) -> None:
        self.display._font_paths = []
        self.display._selected_font_path = None
        self.display._font_cls = Mock()
        with self.assertLogs("volumio_screensaver.display", level="WARNING"):
            font = self.display._load_font(None, 58)
        self.assertIs(font, self.display._font_cls.load_default.return_value)
        self.display._font = font
        self.display.choose_random_style(random.Random(42))
        self.assertIs(self.display._font, font)
        self.assertTrue(all(component >= 96 for component in self.display._font_color))


if __name__ == "__main__":
    unittest.main()
