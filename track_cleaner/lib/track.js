'use strict';

const fs = require('fs');
const path = require('path');

const AUDIO_EXT = new Set([
  '.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wma', '.alac',
  '.aif', '.aiff', '.ape', '.dsf', '.dff', '.wv', '.mpc'
]);

function real(p) {
  const r = path.resolve(p);
  try { return fs.realpathSync(r); } catch (e) { return r; }
}

// Volumio uri ("mnt/HDD/..", "music-library/HDD/..") -> absolute real path
function uriToPath(uri) {
  let u = String(uri || '').replace(/^\/+/, '');
  if (u.indexOf('music-library/') === 0) u = 'mnt/' + u.slice('music-library/'.length);
  return real('/' + u);
}

// MPD uris are relative to /var/lib/mpd/music ("HDD/x.flac"), Volumio ones to "/"
function candidates(uri) {
  const u = String(uri || '').replace(/^\/+/, '');
  if (!u) return [];
  return [uriToPath(u), real('/mnt/' + u), real('/var/lib/mpd/music/' + u)];
}

function matches(uri, target) {
  return candidates(uri).indexOf(target) !== -1;
}

// First existing file among the known URI mappings. MPD may report a track as
// "HDD/..." (relative to /var/lib/mpd/music) while Volumio lists it as
// "music-library/HDD/..."; both must resolve to the same real path.
function resolveFile(uri) {
  const list = candidates(uri);
  for (const p of list) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* try the next form */ }
  }
  return list.length ? list[0] : '';
}

// "/mnt/HDD, /mnt/USB" -> real absolute paths; anything too broad ("/", "/mnt") is dropped
function parseRoots(text) {
  return String(text || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.charAt(0) === '/' && s.length > 1)
    .map(real)
    .filter(r => r.split('/').filter(Boolean).length >= 2);
}

function isAllowed(target, roots) {
  return roots.some(r => target.indexOf(r + '/') === 0); // strictly inside a root, never the root itself
}

function isAudioFile(target) {
  if (!AUDIO_EXT.has(path.extname(target).toLowerCase())) return false;
  try { return fs.statSync(target).isFile(); } catch (e) { return false; }
}

module.exports = { uriToPath, candidates, resolveFile, matches, parseRoots, isAllowed, isAudioFile, AUDIO_EXT };
