#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
x10mapper.py - userspace mapper for RF/IR remotes (Volumio plugin "x10remote")

    remote -> driver -> /dev/input/eventX -> x10mapper.py
        -> /dev/uinput "X10Remote virtual keyboard"   (virtual keys KEY_F13 ...)
        -> /dev/uinput "X10Remote passthrough ..."    (unchanged keys, only with exclusive access)
        -> Triggerhappy -> Volumio

Functions
  * Keys the driver reports only as MSC_SCAN are emitted as virtual keys.
  * Already recognised keys (EV_KEY) can be replaced or disabled: the device is then opened
    exclusively (EVIOCGRAB); all events that are not replaced are passed on unchanged through a
    virtual passthrough device. Other Triggerhappy files (e.g. audio.conf) are never modified -
    for replaced keys they only see the virtual key.
  * Capture mode for the read-in wizard (detect a device / read in keys).
    While detecting (device "*") only remote-like devices are read exclusively - never
    touchscreens, mice or full keyboards (a kiosk stays usable).
  * Events are reported by UDP to 127.0.0.1 (key test, wizard).
  * Status file /run/x10mapper-status.json (devices, exclusive access, problems).

Kernel and drivers are not modified. On exit or crash the kernel releases the exclusive access
automatically - the original behaviour is back at once.

Usage:
    x10mapper.py --config mapper.json      service mode (systemd, SIGHUP = reload)
    x10mapper.py --list                    list input devices as JSON
    x10mapper.py --learn [--timeout 10]    capture the next key press (diagnostics)
