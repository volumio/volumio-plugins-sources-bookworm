from __future__ import annotations

import builtins
import os
import sys
import unittest
from types import ModuleType
from unittest.mock import Mock, patch

from volumio_screensaver.config import Config
from volumio_screensaver.display import ClockDisplay


class DisplayBridgeTest(unittest.TestCase):
    def test_bridge_mode_never_imports_gpio_or_spi_display_driver(self) -> None:
        with patch.dict(os.environ, {"DISPLAY_BRIDGE_SOCKET": "/run/clock.sock"}, clear=True):
            config = Config.from_env()
        backend = Mock()
        backend.consume_activity.return_value = True
        factory = Mock(return_value=backend)
        bridge_module = ModuleType("volumio_screensaver.bridge")
        bridge_module.SharedDisplay = factory
        real_import = builtins.__import__

        def no_gpio_import(name, *args, **kwargs):
            if name in {"st7789", "ST7789", "gpiod", "gpiodevice", "spidev", "RPi.GPIO"}:
                raise AssertionError("Bridge mode must not import hardware driver " + name)
            return real_import(name, *args, **kwargs)

        with (
            patch.dict(sys.modules, {"volumio_screensaver.bridge": bridge_module}),
            patch("builtins.__import__", side_effect=no_gpio_import),
        ):
            display = ClockDisplay(config)
        factory.assert_called_once_with("/run/clock.sock", rotation=90, width=240, height=240)
        backend.begin.assert_called_once_with()
        display.show_clock("12:34", (10, 20))
        self.assertEqual(backend.display.call_args.args[0].size, (240, 240))
        backend.set_backlight.assert_called_with(True)
        self.assertTrue(display.consume_activity())
        display.heartbeat()
        display.release()
        display.close()
        backend.heartbeat.assert_called_once_with()
        backend.release.assert_called_once_with()
        backend.close.assert_called_once_with()

    def test_standalone_mode_remains_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(Config.from_env().display_bridge_socket, "")


if __name__ == "__main__":
    unittest.main()
