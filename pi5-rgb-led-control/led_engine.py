import json
import requests
import time
import threading
import socket
import signal
import sys
import os
import math
from gpiozero import PWMLED

# --- CONSTANTS ---
# Updated to the "Standard Place" requested by balbuze
CONFIG_PATH = '/data/configuration/system_hardware/pi5-rgb-led-control/config.json'

# --- GLOBAL STATE ---
red, grn, blu = None, None, None
current_mode = "STANDBY"
last_play_color = [1.0, 1.0, 1.0]
stop_all = False

def load_config():
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r') as f:
                raw_conf = json.load(f)
                # This keeps your script working with Volumio's {"value": x} format
                # It extracts the actual value so your existing logic remains unchanged
                conf = {}
                for k, v in raw_conf.items():
                    if isinstance(v, dict) and 'value' in v:
                        conf[k] = v['value']
                    else:
                        conf[k] = v
                return conf
    except:
        pass
    return {}

def parse_color(color_str):
    try:
        return [float(x.strip()) for x in str(color_str).split(',')]
    except:
        return [0.5, 0.5, 0.5]

def get_ui_col(conf, prefix, old_key, fallback_str):
    """Bridges the 0-100 UI sliders to the 0.0-1.0 LED engine"""
    if f"{prefix}_R" in conf:
        try:
            r = float(conf.get(f"{prefix}_R")) / 100.0
            g = float(conf.get(f"{prefix}_G")) / 100.0
            b = float(conf.get(f"{prefix}_B")) / 100.0
            return [r, g, b]
        except:
            pass
    return parse_color(conf.get(old_key, fallback_str))

def set_led(rgb, brightness=1.0):
    if red and grn and blu:
        red.value = max(0, min(1, rgb[0] * brightness))
        grn.value = max(0, min(1, rgb[1] * brightness))
        blu.value = max(0, min(1, rgb[2] * brightness))

def check_internet(host="8.8.8.8", port=53, timeout=2):
    try:
        socket.setdefaulttimeout(timeout)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect((host, port))
        return True
    except:
        return False

# --- PATTERNS ---
def pattern_strobe(color, speed):
    set_led(color, 1.0)
    time.sleep(speed * 1.50) 
    set_led([0,0,0], 0)
    time.sleep(speed * 1.50)

def pattern_breath(color, speed, step):
    brightness = (math.sin(step) + 1) / 2
    set_led(color, brightness)
    time.sleep(speed)

def pattern_heartbeat(color, speed):
    set_led(color, 1.0)
    time.sleep(0.06) 
    set_led([0,0,0], 0)
    time.sleep(0.22) 
    set_led(color, 1.0)
    time.sleep(0.06)
    set_led([0,0,0], 0)
    time.sleep(speed * 12.5)

# --- SHUTDOWN ANIMATION ---
def run_singularity():
    """The 'Singularity' shutdown sequence: Blip -> Glow -> Dark -> Flash."""
    global red, grn, blu, last_play_color
    conf = load_config()
    
    # FIX: If the user explicitly disabled LEDs, skip the animation
    if conf.get("ENABLED") is False:
        set_led([0,0,0], 0)
        return

    # Timing: Fast=3s, Med=6s, Slow=10s
    speed_map = {"slow": 10.0, "medium": 6.0, "fast": 3.0}
    raw_spd = conf.get("SHUT_SPD", "medium")
    duration = speed_map.get(raw_spd, 6.0)
    
    # Glow Colour (Default White)
    glow_color = get_ui_col(conf, "SHUT", "SHUT_COL", "1.0, 1.0, 1.0")

    # 1. THE ACKNOWLEDGMENT BLIP
    set_led([0,0,0], 0)
    time.sleep(0.1)
    set_led(last_play_color, 1.0)
    time.sleep(0.15)
    set_led([0,0,0], 0)
    time.sleep(0.3)

    # 2. THE GATHERING GLOW
    steps = 100
    step_sleep = duration / steps
    for i in range(steps + 1):
        brightness = (i / steps) * 0.8
        set_led(glow_color, brightness)
        time.sleep(step_sleep)

    # 3. THE FINAL EVENT
    set_led([0,0,0], 0)
    time.sleep(0.2)
    set_led(glow_color, 1.0) # FINAL FLASH
    time.sleep(0.2)
    set_led([0,0,0], 0)

