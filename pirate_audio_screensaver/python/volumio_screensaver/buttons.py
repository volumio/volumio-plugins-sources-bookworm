from __future__ import annotations

import logging
from collections.abc import Callable

LOGGER = logging.getLogger(__name__)


class ButtonWatcher:
    def __init__(
        self,
        pins: list[int],
        on_press: Callable[[int], None],
        bouncetime_ms: int = 100,
    ) -> None:
        self._pins = pins
        self._on_press = on_press
        self._bouncetime_ms = bouncetime_ms
        self._gpio = None

    def start(self) -> None:
        import RPi.GPIO as GPIO

        self._gpio = GPIO
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self._pins, GPIO.IN, pull_up_down=GPIO.PUD_UP)

        for pin in self._pins:
            GPIO.add_event_detect(
                pin,
                GPIO.FALLING,
                callback=self._handle_press,
                bouncetime=self._bouncetime_ms,
            )

        LOGGER.info("Watching buttons on BCM pins %s", self._pins)

    def stop(self) -> None:
        if self._gpio is None:
            return

        for pin in self._pins:
            try:
                self._gpio.remove_event_detect(pin)
            except RuntimeError:
                pass

        self._gpio.cleanup(self._pins)
        self._gpio = None

    def _handle_press(self, pin: int) -> None:
        LOGGER.info("Button press detected on BCM pin %s", pin)
        self._on_press(pin)
