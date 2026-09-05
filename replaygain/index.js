'use strict';

var libQ = require('kew');
var fs = require('fs');
var os = require('os');

var MPD_TEMPLATE = '/volumio/app/plugins/music_service/mpd/mpd.conf.tmpl';
var MPD_CONF = '/etc/mpd.conf';
var BLOCK_MARKER = '### ReplayGain (managed by the replaygain plugin)';
var VALID_MODES = ['off', 'track', 'album', 'auto'];

module.exports = ControllerReplayGain;

function ControllerReplayGain (context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.commandRouter.logger;
  self.configManager = self.context.configManager;

  // registerConfigCallback() has no unregister counterpart: register once only,
  // and keep answering after onStop() with an empty string.
  self.callbackRegistered = false;
  self.active = false;
}

ControllerReplayGain.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);

  return libQ.resolve();
};

ControllerReplayGain.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerReplayGain.prototype.onStart = function () {
  var self = this;

  self.active = true;
  self.registerMpdCallback();

  // A failed MPD restart should not block startup; saving from the settings
  // page retries.
  return self.applyToMpd().fail(function () {
    return libQ.resolve();
  });
};

ControllerReplayGain.prototype.onStop = function () {
  var self = this;

  // The callback stays registered but now contributes nothing.
  self.active = false;

  return self.applyToMpd().fail(function () {
    return libQ.resolve();
  });
};

ControllerReplayGain.prototype.onRestart = function () {
  var self = this;

  self.active = true;

  return self.applyToMpd().fail(function () {
    return libQ.resolve();
  });
};

ControllerReplayGain.prototype.registerMpdCallback = function () {
  var self = this;

  if (self.callbackRegistered) {
    return;
  }

  self.commandRouter.executeOnPlugin('music_service', 'mpd', 'registerConfigCallback', {
    type: 'audio_interface',
    plugin: 'replaygain',
    data: 'getMpdConfig'
  });
  self.callbackRegistered = true;
};

/**
 * Called by createMPDFile(), which concatenates the return value straight into
 * mpd.conf. Must always return a string: anything else lands in the file as
 * "undefined" and MPD then refuses to start.
 */
ControllerReplayGain.prototype.getMpdConfig = function () {
  var self = this;

  try {
    if (!self.active) {
      return '';
    }

    if (self.templateSetsReplayGain()) {
      self.logger.error('replaygain: ' + MPD_TEMPLATE + ' already sets replaygain itself. ' +
        'Contributing nothing, as a duplicate setting would stop MPD from starting.');
      return '';
    }

    return self.buildMpdConfig();
  } catch (e) {
    self.logger.error('replaygain: could not build mpd.conf settings: ' + e);
    return '';
  }
};

ControllerReplayGain.prototype.buildMpdConfig = function () {
  var self = this;
  var mode = self.getMode();

  if (mode === 'off') {
    return '';
  }

  return os.EOL + BLOCK_MARKER + os.EOL +
    'replaygain\t\t\t"' + mode + '"' + os.EOL +
    'replaygain_preamp\t\t"' + self.getPreamp() + '"' + os.EOL +
    // Untagged tracks are left alone rather than boosted from an unnormalized level.
    'replaygain_missing_preamp\t"0"' + os.EOL +
    // Uses the peak tags to keep a positive preamp from clipping.
    'replaygain_limit\t\t"yes"' + os.EOL;
};

/**
 * A hand-edited template may set replaygain itself. Contributing on top of that
 * would define the setting twice, which MPD rejects.
 */
ControllerReplayGain.prototype.templateSetsReplayGain = function () {
  var self = this;

  try {
    var template = fs.readFileSync(MPD_TEMPLATE, 'utf8');

    return template.split(/\r?\n/).some(function (line) {
      return /^\s*replaygain\s/.test(line);
    });
  } catch (e) {
    self.logger.error('replaygain: could not read ' + MPD_TEMPLATE + ': ' + e);
    return false;
  }
};

ControllerReplayGain.prototype.getMode = function () {
  var self = this;
  var mode = self.config.get('mode', 'off');

  if (VALID_MODES.indexOf(mode) === -1) {
    self.logger.error('replaygain: invalid mode "' + mode + '", falling back to off');
    return 'off';
  }

  return mode;
};

