'use strict';

var fs = require('fs');
var path = require('path');
var libQ = require('kew');
var vConf = require('v-conf');

var PLAYLIST_DIR = '/data/playlist';
var DEFAULT_SUFFIX = ' shuffle';
var TMP_EXT = '.shuffle_tmp';
var LOG_PREFIX = '[shuffle_playlist] ';

module.exports = ControllerShufflePlaylist;

function ControllerShufflePlaylist(context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self.playlistDir = PLAYLIST_DIR;
  self.busy = false;
}

/* ---------- lifecycle ---------- */

ControllerShufflePlaylist.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');

  self.config = new vConf();
  self.config.loadFile(configFile);

  return libQ.resolve();
};

ControllerShufflePlaylist.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  // remove temp files left behind if Volumio was stopped in the middle of a write
  self.cleanupTempFiles().then(function () {
    defer.resolve();
  });

  return defer.promise;
};

ControllerShufflePlaylist.prototype.onStop = function () {
  return libQ.resolve();
};

ControllerShufflePlaylist.prototype.onRestart = function () {
  return libQ.resolve();
};

ControllerShufflePlaylist.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

/* ---------- i18n ---------- */

// commandRouter.getI18nString only knows the core strings, so plugin strings are loaded here
ControllerShufflePlaylist.prototype.loadI18n = function () {
  var self = this;
  var dir = path.join(__dirname, 'i18n');
  var read = function (file) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      return {};
    }
  };
  var lang = 'en';
  try {
    lang = self.commandRouter.sharedVars.get('language_code') || 'en';
  } catch (e) { /* keep en */ }

  if (self.i18nLang === lang && self.i18nDefaults) {
    return;
  }
  self.i18nLang = lang;
  self.i18nDefaults = read('strings_en.json');
  self.i18nStrings = lang === 'en' ? self.i18nDefaults : read('strings_' + lang + '.json');
};

ControllerShufflePlaylist.prototype.tr = function (key) {
  this.loadI18n(); // follows the current UI language
  var v = this.i18nStrings[key];
  if (v === undefined || v === '') {
    v = this.i18nDefaults[key];
  }
  return v !== undefined ? v : key;
};

/* ---------- helpers ---------- */

ControllerShufflePlaylist.prototype.getSuffix = function () {
  var s = this.config ? this.config.get('suffix') : undefined;
  return (typeof s === 'string' && s.length) ? s : DEFAULT_SUFFIX;
};

ControllerShufflePlaylist.prototype.toast = function (type, title, message) {
  this.commandRouter.pushToastMessage(type, title, message);
};

// Resolves with a sorted array of playlist file names. Never rejects.
ControllerShufflePlaylist.prototype.listPlaylists = function () {
  var self = this;

  return libQ.nfcall(fs.readdir, self.playlistDir)
    .then(function (names) {
      var checks = names.filter(function (name) {
        return name.charAt(0) !== '.';
      }).map(function (name) {
        return libQ.nfcall(fs.stat, path.join(self.playlistDir, name))
          .then(function (st) {
            return st.isFile() ? name : null;
          })
          .fail(function () {
            return null;
          });
      });
      return libQ.all(checks);
    })
    .then(function (found) {
      return found.filter(Boolean).sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
    })
    .fail(function (err) {
      self.logger.error(LOG_PREFIX + 'cannot read ' + self.playlistDir + ': ' + err);
      return [];
    });
};

// Resolves with the parsed track array, or null when the file is missing, unreadable or empty.
ControllerShufflePlaylist.prototype.readTracks = function (file) {
  var self = this;

  return libQ.nfcall(fs.readFile, file, 'utf8')
    .then(function (raw) {
      var tracks = JSON.parse(raw);
      return (Array.isArray(tracks) && tracks.length > 0) ? tracks : null;
    })
    .fail(function (err) {
      self.logger.error(LOG_PREFIX + 'read failed for "' + file + '": ' + err);
      return null;
    });
};

// Atomic write: temp file in the same directory, then rename over the target.
ControllerShufflePlaylist.prototype.writeAtomic = function (tmpPath, targetPath, content) {
  return libQ.nfcall(fs.writeFile, tmpPath, content, 'utf8')
    .then(function () {
      return libQ.nfcall(fs.rename, tmpPath, targetPath);
    })
    .fail(function (err) {
      fs.unlink(tmpPath, function () { /* ignore */ });
      throw err;
    });
};

ControllerShufflePlaylist.prototype.cleanupTempFiles = function () {
  var self = this;

  return libQ.nfcall(fs.readdir, self.playlistDir)
    .then(function (names) {
      var removals = names.filter(function (name) {
        return name.charAt(0) === '.' && name.slice(-TMP_EXT.length) === TMP_EXT;
      }).map(function (name) {
        return libQ.nfcall(fs.unlink, path.join(self.playlistDir, name)).fail(function () {});
      });
      return libQ.all(removals);
    })
    .fail(function () { /* playlist dir may not exist yet, nothing to clean */ });
};

