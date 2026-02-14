'use strict';

/**
 * Argon ONE UP Plugin for Volumio 4
 * 
 * Provides UPS battery monitoring, fan control, power button handling,
 * and lid close detection for Argon ONE UP case.
 * 
 * Hardware interfaces:
 * - Battery gauge: I2C 0x64
 * - Fan controller: I2C 0x1a
 * - Power button: GPIO 4 (via dtoverlay for halt-state support)
 * - Lid sensor: GPIO 27
 */

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var gpiox = require('@iiot2k/gpiox');

var USERCONFIG_PATH = '/boot/userconfig.txt';
var GPIO_LID = 27;
var GPIO_POWER = 4;

// Keyboard handler (Python) reads battery from here; writes notifications here for Node to show as toasts
var UPS_LOGFILE = '/dev/shm/upslog.txt';
var KEYBOARD_NOTIFY_FILE = '/dev/shm/argon_keyboard_notify.txt';
// Volume keys: Python writes "up"|"down"|"mute"; Node applies via Volumio ALSA (volumiosetvolume)
var KEYBOARD_VOLUME_REQUEST_FILE = '/dev/shm/argon_volume_request.txt';

module.exports = ArgonOneUp;

function ArgonOneUp(context) {
    var self = this;

    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    self.configManager = self.context.configManager;

    // I2C configuration
    self.i2cBus = 1;
    self.batteryAddress = 0x64;
    self.fanAddress = 0x1a;

    // Device state
    self.deviceFound = false;
    self.batteryFound = false;
    self.fanFound = false;
    self.pi5FanAvailable = false;  // Pi 5 native PWM fan (via cooling_fan dtoverlay)

    // Battery state
    self.batteryLevel = 0;
    self.batteryCharging = false;
    self.lastBatteryWarning = 0;

    // Fan state
    self.currentFanSpeed = 0;
    self.currentFanRpm = 0;  // Pi 5 fan RPM from cooling_fan interface
    self.cpuTemperature = 0;

    // Lid state
    self.lidClosed = false;
    self.lidShutdownTimer = null;
    self.lidGpioInitialized = false;

    // Power button state
    self.powerButtonGpioInitialized = false;
    self.powerButtonLastState = 1;  // 1 = released (high), 0 = pressed (low)
    self.powerButtonPressTime = 0;
    self.powerButtonPulseCount = 0;
    self.powerButtonPulseTimer = null;
    self.powerButtonMonitorInterval = null;

    // Monitoring intervals
    self.batteryMonitorInterval = null;
    self.fanControlInterval = null;
    self.gpioMonitorInterval = null;
    self.keyboardNotifyInterval = null;

    // Timing constants
    self.BATTERY_CHECK_MS = 10000;   // 10 seconds
    self.FAN_CHECK_MS = 5000;        // 5 seconds
    self.GPIO_CHECK_MS = 500;        // 500ms

    // Debug logging
    self.debugLogging = false;
}

// ---------------------------------------------------------------------------
// Volumio Lifecycle
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(
        self.context, 'config.json'
    );

    self.config = new (require('v-conf'))();
    // Always loadFile so v-conf has the path for save(); same as volumio-plugins-sources-bookworm
    self.config.loadFile(configFile);
    self.logger.info('ArgonOneUp: Config path ' + configFile);

    return libQ.resolve();
};

ArgonOneUp.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('ArgonOneUp: Starting plugin');

    self.loadI18nStrings();
    self.loadConfig();

    self.checkDevices()
        .then(function() {
            if (self.deviceFound) {
                self.initializeHardware();
                self.startMonitoring();
                self.logger.info('ArgonOneUp: Plugin started successfully');
            } else {
                self.logger.warn('ArgonOneUp: No Argon ONE UP hardware detected');
            }
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('ArgonOneUp: Startup failed: ' + err);
            defer.resolve();
        });

    return defer.promise;
};

ArgonOneUp.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('ArgonOneUp: Stopping plugin');

    self.stopMonitoring();

    // Turn off fan gracefully
    if (self.fanFound) {
        self.setFanSpeed(0);
    }

    defer.resolve();
    return defer.promise;
};

ArgonOneUp.prototype.onVolumioShutdown = function() {
    var self = this;

    self.logger.info('ArgonOneUp: System shutdown');
    self.stopMonitoring();

    // Signal power off to Argon controller
    if (self.fanFound) {
        self.signalPowerOff();
    }

    return libQ.resolve();
};

ArgonOneUp.prototype.onVolumioReboot = function() {
    var self = this;

    self.logger.info('ArgonOneUp: System reboot');
    self.stopMonitoring();

    return libQ.resolve();
};

// ---------------------------------------------------------------------------
// Configuration Loading
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.loadConfig = function() {
    var self = this;

    // Always use hardcoded defaults first
    self.i2cBus = 1;
    self.batteryAddress = 0x64;
    self.fanAddress = 0x1a;
    self.debugLogging = false;

    // Try to load from config if available
    if (self.config) {
        try {
            var bus = self.config.get('i2c_bus');
            var battAddr = self.config.get('battery_address');
            var fanAddr = self.config.get('fan_address');
            var debug = self.config.get('debug_logging');

            self.logger.info('ArgonOneUp: Raw config - bus=' + bus + 
                           ' batt=' + battAddr + ' fan=' + fanAddr);

            if (typeof bus === 'number' && bus > 0) {
                self.i2cBus = bus;
            }
            if (typeof battAddr === 'string' && battAddr.length > 0) {
                self.batteryAddress = parseInt(battAddr, 16);
            }
            if (typeof fanAddr === 'string' && fanAddr.length > 0) {
                self.fanAddress = parseInt(fanAddr, 16);
            }
            if (debug === true) {
                self.debugLogging = true;
            }
        } catch (e) {
            self.logger.error('ArgonOneUp: Config read error: ' + e.message);
        }
    } else {
        self.logger.warn('ArgonOneUp: No config object, using defaults');
    }

    self.logger.info('ArgonOneUp: Using - bus=' + self.i2cBus + 
                    ' battery=0x' + self.batteryAddress.toString(16) +
                    ' fan=0x' + self.fanAddress.toString(16));
};

ArgonOneUp.prototype.logDebug = function(msg) {
    var self = this;
    if (self.debugLogging) {
        self.logger.info(msg);
    }
};

