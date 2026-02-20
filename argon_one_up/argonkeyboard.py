#!/usr/bin/python3
#
# Argon ONE UP keyboard handler for Volumio.
# Brightness: ddcutil (display DDC/CI). Volume/mute: configurable (off = triggerhappy,
# or plugin file, or custom script). Battery status from upslog.txt.
#
# Run as: python3 argonkeyboard.py SERVICE
#

from evdev import InputDevice, categorize, ecodes, list_devices
from select import select

import subprocess
import json

import sys
import os
import time

from threading import Thread
from queue import Queue


UPS_LOGFILE = "/dev/shm/upslog.txt"
KEYBOARD_LOCKFILE = "/dev/shm/argononeupkeyboardlock.txt"
# Volumio: Node plugin reads this and shows pushToastMessage(type, title, message)
NOTIFY_FILE = "/dev/shm/argon_keyboard_notify.txt"
# Volume keys: Node plugin applies via volumiosetvolume (ALSA), not PipeWire
VOLUME_REQUEST_FILE = "/dev/shm/argon_volume_request.txt"

# Plugin config path (env override or default Volumio path)
CONFIG_FILE = os.environ.get("ARGON_ONE_UP_CONFIG", "/data/configuration/system_hardware/argon_one_up/config.json")

# Cached config and last load time
_config_cache = {}
_config_mtime = 0


def load_config():
    """Load plugin config from JSON file; cache by mtime."""
    global _config_cache, _config_mtime
    try:
        st = os.stat(CONFIG_FILE)
        if st.st_mtime != _config_mtime:
            with open(CONFIG_FILE, "r") as f:
                _config_cache = json.load(f)
            _config_mtime = st.st_mtime
    except Exception:
        pass
    return _config_cache


def get_config(key, default=None):
    """Get a config value (reloads if file changed)."""
    cfg = load_config()
    return cfg.get(key, default)

KEYCODE_BRIGHTNESSUP = "KEY_BRIGHTNESSUP"
KEYCODE_BRIGHTNESSDOWN = "KEY_BRIGHTNESSDOWN"
KEYCODE_VOLUMEUP = "KEY_VOLUMEUP"
KEYCODE_VOLUMEDOWN = "KEY_VOLUMEDOWN"
KEYCODE_PAUSE = "KEY_PAUSE"
KEYCODE_MUTE = "KEY_MUTE"


def debuglog(typestr, logstr):
    return


