#!/usr/bin/env python3
import logging
import signal
import socket
import sys
import threading
import time
from io import BytesIO
from typing import Dict, Optional

import requests
import toml
from PIL import Image

from display import Display
from screensavers import BriansBrain, ChaosGame, GrayScott, LangtonsAnt
from volumio_client import VolumioClient
from weather import MockWeatherRenderer

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(name)s %(levelname)s %(message)s',
    handlers=[logging.StreamHandler()]
)
logging.getLogger('socketio').setLevel(logging.WARNING)
logging.getLogger('engineio').setLevel(logging.WARNING)
log = logging.getLogger('vinyltron')

VERSION_PATH = 'VERSION'


FORMAT_COLORS = {
    'mp3': (0, 255, 255),
    'lossless': (255, 255, 255),
    'dsd': (220, 0, 220),
    'spotify': (0, 220, 80),
}

TRACK_TYPE_CATEGORIES = {
    'mp3': 'mp3',
    'aac': 'mp3',
    'ogg': 'mp3',
    'opus': 'mp3',
    'wma': 'mp3',
    'mp4': 'mp3',
    'spotify': 'spotify',
    'spop': 'spotify',
    'webradio': 'mp3',
    'radio': 'mp3',
    'flac': 'lossless',
    'alac': 'lossless',
    'wav': 'lossless',
    'aiff': 'lossless',
    'ape': 'lossless',
    'dsd': 'dsd',
    'dsf': 'dsd',
    'dff': 'dsd',
}


FALLBACK_DELAY_SECONDS = 1.5
MPD_HOST = '127.0.0.1'
MPD_PORT = 6600
MPD_TIMEOUT_SECONDS = 0.75
SCREENSAVER_FPS_DEFAULT = 6
SCREENSAVER_FPS_MIN = 2
SCREENSAVER_FPS_MAX = 24
SCREENSAVER_RESET_SECONDS_DEFAULT = 300
WEATHER_FPS_DEFAULT = 1
WEATHER_FPS_MIN = 1
WEATHER_FPS_MAX = 10
STARTUP_DELAY_SECONDS_DEFAULT = 5
VOLUMIO_READY_POLL_SECONDS = 10
VOLUMIO_READY_TIMEOUT_SECONDS = 3
VOLUMIO_READY_MAX_WAIT_SECONDS = 300


