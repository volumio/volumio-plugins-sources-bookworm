#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
x10mapper.py - Userspace-Mapper fuer RF/IR-Fernbedienungen (Volumio-Plugin "x10remote")

    Fernbedienung -> Treiber -> /dev/input/eventX -> x10mapper.py
        -> /dev/uinput "X10Remote virtual keyboard"   (virtuelle Tasten KEY_F13 ...)
        -> /dev/uinput "X10Remote passthrough ..."    (unveraenderte Tasten, nur bei exklusivem Zugriff)
        -> Triggerhappy -> Volumio

Funktionen
  * Tasten, die der Treiber nur als MSC_SCAN meldet, werden als virtuelle Tasten ausgegeben.
  * Bereits erkannte Tasten (EV_KEY) koennen ersetzt oder gesperrt werden: Das Geraet wird dann
    exklusiv geoeffnet (EVIOCGRAB); alle nicht ersetzten Ereignisse werden unveraendert ueber ein
    virtuelles Durchreich-Geraet weitergegeben. Andere Triggerhappy-Dateien (z. B. audio.conf)
    werden nie veraendert - sie sehen fuer ersetzte Tasten nur die virtuelle Taste.
  * Erfassungsmodus fuer den Einlese-Assistenten (Geraet erkennen / Tasten einlesen).
  * Ereignisse werden per UDP an 127.0.0.1 gemeldet (Tastentest, Assistent).
  * Statusdatei /run/x10mapper-status.json (Geraete, exklusiver Zugriff, Probleme).

Kernel und Treiber werden nicht veraendert. Beim Beenden oder Absturz gibt der Kernel den
exklusiven Zugriff automatisch frei - das Originalverhalten ist dann sofort wieder da.

Aufruf:
    x10mapper.py --config mapper.json      Dienstbetrieb (systemd, SIGHUP = neu laden)
    x10mapper.py --list                    Eingabegeraete als JSON auflisten
    x10mapper.py --learn [--timeout 10]    naechsten Tastendruck erfassen (Diagnose)
