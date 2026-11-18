'use strict';

// =============================================================================
// Is MPD playing silence?
//
// When the stream stops arriving but its connection stays open, MPD waits for
// data forever and feeds zeros to the card, logging "Decoder is too slow;
// playing silence to avoid xrun" about every 5 s. Volumio says play, the card
// is RUNNING with hw_ptr moving: lib/soundcard.js sees audio. On 2026-10-30
// (18:12:56–18:37:29) the store heard 24 min of silence that way — the TCP
// connection had received its last byte at 18:12:55 and was still ESTABLISHED
// — while a new connection to the same stream got ~180 kbps. fab-01's mpd.log
// had the same thing for 27 h on 2026-09-28.
//
// Only mpd.log knows. This module reads what MPD appended to it since the
// previous tick. Everything here is a read; nothing is written.
// =============================================================================

var nodeFs = require('fs');

var DEFAULT_PATH = '/var/log/mpd.log';
var SLOW         = 'Decoder is too slow';
// A tick is 5 s; MPD writes a few lines in that time. If more than this was
// appended, only the end is read.
var MAX_READ     = 256 * 1024;

/**
 * A watcher remembers where it stopped reading, so each read() sees only the
 * lines appended since the previous one. The first read() only finds the end,
 * and so does the first one after reset().
 *
 *   read() → { starved: true | false | null, detail: string }
 *     true  — at least one "Decoder is too slow" since the last read
 *     false — none
 *     null  — no evidence: the log is missing or unreadable
 */
function createWatcher(opts) {
  opts = opts || {};
  var fs   = opts.fs || nodeFs;
  var path = opts.path || DEFAULT_PATH;
  var pos  = null; // byte offset read up to; null: not yet located
  var ino  = null;
  var rest = '';   // a line MPD had not finished writing

  function appended() {
    var st = fs.statSync(path);
    if (pos === null) { pos = st.size; ino = st.ino; return ''; }
    // Truncated (copytruncate) or replaced: the new file from its start.
    if (st.ino !== ino || st.size < pos) { pos = 0; ino = st.ino; rest = ''; }
    if (st.size === pos) return '';
    var start = Math.max(pos, st.size - MAX_READ);
    var buf = Buffer.alloc(st.size - start);
    var fd = fs.openSync(path, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    pos = st.size;
    return buf.toString('utf8');
  }

  function read() {
    var text;
    try { text = appended(); }
    catch (e) {
      pos = null; rest = '';
      return { starved: null, detail: path + ' unreadable: ' + (e && e.code || e) };
    }
    var lines = (rest + text).split('\n');
    rest = lines.pop();
    var n = lines.filter(function (l) { return l.indexOf(SLOW) !== -1; }).length;
    if (!n) return { starved: false, detail: 'no "' + SLOW + '"' };
    return { starved: true, detail: n + ' × "' + SLOW + '"' };
  }

  /** Forget the position: the next read() only finds the end again. */
  function reset() { pos = null; ino = null; rest = ''; }

  return { read: read, reset: reset };
}

module.exports = { createWatcher: createWatcher, SLOW: SLOW };
