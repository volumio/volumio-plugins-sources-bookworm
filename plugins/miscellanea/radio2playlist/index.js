'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var io = require('socket.io-client');
var url = require('url');
var config = require('v-conf');

module.exports = radio2playlist;

function radio2playlist(context) {
  var self = this;
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self._socket = null;
  self._socketConnected = false;

  self._lastAutoUri = '';
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

  self.logger.info('[Radio2Playlist] Plugin gestartet');

  try {
    self._socket = io.connect('http://localhost:3000', { reconnection: true, transports: ['websocket', 'polling'] });

    self._socket.on('connect', function () {
      self._socketConnected = true;
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
      try { self._handleAutoModeState(state); } catch (e) {}
    });

  } catch (e) {
    self.logger.error('[Radio2Playlist] Websocket Init Fehler: ' + e);
  }

  defer.resolve();
  return defer.promise;
};

radio2playlist.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('[Radio2Playlist] Plugin gestoppt');

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

radio2playlist.prototype.onRestart = function () { };

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
      secCurrent.content[0].description = resolved.uri ? ('Stream: ' + resolved.uri) : (resolved.stationName ? '' : 'Kein Radiosender aktiv');
    }

    // playlists

    var playlists = self._listPlaylistsSorted();
    
    // Toggle 'no playlists' info section safely (no index shifting)
    var noPl = getSection('section_no_playlists');
    if (noPl) {
      noPl.hidden = !!(playlists && playlists.length);
    }
