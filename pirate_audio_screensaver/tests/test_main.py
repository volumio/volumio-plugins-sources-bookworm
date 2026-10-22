from __future__ import annotations

import os
import unittest
from dataclasses import replace
from datetime import datetime
from unittest.mock import Mock, patch

from volumio_screensaver.config import Config
from volumio_screensaver.main import ScreenSaver


class StepStop:
    def __init__(self, times: list[float]) -> None:
        self.times = times
        self.step = 0
        self.waits: list[float] = []

    def is_set(self) -> bool:
        return self.step >= len(self.times)

    def wait(self, seconds: float) -> bool:
        self.waits.append(seconds)
        self.step += 1
        return self.is_set()

    def now(self) -> float:
        return self.times[self.step]


class MainBridgeTest(unittest.TestCase):
    def run_steps(
        self,
        states: list[bool | None],
        *,
        times: list[float] | None = None,
        activities: list[bool | Exception] | None = None,
        idle_delay: float = 0.0,
        frames: list[None | Exception] | None = None,
    ):
        with patch.dict(os.environ, {}, clear=True):
            config = replace(
                Config.from_env(),
                idle_delay_seconds=idle_delay,
                poll_seconds=0.0,
                display_bridge_socket="/run/test-pirateaudio.sock",
            )
        stop = StepStop(times or [float(i) for i in range(len(states))])
        display = Mock(width=240, height=240)
        display.measure.return_value = (80, 50)
        activity_values = activities or [False] * len(states)

        def consume_activity():
            value = activity_values[stop.step]
            if isinstance(value, Exception):
                raise value
            return value

        display.consume_activity.side_effect = consume_activity
        client = Mock()
        client.is_playing.side_effect = lambda: states[stop.step]
        releases = []
        shows = []
        beats = []
        display.release.side_effect = lambda: releases.append(stop.step)
        display.show_clock.side_effect = (
            self._frame_side_effect(shows, stop, frames)
        )
        display.heartbeat.side_effect = lambda: beats.append(stop.step)
        with (
            patch("volumio_screensaver.main.ClockDisplay", return_value=display),
            patch("volumio_screensaver.main.VolumioClient", return_value=client),
            patch("volumio_screensaver.main.time.monotonic", side_effect=stop.now),
            patch("volumio_screensaver.main.datetime") as clock,
        ):
            clock.now.return_value = datetime(2026, 10, 3, 12, 34, 0)
            app = ScreenSaver(config)
            app._stop = stop
            self.assertEqual(app.run(), 0)
        return display, stop, releases, shows, beats

    @staticmethod
    def _frame_side_effect(shows, stop, frames):
        values = iter(frames) if frames is not None else None

        def show(*_args):
            shows.append(stop.step)
            if values is not None:
                result = next(values)
                if isinstance(result, Exception):
                    raise result

        return show

    def test_playback_restores_native_display_without_black_frame(self) -> None:
        display, _stop, releases, shows, _beats = self.run_steps([False, True])
        self.assertEqual(shows, [0])
        self.assertIn(1, releases)
        display.clear.assert_not_called()
        display.close.assert_called_once_with()

    def test_unknown_playback_state_releases_native_display(self) -> None:
        display, _stop, releases, shows, _beats = self.run_steps([False, None])
        self.assertEqual(shows, [0])
        self.assertIn(1, releases)
        display.clear.assert_not_called()

    def test_native_button_or_menu_activity_resets_entire_idle_delay(self) -> None:
        display, _stop, releases, shows, _beats = self.run_steps(
            [False] * 5,
            times=[0.0, 1.0, 1.25, 1.5, 2.25],
            activities=[False, False, True, False, False],
            idle_delay=1.0,
        )
        self.assertEqual(shows, [1, 4])
        self.assertIn(2, releases)
        display.clear.assert_not_called()

    def test_native_service_can_start_later_without_crashing_screensaver(self) -> None:
        with self.assertLogs("volumio_screensaver.main", level="INFO") as logs:
            display, stop, _releases, shows, _beats = self.run_steps(
                [False] * 3,
                activities=[ConnectionRefusedError("not ready")] * 2 + [False],
            )
        self.assertEqual(shows, [2])
        self.assertEqual(stop.waits[:2], [1.0, 1.0])
        self.assertEqual(sum("Waiting for Pirate Audio" in line for line in logs.output), 1)
        self.assertTrue(any("connection restored" in line for line in logs.output))
        display.close.assert_called_once_with()

    def test_frame_connection_failure_retries_without_process_restart(self) -> None:
        with self.assertLogs("volumio_screensaver.main", level="WARNING"):
            _display, stop, _releases, shows, _beats = self.run_steps(
                [False, False],
                frames=[BrokenPipeError("native service restarted"), None],
            )
        self.assertEqual(shows, [0, 1])
        self.assertEqual(stop.waits[0], 1.0)

    def test_active_overlay_is_renewed_when_clock_text_does_not_change(self) -> None:
        _display, _stop, _releases, shows, beats = self.run_steps(
            [False] * 3, times=[0.0, 1.0, 2.0]
        )
        self.assertEqual(shows, [0])
        self.assertEqual(beats, [1, 2])

    def test_shutdown_releases_even_when_music_is_already_playing(self) -> None:
        display, _stop, releases, shows, _beats = self.run_steps([True])
        self.assertEqual(shows, [])
        self.assertIn(0, releases)
        self.assertIn(1, releases)
        display.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
