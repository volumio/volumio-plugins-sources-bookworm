from __future__ import annotations

import json
import socket
import struct
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

from volumio_screensaver.bridge import (
    MAX_FRAME_BYTES,
    MAX_HEADER_BYTES,
    DisplayBridgeServer,
    SharedDisplay,
    managed_display_class,
    read_packet,
    send_packet,
)
from volumio_screensaver.pirateaudio_wrapper import run_native


class FragmentedStream:
    def __init__(self, data=b""):
        self.data = bytearray(data)

    def recv(self, length):
        count = min(length, 2, len(self.data))
        result = bytes(self.data[:count])
        del self.data[:count]
        return result

    def sendall(self, data):
        self.data.extend(data)


class FakeHardware:
    def __init__(self, **_kwargs):
        self.frames = []
        self.backlights = []
        self.max_concurrent_writes = 0
        self._writing = 0
        self._metrics_lock = threading.Lock()
        # Exercise a base constructor invoking the subclass's setter.
        self.set_backlight(False)

    def _write(self, collection, value):
        with self._metrics_lock:
            self._writing += 1
            self.max_concurrent_writes = max(self.max_concurrent_writes, self._writing)
        time.sleep(0.0005)
        collection.append(value)
        with self._metrics_lock:
            self._writing -= 1

    def display(self, image):
        self._write(self.frames, image.copy())

    def set_backlight(self, on):
        self._write(self.backlights, bool(on))


class PacketTest(unittest.TestCase):
    def test_stream_framing_survives_fragmented_reads(self):
        stream = FragmentedStream()
        send_packet(stream, {"command": "display", "width": 2}, b"012345")
        header, payload = read_packet(stream)
        self.assertEqual(header["command"], "display")
        self.assertEqual(header["payload_length"], 6)
        self.assertEqual(payload, b"012345")

    def test_oversized_header_and_payload_are_rejected_before_body_read(self):
        with self.assertRaises(OSError):
            read_packet(FragmentedStream(struct.pack("!I", MAX_HEADER_BYTES + 1)))
        encoded = json.dumps({"payload_length": MAX_FRAME_BYTES + 1}).encode()
        with self.assertRaises(OSError):
            read_packet(FragmentedStream(struct.pack("!I", len(encoded)) + encoded))

    def test_truncated_and_non_object_headers_are_rejected(self):
        with self.assertRaises(OSError):
            read_packet(FragmentedStream(b"\x00\x00"))
        with self.assertRaises(OSError):
            read_packet(FragmentedStream(struct.pack("!I", 2) + b"[]"))


