from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from volumio_screensaver.config import Config, parse_pins


class ConfigTest(unittest.TestCase):
    def test_parse_pins(self) -> None:
        self.assertEqual(parse_pins("5,6,16,24"), [5, 6, 16, 24])
        self.assertEqual(parse_pins(" 5, 6, 16, 20 "), [5, 6, 16, 20])

    def test_parse_pins_rejects_empty_list(self) -> None:
        with self.assertRaises(ValueError):
            parse_pins(" , ")

    def test_parse_pins_allows_empty_list_for_disabled_buttons(self) -> None:
        self.assertEqual(parse_pins(" , ", allow_empty=True), [])

    def test_buttons_are_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(Config.from_env().buttons_enabled)

    def test_buttons_can_be_enabled_from_env(self) -> None:
        with patch.dict(os.environ, {"BUTTONS_ENABLED": "true"}, clear=True):
            self.assertTrue(Config.from_env().buttons_enabled)


if __name__ == "__main__":
    unittest.main()