// Fisher-Yates
ControllerShufflePlaylist.prototype.shuffleArray = function (arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
};

// the select sends {value,label}, but accept plain strings / wrapper objects too
ControllerShufflePlaylist.prototype.extractName = function (data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data.playlist_select !== undefined) return this.extractName(data.playlist_select);
  if (data.value !== undefined) return this.extractName(data.value);
  if (data.label !== undefined) return String(data.label);
  return '';
};

// no path tricks: the name must be a bare, visible file name inside the playlist dir
ControllerShufflePlaylist.prototype.isValidName = function (name) {
  return typeof name === 'string' &&
    name.length > 0 &&
    name.charAt(0) !== '.' &&
    name.indexOf('\0') === -1 &&
    name === path.basename(name);
};

/* ---------- UI ---------- */

ControllerShufflePlaylist.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();
  var langCode = self.commandRouter.sharedVars.get('language_code');

  libQ.all([
    self.commandRouter.i18nJson(
      path.join(__dirname, 'i18n', 'strings_' + langCode + '.json'),
      path.join(__dirname, 'i18n', 'strings_en.json'),
      path.join(__dirname, 'UIConfig.json')
    ),
    self.listPlaylists()
  ]).then(function (res) {
    var uiconf = res[0];
    var names = res[1];
    var select = uiconf.sections[0].content[0];

    if (names.length) {
      select.options = names.map(function (n) {
        return { value: n, label: n };
      });
      select.value = { value: names[0], label: names[0] };
    } else {
      select.options = [{ value: '', label: self.tr('NO_PLAYLISTS') }];
      select.value = { value: '', label: self.tr('NO_PLAYLISTS') };
    }

    defer.resolve(uiconf);
  }).fail(function (err) {
    self.logger.error(LOG_PREFIX + 'getUIConfig failed: ' + err);
    defer.reject(err instanceof Error ? err : new Error(String(err)));
  });

  return defer.promise;
};

ControllerShufflePlaylist.prototype.setUIConfig = function () {};
ControllerShufflePlaylist.prototype.getConf = function () {};
ControllerShufflePlaylist.prototype.setConf = function () {};

/* ---------- main action ---------- */

// Always resolves: problems are reported to the user with a toast.
ControllerShufflePlaylist.prototype.shufflePlaylist = function (data) {
  var self = this;

  var sourceName = self.extractName(data);
  if (!self.isValidName(sourceName)) {
    self.toast('error', self.tr('ERR_TITLE'), self.tr('ERR_NO_SELECTION'));
    return libQ.resolve();
  }

  if (self.busy) {
    return libQ.resolve();
  }
  self.busy = true;

  var suffix = self.getSuffix();
  // already a shuffled copy -> just re-shuffle it in place
  var isCopy = sourceName.length >= suffix.length && sourceName.slice(-suffix.length) === suffix;
  var targetName = isCopy ? sourceName : sourceName + suffix;

  var sourcePath = path.join(self.playlistDir, sourceName);
  var targetPath = path.join(self.playlistDir, targetName);
  var tmpPath = path.join(self.playlistDir, '.' + targetName + TMP_EXT);

  return self.readTracks(sourcePath).then(function (tracks) {
    if (!tracks) {
      self.toast('error', self.tr('ERR_TITLE'), self.tr('ERR_EMPTY'));
      return;
    }

    var shuffled = self.shuffleArray(tracks);

    return self.writeAtomic(tmpPath, targetPath, JSON.stringify(shuffled)).then(function () {
      var msg = self.tr('DONE_MSG').replace('{0}', targetName).replace('{1}', shuffled.length);
      self.toast('success', self.tr('DONE'), msg);
      self.logger.info(LOG_PREFIX + msg);
      self.refreshUI();
    }, function (err) {
      self.logger.error(LOG_PREFIX + 'write failed for "' + targetName + '": ' + err);
      self.toast('error', self.tr('ERR_TITLE'), self.tr('ERR_WRITE'));
    });
  }).then(function () {
    self.busy = false;
  }, function (err) {
    self.busy = false;
    self.logger.error(LOG_PREFIX + 'unexpected error: ' + err);
  });
};

// refresh the select list so the new playlist shows up without reopening the page
ControllerShufflePlaylist.prototype.refreshUI = function () {
  var self = this;
  try {
    self.commandRouter.getUIConfigOnPlugin('music_service', 'shuffle_playlist', {})
      .then(function (conf) {
        self.commandRouter.broadcastMessage('pushUiConfig', conf);
      })
      .fail(function () { /* non-critical */ });
  } catch (e) { /* non-critical */ }
};