// ---------------------------------------------------------------------------
// I2C Operations
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.i2cDetect = function(address) {
    var self = this;
    var defer = libQ.defer();

    // Validate parameters
    if (typeof self.i2cBus !== 'number' || typeof address !== 'number') {
        self.logger.error('ArgonOneUp: i2cDetect invalid params bus=' + self.i2cBus + ' addr=' + address);
        defer.resolve(false);
        return defer.promise;
    }

    var cmd = 'sudo /usr/sbin/i2cdetect -y ' + self.i2cBus + ' 0x' + 
              address.toString(16) + ' 0x' + address.toString(16);

    self.logDebug('ArgonOneUp: ' + cmd);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            defer.resolve(false);
        } else {
            // Check if address appears in output (not --)
            var found = stdout.indexOf(address.toString(16)) !== -1 &&
                       stdout.indexOf('--') === -1;
            self.logDebug('ArgonOneUp: i2cDetect 0x' + address.toString(16) + ' found=' + found);
            defer.resolve(found);
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.i2cRead = function(address, register) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo /usr/sbin/i2cget -y ' + self.i2cBus + ' 0x' +
              address.toString(16) + ' 0x' + register.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            self.logDebug('ArgonOneUp: I2C read error: ' + error.message);
            defer.reject(error);
        } else {
            var value = parseInt(stdout.trim(), 16);
            defer.resolve(value);
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.i2cWrite = function(address, register, value) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo /usr/sbin/i2cset -y ' + self.i2cBus + ' 0x' +
              address.toString(16) + ' 0x' + register.toString(16) +
              ' 0x' + value.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            self.logDebug('ArgonOneUp: I2C write error: ' + error.message);
            defer.reject(error);
        } else {
            defer.resolve();
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.i2cWriteByte = function(address, value) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo /usr/sbin/i2cset -y ' + self.i2cBus + ' 0x' +
              address.toString(16) + ' 0x' + value.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            self.logDebug('ArgonOneUp: I2C write byte error: ' + error.message);
            defer.reject(error);
        } else {
            defer.resolve();
        }
    });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// Device Detection and Initialization
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.checkDevices = function() {
    var self = this;
    var defer = libQ.defer();

    // Check for Pi 5 cooling fan (dtoverlay=cooling_fan)
    // Argon ONE UP uses Pi 5's native PWM fan, not I2C at 0x1a
    self.getPi5FanSpeed()
        .then(function(rpm) {
            self.pi5FanAvailable = (rpm >= 0);
            self.logger.info('ArgonOneUp: Pi 5 cooling fan ' + 
                         (self.pi5FanAvailable ? 'available (RPM: ' + rpm + ')' : 'not available (dtoverlay=cooling_fan may be needed)'));
            
            // Check for battery gauge (identifies UP version)
            return self.i2cDetect(self.batteryAddress);
        })
        .then(function(found) {
            self.batteryFound = found;
            self.logger.info('ArgonOneUp: Battery gauge ' + 
                         (found ? 'found' : 'not found') + 
                         ' at 0x' + self.batteryAddress.toString(16));
            
            // Device is found if battery is present (identifies Argon ONE UP)
            // Fan is controlled by Pi 5's native PWM, not I2C
            self.deviceFound = self.batteryFound;
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('ArgonOneUp: Device detection failed: ' + err);
            defer.resolve();
        });

    return defer.promise;
};

ArgonOneUp.prototype.initializeHardware = function() {
    var self = this;

    // Initialize fan to off
    if (self.fanFound) {
        self.setFanSpeed(0);
    }

    // Initialize battery profile if battery is present
    if (self.batteryFound) {
        self.initBattery();
    }
};

// ---------------------------------------------------------------------------
// Battery Management
// ---------------------------------------------------------------------------

// Battery register addresses (based on Argon scripts)
ArgonOneUp.prototype.BATTERY_REG = {
    CONTROL: 0x08,
    SOC_HIGH: 0x04,
    SOC_LOW: 0x05,
    CURRENT_HIGH: 0x0E,
    SOCALERT: 0x0B,
    GPIOCONFIG: 0x0A,
    PROFILE: 0x10,
    ICSTATE: 0xA7
};

// Battery profile data from Argon scripts (80 bytes)
ArgonOneUp.prototype.BATTERY_PROFILE = [
    0x32,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xA8,0xAA,
    0xBE,0xC6,0xB8,0xAE,0xC2,0x98,0x82,0xFF,0xFF,0xCA,
    0x98,0x75,0x63,0x55,0x4E,0x4C,0x49,0x98,0x88,0xDC,
    0x34,0xDB,0xD3,0xD4,0xD3,0xD0,0xCE,0xCB,0xBB,0xE7,
    0xA2,0xC2,0xC4,0xAE,0x96,0x89,0x80,0x74,0x67,0x63,
    0x71,0x8E,0x9F,0x85,0x6F,0x3B,0x20,0x00,0xAB,0x10,
    0xFF,0xB0,0x73,0x00,0x00,0x00,0x64,0x08,0xD3,0x77,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFA
];

ArgonOneUp.prototype.initBattery = function() {
    var self = this;

    self.logger.info('ArgonOneUp: Initializing battery...');

    // Check and update battery profile (like Argon scripts do)
    self.batteryCheckUpdateProfile()
        .then(function() {
            self.logger.info('ArgonOneUp: Battery initialization complete');
        })
        .fail(function(err) {
            self.logger.warn('ArgonOneUp: Battery init warning: ' + err);
        });
};

// Check battery status - returns 0 if OK, non-zero on error
ArgonOneUp.prototype.batteryGetStatus = function(restartIfNotActive) {
    var self = this;
    var defer = libQ.defer();

    self.i2cRead(self.batteryAddress, self.BATTERY_REG.CONTROL)
        .then(function(value) {
            if (value !== 0) {
                if (restartIfNotActive) {
                    self.logDebug('ArgonOneUp: Battery inactive, restarting...');
                    return self.batteryRestart();
                }
                defer.resolve(2); // Inactive
                return;
            }
            // Check SOCALERT profile flag
            return self.i2cRead(self.batteryAddress, self.BATTERY_REG.SOCALERT);
        })
        .then(function(value) {
            if (value === undefined) return; // Already resolved
            if ((value & 0x80) === 0) {
                self.logDebug('ArgonOneUp: Battery profile not ready');
                defer.resolve(3); // Profile not ready
                return;
            }
            defer.resolve(0); // OK
        })
        .fail(function(err) {
            self.logDebug('ArgonOneUp: Battery status error: ' + err);
            defer.resolve(1); // Error
        });

    return defer.promise;
};

// Restart battery - returns 0 on success
ArgonOneUp.prototype.batteryRestart = function() {
    var self = this;
    var defer = libQ.defer();
    var maxRetry = 3;

    function tryRestart() {
        if (maxRetry <= 0) {
            self.logger.warn('ArgonOneUp: Battery restart failed after retries');
            defer.resolve(2);
            return;
        }
        maxRetry--;

        // Restart sequence
        self.i2cWrite(self.batteryAddress, self.BATTERY_REG.CONTROL, 0x30)
            .then(function() {
                return libQ.delay(500);
            })
            .then(function() {
                return self.i2cWrite(self.batteryAddress, self.BATTERY_REG.CONTROL, 0x00);
            })
            .then(function() {
                return libQ.delay(500);
            })
            .then(function() {
                // Wait for ready status (check ICSTATE)
                return self.waitForBatteryReady(5);
            })
            .then(function(ready) {
                if (ready) {
                    self.logger.info('ArgonOneUp: Battery restarted successfully');
                    defer.resolve(0);
                } else {
                    tryRestart(); // Retry
                }
            })
            .fail(function() {
                tryRestart(); // Retry on error
            });
    }

    tryRestart();
    return defer.promise;
};