"""

import argparse
import json
import os
import select
import signal

# Until the handlers are set in Mapper.run(), an early SIGHUP ("systemctl reload" right after the start,
# while Python is still importing evdev) would end the process - therefore ignore it at first.
signal.signal(signal.SIGHUP, signal.SIG_IGN)
import socket
import struct
import subprocess
import sys
import time

try:
    import evdev
    from evdev import ecodes, InputDevice, UInput
except ImportError:  # pragma: no cover
    # 78 = EX_CONFIG: systemd then does not restart the service forever (RestartPreventExitStatus=78)
    print(json.dumps({"ok": False, "error": "python3-evdev is not installed"}), flush=True)
    sys.exit(78)

EXIT_CONFIG = 78

OWN_PREFIX = "X10Remote"
VIRTUAL_NAME = "X10Remote virtual keyboard"
PASS_PREFIX = "X10Remote passthrough"
VIRTUAL_VENDOR = 0x1209
VIRTUAL_PRODUCT = 0x0a10

# Pool of virtual keys (rarely used) - identical to lib/constants.js. The plugin decides which of them
# are assigned (KEY_MACRO1-30 only if Triggerhappy knows them). Names this python-evdev does not know
# are skipped (see output_keys).
VIRTUAL_KEYS = (
    ["KEY_F%d" % n for n in range(13, 25)] +
    ["KEY_PROG1", "KEY_PROG2", "KEY_PROG3", "KEY_PROG4"] +
    ["KEY_FN_F%d" % n for n in range(1, 13)] +
    ["KEY_BRL_DOT%d" % n for n in range(1, 9)] +
    ["KEY_MACRO%d" % n for n in range(1, 31)]
)

DEFAULT_CONFIG = "/data/configuration/system_hardware/x10remote/mapper.json"
STATUS_FILE = "/run/x10mapper-status.json"
# "Mobile Remote": the plugin (user volumio) reports a button press of the phone page through this
# Unix socket. Only {"inject": <1..20>} from root or the user volumio is accepted (SO_PEERCRED), and
# only an assignment entered in mapper.json for the pseudo device MOBILE_DEVICE is triggered.
INJECT_SOCKET = "/run/x10mapper.sock"
MOBILE_DEVICE = "name:X10Remote mobile remote"
MOBILE_BUTTONS = 20
RESCAN_INTERVAL = 5.0
# Triggerhappy opens input devices only when it starts; devices created later (virtual keyboard,
# passthrough) are announced to it by a udev rule - which cannot be relied on everywhere. Therefore the
# mapper checks after THD_SETTLE seconds itself and, if necessary, registers the device with th-cmd.
THD_CMD = "/usr/sbin/th-cmd"
THD_SOCKET = "/run/thd.socket"
THD_SETTLE = 1.5
THD_VERIFY = 1.5
MAX_CAPTURE_SECONDS = 900


def log(msg):
    print(msg, flush=True)


def uinput_node(ui, name):
    """/dev/input/eventN of a uinput device created here (None if it cannot be determined)."""
    try:
        path = ui.device.path
        if path and path.startswith("/dev/input/event"):
            return path
    except Exception:
        pass
    best = None
    try:
        with open("/proc/bus/input/devices", "r") as fh:
            blocks = fh.read().split("\n\n")
    except OSError:
        return None
    for b in blocks:
        if ('N: Name="%s"' % name) not in b:
            continue
        for line in b.splitlines():
            if line.startswith("H: Handlers="):
                for word in line.split("=", 1)[1].split():
                    if word.startswith("event") and word[5:].isdigit():
                        n = int(word[5:])
                        best = n if best is None or n > best else best
    return None if best is None else "/dev/input/event%d" % best


def thd_process(proc="/proc"):
    """(pid, socket) of the running Triggerhappy, or (None, None)."""
    try:
        entries = os.listdir(proc)
    except OSError:
        return None, None
    for e in entries:
        if not e.isdigit():
            continue
        try:
            with open(os.path.join(proc, e, "comm"), "r") as fh:
                if fh.read().strip() != "thd":
                    continue
            with open(os.path.join(proc, e, "cmdline"), "rb") as fh:
                args = [a.decode("utf-8", "replace") for a in fh.read().split(b"\0") if a]
        except OSError:
            continue
        sock = THD_SOCKET
        for i, a in enumerate(args):
            if a == "--socket" and i + 1 < len(args):
                sock = args[i + 1]
            elif a.startswith("--socket="):
                sock = a.split("=", 1)[1]
        return int(e), sock
    return None, None


def thd_has_open(pid, node, proc="/proc"):
    """True/False: Triggerhappy has opened the device; None: cannot be determined."""
    d = os.path.join(proc, str(pid), "fd")
    try:
        fds = os.listdir(d)
    except OSError:
        return None
    for fd in fds:
        try:
            if os.readlink(os.path.join(d, fd)) == node:
                return True
        except OSError:
            continue
    return False


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


# names that only mark range limits (e.g. 113 = KEY_MIN_INTERESTING / KEY_MUTE)
NOT_A_KEY = ("KEY_MIN_INTERESTING", "KEY_MAX", "KEY_CNT", "BTN_MISC")


def key_name(code):
    name = ecodes.KEY.get(code) or ecodes.BTN.get(code)
    if isinstance(name, (list, tuple)):
        real = [n for n in name if n not in NOT_A_KEY]
        name = (real or list(name))[0]
    return name or ("KEY_%d" % code)


def is_own(dev):
    return (dev.name or "").startswith(OWN_PREFIX)


# BTN_* lie between BTN_MISC (0x100) and KEY_OK (0x160) and from BTN_TRIGGER_HAPPY (0x2c0) on
def is_button(code):
    return 0x100 <= code < 0x160 or 0x2c0 <= code < 0x300


LETTER_KEYS = None


def classify(dev):
    """Kind of input device: remote | keyboard | pointer | touch | other.
    
    touch:    reports absolute position axes (touchscreen, touchpad, graphics tablet, joystick/gamepad).
              ABS_VOLUME/ABS_MISC and the like alone (HID "Consumer Control" of many receivers) do NOT count.
    pointer:  mouse (relative axes + mouse buttons) with only a few real keys
    keyboard: full keyboard (at least 20 letter keys), e.g. also FLIRC
    remote:   everything else with real keys (X10/ati_remote with mouse pad, IR receivers, HDMI-CEC ...)
    While detecting only "remote" is read exclusively; pointer/touch are not observed at all.
    """
    global LETTER_KEYS
    if LETTER_KEYS is None:
        LETTER_KEYS = set(ecodes.ecodes["KEY_" + c] for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    try:
        caps = dev.capabilities()
    except OSError:
        return "other"
    keys = set(caps.get(ecodes.EV_KEY, []))
    real = [k for k in keys if not is_button(k) and k > 0]
    abs_codes = set((a[0] if isinstance(a, (tuple, list)) else a) for a in caps.get(ecodes.EV_ABS, []))
    position = abs_codes & set([ecodes.ABS_X, ecodes.ABS_Y, ecodes.ABS_MT_POSITION_X, ecodes.ABS_MT_POSITION_Y,
                                ecodes.ABS_RX, ecodes.ABS_RY, ecodes.ABS_HAT0X, ecodes.ABS_HAT0Y])
    if position or ecodes.BTN_TOUCH in keys or ecodes.BTN_TOOL_FINGER in keys or ecodes.BTN_TOOL_PEN in keys:
        return "touch"
    rel = set(caps.get(ecodes.EV_REL, []))
    if ecodes.REL_X in rel and ecodes.BTN_LEFT in keys and len(real) < 10:
        return "pointer"
    if not real:
        return "pointer" if rel else "other"
    if len(keys & LETTER_KEYS) >= 20:
        return "keyboard"
    return "remote"


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
                    "has_scan": ecodes.EV_MSC in caps, "has_keys": ecodes.EV_KEY in caps,
                    "class": classify(dev)})
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
    """The mapper.json that was read. Invalid entries are logged and skipped."""

    def __init__(self, raw=None):
        raw = raw or {}
        self.debounce = max(0, min(5000, int(raw.get("debounce_ms", 600)))) / 1000.0
        self.repeat = max(50, min(5000, int(raw.get("repeat_ms", 150)))) / 1000.0
        self.ignore = parse_code_list(raw.get("ignore_scancodes", [0]))
        self.log_presses = bool(raw.get("log_presses", False))
        port = int(raw.get("event_port", 0) or 0)
        self.event_port = port if 0 < port < 65536 else 0
        self.mappings = {}          # (device, type, code) -> mapping
        self.devices = set()        # devices that are opened
        self.grab = set()           # devices with exclusive access (replaced recognised keys)
        self.errors = []            # for the status: skipped assignments
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
        # Exclusive while detecting (device "*") too: during reading in no key triggers anything.
        return {"device": dev, "grab": bool(raw.get("grab", False)), "until": until}

    @classmethod
    def load(cls, path):
        with open(path, "r") as fh:
            return cls(json.load(fh))

    def lookup(self, did, mtype, code):
        return self.mappings.get((did, mtype, code))

    def output_keys(self):
        """All keys the virtual keyboard must be able to send (pool + chosen Triggerhappy keys)."""
        keys = set(ecodes.ecodes[k] for k in VIRTUAL_KEYS if k in ecodes.ecodes)
        for m in self.mappings.values():
            if m["kcode"] is not None:
                keys.add(m["kcode"])
        return keys


# ------------------------------------------------------------------------ handles

class Handle(object):
    """An opened input device."""

    def __init__(self, dev):
        self.dev = dev
        self.did = device_id(dev)
        self.grabbed = False
        self.passthrough = None
        self.error = None
        self.cls = classify(dev)
        self.frame_scan = None
        self.frame_keys = []
        self.frame_has_key_event = False
        self.frame_pointer = False      # frame contains pointer/touch events (EV_REL/EV_ABS)
        # rc-core (IR): while a recognised key is held, the kernel sends frames with MSC_SCAN only.
        # Remember scan code -> recognised key so that these frames do not count as a key of their own.
        self.scan_keys = {}


class Mapper(object):
    def __init__(self, config_path):
        self.config_path = config_path
        self.cfg = Config()
        self.handles = {}           # fd -> Handle
        self.known = {}             # path -> {"id","name","own"} of all input devices (status)
        self.last_seen = {}
        self.last_emit = {}
        self.last_capture = {}
        self.running = True
        self.reload_requested = False
        self.inject_sock = None
        self.inject_uids = set([0])
        self.ui = None
        self.ui_keys = set()
        self.sock = None
        self.problems = []
        self.thd_pending = {}       # /dev/input/eventN -> {"at": monotonic, "tried": bool, "name": str}

    # ---- configuration / status ----------------------------------------------
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

    def wants(self, did, cls=None):
        if did in self.cfg.devices:
            return True
        cap = self.capture_for(did)
        if cap is None:
            return False
        # detecting (all devices): touchscreens and mice are not observed at all
        if cap["device"] == "*" and cls in ("touch", "pointer"):
            return False
        return True

    def write_status(self):
        cap = self.cfg.capture
        status = {
            "pid": os.getpid(),
            "time": time.time(),
            "capture": {"device": cap["device"], "grab": cap["grab"], "until": cap["until"]} if cap else None,
            "open": [{"id": h.did, "name": h.dev.name, "path": h.dev.path, "grabbed": h.grabbed,
                      "class": h.cls, "grab_wanted": self.desired_grab(h),
                      "error": h.error} for h in self.handles.values()],
            "inputs": sorted(({"id": v["id"], "name": v["name"], "path": p, "class": v.get("cls")}
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

    # ---- events to the plugin --------------------------------------------------
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

    # ---- virtual devices -------------------------------------------------------
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
        self.announce(self.ui, VIRTUAL_NAME)

    # ---- register own devices with Triggerhappy --------------------------------
    def announce(self, ui, name):
        """Note a newly created uinput device for checking (see check_thd)."""
        node = uinput_node(ui, name)
        if node is None:
            log("WARNING: device node of '%s' not found - cannot check Triggerhappy" % name)
            return
        self.thd_pending[node] = {"at": time.monotonic() + THD_SETTLE, "tried": False, "name": name}

    def check_thd(self):
        """
        Has Triggerhappy opened the noted devices? If not: register once with th-cmd
        (--passfd: th-cmd opens the device as root and passes it on - thd runs as nobody).
        If that does not help either, the plugin is told (event thd_device_missing) and restarts
        Triggerhappy. Only what is provably missing is registered - never twice.
        """
        if not self.thd_pending:
            return
        now = time.monotonic()
        due = [n for n, p in self.thd_pending.items() if p["at"] <= now]
        if not due:
            return
        pid, sock = thd_process()
        for node in due:
            p = self.thd_pending[node]
            if not os.path.exists(node):
                del self.thd_pending[node]      # the device no longer exists
                continue
            if pid is None:
                del self.thd_pending[node]      # Triggerhappy opens all devices when it starts
                log("Triggerhappy: not running - %s (%s) not checked" % (node, p["name"]))
                continue
            state = thd_has_open(pid, node)
            if state is None or state:
                del self.thd_pending[node]
                if state is None:
                    log("Triggerhappy: cannot check whether %s (%s) is open" % (node, p["name"]))
                elif p["tried"]:
                    log("Triggerhappy: %s (%s) registered with th-cmd" % (node, p["name"]))
                else:
                    log("Triggerhappy: %s (%s) already open" % (node, p["name"]))
                continue
            if not p["tried"]:
                p["tried"] = True
                p["at"] = now + THD_VERIFY
                try:
                    rc = subprocess.call([THD_CMD, "--socket", sock, "--passfd", "--add", node],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                except Exception as exc:
                    rc = str(exc)
                if rc != 0:
                    log("WARNING: th-cmd --add %s failed (%s)" % (node, rc))
                continue
            del self.thd_pending[node]
            log("WARNING: Triggerhappy does not read %s (%s) - asking the plugin to restart it" % (node, p["name"]))
            self.notify({"event": "thd_device_missing", "path": node, "name": p["name"]})

    def ensure_uinput(self):
        """Recreate the virtual keyboard when new output keys (e.g. KEY_OK) have been added."""
        if self.ui is None or not self.cfg.output_keys() <= self.ui_keys:
            self.create_uinput()

    # ---- Mobile Remote -------------------------------------------------------
    def open_inject(self):
        """Unix socket for button presses of the Mobile Remote page. Errors are not fatal."""
        self.inject_sock = None
        self.inject_uids = set([0])
        try:
            import pwd
            self.inject_uids.add(pwd.getpwnam("volumio").pw_uid)
        except (KeyError, ImportError):
            pass
        try:
            try:
                os.unlink(INJECT_SOCKET)
            except OSError:
                pass
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            old = os.umask(0o111)            # anyone may connect; SO_PEERCRED decides who may send
            try:
                sock.bind(INJECT_SOCKET)
            finally:
                os.umask(old)
            sock.listen(8)
            sock.setblocking(False)
            self.inject_sock = sock
        except OSError as exc:
            log("Mobile remote socket %s not available: %s" % (INJECT_SOCKET, exc))

    def close_inject(self):
        if getattr(self, "inject_sock", None) is not None:
            try:
                self.inject_sock.close()
            except OSError:
                pass
            self.inject_sock = None
            try:
                os.unlink(INJECT_SOCKET)
            except OSError:
                pass

    def handle_inject(self):
        try:
            conn, _ = self.inject_sock.accept()
        except OSError:
            return
        try:
            cred = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
            uid = struct.unpack("3i", cred)[1]
            if uid not in self.inject_uids:
                return
            conn.settimeout(0.2)
            data = conn.recv(256)
            reply = self.inject(data)
            try:
                conn.sendall((json.dumps(reply) + "\n").encode("utf-8"))
            except OSError:
                pass
        except (OSError, struct.error):
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def inject(self, data):
        """One line of JSON {"inject": n}. Answer {"ok": bool, "error"?: str}."""
        try:
            msg = json.loads(data.decode("utf-8"))
            code = msg.get("inject") if isinstance(msg, dict) else None
        except (ValueError, UnicodeDecodeError):
            return {"ok": False, "error": "bad_request"}
        if isinstance(code, bool) or not isinstance(code, int) or not 1 <= code <= MOBILE_BUTTONS:
            return {"ok": False, "error": "bad_request"}
        m = self.cfg.lookup(MOBILE_DEVICE, "scan", code)
        if m is None or m["mode"] != "emit":
            return {"ok": False, "error": "not_assigned"}
        if self.ui is None:
            return {"ok": False, "error": "no_uinput"}
        self.emit(m["kcode"])
        self.notify({"event": "press", "id": m["id"], "device": MOBILE_DEVICE, "type": "scan", "code": code,
                     "key": m["key"], "label": m["label"], "key_name": None})
        if self.cfg.log_presses:
            log("Key: mobile remote button %d -> %s%s" % (code, m["key"], (" (%s)" % m["label"]) if m["label"] else ""))
        return {"ok": True}

    def emit(self, kcode):
        self.ui.write(ecodes.EV_KEY, kcode, 1)
        self.ui.syn()
        self.ui.write(ecodes.EV_KEY, kcode, 0)
        self.ui.syn()

    # ---- device handling -------------------------------------------------------
    def has_key_sibling(self, h):
        return any(o is not h and o.did == h.did and o.cls in ("remote", "keyboard") for o in self.handles.values())

    def desired_grab(self, h):
        cap = self.capture_for(h.did)
        if cap and cap["grab"] and h.cls != "touch":
            if cap["device"] == "*":
                # Detecting: only grab remote-like devices (never keyboard, mouse, touchscreen).
                if h.cls == "remote":
                    return True
            elif h.cls != "pointer" or not self.has_key_sibling(h):
                # Reading in a confirmed device: that device - but not its pointer part if there is a key
                # part next to it (a USB receiver often reports keyboard and touchpad/mouse as several input
                # devices under the same USB id). Touch parts never.
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
                self.announce(h.passthrough, name)
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
            if not self.wants(h.did, h.cls):
                self.close_handle(fd, "no longer needed")
            else:
                self.apply_mode(h)
        open_paths = set(h.dev.path for h in self.handles.values())
        for path in sorted(paths):
            if path in open_paths:
                continue
            info = self.known.get(path)
            if info is not None and (info.get("own") or not self.wants(info["id"], info.get("cls"))):
                continue
            try:
                dev = InputDevice(path)
            except OSError:
                continue
            did = device_id(dev)
            cls = classify(dev)
            self.known[path] = {"id": did, "name": dev.name, "own": is_own(dev), "cls": cls}
            if is_own(dev) or not self.wants(did, cls):
                dev.close()
                continue
            h = Handle(dev)
            self.handles[dev.fd] = h
            log("Input device opened: %s [%s] %s" % (dev.path, did, dev.name))
            self.apply_mode(h)
        # once all devices are open, check again: whether a pointer part is grabbed depends on the
        # sibling devices of the same USB id
        for h in list(self.handles.values()):
            self.apply_mode(h)
        self.problems = ["%s: %s" % (h.did, h.error) for h in self.handles.values() if h.error] + list(self.cfg.errors)
        self.write_status()

    # ---- event processing -------------------------------------------------
    def forward(self, h, ev):
        if h.grabbed and h.passthrough is not None:
            try:
                h.passthrough.write(ev.type, ev.code, ev.value)
            except OSError:
                pass

    def handle_event(self, h, ev):
        cap = self.capture_for(h.did)
        # Only a device that is really read exclusively is "silent" during capture.
        exclusive_capture = cap is not None and cap["grab"] and h.grabbed
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
                h.frame_scan, h.frame_keys, h.frame_has_key_event, h.frame_pointer = None, [], False, False
        else:
            if ev.type in (ecodes.EV_REL, ecodes.EV_ABS):
                h.frame_pointer = True
            if not exclusive_capture:
                self.forward(h, ev)

    def process_frame(self, h, cap, exclusive_capture):
        scan = h.frame_scan
        if scan is not None and scan in self.cfg.ignore:
            scan = None
        pressed = [code for code, value in h.frame_keys if value == 1]

        # rc-core: scan code together with a recognised key -> remember; later frames with only this
        # scan code are repeats of the held key and are not treated as a key of their own.
        if scan is not None and pressed:
            h.scan_keys[scan] = pressed[0]
            if len(h.scan_keys) > 512:
                h.scan_keys.clear()
                h.scan_keys[scan] = pressed[0]
        if scan is not None and not h.frame_has_key_event and scan in h.scan_keys:
            return

        if cap is not None and cap["device"] == "*" and (h.frame_pointer or any(is_button(c) for c in pressed)):
            cap_skip = True              # detecting: mouse movement/click or touch is not a remote key
        else:
            cap_skip = False

        if cap is not None and not cap_skip and (scan is not None or pressed):
            key_code = pressed[0] if pressed else None
            ident = (h.did, "key", key_code) if key_code is not None else (h.did, "scan", scan)
            now = time.monotonic()
            last = self.last_capture.get(ident, 0.0)
            self.last_capture[ident] = now
            if key_code is not None or now - last > self.cfg.debounce:
                if cap["device"] == "*" and h.cls == "keyboard":
                    # detecting: from a keyboard only THAT a key came is reported - never which one
                    # (the events go to the web interface without authentication).
                    self.notify({"event": "capture", "device": h.did, "name": h.dev.name, "scan": None,
                                 "key_code": None, "class": h.cls, "key_name": None, "hidden": True})
                else:
                    self.notify({"event": "capture", "device": h.did, "name": h.dev.name, "scan": scan,
                                 "key_code": key_code, "class": h.cls,
                                 "key_name": key_name(key_code) if key_code is not None else None})
        if exclusive_capture:
            return

        for code, value in h.frame_keys:
            m = self.cfg.lookup(h.did, "key", code)
            if m is not None:
                if value == 1 or (value == 2 and m["repeat"]):
                    self.act(h, m, "key", code, value)
            elif value == 1 and not (cap is not None and cap["device"] == "*" and h.cls == "keyboard"):
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

    # ---- main loop --------------------------------------------------------
    def run(self):
        signal.signal(signal.SIGHUP, self._on_hup)
        signal.signal(signal.SIGTERM, self._on_term)
        signal.signal(signal.SIGINT, self._on_term)
        self.load()
        try:
            self.create_uinput()
        except Exception as exc:
            log("ERROR: /dev/uinput not usable (%s) - stopping without restart" % exc)
            return EXIT_CONFIG
        self.open_inject()
        self.scan_devices()
        last_scan = time.monotonic()
        had_capture = self.cfg.capture is not None
        while self.running:
            if self.reload_requested:
                self.reload_requested = False
                self.load()
                for h in self.handles.values():
                    h.scan_keys.clear()      # the key table of the driver may have changed (ir-keytable)
                self.ensure_uinput()
                self.scan_devices()
                last_scan = time.monotonic()
                had_capture = self.cfg.capture is not None
            self.check_thd()
            has_capture = self.capture_active() is not None
            if has_capture != had_capture or time.monotonic() - last_scan > RESCAN_INTERVAL:
                had_capture = has_capture
                self.scan_devices()
                last_scan = time.monotonic()
            fds = list(self.handles.keys())
            if self.inject_sock is not None:
                fds.append(self.inject_sock.fileno())
            try:
                ready, _, _ = select.select(fds, [], [], 1.0)
            except (OSError, ValueError):
                ready = []
                for fd in list(self.handles.keys()):
                    try:
                        os.fstat(fd)
                    except OSError:
                        self.close_handle(fd, "invalid")
            for fd in ready:
                if self.inject_sock is not None and fd == self.inject_sock.fileno():
                    self.handle_inject()
                    continue
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
        self.close_inject()
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