class OwnerTest(unittest.TestCase):
    def setUp(self):
        self.clock = [0.0]
        owner_class = managed_display_class(FakeHardware, clock=lambda: self.clock[0])
        self.owner = owner_class(rotation=90)
        self.native = Image.new("RGB", (2, 2), "green")
        self.owner.display(self.native)
        self.client = object()

    def frame(self, image=None, rotation=90, revision=None):
        image = image if image is not None else Image.new("RGB", (2, 2), "red")
        header = {
            "command": "display", "revision": self.owner._activity_revision if revision is None else revision,
            "width": image.width, "height": image.height, "rotation": rotation, "backlight": True,
        }
        return self.owner.handle_request(self.client, header, image.tobytes())

    def test_rotation_adjusts_relative_to_native_and_native_frame_is_restored(self):
        image = Image.new("RGB", (2, 2))
        image.putdata([(255, 0, 0), (0, 0, 255), (255, 255, 0), (255, 0, 255)])
        self.assertTrue(self.frame(image, rotation=270)["ok"])
        self.assertEqual(self.owner.frames[-1].tobytes(), image.rotate(180).tobytes())
        self.native.paste("black", (0, 0, 2, 2))
        self.owner.release_overlay(self.client)
        self.assertEqual(self.owner.frames[-1].getpixel((0, 0)), (0, 128, 0))
        self.assertFalse(self.owner.backlights[-1])

    def test_native_activity_restores_and_rejects_stale_clock_frame(self):
        revision = self.owner._activity_revision
        self.frame(revision=revision)
        self.owner.native_activity()
        count = len(self.owner.frames)
        reply = self.frame(revision=revision)
        self.assertFalse(reply["ok"])
        self.assertEqual(len(self.owner.frames), count)
        self.assertFalse(reply["active"])
        self.assertGreater(reply["activity"], revision)
        self.assertEqual(self.owner.frames[-1].tobytes(), self.native.tobytes())

    def test_native_frame_and_backlight_cancel_overlay(self):
        self.frame()
        new_native = Image.new("RGB", (2, 2), "blue")
        self.owner.display(new_native)
        self.assertEqual(self.owner.frames[-1].tobytes(), new_native.tobytes())
        self.assertIsNone(self.owner._overlay_client)
        self.frame()
        self.owner.set_backlight(False)
        self.assertIsNone(self.owner._overlay_client)
        self.assertEqual(self.owner.frames[-1].tobytes(), new_native.tobytes())
        self.assertFalse(self.owner.backlights[-1])

    def test_heartbeat_renews_lease_and_expiry_restores_native(self):
        self.frame()
        self.clock[0] = 4.0
        heartbeat = {"command": "heartbeat", "revision": self.owner._activity_revision}
        self.assertTrue(self.owner.handle_request(self.client, heartbeat, b"")["active"])
        self.clock[0] = 8.0
        self.owner.expire_lease()
        self.assertIs(self.owner._overlay_client, self.client)
        self.clock[0] = 9.0
        self.owner.expire_lease()
        self.assertIsNone(self.owner._overlay_client)
        self.assertEqual(self.owner.frames[-1].tobytes(), self.native.tobytes())
        self.assertFalse(self.owner.backlights[-1])

    def test_unrelated_client_disconnect_does_not_release_current_overlay(self):
        self.frame()
        self.owner.release_overlay(object())
        self.assertIs(self.owner._overlay_client, self.client)
        self.owner.release_overlay(self.client)
        self.assertIsNone(self.owner._overlay_client)

    def test_invalid_frame_does_not_reach_hardware(self):
        count = len(self.owner.frames)
        header = {"command": "display", "revision": self.owner._activity_revision,
                  "width": 240, "height": 240, "rotation": 90, "backlight": True}
        self.assertFalse(self.owner.handle_request(self.client, header, b"short")["ok"])
        header["width"] = True
        self.assertFalse(self.owner.handle_request(self.client, header, b"short")["ok"])
        self.assertFalse(self.owner.handle_request(self.client, {"command": ["display"]}, b"")["ok"])
        self.assertEqual(len(self.owner.frames), count)

    def test_concurrent_native_and_clock_writes_are_serialized(self):
        def native_writer():
            for _ in range(30):
                self.owner.display(self.native)

        def clock_writer():
            for _ in range(30):
                self.frame()

        threads = [threading.Thread(target=native_writer), threading.Thread(target=clock_writer)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(self.owner.max_concurrent_writes, 1)


class SocketTest(unittest.TestCase):
    def test_begin_never_connects_or_touches_hardware(self):
        with patch("volumio_screensaver.bridge.socket.socket") as constructor:
            SharedDisplay("absent.sock").begin()
        constructor.assert_not_called()

    def test_real_stream_client_and_server_roundtrip_without_unix_socket_support(self):
        owner = managed_display_class(FakeHardware)(rotation=90)
        native = Image.new("RGB", (2, 2), "green")
        owner.display(native)
        client_socket, server_socket = socket.socketpair()
        client_socket.settimeout(1.0)
        server_socket.settimeout(2.0)
        server = DisplayBridgeServer(owner, "unused-test.sock")
        server._clients.add(server_socket)

        class StreamClient(SharedDisplay):
            def _connect(self):
                # Only replace endpoint discovery; exercise the real framed requests,
                # replies and owner connection handler on a real byte stream.
                send_packet(client_socket, {"command": "status"})
                reply, payload = read_packet(client_socket)
                self.assert_payload_empty = payload == b""
                self._apply_reply(reply)
                self._ever_connected = True
                self._connection = client_socket

        client = StreamClient("unused-test.sock", rotation=90, width=2, height=2)
        worker = threading.Thread(target=server._serve_client, args=(server_socket,), daemon=True)
        worker.start()
        try:
            self.assertFalse(client.consume_activity())
            self.assertTrue(client.assert_payload_empty)
            clock = Image.new("RGB", (2, 2), "red")
            client.display(clock)
            self.assertEqual(owner.frames[-1].tobytes(), clock.tobytes())
            client.set_backlight(False)
            self.assertFalse(owner.backlights[-1])
            client.heartbeat()
            owner.native_activity()
            with self.assertRaises(OSError):
                client.display(clock)
            self.assertTrue(client.consume_activity())
            self.assertFalse(client.consume_activity())
            self.assertEqual(owner.frames[-1].tobytes(), native.tobytes())
            client.display(clock)
            client.release()
            self.assertEqual(owner.frames[-1].tobytes(), native.tobytes())
            client.display(clock)
            client._disconnect()
            worker.join(timeout=1.0)
            self.assertFalse(worker.is_alive())
            self.assertIsNone(owner._overlay_client)
            self.assertEqual(owner.frames[-1].tobytes(), native.tobytes())
            self.assertFalse(owner.backlights[-1])
        finally:
            client.close()
            server.stop()
            server_socket.close()
            client_socket.close()
            worker.join(timeout=1.0)

    def test_actual_socket_roundtrip_activity_release_disconnect_and_late_boot(self):
        if not hasattr(socket, "AF_UNIX"):
            self.skipTest("Unix sockets unavailable on this host")
        owner = managed_display_class(FakeHardware)(rotation=90)
        native = Image.new("RGB", (2, 2), "green")
        owner.display(native)
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "bridge.sock")
            client = SharedDisplay(path, rotation=90, width=2, height=2)
            with self.assertRaises(OSError):
                client.consume_activity()
            server = DisplayBridgeServer(owner, path)
            try:
                try:
                    server.start()
                except OSError as exc:
                    self.skipTest(f"Unix socket binding unsupported on this host: {exc}")
                self.assertFalse(client.consume_activity())
                clock = Image.new("RGB", (2, 2), "red")
                client.display(clock)
                self.assertEqual(owner.frames[-1].tobytes(), clock.tobytes())
                owner.native_activity()
                with self.assertRaises(OSError):
                    client.display(clock)
                self.assertTrue(client.consume_activity())
                self.assertFalse(client.consume_activity())
                client.display(clock)
                client.release()
                self.assertEqual(owner.frames[-1].tobytes(), native.tobytes())
                client.display(clock)
                client._disconnect()  # Simulate process death without a release request.
                deadline = time.monotonic() + 1.0
                while (owner._overlay_client is not None or owner.frames[-1].tobytes() != native.tobytes()) and time.monotonic() < deadline:
                    time.sleep(0.005)
                self.assertIsNone(owner._overlay_client)
                self.assertEqual(owner.frames[-1].tobytes(), native.tobytes())
                self.assertTrue(client.consume_activity())  # A reconnect resets the idle timer.
            finally:
                client.close()
                server.stop()