// Wait for battery ICSTATE ready (bits 2-3 set)
ArgonOneUp.prototype.waitForBatteryReady = function(maxWaitSecs) {
    var self = this;
    var defer = libQ.defer();

    function checkReady(remaining) {
        if (remaining <= 0) {
            defer.resolve(false);
            return;
        }

        self.i2cRead(self.batteryAddress, self.BATTERY_REG.ICSTATE)
            .then(function(value) {
                if ((value & 0x0C) !== 0) {
                    defer.resolve(true);
                } else {
                    setTimeout(function() {
                        checkReady(remaining - 1);
                    }, 1000);
                }
            })
            .fail(function() {
                setTimeout(function() {
                    checkReady(remaining - 1);
                }, 1000);
            });
    }

    checkReady(maxWaitSecs);
    return defer.promise;
};

// Check and update battery profile if needed
ArgonOneUp.prototype.batteryCheckUpdateProfile = function() {
    var self = this;
    var defer = libQ.defer();
    var maxRetry = 5;

    function attemptProfileCheck() {
        if (maxRetry <= 0) {
            self.logger.warn('ArgonOneUp: Battery profile check failed after retries');
            defer.resolve();
            return;
        }
        maxRetry--;

        self.batteryGetStatus(true)
            .then(function(status) {
                if (status === 0) {
                    // Status OK, verify profile
                    return self.batteryVerifyProfile();
                }
                self.logDebug('ArgonOneUp: Battery status ' + status + ', will attempt profile update');
                return false;
            })
            .then(function(profileMatch) {
                if (profileMatch === true) {
                    self.logger.info('ArgonOneUp: Battery profile verified');
                    defer.resolve();
                    return;
                }
                // Need to update profile
                return self.batteryWriteProfile();
            })
            .then(function(result) {
                if (result === undefined) return; // Already resolved
                if (result === true) {
                    self.logger.info('ArgonOneUp: Battery profile updated');
                    defer.resolve();
                } else {
                    // Retry after delay
                    setTimeout(attemptProfileCheck, 10000);
                }
            })
            .fail(function(err) {
                self.logDebug('ArgonOneUp: Profile check error: ' + err);
                setTimeout(attemptProfileCheck, 10000);
            });
    }

    attemptProfileCheck();
    return defer.promise;
};

// Verify battery profile matches expected data
ArgonOneUp.prototype.batteryVerifyProfile = function() {
    var self = this;
    var defer = libQ.defer();
    var idx = 0;

    function checkByte() {
        if (idx >= self.BATTERY_PROFILE.length) {
            defer.resolve(true); // All bytes match
            return;
        }

        self.i2cRead(self.batteryAddress, self.BATTERY_REG.PROFILE + idx)
            .then(function(value) {
                if (value !== self.BATTERY_PROFILE[idx]) {
                    self.logDebug('ArgonOneUp: Profile mismatch at byte ' + idx);
                    defer.resolve(false);
                    return;
                }
                idx++;
                checkByte();
            })
            .fail(function() {
                defer.resolve(false);
            });
    }

    checkByte();
    return defer.promise;
};

// Write battery profile data
ArgonOneUp.prototype.batteryWriteProfile = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('ArgonOneUp: Writing battery profile...');

    // Put battery in sleep state for profile write
    self.i2cWrite(self.batteryAddress, self.BATTERY_REG.CONTROL, 0x30)
        .then(function() {
            return libQ.delay(500);
        })
        .then(function() {
            return self.i2cWrite(self.batteryAddress, self.BATTERY_REG.CONTROL, 0xF0); // Sleep
        })
        .then(function() {
            return libQ.delay(500);
        })
        .then(function() {
            // Write profile bytes sequentially
            return self.batteryWriteProfileBytes(0);
        })
        .then(function() {
            // Set update flag
            return self.i2cWrite(self.batteryAddress, self.BATTERY_REG.SOCALERT, 0x80);
        })
        .then(function() {
            return libQ.delay(500);
        })
        .then(function() {
            // Close interrupts
            return self.i2cWrite(self.batteryAddress, self.BATTERY_REG.GPIOCONFIG, 0);
        })
        .then(function() {
            return libQ.delay(500);
        })
        .then(function() {
            // Restart battery
            return self.batteryRestart();
        })
        .then(function(result) {
            defer.resolve(result === 0);
        })
        .fail(function(err) {
            self.logger.error('ArgonOneUp: Profile write failed: ' + err);
            defer.resolve(false);
        });

    return defer.promise;
};

// Write profile bytes one at a time
ArgonOneUp.prototype.batteryWriteProfileBytes = function(idx) {
    var self = this;

    if (idx >= self.BATTERY_PROFILE.length) {
        return libQ.resolve();
    }

    return self.i2cWrite(self.batteryAddress, self.BATTERY_REG.PROFILE + idx, self.BATTERY_PROFILE[idx])
        .then(function() {
            return self.batteryWriteProfileBytes(idx + 1);
        });
};

ArgonOneUp.prototype.getBatteryLevel = function() {
    var self = this;
    var defer = libQ.defer();

    if (!self.batteryFound) {
        defer.resolve(-1);
        return defer.promise;
    }

    self.i2cRead(self.batteryAddress, self.BATTERY_REG.SOC_HIGH)
        .then(function(value) {
            var level = Math.min(100, Math.max(0, value));
            defer.resolve(level);
        })
        .fail(function(err) {
            defer.resolve(-1);
        });

    return defer.promise;
};

ArgonOneUp.prototype.isBatteryCharging = function() {
    var self = this;
    var defer = libQ.defer();

    if (!self.batteryFound) {
        defer.resolve(false);
        return defer.promise;
    }

    self.i2cRead(self.batteryAddress, self.BATTERY_REG.CURRENT_HIGH)
        .then(function(value) {
            // Positive current (MSB = 0) means charging
            var charging = (value & 0x80) === 0;
            defer.resolve(charging);
        })
        .fail(function(err) {
            defer.resolve(false);
        });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// Fan Control
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.setFanSpeed = function(speed) {
    var self = this;

    if (!self.fanFound) {
        return libQ.resolve();
    }

    speed = Math.min(100, Math.max(0, speed));
    self.currentFanSpeed = speed;

    return self.i2cWriteByte(self.fanAddress, speed);
};

ArgonOneUp.prototype.signalPowerOff = function() {
    var self = this;

    if (!self.fanFound) {
        return libQ.resolve();
    }

    // Send 0xFF to signal power off to Argon controller
    return self.i2cWriteByte(self.fanAddress, 0xFF);
};

ArgonOneUp.prototype.getCpuTemperature = function() {
    var self = this;
    var defer = libQ.defer();

    fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', function(err, data) {
        if (err) {
            self.logDebug('ArgonOneUp: CPU temp read error: ' + err.message);
            defer.resolve(0);
        } else {
            var temp = parseInt(data.trim(), 10) / 1000;
            defer.resolve(temp);
        }
    });

    return defer.promise;
};

