'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;

var SERVICE_NAME = 'lcd_backlight.service';
var RUNTIME_CONFIG_DIR = '/etc/lcd_backlight';
// Playback state for the Python service ("1" = playing). Not a setting: changes do not reload the config.
var PLAYING_FILE = RUNTIME_CONFIG_DIR + '/lcd_playing';
var BACKLIGHT_SYSFS_DIR = '/sys/class/backlight';

// Default values and allowed ranges of all user settings (kept in sync with UIConfig.json)
var SETTINGS = {
    int_time:                { def: 1,    min: 0.1,  max: 10,  parse: parseFloat },
    min_backlight:           { def: 12,   min: 0,    max: 255, parse: parseInt },
    max_backlight:           { def: 255,  min: 0,    max: 255, parse: parseInt },
    lux_multiplier:          { def: 0.75, min: 0.01, max: 10,  parse: parseFloat },
    smoothing_factor:        { def: 0.3,  min: 0.05, max: 1,   parse: parseFloat },
    playback_boost:          { def: 0,    min: 0,    max: 255, parse: parseInt },
    playback_boost_duration: { def: 30,   min: 0,    max: 300, parse: parseInt }
};

module.exports = lcdBacklight;

function lcdBacklight(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
    this.backlightPath = null;
    this.running = false;
    this.stateListenerRegistered = false;
    this.lastPlaying = null;
}

lcdBacklight.prototype.onVolumioStart = function () {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    // Add settings missing in configuration files created by older plugin versions
    Object.keys(SETTINGS).forEach(function (key) {
        if (self.config.get(key) === undefined) {
            self.config.set(key, SETTINGS[key].def);
        }
    });

    self.findBacklightPath();

    return libQ.resolve();
};

lcdBacklight.prototype.findBacklightPath = function () {
    var self = this;
    try {
        var devices = fs.readdirSync(BACKLIGHT_SYSFS_DIR);
        if (devices.length > 0) {
            self.backlightPath = BACKLIGHT_SYSFS_DIR + '/' + devices[0];
            self.logger.info('[LCD Backlight] Found backlight at: ' + self.backlightPath);
        } else {
            self.logger.error('[LCD Backlight] No backlight device found');
        }
    } catch (e) {
        self.logger.error('[LCD Backlight] Error finding backlight: ' + e);
    }
};

lcdBacklight.prototype.onStart = function () {
    var self = this;

    self.logger.info('[LCD Backlight] Starting plugin');
    self.loadI18nStrings();
    self.config.set('enabled', true);

    return self.writeRuntimeConfig()
        .then(function () {
            self.running = true;
            self.lastPlaying = null;
            self.registerStateListener();
            self.writeInitialPlaybackState();
            return self.startService();
        })
        .fail(function (error) {
            self.logger.error('[LCD Backlight] Start failed: ' + error);
            self.commandRouter.pushToastMessage('error',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('START_ERROR'));
            throw error;
        });
};

lcdBacklight.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[LCD Backlight] Stopping plugin');
    self.running = false;
    self.config.set('enabled', false);

    // The service is stopped even if the disabled flag cannot be written.
    // On SIGTERM the Python script restores the display to full brightness.
    self.writeRuntimeConfig()
        .fail(function (error) {
            self.logger.warn('[LCD Backlight] Could not write disabled flag: ' + error);
        })
        .then(function () {
            return self.stopService();
        })
        .fail(function (error) {
            self.logger.error('[LCD Backlight] Stop failed: ' + error);
        })
        .then(function () {
            defer.resolve();
        });

    return defer.promise;
};

lcdBacklight.prototype.onRestart = function () {
    // Not needed
};

// Configuration Methods

lcdBacklight.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
        .then(function (uiconf) {
            uiconf.sections[0].content.forEach(function (item) {
                if (SETTINGS[item.id] !== undefined) {
                    item.value = self.config.get(item.id);
                }
            });
            defer.resolve(uiconf);
        })
        .fail(function (error) {
            self.logger.error('[LCD Backlight] Cannot load UI configuration: ' + error);
            defer.reject(new Error());
        });

    return defer.promise;
};

lcdBacklight.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

// Parses a value from the UI and clamps it to the allowed range.
// Returns undefined for values that are not numbers.
lcdBacklight.prototype.parseSetting = function (key, rawValue) {
    var setting = SETTINGS[key];
    var value = setting.parse(rawValue);
    if (isNaN(value)) {
        return undefined;
    }
    return Math.min(setting.max, Math.max(setting.min, value));
};

