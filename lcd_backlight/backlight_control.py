#!/usr/bin/env python3
"""
LCD Backlight Control based on Ambient Light Sensor (VEML7700)
Automatically adjusts display brightness based on surrounding light conditions
with additional boost during playback
"""

import smbus
import time
import os
import glob
import requests
import math
from typing import Optional
from datetime import datetime, timedelta

# ==================== DEFAULT CONFIGURATION ====================
INT_TIME = 1  # Interval for light measurement in seconds
MIN_BACKLIGHT = 12  # Minimum backlight value (0-255)
MAX_BACKLIGHT = 255  # Maximum backlight value
SMOOTHING_FACTOR = 0.3  # Smoothing factor for brightness changes (0.0-1.0)
LUX_MULTIPLIER = 0.75  # For gain=1/8, IT=100ms
PLAYBACK_BOOST = 10  # Additional brightness during playback (0-255)
PLAYBACK_BOOST_DURATION = 25  # Seconds to maintain boost after playback stops

# I2C Configuration
I2C_BUS = 1
VEML7700_ADDR = 0x10

# VEML7700 Registers
REG_ALS_CONF = 0x00
REG_ALS_WH = 0x01
REG_ALS_WL = 0x02
REG_POW_SAV = 0x03
REG_ALS = 0x04
REG_WHITE = 0x05
REG_INTERRUPT = 0x06

# Sensor configuration for max range (0-120Klx), lowest precision
CONF_VALUES = [0x00, 0x00]  # Max gain, 100ms integration time
INTERRUPT_HIGH = [0x00, 0x00]
INTERRUPT_LOW = [0x00, 0x00]
POWER_SAVE_MODE = [0x00, 0x00]

# Configuration directory
CONFIG_DIR = "/etc/lcd_backlight/"

# Volumio API endpoint
VOLUMIO_API_URL = "http://localhost:3000/api/v1/getState"