// Read fan speed from Pi 5's cooling_fan interface (RPM)
// Returns fan speed in RPM, or -1 if not available
ArgonOneUp.prototype.getPi5FanSpeed = function() {
    var self = this;
    var defer = libQ.defer();

    // Pi 5 cooling fan exposes fan speed via hwmon under cooling_fan platform device
    var fanPath = '/sys/devices/platform/cooling_fan/hwmon';
    
    fs.readdir(fanPath, function(err, files) {
        if (err || !files || files.length === 0) {
            self.logDebug('ArgonOneUp: Pi5 fan hwmon not found');
            defer.resolve(-1);
            return;
        }
        
        // Find hwmon* directory and read fan1_input
        var hwmonDir = files.find(function(f) { return f.startsWith('hwmon'); });
        if (!hwmonDir) {
            self.logDebug('ArgonOneUp: Pi5 fan hwmon dir not found in: ' + files.join(', '));
            defer.resolve(-1);
            return;
        }
        
        var fanInputPath = fanPath + '/' + hwmonDir + '/fan1_input';
        fs.readFile(fanInputPath, 'utf8', function(readErr, data) {
            if (readErr) {
                self.logDebug('ArgonOneUp: Pi5 fan read error: ' + readErr.message);
                defer.resolve(-1);
            } else {
                var rpm = parseInt(data.trim(), 10);
                defer.resolve(isNaN(rpm) ? -1 : rpm);
            }
        });
    });

    return defer.promise;
};

ArgonOneUp.prototype.calculateFanSpeed = function(temperature) {
    var self = this;

    var fanMode = self.config.get('fan_mode', 'auto');
    
    if (fanMode === 'manual') {
        return self.config.get('fan_manual_speed', 50);
    }

    // Auto mode - use temperature thresholds
    var tempLow = self.config.get('fan_temp_low', 45);
    var speedLow = self.config.get('fan_speed_low', 25);
    var tempMed = self.config.get('fan_temp_med', 55);
    var speedMed = self.config.get('fan_speed_med', 50);
    var tempHigh = self.config.get('fan_temp_high', 65);
    var speedHigh = self.config.get('fan_speed_high', 100);

    if (temperature < tempLow) {
        return 0;
    } else if (temperature < tempMed) {
        return speedLow;
    } else if (temperature < tempHigh) {
        return speedMed;
    } else {
        return speedHigh;
    }
};

// ---------------------------------------------------------------------------
// GPIO Monitoring (Lid and Power Button)
// Using @iiot2k/gpiox for Pi 5 / kernel 6.12 compatibility
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.initLidGpio = function() {
    var self = this;
    
    if (self.lidGpioInitialized) {
        return true;
    }
    
    try {
        // Initialize GPIO 27 as input with pull-up for lid sensor
        // Lid closed = LOW (pulled to ground), Lid open = HIGH (pull-up)
        gpiox.init_gpio(GPIO_LID, gpiox.GPIO_MODE_INPUT_PULLUP, 0);
        self.lidGpioInitialized = true;
        self.logger.info('ArgonOneUp: Lid GPIO ' + GPIO_LID + ' initialized');
        return true;
    } catch (err) {
        self.logger.error('ArgonOneUp: Lid GPIO init failed: ' + err.message);
        self.lidGpioInitialized = false;
        return false;
    }
};

ArgonOneUp.prototype.deinitLidGpio = function() {
    var self = this;
    
    if (self.lidGpioInitialized) {
        try {
            gpiox.deinit_gpio(GPIO_LID);
            self.logger.info('ArgonOneUp: Lid GPIO ' + GPIO_LID + ' released');
        } catch (err) {
            self.logger.error('ArgonOneUp: Lid GPIO release failed: ' + err.message);
        }
        self.lidGpioInitialized = false;
    }
};

ArgonOneUp.prototype.checkLidStatus = function() {
    var self = this;
    
    // Skip if GPIO not initialized
    if (!self.lidGpioInitialized) {
        return;
    }
    
    try {
        var value = gpiox.get_gpio(GPIO_LID);
        var lidNowClosed = (value === 0);  // 0 = closed (pulled low)

        if (lidNowClosed && !self.lidClosed) {
            // Lid just closed
            self.lidClosed = true;
            self.onLidClosed();
        } else if (!lidNowClosed && self.lidClosed) {
            // Lid just opened
            self.lidClosed = false;
            self.onLidOpened();
        }
    } catch (err) {
        self.logDebug('ArgonOneUp: Lid GPIO read error: ' + err.message);
    }
};

ArgonOneUp.prototype.onLidClosed = function() {
    var self = this;
    var lidAction = self.config.get('lid_action', 'nothing');

    self.logDebug('ArgonOneUp: Lid closed, action: ' + lidAction);

    if (lidAction === 'shutdown') {
        var delayMinutes = self.config.get('lid_shutdown_delay', 5);
        var delayMs = delayMinutes * 60 * 1000;

        self.commandRouter.pushToastMessage('warning',
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('NOTIFY_LID_CLOSED') + ' ' + delayMinutes + ' ' + 
            self.getI18nString('MINUTES'));

        self.lidShutdownTimer = setTimeout(function() {
            if (self.lidClosed) {
                self.logger.info('ArgonOneUp: Lid shutdown triggered');
                exec('sudo shutdown -h now');
            }
        }, delayMs);
    }
};

ArgonOneUp.prototype.onLidOpened = function() {
    var self = this;

    self.logDebug('ArgonOneUp: Lid opened');

    if (self.lidShutdownTimer) {
        clearTimeout(self.lidShutdownTimer);
        self.lidShutdownTimer = null;

        self.commandRouter.pushToastMessage('info',
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('NOTIFY_LID_OPENED'));
    }
};

// ---------------------------------------------------------------------------
// Power Button GPIO Monitoring
// GPIO 4 with pulse width detection for actions
// Short pulse (20-500ms) = single click, counted for double-click detection
// Long press (>3s) = long press action
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.initPowerButtonGpio = function() {
    var self = this;
    
    if (self.powerButtonGpioInitialized) {
        return true;
    }
    
    try {
        // Initialize GPIO 4 as input with pull-up for power button
        // Power button pressed = LOW (pulled to ground), released = HIGH (pull-up)
        gpiox.init_gpio(GPIO_POWER, gpiox.GPIO_MODE_INPUT_PULLUP, 0);
        self.powerButtonGpioInitialized = true;
        self.powerButtonLastState = 1; // Start as released
        self.logger.info('ArgonOneUp: Power button GPIO ' + GPIO_POWER + ' initialized');
        return true;
    } catch (err) {
        self.logger.error('ArgonOneUp: Power button GPIO init failed: ' + err.message);
        self.powerButtonGpioInitialized = false;
        return false;
    }
};

