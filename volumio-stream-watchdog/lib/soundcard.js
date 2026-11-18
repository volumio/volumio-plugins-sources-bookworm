'use strict';

// =============================================================================
// Is the sound card actually playing?
//
// Volumio's player state can say `play` while MPD is stopped underneath. On
// 2026-10-30 a burst of `next` commands left the store that way for 3 h 30:
// Volumio said play, MPD was stopped, every substream of the card was
// `closed`, and the watchdog — which only read Volumio — saw a radio playing.
//
// This module answers from the kernel instead: the ALSA playback substreams
// of the card Volumio outputs to, in /proc/asound/card<N>/pcm<D>p/sub<S>/status.
// Audio is flowing when a substream is RUNNING and its hw_ptr moved since the
// previous reading. Everything here is a read; nothing is written.
//
// When the card cannot be identified or read, the answer is null — "no
// evidence" — and the policy falls back to Volumio's state alone. A loopback
// card (the BTBridge Bluetooth output) is also null: the loopback runs even
// when nothing reaches the speaker, so it proves nothing either way.
// =============================================================================

var nodeFs   = require('fs');
var nodePath = require('path');

var DEFAULT_ROOT = '/proc/asound';

/**
 * One status file. `closed` → { state: 'closed', hwPtr: null };
 * an open substream → { state: 'RUNNING' | 'PREPARED' | 'XRUN' | …, hwPtr }.
 */
function parseStatus(text) {
  var s = String(text || '');
  var state = /^state:\s*(\S+)/m.exec(s);
  var hw    = /^hw_ptr\s*:\s*(\d+)/m.exec(s);
  return {
    state: state ? state[1] : (s.trim() || 'unknown'),
    hwPtr: hw ? Number(hw[1]) : null
  };
}

/** Volumio's `outputdevice` ("1", "1,0") → { card, device } or null. */
function parseOutputDevice(val) {
  if (val !== null && typeof val === 'object' && 'value' in val) val = val.value;
  var m = /^\s*(\d+)\s*(?:,\s*(\d+)\s*)?$/.exec(String(val === undefined || val === null ? '' : val));
  if (!m) return null;
  return { card: Number(m[1]), device: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * The output card from Volumio's audio settings. pluginManager.getPlugin and
 * not executeOnPlugin: the latter writes an info line per call to the journal,
 * and this runs every tick.
 */
function outputDevice(commandRouter) {
  try {
    var pm  = commandRouter && commandRouter.pluginManager;
    var alsa = pm && typeof pm.getPlugin === 'function' && pm.getPlugin('audio_interface', 'alsa_controller');
    if (!alsa || typeof alsa.getConfigParam !== 'function') return null;
    return parseOutputDevice(alsa.getConfigParam('outputdevice'));
  } catch (e) {
    return null;
  }
}

/**
 * A sampler remembers the previous hw_ptr so each read() can tell whether
 * the card moved since the last tick.
 *
 *   read() → { audio: true | false | null, detail: string }
 *     true  — a substream is RUNNING and its hw_ptr moved (or this is the first look)
 *     false — nothing RUNNING (closed, PREPARED, XRUN…) or hw_ptr frozen
 *     null  — no evidence: card unknown, unreadable, or a loopback
 */
function createSampler(opts) {
  opts = opts || {};
  var fs   = opts.fs || nodeFs;
  var root = opts.root || DEFAULT_ROOT;
  var cr   = opts.commandRouter;
  var last = null; // { card, sig } from the previous RUNNING reading

  function readText(p) { return String(fs.readFileSync(p, 'utf8')); }

  function none(detail) { last = null; return { audio: null, detail: detail }; }

  function read() {
    var out = outputDevice(cr);
    if (!out) return none('no output card in Volumio\'s audio settings');

    var cardDir = nodePath.join(root, 'card' + out.card);
    var id;
    try { id = readText(nodePath.join(cardDir, 'id')).trim(); }
    catch (e) { return none('card ' + out.card + ' not found'); }
    var name = 'card ' + out.card + ' ' + id;
    if (/loopback/i.test(id)) return none(name + ' is a loopback — it runs whether or not sound comes out');

    var subs = [];
    try {
      fs.readdirSync(cardDir).forEach(function (pcm) {
        var m = /^pcm(\d+)p$/.exec(pcm);
        if (!m || (out.device !== null && Number(m[1]) !== out.device)) return;
        fs.readdirSync(nodePath.join(cardDir, pcm)).forEach(function (sub) {
          if (!/^sub\d+$/.test(sub)) return;
          var st = parseStatus(readText(nodePath.join(cardDir, pcm, sub, 'status')));
          st.key = pcm + '/' + sub;
          subs.push(st);
        });
      });
    } catch (e) {
      return none(name + ' unreadable: ' + (e && e.code || e));
    }
    if (!subs.length) return none(name + ' has no playback substream');

    var running = subs.filter(function (s) { return s.state === 'RUNNING'; });
    if (!running.length) {
      last = null;
      var states = subs.map(function (s) { return s.state; })
        .filter(function (s, i, a) { return a.indexOf(s) === i; });
      return { audio: false, detail: name + ': ' + states.join('/') };
    }

    // hw_ptr wraps at the ring boundary, so "moved" is "different", not "bigger".
    var sig = running.map(function (s) { return s.key + ':' + s.hwPtr; }).join(' ');
    var frozen = last && last.card === name && last.sig === sig;
    last = { card: name, sig: sig };
    if (frozen) return { audio: false, detail: name + ': hw_ptr frozen' };
    return { audio: true, detail: name + ': RUNNING' };
  }

  return {
    read:  read,
    reset: function () { last = null; }
  };
}

module.exports = {
  createSampler: createSampler,
  parseStatus: parseStatus,
  parseOutputDevice: parseOutputDevice,
  outputDevice: outputDevice
};