"""

import argparse
import json
import os
import select
import signal
import socket
import subprocess
import sys
import time

try:
    import evdev
    from evdev import ecodes, InputDevice, UInput
except ImportError:  # pragma: no cover
    print(json.dumps({"ok": False, "error": "python3-evdev is not installed"}), flush=True)
    sys.exit(2)

OWN_PREFIX = "X10Remote"
VIRTUAL_NAME = "X10Remote virtual keyboard"
PASS_PREFIX = "X10Remote passthrough"
VIRTUAL_VENDOR = 0x1209
VIRTUAL_PRODUCT = 0x0a10

# Pool der virtuellen Tasten (selten genutzt, Triggerhappy kennt alle Namen)
VIRTUAL_KEYS = (
    ["KEY_F%d" % n for n in range(13, 25)] +
    ["KEY_PROG1", "KEY_PROG2", "KEY_PROG3", "KEY_PROG4"] +
    ["KEY_FN_F%d" % n for n in range(1, 13)] +
    ["KEY_BRL_DOT%d" % n for n in range(1, 9)]
)

DEFAULT_CONFIG = "/data/configuration/system_hardware/x10remote/mapper.json"
STATUS_FILE = "/run/x10mapper-status.json"
RESCAN_INTERVAL = 5.0
MAX_CAPTURE_SECONDS = 900


def log(msg):
    print(msg, flush=True)


def parse_code(value):
    if isinstance(value, bool):
        raise ValueError("bool")
    if isinstance(value, int):
        return value
    return int(str(value).strip(), 0)


def parse_code_list(value):
    result = set()
    if value is None:
        return result
    items = value if isinstance(value, (list, tuple)) else str(value).replace(";", ",").split(",")
    for item in items:
        try:
            if str(item).strip() != "":
                result.add(parse_code(item))
        except ValueError:
            pass
    return result


def device_id(dev):
    info = dev.info
    if info.vendor or info.product:
        return "%04x:%04x" % (info.vendor, info.product)
    return "name:" + dev.name


def norm_device(value):
    dev = str(value or "")
    return dev if dev.startswith("name:") else dev.lower()


# Namen, die nur Bereichsgrenzen markieren (z. B. 113 = KEY_MIN_INTERESTING / KEY_MUTE)
NOT_A_KEY = ("KEY_MIN_INTERESTING", "KEY_MAX", "KEY_CNT", "BTN_MISC")


def key_name(code):
    name = ecodes.KEY.get(code) or ecodes.BTN.get(code)
    if isinstance(name, (list, tuple)):
        real = [n for n in name if n not in NOT_A_KEY]
        name = (real or list(name))[0]
    return name or ("KEY_%d" % code)


def is_own(dev):
    return (dev.name or "").startswith(OWN_PREFIX)


def open_input_devices():
    devices = []
    for path in evdev.list_devices():
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        if is_own(dev):
            dev.close()
            continue
        devices.append(dev)
    return devices


# ----------------------------------------------------------------------------- CLI

def cmd_list():
    out = []
    for dev in open_input_devices():
        caps = dev.capabilities()
        out.append({"path": dev.path, "name": dev.name, "id": device_id(dev), "phys": dev.phys,
                    "has_scan": ecodes.EV_MSC in caps, "has_keys": ecodes.EV_KEY in caps})
        dev.close()
    print(json.dumps(out), flush=True)
    return 0


def cmd_learn(timeout, ignore):
    devices = {d.fd: d for d in open_input_devices()}
    frames = {}
    deadline = time.monotonic() + timeout
    while devices:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        ready, _, _ = select.select(list(devices.keys()), [], [], min(0.5, remaining))
        for fd in ready:
            dev = devices.get(fd)
            try:
                events = list(dev.read())
            except (OSError, IOError):
                devices.pop(fd, None)
                continue
            frame = frames.setdefault(dev.path, {"scan": None, "key": None})
            for ev in events:
                if ev.type == ecodes.EV_MSC and ev.code == ecodes.MSC_SCAN and ev.value not in ignore:
                    frame["scan"] = ev.value
                elif ev.type == ecodes.EV_KEY and ev.value == 1:
                    frame["key"] = ev.code
                elif ev.type == ecodes.EV_SYN and ev.code == ecodes.SYN_REPORT:
                    if frame["scan"] is not None or frame["key"] is not None:
                        has_key = frame["key"] is not None
                        print(json.dumps({
                            "ok": True, "device": device_id(dev), "name": dev.name, "path": dev.path,
                            "type": "key" if has_key else "scan",
                            "code": frame["key"] if has_key else frame["scan"],
                            "scan": frame["scan"], "key_code": frame["key"],
                            "key_name": key_name(frame["key"]) if has_key else None,
                        }), flush=True)
                        return 0
                    frames[dev.path] = frame = {"scan": None, "key": None}
    print(json.dumps({"ok": False, "timeout": True}), flush=True)
    return 1


# -------------------------------------------------------------------------- config

class Config(object):
    """Gelesene mapper.json. Ungueltige Eintraege werden protokolliert und uebersprungen."""

    def __init__(self, raw=None):
        raw = raw or {}
        self.debounce = max(0, min(5000, int(raw.get("debounce_ms", 300)))) / 1000.0
        self.repeat = max(50, min(5000, int(raw.get("repeat_ms", 150)))) / 1000.0
        self.ignore = parse_code_list(raw.get("ignore_scancodes", [0]))
        self.log_presses = bool(raw.get("log_presses", False))
        port = int(raw.get("event_port", 0) or 0)
        self.event_port = port if 0 < port < 65536 else 0
        self.mappings = {}          # (device, type, code) -> mapping
        self.devices = set()        # Geraete, die geoeffnet werden
        self.grab = set()           # Geraete mit exklusivem Zugriff (ersetzte erkannte Tasten)
        self.errors = []            # fuer den Status: uebersprungene Belegungen
        for m in raw.get("mappings", []) or []:
            try:
                self._add(m)
            except (KeyError, ValueError, TypeError) as exc:
                log("Invalid mapping ignored: %r (%s)" % (m, exc))
                self.errors.append("%s: %s" % (m.get("label") or m.get("id") or "?", exc) if isinstance(m, dict) else str(exc))
        self.capture = self._capture(raw.get("capture"))

    def _add(self, m):
        mtype = m.get("type", "scan")
        if mtype not in ("scan", "key"):
            raise ValueError("type")
        mode = m.get("mode", "emit")
        if mode not in ("emit", "swallow"):
            raise ValueError("mode")
        key = m.get("key")
        if mode == "emit" and not (isinstance(key, str) and key.startswith(("KEY_", "BTN_")) and key in ecodes.ecodes):
            raise ValueError("target key %s not allowed" % key)
        if mode == "swallow" and mtype != "key":
            raise ValueError("locking is only possible for recognised keys")
        dev = norm_device(m.get("device"))
        if not dev or dev == "*":
            raise ValueError("device missing")
        code = parse_code(m["code"])
        self.mappings[(dev, mtype, code)] = {
            "id": str(m.get("id", "")),
            "label": str(m.get("label", ""))[:80],
            "type": mtype,
            "mode": mode,
            "key": key,
            "kcode": ecodes.ecodes[key] if mode == "emit" else None,
            "repeat": bool(m.get("repeat", False)),
        }
        self.devices.add(dev)
        if mtype == "key":
            self.grab.add(dev)

    @staticmethod
    def _capture(raw):
        if not isinstance(raw, dict):
            return None
        try:
            until = float(raw.get("until", 0))
        except (TypeError, ValueError):
            return None
        until = min(until, time.time() + MAX_CAPTURE_SECONDS)
        if until <= time.time():
            return None
        dev = norm_device(raw.get("device") or "*")
        # Auch beim Erkennen (device "*") exklusiv: waehrend des Einlesens loest keine Taste etwas aus.
        return {"device": dev, "grab": bool(raw.get("grab", False)), "until": until}

    @classmethod
    def load(cls, path):
        with open(path, "r") as fh:
            return cls(json.load(fh))

    def lookup(self, did, mtype, code):
        return self.mappings.get((did, mtype, code))

    def output_keys(self):
        """Alle Tasten, die die virtuelle Tastatur senden muss (Pool + gewaehlte Triggerhappy-Tasten)."""
        keys = set(ecodes.ecodes[k] for k in VIRTUAL_KEYS)
        for m in self.mappings.values():
            if m["kcode"] is not None:
                keys.add(m["kcode"])
        return keys


# ------------------------------------------------------------------------ handles

class Handle(object):
    """Ein geoeffnetes Eingabegeraet."""

    def __init__(self, dev):
        self.dev = dev
        self.did = device_id(dev)
        self.grabbed = False
        self.passthrough = None
        self.error = None
        self.frame_scan = None
        self.frame_keys = []
        self.frame_has_key_event = False


class Mapper(object):
    def __init__(self, config_path):
        self.config_path = config_path
        self.cfg = Config()
        self.handles = {}           # fd -> Handle
        self.known = {}             # path -> {"id","name","own"} aller Eingabegeraete (Status)
        self.last_seen = {}
        self.last_emit = {}
        self.last_capture = {}
        self.running = True
        self.reload_requested = False
        self.ui = None
        self.ui_keys = set()
        self.sock = None
        self.problems = []

    # ---- Konfiguration / Status ----------------------------------------------
    def load(self):
        try:
            self.cfg = Config.load(self.config_path)
            log("Configuration loaded: %d mapping(s), devices: %s, exclusive: %s"
                % (len(self.cfg.mappings), ", ".join(sorted(self.cfg.devices)) or "-",
                   ", ".join(sorted(self.cfg.grab)) or "-"))
        except (OSError, ValueError) as exc:
            log("Configuration %s not readable (%s) - keeping the previous one" % (self.config_path, exc))

    def capture_active(self):
        cap = self.cfg.capture
        if cap and cap["until"] <= time.time():
            log("Capture ended (timeout)")
            self.cfg.capture = None
            return None
        return self.cfg.capture

    def capture_for(self, did):
        cap = self.capture_active()
        if cap and (cap["device"] == "*" or cap["device"] == did):
            return cap
        return None

    def wants(self, did):
        return did in self.cfg.devices or self.capture_for(did) is not None

    def write_status(self):
        cap = self.cfg.capture
        status = {
            "pid": os.getpid(),
            "time": time.time(),
            "capture": {"device": cap["device"], "grab": cap["grab"], "until": cap["until"]} if cap else None,
            "open": [{"id": h.did, "name": h.dev.name, "path": h.dev.path, "grabbed": h.grabbed,
                      "error": h.error} for h in self.handles.values()],
            "inputs": sorted(({"id": v["id"], "name": v["name"], "path": p}
                              for p, v in self.known.items() if not v.get("own")),
                             key=lambda x: x["path"]),
            "problems": list(self.problems),
        }
        tmp = STATUS_FILE + ".tmp"
        try:
            with open(tmp, "w") as fh:
                json.dump(status, fh)
            os.chmod(tmp, 0o644)
            os.replace(tmp, STATUS_FILE)
        except OSError:
            pass

    # ---- Ereignisse an das Plugin ---------------------------------------------
    def notify(self, payload):
        port = self.cfg.event_port
        if not port:
            return
        try:
            if self.sock is None:
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.sock.setblocking(False)
            payload["ts"] = time.time()
            self.sock.sendto(json.dumps(payload).encode("utf-8"), ("127.0.0.1", port))
        except (OSError, ValueError):
            pass

    # ---- virtuelle Geraete ----------------------------------------------------
    def create_uinput(self):
        codes = sorted(self.cfg.output_keys())
        if self.ui is not None:
            try:
                self.ui.close()
            except Exception:
                pass
            self.ui = None
        self.ui_keys = set(codes)
        kwargs = dict(name=VIRTUAL_NAME, vendor=VIRTUAL_VENDOR, product=VIRTUAL_PRODUCT, version=1)
        try:
            self.ui = UInput({ecodes.EV_KEY: codes}, **kwargs)
        except Exception:
            subprocess.call(["/sbin/modprobe", "uinput"])
            time.sleep(1)
            self.ui = UInput({ecodes.EV_KEY: codes}, **kwargs)
        log("Virtual keyboard created: %s (%d keys)" % (VIRTUAL_NAME, len(codes)))

    def ensure_uinput(self):
        """Virtuelle Tastatur neu anlegen, wenn neue Ausgabetasten (z. B. KEY_OK) hinzugekommen sind."""
        if self.ui is None or not self.cfg.output_keys() <= self.ui_keys:
            self.create_uinput()

    def emit(self, kcode):
        self.ui.write(ecodes.EV_KEY, kcode, 1)
        self.ui.syn()
        self.ui.write(ecodes.EV_KEY, kcode, 0)
        self.ui.syn()

    # ---- Geraeteverwaltung ----------------------------------------------------
    def desired_grab(self, h):
        cap = self.capture_for(h.did)
        if cap and cap["grab"]:
            return True
        return h.did in self.cfg.grab

    def apply_mode(self, h):
        want = self.desired_grab(h)
        if want and not h.grabbed:
            try:
                h.dev.grab()
            except OSError as exc:
                h.error = "Exclusive access not possible: %s" % (exc.strerror or exc)
                log("WARNING %s: %s - replaced keys also trigger audio.conf" % (h.did, h.error))
                return
            h.grabbed = True
            h.error = None
            try:
                name = (PASS_PREFIX + " " + (h.dev.name or h.did))[:79]
                h.passthrough = UInput.from_device(h.dev, name=name)
            except Exception as exc:
                self.release(h)
                h.error = "Passthrough not possible: %s" % exc
                log("WARNING %s: %s - exclusive access released again" % (h.did, h.error))
                return
            log("Exclusive access: %s [%s] %s" % (h.dev.path, h.did, h.dev.name))
        elif not want and h.grabbed:
            self.release(h)
            log("Exclusive access released: %s [%s]" % (h.dev.path, h.did))

    def release(self, h):
        if h.grabbed:
            try:
                h.dev.ungrab()
            except OSError:
                pass
        h.grabbed = False
        if h.passthrough is not None:
            try:
                h.passthrough.close()
            except Exception:
                pass
            h.passthrough = None

    def close_handle(self, fd, reason):
        h = self.handles.pop(fd, None)
        if h is None:
            return
        self.release(h)
        try:
            h.dev.close()
        except Exception:
            pass
        log("Input device closed (%s): %s [%s]" % (reason, h.dev.path, h.did))

    def scan_devices(self):
        paths = set(evdev.list_devices())
        for path in list(self.known.keys()):
            if path not in paths:
                self.known.pop(path, None)
        for fd, h in list(self.handles.items()):
            if not self.wants(h.did):
                self.close_handle(fd, "no longer needed")
            else:
                self.apply_mode(h)
        open_paths = set(h.dev.path for h in self.handles.values())
        for path in sorted(paths):
            if path in open_paths:
                continue
            info = self.known.get(path)
            if info is not None and (info.get("own") or not self.wants(info["id"])):
                continue
            try:
                dev = InputDevice(path)
            except OSError:
                continue
            did = device_id(dev)
            self.known[path] = {"id": did, "name": dev.name, "own": is_own(dev)}
            if is_own(dev) or not self.wants(did):
                dev.close()
                continue
            h = Handle(dev)
            self.handles[dev.fd] = h
            log("Input device opened: %s [%s] %s" % (dev.path, did, dev.name))
            self.apply_mode(h)
        self.problems = ["%s: %s" % (h.did, h.error) for h in self.handles.values() if h.error] + list(self.cfg.errors)
        self.write_status()

    # ---- Ereignisverarbeitung -------------------------------------------------
    def forward(self, h, ev):
        if h.grabbed and h.passthrough is not None:
            try:
                h.passthrough.write(ev.type, ev.code, ev.value)
            except OSError:
                pass

    def handle_event(self, h, ev):
        cap = self.capture_for(h.did)
        exclusive_capture = cap is not None and cap["grab"]
        if ev.type == ecodes.EV_MSC and ev.code == ecodes.MSC_SCAN:
            h.frame_scan = ev.value
            if not exclusive_capture:
                self.forward(h, ev)
        elif ev.type == ecodes.EV_KEY:
            h.frame_has_key_event = True
            h.frame_keys.append((ev.code, ev.value))
            if not exclusive_capture and self.cfg.lookup(h.did, "key", ev.code) is None:
                self.forward(h, ev)
        elif ev.type == ecodes.EV_SYN and ev.code == ecodes.SYN_REPORT:
            if not exclusive_capture:
                self.forward(h, ev)
            try:
                self.process_frame(h, cap, exclusive_capture)
            finally:
                h.frame_scan, h.frame_keys, h.frame_has_key_event = None, [], False
        elif not exclusive_capture:
            self.forward(h, ev)

    def process_frame(self, h, cap, exclusive_capture):
        scan = h.frame_scan
        if scan is not None and scan in self.cfg.ignore:
            scan = None
        pressed = [code for code, value in h.frame_keys if value == 1]

        if cap is not None and (scan is not None or pressed):
            key_code = pressed[0] if pressed else None
            ident = (h.did, "key", key_code) if key_code is not None else (h.did, "scan", scan)
            now = time.monotonic()
            last = self.last_capture.get(ident, 0.0)
            self.last_capture[ident] = now
            if key_code is not None or now - last > self.cfg.debounce:
                self.notify({"event": "capture", "device": h.did, "name": h.dev.name, "scan": scan,
                             "key_code": key_code,
                             "key_name": key_name(key_code) if key_code is not None else None})
        if exclusive_capture:
            return

        for code, value in h.frame_keys:
            m = self.cfg.lookup(h.did, "key", code)
            if m is not None:
                if value == 1 or (value == 2 and m["repeat"]):
                    self.act(h, m, "key", code, value)
            elif value == 1:
                self.notify({"event": "passthrough", "device": h.did, "type": "key", "code": code,
                             "key_name": key_name(code), "scan": scan})
        if h.frame_has_key_event or scan is None:
            return
        m = self.cfg.lookup(h.did, "scan", scan)
        ident = (h.did, "scan", scan)
        now = time.monotonic()
        last_seen = self.last_seen.get(ident, 0.0)
        self.last_seen[ident] = now
        if m is None:
            if now - last_seen > self.cfg.debounce:
                self.notify({"event": "unmapped", "device": h.did, "type": "scan", "code": scan})
                if self.cfg.log_presses:
                    log("unmapped: %s scan 0x%02x" % (h.did, scan))
            return
        if m["repeat"]:
            if now - self.last_emit.get(ident, 0.0) < self.cfg.repeat:
                return
        elif now - last_seen < self.cfg.debounce:
            return
        self.act(h, m, "scan", scan, 1)

    def act(self, h, m, mtype, code, value):
        ident = (h.did, mtype, code)
        now = time.monotonic()
        if mtype == "key" and value == 2 and now - self.last_emit.get(ident, 0.0) < self.cfg.repeat:
            return
        self.last_emit[ident] = now
        what = ("scan 0x%02x" % code) if mtype == "scan" else key_name(code)
        if m["mode"] == "swallow":
            self.notify({"event": "swallowed", "id": m["id"], "device": h.did, "type": mtype,
                         "code": code, "label": m["label"],
                         "key_name": key_name(code) if mtype == "key" else None})
            if self.cfg.log_presses:
                log("Key locked: %s %s" % (h.did, what))
            return
        self.emit(m["kcode"])
        self.notify({"event": "press", "id": m["id"], "device": h.did, "type": mtype, "code": code,
                     "key": m["key"], "label": m["label"],
                     "key_name": key_name(code) if mtype == "key" else None})
        if self.cfg.log_presses:
            log("Key: %s %s -> %s%s" % (h.did, what, m["key"],
                                          (" (%s)" % m["label"]) if m["label"] else ""))

    # ---- Hauptschleife --------------------------------------------------------
    def run(self):
        signal.signal(signal.SIGHUP, self._on_hup)
        signal.signal(signal.SIGTERM, self._on_term)
        signal.signal(signal.SIGINT, self._on_term)
        self.load()
        self.create_uinput()
        self.scan_devices()
        last_scan = time.monotonic()
        had_capture = self.cfg.capture is not None
        while self.running:
            if self.reload_requested:
                self.reload_requested = False
                self.load()
                self.ensure_uinput()
                self.scan_devices()
                last_scan = time.monotonic()
                had_capture = self.cfg.capture is not None
            has_capture = self.capture_active() is not None
            if has_capture != had_capture or time.monotonic() - last_scan > RESCAN_INTERVAL:
                had_capture = has_capture
                self.scan_devices()
                last_scan = time.monotonic()
            fds = list(self.handles.keys())
            try:
                ready, _, _ = select.select(fds, [], [], 1.0)
            except (OSError, ValueError):
                ready = []
                for fd in fds:
                    try:
                        os.fstat(fd)
                    except OSError:
                        self.close_handle(fd, "invalid")
            for fd in ready:
                h = self.handles.get(fd)
                if h is None:
                    continue
                try:
                    for ev in h.dev.read():
                        self.handle_event(h, ev)
                except (OSError, IOError):
                    self.close_handle(fd, "removed")
        for fd in list(self.handles.keys()):
            self.close_handle(fd, "shutdown")
        if self.ui:
            self.ui.close()
        try:
            os.unlink(STATUS_FILE)
        except OSError:
            pass
        log("x10mapper stopped")
        return 0

    def _on_hup(self, *_):
        self.reload_requested = True

    def _on_term(self, *_):
        self.running = False


def main():
    parser = argparse.ArgumentParser(description="X10/RF mapper for Triggerhappy")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="path to mapper.json")
    parser.add_argument("--learn", action="store_true", help="capture the next key press")
    parser.add_argument("--timeout", type=float, default=10.0, help="learn timeout in seconds")
    parser.add_argument("--ignore", default="0x00", help="ignored scan codes (comma list)")
    parser.add_argument("--list", action="store_true", help="list input devices as JSON")
    args = parser.parse_args()
    if args.list:
        return cmd_list()
    if args.learn:
        return cmd_learn(args.timeout, parse_code_list(args.ignore))
    return Mapper(args.config).run()


if __name__ == "__main__":
    sys.exit(main())