ArgonOneUp.prototype.deinitPowerButtonGpio = function() {
    var self = this;
    
    if (self.powerButtonGpioInitialized) {
        try {
            // Clear any pending timer
            if (self.powerButtonPulseTimer) {
                clearTimeout(self.powerButtonPulseTimer);
                self.powerButtonPulseTimer = null;
            }
            gpiox.deinit_gpio(GPIO_POWER);
            self.logger.info('ArgonOneUp: Power button GPIO ' + GPIO_POWER + ' released');
        } catch (err) {
            self.logger.error('ArgonOneUp: Power button GPIO release failed: ' + err.message);
        }
        self.powerButtonGpioInitialized = false;
    }
};

ArgonOneUp.prototype.checkPowerButton = function() {
    var self = this;
    
    if (!self.powerButtonGpioInitialized) {
        return;
    }
    
    try {
        var value = gpiox.get_gpio(GPIO_POWER);
        var buttonPressed = (value === 0);  // 0 = pressed (pulled low)
        var now = Date.now();

        if (buttonPressed && self.powerButtonLastState === 1) {
            // Button just pressed (falling edge)
            self.powerButtonPressTime = now;
            self.powerButtonLastState = 0;
            self.logDebug('ArgonOneUp: Power button pressed');
        } 
        else if (!buttonPressed && self.powerButtonLastState === 0) {
            // Button just released (rising edge)
            var pressDuration = now - self.powerButtonPressTime;
            self.powerButtonLastState = 1;
            self.logDebug('ArgonOneUp: Power button released, duration: ' + pressDuration + 'ms');

            // Determine pulse type
            if (pressDuration >= 20 && pressDuration < 500) {
                // Short pulse - count it for double-click detection
                self.onPowerButtonShortPulse();
            } else if (pressDuration >= 3000) {
                // Long press (>3 seconds)
                self.onPowerButtonLongPress();
            }
            // Ignore very short (<20ms) or medium (500ms-3s) presses
        }
        else if (buttonPressed && self.powerButtonLastState === 0) {
            // Button still held - check for long press
            var holdDuration = now - self.powerButtonPressTime;
            if (holdDuration >= 3000) {
                // Long press detected while still holding
                self.powerButtonLastState = 2; // Mark as long-press handled
                self.onPowerButtonLongPress();
            }
        }
    } catch (err) {
        self.logDebug('ArgonOneUp: Power button GPIO read error: ' + err.message);
    }
};

ArgonOneUp.prototype.onPowerButtonShortPulse = function() {
    var self = this;

    self.powerButtonPulseCount++;
    self.logDebug('ArgonOneUp: Short pulse detected, count: ' + self.powerButtonPulseCount);

    // Clear existing timer
    if (self.powerButtonPulseTimer) {
        clearTimeout(self.powerButtonPulseTimer);
    }

    // Wait for more pulses (500ms window for double-click)
    self.powerButtonPulseTimer = setTimeout(function() {
        var pulses = self.powerButtonPulseCount;
        self.powerButtonPulseCount = 0;
        self.powerButtonPulseTimer = null;

        if (pulses >= 2) {
            self.onPowerButtonDoubleClick();
        }
        // Single click is typically ignored (power button behavior managed by dtoverlay)
    }, 500);
};

ArgonOneUp.prototype.onPowerButtonDoubleClick = function() {
    var self = this;
    var action = self.config.get('power_double_action', 'reboot');

    self.logger.info('ArgonOneUp: Power button double-click, action: ' + action);
    self.executePowerAction(action, 'double-click');
};

ArgonOneUp.prototype.onPowerButtonLongPress = function() {
    var self = this;
    var action = self.config.get('power_long_action', 'shutdown');

    self.logger.info('ArgonOneUp: Power button long press, action: ' + action);
    self.executePowerAction(action, 'long press');
};

ArgonOneUp.prototype.executePowerAction = function(action, trigger) {
    var self = this;

    switch (action) {
        case 'reboot':
            self.commandRouter.pushToastMessage('warning',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('NOTIFY_REBOOT'));
            setTimeout(function() {
                exec('sudo reboot');
            }, 1000);
            break;

        case 'shutdown':
            self.commandRouter.pushToastMessage('warning',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('NOTIFY_SHUTDOWN'));
            setTimeout(function() {
                exec('sudo shutdown -h now');
            }, 1000);
            break;

        case 'nothing':
        default:
            self.logDebug('ArgonOneUp: Power button ' + trigger + ' - no action');
            break;
    }
};

ArgonOneUp.prototype.restartPowerButtonMonitoring = function() {
    var self = this;

    // Reset pulse state when settings change
    self.powerButtonPulseCount = 0;
    if (self.powerButtonPulseTimer) {
        clearTimeout(self.powerButtonPulseTimer);
        self.powerButtonPulseTimer = null;
    }
};

// ---------------------------------------------------------------------------
// Monitoring Loop
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.startMonitoring = function() {
    var self = this;

    // Battery monitoring
    if (self.batteryFound) {
        self.batteryMonitorInterval = setInterval(function() {
            self.monitorBattery();
        }, self.BATTERY_CHECK_MS);
        
        // Initial check
        self.monitorBattery();
    }

    // Fan control (only if fan hardware found at 0x1a)
    if (self.fanFound) {
        self.fanControlInterval = setInterval(function() {
            self.updateFanSpeed();
        }, self.FAN_CHECK_MS);
        
        // Initial update
        self.updateFanSpeed();
    }

    // CPU temperature monitoring (always, for display purposes)
    // The Argon ONE UP may not have I2C fan control, but we still want temp
    self.cpuTempInterval = setInterval(function() {
        self.updateCpuTemperature();
    }, self.FAN_CHECK_MS);
    self.updateCpuTemperature();

    // GPIO monitoring (lid and power button) using gpiox
    if (self.initLidGpio()) {
        self.gpioMonitorInterval = setInterval(function() {
            self.checkLidStatus();
        }, self.GPIO_CHECK_MS);
    }

    // Power button monitoring (GPIO 4)
    if (self.initPowerButtonGpio()) {
        self.powerButtonMonitorInterval = setInterval(function() {
            self.checkPowerButton();
        }, 50); // 50ms for responsive button detection
    }

    // Keyboard: notify toasts + volume requests (Volumio ALSA path, not PipeWire)
    if (self.deviceFound) {
        self.keyboardNotifyInterval = setInterval(function() {
            self.checkKeyboardNotify();
            self.checkKeyboardVolumeRequest();
        }, 500);
    }
};