class WrapperTest(unittest.TestCase):
    def test_fast_native_reconnect_keeps_bridge_until_socketio_disconnects(self):
        second_wait_entered = threading.Event()
        allow_disconnect = threading.Event()
        wrapper_finished = threading.Event()
        failures = []

        class ReconnectingClient:
            connected = True
            wait_calls = 0

            def wait(self):
                self.wait_calls += 1
                if self.wait_calls == 1:
                    # Socket.IO 4 can return after a fast reconnect even though
                    # the replacement connection and its network threads live.
                    return
                second_wait_entered.set()
                allow_disconnect.wait(2.0)
                self.connected = False

        state = types.ModuleType("native_test_state")
        state.client = ReconnectingClient()
        native_module = types.ModuleType("st7789")
        native_module.ST7789 = FakeHardware
        gpio = types.ModuleType("RPi.GPIO")
        gpio.input = Mock(return_value=1)
        original_input = gpio.input
        rpi = types.ModuleType("RPi")
        rpi.GPIO = gpio
        servers = []

        class FakeServer:
            def __init__(self, _owner, _path):
                self.started = False
                self.stopped = False
                servers.append(self)

            def start(self):
                self.started = True

            def stop(self):
                self.stopped = True

        source = (
            "import st7789\nimport native_test_state\n"
            "DISP = st7789.ST7789(rotation=90)\n"
            "SOCKETIO = native_test_state.client\nSOCKETIO.wait()\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "native.py"
            script.write_text(source, encoding="utf-8")

            def run_wrapper():
                try:
                    run_native(str(script), str(Path(directory) / "bridge.sock"))
                except BaseException as exc:
                    failures.append(exc)
                finally:
                    wrapper_finished.set()

            modules = {"st7789": native_module, "RPi": rpi, "RPi.GPIO": gpio,
                       "native_test_state": state}
            with patch.dict(sys.modules, modules):
                with patch("volumio_screensaver.bridge.DisplayBridgeServer", FakeServer):
                    worker = threading.Thread(target=run_wrapper, daemon=True)
                    worker.start()
                    try:
                        self.assertTrue(second_wait_entered.wait(0.5), "Native fast reconnect lost its bridge")
                        self.assertFalse(wrapper_finished.is_set())
                        self.assertTrue(servers[0].started)
                        self.assertFalse(servers[0].stopped)
                        self.assertIsNot(gpio.input, original_input)
                        self.assertIsNot(native_module.ST7789, FakeHardware)
                    finally:
                        allow_disconnect.set()
                        worker.join(timeout=1.0)
                    self.assertFalse(worker.is_alive())
                    self.assertEqual(failures, [])
                    self.assertTrue(servers[0].stopped)
                    self.assertIs(gpio.input, original_input)
                    self.assertIs(native_module.ST7789, FakeHardware)
                    self.assertEqual(state.client.wait_calls, 2)

    def run_wrapper(self, fail_start=False, exit_native=False):
        native_module = types.ModuleType("st7789")
        native_module.ST7789 = FakeHardware
        native_module.socketio_client = Mock(connected=True)
        gpio = types.ModuleType("RPi.GPIO")
        gpio.input = Mock(side_effect=[1, 0, 0])
        gpio.setup = Mock()
        original_input = gpio.input
        rpi = types.ModuleType("RPi")
        rpi.GPIO = gpio
        servers = []

        class FakeServer:
            def __init__(self, owner, _path):
                self.owner = owner
                self.stopped = False
                servers.append(self)

            def start(self):
                if fail_start:
                    raise OSError("Socket unavailable")

            def stop(self):
                self.stopped = True

        source = (
            "import st7789\nimport RPi.GPIO as GPIO\nfrom PIL import Image\n"
            "st7789.last_display = st7789.ST7789(rotation=90)\n"
            "st7789.last_display.display(Image.new('RGB', (2, 2), 'green'))\n"
            "GPIO.input(5)\nGPIO.input(5)\nGPIO.input(5)\n"
        )
        if exit_native:
            source += "SOCKETIO = st7789.socketio_client\nraise SystemExit(0)\n"
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "native.py"
            script.write_text(source, encoding="utf-8")
            with patch.dict(sys.modules, {"st7789": native_module, "RPi": rpi, "RPi.GPIO": gpio}):
                with patch("volumio_screensaver.bridge.DisplayBridgeServer", FakeServer):
                    if fail_start:
                        with self.assertLogs("volumio_screensaver.pirateaudio_wrapper", level="ERROR"):
                            run_native(str(script), str(Path(directory) / "bridge.sock"))
                    elif exit_native:
                        with self.assertRaises(SystemExit) as exit_result:
                            run_native(str(script), str(Path(directory) / "bridge.sock"))
                        self.assertEqual(exit_result.exception.code, 0)
                        native_module.socketio_client.wait.assert_not_called()
                    else:
                        run_native(str(script), str(Path(directory) / "bridge.sock"))
        self.assertIs(native_module.ST7789, FakeHardware)
        self.assertIs(gpio.input, original_input)
        gpio.setup.assert_not_called()
        return native_module.last_display, servers

    def test_wrapper_observes_existing_button_polling_and_restores_patches(self):
        owner, servers = self.run_wrapper()
        self.assertEqual(owner._activity_revision, 3)  # Constructor, native frame, one falling edge.
        self.assertTrue(servers[0].stopped)

    def test_bridge_startup_failure_keeps_original_native_methods(self):
        owner, _servers = self.run_wrapper(fail_start=True)
        self.assertIs(owner.display.__func__, FakeHardware.display)
        self.assertIs(owner.set_backlight.__func__, FakeHardware.set_backlight)
        self.assertEqual(owner.frames[-1].getpixel((0, 0)), (0, 128, 0))

    def test_native_system_exit_cleans_up_without_reentering_connected_wait(self):
        _owner, servers = self.run_wrapper(exit_native=True)
        self.assertTrue(servers[0].stopped)


if __name__ == "__main__":
    unittest.main()
