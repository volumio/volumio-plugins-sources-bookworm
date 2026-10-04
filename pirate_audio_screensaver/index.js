'use strict';

var libQ = require('kew');
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var vConf = require('v-conf');
var fontCatalog = require('./python/volumio_screensaver/fonts/catalog.json');

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
    log_level: 'INFO',
    enabled_fonts: fontCatalog.map(function (font) { return font.id; }).join(',')
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
      return self.runCommand('sudo -n /bin/sh ' + self.shellQuote(path.join(__dirname, 'display-bridge.sh')) + ' enable');
    })
    .then(function () {
      return self.runCommand('sudo -n systemctl enable volumio-screensaver.service');
    })
    .then(function () {
      return self.runCommand('sudo -n systemctl restart volumio-screensaver.service');
    })
    .then(function () {
      self.logger.info('Pirate Audio Screensaver started');
      defer.resolve();
    })
    .fail(function (error) {
      self.logger.error('Cannot start Pirate Audio Screensaver: ' + error);
      self.runCommand('sudo -n systemctl stop volumio-screensaver.service || true')
        .then(function () {
          return self.runCommand('sudo -n systemctl disable volumio-screensaver.service || true');
        })
        .then(function () {
          return self.runCommand('sudo -n /bin/sh ' + self.shellQuote(path.join(__dirname, 'display-bridge.sh')) + ' disable');
        })
        .fin(function () { defer.reject(error); });
    });

  return defer.promise;
};