ArgonOneUp.prototype.stopMonitoring = function() {
    var self = this;

    if (self.batteryMonitorInterval) {
        clearInterval(self.batteryMonitorInterval);
        self.batteryMonitorInterval = null;
    }

    if (self.fanControlInterval) {
        clearInterval(self.fanControlInterval);
        self.fanControlInterval = null;
    }

    if (self.cpuTempInterval) {
        clearInterval(self.cpuTempInterval);
        self.cpuTempInterval = null;
    }

    if (self.gpioMonitorInterval) {
        clearInterval(self.gpioMonitorInterval);
        self.gpioMonitorInterval = null;
    }

    if (self.lidShutdownTimer) {
        clearTimeout(self.lidShutdownTimer);
        self.lidShutdownTimer = null;
    }

    if (self.powerButtonMonitorInterval) {
        clearInterval(self.powerButtonMonitorInterval);
        self.powerButtonMonitorInterval = null;
    }

    if (self.powerButtonPulseTimer) {
        clearTimeout(self.powerButtonPulseTimer);
        self.powerButtonPulseTimer = null;
    }

    if (self.keyboardNotifyInterval) {
        clearInterval(self.keyboardNotifyInterval);
        self.keyboardNotifyInterval = null;
    }

    // Release GPIO resources
    self.deinitLidGpio();
    self.deinitPowerButtonGpio();
};

ArgonOneUp.prototype.checkKeyboardNotify = function() {
    var self = this;
    try {
        if (!fs.existsSync(KEYBOARD_NOTIFY_FILE)) return;
        var line = fs.readFileSync(KEYBOARD_NOTIFY_FILE, 'utf8').trim();
        fs.unlinkSync(KEYBOARD_NOTIFY_FILE);
        if (!line) return;
        var parts = line.split('|');
        var type = (parts[0] && parts[0].trim()) || 'info';
        var title = (parts[1] && parts[1].trim()) || self.getI18nString('PLUGIN_NAME');
        var message = (parts[2] && parts[2].trim()) || line;
        self.commandRouter.pushToastMessage(type, title, message);
    } catch (e) {
        self.logDebug('ArgonOneUp: keyboard notify read failed: ' + e.message);
    }
};

ArgonOneUp.prototype.checkKeyboardVolumeRequest = function() {
    var self = this;
    try {
        if (!fs.existsSync(KEYBOARD_VOLUME_REQUEST_FILE)) return;
        var action = fs.readFileSync(KEYBOARD_VOLUME_REQUEST_FILE, 'utf8').trim().toLowerCase();
        fs.unlinkSync(KEYBOARD_VOLUME_REQUEST_FILE);
        if (!action) return;
        var state = self.commandRouter.volumioGetState();
        var vol = (state && typeof state.volume === 'number') ? state.volume : 50;
        var step = 5;
        if (action === 'up') {
            self.commandRouter.volumiosetvolume(Math.min(100, vol + step));
        } else if (action === 'down') {
            self.commandRouter.volumiosetvolume(Math.max(0, vol - step));
        } else if (action === 'mute') {
            var muted = state && state.mute === true;
            self.commandRouter.volumiosetvolume(muted ? 'unmute' : 'mute');
        }
    } catch (e) {
        self.logDebug('ArgonOneUp: keyboard volume request failed: ' + e.message);
    }
};

ArgonOneUp.prototype.monitorBattery = function() {
    var self = this;

    libQ.all([
        self.getBatteryLevel(),
        self.isBatteryCharging()
    ])
    .then(function(results) {
        var level = results[0];
        var charging = results[1];

        if (level === -1) return;

        var wasCharging = self.batteryCharging;
        self.batteryLevel = level;
        self.batteryCharging = charging;

        // Write battery status for keyboard script (battery key / KEY_PAUSE shows this)
        try {
            var powerLine = level + '% ' + (charging ? self.getI18nString('BATTERY_CHARGING') : self.getI18nString('BATTERY_DISCHARGING'));
            fs.writeFileSync(UPS_LOGFILE, 'power: ' + powerLine + '\n', 'utf8');
        } catch (e) {
            self.logDebug('ArgonOneUp: upslog write failed: ' + e.message);
        }

        // Power state change notifications
        if (charging && !wasCharging) {
            self.commandRouter.pushToastMessage('info',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('NOTIFY_POWER_CONNECTED'));
        } else if (!charging && wasCharging) {
            self.commandRouter.pushToastMessage('warning',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('NOTIFY_POWER_DISCONNECTED'));
        }

        // Low battery warnings (only when on battery)
        if (!charging) {
            var warnLevel = self.config.get('battery_warn_level', 20);
            var criticalLevel = self.config.get('battery_critical_level', 5);
            var criticalAction = self.config.get('battery_critical_action', 'shutdown');
            var now = Date.now();

            if (level <= criticalLevel) {
                self.commandRouter.pushToastMessage('error',
                    self.getI18nString('PLUGIN_NAME'),
                    self.getI18nString('NOTIFY_BATTERY_CRITICAL'));

                if (criticalAction === 'shutdown') {
                    self.logger.info('ArgonOneUp: Critical battery shutdown');
                    exec('sudo shutdown -h +1 "Battery critical"');
                }
            } else if (level <= warnLevel && (now - self.lastBatteryWarning) > 60000) {
                self.commandRouter.pushToastMessage('warning',
                    self.getI18nString('PLUGIN_NAME'),
                    self.getI18nString('NOTIFY_BATTERY_LOW') + ': ' + level + '%');
                self.lastBatteryWarning = now;
            }
        }
    });
};

// Update CPU temperature and fan RPM (for display)
ArgonOneUp.prototype.updateCpuTemperature = function() {
    var self = this;
    self.getCpuTemperature()
        .then(function(temp) {
            self.cpuTemperature = temp;
            // Also read Pi 5 fan RPM if available
            if (self.pi5FanAvailable) {
                return self.getPi5FanSpeed();
            }
            return -1;
        })
        .then(function(rpm) {
            if (rpm >= 0) {
                self.currentFanRpm = rpm;
            }
        });
};

ArgonOneUp.prototype.updateFanSpeed = function() {
    var self = this;

    self.getCpuTemperature()
        .then(function(temp) {
            self.cpuTemperature = temp;
            var targetSpeed = self.calculateFanSpeed(temp);

            if (targetSpeed !== self.currentFanSpeed) {
                self.logDebug('ArgonOneUp: CPU temp ' + temp.toFixed(1) + 
                             'C, fan ' + self.currentFanSpeed + '% -> ' + targetSpeed + '%');
                self.setFanSpeed(targetSpeed);
            }
        });
};

