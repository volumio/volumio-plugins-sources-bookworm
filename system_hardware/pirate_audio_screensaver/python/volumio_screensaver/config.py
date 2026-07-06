from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    value = _env(name, str(default))
    return int(value)


def _env_float(name: str, default: float) -> float:
    value = _env(name, str(default))
    return float(value)


def _env_bool(name: str, default: bool) -> bool:
    value = _env(name, "true" if default else "false").lower()
    return value in {"1", "true", "yes", "on"}


def parse_pins(value: str, *, allow_empty: bool = False) -> list[int]:
    pins = [int(part.strip()) for part in value.split(",") if part.strip()]
    if not pins and not allow_empty:
        raise ValueError("At least one button pin is required")
    return pins


@dataclass(frozen=True)
class Config:
    volumio_url: str
    poll_seconds: float
    http_timeout_seconds: float
    idle_delay_seconds: float
    buttons_enabled: bool
    button_pins: list[int]
    button_bounce_ms: int
    display_width: int
    display_height: int
    display_rotation: int
    display_port: int
    display_cs: int
    display_dc: int
    display_backlight: int
    display_spi_speed: int
    display_offset_left: int
    display_offset_top: int
    font_size: int
    font_path: str
    screen_padding: int
    blank_turns_backlight_off: bool
    log_level: str

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            volumio_url=_env("VOLUMIO_URL", "http://127.0.0.1:3000").rstrip("/"),
            poll_seconds=_env_float("POLL_SECONDS", 2.0),
            http_timeout_seconds=_env_float("HTTP_TIMEOUT_SECONDS", 1.5),
            idle_delay_seconds=_env_float("IDLE_DELAY_SECONDS", 300.0),
            buttons_enabled=_env_bool("BUTTONS_ENABLED", False),
            button_pins=parse_pins(_env("BUTTON_PINS", "5,6,16,24"), allow_empty=True),
            button_bounce_ms=_env_int("BUTTON_BOUNCE_MS", 100),
            display_width=_env_int("DISPLAY_WIDTH", 240),
            display_height=_env_int("DISPLAY_HEIGHT", 240),
            display_rotation=_env_int("DISPLAY_ROTATION", 90),
            display_port=_env_int("DISPLAY_PORT", 0),
            display_cs=_env_int("DISPLAY_CS", 1),
            display_dc=_env_int("DISPLAY_DC", 9),
            display_backlight=_env_int("DISPLAY_BACKLIGHT", 13),
            display_spi_speed=_env_int("DISPLAY_SPI_SPEED", 80_000_000),
            display_offset_left=_env_int("DISPLAY_OFFSET_LEFT", 0),
            display_offset_top=_env_int("DISPLAY_OFFSET_TOP", 0),
            font_size=_env_int("FONT_SIZE", 58),
            font_path=_env(
                "FONT_PATH",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            ),
            screen_padding=_env_int("SCREEN_PADDING", 8),
            blank_turns_backlight_off=_env_bool("BLANK_TURNS_BACKLIGHT_OFF", True),
            log_level=_env("LOG_LEVEL", "INFO").upper(),
        )
