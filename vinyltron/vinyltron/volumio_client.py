import concurrent.futures
import logging
import threading
from typing import Callable, Dict, Optional

import requests
import socketio

log = logging.getLogger(__name__)


class VolumioClient:
    """Subscribes to Volumio pushState via Socket.io with REST fallback."""

    RECONNECT_BASE = 2
    RECONNECT_MAX = 30

    def __init__(self, host: str, port: int, on_state: Callable[[Dict], None]):
        self._url = f"http://{host}:{port}"
        self._on_state = on_state
        self._sio = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="volumio-state")
        self._register_handlers()

    def _register_handlers(self):
        @self._sio.on('pushState')
        def on_push(data):
            # Submit to worker thread — never block the sio event loop (heartbeats must flow)
            self._executor.submit(self._on_state, self._normalize(data))

        @self._sio.on('connect')
        def on_connect():
            log.info("Connected to Volumio at %s", self._url)
            self._sio.emit('getState', '')

        @self._sio.on('disconnect')
        def on_disconnect():
            log.warning("Disconnected from Volumio")

    def _normalize(self, state: Dict) -> Dict:
        albumart = state.get('albumart', '')
        if albumart and albumart.startswith('/'):
            state['albumart'] = self._url + albumart
        return state

    def _run(self):
        delay = self.RECONNECT_BASE
        while not self._stop.is_set():
            try:
                self._sio.connect(self._url, transports=['websocket'])
                self._sio.wait()
                delay = self.RECONNECT_BASE  # clean disconnect — reconnect quickly
            except Exception as e:
                log.warning("Socket.io error: %s — retrying REST fallback", e)
                self._rest_fallback()
            finally:
                try:
                    self._sio.disconnect()
                except Exception:
                    pass

            if self._stop.is_set():
                break

            log.info("Reconnecting in %ds...", delay)
            self._stop.wait(delay)
            delay = min(delay * 2, self.RECONNECT_MAX)

    def _rest_fallback(self):
        try:
            r = requests.get(f"{self._url}/api/v1/getstate", timeout=5)
            if r.ok:
                self._executor.submit(self._on_state, self._normalize(r.json()))
        except Exception as e:
            log.debug("REST fallback failed: %s", e)

    def request_state(self):
        try:
            self._sio.emit('getState', '')
        except Exception:
            pass

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True, name="volumio-client")
        self._thread.start()

    def stop(self):
        self._stop.set()
        try:
            self._sio.disconnect()
        except Exception:
            pass
        if self._thread:
            self._thread.join(timeout=5)
        self._executor.shutdown(wait=False)