// ---------------------------------------------------------------------------
// UI Configuration
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    var langCode = self.commandRouter.sharedVars.get('language_code');

    // Reload config from disk so UI always shows current /data/configuration/... values
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    if (self.config) {
        self.config.loadFile(configFile);
    }

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + langCode + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // Section 0: Device Status
        if (self.deviceFound) {
            uiconf.sections[0].content[0].value = self.getI18nString('DEVICE_DETECTED');
        } else {
            uiconf.sections[0].content[0].value = self.getI18nString('DEVICE_NOT_DETECTED');
        }

        // Battery level
        if (self.batteryFound) {
            uiconf.sections[0].content[1].value = self.batteryLevel + '%';
            uiconf.sections[0].content[2].value = self.batteryCharging ? 
                self.getI18nString('BATTERY_CHARGING') : 
                self.getI18nString('BATTERY_DISCHARGING');
        } else {
            uiconf.sections[0].content[1].value = 'N/A';
            uiconf.sections[0].content[2].value = 'N/A';
        }

        // CPU temperature
        uiconf.sections[0].content[3].value = self.cpuTemperature.toFixed(1) + ' C';

        // Fan speed - Pi 5 native PWM fan (via cooling_fan dtoverlay)
        if (self.pi5FanAvailable) {
            // Show RPM from Pi 5's cooling_fan interface
            uiconf.sections[0].content[4].value = self.currentFanRpm === 0 ?
                self.getI18nString('FAN_OFF') : self.currentFanRpm + ' RPM';
        } else {
            // cooling_fan dtoverlay not enabled - needs reboot after install
            uiconf.sections[0].content[4].value = self.getI18nString('FAN_NOT_AVAILABLE') || 'Reboot required';
        }

        // Lid status
        uiconf.sections[0].content[5].value = self.lidClosed ?
            self.getI18nString('LID_CLOSED') : self.getI18nString('LID_OPEN');

        // Section 1: Fan Settings (coerce to correct types for UI)
        var fanMode = String(self.config.get('fan_mode') || 'auto');
        uiconf.sections[1].content[0].value = {
            value: fanMode,
            label: fanMode === 'auto' ? 
                self.getI18nString('FAN_MODE_AUTO') : 
                self.getI18nString('FAN_MODE_MANUAL')
        };
        uiconf.sections[1].content[1].value = parseInt(self.config.get('fan_manual_speed'), 10) || 50;
        uiconf.sections[1].content[2].value = parseInt(self.config.get('fan_temp_low'), 10) || 45;
        uiconf.sections[1].content[3].value = parseInt(self.config.get('fan_speed_low'), 10) || 25;
        uiconf.sections[1].content[4].value = parseInt(self.config.get('fan_temp_med'), 10) || 55;
        uiconf.sections[1].content[5].value = parseInt(self.config.get('fan_speed_med'), 10) || 50;
        uiconf.sections[1].content[6].value = parseInt(self.config.get('fan_temp_high'), 10) || 65;
        uiconf.sections[1].content[7].value = parseInt(self.config.get('fan_speed_high'), 10) || 100;

        // Section 2: Lid Settings
        var lidAction = String(self.config.get('lid_action') || 'nothing');
        uiconf.sections[2].content[0].value = {
            value: lidAction,
            label: lidAction === 'nothing' ?
                self.getI18nString('LID_ACTION_NOTHING') :
                self.getI18nString('LID_ACTION_SHUTDOWN')
        };
        uiconf.sections[2].content[1].value = parseInt(self.config.get('lid_shutdown_delay'), 10) || 5;

        // Section 3: Power Settings (safe defaults so dropdowns are never empty)
        var powerDouble = String(self.config.get('power_double_action') || 'reboot');
        var powerLong = String(self.config.get('power_long_action') || 'shutdown');
        uiconf.sections[3].content[0].value = {
            value: powerDouble,
            label: self.getPowerActionLabel(powerDouble)
        };
        uiconf.sections[3].content[1].value = {
            value: powerLong,
            label: self.getPowerActionLabel(powerLong)
        };

        // Section 4: Battery Settings (coerce numbers so UI never shows empty)
        uiconf.sections[4].content[0].value = parseInt(self.config.get('battery_warn_level'), 10) || 20;
        uiconf.sections[4].content[1].value = parseInt(self.config.get('battery_critical_level'), 10) || 5;
        var criticalAction = String(self.config.get('battery_critical_action') || 'shutdown');
        uiconf.sections[4].content[2].value = {
            value: criticalAction,
            label: criticalAction === 'warn' ?
                self.getI18nString('BATTERY_ACTION_WARN') :
                self.getI18nString('BATTERY_ACTION_SHUTDOWN')
        };

        // Section 5: Keyboard Settings
        uiconf.sections[5].content[0].value = self.config.get('keyboard_handle_volume') === true;
        uiconf.sections[5].content[1].value = self.config.get('keyboard_custom_script_enabled') === true;
        uiconf.sections[5].content[2].value = self.config.get('keyboard_custom_script_path') || '';
        uiconf.sections[5].content[3].value = self.config.get('keyboard_custom_script_name') || '';

        // Section 6: EEPROM Settings (resolve only after status is set)
        // Section 7: Advanced Settings
        uiconf.sections[7].content[0].value = false;  // show_advanced default off
        var debugVal = self.config.get('debug_logging');
        uiconf.sections[7].content[1].value = (debugVal === true);  // default false
        uiconf.sections[7].content[2].value = self.i2cBus;
        uiconf.sections[7].content[3].value = '0x' + self.batteryAddress.toString(16);
        uiconf.sections[7].content[4].value = '0x' + self.fanAddress.toString(16);

        self.checkEepromStatus()
            .then(function(status) {
                uiconf.sections[6].content[0].value = status;
                defer.resolve(uiconf);
            });
    })
    .fail(function(err) {
        self.logger.error('ArgonOneUp: getUIConfig failed: ' + err);
        defer.reject(err);
    });

    return defer.promise;
};

ArgonOneUp.prototype.getPowerActionLabel = function(action) {
    var self = this;
    
    switch (action) {
        case 'nothing': return self.getI18nString('POWER_ACTION_NOTHING');
        case 'reboot': return self.getI18nString('POWER_ACTION_REBOOT');
        case 'shutdown': return self.getI18nString('POWER_ACTION_SHUTDOWN');
        default: return action;
    }
};

