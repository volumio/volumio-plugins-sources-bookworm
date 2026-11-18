#!/usr/bin/env python3
"""
LCD Backlight Control based on Ambient Light Sensor (VEML7700)
Automatically adjusts display brightness based on surrounding light conditions
with additional boost during playback
"""

import glob
import math
import os
import signal
import sys
import time
from typing import Optional

import smbus

# ==================== DEFAULT CONFIGURATION ====================
INT_TIME = 1  # Interval for light measurement in seconds
MIN_BACKLIGHT = 12  # Minimum backlight value (0-255)
MAX_BACKLIGHT = 255  # Maximum backlight value
SMOOTHING_FACTOR = 0.3  # Smoothing factor for brightness changes (0.05-1.0)
LUX_MULTIPLIER = 0.75  # Lux per raw count. Empirical calibration (datasheet: 0.0576 for gain x1, IT 100 ms)
PLAYBACK_BOOST = 0  # Additional brightness during playback (0-255)
PLAYBACK_BOOST_DURATION = 30  # Seconds to maintain boost after playback stops

# Limits for values read from configuration files
MIN_INT_TIME = 0.1
MIN_SMOOTHING_FACTOR = 0.05

# I2C Configuration
I2C_BUS = 1
VEML7700_ADDR = 0x10

# VEML7700 Registers
REG_ALS_CONF = 0x00
REG_ALS_WH = 0x01
REG_ALS_WL = 0x02
REG_POW_SAV = 0x03
REG_ALS = 0x04

# Sensor configuration: ALS gain x1, integration time 100 ms, interrupts off, power on
CONF_VALUES = [0x00, 0x00]
INTERRUPT_HIGH = [0x00, 0x00]
INTERRUPT_LOW = [0x00, 0x00]
POWER_SAVE_MODE = [0x00, 0x00]  # Power saving disabled

# Configuration directory (written by the Volumio plugin, index.js)
CONFIG_DIR = "/etc/lcd_backlight/"
CONFIG_FILES = [
    'lcd_enabled',
    'lcd_min_backlight',
    'lcd_max_backlight',
    'lcd_int_time',
    'lcd_lux_multiplier',
    'lcd_smoothing_factor',
    'lcd_playback_boost',
    'lcd_playback_boost_duration'
]

# Playback state written by the plugin (index.js) on every play/stop change: "1" = playing.
# It is not in CONFIG_FILES, so its changes do not reload the configuration.
PLAYING_FILE = os.path.join(CONFIG_DIR, "lcd_playing")


def log(message: str):
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def _terminate(signum, frame):
    # Raise SystemExit so that the "finally" block in run() restores the backlight
    raise SystemExit(0)