# --- LOOPS ---
def animation_loop():
    global stop_all, current_mode, last_play_color
    step = 0
    scan_index = 0
    
    while not stop_all:
        conf = load_config()
        
        # Check master toggle
        if conf.get("ENABLED") is False:
            set_led([0,0,0], 0)
            time.sleep(1)
            continue

        if current_mode == "ERROR":
            patt = conf.get("ERR_PATT", "strobe")
            spd = float(conf.get("ERR_SPD", 0.025))
            color = get_ui_col(conf, "ERR", "ERR_COL", "1.0, 0.0, 0.0")
            if patt == "solid":
                set_led(color, 1.0)
                time.sleep(0.1)
            elif patt == "strobe":
                pattern_strobe(color, spd)
            elif patt == "heartbeat":
                pattern_heartbeat(color, spd)
            else:
                pattern_breath(color, spd, step)
                step += 0.1
            continue

        elif current_mode == "SCAN":
            patt = conf.get("SCAN_PATT", "strobe")
            spd = float(conf.get("SCAN_SPD", 0.06))
            c1 = get_ui_col(conf, "SCA", "SCA_COL", "0.0, 0.3, 1.0")
            c2 = get_ui_col(conf, "SCB", "SCB_COL", "0.0, 1.0, 0.0")
            c3 = get_ui_col(conf, "SCC", "SCC_COL", "0.4, 1.0, 0.0")
            scan_list = [c1, c2, c3]
            color = scan_list[int(scan_index) % 3]
            if patt == "solid":
                set_led(color, 1.0)
                time.sleep(0.5)
            elif patt == "strobe":
                pattern_strobe(color, spd)
            elif patt == "heartbeat":
                pattern_heartbeat(color, spd)
            else:
                pattern_breath(color, spd, step)
                step += 0.1
            scan_index += 1
            continue 

        elif current_mode == "PAUSE":
            patt = conf.get("PAUSE_PATT", "breath")
            spd = float(conf.get("PAUSE_SPD", 0.05))
            color = last_play_color
        else: # STANDBY
            patt = conf.get("STBY_PATT", "breath")
            spd = float(conf.get("STBY_SPD", 0.05))
            color = get_ui_col(conf, "STB", "STBY_COL", "0.4, 0.6, 0.0")

        if current_mode == "SOLID":
            set_led(last_play_color, 1.0)
            time.sleep(0.1)
        elif patt == "solid":
            set_led(color, 1.0)
            time.sleep(0.1)
        elif patt == "strobe":
            pattern_strobe(color, spd)
        elif patt == "heartbeat":
            pattern_heartbeat(color, spd)
        else:
            pattern_breath(color, spd, step)
            step += 0.1

def monitor_system():
    global current_mode, last_play_color, stop_all, red, grn, blu
    fail_count = 0
    while not stop_all:
        conf = load_config()
        
        if conf.get("ENABLED") is False:
            if red:
                red.close(); grn.close(); blu.close()
                red = None; grn = None; blu = None
            time.sleep(1)
            continue

        try:
            rp = int(conf.get("PIN_R", 17))
            gp = int(conf.get("PIN_G", 27))
            bp = int(conf.get("PIN_B", 22))
            if red is None or red.pin.number != rp:
                if red:
                    red.close(); grn.close(); blu.close()
                red = PWMLED(rp)
                grn = PWMLED(gp)
                blu = PWMLED(bp)
        except:
            pass

        if not check_internet():
            fail_count += 1
        else:
            fail_count = 0

        if fail_count >= 3:
            current_mode = "ERROR"
        else:
            try:
                r = requests.get('http://localhost:3000/api/v1/getState', timeout=0.5).json()
                if r.get('updatedb', False):
                    current_mode = "SCAN"
                else:
                    status = str(r.get('status', 'stop')).lower()
                    if status == "play":
                        current_mode = "SOLID"
                        sr = str(r.get('samplerate', '')).lower()
                        bd = str(r.get('bitdepth', '')).lower()
                        
                        if "1 bit" in bd or "dsd" in sr:
                            last_play_color = get_ui_col(conf, "CDSD", "COL_DSD", "0.25, 0.0, 1.0")
                        elif "192" in sr or "176" in sr:
                            last_play_color = get_ui_col(conf, "C24U", "COL_24U", "0.0, 0.0, 1.0")
                        elif "96" in sr or "88" in sr or "24" in bd:
                            last_play_color = get_ui_col(conf, "C24H", "COL_24H", "0.0, 0.3, 1.0")
                        else:
                            last_play_color = get_ui_col(conf, "C16", "COL_16", "0.35, 0.75, 1.0")
                    elif status == "pause":
                        current_mode = "PAUSE"
                    else:
                        current_mode = "STANDBY"
            except:
                pass 
        time.sleep(1)

def handle_exit(signum, frame):
    global stop_all, red, grn, blu
    stop_all = True
    try:
        if red and grn and blu:
            run_singularity()
    except:
        pass
    if red:
        red.close(); grn.close(); blu.close()
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_exit)
signal.signal(signal.SIGINT, handle_exit)

if __name__ == "__main__":
    threading.Thread(target=animation_loop, daemon=True).start()
    try:
        monitor_system()
    except KeyboardInterrupt:
        handle_exit(None, None)