if (!playlists || playlists.length === 0) {
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
        secAdd.content[1].value = { value: lastUsed, label: lastUsed.replace(/\.(json|m3u8?|txt)$/i,'') };
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
        uiconf.sections[i].content[1].value = { value: ap, label: ap };
        uiconf.sections[i].content[2].value = '';
      }
      if (uiconf.sections[i].id === 'section_favorites') {
        var fp = self.config.get('favoritePlaylistName') || 'Radio Favoriten';

        uiconf.sections[i].content[0].options = playlists;
        uiconf.sections[i].content[0].value = { value: fp, label: fp };
        uiconf.sections[i].content[1].value = '';
      }
    }

    defer.resolve(uiconf);
  }).fail(function (e) {
    self.logger.error('[Radio2Playlist] UIConfig Fehler: ' + e);
    defer.reject(new Error());
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


radio2playlist.prototype._pickPlaylistName = function(selectObj, customStr, fallback) {
  var name = '';
  try {
    if (customStr && typeof customStr === 'string' && customStr.trim()) name = customStr.trim();
    else if (selectObj && typeof selectObj === 'object') {
      if (selectObj.value) name = (selectObj.value || '').toString().trim();
      else name = (selectObj || '').toString().trim();
    } else if (typeof selectObj === 'string') {
      name = selectObj.trim();
    }
  } catch(e) {}
  if (!name) name = (fallback || '').toString().trim();
  if (!name) name = 'Radio Favoriten';
  name = name.replace(/\.(json|m3u8?|txt)$/i,'');
  return name;
};

radio2playlist.prototype._codecLike = function (s) {
  if (!s) return false;
  return /(\b\d+\s*kbps\b)|(\baac\b)|(\bmp3\b)|(\bflac\b)|(\bogg\b)|(\bopus\b)|(\bvorbis\b)|(\bpcm\b)/i.test(s);
};

radio2playlist.prototype._resolveStationFromState = function (state) {
  var self = this;
  if (!state || state.service !== 'webradio') return { stationName: '', uri: '', albumart: '' };

  var cands = [];
  ['name', 'artist', 'title', 'station', 'radio'].forEach(function (k) {
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
    uri: state.uri || '',
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
    var parsed = url.parse(uri);
    if (parsed && parsed.hostname) {
      return 'http://' + parsed.hostname + '/favicon.ico';
    }
  } catch (e) {}

  return '';
};

radio2playlist.prototype._listPlaylistsSorted = function () {
  var self = this;
  var playlistsPath = '/data/playlist/';
  var files = [];
  try {
    if (fs.existsSync(playlistsPath)) {
      files = fs.readdirSync(playlistsPath).filter(function (f) {
        try { return fs.statSync(playlistsPath + f).isFile(); } catch (e) { return false; }
      });
    }
  } catch (e) { files = []; }

  var label = function (f) { return f.replace(/\.(json|m3u8?|txt)$/i, ''); };

  files.sort(function (a, b) {
    var A = label(a).toLowerCase();
    var B = label(b).toLowerCase();
    if (A < B) return -1;
    if (A > B) return 1;
    return 0;
  });

  var last = self.config.get('lastUsedPlaylist') || '';
  if (last) {
    files = [last].concat(files.filter(function (x) { return x !== last; }));
  }

  return files.map(function (f) {
    return { value: f, label: label(f) };
  });
};

radio2playlist.prototype._resolvePlaylistFile = function (nameOrFile) {
  var base = '/data/playlist/';
  var p = base + nameOrFile;
  if (fs.existsSync(p)) return p;
  var cands = [p + '.json', p + '.m3u', p + '.m3u8', p + '.txt'];
  for (var i = 0; i < cands.length; i++) {
    if (fs.existsSync(cands[i])) return cands[i];
  }
  return p;
};

radio2playlist.prototype._loadPlaylistJsonArray = function (path) {
  try {
    if (!fs.existsSync(path)) return [];
    var content = fs.readFileSync(path, 'utf8');
    if (!content) return [];
    var parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
};

radio2playlist.prototype._savePlaylistJsonArray = function (path, arr) {
  fs.writeFileSync(path, JSON.stringify(arr, null, 2));
};

radio2playlist.prototype._appendRadioEntryWithMetadata = function (playlistNameOrFile, stationName, uri, albumart) {
  var self = this;
  var defer = libQ.defer();

  try {
    var playlistFile = self._resolvePlaylistFile(playlistNameOrFile);

    if (!fs.existsSync(playlistFile)) {
      fs.ensureDirSync('/data/playlist');
      fs.writeFileSync(playlistFile, '[]');
    }

    var arr = self._loadPlaylistJsonArray(playlistFile);

    var exists = arr.some(function (it) { return it && it.uri === uri; });
    if (exists) { defer.resolve({ duplicate: true }); return defer.promise; }

    arr.push({
      service: 'webradio',
      type: 'webradio',
      uri: uri,
      title: stationName,
      name: stationName,
      albumart: albumart || '/albumart',
      artist: '',
      album: ''
    });

    self._savePlaylistJsonArray(playlistFile, arr);
    defer.resolve({ duplicate: false });
  } catch (e) {
    defer.reject(e);
  }

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

radio2playlist.prototype.saveSettings = function (data) {
  var self = this;
  var defer = libQ.defer();
  try {
    var enabled = !!data.auto_mode_enabled;
    var picked = self._pickPlaylistName(data.auto_mode_playlist_select, data.auto_mode_playlist_custom, self.config.get('autoPlaylistName'));

    self.config.set('autoEnabled', enabled);
    self.config.set('autoPlaylistName', picked);

    self.commandRouter.pushToastMessage('success', 'Radio2Playlist', self.getI18nString('SETTINGS_SAVED'));
    defer.resolve();
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Radio2Playlist', 'Fehler: ' + e.message);
    defer.reject(e);
  }
  return defer.promise;
};

radio2playlist.prototype.saveFavoritesSettings = function (data) {
  var self = this;
  var defer = libQ.defer();
  try {
    var picked = self._pickPlaylistName(data.favorite_playlist_select, data.favorite_playlist_custom, self.config.get('favoritePlaylistName'));
    self.config.set('favoritePlaylistName', picked);
    self.commandRouter.pushToastMessage('success', 'Radio2Playlist', self.getI18nString('FAVORITES_SETTINGS_SAVED'));
    defer.resolve();
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Radio2Playlist', 'Fehler: ' + e.message);
    defer.reject(e);
  }
  return defer.promise;
};

radio2playlist.prototype.addToExistingPlaylist = function (data) {
  var self = this;
  var defer = libQ.defer();

  try {
    var playlistFile = data.playlist_select && data.playlist_select.value;
    if (!playlistFile) throw new Error('Playlist fehlt');

    var state = self.commandRouter.volumioGetState();
    var resolved = self._resolveStationFromState(state);
    if (!resolved.uri) throw new Error('Keine Stream-URI gefunden. Bitte Sender abspielen und erneut versuchen.');

    var stationName = resolved.stationName || (data.radio_name || '').trim();
    if (!stationName) throw new Error('Sender-Name fehlt');

    self.config.set('lastUsedPlaylist', playlistFile);

    if (self._ensureSocket()) {
      var nameForCreate = playlistFile.replace(/\.(json|m3u8?|txt)$/i, '');
      self._socket.emit('createPlaylist', { name: nameForCreate });
    }

    var albumart = self._resolveAlbumartFallback(state);

    self._appendRadioEntryWithMetadata(playlistFile, stationName, resolved.uri, albumart).then(function (res) {
      if (res.duplicate) {
        self.commandRouter.pushToastMessage('info', 'Radio2Playlist', self.getI18nString('DUPLICATE_INFO'));
      } else {
        self.commandRouter.pushToastMessage('success', 'Radio2Playlist', '"' + stationName + '" hinzugefügt');
      }
      defer.resolve();
    });

  } catch (error) {
    self.logger.error('[Radio2Playlist] Fehler: ' + error);
    self.commandRouter.pushToastMessage('error', 'Radio2Playlist', 'Fehler: ' + error.message);
    defer.reject(error);
  }

  return defer.promise;
};

radio2playlist.prototype.createNewPlaylist = function (data) {
  var self = this;
  var defer = libQ.defer();

  try {
    var newName = (data.new_playlist_name || '').trim();
    if (!newName) throw new Error('Playlist-Name fehlt');

    var state = self.commandRouter.volumioGetState();
    var resolved = self._resolveStationFromState(state);
    if (!resolved.uri) throw new Error('Keine Stream-URI gefunden. Bitte Sender abspielen und erneut versuchen.');

    var stationName = resolved.stationName || (data.radio_name_new || '').trim();
    if (!stationName) throw new Error('Sender-Name fehlt');

    self.config.set('lastUsedPlaylist', newName);

    if (!self._ensureSocket()) throw new Error('Websocket nicht verbunden. Bitte Volumio neu starten und erneut versuchen.');
    self._socket.emit('createPlaylist', { name: newName });

    var albumart = self._resolveAlbumartFallback(state);

    self._appendRadioEntryWithMetadata(newName, stationName, resolved.uri, albumart).then(function (res) {
      if (res.duplicate) {
        self.commandRouter.pushToastMessage('info', 'Radio2Playlist', self.getI18nString('DUPLICATE_INFO'));
      } else {
        self.commandRouter.pushToastMessage('success', 'Radio2Playlist', 'Playlist erstellt & Sender hinzugefügt');
      }
      defer.resolve();
    });

  } catch (error) {
    self.logger.error('[Radio2Playlist] Fehler: ' + error);
    self.commandRouter.pushToastMessage('error', 'Radio2Playlist', 'Fehler: ' + error.message);
    defer.reject(error);
  }

  return defer.promise;
};

radio2playlist.prototype.addToFavorites = function (data) {
  var self = this;
  var defer = libQ.defer();

  try {
    var favName = (self.config.get('favoritePlaylistName') || 'Radio Favoriten').trim() || 'Radio Favoriten';

    var state = self.commandRouter.volumioGetState();
    var resolved = self._resolveStationFromState(state);
    if (!resolved.uri) throw new Error('Keine Stream-URI gefunden. Bitte Sender abspielen und erneut versuchen.');
    if (!resolved.stationName) throw new Error('Sender-Name fehlt');

    if (self._ensureSocket()) self._socket.emit('createPlaylist', { name: favName });

    var albumart = self._resolveAlbumartFallback(state);

    self._appendRadioEntryWithMetadata(favName, resolved.stationName, resolved.uri, albumart).then(function (res) {
      if (res.duplicate) {
        self.commandRouter.pushToastMessage('info', 'Radio2Playlist', self.getI18nString('DUPLICATE_INFO'));
      } else {
        self.commandRouter.pushToastMessage('success', 'Radio2Playlist', '"' + resolved.stationName + '" als Favorit gespeichert');
      }
      defer.resolve();
    });

  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Radio2Playlist', 'Fehler: ' + e.message);
    defer.reject(e);
  }

  return defer.promise;
};

radio2playlist.prototype.refreshCurrentRadio = function () {
  var self = this;
  var defer = libQ.defer();
  self.commandRouter.pushToastMessage('info', 'Radio2Playlist', 'Aktualisiert');
  defer.resolve();
  return defer.promise;
};

// ===== Auto mode =====

radio2playlist.prototype._handleAutoModeState = function (state) {
  var self = this;

  if (!self.config.get('autoEnabled')) return;
  if (!state || state.service !== 'webradio') return;
  if (state.status !== 'play') return;

  var resolved = self._resolveStationFromState(state);
  if (!resolved.uri) return;

  if (resolved.uri === self._lastAutoUri) return;
  self._lastAutoUri = resolved.uri;

  var target = (self.config.get('autoPlaylistName') || 'Radio Favoriten').trim() || 'Radio Favoriten';

  if (self._ensureSocket()) self._socket.emit('createPlaylist', { name: target });

  var albumart = self._resolveAlbumartFallback(state);
  var stationName = resolved.stationName || 'Webradio';

  self._appendRadioEntryWithMetadata(target, stationName, resolved.uri, albumart);
};
