'use strict';

var libQ = require('kew');
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var vConf = require('v-conf');

module.exports = PirateAudioScreensaver;

function PirateAudioScreensaver(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;
  this.config = new vConf();
  this.persistDir = '/data/configuration/user_interface/pirate_audio_screensaver';
  this.persistFile = path.join(this.persistDir, 'settings.json');
  this.defaults = {
    idle_delay_seconds: 300,
    font_size: 58,
    display_rotation: 90,
    blank_turns_backlight_off: true,
    buttons_enabled: false,
    button_pins: '5,6,16,24',
    log_level: 'INFO'
  };
}

PirateAudioScreensaver.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config.loadFile(configFile);
  this.ensureDefaultSettings();
  this.loadPersistedSettings();
  return libQ.resolve();
};

PirateAudioScreensaver.prototype.onStart = function () {
  var defer = libQ.defer();
  var self = this;

  self.ensureDefaultSettings();
  self.loadPersistedSettings();
  self.writeEnvironmentFile()
    .then(function () {
      return self.runCommand('sudo systemctl daemon-reload');
    })
    .then(function () {
      return self.runCommand('sudo systemctl enable volumio-screensaver.service');
    })
    .then(function () {
      return self.runCommand('sudo systemctl restart volumio-screensaver.service');
    })
    .then(function () {
      self.logger.info('Pirate Audio Screensaver started');
      defer.resolve();
    })
    .fail(function (error) {
      self.logger.error('Cannot start Pirate Audio Screensaver: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

PirateAudioScreensaver.prototype.onStop = function () {
  var defer = libQ.defer();
  var self = this;

  self.runCommand('sudo systemctl stop volumio-screensaver.service || true')
    .then(function () {
      return self.runCommand('sudo systemctl disable volumio-screensaver.service || true');
    })
    .then(function () {
      self.logger.info('Pirate Audio Screensaver stopped');
      defer.resolve();
    })
    .fail(function (error) {
      self.logger.error('Cannot stop Pirate Audio Screensaver cleanly: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

PirateAudioScreensaver.prototype.onRestart = function () {
  var self = this;
  self.ensureDefaultSettings();
  self.loadPersistedSettings();
  return self.writeEnvironmentFile()
    .then(function () {
      return self.runCommand('sudo systemctl restart volumio-screensaver.service');
    });
};

PirateAudioScreensaver.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;
  var langCode = this.commandRouter.sharedVars.get('language_code');

  self.ensureDefaultSettings();
  self.loadPersistedSettings();
  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + langCode + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
    .then(function (uiconf) {
      self.setUIValue(uiconf, 'idle_delay_seconds', self.asNumber(self.getSetting('idle_delay_seconds'), self.defaults.idle_delay_seconds));
      self.setUIValue(uiconf, 'display_rotation', self.asNumber(self.getSetting('display_rotation'), self.defaults.display_rotation));
      defer.resolve(uiconf);
    })
    .fail(function (error) {
      self.logger.error('Cannot load Pirate Audio Screensaver UI config: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

PirateAudioScreensaver.prototype.saveSettings = function (data) {
  var defer = libQ.defer();
  var self = this;

  self.config.set('idle_delay_seconds', self.asNumber(self.getFieldValue(data, 'idle_delay_seconds', self.defaults.idle_delay_seconds), self.defaults.idle_delay_seconds));
  self.config.set('font_size', self.defaults.font_size);
  self.config.set('display_rotation', self.asNumber(self.getFieldValue(data, 'display_rotation', self.defaults.display_rotation), self.defaults.display_rotation));
  self.config.set('blank_turns_backlight_off', self.defaults.blank_turns_backlight_off);
  self.config.set('buttons_enabled', self.defaults.buttons_enabled);
  self.config.set('button_pins', self.defaults.button_pins);
  self.config.set('log_level', self.defaults.log_level);
  self.savePersistedSettings();

  self.writeEnvironmentFile()
    .then(function () {
      return self.runCommand('sudo systemctl restart volumio-screensaver.service || true');
    })
    .then(function () {
      self.commandRouter.pushToastMessage('success', 'Pirate Audio Screensaver', 'Settings saved');
      defer.resolve();
    })
    .fail(function (error) {
      self.logger.error('Cannot save Pirate Audio Screensaver settings: ' + error);
      self.commandRouter.pushToastMessage('error', 'Pirate Audio Screensaver', 'Cannot save settings');
      defer.reject(error);
    });

  return defer.promise;
};

PirateAudioScreensaver.prototype.writeEnvironmentFile = function () {
  this.ensureDefaultSettings();
  this.loadPersistedSettings();
  var content = [
    'VOLUMIO_URL=http://127.0.0.1:3000',
    'POLL_SECONDS=2.0',
    'HTTP_TIMEOUT_SECONDS=1.5',
    'IDLE_DELAY_SECONDS=' + this.asNumber(this.getSetting('idle_delay_seconds'), this.defaults.idle_delay_seconds),
    '',
    'BUTTONS_ENABLED=' + this.booleanToEnv(this.asBoolean(this.getSetting('buttons_enabled'), this.defaults.buttons_enabled)),
    'BUTTON_PINS=' + this.asString(this.getSetting('button_pins'), this.defaults.button_pins),
    'BUTTON_BOUNCE_MS=100',
    '',
    'DISPLAY_WIDTH=240',
    'DISPLAY_HEIGHT=240',
    'DISPLAY_ROTATION=' + this.asNumber(this.getSetting('display_rotation'), this.defaults.display_rotation),
    'DISPLAY_PORT=0',
    'DISPLAY_CS=1',
    'DISPLAY_DC=9',
    'DISPLAY_BACKLIGHT=13',
    'DISPLAY_SPI_SPEED=80000000',
    'DISPLAY_OFFSET_LEFT=0',
    'DISPLAY_OFFSET_TOP=0',
    '',
    'FONT_SIZE=' + this.asNumber(this.getSetting('font_size'), this.defaults.font_size),
    'FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
    'SCREEN_PADDING=8',
    'BLANK_TURNS_BACKLIGHT_OFF=' + this.booleanToEnv(this.asBoolean(this.getSetting('blank_turns_backlight_off'), this.defaults.blank_turns_backlight_off)),
    'LOG_LEVEL=' + this.asString(this.getSetting('log_level'), this.defaults.log_level),
    ''
  ].join('\n');

  return this.writeRootFile(__dirname + '/volumio-screensaver.env', content);
};

PirateAudioScreensaver.prototype.writeRootFile = function (path, content) {
  var escaped = content.replace(/'/g, "'\\''");
  return this.runCommand("printf '%s' '" + escaped + "' | sudo tee " + path + ' >/dev/null');
};

PirateAudioScreensaver.prototype.runCommand = function (command) {
  var defer = libQ.defer();
  var self = this;

  exec(command, { timeout: 120000 }, function (error, stdout, stderr) {
    if (stdout) {
      self.logger.info(stdout.trim());
    }
    if (stderr) {
      self.logger.warn(stderr.trim());
    }
    if (error) {
      defer.reject(stderr || error.message || error);
    } else {
      defer.resolve(stdout);
    }
  });

  return defer.promise;
};

PirateAudioScreensaver.prototype.ensureDefaultSettings = function () {
  for (var key in this.defaults) {
    if (Object.prototype.hasOwnProperty.call(this.defaults, key)) {
      if (this.isUnset(this.config.get(key))) {
        this.config.set(key, this.defaults[key]);
      }
    }
  }
};

PirateAudioScreensaver.prototype.loadPersistedSettings = function () {
  var self = this;
  try {
    if (!fs.existsSync(self.persistFile)) {
      return;
    }
    var persisted = JSON.parse(fs.readFileSync(self.persistFile, 'utf8'));
    if (Object.prototype.hasOwnProperty.call(persisted, 'idle_delay_seconds')) {
      self.config.set('idle_delay_seconds', self.asNumber(persisted.idle_delay_seconds, self.defaults.idle_delay_seconds));
    }
    if (Object.prototype.hasOwnProperty.call(persisted, 'display_rotation')) {
      self.config.set('display_rotation', self.asNumber(persisted.display_rotation, self.defaults.display_rotation));
    }
  } catch (error) {
    self.logger.warn('Cannot load persisted Pirate Audio Screensaver settings: ' + error);
  }
};

PirateAudioScreensaver.prototype.savePersistedSettings = function () {
  var self = this;
  try {
    if (!fs.existsSync(self.persistDir)) {
      fs.mkdirSync(self.persistDir, { recursive: true });
    }
    var persisted = {
      idle_delay_seconds: self.asNumber(self.config.get('idle_delay_seconds'), self.defaults.idle_delay_seconds),
      display_rotation: self.asNumber(self.config.get('display_rotation'), self.defaults.display_rotation)
    };
    fs.writeFileSync(self.persistFile, JSON.stringify(persisted, null, 2));
  } catch (error) {
    self.logger.error('Cannot persist Pirate Audio Screensaver settings: ' + error);
  }
};

PirateAudioScreensaver.prototype.getSetting = function (key) {
  var value = this.config.get(key);
  if (this.isUnset(value)) {
    return this.defaults[key];
  }
  return value;
};

PirateAudioScreensaver.prototype.getFieldValue = function (data, key, defaultValue) {
  if (!data || typeof data[key] === 'undefined') {
    return defaultValue;
  }
  if (data[key] && typeof data[key].value !== 'undefined') {
    return data[key].value;
  }
  return data[key];
};

PirateAudioScreensaver.prototype.isUnset = function (value) {
  return typeof value === 'undefined' || value === null || value === '' || value === 'undefined';
};

PirateAudioScreensaver.prototype.asNumber = function (value, defaultValue) {
  if (this.isUnset(value)) {
    return defaultValue;
  }
  var parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

PirateAudioScreensaver.prototype.asString = function (value, defaultValue) {
  if (this.isUnset(value)) {
    return defaultValue;
  }
  return String(value);
};

PirateAudioScreensaver.prototype.asBoolean = function (value, defaultValue) {
  if (this.isUnset(value)) {
    return defaultValue;
  }
  if (value === true || value === 'true' || value === 'on' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 'off' || value === 0 || value === '0') {
    return false;
  }
  return defaultValue;
};

PirateAudioScreensaver.prototype.booleanToEnv = function (value) {
  return value === true || value === 'true' ? 'true' : 'false';
};

PirateAudioScreensaver.prototype.setUIValue = function (uiconf, id, value) {
  if (!uiconf || !uiconf.sections) {
    return;
  }

  for (var i = 0; i < uiconf.sections.length; i++) {
    var section = uiconf.sections[i];
    if (!section.content) {
      continue;
    }
    for (var j = 0; j < section.content.length; j++) {
      if (section.content[j].id === id) {
        if (section.content[j].element === 'select') {
          section.content[j].value = { value: value, label: String(value) };
        } else {
          section.content[j].value = value;
        }
        return;
      }
    }
  }
};
