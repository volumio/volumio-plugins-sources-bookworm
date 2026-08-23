from __future__ import annotations

import random
from datetime import datetime


def colon_visible(second: int) -> bool:
    return second % 2 == 0


def format_clock(now: datetime) -> str:
    separator = ":" if colon_visible(now.second) else " "
    return f"{now.hour:02d}{separator}{now.minute:02d}"


def minute_key(now: datetime) -> str:
    return now.strftime("%Y%m%d%H%M")


def pick_position(
    screen_width: int,
    screen_height: int,
    text_width: int,
    text_height: int,
    padding: int,
    rng: random.Random | None = None,
) -> tuple[int, int]:
    generator = rng or random
    min_x = padding
    min_y = padding
    max_x = max(min_x, screen_width - text_width - padding)
    max_y = max(min_y, screen_height - text_height - padding)

    return (
        generator.randint(min_x, max_x),
        generator.randint(min_y, max_y),
    )
