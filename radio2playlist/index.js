'use strict';

var libQ = require('kew');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var io = require('socket.io-client');
var url = require('url');

module.exports = radio2playlist;

function radio2playlist(context) {
  var self = this;
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self._socket = null;
  self._socketConnected = false;
  self._running = false;

  self._lastAutoUri = '';
  self._lastAutoTarget = '';
}

radio2playlist.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

radio2playlist.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  if (self._running) return libQ.resolve();
  self._running = true;
  self._lastAutoUri = '';
  self._lastAutoTarget = '';
  self.logger.info('[Radio2Playlist] Plugin started');

  try {
    self._socket = io.connect('http://localhost:3000', { reconnection: true, transports: ['websocket', 'polling'] });

    self._socket.on('connect', function () {
      self._socketConnected = true;
      self._socket.emit('getState');
      self.logger.info('[Radio2Playlist] Websocket verbunden');
    });

    self._socket.on('disconnect', function () {
      self._socketConnected = false;
      self.logger.warn('[Radio2Playlist] Websocket getrennt');
    });

    self._socket.on('connect_error', function (err) {
      self._socketConnected = false;
      self.logger.error('[Radio2Playlist] Websocket connect_error: ' + err);
    });

    // Automatik-Modus: State-Events abonnieren
    self._socket.on('pushState', function (state) {
      if (self._running) self._handleAutoModeState(state);
    });

  } catch (e) {
    self._running = false;
    if (self._socket) self._socket.close();
    self._socket = null;
    defer.reject(e);
    return defer.promise;
  }

  defer.resolve();
  return defer.promise;
};

radio2playlist.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  self._running = false;
  self._lastAutoUri = '';
  self._lastAutoTarget = '';
  self.logger.info('[Radio2Playlist] Plugin stopped');

  try {
    if (self._socket) {
      self._socket.close();
      self._socket = null;
      self._socketConnected = false;
    }
  } catch (e) {}

  defer.resolve();
  return defer.promise;
};

radio2playlist.prototype.onRestart = function () {
  var self = this;
  return self.onStop().then(function () { return self.onStart(); });
};

radio2playlist.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;

  var lang_code = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  ).then(function (uiconf) {

    function getSection(id){
      for (var si=0; si<uiconf.sections.length; si++){
        if (uiconf.sections[si] && uiconf.sections[si].id===id) return uiconf.sections[si];
      }
      return null;
    }


    var state = self.commandRouter.volumioGetState();
    var resolved = self._resolveStationFromState(state);

    // section_current
    var secCurrent = getSection('section_current');
    if (secCurrent && secCurrent.content && secCurrent.content[0]) {
      secCurrent.content[0].value = resolved.stationName || '';
      secCurrent.content[0].description = resolved.uri ? ('Stream: ' + resolved.uri) : (resolved.stationName ? '' : self.getI18nString('NO_RADIO'));
    }

    // playlists

    var playlists = self._listPlaylistsSorted();
    
    // Toggle 'no playlists' info section safely (no index shifting)
    if (playlists.length) {
      uiconf.sections = uiconf.sections.filter(function (section) { return section.id !== 'section_no_playlists'; });
    }

    // section_add_existing
    var secAdd = getSection('section_add_existing');
    if (secAdd && secAdd.content && secAdd.content[0]) {
      secAdd.content[0].value = resolved.stationName || '';
    }
    if (secAdd && secAdd.content && secAdd.content[1]) {
      secAdd.content[1].options = playlists;
    }

    var lastUsed = self.config.get('lastUsedPlaylist') || '';
    if (lastUsed && playlists && playlists.length && secAdd && secAdd.content && secAdd.content[1]) {
      var exists = playlists.some(function(p){ return p && p.value === lastUsed; });
      if (exists) {
        secAdd.content[1].value = { value: lastUsed, label: lastUsed };
      } else {
        secAdd.content[1].value = { value: '', label: self.getI18nString('SELECT_PLAYLIST_PLACEHOLDER') };
      }
    }

    // section_create_new
    var secNew = getSection('section_create_new');
    if (secNew && secNew.content && secNew.content[0]) {
      secNew.content[0].value = resolved.stationName || '';
    }

    // settings + favorites sections
    for (var i = 0; i < uiconf.sections.length; i++) {
      if (uiconf.sections[i].id === 'section_settings') {
        var ae = !!self.config.get('autoEnabled');
        var ap = self.config.get('autoPlaylistName') || 'Radio Favoriten';

        uiconf.sections[i].content[0].value = ae;
        uiconf.sections[i].content[1].options = playlists;
        var autoExists = playlists.some(function (p) { return p.value === ap; });
        uiconf.sections[i].content[1].value = { value: autoExists ? ap : '', label: autoExists ? ap : self.getI18nString('SELECT_PLAYLIST_PLACEHOLDER') };
        uiconf.sections[i].content[2].value = autoExists ? '' : ap;
      }
      if (uiconf.sections[i].id === 'section_favorites') {
        var fp = self.config.get('favoritePlaylistName') || 'Radio Favoriten';

        uiconf.sections[i].content[0].options = playlists;
        var favoriteExists = playlists.some(function (p) { return p.value === fp; });
        uiconf.sections[i].content[0].value = { value: favoriteExists ? fp : '', label: favoriteExists ? fp : self.getI18nString('SELECT_PLAYLIST_PLACEHOLDER') };
        uiconf.sections[i].content[1].value = favoriteExists ? '' : fp;
      }
    }

    defer.resolve(uiconf);
  }).fail(function (e) {
    self.logger.error('[Radio2Playlist] UIConfig Fehler: ' + e);
    defer.reject(e);
  });

  return defer.promise;
};

