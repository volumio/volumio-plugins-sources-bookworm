from __future__ import annotations

import logging
import random
import signal
import threading
import time
from datetime import datetime

from .buttons import ButtonWatcher
from .clock import format_clock, minute_key, pick_position
from .config import Config
from .display import ClockDisplay
from .volumio import VolumioClient

LOGGER = logging.getLogger(__name__)


class ScreenSaver:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._stop = threading.Event()
        self._button_pressed = threading.Event()
        self._rng = random.Random()
        self._display = ClockDisplay(config)
        self._volumio = VolumioClient(config.volumio_url, config.http_timeout_seconds)
        self._buttons: ButtonWatcher | None = None
        if config.buttons_enabled and config.button_pins:
            self._buttons = ButtonWatcher(
                config.button_pins,
                on_press=self._on_button_press,
                bouncetime_ms=config.button_bounce_ms,
            )

    def run(self) -> int:
        if self._buttons is None:
            LOGGER.info(
                "Button watching disabled; set BUTTONS_ENABLED=true to enable it"
            )
        else:
            try:
                self._buttons.start()
            except Exception as exc:
                LOGGER.warning(
                    "Buttons disabled because GPIO edge detection failed: %s", exc
                )
                self._buttons.stop()
                self._buttons = None

        current_playing: bool | None = None
        next_poll = 0.0
        idle_since: float | None = None
        active = False
        blanked = True
        last_text: str | None = None
        last_minute: str | None = None
        position: tuple[int, int] | None = None

        try:
            while not self._stop.is_set():
                now_monotonic = time.monotonic()

                if self._button_pressed.is_set():
                    self._button_pressed.clear()
                    idle_since = now_monotonic
                    if active:
                        self._display.clear(backlight_on=False)
                        blanked = True
                    active = False
                    last_text = None
                    last_minute = None
                    position = None
                    LOGGER.info(
                        "Screen saver hidden, idle timer reset for %.1f seconds",
                        self._config.idle_delay_seconds,
                    )

                if now_monotonic >= next_poll:
                    current_playing = self._volumio.is_playing()
                    next_poll = now_monotonic + self._config.poll_seconds

                if current_playing is True:
                    if active:
                        LOGGER.info(
                            "Volumio is playing, leaving display to Pirate Audio"
                        )
                    # Do not clear the display while music is playing. The Pirate Audio
                    # plugin may already own the ST7789 screen and should be allowed to
                    # redraw it instead of receiving a forced black frame from us.
                    active = False
                    blanked = True
                    last_text = None
                    last_minute = None
                    position = None
                    idle_since = None
                elif current_playing is False:
                    if idle_since is None:
                        idle_since = now_monotonic

                    idle_elapsed = now_monotonic - idle_since
                    if idle_elapsed < self._config.idle_delay_seconds:
                        if active:
                            LOGGER.info("Music idle delay reset, hiding screen saver")
                            self._display.clear(backlight_on=False)
                            blanked = True
                        active = False
                        last_text = None
                        self._stop.wait(0.25)
                        continue

                    now = datetime.now()
                    text = format_clock(now)
                    current_minute = minute_key(now)

                    if position is None or current_minute != last_minute:
                        self._display.choose_random_style(self._rng)
                        text_width, text_height = self._display.measure("88:88")
                        position = pick_position(
                            self._display.width,
                            self._display.height,
                            text_width,
                            text_height,
                            self._config.screen_padding,
                            self._rng,
                        )
                        last_minute = current_minute

                    if text != last_text or not active:
                        self._display.show_clock(text, position)
                        blanked = False
                        last_text = text
                        active = True
                else:
                    if active:
                        LOGGER.info("Volumio state unknown, hiding screen saver")
                        self._display.clear(backlight_on=False)
                        blanked = True
                    active = False
                    last_text = None
                    idle_since = None

                self._stop.wait(0.25)
        finally:
            # Do not blank the display on shutdown; the Volumio/Pirate Audio plugin
            # can redraw the screen when it regains control.
            if self._buttons is not None:
                self._buttons.stop()

        return 0

    def stop(self, *_args) -> None:
        self._stop.set()

    def _on_button_press(self, _pin: int) -> None:
        self._button_pressed.set()


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def main() -> int:
    config = Config.from_env()
    configure_logging(config.log_level)
    app = ScreenSaver(config)

    signal.signal(signal.SIGTERM, app.stop)
    signal.signal(signal.SIGINT, app.stop)

    return app.run()
