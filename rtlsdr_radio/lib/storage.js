'use strict';

// Where the plugin keeps what must outlive its own folder.
//
// Volumio removes /data/plugins/<category>/<name> on every update before it moves
// the new version in, so nothing that belongs to the user may live there. The station
// list and the artwork block list are kept beside the plugin's configuration, which an
// update leaves alone. A copy of the last good version of each is kept with the backups,
// which survive an uninstall as well, and is used when a file is missing or unreadable.

var fs = require('fs-extra');
var path = require('path');

var DATA_DIR = '/data/configuration/music_service/rtlsdr_radio';
var LEGACY_DIR = '/data/plugins/music_service/rtlsdr_radio';
var BACKUP_DIR = '/data/rtlsdr_radio_backups';
var LAST_GOOD_DIR = BACKUP_DIR + '/last-good';

// How often, at most, a save refreshes the last good copy. keepLastGood() does it at once.
var LAST_GOOD_INTERVAL = 60 * 1000;

var FILES = {
  stations: 'stations.json',
  blocklist: 'blocklist.json'
};

var lastGoodWritten = {};

function file(kind) {
  return path.join(DATA_DIR, FILES[kind]);
}

function lastGoodFile(kind) {
  return path.join(LAST_GOOD_DIR, FILES[kind]);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Bring a file left in the plugin's own folder by an earlier version to its new place.
// Returns true when a file was moved over.
function migrateLegacy(kind) {
  var target = file(kind);
  var legacy = path.join(LEGACY_DIR, FILES[kind]);
  if (fs.existsSync(target) || !fs.existsSync(legacy)) {
    return false;
  }
  fs.ensureDirSync(DATA_DIR);
  fs.copySync(legacy, target);
  return true;
}

// Read a file. Returns one of
//   { data: <parsed> }
//   { missing: true }
//   { unreadable: true, error: <error>, movedTo: <path or null> }
// An unreadable file is moved aside, so that it is neither read again nor overwritten.
function read(kind) {
  var target = file(kind);
  if (!fs.existsSync(target)) {
    return { missing: true };
  }
  try {
    return { data: fs.readJsonSync(target) };
  } catch (e) {
    var aside = target + '.unreadable-' + stamp();
    try {
      fs.moveSync(target, aside, { overwrite: true });
    } catch (moveError) {
      aside = null;
    }
    return { unreadable: true, error: e, movedTo: aside };
  }
}

// Write a file so that a power cut leaves the old version or the new one, never a part
// of one: the data goes to a temporary file, is flushed to the disk, and is renamed over
// the target. Throws when the data cannot be written.
function write(kind, data) {
  var target = file(kind);
  var tmp = target + '.tmp';
  fs.ensureDirSync(DATA_DIR);
  var fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);

  var now = Date.now();
  if (!lastGoodWritten[kind] || now - lastGoodWritten[kind] >= LAST_GOOD_INTERVAL ||
      !fs.existsSync(lastGoodFile(kind))) {
    keepLastGood(kind);
  }
}

// Copy the current file to the last good copy. Never throws: the copy is a safeguard,
// and failing to make it must not fail the caller.
function keepLastGood(kind) {
  try {
    var target = file(kind);
    if (!fs.existsSync(target)) {
      return false;
    }
    fs.ensureDirSync(LAST_GOOD_DIR);
    var copy = lastGoodFile(kind);
    fs.copySync(target, copy + '.tmp');
    fs.renameSync(copy + '.tmp', copy);
    lastGoodWritten[kind] = Date.now();
    return true;
  } catch (e) {
    return false;
  }
}

// What to fall back on when the file is missing or unreadable: the newest readable one
// among the last good copy and the backups the user made. accept(data) decides whether
// a candidate will do; what it returns is passed on. Returns { data, from, accepted } or null.
function fallback(kind, accept) {
  var candidates = [];
  if (fs.existsSync(lastGoodFile(kind))) {
    candidates.push(lastGoodFile(kind));
  }
  var backups = path.join(BACKUP_DIR, kind);
  try {
    fs.readdirSync(backups).forEach(function(name) {
      if (name.indexOf(kind + '-') === 0 && /\.json$/.test(name)) {
        candidates.push(path.join(backups, name));
      }
    });
  } catch (e) {
    // no backups of this kind
  }

  candidates = candidates.map(function(candidate) {
    try {
      return { path: candidate, mtime: fs.statSync(candidate).mtimeMs };
    } catch (e) {
      return null;
    }
  }).filter(Boolean).sort(function(a, b) {
    return b.mtime - a.mtime;
  });

  for (var i = 0; i < candidates.length; i++) {
    try {
      var data = fs.readJsonSync(candidates[i].path);
      var accepted = accept ? accept(data) : true;
      if (accepted) {
        return { data: data, from: candidates[i].path, accepted: accepted };
      }
    } catch (e) {
      // try the next one
    }
  }
  return null;
}

module.exports = {
  DATA_DIR: DATA_DIR,
  BACKUP_DIR: BACKUP_DIR,
  file: file,
  migrateLegacy: migrateLegacy,
  read: read,
  write: write,
  keepLastGood: keepLastGood,
  fallback: fallback
};