PirateAudioScreensaver.prototype.onStop = function () {
  var defer = libQ.defer();
  var self = this;

  self.runCommand('sudo -n systemctl stop volumio-screensaver.service || true')
    .then(function () {
      return self.runCommand('sudo -n systemctl disable volumio-screensaver.service || true');
    })
    .then(function () {
      return self.runCommand('sudo -n /bin/sh ' + self.shellQuote(path.join(__dirname, 'display-bridge.sh')) + ' disable');
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
      return self.runCommand('sudo -n systemctl restart volumio-screensaver.service');
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
      var fontSection = uiconf.sections.filter(function (section) { return section.id === 'fonts'; })[0];
      var enabledFonts = self.getEnabledFonts();
      fontCatalog.forEach(function (font) {
        var fieldId = 'font_' + font.id;
        fontSection.saveButton.data.push(fieldId);
        fontSection.content.push({
          id: fieldId,
          element: 'switch',
          label: font.label,
          doc: self.fontPreviewHtml(font),
          value: enabledFonts.indexOf(font.id) !== -1
        });
      });
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
  try {
    self.savePersistedSettings();
  } catch (error) {
    self.commandRouter.pushToastMessage('error', 'Pirate Audio Screensaver', self.getTranslation('CANNOT_SAVE_SETTINGS'));
    defer.reject(error);
    return defer.promise;
  }

  self.writeEnvironmentFile()
    .then(function () {
      return self.runCommand('sudo -n systemctl restart volumio-screensaver.service');
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
    'DISPLAY_BRIDGE_SOCKET=/run/volumio-screensaver/pirateaudio.sock',
    '',
    'FONT_SIZE=' + this.asNumber(this.getSetting('font_size'), this.defaults.font_size),
    'FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
    'ENABLED_FONTS=' + this.getEnabledFonts().join(','),
    'SCREEN_PADDING=8',
    'BLANK_TURNS_BACKLIGHT_OFF=' + this.booleanToEnv(this.asBoolean(this.getSetting('blank_turns_backlight_off'), this.defaults.blank_turns_backlight_off)),
    'LOG_LEVEL=' + this.asString(this.getSetting('log_level'), this.defaults.log_level),
    ''
  ].join('\n');

  return this.writeRootFile(path.join(__dirname, 'volumio-screensaver.env'), content);
};

PirateAudioScreensaver.prototype.writeRootFile = function (path, content) {
  var escaped = content.replace(/'/g, "'\\''");
  return this.runCommand("printf '%s' '" + escaped + "' | sudo -n tee " + this.shellQuote(path) + ' >/dev/null');
};

PirateAudioScreensaver.prototype.shellQuote = function (value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
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
    if (Object.prototype.hasOwnProperty.call(persisted, 'enabled_fonts')) {
      self.config.set('enabled_fonts', self.normalizeEnabledFonts(persisted.enabled_fonts).join(','));
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
      display_rotation: self.asNumber(self.config.get('display_rotation'), self.defaults.display_rotation),
      enabled_fonts: self.getEnabledFonts()
    };
    // Rename a complete file so a power loss cannot leave partial JSON settings.
    var temporaryFile = self.persistFile + '.tmp';
    fs.writeFileSync(temporaryFile, JSON.stringify(persisted, null, 2));
    fs.renameSync(temporaryFile, self.persistFile);
  } catch (error) {
    self.logger.error('Cannot persist Pirate Audio Screensaver settings: ' + error);
    throw error;
  }
};

PirateAudioScreensaver.prototype.normalizeEnabledFonts = function (value) {
  if (typeof value === 'string') {
    value = value.split(',').map(function (id) { return id.trim(); });
  }
  if (!Array.isArray(value)) {
    return fontCatalog.map(function (font) { return font.id; });
  }
  var known = fontCatalog.map(function (font) { return font.id; });
  var selected = known.filter(function (id) { return value.indexOf(id) !== -1; });
  // Recover invalid persisted settings with a single readable bundled font.
  return selected.length ? selected : ['ds-digital'];
};

PirateAudioScreensaver.prototype.getEnabledFonts = function () {
  return this.normalizeEnabledFonts(this.getSetting('enabled_fonts'));
};

PirateAudioScreensaver.prototype.getTranslation = function (key) {
  var language = this.commandRouter.sharedVars.get('language_code') || 'en';
  var filename = /^fr(?:[-_]|$)/i.test(language) ? 'strings_fr.json' : 'strings_en.json';
  return require('./i18n/' + filename)[key] || require('./i18n/strings_en.json')[key] || key;
};

PirateAudioScreensaver.prototype.fontPreviewHtml = function (font) {
  var label = font.label.replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
  var preview = fs.readFileSync(path.join(__dirname, 'previews', font.id + '.png')).toString('base64');
  return '<p><strong>' + label + '</strong></p><p><img class="img-responsive" width="280" height="100" alt="' + label +
    ' — 12:34" src="data:image/png;base64,' + preview + '"></p>';
};

PirateAudioScreensaver.prototype.showFontPreviews = function () {
  var rows = [];
  for (var i = 0; i < fontCatalog.length; i += 3) {
    var columns = fontCatalog.slice(i, i + 3).map(function (font) {
      return '<div class="col-xs-24 col-sm-8">' + this.fontPreviewHtml(font) + '</div>';
    }, this);
    rows.push('<div class="row">' + columns.join('') + '</div>');
  }
  this.commandRouter.broadcastMessage('openModal', {
    title: this.getTranslation('FONT_PREVIEWS'),
    message: rows.join(''),
    size: 'lg',
    buttons: [{ name: this.getTranslation('CLOSE'), class: 'btn btn-info', emit: '', payload: '' }]
  });
  return libQ.resolve();
};

PirateAudioScreensaver.prototype.saveFontSettings = function (data) {
  var self = this;
  var previous = self.getEnabledFonts();
  var selected = fontCatalog.filter(function (font) {
    var wasEnabled = previous.indexOf(font.id) !== -1;
    return self.asBoolean(self.getFieldValue(data, 'font_' + font.id, wasEnabled), wasEnabled);
  }).map(function (font) { return font.id; });
  if (!selected.length) {
    var message = self.getTranslation('AT_LEAST_ONE_FONT');
    self.commandRouter.pushToastMessage('error', 'Pirate Audio Screensaver', message);
    return libQ.reject(new Error(message));
  }
  var defer = libQ.defer();
  try {
    self.config.set('enabled_fonts', selected.join(','));
    self.savePersistedSettings();
  } catch (error) {
    self.config.set('enabled_fonts', previous.join(','));
    self.logger.error('Cannot persist font selection: ' + error);
    self.commandRouter.pushToastMessage('error', 'Pirate Audio Screensaver', self.getTranslation('CANNOT_SAVE_SETTINGS'));
    defer.reject(error);
    return defer.promise;
  }
  self.writeEnvironmentFile()
    .then(function () {
      return self.runCommand('sudo -n systemctl restart volumio-screensaver.service');
    })
    .then(function () {
      self.commandRouter.pushToastMessage('success', 'Pirate Audio Screensaver', self.getTranslation('SETTINGS_SAVED'));
      defer.resolve();
    })
    .fail(function (error) {
      self.logger.error('Cannot apply font selection: ' + error);
      self.commandRouter.pushToastMessage('error', 'Pirate Audio Screensaver', self.getTranslation('CANNOT_SAVE_SETTINGS'));
      defer.reject(error);
    });
  return defer.promise;
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