radio2playlist.prototype.setUIConfig = function () { };

radio2playlist.prototype.getConf = function (varName) {
  var self = this;
  return self.config.get(varName);
};

radio2playlist.prototype.setConf = function (varName, varValue) {
  var self = this;
  self.config.set(varName, varValue);
};

radio2playlist.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// ===== Helpers =====

radio2playlist.prototype._ensureSocket = function () {
  var self = this;
  return !!(self._socket && self._socketConnected);
};


radio2playlist.prototype._validatePlaylistName = function (name) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() ||
      name[0] === '.' || /[\\/\x00-\x1f\x7f]/.test(name) || Buffer.byteLength(name, 'utf8') > 200) {
    throw new Error(this.getI18nString('INVALID_PLAYLIST_NAME'));
  }
  return name;
};

radio2playlist.prototype._pickPlaylistName = function (selectObj, customStr, fallback) {
  var selected = typeof selectObj === 'string' ? selectObj :
    (selectObj && typeof selectObj.value === 'string' ? selectObj.value : '');
  var name = typeof customStr === 'string' && customStr.trim() ? customStr.trim() : selected;
  return this._validatePlaylistName(name || fallback || 'Radio Favoriten');
};

radio2playlist.prototype._codecLike = function (s) {
  if (!s) return false;
  return /(\b\d+\s*kbps\b)|(\baac\b)|(\bmp3\b)|(\bflac\b)|(\bogg\b)|(\bopus\b)|(\bvorbis\b)|(\bpcm\b)/i.test(s);
};

radio2playlist.prototype._resolveStationFromState = function (state) {
  var self = this;
  if (!state || state.service !== 'webradio') return { stationName: '', uri: '', albumart: '' };

  var cands = [];
  ['station', 'radio', 'name', 'artist', 'title'].forEach(function (k) {
    if (state[k] && typeof state[k] === 'string') cands.push(state[k].trim());
  });

  // pick first non-codec-like string
  var station = '';
  for (var i = 0; i < cands.length; i++) {
    if (cands[i] && !self._codecLike(cands[i])) { station = cands[i]; break; }
  }
  if (!station) station = cands[0] || '';

  // extra safety: if still codec-like, try other candidates
  if (self._codecLike(station)) {
    for (var j = 0; j < cands.length; j++) {
      if (cands[j] && !self._codecLike(cands[j])) { station = cands[j]; break; }
    }
  }

  return {
    stationName: (station || '').replace(/\r?\n/g, ' ').trim(),
    uri: typeof state.uri === 'string' ? state.uri : '',
    albumart: state.albumart || ''
  };
};

radio2playlist.prototype._resolveAlbumartFallback = function (state) {
  var self = this;
  var albumart = (state && state.albumart) ? state.albumart : '';
  if (albumart) return albumart;

  var uri = (state && state.uri) ? state.uri : '';
  if (!uri) return '';

  // TuneIn/Shoutcast pattern: ...tunein-station.m3u?id=1206978
  var m = uri.match(/[?&]id=(\d+)/i);
  if (m && m[1]) {
    return 'https://cdn-profiles.tunein.com/s' + m[1] + '/images/logoq.png';
  }

  // Favicon fallback
  try {
    var parsed = new url.URL(uri);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin + '/favicon.ico';
    }
  } catch (e) {}

  return '';
};

