"""Share the native Pirate Audio display without acquiring its GPIO lines twice."""
from __future__ import annotations

import json
import logging
import os
import socket
import stat
import struct
import threading
import time
from pathlib import Path

LOGGER = logging.getLogger(__name__)
MAX_HEADER_BYTES = 2048
MAX_DIMENSION = 240
MAX_FRAME_BYTES = MAX_DIMENSION * MAX_DIMENSION * 3
DEFAULT_LEASE_SECONDS = 5.0


def _read_exact(connection: socket.socket, length: int) -> bytes:
    parts = bytearray()
    while len(parts) < length:
        chunk = connection.recv(length - len(parts))
        if not chunk:
            raise OSError("Display bridge connection closed")
        parts.extend(chunk)
    return bytes(parts)


def read_packet(connection: socket.socket) -> tuple[dict, bytes]:
    header_length = struct.unpack("!I", _read_exact(connection, 4))[0]
    if not 0 < header_length <= MAX_HEADER_BYTES:
        raise OSError("Invalid display bridge header size")
    try:
        header = json.loads(_read_exact(connection, header_length).decode("utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise OSError("Invalid display bridge header") from exc
    if not isinstance(header, dict):
        raise OSError("Display bridge header must be an object")
    payload_length = header.get("payload_length", 0)
    if type(payload_length) is not int or not 0 <= payload_length <= MAX_FRAME_BYTES:
        raise OSError("Invalid display bridge frame size")
    return header, _read_exact(connection, payload_length)


def send_packet(connection: socket.socket, header: dict, payload: bytes = b"") -> None:
    if len(payload) > MAX_FRAME_BYTES:
        raise OSError("Display bridge frame is too large")
    header = dict(header, payload_length=len(payload))
    encoded = json.dumps(header, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_HEADER_BYTES:
        raise OSError("Display bridge header is too large")
    connection.sendall(struct.pack("!I", len(encoded)) + encoded + payload)


class SharedDisplay:
    """ST7789-compatible client; only the native plugin owns the hardware."""

    def __init__(self, socket_path: str, rotation: int = 90, width: int = 240, height: int = 240):
        self._socket_path = socket_path
        self._rotation = rotation
        self._width, self._height = width, height
        self._connection: socket.socket | None = None
        self._lock = threading.RLock()
        self._revision: int | None = None
        self._activity_pending = False
        self._ever_connected = False
        self._active = False
        self._backlight = True

    def begin(self) -> None:
        # Connecting is deferred until the native service has started its socket.
        pass

    def _apply_reply(self, reply: dict) -> None:
        revision = reply.get("activity")
        if type(revision) is not int or revision < 0 or type(reply.get("ok")) is not bool:
            raise OSError("Invalid display bridge reply")
        if self._revision is not None and revision != self._revision:
            self._activity_pending = True
        self._revision = revision
        self._active = bool(reply.get("active", False))

    def _disconnect(self) -> None:
        if self._connection is not None:
            try:
                self._connection.close()
            except OSError:
                pass
        self._connection = None
        self._active = False

    def _connect(self) -> None:
        if not hasattr(socket, "AF_UNIX"):
            raise OSError("The shared display requires Unix socket support")
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(1.0)
        try:
            connection.connect(self._socket_path)
            send_packet(connection, {"command": "status"})
            reply, payload = read_packet(connection)
            if payload:
                raise OSError("Unexpected display bridge reply payload")
            self._apply_reply(reply)
            if not reply["ok"]:
                raise OSError(str(reply.get("error", "Display bridge unavailable")))
        except OSError:
            connection.close()
            raise
        if self._ever_connected:
            self._activity_pending = True
        self._ever_connected = True
        self._connection = connection

    def _request(self, command: str, payload: bytes = b"", **fields) -> dict:
        with self._lock:
            if self._connection is None:
                self._connect()
            try:
                send_packet(self._connection, dict(command=command, revision=self._revision, **fields), payload)
                reply, response_payload = read_packet(self._connection)
                if response_payload:
                    raise OSError("Unexpected display bridge reply payload")
                self._apply_reply(reply)
            except OSError:
                self._disconnect()
                raise
            if not reply["ok"]:
                raise OSError(str(reply.get("error", "Display bridge request rejected")))
            return reply

    def display(self, image) -> None:
        if image.size != (self._width, self._height):
            raise OSError("Clock image dimensions do not match the display")
        if not 0 < self._width <= MAX_DIMENSION or not 0 < self._height <= MAX_DIMENSION:
            raise OSError("Shared display dimensions must not exceed 240 pixels")
        self._request(
            "display", image.convert("RGB").tobytes(),
            width=self._width, height=self._height, rotation=self._rotation,
            backlight=self._backlight,
        )

    def set_backlight(self, on: bool) -> None:
        self._backlight = bool(on)
        if self._active:
            self._request("backlight", backlight=self._backlight)

    def consume_activity(self) -> bool:
        self._request("status")
        with self._lock:
            changed = self._activity_pending
            self._activity_pending = False
            return changed

    def heartbeat(self) -> None:
        if self._active:
            self._request("heartbeat")

    def release(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._request("release")
            self._active = False

    def close(self) -> None:
        with self._lock:
            try:
                self.release()
            except OSError:
                pass
            finally:
                self._disconnect()


def managed_display_class(base_class, on_created=None, *, lease_seconds=DEFAULT_LEASE_SECONDS, clock=time.monotonic):
    """Wrap native writes and IPC writes with the same hardware lock."""

    class ManagedDisplay(base_class):
        def __init__(self, *args, **kwargs):
            # The base constructor can call set_backlight, so state comes first.
            self._bridge_lock = threading.RLock()
            self._native_frame = None
            self._native_backlight = True
            self._activity_revision = 0
            self._overlay_client = None
            self._lease_until = 0.0
            self._owner_rotation = kwargs.get("rotation", 90)
            super().__init__(*args, **kwargs)
            if on_created is not None:
                on_created(self)

        def _restore_locked(self) -> None:
            self._overlay_client = None
            self._lease_until = 0.0
            if self._native_frame is not None:
                base_class.display(self, self._native_frame)
            base_class.set_backlight(self, self._native_backlight)

        def display(self, image) -> None:
            with self._bridge_lock:
                self._native_frame = image.copy()
                self._activity_revision += 1
                self._overlay_client = None
                self._lease_until = 0.0
                base_class.display(self, image)
                base_class.set_backlight(self, self._native_backlight)

        def set_backlight(self, on) -> None:
            with self._bridge_lock:
                self._native_backlight = bool(on)
                self._activity_revision += 1
                if self._overlay_client is not None:
                    self._restore_locked()
                else:
                    base_class.set_backlight(self, on)

        def native_activity(self) -> None:
            with self._bridge_lock:
                self._activity_revision += 1
                if self._overlay_client is not None:
                    self._restore_locked()

        def expire_lease(self) -> None:
            with self._bridge_lock:
                if self._overlay_client is not None and clock() >= self._lease_until:
                    self._restore_locked()

        def release_overlay(self, client=None) -> None:
            with self._bridge_lock:
                if self._overlay_client is not None and (client is None or self._overlay_client is client):
                    self._restore_locked()

        def handle_request(self, client, header: dict, payload: bytes) -> dict:
            with self._bridge_lock:
                self.expire_lease()
                command = header.get("command")
                error = None
                if not isinstance(command, str):
                    error = "Invalid display bridge command"
                elif command in {"display", "backlight", "heartbeat"} and (
                    type(header.get("revision")) is not int or header["revision"] != self._activity_revision
                ):
                    error = "Native display activity changed"
                elif command == "display":
                    width, height, rotation = header.get("width"), header.get("height"), header.get("rotation")
                    if (type(width) is not int or type(height) is not int
                            or not 0 < width <= MAX_DIMENSION or not 0 < height <= MAX_DIMENSION
                            or type(rotation) is not int or rotation not in {0, 90, 180, 270}
                            or len(payload) != width * height * 3
                            or type(header.get("backlight")) is not bool):
                        error = "Invalid clock frame"
                    else:
                        from PIL import Image
                        image = Image.frombytes("RGB", (width, height), payload)
                        # Native ST7789 rotates its input; apply only the difference.
                        image = image.rotate((rotation - self._owner_rotation) % 360)
                        base_class.display(self, image)
                        base_class.set_backlight(self, header["backlight"])
                        self._overlay_client = client
                        self._lease_until = clock() + lease_seconds
                elif payload:
                    error = "Unexpected display bridge payload"
                elif command == "backlight":
                    if type(header.get("backlight")) is not bool:
                        error = "Invalid backlight value"
                    elif self._overlay_client is client:
                        base_class.set_backlight(self, header["backlight"])
                        self._lease_until = clock() + lease_seconds
                elif command == "heartbeat":
                    if self._overlay_client is client:
                        self._lease_until = clock() + lease_seconds
                elif command == "release":
                    self.release_overlay(client)
                elif command != "status":
                    error = "Unknown display bridge command"
                return {
                    "ok": error is None, "activity": self._activity_revision,
                    "active": self._overlay_client is client, "error": error,
                }

    return ManagedDisplay


class DisplayBridgeServer:
    def __init__(self, owner, socket_path: str):
        self._owner = owner
        self._socket_path = Path(socket_path)
        self._listener: socket.socket | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._clients = set()
        self._clients_lock = threading.Lock()

    def start(self) -> None:
        if not hasattr(socket, "AF_UNIX"):
            raise OSError("The shared display requires Unix socket support")
        if self._socket_path.exists():
            if not stat.S_ISSOCK(self._socket_path.stat().st_mode):
                raise OSError("Display bridge path already exists and is not a socket")
            self._socket_path.unlink()
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        bound = False
        try:
            listener.bind(str(self._socket_path))
            bound = True
            os.chmod(self._socket_path, 0o600)
            listener.listen(2)
            listener.settimeout(0.25)
        except OSError:
            listener.close()
            if bound:
                self._socket_path.unlink(missing_ok=True)
            raise
        self._listener = listener
        self._thread = threading.Thread(target=self._serve, name="display-bridge", daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        while not self._stop.is_set():
            self._owner.expire_lease()
            try:
                connection, _address = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            connection.settimeout(10.0)
            with self._clients_lock:
                self._clients.add(connection)
            threading.Thread(target=self._serve_client, args=(connection,), daemon=True).start()

    def _serve_client(self, connection: socket.socket) -> None:
        client = object()
        try:
            while not self._stop.is_set():
                header, payload = read_packet(connection)
                send_packet(connection, self._owner.handle_request(client, header, payload))
        except (OSError, ValueError):
            pass
        finally:
            try:
                self._owner.release_overlay(client)
            finally:
                connection.close()
                with self._clients_lock:
                    self._clients.discard(connection)

    def stop(self) -> None:
        self._stop.set()
        if self._listener is not None:
            self._listener.close()
        with self._clients_lock:
            for connection in self._clients:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        self._owner.release_overlay()
        if self._listener is not None:
            self._socket_path.unlink(missing_ok=True)