class BacklightController:
    def __init__(self):
        try:
            print("=== Initializing Backlight Controller ===")

            # Initialize basic attributes
            self.current_brightness = MIN_BACKLIGHT
            self.file_handle = None
            self.config_mtime = 0  # Track config file modification time
            self.enabled = True  # Service enabled/disabled flag
            self.config_exists = os.path.exists(CONFIG_DIR)
            
            # Initialize boost variables with default values
            self.playback_boost = PLAYBACK_BOOST
            self.playback_boost_duration = PLAYBACK_BOOST_DURATION

            # Playback state tracking
            self.is_playing = False
            self.last_playing_time = None
            self.playback_boost_active = False

            # Find backlight sysfs path
            print("Searching for backlight device...")
            backlight_paths = glob.glob("/sys/class/backlight/*/brightness")
            if not backlight_paths:
                raise FileNotFoundError("No backlight device found in /sys/class/backlight/")
            self.backlight_path = backlight_paths[0]
            print(f"Found backlight: {self.backlight_path}")

            # Initialize I2C bus
            print("Initializing I2C bus...")
            self.bus = smbus.SMBus(I2C_BUS)

            # Load configuration
            print("Loading configuration...")
            self._load_configuration()

            print(f"Backlight control initialized - {time.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"Config source: {'FILES' if self.config_exists else 'DEFAULT VALUES'}")
            print(f"Config: ENABLED={self.enabled}, MIN={self.min_backlight}, MAX={self.max_backlight}, INT_TIME={self.int_time}")
            print(f"        PLAYBACK_BOOST={self.playback_boost}, BOOST_DURATION={self.playback_boost_duration}s")

            # Initialize sensor
            self._init_sensor()

            # Set initial brightness only if enabled
            if self.enabled:
                print("Setting initial brightness...")
                # Nastavíme priamo minimálnu hodnotu pri štarte
                self.current_brightness = self.min_backlight
                self._write_brightness(self.current_brightness)
            else:
                print("Service is disabled, skipping initial brightness setup")

            print("=== Backlight Controller Initialized Successfully ===")

        except Exception as e:
            print(f"Error during initialization: {e}")
            raise

    def _get_config_mtime(self) -> float:
        """Get the latest modification time of all config files"""
        try:
            if not os.path.exists(CONFIG_DIR):
                return 0

            files = [
                'lcd_enabled',
                'lcd_min_backlight',
                'lcd_max_backlight',
                'lcd_int_time',
                'lcd_lux_multiplier',
                'lcd_smoothing_factor',
                'lcd_playback_boost',
                'lcd_playback_boost_duration'
            ]

            mtimes = []
            for filename in files:
                filepath = os.path.join(CONFIG_DIR, filename)
                if os.path.exists(filepath):
                    mtimes.append(os.path.getmtime(filepath))

            return max(mtimes) if mtimes else 0

        except Exception as e:
            print(f"Error getting config mtime: {e}")
            return 0

    def _check_config_changed(self) -> bool:
        """Check if configuration files have been modified or appeared/disappeared"""
        try:
            # Check if config directory existence changed
            config_exists_now = os.path.exists(CONFIG_DIR)

            if config_exists_now != self.config_exists:
                # Config directory appeared or disappeared
                self.config_exists = config_exists_now
                if config_exists_now:
                    print(f"\n[{time.strftime('%H:%M:%S')}] Configuration directory appeared, loading from files...")
                else:
                    print(f"\n[{time.strftime('%H:%M:%S')}] Configuration directory removed, using default values...")
                return True

            # If config exists, check for file modifications
            if config_exists_now:
                current_mtime = self._get_config_mtime()
                if current_mtime > self.config_mtime:
                    print(f"\n[{time.strftime('%H:%M:%S')}] Configuration files changed, reloading...")
                    self.config_mtime = current_mtime
                    return True

            return False

        except Exception as e:
            print(f"Error checking config changes: {e}")
            return False

    def _read_config_value(self, filename: str, default_value, value_type=str):
        """Read a single config value from file or return default"""
        try:
            if not os.path.exists(CONFIG_DIR):
                return default_value

            filepath = os.path.join(CONFIG_DIR, filename)
            if not os.path.exists(filepath):
                return default_value

            with open(filepath, "r") as f:
                value = f.read().strip()
                
            # If file is empty or only whitespace, return default
            if not value:
                return default_value

            if value_type == bool:
                return bool(int(value))
            elif value_type == int:
                return int(value)
            elif value_type == float:
                return float(value)
            else:
                return value

        except (ValueError, TypeError) as e:
            print(f"Error parsing {filename}, using default {default_value}: {e}")
            return default_value
        except Exception as e:
            print(f"Error reading {filename}, using default: {e}")
            return default_value

    def _load_configuration(self):
        """Load configuration from files if they exist, otherwise use defaults"""

        if os.path.exists(CONFIG_DIR):
            print(f"Loading configuration from: {CONFIG_DIR}")
            self.config_mtime = self._get_config_mtime()

            # Read all config values from files
            self.enabled = self._read_config_value('lcd_enabled', True, bool)
            self.min_backlight = self._read_config_value('lcd_min_backlight', MIN_BACKLIGHT, int)
            self.max_backlight = self._read_config_value('lcd_max_backlight', MAX_BACKLIGHT, int)
            self.int_time = self._read_config_value('lcd_int_time', INT_TIME, float)
            self.lux_multiplier = self._read_config_value('lcd_lux_multiplier', LUX_MULTIPLIER, float)
            self.smoothing_factor = self._read_config_value('lcd_smoothing_factor', SMOOTHING_FACTOR, float)
            
            # Read boost values with proper error handling
            self.playback_boost = self._read_config_value('lcd_playback_boost', PLAYBACK_BOOST, int)
            self.playback_boost_duration = self._read_config_value('lcd_playback_boost_duration', PLAYBACK_BOOST_DURATION, int)

            print(f"Loaded from files: enabled={self.enabled}, min={self.min_backlight}, max={self.max_backlight}")
            print(f"                   int_time={self.int_time}, lux_mult={self.lux_multiplier}, smooth={self.smoothing_factor}")
            print(f"                   playback_boost={self.playback_boost}, boost_duration={self.playback_boost_duration}s")

            # Verify boost values were loaded correctly
            if self.playback_boost > 0:
                print(f"!!! PLAYBACK BOOST ACTIVE: +{self.playback_boost} brightness during playback !!!")
        else:
            # Use default values from constants
            print(f"Config directory not found, using default values")
            self.config_mtime = 0
            self.enabled = True
            self.min_backlight = MIN_BACKLIGHT
            self.max_backlight = MAX_BACKLIGHT
            self.int_time = INT_TIME
            self.lux_multiplier = LUX_MULTIPLIER
            self.smoothing_factor = SMOOTHING_FACTOR
            # These are already set in __init__, but set them again for consistency
            self.playback_boost = PLAYBACK_BOOST
            self.playback_boost_duration = PLAYBACK_BOOST_DURATION

            print(f"Defaults: enabled={self.enabled}, min={self.min_backlight}, max={self.max_backlight}")
            print(f"          int_time={self.int_time}, lux_mult={self.lux_multiplier}, smooth={self.smoothing_factor}")
            print(f"          playback_boost={self.playback_boost}, boost_duration={self.playback_boost_duration}s")

    def _get_volumio_state(self) -> Optional[dict]:
        """Get current Volumio playback state"""
        try:
            response = requests.get(VOLUMIO_API_URL, timeout=2)
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            # Silently handle errors - don't spam logs
            pass
        return None

    def _update_playback_state(self):
        """Update playback state and boost status"""
        state = self._get_volumio_state()

        if state and 'status' in state:
            current_status = state['status']
            was_playing = self.is_playing

            # Update playing state
            self.is_playing = (current_status == 'play')

            if self.is_playing:
                # Currently playing - activate boost
                self.last_playing_time = datetime.now()
                if not self.playback_boost_active:
                    self.playback_boost_active = True
                    print(f"[{time.strftime('%H:%M:%S')}]  Playback STARTED - activating boost (+{self.playback_boost})")

            elif was_playing and not self.is_playing:
                # Just stopped playing - start boost countdown
                self.last_playing_time = datetime.now()
                print(f"[{time.strftime('%H:%M:%S')}]  Playback STOPPED - boost active for {self.playback_boost_duration}s")

            # Check if boost should be deactivated
            if self.playback_boost_active and not self.is_playing and self.last_playing_time:
                elapsed = (datetime.now() - self.last_playing_time).total_seconds()
                if elapsed > self.playback_boost_duration:
                    self.playback_boost_active = False
                    print(f"[{time.strftime('%H:%M:%S')}]  Boost period EXPIRED - deactivating")
        else:
            # API call failed - silently continue with current state
            pass

    def _init_sensor(self):
        """Initialize VEML7700 sensor with configuration"""
        try:
            self.bus.write_i2c_block_data(VEML7700_ADDR, REG_ALS_CONF, CONF_VALUES)
            self.bus.write_i2c_block_data(VEML7700_ADDR, REG_ALS_WH, INTERRUPT_HIGH)
            self.bus.write_i2c_block_data(VEML7700_ADDR, REG_ALS_WL, INTERRUPT_LOW)
            self.bus.write_i2c_block_data(VEML7700_ADDR, REG_POW_SAV, POWER_SAVE_MODE)
            time.sleep(0.1)  # Wait for sensor to stabilize
            print("VEML7700 sensor initialized successfully")
        except Exception as e:
            print(f"Error initializing sensor: {e}")
            raise

    def _read_lux(self) -> Optional[float]:
        """Read ambient light value from sensor in lux"""
        try:
            raw_value = self.bus.read_word_data(VEML7700_ADDR, REG_ALS)
            lux = raw_value * self.lux_multiplier
            return lux
        except Exception as e:
            print(f"Error reading sensor data: {e}")
            return None

    def _lux_to_brightness(self, lux: float) -> int:
        """
        Convert lux value to brightness level (min_backlight to max_backlight)
        Uses logarithmic curve for more natural perception
        """
        # Pre lux <= 1 vrátime priamo min_backlight
        if lux <= 1:
            return self.min_backlight

        # Logarithmic mapping: 1-10000 lux -> min_backlight-max_backlight
        max_lux = 10000  # Maximum expected lux

        # Logarithmic scale feels more natural to human perception
        # Zabezpecíme, že lux je aso 1 pre logaritmus
        lux_value = max(1.0, lux)
        
        # Výpet logaritmickej hodnoty
        log_ratio = math.log10(lux_value) / math.log10(max_lux)
        
        # Zabezpeíme, že pomer je medzi 0 a 1
        log_ratio = max(0.0, min(1.0, log_ratio))
        
        brightness = self.min_backlight + (self.max_backlight - self.min_backlight) * log_ratio
        
        # Zaokrúhlenie a obmedzenie na rozsah
        result = int(round(brightness))
        return max(self.min_backlight, min(self.max_backlight, result))

    def _write_brightness(self, value: int) -> bool:
        """Write brightness value to sysfs with optimized file handling"""
        try:
            if self.file_handle is None:
                self.file_handle = os.open(self.backlight_path, os.O_WRONLY)

            os.lseek(self.file_handle, 0, os.SEEK_SET)
            os.write(self.file_handle, str(value).encode())
            return True

        except OSError as e:
            print(f"Error writing brightness to {self.backlight_path}: {e}")
            self._close_file_handle()
            return False

    def _close_file_handle(self):
        """Safely close file handle"""
        if self.file_handle is not None:
            try:
                os.close(self.file_handle)
            except:
                pass
            finally:
                self.file_handle = None

    def _update_brightness(self, force: bool = False):
        """Read sensor and update backlight brightness"""
        # Skip if disabled
        if not self.enabled:
            return

        # Update playback state
        self._update_playback_state()

        lux = self._read_lux()

        if lux is None:
            # Ak senzor zlyhá, použijeme minimálnu hodnotu
            target_brightness = self.min_backlight
        else:
            target_brightness = self._lux_to_brightness(lux)

        # Apply playback boost if active - with proper validation
        if self.playback_boost_active and self.playback_boost > 0:
            target_brightness = min(self.max_backlight, target_brightness + self.playback_boost)

        # Smooth brightness changes to avoid flickering
        if not force:
            self.current_brightness = int(
                self.current_brightness * (1 - self.smoothing_factor) +
                target_brightness * self.smoothing_factor
            )
        else:
            self.current_brightness = target_brightness

        # Ensure current_brightness is within bounds
        self.current_brightness = max(self.min_backlight, min(self.max_backlight, self.current_brightness))

        success = self._write_brightness(self.current_brightness)


    def run(self):
        """Main control loop"""
        try:
            print("\n=== Starting main control loop ===")
            print("Monitoring for configuration changes and playback state...")

            while True:
                # Check for configuration changes
                if self._check_config_changed():
                    self._load_configuration()
                    print(f"Active config: ENABLED={self.enabled}, MIN={self.min_backlight}, MAX={self.max_backlight}, INT_TIME={self.int_time}")
                    print(f"               PLAYBACK_BOOST={self.playback_boost}, BOOST_DURATION={self.playback_boost_duration}s")

                # Update brightness if enabled
                if self.enabled:
                    self._update_brightness()
                    time.sleep(self.int_time)
                else:
                    # Check for config changes more frequently when disabled
                    time.sleep(1)

        except KeyboardInterrupt:
            print(f"\n\nBacklight control stopped - {time.strftime('%Y-%m-%d %H:%M:%S')}")
        finally:
            self.cleanup()

    def cleanup(self):
        """Cleanup resources"""
        print("Cleaning up resources...")
        self._close_file_handle()
        try:
            self.bus.close()
        except:
            pass


if __name__ == "__main__":
    try:
        controller = BacklightController()
        controller.run()
    except Exception as e:
        print(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