// Volumio stores native playlists as JSON arrays, usually without a suffix.
// Keep the exact filename; never reinterpret an M3U file or strip a user name.
radio2playlist.prototype._playlistBase = function () {
  var base = '/data/playlist';
  var stat = fs.lstatSync(base);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(base) !== base) {
    throw new Error(this.getI18nString('INVALID_PLAYLIST_FOLDER'));
  }
  return base;
};

radio2playlist.prototype._resolvePlaylistFile = function (name) {
  this._validatePlaylistName(name);
  return path.join(this._playlistBase(), name);
};

radio2playlist.prototype._loadPlaylistJsonArray = function (file) {
  var fd;
  try {
    var stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(this.getI18nString('INVALID_PLAYLIST'));
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(fd).isFile()) throw new Error(this.getI18nString('INVALID_PLAYLIST'));
    var data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!Array.isArray(data)) throw new Error(this.getI18nString('INVALID_PLAYLIST'));
    return data;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

radio2playlist.prototype._listPlaylistsSorted = function () {
  var self = this;
  var base = self._playlistBase();
  var files = fs.readdirSync(base).filter(function (name) {
    try {
      var file = self._resolvePlaylistFile(name);
      self._loadPlaylistJsonArray(file);
      return true;
    } catch (e) { return false; }
  });
  files.sort(function (a, b) { return a.localeCompare(b); });
  var last = self.config.get('lastUsedPlaylist');
  if (files.indexOf(last) !== -1) files = [last].concat(files.filter(function (name) { return name !== last; }));
  return files.map(function (name) { return { value: name, label: name }; });
};