// ---------------------------------------------------------------------------
// Settings Save Methods
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.saveFanSettings = function(data) {
    var self = this;

    self.config.set('fan_mode', data.fan_mode.value);
    self.config.set('fan_manual_speed', parseInt(data.fan_manual_speed, 10));
    self.config.set('fan_temp_low', parseInt(data.fan_temp_low, 10));
    self.config.set('fan_speed_low', parseInt(data.fan_speed_low, 10));
    self.config.set('fan_temp_med', parseInt(data.fan_temp_med, 10));
    self.config.set('fan_speed_med', parseInt(data.fan_speed_med, 10));
    self.config.set('fan_temp_high', parseInt(data.fan_temp_high, 10));
    self.config.set('fan_speed_high', parseInt(data.fan_speed_high, 10));

    // Force dump to disk (same as volumio-plugins-sources-bookworm plugins)
    self.config.save();

    // Apply immediately
    self.updateFanSpeed();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveLidSettings = function(data) {
    var self = this;

    self.config.set('lid_action', data.lid_action.value);
    self.config.set('lid_shutdown_delay', parseInt(data.lid_shutdown_delay, 10));

    self.config.save();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.savePowerSettings = function(data) {
    var self = this;

    self.config.set('power_double_action', data.power_double_action.value);
    self.config.set('power_long_action', data.power_long_action.value);

    self.config.save();

    // Restart power button monitoring to apply new actions
    self.restartPowerButtonMonitoring();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveBatterySettings = function(data) {
    var self = this;

    self.config.set('battery_warn_level', parseInt(data.battery_warn_level, 10));
    self.config.set('battery_critical_level', parseInt(data.battery_critical_level, 10));
    self.config.set('battery_critical_action', data.battery_critical_action.value);

    self.config.save();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveKeyboardSettings = function(data) {
    var self = this;

    self.config.set('keyboard_handle_volume', data.keyboard_handle_volume === true || data.keyboard_handle_volume === 'true');
    self.config.set('keyboard_custom_script_enabled', data.keyboard_custom_script_enabled === true || data.keyboard_custom_script_enabled === 'true');
    self.config.set('keyboard_custom_script_path', (data.keyboard_custom_script_path || '').trim());
    self.config.set('keyboard_custom_script_name', (data.keyboard_custom_script_name || '').trim());

    self.config.save();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveAdvancedSettings = function(data) {
    var self = this;

    // Handle debug_logging switch - ensure boolean
    var debugEnabled = (data.debug_logging === true);
    self.config.set('debug_logging', debugEnabled);
    self.debugLogging = debugEnabled;

    if (data.show_advanced === true) {
        self.config.set('i2c_bus', parseInt(data.i2c_bus, 10));
        self.config.set('battery_address', data.battery_address);
        self.config.set('fan_address', data.fan_address);
    }

    self.config.save();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.refreshStatus = function() {
    var self = this;

    // Force immediate update
    if (self.batteryFound) {
        self.monitorBattery();
    }
    if (self.fanFound) {
        self.updateFanSpeed();
    }
    self.checkLidStatus();

    self.commandRouter.pushToastMessage('info',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('STATUS_REFRESHED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.resetDefaults = function() {
    var self = this;

    // Reset all config values to defaults
    self.config.set('fan_mode', 'auto');
    self.config.set('fan_manual_speed', 50);
    self.config.set('fan_temp_low', 45);
    self.config.set('fan_speed_low', 25);
    self.config.set('fan_temp_med', 55);
    self.config.set('fan_speed_med', 50);
    self.config.set('fan_temp_high', 65);
    self.config.set('fan_speed_high', 100);
    self.config.set('lid_action', 'nothing');
    self.config.set('lid_shutdown_delay', 5);
    self.config.set('power_double_action', 'reboot');
    self.config.set('power_long_action', 'shutdown');
    self.config.set('battery_warn_level', 20);
    self.config.set('battery_critical_level', 5);
    self.config.set('battery_critical_action', 'shutdown');
    self.config.set('debug_logging', false);
    self.config.set('i2c_bus', 1);
    self.config.set('battery_address', '0x64');
    self.config.set('fan_address', '0x1a');

    self.config.save();
    self.loadConfig();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('DEFAULTS_RESTORED'));

    return libQ.resolve();
};

// ---------------------------------------------------------------------------
// EEPROM Configuration (Pi 5)
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.checkEepromStatus = function() {
    var self = this;
    var defer = libQ.defer();

    // Check if rpi-eeprom-config exists
    fs.access('/usr/bin/rpi-eeprom-config', fs.constants.X_OK, function(err) {
        if (err) {
            defer.resolve(self.getI18nString('EEPROM_NOT_SUPPORTED'));
            return;
        }

        exec('sudo rpi-eeprom-config', function(error, stdout, stderr) {
            if (error) {
                defer.resolve(self.getI18nString('EEPROM_NOT_SUPPORTED'));
                return;
            }

            if (stdout.indexOf('PSU_MAX_CURRENT=5000') !== -1) {
                defer.resolve(self.getI18nString('PSU_CURRENT_OK'));
            } else {
                defer.resolve(self.getI18nString('PSU_CURRENT_LOW'));
            }
        });
    });

    return defer.promise;
};

ArgonOneUp.prototype.applyEepromSettings = function() {
    var self = this;
    var defer = libQ.defer();

    // Check if we're on Pi 5
    fs.readFile('/sys/firmware/devicetree/base/compatible', 'utf8', function(err, data) {
        if (err || data.indexOf('bcm2712') === -1) {
            self.commandRouter.pushToastMessage('warning',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('EEPROM_NOT_SUPPORTED'));
            defer.resolve();
            return;
        }

        // Apply EEPROM settings using a simple approach
        var cmd = 'sudo rpi-eeprom-config --edit';
        
        // For now, just notify that manual configuration is needed
        // Full EEPROM modification requires the script from argon-rpi-eeprom-config-psu.py
        self.commandRouter.pushToastMessage('info',
            self.getI18nString('PLUGIN_NAME'),
            'Run "sudo rpi-eeprom-config --edit" and set PSU_MAX_CURRENT=5000');

        defer.resolve();
    });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// I18n
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.loadI18nStrings = function() {
    var self = this;
    var langCode = self.commandRouter.sharedVars.get('language_code');

    try {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + langCode + '.json');
    } catch (e) {
        self.i18nStrings = {};
    }

    try {
        self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    } catch (e) {
        self.i18nStringsDefaults = {};
    }
};

ArgonOneUp.prototype.getI18nString = function(key) {
    var self = this;

    if (self.i18nStrings && self.i18nStrings[key] !== undefined) {
        return self.i18nStrings[key];
    }
    if (self.i18nStringsDefaults && self.i18nStringsDefaults[key] !== undefined) {
        return self.i18nStringsDefaults[key];
    }
    return key;
};

// ---------------------------------------------------------------------------
// Required Stubs
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

ArgonOneUp.prototype.onRestart = function() {};
ArgonOneUp.prototype.onInstall = function() {};
ArgonOneUp.prototype.onUninstall = function() {};
ArgonOneUp.prototype.getConf = function(varName) { return this.config.get(varName); };
ArgonOneUp.prototype.setConf = function(varName, varValue) { this.config.set(varName, varValue); };
ArgonOneUp.prototype.getAdditionalConf = function() {};
ArgonOneUp.prototype.setAdditionalConf = function() {};
ArgonOneUp.prototype.setUIConfig = function() {};