lcdBacklight.prototype.saveConfig = function (data) {
    var self = this;
    var newValues = {};

    self.logger.info('[LCD Backlight] Saving configuration: ' + JSON.stringify(data));
    self.loadI18nStrings();

    // Validate all values first, nothing is saved if any value is invalid
    var invalid = [];
    Object.keys(SETTINGS).forEach(function (key) {
        if (data[key] === undefined) {
            newValues[key] = self.config.get(key);
            return;
        }
        var value = self.parseSetting(key, data[key]);
        if (value === undefined) {
            invalid.push(key);
        } else {
            newValues[key] = value;
        }
    });

    if (invalid.length > 0) {
        self.logger.error('[LCD Backlight] Invalid values: ' + invalid.join(', '));
        self.commandRouter.pushToastMessage('error',
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('SAVE_ERROR') + ': ' + invalid.join(', '));
        return libQ.reject(new Error('Invalid values: ' + invalid.join(', ')));
    }

    if (newValues.min_backlight > newValues.max_backlight) {
        self.commandRouter.pushToastMessage('error',
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('MIN_MAX_ERROR'));
        return libQ.reject(new Error('min_backlight is greater than max_backlight'));
    }

    Object.keys(newValues).forEach(function (key) {
        self.config.set(key, newValues[key]);
    });

    // The Python service watches /etc/lcd_backlight and reloads changes on the fly,
    // so the service does not have to be restarted. "start" only makes sure it is running.
    return self.writeRuntimeConfig()
        .then(function () {
            return self.startService();
        })
        .then(function () {
            self.commandRouter.pushToastMessage('success',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('SAVE_SUCCESS'));
        })
        .fail(function (error) {
            self.logger.error('[LCD Backlight] Error saving configuration: ' + error);
            self.commandRouter.pushToastMessage('error',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('SAVE_ERROR') + ': ' + error);
            throw error;
        });
};

// Writes all settings as single-value files to /etc/lcd_backlight, read by backlight_control.py
lcdBacklight.prototype.writeRuntimeConfig = function () {
    var self = this;

    try {
        var files = {
            lcd_enabled: self.config.get('enabled') ? '1' : '0'
        };
        Object.keys(SETTINGS).forEach(function (key) {
            var value = self.config.get(key);
            if (value === undefined || value === null || isNaN(value)) {
                value = SETTINGS[key].def;
            }
            files['lcd_' + key] = String(value);
        });

        fs.ensureDirSync(RUNTIME_CONFIG_DIR);
        Object.keys(files).forEach(function (name) {
            fs.writeFileSync(RUNTIME_CONFIG_DIR + '/' + name, files[name] + '\n');
        });

        self.logger.info('[LCD Backlight] Runtime configuration written: ' + JSON.stringify(files));
        return libQ.resolve();
    } catch (e) {
        self.logger.error('[LCD Backlight] Cannot write runtime configuration: ' + e);
        return libQ.reject(e);
    }
};

// Playback state

// Volumio calls the callback on every state change, so the Python service does not
// have to poll the REST API. Volumio has no way to remove the callback, so it is
// registered only once and ignored while the plugin is stopped.
lcdBacklight.prototype.registerStateListener = function () {
    var self = this;
    if (self.stateListenerRegistered) {
        return;
    }
    self.stateListenerRegistered = true;
    self.commandRouter.addCallback('volumioPushState', function (state) {
        if (self.running) {
            self.writePlaybackState(state);
        }
    });
};

lcdBacklight.prototype.writeInitialPlaybackState = function () {
    var self = this;
    try {
        var state = self.commandRouter.volumioGetState();
        if (state && typeof state.then === 'function') {
            state.then(function (s) { self.writePlaybackState(s); });
        } else {
            self.writePlaybackState(state);
        }
    } catch (e) {
        self.logger.warn('[LCD Backlight] Cannot get initial playback state: ' + e);
    }
};

// Writes the file only when playing/not playing changes (no writes on volume, seek, ...)
lcdBacklight.prototype.writePlaybackState = function (state) {
    var self = this;
    var playing = !!(state && state.status === 'play');
    if (playing === self.lastPlaying) {
        return;
    }
    try {
        fs.writeFileSync(PLAYING_FILE, (playing ? '1' : '0') + '\n');
        self.lastPlaying = playing;
    } catch (e) {
        self.logger.error('[LCD Backlight] Cannot write playback state: ' + e);
    }
};

lcdBacklight.prototype.systemctl = function (action) {
    var self = this;
    var defer = libQ.defer();

    exec('/usr/bin/sudo /bin/systemctl ' + action + ' ' + SERVICE_NAME, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
        if (error) {
            var details = (stderr || '').trim();
            self.logger.error('[LCD Backlight] systemctl ' + action + ' failed (exit code ' + error.code + '): ' +
                (details || error.message));
            defer.reject(new Error(details || error.message));
        } else {
            self.logger.info('[LCD Backlight] systemctl ' + action + ' done');
            defer.resolve();
        }
    });

    return defer.promise;
};

lcdBacklight.prototype.startService = function () {
    return this.systemctl('start');
};

lcdBacklight.prototype.stopService = function () {
    return this.systemctl('stop');
};

// i18n

lcdBacklight.prototype.loadI18nStrings = function () {
    var self = this;
    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + '.json');
    } catch (e) {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }
    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

lcdBacklight.prototype.getI18nString = function (key) {
    var self = this;
    if (self.i18nStrings && self.i18nStrings[key] !== undefined) {
        return self.i18nStrings[key];
    }
    return self.i18nStringsDefaults[key];
};
