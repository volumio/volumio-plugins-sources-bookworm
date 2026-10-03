from __future__ import annotations

import random
import unittest
from datetime import datetime

from volumio_screensaver.clock import colon_visible, format_clock, pick_position


class ClockTest(unittest.TestCase):
    def test_colon_blinks_on_even_seconds(self) -> None:
        self.assertTrue(colon_visible(0))
        self.assertFalse(colon_visible(1))
        self.assertTrue(colon_visible(58))
        self.assertFalse(colon_visible(59))

    def test_format_clock_uses_24_hour_time(self) -> None:
        self.assertEqual(format_clock(datetime(2026, 6, 22, 8, 5, 2)), "08:05")
        self.assertEqual(format_clock(datetime(2026, 6, 22, 23, 59, 3)), "23 59")

    def test_pick_position_stays_inside_padding(self) -> None:
        rng = random.Random(42)
        for _ in range(100):
            x, y = pick_position(240, 240, 160, 60, 8, rng)
            self.assertGreaterEqual(x, 8)
            self.assertGreaterEqual(y, 8)
            self.assertLessEqual(x + 160, 232)
            self.assertLessEqual(y + 60, 232)


if __name__ == "__main__":
    unittest.main()
