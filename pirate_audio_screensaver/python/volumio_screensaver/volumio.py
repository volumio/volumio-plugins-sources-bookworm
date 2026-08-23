from __future__ import annotations

import json
import logging
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

LOGGER = logging.getLogger(__name__)


class VolumioClient:
    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def get_state(self) -> dict[str, Any] | None:
        url = f"{self._base_url}/api/v1/getState"
        try:
            with urlopen(url, timeout=self._timeout_seconds) as response:
                payload = response.read().decode("utf-8")
        except (TimeoutError, URLError, OSError) as exc:
            LOGGER.warning("Could not read Volumio state: %s", exc)
            return None

        try:
            state = json.loads(payload)
        except json.JSONDecodeError as exc:
            LOGGER.warning("Invalid Volumio response: %s", exc)
            return None

        if not isinstance(state, dict):
            LOGGER.warning("Unexpected Volumio state payload: %r", state)
            return None

        return state

    def is_playing(self) -> bool | None:
        state = self.get_state()
        if state is None:
            return None

        status = str(state.get("status", "")).lower()
        return status in {"play", "playing"}
