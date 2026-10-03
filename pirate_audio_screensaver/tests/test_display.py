from __future__ import annotations

import random
import unittest

from volumio_screensaver.display import MIN_COLOR_LUMINANCE, bundled_font_paths, random_visible_color


class DisplayTest(unittest.TestCase):
    def test_bundled_fonts_are_discovered(self) -> None:
        fonts = bundled_font_paths()
        self.assertGreaterEqual(len(fonts), 11)
        self.assertTrue(all(font.suffix.lower() in {".ttf", ".otf"} for font in fonts))

    def test_random_visible_color_is_bright_enough_for_black_background(self) -> None:
        rng = random.Random(42)
        for _ in range(100):
            red, green, blue = random_visible_color(rng)
            self.assertGreaterEqual(red, 96)
            self.assertGreaterEqual(green, 96)
            self.assertGreaterEqual(blue, 96)
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            self.assertGreaterEqual(luminance, MIN_COLOR_LUMINANCE)


if __name__ == "__main__":
    unittest.main()
