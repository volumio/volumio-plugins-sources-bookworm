'use strict';

// =============================================================================
// The offline playlist: what plays while the radio is away.
//
// It is always shuffled, and shuffled here, in the plugin, before anything is
// queued. 1.x queued the playlist in order and switched MPD's random flag on
// a moment later. Two problems with that, both seen on 2026-10-21: the first
// track was always the playlist's first (random only applies to what comes
// next), and on the store the delayed switch never took effect at all — six
// fallbacks, six times the same order. Shuffling the list itself needs no
// timer and leaves the user's own random setting alone.
// =============================================================================

var libQ = (function () {
  try { return require('/volumio/node_modules/kew'); } catch (e) { return require('kew'); }
}());

var LOCAL_LIBRARY_URI = 'music-library/INTERNAL';

// MPD browse-item types that are directories (folders inside INTERNAL are
// 'internal-folder' — see the Volumio mpd plugin's lsInfo).
var FOLDER_TYPES = ['folder', 'internal-folder', 'remdisk', 'album', 'artist'];

/** Fisher-Yates. Returns a new array; `random` is injectable for tests. */
function shuffle(items, random) {
  var rnd = random || Math.random;
  var a = items.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function asPromise(value) {
  return (value && typeof value.then === 'function') ? value : libQ.resolve(value);
}

/** Every playable track below `uri`, browsing folders recursively. */
function collectTracks(commandRouter, uri, logger, tag) {
  var browse;
  try {
    browse = commandRouter.executeOnPlugin('music_service', 'mpd', 'handleBrowseUri', uri);
  } catch (e) {
    logger.error(tag + 'handleBrowseUri threw for ' + uri + ': ' + e);
    return libQ.resolve([]);
  }
  if (!browse || typeof browse.then !== 'function') return libQ.resolve([]);

  return browse.then(function (res) {
    var tracks = [];
    var folders = [];
    if (!res || !res.navigation) return tracks;
    (res.navigation.lists || []).forEach(function (list) {
      (list.items || []).forEach(function (item) {
        if (item.type === 'song' || item.type === 'audio-file') tracks.push(item);
        else if (item.uri && FOLDER_TYPES.indexOf(item.type) !== -1) folders.push(item.uri);
      });
    });
    if (folders.length === 0) return tracks;
    return libQ.all(folders.map(function (f) {
      return collectTracks(commandRouter, f, logger, tag);
    })).then(function (subs) {
      subs.forEach(function (s) { tracks = tracks.concat(s); });
      return tracks;
    });
  });
}

/**
 * Resolves { items, source } — the tracks of the named playlist, or of the
 * whole local library when that playlist does not exist or is empty. Never
 * rejects: an empty list means there is nothing to play.
 */
function loadTracks(commandRouter, name, logger, tag) {
  var names = [];
  try {
    var pm = commandRouter.playListManager;
    if (pm && typeof pm.retrievePlaylists === 'function') names = pm.retrievePlaylists() || [];
  } catch (e) {
    logger.warn(tag + 'Could not list playlists: ' + e);
  }

  function fromLibrary() {
    return collectTracks(commandRouter, LOCAL_LIBRARY_URI, logger, tag).then(function (items) {
      return { items: items || [], source: 'library' };
    });
  }

  if (names.indexOf(name) === -1) {
    logger.warn(tag + 'Playlist "' + name + '" not found — using the local library');
    return fromLibrary();
  }

  var content;
  try {
    content = commandRouter.playListManager.getPlaylistContent(name);
  } catch (e) {
    logger.error(tag + 'getPlaylistContent threw: ' + e);
    return fromLibrary();
  }
  return asPromise(content).then(function (items) {
    if (items && items.length) return { items: items, source: 'playlist' };
    logger.warn(tag + 'Playlist "' + name + '" is empty — using the local library');
    return fromLibrary();
  }, function (err) {
    logger.error(tag + 'Could not read playlist "' + name + '": ' + err);
    return fromLibrary();
  });
}

module.exports = {
  shuffle: shuffle, loadTracks: loadTracks, collectTracks: collectTracks,
  LOCAL_LIBRARY_URI: LOCAL_LIBRARY_URI
};