class Vinyltron:
    def __init__(self, config_path: str = 'config.toml'):
        self._config_path = config_path
        self._cfg = toml.load(config_path)
        self._version = self._load_version()
        self._display: Optional[Display] = None
        self._client = VolumioClient(
            host=self._cfg['volumio']['host'],
            port=self._cfg['volumio']['port'],
            on_state=self._on_state,
        )
        self._current_albumart: Optional[str] = None
        self._current_album_key: Optional[str] = None
        self._current_track_key: Optional[str] = None
        self._pending_track_key: Optional[str] = None
        self._state_seq = 0
        self._state_lock = threading.Lock()
        self._last_state: Dict = {}
        self._display_on: bool = self._effective_display_on()
        self._overlay_lock = threading.Lock()
        self._badge_timer: Optional[threading.Timer] = None
        self._badge_visible = False
        self._fallback_visible = False
        self._fallback_timer: Optional[threading.Timer] = None
        self._fallback_timer_id = 0
        self._idle_rotation_timer: Optional[threading.Timer] = None
        self._idle_rotation_timer_id = 0
        self._screensaver_timer: Optional[threading.Timer] = None
        self._screensaver_timer_id = 0
        self._idle_start_timer: Optional[threading.Timer] = None
        self._idle_start_timer_id = 0
        self._screensaver_reset_timer: Optional[threading.Timer] = None
        self._screensaver_reset_timer_id = 0
        self._screensaver: Optional[object] = None
        self._weather_timer: Optional[threading.Timer] = None
        self._weather_timer_id = 0
        self._weather_renderer: Optional[MockWeatherRenderer] = None
        self._volumio_ready = False
        self._volumio_ready_at: Optional[float] = None
        self._volumio_ready_timeout_logged = False
        self._progress_timer: Optional[threading.Timer] = None
        self._progress_seek_ms = 0
        self._progress_duration_ms = 0
        self._progress_last_width: Optional[int] = None
        self._progress_playing = False
        self._progress_last_update = time.monotonic()
        self._service_started_at = time.monotonic()
        self._running = True
        log.info("Vinyltron version %s", self._version)
        self._log_runtime_config("startup")
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGHUP, self._reload)

    def _ensure_display(self) -> Display:
        if self._display is None:
            log.info("Initializing matrix display")
            self._display = Display(self._cfg)
        return self._display

    def _clear_display_if_initialized(self):
        if self._display is not None:
            self._display.clear()

    def _clear_badge_if_initialized(self):
        if self._display is not None:
            self._display.clear_badge()

    def _clear_progress_if_initialized(self):
        if self._display is not None:
            self._display.clear_progress()

    def _on_state(self, state: Dict):
        self._last_state = dict(state)
        effective_on = self._effective_display_on(state)
        if effective_on != self._display_on:
            self._display_on = effective_on
            if effective_on:
                self._clear_current_track_state()
                log.info("Display on by playback artwork")
            else:
                self._clear_display_for_power_off("Display off by schedule")
                return

        if not self._display_on:
            return

        status = state.get('status', 'stop')
        albumart = state.get('albumart', '')

        if status not in ('play', 'pause'):
            with self._overlay_lock:
                if self._fallback_visible:
                    self._clear_playback_overlays_on_fallback_locked(status)
                    clear_track_state = True
                else:
                    self._schedule_fallback_locked(status)
                    clear_track_state = False
            if clear_track_state:
                self._clear_current_track_state()
            return

        if not self._volumio_artwork_enabled():
            self._on_idle_artwork_state(state, albumart, status)
            return

        with self._overlay_lock:
            self._cancel_fallback_locked()
            self._cancel_idle_rotation_locked()
            self._cancel_screensaver_locked()
            self._cancel_weather_locked()

        if not albumart:
            return

        track_key = self._track_key(state, albumart)
        album_key = self._album_key(state, albumart)

        with self._state_lock:
            is_current_track = track_key == self._current_track_key
            is_pending_track = track_key == self._pending_track_key

        if is_current_track:
            self._sync_progress_from_state(state)
            return
        if is_pending_track:
            return

        log.info("New track: %s — %s", state.get('artist'), state.get('title'))
        self._log_format_state(state)

        with self._state_lock:
            self._state_seq += 1
            seq = self._state_seq
            album_changed = album_key != self._current_album_key
            self._current_track_key = track_key
            self._pending_track_key = track_key

        with self._overlay_lock:
            self._cancel_overlay_locked()
            self._cancel_progress_locked(clear_visible=album_changed)
            if album_changed and self._badge_visible:
                self._clear_badge_if_initialized()
            self._badge_visible = False

        worker = threading.Thread(
            target=self._load_track_image,
            args=(seq, dict(state), albumart, track_key, album_key, album_changed),
            daemon=True,
            name="albumart-fetch",
        )
        worker.start()

    def _on_idle_artwork_state(self, state: Dict, albumart: str, status: str):
        with self._overlay_lock:
            self._ensure_fallback_background_locked(status)

        track_key = self._track_key(state, albumart)
        album_key = self._album_key(state, albumart)

        with self._state_lock:
            is_current_track = track_key == self._current_track_key

        if is_current_track:
            self._sync_progress_from_state(state)
            return

        log.info("New track metadata over idle image: %s — %s", state.get('artist'), state.get('title'))
        self._log_format_state(state)

        with self._state_lock:
            album_changed = album_key != self._current_album_key
            self._current_albumart = albumart
            self._current_album_key = album_key
            self._current_track_key = track_key
            self._pending_track_key = None

        self._sync_progress_from_state(state)
        if album_changed:
            self._show_format_badge(state)

    def _load_track_image(self, seq: int, state: Dict, albumart: str, track_key: str, album_key: str, album_changed: bool):
        img = self._fetch_albumart(albumart)
        if not self._display_on:
            return
        with self._state_lock:
            if seq != self._state_seq or track_key != self._pending_track_key:
                return

        if img:
            with self._overlay_lock:
                if album_changed or albumart != self._current_albumart:
                    self._ensure_display().show_image(img)
                    self._fallback_visible = False
            with self._state_lock:
                self._current_albumart = albumart
                self._current_album_key = album_key
                self._current_track_key = track_key
                self._pending_track_key = None
            self._sync_progress_from_state(state)
            if album_changed:
                self._show_format_badge(state)
        else:
            with self._state_lock:
                if seq != self._state_seq or track_key != self._pending_track_key:
                    return
                self._current_albumart = albumart
                self._current_album_key = album_key
                self._current_track_key = track_key
                self._pending_track_key = None
            with self._overlay_lock:
                self._cancel_overlay_locked()
                self._cancel_progress_locked(clear_visible=album_changed)
                self._badge_visible = False
                self._show_or_start_fallback_locked('albumart unavailable')
            log.info("Album art unavailable; showing fallback for current track")
            with self._state_lock:
                if seq != self._state_seq or track_key != self._current_track_key:
                    return
            self._sync_progress_from_state(state)
            if album_changed:
                self._show_format_badge(state)

    def _show_format_badge(self, state: Dict):
        if not self._cfg.get('overlays', {}).get('format_badge', False):
            return

        category = self._format_category(state)
        label = self._format_label(state, category)
        color_rgb = FORMAT_COLORS[category]
        duration = int(self._cfg.get('overlays', {}).get('badge_duration', 10))
        log.info("Format overlay: label=%r category=%s", label, category)

        with self._overlay_lock:
            self._cancel_overlay_locked()
            self._ensure_display().show_text(label, color_rgb)
            self._badge_visible = True
            self._badge_timer = threading.Timer(duration, self._clear_badge_from_timer)
            self._badge_timer.daemon = True
            self._badge_timer.start()

    def _format_category(self, state: Dict) -> str:
        service = self._normalized(state.get('service'))
        if service == 'spop':
            return 'spotify'

        track_type = state.get('trackType')
        if track_type is None:
            return 'mp3'

        normalized = self._normalized(track_type)
        if not normalized or normalized == 'nan':
            return 'mp3'
        if normalized == 'm4a' and state.get('bitdepth'):
            return 'lossless'

        return TRACK_TYPE_CATEGORIES.get(normalized, 'mp3')

    def _format_label(self, state: Dict, category: str) -> str:
        if category == 'spotify':
            bitrate = self._bitrate_label(state.get('bitrate')) or self._bitrate_label(state.get('samplerate'))
            codec = self._normalized(state.get('codec')).upper()
            if codec and bitrate:
                return "%s %s" % (codec, bitrate)
            return bitrate or codec or 'SPOTIFY'
        if category == 'dsd':
            return self._dsd_label(state) or 'DSD'

        track_type = self._normalized(state.get('trackType')).upper()
        if track_type == 'M4A' and state.get('bitdepth'):
            track_type = 'ALAC'
        if not track_type or track_type == 'NAN':
            track_type = 'AUDIO'

        bitrate = self._bitrate_label(state.get('bitrate'))
        bitdepth = self._bitdepth_label(state.get('bitdepth'))
        sample_rate = self._sample_rate_label(state.get('samplerate'))
        if category == 'mp3':
            if not bitrate:
                bitrate = self._mpd_bitrate_label(state)
            if bitrate:
                return "%s %s" % (track_type, bitrate)
            return track_type
        if bitdepth and sample_rate and category == 'lossless':
            return "%s/%s" % (bitdepth, sample_rate)
        if bitdepth:
            return "%s %s" % (track_type, bitdepth)
        if sample_rate and category == 'lossless':
            return "%s %s" % (track_type, sample_rate)
        return track_type

    def _bitrate_label(self, bitrate) -> Optional[str]:
        if bitrate is None:
            return None
        text = str(bitrate).strip().lower()
        if not text:
            return None
        digits = ''.join(ch for ch in text if ch.isdigit())
        if not digits:
            return None
        value = int(digits)
        if value <= 0:
            return None
        return "%sK" % value

    def _mpd_bitrate_label(self, state: Dict) -> Optional[str]:
        if self._normalized(state.get('service')) != 'mpd':
            return None

        bitrate = self._mpd_status_value('bitrate')
        label = self._bitrate_label(bitrate)
        if label:
            log.info("MPD bitrate fallback: bitrate=%s label=%r", bitrate, label)
        return label

    def _mpd_status_value(self, key: str) -> Optional[str]:
        prefix = "%s:" % key
        try:
            with socket.create_connection((MPD_HOST, MPD_PORT), timeout=MPD_TIMEOUT_SECONDS) as sock:
                sock.settimeout(MPD_TIMEOUT_SECONDS)
                sock.sendall(b"status\nclose\n")
                chunks = []
                while True:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    chunks.append(chunk)
            text = b"".join(chunks).decode('utf-8', 'replace')
        except Exception as e:
            log.warning("MPD status lookup failed: %s", e)
            return None

        for line in text.splitlines():
            if line.startswith(prefix):
                return line[len(prefix):].strip()
        return None

    def _bitdepth_label(self, bitdepth) -> Optional[str]:
        if bitdepth is None:
            return None
        digits = ''.join(ch for ch in str(bitdepth) if ch.isdigit())
        return digits or None

    def _sample_rate_label(self, samplerate) -> Optional[str]:
        if samplerate is None:
            return None
        text = str(samplerate).strip().lower().replace('khz', '').replace('hz', '')
        text = text.strip()
        if not text:
            return None
        try:
            value = float(text)
        except ValueError:
            return None
        if value > 1000:
            value = value / 1000.0
        if abs(value - round(value)) < 0.05:
            return str(int(round(value)))
        return ("%.1f" % value).rstrip('0').rstrip('.')

    def _dsd_label(self, state: Dict) -> Optional[str]:
        for key in ('samplerate', 'bitrate'):
            text = str(state.get(key) or '').upper()
            if 'DSD' in text:
                return text.replace(' ', '')
        samplerate = self._mhz_sample_rate(state.get('samplerate'))
        if samplerate is None:
            return None
        dsd_rate = int(round(samplerate / 2.8224)) * 64
        if dsd_rate < 64:
            return None
        return "DSD%d" % dsd_rate

    def _mhz_sample_rate(self, samplerate) -> Optional[float]:
        if samplerate is None:
            return None
        text = str(samplerate).strip().lower()
        unit = 'mhz' if 'mhz' in text else 'khz' if 'khz' in text else 'hz' if 'hz' in text else ''
        text = text.replace('mhz', '').replace('khz', '').replace('hz', '').strip()
        try:
            value = float(text)
        except ValueError:
            return None
        if unit == 'khz':
            return value / 1000.0
        if unit == 'hz':
            return value / 1000000.0
        return value

    def _normalized(self, value) -> str:
        if value is None:
            return ''
        return str(value).strip().lower()

    def _track_key(self, state: Dict, albumart: str) -> str:
        parts = (
            state.get('service') or '',
            state.get('artist') or '',
            state.get('album') or '',
            state.get('title') or '',
            albumart,
        )
        return "\x1f".join(str(part) for part in parts)

    def _album_key(self, state: Dict, albumart: str) -> str:
        album = state.get('album')
        artist = state.get('albumartist') or state.get('artist')
        if album:
            return "%s\x1f%s" % (artist or '', album)
        return "%s\x1f%s" % (artist or '', albumart)

    def _clear_badge_from_timer(self):
        with self._overlay_lock:
            self._badge_timer = None
            if self._badge_visible:
                self._clear_badge_if_initialized()
                self._badge_visible = False

    def _cancel_overlay_locked(self):
        if self._badge_timer:
            self._badge_timer.cancel()
            self._badge_timer = None

    def _schedule_fallback_locked(self, status: str):
        if self._fallback_timer or self._fallback_visible:
            return
        self._fallback_timer_id += 1
        timer_id = self._fallback_timer_id
        log.info(
            "Status: %s — scheduling fallback in %.1fs",
            status,
            FALLBACK_DELAY_SECONDS,
        )
        self._fallback_timer = threading.Timer(
            FALLBACK_DELAY_SECONDS,
            self._show_fallback_from_timer,
            args=(timer_id, status),
        )
        self._fallback_timer.daemon = True
        self._fallback_timer.start()

    def _cancel_fallback_locked(self):
        if self._fallback_timer:
            self._fallback_timer.cancel()
            self._fallback_timer = None
        self._fallback_timer_id += 1

    def _ensure_fallback_background_locked(self, status: str):
        if self._fallback_visible:
            return
        self._cancel_fallback_locked()
        self._show_or_start_fallback_locked(status)

    def _clear_playback_overlays_on_fallback_locked(self, status: str):
        self._cancel_overlay_locked()
        self._cancel_progress_locked(clear_visible=True)
        if self._badge_visible:
            self._clear_badge_if_initialized()
        self._badge_visible = False
        self._schedule_active_fallback_locked(status)

    def _clear_current_track_state(self):
        with self._state_lock:
            self._state_seq += 1
            self._current_albumart = None
            self._current_album_key = None
            self._current_track_key = None
            self._pending_track_key = None

    def _schedule_idle_rotation_locked(self, status: str):
        if self._screensaver_enabled() or self._weather_enabled():
            self._cancel_idle_rotation_locked()
            return
        if not self._fallback_rotation_enabled():
            self._cancel_idle_rotation_locked()
            return
        if self._idle_rotation_timer:
            return
        seconds = self._fallback_rotate_seconds()
        self._idle_rotation_timer_id += 1
        timer_id = self._idle_rotation_timer_id
        log.info("Idle random image rotation scheduled in %ss", seconds)
        self._idle_rotation_timer = threading.Timer(
            seconds,
            self._rotate_idle_image_from_timer,
            args=(timer_id, status),
        )
        self._idle_rotation_timer.daemon = True
        self._idle_rotation_timer.start()

    def _cancel_idle_rotation_locked(self):
        if self._idle_rotation_timer:
            self._idle_rotation_timer.cancel()
            self._idle_rotation_timer = None
        self._idle_rotation_timer_id += 1

    def _screensaver_enabled(self) -> bool:
        fallback = self._cfg.get('fallback', {})
        mode = str(fallback.get('mode', 'single')).strip().lower()
        return mode in ('screensaver', 'screensaver_brians_brain')

    def _weather_enabled(self) -> bool:
        fallback = self._cfg.get('fallback', {})
        mode = str(fallback.get('mode', 'single')).strip().lower()
        return mode == 'weather'

    def _screensaver_engine(self) -> str:
        cfg = self._cfg.get('screensaver', {})
        engine = str(cfg.get('engine', 'brians_brain')).strip().lower()
        if engine in ('brians_brain', 'langtons_ant', 'chaos_game', 'gray_scott'):
            return engine
        log.warning("Unknown screensaver engine %r; using brians_brain", engine)
        return 'brians_brain'

    def _screensaver_fps(self) -> int:
        try:
            fps = int(self._cfg.get('screensaver', {}).get('fps', SCREENSAVER_FPS_DEFAULT))
        except (TypeError, ValueError):
            fps = SCREENSAVER_FPS_DEFAULT
        return max(SCREENSAVER_FPS_MIN, min(SCREENSAVER_FPS_MAX, fps))

    def _screensaver_reset_seconds(self) -> int:
        try:
            seconds = int(self._cfg.get('screensaver', {}).get(
                'reset_seconds',
                SCREENSAVER_RESET_SECONDS_DEFAULT,
            ))
        except (TypeError, ValueError):
            seconds = SCREENSAVER_RESET_SECONDS_DEFAULT
        return max(0, seconds)

    def _weather_fps(self) -> int:
        try:
            fps = int(self._cfg.get('weather', {}).get('fps', WEATHER_FPS_DEFAULT))
        except (TypeError, ValueError):
            fps = WEATHER_FPS_DEFAULT
        return max(WEATHER_FPS_MIN, min(WEATHER_FPS_MAX, fps))

    def _startup_delay_seconds(self) -> int:
        display_cfg = self._cfg.get('display', {})
        screensaver_cfg = self._cfg.get('screensaver', {})
        try:
            seconds = int(display_cfg.get(
                'startup_delay_seconds',
                screensaver_cfg.get('startup_delay_seconds', STARTUP_DELAY_SECONDS_DEFAULT),
            ))
        except (TypeError, ValueError):
            seconds = STARTUP_DELAY_SECONDS_DEFAULT
        return max(0, seconds)

    def _startup_delay_remaining(self) -> float:
        if self._volumio_ready_at is None:
            return self._startup_delay_seconds()
        remaining = self._startup_delay_seconds() - (
            time.monotonic() - self._volumio_ready_at
        )
        return max(0.0, remaining)

    def _volumio_status_url(self) -> str:
        # Always 127.0.0.1, not the configured [volumio].host: Vinyltron only ever runs
        # alongside Volumio on the same Pi, and checking readiness via the loopback
        # address avoids depending on mDNS (volumio.local) being resolvable this early
        # in boot.
        volumio = self._cfg.get('volumio', {})
        port = volumio.get('port', 3000)
        return "http://127.0.0.1:%s/status" % port

    def _refresh_volumio_ready(self) -> bool:
        if self._volumio_ready:
            return True
        try:
            r = requests.get(self._volumio_status_url(), timeout=VOLUMIO_READY_TIMEOUT_SECONDS)
            text = r.text.strip().lower() if r.ok else ''
        except Exception as e:
            log.info("Volumio readiness check failed: %s", e)
            return False
        if text == 'ready':
            self._volumio_ready = True
            self._volumio_ready_at = time.monotonic()
            log.info(
                "Volumio status ready; startup grace period=%ss",
                self._startup_delay_seconds(),
            )
            return True
        if text == 'error':
            log.warning("Volumio status endpoint reports error; keeping idle display deferred")
        else:
            log.info("Volumio status is %r; keeping idle display deferred", text or 'unavailable')
        return False

    def _volumio_ready_wait_exceeded(self) -> bool:
        elapsed = time.monotonic() - self._service_started_at
        if elapsed < VOLUMIO_READY_MAX_WAIT_SECONDS:
            return False
        if not self._volumio_ready_timeout_logged:
            log.warning(
                "Volumio not ready after %ss; showing idle display anyway",
                VOLUMIO_READY_MAX_WAIT_SECONDS,
            )
            self._volumio_ready_timeout_logged = True
        return True

    def _idle_ready_to_start(self) -> bool:
        if self._refresh_volumio_ready():
            return self._startup_delay_remaining() <= 0
        return self._volumio_ready_wait_exceeded()

    def _new_screensaver(self):
        cfg = self._cfg.get('screensaver', {})
        display_cfg = self._cfg.get('display', {})
        width = int(display_cfg.get('cols', 64))
        height = int(display_cfg.get('rows', 64))
        palette = str(cfg.get('palette', 'cyan_amber')).strip().lower()
        seed = str(cfg.get('seed', '') or '')
        engine = self._screensaver_engine()

        if engine == 'langtons_ant':
            return LangtonsAnt(
                width=width,
                height=height,
                palette=palette,
                ant_count=cfg.get('ant_count', 4),
                steps_per_frame=cfg.get('steps_per_frame', 96),
                seed=seed,
            )
        if engine == 'chaos_game':
            return ChaosGame(
                width=width,
                height=height,
                palette=palette,
                points_per_frame=cfg.get('points_per_frame', 320),
                fade=cfg.get('fade', 12),
                rotation_speed=cfg.get('rotation_speed', 2),
                seed=seed,
            )
        if engine == 'gray_scott':
            return GrayScott(
                width=width,
                height=height,
                palette=palette,
                feed=cfg.get('feed', 0.055),
                kill=cfg.get('kill', 0.062),
                grid_scale=cfg.get('grid_scale', 2),
                seed=seed,
            )

        return BriansBrain(
            width=width,
            height=height,
            palette=palette,
            density=cfg.get('density', 0.22),
            seed=seed,
        )

    def _new_weather_renderer(self) -> MockWeatherRenderer:
        cfg = self._cfg.get('weather', {})
        display_cfg = self._cfg.get('display', {})
        width = int(display_cfg.get('cols', 64))
        height = int(display_cfg.get('rows', 64))
        source = str(cfg.get('source', 'mock')).strip().lower()
        condition = str(cfg.get('mock_condition', 'partly_cloudy')).strip().lower()
        night = bool(cfg.get('mock_night', False))
        try:
            moon_phase = float(cfg.get('mock_moon_phase', 0.55))
        except (TypeError, ValueError):
            moon_phase = 0.55
        secondary_metric = str(cfg.get('secondary_metric', 'humidity')).strip().lower()
        try:
            latitude = float(cfg.get('latitude', 0.0))
            longitude = float(cfg.get('longitude', 0.0))
        except (TypeError, ValueError):
            latitude = 0.0
            longitude = 0.0
            source = 'mock'
        units = str(cfg.get('units', 'imperial')).strip().lower()
        night_icon = str(cfg.get('night_icon', 'moon')).strip().lower()
        try:
            refresh_minutes = int(cfg.get('refresh_minutes', 10))
        except (TypeError, ValueError):
            refresh_minutes = 10
        return MockWeatherRenderer(
            width=width,
            height=height,
            condition=condition,
            night=night,
            moon_phase=moon_phase,
            secondary_metric=secondary_metric,
            source=source,
            latitude=latitude,
            longitude=longitude,
            units=units,
            refresh_minutes=refresh_minutes,
            night_icon=night_icon,
        )

    def _show_or_start_fallback_locked(self, status: str):
        if not self._idle_ready_to_start():
            self._show_startup_idle_placeholder_locked(status)
            return
        self._start_idle_locked(status)

    def _start_idle_locked(self, status: str):
        if self._weather_enabled():
            self._start_weather_locked(status)
            return
        if self._screensaver_enabled():
            self._start_screensaver_locked(status)
            return
        self._cancel_weather_locked()
        self._cancel_screensaver_locked()
        self._ensure_display().show_fallback()
        self._fallback_visible = True
        self._schedule_idle_rotation_locked(status)

    def _schedule_active_fallback_locked(self, status: str):
        if not self._idle_ready_to_start():
            self._show_startup_idle_placeholder_locked(status)
            return
        if self._weather_enabled():
            if self._weather_renderer:
                self._schedule_weather_frame_locked(status)
            else:
                self._start_weather_locked(status)
            return
        if self._screensaver_enabled():
            if self._screensaver:
                self._schedule_screensaver_frame_locked(status)
            else:
                self._start_screensaver_locked(status)
            return
        self._cancel_weather_locked()
        self._cancel_screensaver_locked()
        self._schedule_idle_rotation_locked(status)

    def _start_weather_locked(self, status: str):
        self._cancel_idle_rotation_locked()
        self._cancel_idle_start_locked()
        self._cancel_screensaver_locked()
        if self._weather_renderer is None:
            self._weather_renderer = self._new_weather_renderer()
            log.info(
                "Starting weather idle display at %s FPS; source=%s condition=%s night=%r metric=%s",
                self._weather_fps(),
                self._cfg.get('weather', {}).get('source', 'mock'),
                self._cfg.get('weather', {}).get('mock_condition', 'partly_cloudy'),
                self._cfg.get('weather', {}).get('mock_night', False),
                self._cfg.get('weather', {}).get('secondary_metric', 'humidity'),
            )
        self._ensure_display().show_screensaver_frame(self._weather_renderer.frame())
        self._fallback_visible = True
        self._schedule_weather_frame_locked(status)

    def _start_screensaver_locked(self, status: str):
        self._cancel_idle_rotation_locked()
        self._cancel_idle_start_locked()
        self._cancel_weather_locked()
        if self._screensaver is None:
            self._screensaver = self._new_screensaver()
            log.info(
                "Starting %s screensaver at %s FPS; reset interval=%ss",
                self._screensaver_engine(),
                self._screensaver_fps(),
                self._screensaver_reset_seconds(),
            )
        self._ensure_display().show_screensaver_frame(self._screensaver.frame())
        self._fallback_visible = True
        self._schedule_screensaver_frame_locked(status)
        self._schedule_screensaver_reset_locked(status)

    def _show_startup_idle_placeholder_locked(self, status: str):
        self._cancel_screensaver_locked()
        self._cancel_weather_locked()
        self._cancel_idle_rotation_locked()
        self._fallback_visible = True
        self._schedule_idle_start_locked(status)

    def _schedule_idle_start_locked(self, status: str):
        if self._idle_start_timer:
            return
        seconds = self._startup_delay_remaining() if self._volumio_ready else VOLUMIO_READY_POLL_SECONDS
        if seconds <= 0:
            self._start_idle_locked(status)
            return
        self._idle_start_timer_id += 1
        timer_id = self._idle_start_timer_id
        log.info(
            "Keeping matrix uninitialized before idle display; Volumio ready=%r, next check in %.1fs",
            self._volumio_ready,
            seconds,
        )
        self._idle_start_timer = threading.Timer(
            seconds,
            self._start_idle_from_timer,
            args=(timer_id, status),
        )
        self._idle_start_timer.daemon = True
        self._idle_start_timer.start()

    def _schedule_screensaver_frame_locked(self, status: str):
        if self._screensaver_timer or not self._screensaver:
            return
        self._screensaver_timer_id += 1
        timer_id = self._screensaver_timer_id
        seconds = 1.0 / self._screensaver_fps()
        self._screensaver_timer = threading.Timer(
            seconds,
            self._show_screensaver_frame_from_timer,
            args=(timer_id, status),
        )
        self._screensaver_timer.daemon = True
        self._screensaver_timer.start()

    def _schedule_weather_frame_locked(self, status: str):
        if self._weather_timer or not self._weather_renderer:
            return
        self._weather_timer_id += 1
        timer_id = self._weather_timer_id
        seconds = 1.0 / self._weather_fps()
        self._weather_timer = threading.Timer(
            seconds,
            self._show_weather_frame_from_timer,
            args=(timer_id, status),
        )
        self._weather_timer.daemon = True
        self._weather_timer.start()

    def _schedule_screensaver_reset_locked(self, status: str):
        if self._screensaver_reset_timer or not self._screensaver:
            return
        seconds = self._screensaver_reset_seconds()
        if seconds <= 0:
            return
        self._screensaver_reset_timer_id += 1
        timer_id = self._screensaver_reset_timer_id
        self._screensaver_reset_timer = threading.Timer(
            seconds,
            self._reset_screensaver_from_timer,
            args=(timer_id, status),
        )
        self._screensaver_reset_timer.daemon = True
        self._screensaver_reset_timer.start()

    def _cancel_idle_start_locked(self):
        if self._idle_start_timer:
            self._idle_start_timer.cancel()
            self._idle_start_timer = None
        self._idle_start_timer_id += 1

    def _cancel_screensaver_locked(self):
        self._cancel_idle_start_locked()
        if self._screensaver_timer:
            self._screensaver_timer.cancel()
            self._screensaver_timer = None
        self._screensaver_timer_id += 1
        if self._screensaver_reset_timer:
            self._screensaver_reset_timer.cancel()
            self._screensaver_reset_timer = None
        self._screensaver_reset_timer_id += 1
        self._screensaver = None

    def _cancel_weather_locked(self):
        self._cancel_idle_start_locked()
        if self._weather_timer:
            self._weather_timer.cancel()
            self._weather_timer = None
        self._weather_timer_id += 1
        self._weather_renderer = None

    def _start_idle_from_timer(self, timer_id: int, status: str):
        with self._overlay_lock:
            if timer_id != self._idle_start_timer_id:
                return
            self._idle_start_timer = None
            if not self._display_on or not self._fallback_visible:
                self._cancel_screensaver_locked()
                return
            if self._idle_ready_to_start():
                self._start_idle_locked(status)
            else:
                self._schedule_idle_start_locked(status)

    def _show_screensaver_frame_from_timer(self, timer_id: int, status: str):
        with self._overlay_lock:
            if timer_id != self._screensaver_timer_id:
                return
            self._screensaver_timer = None
            if not self._display_on or not self._fallback_visible or not self._screensaver_enabled():
                self._cancel_screensaver_locked()
                return
            if not self._screensaver:
                self._screensaver = self._new_screensaver()
                self._schedule_screensaver_reset_locked(status)
            self._ensure_display().show_screensaver_frame(self._screensaver.frame())
            self._schedule_screensaver_frame_locked(status)

    def _show_weather_frame_from_timer(self, timer_id: int, status: str):
        with self._overlay_lock:
            if timer_id != self._weather_timer_id:
                return
            self._weather_timer = None
            if not self._display_on or not self._fallback_visible or not self._weather_enabled():
                self._cancel_weather_locked()
                return
            if not self._weather_renderer:
                self._weather_renderer = self._new_weather_renderer()
            self._ensure_display().show_screensaver_frame(self._weather_renderer.frame())
            self._schedule_weather_frame_locked(status)

    def _reset_screensaver_from_timer(self, timer_id: int, status: str):
        with self._overlay_lock:
            if timer_id != self._screensaver_reset_timer_id:
                return
            self._screensaver_reset_timer = None
            if not self._display_on or not self._fallback_visible or not self._screensaver_enabled():
                self._cancel_screensaver_locked()
                return
            log.info("Resetting %s screensaver state", self._screensaver_engine())
            self._screensaver = self._new_screensaver()
            self._ensure_display().show_screensaver_frame(self._screensaver.frame())
            self._schedule_screensaver_frame_locked(status)
            self._schedule_screensaver_reset_locked(status)

    def _rotate_idle_image_from_timer(self, timer_id: int, status: str):
        with self._overlay_lock:
            if timer_id != self._idle_rotation_timer_id:
                return
            self._idle_rotation_timer = None
            if not self._display_on or not self._fallback_rotation_enabled():
                return
            self._ensure_display().show_fallback()
            self._fallback_visible = True
            self._schedule_active_fallback_locked(status)
        log.info("Status: %s — rotated idle random image", status)

    def _show_fallback_from_timer(self, timer_id: int, status: str):
        with self._overlay_lock:
            if timer_id != self._fallback_timer_id:
                return
            self._fallback_timer = None
            self._cancel_overlay_locked()
            self._cancel_progress_locked()
            self._badge_visible = False
            self._show_or_start_fallback_locked(status)
        with self._state_lock:
            self._state_seq += 1
            self._current_albumart = None
            self._current_album_key = None
            self._current_track_key = None
            self._pending_track_key = None
        log.info("Status: %s — showing fallback", status)

    def _sync_progress_from_state(self, state: Dict):
        if self._progress_height() <= 0:
            with self._overlay_lock:
                self._cancel_progress_locked(clear_visible=True)
            return

        duration_ms = self._duration_ms(state.get('duration'))
        seek_ms = self._seek_ms(state.get('seek'))
        status = state.get('status', 'stop')

        if duration_ms <= 0:
            with self._overlay_lock:
                self._cancel_progress_locked(clear_visible=True)
            return

        with self._overlay_lock:
            was_playing = self._progress_playing
            old_duration_ms = self._progress_duration_ms
            seek_delta_ms = abs(self._progress_seek_ms - seek_ms)
            should_reschedule = (
                self._progress_timer is None or
                old_duration_ms != duration_ms or
                was_playing != (status == 'play') or
                seek_delta_ms > self._progress_seek_tolerance_ms(duration_ms)
            )

            if should_reschedule:
                self._cancel_progress_timer_locked()

            self._progress_duration_ms = duration_ms
            self._progress_seek_ms = max(0, min(duration_ms, seek_ms))
            self._progress_playing = status == 'play'
            self._progress_last_update = time.monotonic()
            self._draw_progress_locked(force=False)

            if should_reschedule and self._progress_playing and self._progress_seek_ms < self._progress_duration_ms:
                self._schedule_progress_locked()

    def _progress_tick(self):
        with self._overlay_lock:
            if not self._progress_playing or self._progress_duration_ms <= 0:
                self._progress_timer = None
                return

            now = time.monotonic()
            elapsed_ms = int((now - self._progress_last_update) * 1000)
            self._progress_seek_ms = min(
                self._progress_duration_ms,
                self._progress_seek_ms + max(0, elapsed_ms),
            )
            self._progress_last_update = now
            self._draw_progress_locked(force=False)

            self._progress_timer = None
            if self._progress_seek_ms < self._progress_duration_ms:
                self._schedule_progress_locked()

    def _draw_progress_locked(self, force: bool = False):
        width = self._progress_width()
        if not force and width == self._progress_last_width:
            return

        overlays = self._cfg.get('overlays', {})
        height = self._progress_height()
        foreground = self._rgb_tuple(overlays.get('progress_bar_foreground', [255, 255, 255]), (255, 255, 255))
        background = self._rgb_tuple(overlays.get('progress_bar_background'), None)

        self._ensure_display().show_progress(width, height, foreground, background)
        self._progress_last_width = width

    def _progress_width(self) -> int:
        if self._progress_duration_ms <= 0:
            return 0
        cols = self._progress_cols()
        return int(float(cols) * self._progress_seek_ms / self._progress_duration_ms)

    def _schedule_progress_locked(self):
        delay_ms = self._next_progress_delay_ms()
        self._progress_timer = threading.Timer(delay_ms / 1000.0, self._progress_tick)
        self._progress_timer.daemon = True
        self._progress_timer.start()

    def _next_progress_delay_ms(self) -> int:
        cols = self._progress_cols()
        current_width = self._progress_width()
        if current_width >= cols:
            return 0

        next_width = current_width + 1
        next_seek_ms = int(round(float(next_width) * self._progress_duration_ms / cols))
        return max(100, next_seek_ms - self._progress_seek_ms)

    def _cancel_progress_locked(self, clear_visible: bool = False):
        self._cancel_progress_timer_locked()
        self._progress_playing = False
        self._progress_seek_ms = 0
        self._progress_duration_ms = 0
        self._progress_last_width = None
        self._progress_last_update = time.monotonic()
        if clear_visible:
            self._clear_progress_if_initialized()

    def _cancel_progress_timer_locked(self):
        if self._progress_timer:
            self._progress_timer.cancel()
            self._progress_timer = None

    def _progress_cols(self) -> int:
        try:
            return max(1, int(self._cfg.get('display', {}).get('cols', 64)))
        except (TypeError, ValueError):
            return 64

    def _progress_height(self) -> int:
        try:
            rows = int(self._cfg.get('display', {}).get('rows', 64))
            height = int(self._cfg.get('overlays', {}).get('progress_bar_height', 3))
            return max(0, min(rows, height))
        except (TypeError, ValueError):
            return 3

    def _progress_seek_tolerance_ms(self, duration_ms: int) -> int:
        return max(1500, int(duration_ms / (self._progress_cols() * 2)))

    def _duration_ms(self, duration) -> int:
        try:
            return int(float(duration) * 1000)
        except (TypeError, ValueError):
            return 0

    def _seek_ms(self, seek) -> int:
        try:
            return int(float(seek))
        except (TypeError, ValueError):
            return 0

    def _fallback_rotation_enabled(self) -> bool:
        fallback = self._cfg.get('fallback', {})
        mode = str(fallback.get('mode', 'single')).strip().lower()
        return mode == 'random_folder' and self._fallback_rotate_seconds() > 0

    def _fallback_rotate_seconds(self) -> int:
        try:
            seconds = int(self._cfg.get('fallback', {}).get('rotate_seconds', 300))
            return max(0, seconds)
        except (TypeError, ValueError):
            return 300

    def _volumio_artwork_enabled(self) -> bool:
        return bool(self._cfg.get('volumio', {}).get('artwork_enabled', True))

    def _rgb_tuple(self, value, default):
        try:
            if isinstance(value, str):
                parts = [int(part.strip()) for part in value.split(',')]
            else:
                parts = [int(part) for part in value]
            if len(parts) != 3:
                raise ValueError("RGB value must have three parts")
            return tuple(max(0, min(255, part)) for part in parts)
        except Exception:
            return default

    def _load_version(self) -> str:
        try:
            with open(VERSION_PATH, 'r') as f:
                return f.read().strip() or 'unknown'
        except Exception:
            return 'unknown'

    def _log_runtime_config(self, source: str):
        display = self._cfg.get('display', {})
        schedule = self._cfg.get('schedule', {})
        overlays = self._cfg.get('overlays', {})
        fallback = self._cfg.get('fallback', {})
        screensaver = self._cfg.get('screensaver', {})
        weather = self._cfg.get('weather', {})
        volumio = self._cfg.get('volumio', {})
        log.info(
            (
                "Config %s: display_on=%r brightness=%r gamma=%r rotation=%r "
                "hardware_mapping=%r disable_hardware_pulsing=%r slowdown_gpio=%r "
                "limit_refresh_rate_hz=%r schedule_enabled=%r schedule_on=%r schedule_off=%r "
                "effective_display_on=%r volumio_artwork_enabled=%r "
                "fallback=%r fallback_mode=%r fallback_folder=%r "
                "fallback_selected=%r fallback_rotate_seconds=%r screensaver_engine=%r "
                "screensaver_palette=%r screensaver_fps=%r screensaver_reset_seconds=%r "
                "weather_source=%r weather_location=%r weather_units=%r "
                "weather_refresh_minutes=%r weather_night_icon=%r weather_fps=%r "
                "weather_mock_condition=%r weather_mock_night=%r "
                "weather_mock_moon_phase=%r weather_secondary_metric=%r "
                "startup_delay_seconds=%r "
                "progress_height=%r progress_foreground=%r "
                "progress_background=%r format_badge=%r format_font=%r badge_duration=%r"
            ),
            source,
            display.get('display_on', True),
            display.get('brightness'),
            display.get('gamma'),
            display.get('rotation'),
            display.get('hardware_mapping', 'adafruit-hat-pwm'),
            display.get('disable_hardware_pulsing', False),
            display.get('slowdown_gpio'),
            display.get('limit_refresh_rate_hz', 0),
            schedule.get('enabled', False),
            schedule.get('on_time', '08:00'),
            schedule.get('off_time', '23:00'),
            self._effective_display_on(),
            volumio.get('artwork_enabled', True),
            fallback.get('image'),
            fallback.get('mode', 'single'),
            fallback.get('image_folder'),
            fallback.get('selected_image'),
            fallback.get('rotate_seconds', 300),
            screensaver.get('engine', 'brians_brain'),
            screensaver.get('palette', 'cyan_amber'),
            screensaver.get('fps', SCREENSAVER_FPS_DEFAULT),
            screensaver.get('reset_seconds', SCREENSAVER_RESET_SECONDS_DEFAULT),
            weather.get('source', 'mock'),
            weather.get('location_label', ''),
            weather.get('units', 'imperial'),
            weather.get('refresh_minutes', 10),
            weather.get('night_icon', 'moon'),
            weather.get('fps', WEATHER_FPS_DEFAULT),
            weather.get('mock_condition', 'partly_cloudy'),
            weather.get('mock_night', False),
            weather.get('mock_moon_phase', 0.55),
            weather.get('secondary_metric', 'humidity'),
            self._startup_delay_seconds(),
            overlays.get('progress_bar_height'),
            overlays.get('progress_bar_foreground'),
            overlays.get('progress_bar_background'),
            overlays.get('format_badge'),
            overlays.get('format_font', 'tom_thumb'),
            overlays.get('badge_duration'),
        )

    def _log_format_state(self, state: Dict):
        log.info(
            "Volumio format: service=%r trackType=%r codec=%r bitrate=%r samplerate=%r bitdepth=%r",
            state.get('service'),
            state.get('trackType'),
            state.get('codec'),
            state.get('bitrate'),
            state.get('samplerate'),
            state.get('bitdepth'),
        )

    def _fetch_albumart(self, url: str) -> Optional[Image.Image]:
        try:
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            return Image.open(BytesIO(r.content)).convert('RGB')
        except Exception as e:
            log.warning("Failed to fetch albumart from %s: %s", url, e)
            return None

    def _shutdown(self, *_):
        log.info("Shutting down")
        self._running = False
        with self._overlay_lock:
            self._cancel_fallback_locked()
            self._cancel_idle_rotation_locked()
            self._cancel_screensaver_locked()
            self._cancel_weather_locked()
            self._cancel_overlay_locked()
            self._cancel_progress_locked()
            self._badge_visible = False
            self._clear_display_if_initialized()
            self._fallback_visible = False
        with self._state_lock:
            self._state_seq += 1
            self._pending_track_key = None
        self._client.stop()
        sys.exit(0)

    def _reload(self, *_):
        log.info("SIGHUP received — reloading config")
        try:
            self._cfg = toml.load(self._config_path)
            self._volumio_ready = False
            self._volumio_ready_at = None
            self._volumio_ready_timeout_logged = False
            self._log_runtime_config("reload")
            was_on = self._display_on
            self._display_on = self._effective_display_on()
            new_format_badge = self._cfg.get('overlays', {}).get('format_badge', False)
            with self._overlay_lock:
                self._cancel_fallback_locked()
                self._cancel_idle_rotation_locked()
                self._cancel_screensaver_locked()
                self._cancel_weather_locked()
                self._cancel_overlay_locked()
                self._cancel_progress_locked(clear_visible=True)
                if not new_format_badge and self._badge_visible:
                    self._clear_badge_if_initialized()
                self._badge_visible = False
                if self._display is not None:
                    self._display.reconfigure(self._cfg)
                self._fallback_visible = False
            if not self._display_on:
                self._clear_display_for_power_off("Display off")
            elif not was_on:
                self._request_redisplay("Display on")
            else:
                self._request_redisplay("Config reloaded — requesting redisplay")
        except Exception as e:
            log.warning("Config reload failed: %s", e)

    def _effective_display_on(self, state: Optional[Dict] = None) -> bool:
        display = self._cfg.get('display', {})
        if not display.get('display_on', True):
            return False
        if self._schedule_allows_display():
            return True
        return self._playback_artwork_overrides_schedule(state)

    def _playback_artwork_overrides_schedule(self, state: Optional[Dict] = None) -> bool:
        if not self._volumio_artwork_enabled():
            return False
        state = state or self._last_state
        return state.get('status') in ('play', 'pause')

    def _schedule_allows_display(self) -> bool:
        schedule = self._cfg.get('schedule', {})
        if not schedule.get('enabled', False):
            return True

        on_minute = self._time_of_day_minutes(schedule.get('on_time', '08:00'))
        off_minute = self._time_of_day_minutes(schedule.get('off_time', '23:00'))
        if on_minute is None or off_minute is None or on_minute == off_minute:
            return True

        now = time.localtime()
        current_minute = now.tm_hour * 60 + now.tm_min
        if on_minute < off_minute:
            return on_minute <= current_minute < off_minute
        return current_minute >= on_minute or current_minute < off_minute

    def _time_of_day_minutes(self, value) -> Optional[int]:
        parts = str(value or '').strip().split(':')
        if len(parts) != 2:
            return None
        try:
            hour = int(parts[0])
            minute = int(parts[1])
        except ValueError:
            return None
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            return None
        return hour * 60 + minute

    def _apply_display_schedule(self):
        effective_on = self._effective_display_on()
        if effective_on == self._display_on:
            return
        self._display_on = effective_on
        if effective_on:
            self._request_redisplay("Display on by schedule")
        else:
            self._clear_display_for_power_off("Display off by schedule")

    def _clear_display_for_power_off(self, message: str):
        with self._overlay_lock:
            self._cancel_fallback_locked()
            self._cancel_idle_rotation_locked()
            self._cancel_screensaver_locked()
            self._cancel_weather_locked()
            self._cancel_overlay_locked()
            self._cancel_progress_locked(clear_visible=True)
            self._badge_visible = False
            self._clear_display_if_initialized()
            self._fallback_visible = False
        self._clear_current_track_state()
        log.info(message)

    def _request_redisplay(self, message: str):
        self._clear_current_track_state()
        self._client.request_state()
        log.info(message)

    def run(self):
        if self._display_on:
            with self._overlay_lock:
                self._show_or_start_fallback_locked('startup')
        else:
            with self._overlay_lock:
                self._clear_display_if_initialized()
        self._client.start()
        log.info("Vinyltron running")
        while self._running:
            self._apply_display_schedule()
            time.sleep(1)


if __name__ == '__main__':
    config = sys.argv[1] if len(sys.argv) > 1 else 'config.toml'
    Vinyltron(config).run()