radio2playlist.prototype._savePlaylistJsonArray = function (file, arr, mustExist) {
  var temp = path.join(path.dirname(file), '.radio2playlist-' + crypto.randomBytes(16).toString('hex'));
  var fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o644);
    fs.writeFileSync(fd, JSON.stringify(arr, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (mustExist) {
      // A replacement is atomic; never follow a symlink to write another file.
      var stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(this.getI18nString('INVALID_PLAYLIST'));
      fs.renameSync(temp, file);
    } else {
      // Exclusive publication: do not clobber a playlist created meanwhile.
      fs.linkSync(temp, file);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') this.logger.warn('[Radio2Playlist] Temporary file cleanup failed: ' + e.message); }
  }
};

radio2playlist.prototype._appendRadioEntryWithMetadata = function (name, stationName, uri, albumart, existingOnly, newOnly) {
  var defer = libQ.defer();
  try {
    var file = this._resolvePlaylistFile(name);
    var exists = false;
    try {
      var stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(this.getI18nString('INVALID_PLAYLIST'));
      exists = true;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existingOnly && !exists) throw new Error(this.getI18nString('PLAYLIST_MISSING'));
    if (newOnly && exists) throw new Error(this.getI18nString('PLAYLIST_EXISTS'));
    var arr = exists ? this._loadPlaylistJsonArray(file) : [];
    if (arr.some(function (item) { return item && item.uri === uri; })) {
      defer.resolve({ duplicate: true });
    } else {
      arr.push({ service: 'webradio', type: 'webradio', uri: uri, title: stationName,
        name: stationName, albumart: albumart || '/albumart', artist: '', album: '' });
      this._savePlaylistJsonArray(file, arr, exists);
      defer.resolve({ duplicate: false });
    }
  } catch (e) { defer.reject(e); }
  return defer.promise;
};

radio2playlist.prototype.getI18nString = function (key) {
  var self = this;
  try {
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    var i18n = require(__dirname + '/i18n/strings_' + lang_code + '.json');
    return i18n[key] || require(__dirname + '/i18n/strings_en.json')[key] || key;
  } catch (e) {
    try { return require(__dirname + '/i18n/strings_en.json')[key] || key; } catch (e2) { return key; }
  }
};

// ===== Actions =====

radio2playlist.prototype._reportError = function (error) {
  this.logger.error('[Radio2Playlist] ' + error.message);
  this.commandRouter.pushToastMessage('error', 'Radio2Playlist', this.getI18nString('ERROR') + ': ' + error.message);
};

radio2playlist.prototype.saveSettings = function (data) {
  var defer = libQ.defer();
  try {
    var picked = this._pickPlaylistName(data.auto_mode_playlist_select, data.auto_mode_playlist_custom, this.config.get('autoPlaylistName'));
    this.config.set('autoEnabled', data.auto_mode_enabled === true);
    this.config.set('autoPlaylistName', picked);
    this._lastAutoUri = '';
    this._lastAutoTarget = '';
    this.commandRouter.pushToastMessage('success', 'Radio2Playlist', this.getI18nString('SETTINGS_SAVED'));
    defer.resolve();
  } catch (e) { this._reportError(e); defer.reject(e); }
  return defer.promise;
};

radio2playlist.prototype.saveFavoritesSettings = function (data) {
  var defer = libQ.defer();
  try {
    var picked = this._pickPlaylistName(data.favorite_playlist_select, data.favorite_playlist_custom, this.config.get('favoritePlaylistName'));
    this.config.set('favoritePlaylistName', picked);
    this.commandRouter.pushToastMessage('success', 'Radio2Playlist', this.getI18nString('FAVORITES_SETTINGS_SAVED'));
    defer.resolve();
  } catch (e) { this._reportError(e); defer.reject(e); }
  return defer.promise;
};

radio2playlist.prototype._saveCurrentStation = function (name, editedName, existingOnly, newOnly) {
  var self = this;
  var defer = libQ.defer();
  try {
    self._validatePlaylistName(name);
    var state = self.commandRouter.volumioGetState();
    var resolved = self._resolveStationFromState(state);
    if (!resolved.uri) throw new Error(self.getI18nString('NO_RADIO'));
    var stationName = typeof editedName === 'string' && editedName.trim() ? editedName.trim() : resolved.stationName;
    if (!stationName) throw new Error(self.getI18nString('STATION_NAME_MISSING'));
    self._appendRadioEntryWithMetadata(name, stationName.replace(/[\r\n]/g, ' '), resolved.uri,
      self._resolveAlbumartFallback(state), existingOnly, newOnly).then(function (result) {
        self.config.set('lastUsedPlaylist', name);
        self.commandRouter.pushToastMessage(result.duplicate ? 'info' : 'success', 'Radio2Playlist',
          self.getI18nString(result.duplicate ? 'DUPLICATE_INFO' : 'STATION_SAVED'));
        defer.resolve(result);
      }).fail(function (e) { self._reportError(e); defer.reject(e); });
  } catch (e) { self._reportError(e); defer.reject(e); }
  return defer.promise;
};

radio2playlist.prototype.addToExistingPlaylist = function (data) {
  var selection = data && data.playlist_select;
  return this._saveCurrentStation(typeof selection === 'string' ? selection : selection && selection.value,
    data && data.radio_name, true, false);
};

radio2playlist.prototype.createNewPlaylist = function (data) {
  var name = data && typeof data.new_playlist_name === 'string' ? data.new_playlist_name.trim() : '';
  return this._saveCurrentStation(name, data && data.radio_name_new, false, true);
};

radio2playlist.prototype.addToFavorites = function () {
  return this._saveCurrentStation(this.config.get('favoritePlaylistName') || 'Radio Favoriten', '', false, false);
};

radio2playlist.prototype.refreshCurrentRadio = function () {
  var self = this;
  return self.getUIConfig().then(function (uiconf) {
    self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
    return uiconf;
  }).fail(function (e) { self._reportError(e); throw e; });
};

// The append itself is synchronous and atomic, so plugin actions cannot overlap.
// Other applications editing the same playlist concurrently are outside this lock.
radio2playlist.prototype._handleAutoModeState = function (state) {
  var self = this;
  if (!self.config.get('autoEnabled') || !state || state.service !== 'webradio' || state.status !== 'play') return libQ.resolve();
  var resolved = self._resolveStationFromState(state);
  if (!resolved.uri) return libQ.resolve();
  var target = self.config.get('autoPlaylistName') || 'Radio Favoriten';
  if (resolved.uri === self._lastAutoUri && target === self._lastAutoTarget) return libQ.resolve();
  return self._appendRadioEntryWithMetadata(target, resolved.stationName || 'Webradio', resolved.uri,
    self._resolveAlbumartFallback(state), false, false).then(function () {
      self._lastAutoUri = resolved.uri;
      self._lastAutoTarget = target;
    }).fail(function (e) { self._reportError(e); });
};