class BacklightController:
    def __init__(self):
        log("=== Initializing Backlight Controller ===")

        self.file_handle = None
        self.bus = None
        self.config_mtime = 0  # Latest modification time of config files
        self.config_exists = os.path.exists(CONFIG_DIR)
        self.enabled = True

        # Playback state tracking
        self.is_playing = False
        self.last_playing_time = None
        self.playback_boost_active = False

        # Find backlight sysfs device
        backlight_dirs = sorted(glob.glob("/sys/class/backlight/*"))
        if not backlight_dirs:
            raise FileNotFoundError("No backlight device found in /sys/class/backlight/")
        self.backlight_dir = backlight_dirs[0]
        self.backlight_path = os.path.join(self.backlight_dir, "brightness")
        self.device_max_brightness = self._read_int_file(
            os.path.join(self.backlight_dir, "max_brightness"), MAX_BACKLIGHT)
        log(f"Found backlight: {self.backlight_dir} (max_brightness={self.device_max_brightness})")

        log("Initializing I2C bus...")
        self.bus = smbus.SMBus(I2C_BUS)

        self._load_configuration()
        self._init_sensor()

        # Continue smoothly from the current brightness instead of jumping to a fixed value
        current = self._read_int_file(self.backlight_path, self.min_backlight)
        self.current_brightness = float(max(self.min_backlight, min(self.max_backlight, current)))

        log("=== Backlight Controller Initialized Successfully ===")

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _read_int_file(path: str, default: int) -> int:
        try:
            with open(path, "r") as f:
                return int(f.read().strip())
        except (OSError, ValueError):
            return default

    # ---------------------------------------------------------- configuration

    def _get_config_mtime(self) -> float:
        """Get the latest modification time of all config files"""
        mtimes = []
        for filename in CONFIG_FILES:
            filepath = os.path.join(CONFIG_DIR, filename)
            try:
                mtimes.append(os.path.getmtime(filepath))
            except OSError:
                pass
        return max(mtimes) if mtimes else 0

    def _check_config_changed(self) -> bool:
        """Check if configuration files have been modified or appeared/disappeared"""
        config_exists_now = os.path.exists(CONFIG_DIR)
        if config_exists_now != self.config_exists:
            self.config_exists = config_exists_now
            log("Configuration directory " + ("appeared" if config_exists_now else "removed"))
            return True

        if config_exists_now and self._get_config_mtime() > self.config_mtime:
            log("Configuration files changed, reloading...")
            return True

        return False

    def _read_config_value(self, filename: str, default_value, value_type=str):
        """Read a single config value from file or return default"""
        filepath = os.path.join(CONFIG_DIR, filename)
        try:
            with open(filepath, "r") as f:
                value = f.read().strip()
        except FileNotFoundError:
            return default_value
        except OSError as e:
            log(f"Error reading {filename}, using default {default_value}: {e}")
            return default_value

        if not value:
            return default_value

        try:
            if value_type == bool:
                return bool(int(value))
            if value_type == int:
                return int(float(value))
            if value_type == float:
                result = float(value)
                if math.isnan(result) or math.isinf(result):
                    raise ValueError(value)
                return result
            return value
        except (ValueError, TypeError) as e:
            log(f"Error parsing {filename}, using default {default_value}: {e}")
            return default_value

    def _load_configuration(self):
        """Load configuration from files if they exist, otherwise use defaults"""
        self.config_mtime = self._get_config_mtime()
        self.config_exists = os.path.exists(CONFIG_DIR)

        # Missing files/directory -> defaults (handled by _read_config_value)
        self.enabled = self._read_config_value('lcd_enabled', True, bool)
        self.min_backlight = self._read_config_value('lcd_min_backlight', MIN_BACKLIGHT, int)
        self.max_backlight = self._read_config_value('lcd_max_backlight', MAX_BACKLIGHT, int)
        self.int_time = self._read_config_value('lcd_int_time', INT_TIME, float)
        self.lux_multiplier = self._read_config_value('lcd_lux_multiplier', LUX_MULTIPLIER, float)
        self.smoothing_factor = self._read_config_value('lcd_smoothing_factor', SMOOTHING_FACTOR, float)
        self.playback_boost = self._read_config_value('lcd_playback_boost', PLAYBACK_BOOST, int)
        self.playback_boost_duration = self._read_config_value(
            'lcd_playback_boost_duration', PLAYBACK_BOOST_DURATION, int)

        # Sanitize values
        self.max_backlight = max(0, min(self.device_max_brightness, self.max_backlight))
        self.min_backlight = max(0, min(self.device_max_brightness, self.min_backlight))
        if self.min_backlight > self.max_backlight:
            self.min_backlight, self.max_backlight = self.max_backlight, self.min_backlight
        self.int_time = max(MIN_INT_TIME, self.int_time)
        self.smoothing_factor = max(MIN_SMOOTHING_FACTOR, min(1.0, self.smoothing_factor))
        self.lux_multiplier = max(0.0, self.lux_multiplier)
        self.playback_boost = max(0, self.playback_boost)
        self.playback_boost_duration = max(0, self.playback_boost_duration)

        log(f"Config ({'files' if self.config_exists else 'defaults'}): enabled={self.enabled}, "
            f"min={self.min_backlight}, max={self.max_backlight}, int_time={self.int_time}, "
            f"lux_mult={self.lux_multiplier}, smooth={self.smoothing_factor}, "
            f"boost={self.playback_boost}, boost_duration={self.playback_boost_duration}s")

    # --------------------------------------------------------- playback state

    @staticmethod
    def _read_playing() -> bool:
        """Read playback state written by the plugin. Missing or unreadable file = not playing."""
        try:
            with open(PLAYING_FILE, "r") as f:
                return f.read().strip() == "1"
        except OSError:
            return False

    def _update_playback_state(self):
        """Update playback state and boost status"""
        now = time.monotonic()
        was_playing = self.is_playing
        self.is_playing = self._read_playing()

        if self.is_playing:
            self.last_playing_time = now
            if not self.playback_boost_active:
                self.playback_boost_active = True
                if self.playback_boost > 0:
                    log(f"Playback STARTED - activating boost (+{self.playback_boost})")
        elif was_playing:
            self.last_playing_time = now
            if self.playback_boost > 0:
                log(f"Playback STOPPED - boost active for {self.playback_boost_duration}s")

        # Check if boost should be deactivated
        if self.playback_boost_active and not self.is_playing and self.last_playing_time is not None:
            if now - self.last_playing_time > self.playback_boost_duration:
                self.playback_boost_active = False
                if self.playback_boost > 0:
                    log("Boost period EXPIRED - deactivating")

    # ----------------------------------------------------------------- sensor

    def _init_sensor(self):
        """Initialize VEML7700 sensor with configuration"""
        self.bus.write_i2c_block_data(VEML7700_ADDR, REG_ALS_CONF, CONF_VALUES)
        self.bus.write_i2c_block_data(VEML7700_ADDR, REG_ALS_WH, INTERRUPT_HIGH)
        self.bus.write_i2c_block_data(VEML7700_ADDR, REG_ALS_WL, INTERRUPT_LOW)
        self.bus.write_i2c_block_data(VEML7700_ADDR, REG_POW_SAV, POWER_SAVE_MODE)
        time.sleep(0.1)  # Wait for the first measurement (integration time 100 ms)
        log("VEML7700 sensor initialized successfully")

    def _read_lux(self) -> Optional[float]:
        """Read ambient light value from sensor in lux"""
        try:
            raw_value = self.bus.read_word_data(VEML7700_ADDR, REG_ALS)
            return raw_value * self.lux_multiplier
        except OSError as e:
            log(f"Error reading sensor data: {e}")
            return None

    def _lux_to_brightness(self, lux: float) -> float:
        """
        Convert lux value to brightness level (min_backlight to max_backlight)
        Uses logarithmic curve for more natural perception
        """
        if lux <= 1:
            return float(self.min_backlight)

        # Logarithmic mapping: 1-10000 lux -> min_backlight-max_backlight
        max_lux = 10000
        log_ratio = math.log10(lux) / math.log10(max_lux)
        log_ratio = max(0.0, min(1.0, log_ratio))

        return self.min_backlight + (self.max_backlight - self.min_backlight) * log_ratio

    # -------------------------------------------------------------- backlight

    def _write_brightness(self, value: int) -> bool:
        """Write brightness value to sysfs, keeping the file open between writes"""
        try:
            if self.file_handle is None:
                self.file_handle = os.open(self.backlight_path, os.O_WRONLY)

            os.lseek(self.file_handle, 0, os.SEEK_SET)
            os.write(self.file_handle, str(value).encode())
            return True

        except OSError as e:
            log(f"Error writing brightness to {self.backlight_path}: {e}")
            self._close_file_handle()
            return False

    def _close_file_handle(self):
        """Safely close file handle"""
        if self.file_handle is not None:
            try:
                os.close(self.file_handle)
            except OSError:
                pass
            finally:
                self.file_handle = None

    def _restore_full_brightness(self):
        """Set the display to full brightness (state without automatic control)"""
        if self._write_brightness(self.device_max_brightness):
            log(f"Backlight restored to {self.device_max_brightness}")

    def _update_brightness(self):
        """Read sensor and update backlight brightness"""
        self._update_playback_state()

        lux = self._read_lux()
        if lux is None:
            # Sensor read failed - keep the current brightness
            return

        target_brightness = self._lux_to_brightness(lux)

        if self.playback_boost_active and self.playback_boost > 0:
            target_brightness = min(self.max_backlight, target_brightness + self.playback_boost)

        # Smooth brightness changes to avoid flickering.
        # The smoothed value is kept as float, so it converges to the target.
        self.current_brightness += (target_brightness - self.current_brightness) * self.smoothing_factor
        self.current_brightness = max(self.min_backlight, min(self.max_backlight, self.current_brightness))

        brightness = int(round(self.current_brightness))
        self._write_brightness(brightness)

        # Uncomment for debugging:
        # boost_indicator = " [BOOST]" if self.playback_boost_active and self.playback_boost > 0 else ""
        # log(f"Lux: {lux:8.1f} | Brightness: {brightness:3d}/{self.max_backlight}{boost_indicator}")

    # -------------------------------------------------------------- main loop

    def run(self):
        """Main control loop"""
        log("=== Starting main control loop ===")
        try:
            while True:
                if self._check_config_changed():
                    was_enabled = self.enabled
                    self._load_configuration()
                    if was_enabled and not self.enabled:
                        self._restore_full_brightness()

                if self.enabled:
                    self._update_brightness()
                    time.sleep(self.int_time)
                else:
                    # Check for config changes every second while disabled
                    time.sleep(1)

        except KeyboardInterrupt:
            pass
        finally:
            log("Backlight control stopped")
            self._restore_full_brightness()
            self.cleanup()

    def cleanup(self):
        """Cleanup resources"""
        self._close_file_handle()
        if self.bus is not None:
            try:
                self.bus.close()
            except OSError:
                pass


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _terminate)
    try:
        controller = BacklightController()
    except Exception as e:
        log(f"Fatal error during initialization: {e}")
        import traceback
        traceback.print_exc()
        # Non-zero exit code -> systemd restarts the service (Restart=on-failure)
        sys.exit(1)

    controller.run()
