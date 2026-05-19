'use strict';

/**
 * MPD client wrapper.
 *
 * Talks to MPD over TCP using the `mpd` npm package.  The only operation
 * we need is `find modified-since "<ISO date>"`, which returns every file
 * in MPD's database with a modification time newer than the given date.
 *
 * Connection lifecycle:
 *   - Lazy connect on first query
 *   - Reconnect automatically if the socket drops (e.g. MPD restart)
 *   - Disconnect cleanly on plugin stop
 *
 * No persistent state, no caching — MPD's own tag_cache is fast enough
 * (~10ms for thousands of files) that we just query on every browse
 * request.  This keeps "what the plugin shows" perfectly aligned with
 * "what MPD knows about" by construction.
 *
 * Concurrency note (H3 from v0.3.4 review): we coalesce concurrent
 * connect attempts via _connectPromise, but findModifiedSince itself is
 * not single-flight.  In a single-user UI where browse taps are serial
 * by construction, this is benign.  If we ever face true concurrent
 * callers, wrap findModifiedSince in a per-host single-flight cache.
 */

var mpdLib = null;

function loadMpdLib() {
  if (mpdLib) return mpdLib;
  // Volumio bundles the `mpd` package for its own MPD controller.  Try
  // that first to avoid duplicate copies; fall back to our own bundled
  // dependency if the path doesn't resolve.
  try {
    mpdLib = require('/volumio/node_modules/mpd');
    return mpdLib;
  } catch (_) { }
  try {
    mpdLib = require('mpd');
    return mpdLib;
  } catch (e) {
    throw new Error('mpd module not found: ' + e.message);
  }
}

function MpdClient(options, logger) {
  this.host = options.host || 'localhost';
  this.port = options.port || 6600;
  this.queryTimeoutMs = options.queryTimeoutMs || 10000;
  this.logger = logger;

  this._client = null;
  this._ready = false;
  this._connectPromise = null;
}

/**
 * Safely disconnect a client object, swallowing errors.  Used in cleanup
 * paths where we don't care if the socket was already torn down.
 */
function safeDisconnect(client) {
  if (!client) return;
  try { client.disconnect(); } catch (_) { }
}

/**
 * Establish a connection to MPD if not already connected.
 * Returns a Promise that resolves with the connected client.
 */
MpdClient.prototype._ensureConnected = function () {
  var self = this;

  if (self._ready && self._client) {
    return Promise.resolve(self._client);
  }
  if (self._connectPromise) {
    return self._connectPromise;
  }

  self._connectPromise = new Promise(function (resolve, reject) {
    var mpd;
    try {
      mpd = loadMpdLib();
    } catch (e) {
      self._connectPromise = null;
      return reject(e);
    }

    // Hold the connecting client in a closure-local var.  This matters
    // for the timeout/error paths: if we time out before 'ready' fires,
    // the client may still later emit 'ready' — at which point the
    // handler can detect `settled` and disconnect itself instead of
    // leaking the socket (H2).
    var client = mpd.connect({ host: self.host, port: self.port });
    var settled = false;

    var connectTimeout = setTimeout(function () {
      if (settled) return;
      settled = true;
      self._connectPromise = null;
      safeDisconnect(client);
      reject(new Error('MPD connect timeout (' +
        self.host + ':' + self.port + ')'));
    }, 5000);

    client.on('ready', function () {
      clearTimeout(connectTimeout);
      // H2: if we already settled (timeout or pre-ready error), the
      // outer code has moved on but THIS client is still alive.
      // Disconnect it so we don't accumulate orphan sockets.
      if (settled) {
        safeDisconnect(client);
        return;
      }
      settled = true;
      self._client = client;
      self._ready = true;
      self._connectPromise = null;
      self.logger.info('RecentlyAdded: connected to MPD at ' +
        self.host + ':' + self.port);
      resolve(client);
    });

    client.on('error', function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      if (!settled) {
        clearTimeout(connectTimeout);
        settled = true;
        self._connectPromise = null;
        self._ready = false;
        // H1: disconnect the socket on pre-ready error.  Without this
        // the underlying TCP socket may stay half-open and we'd leak
        // it once a fresh connect attempt creates a replacement.
        safeDisconnect(client);
        reject(err);
      } else {
        // Mid-session error: log, mark not-ready, and let the next
        // findModifiedSince() trigger a reconnect.
        self.logger.warn('RecentlyAdded: MPD error: ' + msg);
        self._ready = false;
      }
    });

    client.on('end', function () {
      // M8: connection-closed is debug-level; happens routinely on
      // network blips and isn't itself a problem.
      if (typeof self.logger.debug === 'function') {
        self.logger.debug('RecentlyAdded: MPD connection closed');
      }
      self._ready = false;
      self._client = null;
    });
  });

  return self._connectPromise;
};

/**
 * Run `find modified-since "<ISO>"` and return parsed entries.
 * Each entry has at minimum a `file` field (MPD-relative path) and
 * a `Last-Modified` field.  Other tag fields are included when MPD
 * has them but we only rely on `file`, `Last-Modified`, `Album`,
 * `Artist`, and `AlbumArtist`.
 */
MpdClient.prototype.findModifiedSince = function (sinceDate) {
  var self = this;

  return self._ensureConnected().then(function (client) {
    return new Promise(function (resolve, reject) {
      var mpd = loadMpdLib();
      var iso = sinceDate.toISOString();
      // Truncate fractional seconds — some MPD versions choke on .000Z
      iso = iso.replace(/\.\d+Z$/, 'Z');

      var cmd = mpd.cmd('find', ['modified-since', iso]);

      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        // Same idea as H1/H2: a query timeout means the connection is
        // suspect.  Force a reconnect on the next call by clearing
        // _ready, and disconnect the socket so we don't leak it.
        self._ready = false;
        if (self._client) {
          safeDisconnect(self._client);
          self._client = null;
        }
        reject(new Error('MPD find query timed out after ' +
          self.queryTimeoutMs + 'ms'));
      }, self.queryTimeoutMs);

      client.sendCommand(cmd, function (err, msg) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          self.logger.error('RecentlyAdded: MPD find failed: ' +
            ((err && err.message) ? err.message : err));
          // Failed command often means stale connection; force
          // reconnect on next call.
          self._ready = false;
          return reject(err);
        }
        try {
          resolve(parseEntries(msg));
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
  });
};

MpdClient.prototype.disconnect = function () {
  this._ready = false;
  safeDisconnect(this._client);
  this._client = null;
};

/**
 * Parse MPD's response to `find` into an array of entries.
 *
 * MPD returns text like:
 *   file: INTERNAL/Music/Album/01.flac
 *   Last-Modified: 2025-12-15T10:23:45Z
 *   Title: Track One
 *   Artist: Some Artist
 *   ...
 *   file: INTERNAL/Music/Album/02.flac
 *   ...
 *
 * Each `file:` line begins a new entry.  We collect key:value pairs
 * until the next file: or end of input.
 */
function parseEntries(rawText) {
  var entries = [];
  var current = null;
  var lines = String(rawText || '').split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;
    var colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    var key = line.substring(0, colonIdx).trim();
    var value = line.substring(colonIdx + 1).trim();

    if (key === 'file') {
      if (current) entries.push(current);
      current = { file: value };
    } else if (current) {
      current[key] = value;
    }
  }
  if (current) entries.push(current);
  return entries;
}

module.exports = MpdClient;
module.exports.parseEntries = parseEntries;  // exported for unit testing
