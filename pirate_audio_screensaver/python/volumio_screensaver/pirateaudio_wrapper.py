"""Run unmodified native Pirate Audio code with a single shared display owner."""
from __future__ import annotations

import argparse
import logging
import runpy
import sys
import threading
from pathlib import Path

LOGGER = logging.getLogger("volumio_screensaver.pirateaudio_wrapper")


def run_native(native_script: str, socket_path: str) -> None:
    # Support the official interpreter running this file directly from our source.
    package_parent = str(Path(__file__).resolve().parent.parent)
    if package_parent not in sys.path:
        sys.path.insert(0, package_parent)
    server = None
    st7789 = gpio = original_display = original_input = None
    try:
        from volumio_screensaver.bridge import DisplayBridgeServer, managed_display_class
        import st7789
        import RPi.GPIO as gpio

        original_display = st7789.ST7789
        original_input = gpio.input
        owner = {}
        input_states = {}
        input_lock = threading.Lock()

        def restore_patches() -> None:
            st7789.ST7789 = original_display
            gpio.input = original_input

        def on_created(display) -> None:
            nonlocal server
            try:
                server = DisplayBridgeServer(display, socket_path)
                server.start()
                owner["display"] = display
                LOGGER.info("Native Pirate Audio display bridge started at %s", socket_path)
            except Exception:
                # Keep the already-created native hardware instance; do not request
                # its GPIO lines a second time during a bridge startup failure.
                LOGGER.exception("Display bridge unavailable; running native Pirate Audio unchanged")
                restore_patches()
                display.display = original_display.display.__get__(display, original_display)
                display.set_backlight = original_display.set_backlight.__get__(display, original_display)
                server = None

        def shared_input(channel):
            value = original_input(channel)
            falling = False
            with input_lock:
                previous = input_states.get(channel)
                input_states[channel] = value
                falling = previous == 1 and value == 0
            if falling and "display" in owner:
                owner["display"].native_activity()
            return value

        st7789.ST7789 = managed_display_class(original_display, on_created)
        gpio.input = shared_input
    except Exception:
        LOGGER.exception("Display bridge setup failed; running native Pirate Audio unchanged")
        if st7789 is not None and original_display is not None:
            st7789.ST7789 = original_display
        if gpio is not None and original_input is not None:
            gpio.input = original_input

    saved_argv = sys.argv
    sys.argv = [native_script]
    try:
        native_context = runpy.run_path(native_script, run_name="__main__")
        native_socketio = native_context.get("SOCKETIO")
        # Socket.IO 4 wait() can return after a fast reconnect while its new
        # connection and network threads remain alive. Keep the bridge with
        # that connection until native wait confirms it has disconnected.
        while native_socketio is not None and getattr(native_socketio, "connected", False):
            native_socketio.wait()
    finally:
        sys.argv = saved_argv
        if server is not None:
            server.stop()
        if st7789 is not None and original_display is not None:
            st7789.ST7789 = original_display
        if gpio is not None and original_input is not None:
            gpio.input = original_input


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-script", "--script", dest="native_script", required=True)
    parser.add_argument("--socket", required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_native(str(Path(args.native_script).resolve()), args.socket)


if __name__ == "__main__":
    main()