def runcmdlist(key, cmdlist):
    try:
        subprocess.run(cmdlist, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        debuglog(key + "-error", str(e))
    except FileNotFoundError:
        debuglog(key + "-error-filenotfound", "Command Not Found")
    except Exception as othererr:
        debuglog(key + "-error-other", str(othererr))


def createlockfile(fname):
    return False


def deletelockfile(fname):
    return True


def notifymessage(message, iscritical):
    """Write notification for Volumio Node plugin. Format: type|title|message (one line)."""
    if not isinstance(message, str) or len(message.strip()) == 0:
        return
    msg_escaped = message.replace("|", ",").replace("\n", " ").strip()
    toast_type = "warning" if iscritical else "info"
    title = "Argon ONE UP"
    line = toast_type + "|" + title + "|" + msg_escaped + "\n"
    try:
        with open(NOTIFY_FILE, "w") as f:
            f.write(line)
    except Exception:
        pass


def battery_loadlogdata():
    outobj = {}
    try:
        with open(UPS_LOGFILE, "r") as fp:
            logdata = fp.read()
        for line in logdata.split("\n"):
            tmpval = line.strip()
            if ":" in tmpval:
                curinfo = tmpval.split(":", 1)
                key = curinfo[0].lower().split()[0]
                outobj[key] = curinfo[1].strip()
    except Exception:
        pass
    return outobj


def keyboardevent_getdevicepaths():
    outlist = []
    try:
        for path in list_devices():
            try:
                tmpdevice = InputDevice(path)
                keyeventlist = tmpdevice.capabilities().get(ecodes.EV_KEY, [])
                if ecodes.KEY_BRIGHTNESSDOWN in keyeventlist and ecodes.KEY_BRIGHTNESSUP in keyeventlist:
                    outlist.append(path)
                elif ecodes.KEY_F2 in keyeventlist and ecodes.KEY_F3 in keyeventlist:
                    outlist.append(path)
                tmpdevice.close()
            except Exception:
                pass
    except Exception:
        pass
    return outlist


def keyboardevent_devicechanged(curlist, newlist):
    try:
        for curpath in curlist:
            if curpath not in newlist:
                return True
        for newpath in newlist:
            if newpath not in curlist:
                return True
    except Exception:
        pass
    return False


def keyboardevent_getbrigthnesstoolid():
    toolid = 0
    try:
        output = subprocess.check_output(["ddcutil", "--version"], text=True, stderr=subprocess.DEVNULL)
        lines = output.splitlines()
        if lines:
            toolid = int(lines[0].strip().split(" ")[1].split(".")[0])
    except Exception:
        pass
    return toolid


def keyboardevent_getbrigthnessinfo(toolid, defaultlevel=50):
    level = defaultlevel
    try:
        if toolid > 1:
            output = subprocess.check_output(
                ["ddcutil", "--disable-dynamic-sleep", "--sleep-multiplier", "0.1", "getvcp", "10"],
                text=True, stderr=subprocess.DEVNULL)
        else:
            output = subprocess.check_output(["ddcutil", "--sleep-multiplier", "0.1", "getvcp", "10"],
                text=True, stderr=subprocess.DEVNULL)
        level = int(output.split(":")[-1].split(",")[0].split("=")[-1].strip())
    except Exception:
        pass
    return {"level": level}


def keyboardevent_adjustbrigthness(toolid, baselevel, adjustval=5):
    curlevel = baselevel
    tmpval = max(10, min(100, curlevel + adjustval))
    if tmpval != curlevel:
        try:
            if toolid > 1:
                runcmdlist("brightness", ["ddcutil", "--disable-dynamic-sleep", "--sleep-multiplier", "0.1", "setvcp", "10", str(tmpval)])
            else:
                runcmdlist("brightness", ["ddcutil", "--sleep-multiplier", "0.1", "setvcp", "10", str(tmpval)])
            notifymessage("Brightness: " + str(tmpval) + "%", False)
        except Exception:
            return {"level": curlevel}
    return {"level": tmpval}


def handle_volume_action(action):
    """Handle volume key based on config: off (triggerhappy), custom script, or plugin file."""
    if action not in ("up", "down", "mute"):
        return

    # Check if plugin should handle volume (default: false = triggerhappy handles it)
    if not get_config("keyboard_handle_volume", False):
        return  # Do nothing; triggerhappy (core) handles volume

    # Check for custom script
    custom_enabled = get_config("keyboard_custom_script_enabled", False)
    custom_path = get_config("keyboard_custom_script_path", "")
    custom_name = get_config("keyboard_custom_script_name", "")

    if custom_enabled and custom_path and custom_name:
        # Run user custom script with action argument
        script = os.path.join(custom_path, custom_name)
        try:
            subprocess.run([script, action], capture_output=True, text=True, timeout=5)
        except Exception:
            pass
        return

    # Default: write to volume request file for Node plugin
    try:
        with open(VOLUME_REQUEST_FILE, "w") as f:
            f.write(action + "\n")
    except Exception:
        pass


def keyboard_getdevicefw(kbdevice):
    try:
        if kbdevice.info.vendor == 24704 and kbdevice.info.product == 32866:
            return "314"
    except Exception:
        pass
    return ""


def keyboardevemt_keyhandler(readq):
    ADJUSTTYPE_NONE = 0
    ADJUSTTYPE_BRIGHTNESS = 1
    ADJUSTTYPE_VOLUME = 2
    ADJUSTTYPE_MUTE = 3
    ADJUSTTYPE_BATTERYINFO = 4
    DATAREFRESHINTERVALSEC = 10
    FIRSTHOLDINTERVALSEC = 0.5
    HOLDWAITINTERVALSEC = 0.5

    volumetime = brightnesstime = time.time()
    curbrightness, brightnesstoolid = 50, 0
    try:
        brightnesstoolid = keyboardevent_getbrigthnesstoolid()
    except Exception:
        pass
    try:
        tmpobj = keyboardevent_getbrigthnessinfo(brightnesstoolid)
        curbrightness = tmpobj["level"]
    except Exception:
        pass

    while True:
        try:
            tmpkeymode, tmpkeycode, adjustval, adjusttype = 0, "", 0, ADJUSTTYPE_NONE
            tmpcode = readq.get()
            try:
                codeelements = tmpcode.split("+")
                if len(codeelements) == 2:
                    tmpkeymode = 1 if codeelements[0] == "PRESS" else 2
                    tmpkeycode = codeelements[1]
                elif tmpcode == "EXIT":
                    readq.task_done()
                    return
            except Exception:
                pass
            tmptime = time.time()
            if tmpkeycode in [KEYCODE_BRIGHTNESSDOWN, KEYCODE_BRIGHTNESSUP]:
                if tmpkeymode == 1 and tmptime - brightnesstime > DATAREFRESHINTERVALSEC:
                    try:
                        curbrightness = keyboardevent_getbrigthnessinfo(brightnesstoolid)["level"]
                    except Exception:
                        pass
                adjusttype = ADJUSTTYPE_BRIGHTNESS
                adjustval = -5 * tmpkeymode if tmpkeycode == KEYCODE_BRIGHTNESSDOWN else 5 * tmpkeymode
                brightnesstime = tmptime
            elif tmpkeycode in [KEYCODE_MUTE, KEYCODE_VOLUMEDOWN, KEYCODE_VOLUMEUP]:
                adjusttype = ADJUSTTYPE_MUTE if tmpkeycode == KEYCODE_MUTE else ADJUSTTYPE_VOLUME
                adjustval = 0 if tmpkeycode == KEYCODE_MUTE else (-5 * tmpkeymode if tmpkeycode == KEYCODE_VOLUMEDOWN else 5 * tmpkeymode)
                volumetime = tmptime
            elif tmpkeycode == KEYCODE_PAUSE:
                adjusttype = ADJUSTTYPE_BATTERYINFO
            else:
                readq.task_done()
                continue

            try:
                if createlockfile(KEYBOARD_LOCKFILE + ".a") == False:
                    if adjusttype == ADJUSTTYPE_BRIGHTNESS:
                        try:
                            curbrightness = keyboardevent_adjustbrigthness(brightnesstoolid, curbrightness, adjustval)["level"]
                        except Exception:
                            pass
                    elif adjusttype in (ADJUSTTYPE_VOLUME, ADJUSTTYPE_MUTE):
                        # Volume: off (triggerhappy), custom script, or plugin file (config-driven)
                        handle_volume_action("mute" if adjustval == 0 else ("down" if adjustval < 0 else "up"))
                    elif adjusttype == ADJUSTTYPE_BATTERYINFO:
                        outobj = battery_loadlogdata()
                        try:
                            notifymessage(outobj.get("power", "N/A"), False)
                        except Exception:
                            pass
                    deletelockfile(KEYBOARD_LOCKFILE + ".a")
            except Exception:
                pass
            readq.task_done()
        except Exception:
            time.sleep(10)


def keyboardevent_monitor(writeq):
    READTIMEOUTSECS = 1.0
    FIRSTHOLDINTERVALSEC = 0.5
    HOLDWAITINTERVALSEC = 0.5

    while True:
        try:
            keypresstimestamp = {}
            keyholdtimestamp = {}
            devicepathlist = keyboardevent_getdevicepaths()
            devicelist, devicefdlist, devicefwlist = [], [], []

            for path in devicepathlist:
                try:
                    tmpdevice = InputDevice(path)
                    devicelist.append(tmpdevice)
                    devicefdlist.append(tmpdevice.fd)
                    devicefwlist.append(keyboard_getdevicefw(tmpdevice))
                except Exception:
                    pass

            try:
                while devicefdlist:
                    r, w, x = select(devicefdlist, [], [], READTIMEOUTSECS)
                    for fd in r:
                        deviceidx = next((i for i, f in enumerate(devicefdlist) if f == fd), None)
                        if deviceidx is None:
                            continue
                        curdevicefw = devicefwlist[deviceidx]
                        for event in devicelist[deviceidx].read():
                            try:
                                if event.type != ecodes.EV_KEY:
                                    continue
                                key_event = categorize(event)
                                if event.value not in (1, 2):
                                    continue
                                keycodelist = [key_event.keycode] if isinstance(key_event.keycode, str) else list(key_event.keycode)
                                for k in keycodelist:
                                    tmpkeycode = k
                                    if curdevicefw == "314":
                                        if k == "KEY_PRINTSCREEN":
                                            tmpkeycode = KEYCODE_PAUSE
                                        elif k == "KEY_SYSRQ":
                                            tmpkeycode = KEYCODE_PAUSE
                                        elif k == KEYCODE_PAUSE:
                                            tmpkeycode = "KEY_PRINTSCREEN"
                                    if tmpkeycode not in [KEYCODE_BRIGHTNESSDOWN, KEYCODE_BRIGHTNESSUP, KEYCODE_VOLUMEDOWN, KEYCODE_VOLUMEUP]:
                                        if event.value == 2:
                                            continue
                                        if tmpkeycode not in [KEYCODE_PAUSE, KEYCODE_MUTE]:
                                            continue
                                    tmptime = time.time()
                                    finalmode = event.value
                                    if event.value == 2:
                                        if tmpkeycode not in keypresstimestamp or (tmptime - keypresstimestamp[tmpkeycode]) < FIRSTHOLDINTERVALSEC:
                                            continue
                                        if tmpkeycode in keyholdtimestamp and (tmptime - keyholdtimestamp[tmpkeycode]) < HOLDWAITINTERVALSEC:
                                            continue
                                    if finalmode == 1:
                                        keypresstimestamp[tmpkeycode] = tmptime
                                        writeq.put("PRESS+" + tmpkeycode)
                                    else:
                                        keyholdtimestamp[tmpkeycode] = tmptime
                                        writeq.put("HOLD+" + tmpkeycode)
                            except Exception:
                                pass

                    newpathlist = keyboardevent_getdevicepaths()
                    if keyboardevent_devicechanged(devicepathlist, newpathlist):
                        break

            except Exception:
                pass

            while devicelist:
                try:
                    devicelist.pop(0).close()
                except Exception:
                    pass

        except Exception:
            time.sleep(10)
    try:
        writeq.put("EXIT")
    except Exception:
        pass


if __name__ == "__main__" and len(sys.argv) > 1:
    cmd = sys.argv[1].upper()
    if cmd == "SERVICE":
        if createlockfile(KEYBOARD_LOCKFILE):
            pass  # Already running
        else:
            try:
                ipcq = Queue()
                t1 = Thread(target=keyboardevemt_keyhandler, args=(ipcq,))
                t2 = Thread(target=keyboardevent_monitor, args=(ipcq,))
                t1.start()
                t2.start()
                ipcq.join()
            except Exception:
                pass
            deletelockfile(KEYBOARD_LOCKFILE)