ControllerReplayGain.prototype.getPreamp = function () {
  var self = this;
  var preamp = parseInt(self.config.get('preamp', 0), 10);

  if (isNaN(preamp) || preamp < -15 || preamp > 15) {
    self.logger.error('replaygain: invalid preamp "' + self.config.get('preamp') + '", falling back to 0');
    return 0;
  }

  return preamp;
};

/**
 * Skips the work when mpd.conf already matches, so an unchanged config does not
 * cost an MPD restart on every boot.
 */
ControllerReplayGain.prototype.applyToMpd = function () {
  var self = this;
  var defer = libQ.defer();

  if (self.isAlreadyApplied()) {
    self.logger.info('replaygain: mpd.conf is already up to date, not restarting MPD');
    defer.resolve();
    return defer.promise;
  }

  self.commandRouter.executeOnPlugin('music_service', 'mpd', 'createMPDFile', function (error) {
    if (error) {
      self.logger.error('replaygain: could not create mpd.conf: ' + error);
      defer.reject(error);
      return;
    }

    // createMPDFile() calls back before its own async writeFile() has landed,
    // so restarting straight away can race with it and pick up the old file.
    self.waitForConfig(function () {
      self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', function (error) {
        if (error) {
          self.logger.error('replaygain: could not restart MPD: ' + error);
          defer.reject(error);
        } else {
          self.logger.info('replaygain: applied "' + self.getMode() + '" mode, preamp ' + self.getPreamp() + ' dB');
          defer.resolve();
        }
      });
    });
  });

  return defer.promise;
};

ControllerReplayGain.prototype.isAlreadyApplied = function () {
  var self = this;
  var desired = self.getMpdConfig();

  try {
    var current = fs.readFileSync(MPD_CONF, 'utf8');

    if (desired === '') {
      // Substring-matching an empty string always succeeds, which would leave
      // stale settings behind when ReplayGain is switched off.
      return current.indexOf(BLOCK_MARKER) === -1;
    }

    return current.indexOf(desired) !== -1;
  } catch (e) {
    return false;
  }
};

ControllerReplayGain.prototype.waitForConfig = function (callback) {
  var self = this;
  var attempts = 0;

  var poll = function () {
    if (self.isAlreadyApplied() || attempts >= 30) {
      if (attempts >= 30) {
        self.logger.error('replaygain: timed out waiting for mpd.conf to be written, restarting MPD anyway');
      }
      callback();
      return;
    }

    attempts++;
    setTimeout(poll, 100);
  };

  poll();
};

ControllerReplayGain.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();
  var langCode = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + langCode + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      var mode = self.getMode();
      var preamp = self.getPreamp();

      uiconf.sections[0].content[0].value.value = mode;
      uiconf.sections[0].content[0].value.label = self.getLabelForSelect(uiconf.sections[0].content[0].options, mode);
      uiconf.sections[0].content[1].value.value = preamp;
      uiconf.sections[0].content[1].value.label = self.getLabelForSelect(uiconf.sections[0].content[1].options, preamp);

      defer.resolve(uiconf);
    })
    .fail(function (error) {
      self.logger.error('replaygain: could not build the settings page: ' + error);
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerReplayGain.prototype.getLabelForSelect = function (options, key) {
  for (var i = 0; i < options.length; i++) {
    if (options[i].value == key) {
      return options[i].label;
    }
  }

  return String(key);
};

ControllerReplayGain.prototype.saveSettings = function (data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('mode', data['mode'].value);
  self.config.set('preamp', data['preamp'].value);

  self.applyToMpd()
    .then(function () {
      self.commandRouter.pushToastMessage('success',
        self.commandRouter.getI18nString('COMMON.CONFIGURATION_UPDATE'),
        self.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
      defer.resolve({});
    })
    .fail(function () {
      self.commandRouter.pushToastMessage('error',
        self.commandRouter.getI18nString('COMMON.CONFIGURATION_UPDATE'),
        self.commandRouter.getI18nString('COMMON.SETTINGS_SAVE_ERROR'));
      defer.resolve({});
    });

  return defer.promise;
};

ControllerReplayGain.prototype.getConfigParam = function (key) {
  return this.config.get(key);
};

ControllerReplayGain.prototype.setConfigParam = function (data) {
  this.config.set(data.key, data.value);
};
