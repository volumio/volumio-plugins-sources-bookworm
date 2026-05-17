'use strict';

// =============================================================================
// Stream Watchdog — Volumio 4 system_controller plugin
//
// Phase 1: Internal socket.io state watcher.
//   - Connects to Volumio's socket.io interface at localhost:3000
//   - Listens to `pushState` and runs the IDLE / WATCHING / SUSPECT transitions
//   - No probing and no fallback playback yet (Phases 2–5)
//
// See docs/development-plan.md for the full design.
// =============================================================================

// kew and v-conf are core Volumio modules. Reference them from Volumio's own
// node_modules so a plain `git clone` works without `npm install` — same
// rationale as socket.io-client (see CLAUDE.md). Fall back to a locally
// installed copy if the absolute path is unavailable.
function volumioRequire(name) {
  try {
    return require('/volumio/node_modules/' + name);
  } catch (e) {
    return require(name);
  }
}

var libQ  = volumioRequire('kew');
var vconf = volumioRequire('v-conf');

module.exports = StreamWatchdog;

// --- Constants ---------------------------------------------------------------

var LOG = '[StreamWatchdog] ';

// MPD and the network take time to settle after boot. Do nothing until this
// delay has elapsed after onStart — see CLAUDE.md (STARTUP_DELAY).
var STARTUP_DELAY_MS = 30 * 1000;

// Volumio's internal socket.io endpoint.
var SOCKET_URL = 'http://localhost:3000';

// Layer 2 — HTTP stream probe (see docs/development-plan.md §3.3).
var PROBE_TIMEOUT_MS    = 5000; // per-probe HTTP timeout
var MIN_STREAM_INTERVAL = 15;   // floor for streamCheckInterval, seconds

// Phase 3 — confirmation thresholds (see docs/development-plan.md §3.2).
var FAIL_THRESHOLD      = 2;    // probe failures required to confirm a failure
var USER_STOP_WINDOW_MS = 2000; // a stop within this window of volumioStop() is the user's

// Phase 4 — fallback playback (see docs/development-plan.md §4).
var FALLBACK_STEP_MS  = 500;                   // gap between fire-and-forget playback commands
var LOCAL_LIBRARY_URI = 'music-library/INTERNAL'; // browsed when no Offline playlist exists

// MPD browse-item types that represent a browseable directory (see the
// Volumio mpd plugin's lsInfo — folders inside INTERNAL are 'internal-folder').
var FOLDER_TYPES = ['folder', 'internal-folder', 'remdisk', 'album', 'artist'];

// Phase 5 — auto-restore (see docs/development-plan.md §5).
var RESTORE_CONFIRM_MS   = 5000; // gap before the confirming restore probe
var MIN_RESTORE_INTERVAL = 30;   // floor for restoreCheckInterval, seconds

// State machine — see docs/development-plan.md §2.2
var STATE = {
  IDLE:     'IDLE',     // no stream active, plugin dormant
  WATCHING: 'WATCHING', // stream playing, monitored
  SUSPECT:  'SUSPECT',  // one failure signal received, awaiting confirmation
  FALLBACK: 'FALLBACK'  // confirmed failure (Phase 4+)
};

// =============================================================================
// Constructor
// =============================================================================
function StreamWatchdog(context) {
  var self = this;

  self.context       = context;
  self.commandRouter = context.coreCommand;
  self.logger        = context.logger;
  self.configManager = context.configManager;

  // Runtime state
  self.state          = STATE.IDLE;
  self.streamUri      = null;  // URI of the stream currently being watched
  self.socket         = null;  // socket.io connection to Volumio
  self.startupTimer   = null;  // STARTUP_DELAY timer handle
  self.ready          = false; // false until STARTUP_DELAY has elapsed
  self.probeTimer     = null;  // Layer 2 probe interval handle
  self.probeFailCount = 0;     // consecutive probe failures
  self.lastStateSig   = null;  // dedup signature for verbose pushState logging
  self.userStopFlag   = false; // true briefly after the user invokes volumioStop
  self.userStopTimer  = null;  // clears userStopFlag after USER_STOP_WINDOW_MS
  self._origVolumioStop = null; // saved original commandRouter.volumioStop
  self.fallbackActive = false; // true once fallback playback has been triggered
  self.savedState     = null;  // snapshot of the lost stream (for auto-restore)
  self.restoreTimer        = null; // restore-probe interval handle
  self.restoreConfirmTimer = null; // one-shot confirming-probe handle
  self._resolveCache       = {};   // original URI -> resolved stream URI
}

// =============================================================================
// Lifecycle
// =============================================================================

StreamWatchdog.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context, 'config.json'
  );
  self.config = new vconf();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

StreamWatchdog.prototype.onStart = function () {
  var self  = this;
  var defer = libQ.defer();

  self.logger.info(LOG + 'Plugin starting');
  self.state         = STATE.IDLE;
  self.streamUri     = null;
  self.ready         = false;
  self._resolveCache = {};

  // Hold off on all logic until MPD and the network have settled.
  self.startupTimer = setTimeout(function () {
    self.startupTimer = null;
    self.ready = true;
    self.logger.info(LOG + 'Startup delay elapsed — state watcher active');
    self._connectSocket();
    self._installStopHook();
  }, STARTUP_DELAY_MS);

  self.logger.info(LOG + 'Waiting ' + (STARTUP_DELAY_MS / 1000) +
    's before activating the state watcher');

  defer.resolve();
  return defer.promise;
};

StreamWatchdog.prototype.onStop = function () {
  var self  = this;
  var defer = libQ.defer();

  self.logger.info(LOG + 'Plugin stopping');

  if (self.startupTimer) {
    clearTimeout(self.startupTimer);
    self.startupTimer = null;
  }
  if (self.userStopTimer) {
    clearTimeout(self.userStopTimer);
    self.userStopTimer = null;
  }
  self._stopProbeTimer();
  self._stopRestoreTimer();
  self._removeStopHook();
  self._disconnectSocket();

  self.ready          = false;
  self.state          = STATE.IDLE;
  self.streamUri      = null;
  self.userStopFlag   = false;
  self.fallbackActive = false;
  self.savedState     = null;
  self._resolveCache  = {};

  defer.resolve();
  return defer.promise;
};

StreamWatchdog.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// =============================================================================
// Layer 1 — State Watcher (socket.io)
// =============================================================================

StreamWatchdog.prototype._connectSocket = function () {
  var self = this;

  if (self.socket) return; // already connected

  var io;
  try {
    // Reference Volumio's own socket.io-client — never bundle our own copy.
    io = require('/volumio/node_modules/socket.io-client');
  } catch (e) {
    self.logger.error(LOG + 'Could not load socket.io-client: ' + e);
    return;
  }

  try {
    self.socket = io(SOCKET_URL);
  } catch (e) {
    self.logger.error(LOG + 'Could not connect to ' + SOCKET_URL + ': ' + e);
    self.socket = null;
    return;
  }

  self.socket.on('connect', function () {
    self.logger.info(LOG + 'Connected to Volumio socket.io at ' + SOCKET_URL);
    // Ask Volumio to push the current state so we sync immediately.
    self.socket.emit('getState', '');
  });

  self.socket.on('disconnect', function () {
    self.logger.warn(LOG + 'Disconnected from Volumio socket.io');
  });

  self.socket.on('pushState', function (state) {
    try {
      self._onPushState(state || {});
    } catch (e) {
      self.logger.error(LOG + 'Error handling pushState: ' + e);
    }
  });
};

StreamWatchdog.prototype._disconnectSocket = function () {
  var self = this;
  if (self.socket) {
    try {
      self.socket.removeAllListeners();
      self.socket.disconnect();
    } catch (e) {
      self.logger.warn(LOG + 'Error during socket disconnect: ' + e);
    }
    self.socket = null;
  }
};

// =============================================================================
// User-initiated stop detection (see docs/development-plan.md §3.2 A)
// =============================================================================

/**
 * Shadows commandRouter.volumioStop so that whenever playback is stopped via
 * the API, a short-lived flag is raised. The state watcher reads that flag to
 * tell a deliberate user stop apart from a streaming failure.
 */
StreamWatchdog.prototype._installStopHook = function () {
  var self = this;
  if (self._origVolumioStop) return; // already installed
  if (!self.commandRouter || typeof self.commandRouter.volumioStop !== 'function') {
    self.logger.warn(LOG + 'commandRouter.volumioStop unavailable — user-stop guard disabled');
    return;
  }
  self._origVolumioStop = self.commandRouter.volumioStop;
  self.commandRouter.volumioStop = function () {
    self._markUserStop();
    return self._origVolumioStop.apply(self.commandRouter, arguments);
  };
  self.logger.verbose(LOG + 'volumioStop hook installed');
};

/** Restores the original commandRouter.volumioStop. */
StreamWatchdog.prototype._removeStopHook = function () {
  var self = this;
  if (self._origVolumioStop) {
    self.commandRouter.volumioStop = self._origVolumioStop;
    self._origVolumioStop = null;
  }
};

/** Raises userStopFlag for USER_STOP_WINDOW_MS, then clears it. */
StreamWatchdog.prototype._markUserStop = function () {
  var self = this;
  self.userStopFlag = true;
  if (self.userStopTimer) clearTimeout(self.userStopTimer);
  self.userStopTimer = setTimeout(function () {
    self.userStopFlag = false;
    self.userStopTimer = null;
  }, USER_STOP_WINDOW_MS);
  if (self.userStopTimer.unref) self.userStopTimer.unref();
};

/**
 * Returns true only for a genuine continuous network stream (web radio).
 *
 * Volumio sets `state.stream` to boolean `true` ONLY for a duration-0
 * continuous stream (which it also tags `service: 'webradio'`); for a finite
 * track it sets `stream` to the track-type STRING ('mp3', 'flac', 'tidal'…).
 * The `=== true` check MUST stay strict — a truthy test would treat every
 * local / Tidal / Qobuz / Spotify track as a stream. This is what keeps
 * token-based services out of WATCHING, so their expiring URLs are never
 * probed (Phase 7.3).
 */
StreamWatchdog.prototype._isStream = function (state) {
  return state.stream === true || state.service === 'webradio';
};

/**
 * Core state machine. Layer 1 (this handler) and Layer 2 (the probe) must
 * both agree before a failure is confirmed: an unexpected stop moves
 * WATCHING → SUSPECT, and only a probe failure promotes SUSPECT → FALLBACK.
 * A stop the user asked for (userStopFlag set) returns straight to IDLE.
 */
StreamWatchdog.prototype._onPushState = function (state) {
  var self = this;

  if (!self.ready) return; // still inside the startup delay

  // A library scan emits pushState with updatedb:true and bogus status values.
  // Suppress every transition while it is set — see CLAUDE.md.
  if (state.updatedb === true) {
    self.logger.verbose(LOG + 'Library scan in progress — ignoring pushState');
    return;
  }

  var status   = state.status;
  var isStream = self._isStream(state);

  // Volumio re-emits pushState in bursts; only log when something meaningful
  // changed, otherwise the verbose log floods.
  var sig = status + '|' + state.uri + '|' + state.service + '|' + self.state;
  if (sig !== self.lastStateSig) {
    self.lastStateSig = sig;
    self.logger.verbose(LOG + 'pushState: status=' + status +
      ' stream=' + state.stream + ' service=' + state.service +
      ' uri=' + state.uri + ' [state=' + self.state + ']');
  }

  switch (self.state) {

    case STATE.IDLE:
      // A network stream started playing → begin watching it.
      if (status === 'play' && isStream) {
        self.streamUri = state.uri || null;
        self._setState(STATE.WATCHING);
      }
      break;

    case STATE.WATCHING:
      if (status === 'play' && isStream) {
        // Still streaming — keep the watched URI fresh (e.g. station change).
        if (state.uri && state.uri !== self.streamUri) {
          self.streamUri = state.uri;
          self.logger.info(LOG + 'Watched stream URI updated: ' + self.streamUri);
        }
      } else if (status === 'play' && !isStream) {
        // User switched to a local, non-streaming source → plugin goes dormant.
        self.logger.info(LOG + 'Playback switched to a local source');
        self.streamUri = null;
        self._setState(STATE.IDLE);
      } else if (status === 'stop') {
        if (self.userStopFlag) {
          // The user just pressed Stop — deliberate, not a failure.
          self.logger.info(LOG + 'Stop was user-initiated — returning to IDLE');
          self.streamUri = null;
          self._setState(STATE.IDLE);
        } else {
          // Unexpected stop — a Layer 1 failure signal. Move to SUSPECT and
          // fire an immediate Layer 2 probe to confirm or clear it.
          self.logger.info(LOG + 'Unexpected stop while watching a stream — confirming via probe');
          self._setState(STATE.SUSPECT);
          self._runProbe();
        }
      }
      // status === 'pause' → user paused; remain WATCHING.
      break;

    case STATE.SUSPECT:
      if (status === 'play' && isStream) {
        // Stream came back on its own → false alarm.
        self.logger.info(LOG + 'Stream resumed — false alarm');
        if (state.uri) self.streamUri = state.uri;
        self._setState(STATE.WATCHING);
      } else if (status === 'play' && !isStream) {
        self.logger.info(LOG + 'Playback switched to a local source');
        self.streamUri = null;
        self._setState(STATE.IDLE);
      }
      // Otherwise: wait for the probe to confirm (→ FALLBACK) or clear (→ WATCHING).
      break;

    case STATE.FALLBACK:
      if (status === 'play' && isStream) {
        // A stream is playing again — either our auto-restore landed or the
        // user resumed it manually. Either way, resume watching it.
        self.logger.info(LOG + 'Stream playing again — resuming watch');
        self.streamUri = state.uri ||
          (self.savedState && self.savedState.uri) || null;
        self._setState(STATE.WATCHING);
      }
      // Local fallback playback (service: mpd) keeps us in FALLBACK.
      break;
  }
};

/**
 * Transitions to a new state and logs it. State changes are logged at info
 * level; per-cycle detail stays at verbose to avoid log spam.
 */
StreamWatchdog.prototype._setState = function (next) {
  var self = this;
  if (self.state === next) return;
  self.logger.info(LOG + self.state + ' → ' + next);

  // The Layer 2 probe runs while WATCHING *and* SUSPECT — keep it running
  // across that boundary, start it on entry, stop it when leaving for
  // IDLE or FALLBACK.
  var wasProbing  = (self.state === STATE.WATCHING || self.state === STATE.SUSPECT);
  var willProbe   = (next === STATE.WATCHING || next === STATE.SUSPECT);
  var wasFallback = (self.state === STATE.FALLBACK);

  self.state = next;

  if (next === STATE.WATCHING) self.probeFailCount = 0;
  if (!wasProbing && willProbe) self._startProbeTimer();
  if (wasProbing && !willProbe) self._stopProbeTimer();

  // Leaving FALLBACK clears the fallback guard, the saved snapshot, and
  // stops the restore probe.
  if (wasFallback && next !== STATE.FALLBACK) {
    self._stopRestoreTimer();
    self.fallbackActive = false;
    self.savedState     = null;
  }
  // Entering FALLBACK triggers the local-playback switch.
  if (next === STATE.FALLBACK) self._enterFallback();
};

// =============================================================================
// Layer 2 — HTTP Stream Probe
// =============================================================================

StreamWatchdog.prototype._startProbeTimer = function () {
  var self = this;
  self._stopProbeTimer();

  var interval = parseInt(self._cfg('streamCheckInterval'), 10) || 30;
  if (interval < MIN_STREAM_INTERVAL) interval = MIN_STREAM_INTERVAL;

  self.logger.info(LOG + 'Stream probe scheduled every ' + interval + 's');
  self.probeTimer = setInterval(function () { self._runProbe(); }, interval * 1000);

  // Probe once immediately so a failure is caught without waiting a full cycle.
  self._runProbe();
};

StreamWatchdog.prototype._stopProbeTimer = function () {
  var self = this;
  if (self.probeTimer) {
    clearInterval(self.probeTimer);
    self.probeTimer = null;
  }
};

/**
 * Runs one probe cycle against the watched stream URI and drives the Layer 2
 * side of the state machine:
 *   - pass in WATCHING  → clear any failure count
 *   - pass in SUSPECT   → false alarm, back to WATCHING
 *   - fail in WATCHING  → first signal, move to SUSPECT
 *   - fail in SUSPECT   → once FAIL_THRESHOLD is reached, confirm → FALLBACK
 */
StreamWatchdog.prototype._runProbe = function () {
  var self = this;
  if ((self.state !== STATE.WATCHING && self.state !== STATE.SUSPECT) ||
      !self.streamUri) {
    return libQ.resolve();
  }

  return self._resolvedProbe(self.streamUri).then(function (ok) {
    if (ok) {
      var hadFailures = self.probeFailCount > 0;
      self.probeFailCount = 0;
      if (self.state === STATE.SUSPECT) {
        self.logger.info(LOG + 'Probe confirms the stream is reachable — false alarm');
        self._setState(STATE.WATCHING);
      } else if (hadFailures) {
        self.logger.info(LOG + 'Stream probe recovered');
      }
      return;
    }

    self.probeFailCount++;
    self.logger.warn(LOG + 'Stream probe FAILED (' + self.probeFailCount +
      '/' + FAIL_THRESHOLD + ') — ' + self.streamUri);

    if (self.state === STATE.WATCHING) {
      // First failure signal from Layer 2 — move to SUSPECT for confirmation.
      self._setState(STATE.SUSPECT);
    } else if (self.state === STATE.SUSPECT &&
               self.probeFailCount >= FAIL_THRESHOLD) {
      // Both layers now agree the stream is gone.
      self.logger.error(LOG + 'Stream failure confirmed after ' +
        self.probeFailCount + ' probe failures — entering FALLBACK');
      self._setState(STATE.FALLBACK);
    }
  });
};

/**
 * Sends an HTTP HEAD request to a stream URI and resolves true (reachable) or
 * false (unreachable). Native http/https only — no external dependencies.
 *
 * Pass: 2xx, 3xx, or 405 (Shoutcast/ICEcast servers reject HEAD with 405).
 * Fail: connection refused, DNS failure, timeout, other 4xx, any 5xx.
 *
 * Non-HTTP URIs (e.g. local files, mpd://) are not probeable and resolve true
 * — Layer 1 still covers them.
 */
StreamWatchdog.prototype._probeStream = function (uri) {
  var self  = this;
  var defer = libQ.defer();

  var isHttp  = uri && uri.indexOf('http://') === 0;
  var isHttps = uri && uri.indexOf('https://') === 0;

  if (!isHttp && !isHttps) {
    self.logger.verbose(LOG + 'Probe skipped — non-HTTP URI: ' + uri);
    defer.resolve(true);
    return defer.promise;
  }

  var settled = false;
  function finish(ok, reason) {
    if (settled) return;
    settled = true;
    self.logger.verbose(LOG + 'Probe ' + (ok ? 'PASS' : 'FAIL') +
      ' (' + reason + '): ' + uri);
    defer.resolve(ok);
  }

  var parsed, mod;
  try {
    parsed = new URL(uri);                       // WHATWG URL — url.parse is deprecated
    mod    = require(isHttps ? 'https' : 'http');
  } catch (e) {
    finish(false, 'bad URI: ' + e.message);
    return defer.promise;
  }

  var req;
  try {
    req = mod.request(parsed, {
      method:  'HEAD',
      headers: { 'User-Agent': 'VolumioStreamWatchdog' }
    }, function (res) {
      var code = res.statusCode;
      var ok   = (code >= 200 && code < 400) || code === 405;
      res.resume(); // drain so the socket can close
      finish(ok, 'HTTP ' + code);
    });
  } catch (e) {
    finish(false, 'request error: ' + e.message);
    return defer.promise;
  }

  req.setTimeout(PROBE_TIMEOUT_MS, function () {
    req.destroy();
    finish(false, 'timeout');
  });
  req.on('error', function (err) {
    finish(false, err.code || err.message);
  });
  req.end();

  return defer.promise;
};

// =============================================================================
// Layer 2 — Playlist URL resolution
// =============================================================================

/**
 * Probes a URI, first resolving it through any .m3u/.pls playlist file so the
 * HEAD request hits the real stream rather than the (always-reachable)
 * playlist file. Resolves true (reachable) / false (unreachable).
 */
StreamWatchdog.prototype._resolvedProbe = function (uri) {
  var self = this;
  return self._resolvePlaylistUri(uri).then(function (target) {
    return self._probeStream(target);
  });
};

/**
 * If `uri` is an .m3u/.pls playlist file, fetches it and resolves the first
 * stream URL inside; otherwise resolves `uri` unchanged. Results are cached
 * so the playlist file is fetched only once per URI.
 */
StreamWatchdog.prototype._resolvePlaylistUri = function (uri) {
  var self  = this;
  var defer = libQ.defer();

  // Only http(s) URIs can be playlist files we need to fetch.
  if (!uri || (uri.indexOf('http://') !== 0 && uri.indexOf('https://') !== 0)) {
    defer.resolve(uri);
    return defer.promise;
  }
  if (self._resolveCache.hasOwnProperty(uri)) {
    defer.resolve(self._resolveCache[uri]);
    return defer.promise;
  }

  var pathname;
  try {
    pathname = new URL(uri).pathname.toLowerCase();
  } catch (e) {
    defer.resolve(uri);
    return defer.promise;
  }

  var isPls = /\.pls$/.test(pathname);
  var isM3u = /\.m3u$/.test(pathname);
  if (!isPls && !isM3u) {
    self._resolveCache[uri] = uri; // a direct stream, not a playlist file
    defer.resolve(uri);
    return defer.promise;
  }

  self._fetchText(uri).then(function (body) {
    var resolved = self._parsePlaylist(body, isPls);
    if (resolved) {
      self.logger.info(LOG + 'Resolved playlist URI ' + uri + ' → ' + resolved);
    } else {
      resolved = uri;
      self.logger.warn(LOG + 'No stream URL found in playlist ' + uri +
        ' — probing the playlist URI directly');
    }
    self._resolveCache[uri] = resolved;
    defer.resolve(resolved);
  }).fail(function (err) {
    self.logger.warn(LOG + 'Could not fetch playlist ' + uri + ' (' + err +
      ') — probing the playlist URI directly');
    self._resolveCache[uri] = uri;
    defer.resolve(uri);
  });

  return defer.promise;
};

/**
 * HTTP GET that resolves the response body as text. Native http/https,
 * 5-second timeout, body capped at 64 KB (playlist files are tiny).
 */
StreamWatchdog.prototype._fetchText = function (uri) {
  var self  = this;
  var defer = libQ.defer();
  var isHttps = uri.indexOf('https://') === 0;

  var mod, parsed;
  try {
    parsed = new URL(uri);
    mod    = require(isHttps ? 'https' : 'http');
  } catch (e) {
    defer.reject('bad URI');
    return defer.promise;
  }

  var settled = false;
  function done(err, text) {
    if (settled) return;
    settled = true;
    if (err) defer.reject(err);
    else defer.resolve(text);
  }

  var req = mod.get(parsed, function (res) {
    if (res.statusCode >= 400) {
      res.resume();
      done('HTTP ' + res.statusCode);
      return;
    }
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
      body += chunk;
      if (body.length > 65536) { // playlist files are tiny — cap the read
        req.destroy();
        done(null, body);
      }
    });
    res.on('end', function () { done(null, body); });
  });
  req.setTimeout(PROBE_TIMEOUT_MS, function () {
    req.destroy();
    done('timeout');
  });
  req.on('error', function (e) { done(e.code || e.message); });

  return defer.promise;
};

/**
 * Extracts the first http(s) stream URL from an .m3u or .pls playlist body.
 * Returns null if none is found.
 */
StreamWatchdog.prototype._parsePlaylist = function (body, isPls) {
  var lines = String(body || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var candidate = null;
    if (isPls) {
      // .pls is INI-style: "File1=http://stream..."
      var m = line.match(/^File\d*\s*=\s*(\S.*)$/i);
      if (m) candidate = m[1].trim();
    } else {
      // .m3u: the first non-comment line
      if (line.charAt(0) === '#') continue;
      candidate = line;
    }
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
};

// =============================================================================
// Phase 4 — Fallback playback
// =============================================================================

/**
 * Switches playback to local music after a confirmed stream failure. Called
 * once when the state machine enters FALLBACK.
 *
 * volumioStop / volumioClearQueue are fire-and-forget in Volumio 4 — they
 * must NOT be chained with .then(); the steps are sequenced with setTimeout
 * (see CLAUDE.md).
 */
StreamWatchdog.prototype._enterFallback = function () {
  var self = this;
  if (self.fallbackActive) return; // guard against re-entry
  self.fallbackActive = true;

  // Snapshot the lost stream so Phase 5 can restore it.
  try {
    self.savedState = self.commandRouter.volumioGetState();
  } catch (e) {
    self.logger.warn(LOG + 'Could not snapshot playback state: ' + e);
    self.savedState = null;
  }

  self.commandRouter.pushToastMessage('warning', 'Stream Watchdog',
    'Stream lost — switching to local music.');

  try {
    self.commandRouter.volumioStop();
  } catch (e) {
    self.logger.error(LOG + 'volumioStop failed: ' + e);
  }

  setTimeout(function () {
    if (!self.ready) return; // plugin stopped mid-sequence
    try {
      self.commandRouter.volumioClearQueue();
    } catch (e) {
      self.logger.error(LOG + 'volumioClearQueue failed: ' + e);
    }
    setTimeout(function () {
      if (self.ready) self._playOfflinePlaylist();
    }, FALLBACK_STEP_MS);
  }, FALLBACK_STEP_MS);

  // Begin watching for the original stream to come back.
  self._startRestoreTimer();
};

/**
 * Plays the configured Volumio playlist. If no playlist by that name exists,
 * falls back to scanning the local music library.
 */
StreamWatchdog.prototype._playOfflinePlaylist = function () {
  var self = this;
  var name = self._cfg('offlinePlaylistName') || 'Offline';

  var playlists = [];
  try {
    if (self.commandRouter.playListManager &&
        typeof self.commandRouter.playListManager.retrievePlaylists === 'function') {
      playlists = self.commandRouter.playListManager.retrievePlaylists() || [];
    }
  } catch (e) {
    self.logger.warn(LOG + 'Could not list playlists: ' + e);
  }

  if (playlists.indexOf(name) !== -1) {
    self.logger.info(LOG + 'Playing offline playlist "' + name + '"');
    try {
      self.commandRouter.playPlaylist(name);
    } catch (e) {
      self.logger.error(LOG + 'playPlaylist failed: ' + e);
      return self._playLocalFolder();
    }
    return libQ.resolve();
  }

  self.logger.warn(LOG + 'Playlist "' + name +
    '" not found — falling back to a local library scan');
  self.commandRouter.pushToastMessage('warning', 'Stream Watchdog',
    'Playlist "' + name + '" not found — playing local music instead.');
  return self._playLocalFolder();
};

/**
 * Fallback when no Offline playlist exists: recursively browse the local
 * library, queue every track found, and start playback.
 */
StreamWatchdog.prototype._playLocalFolder = function () {
  var self = this;
  self.logger.info(LOG + 'Scanning local library: ' + LOCAL_LIBRARY_URI);

  return self._collectTracks(LOCAL_LIBRARY_URI).then(function (items) {
    if (!self.ready) return; // plugin stopped during the scan
    if (!items || items.length === 0) {
      self.logger.warn(LOG + 'No local tracks found at ' + LOCAL_LIBRARY_URI);
      self.commandRouter.pushToastMessage('error', 'Stream Watchdog',
        'No local music found. Create a playlist named "' +
        (self._cfg('offlinePlaylistName') || 'Offline') + '".');
      return;
    }

    self.logger.info(LOG + 'Queuing ' + items.length + ' local track(s)');
    try {
      self.commandRouter.addQueueItems(items); // fire-and-forget
    } catch (e) {
      self.logger.error(LOG + 'addQueueItems failed: ' + e);
      return;
    }
    setTimeout(function () {
      if (!self.ready) return;
      try {
        self.commandRouter.volumioPlay();
      } catch (e) {
        self.logger.error(LOG + 'volumioPlay failed: ' + e);
      }
    }, FALLBACK_STEP_MS);
  }).fail(function (err) {
    self.logger.error(LOG + 'Local library scan failed: ' + err);
  });
};

/**
 * Recursively browses `uri` via the MPD plugin and resolves an array of all
 * playable track items found beneath it.
 */
StreamWatchdog.prototype._collectTracks = function (uri) {
  var self = this;

  // The MPD plugin's browse method is handleBrowseUri(curUri) — a URI string,
  // not an object, and not 'browseUri' (which does not exist).
  var browseResult;
  try {
    browseResult = self.commandRouter.executeOnPlugin(
      'music_service', 'mpd', 'handleBrowseUri', uri);
  } catch (e) {
    self.logger.error(LOG + 'executeOnPlugin(handleBrowseUri) threw: ' + e);
    return libQ.resolve([]);
  }

  if (!browseResult || typeof browseResult.then !== 'function') {
    self.logger.warn(LOG + 'handleBrowseUri returned no promise for: ' + uri);
    return libQ.resolve([]);
  }

  return browseResult.then(function (result) {
    var tracks  = [];
    var folders = [];

    if (!result || !result.navigation) return tracks;

    (result.navigation.lists || []).forEach(function (list) {
      (list.items || []).forEach(function (item) {
        if (item.type === 'song' || item.type === 'audio-file') {
          tracks.push(item);
        } else if (item.uri && FOLDER_TYPES.indexOf(item.type) !== -1) {
          folders.push(item.uri);
        }
      });
    });

    if (folders.length === 0) return tracks;

    return libQ.all(folders.map(function (folderUri) {
      return self._collectTracks(folderUri);
    })).then(function (results) {
      results.forEach(function (sub) { tracks = tracks.concat(sub); });
      return tracks;
    });
  });
};

// =============================================================================
// Phase 5 — Auto-restore
// =============================================================================

StreamWatchdog.prototype._startRestoreTimer = function () {
  var self = this;
  self._stopRestoreTimer();

  var interval = parseInt(self._cfg('restoreCheckInterval'), 10) || 60;
  if (interval < MIN_RESTORE_INTERVAL) interval = MIN_RESTORE_INTERVAL;

  self.logger.info(LOG + 'Restore probe scheduled every ' + interval + 's');
  // No immediate probe — the stream just failed; wait a full interval.
  self.restoreTimer = setInterval(function () {
    self._runRestoreProbe();
  }, interval * 1000);
};

StreamWatchdog.prototype._stopRestoreTimer = function () {
  var self = this;
  if (self.restoreTimer) {
    clearInterval(self.restoreTimer);
    self.restoreTimer = null;
  }
  if (self.restoreConfirmTimer) {
    clearTimeout(self.restoreConfirmTimer);
    self.restoreConfirmTimer = null;
  }
};

/**
 * One restore-probe cycle: probes the saved stream URI. A pass schedules a
 * confirming probe RESTORE_CONFIRM_MS later — two consecutive passes are
 * required before the stream is restored.
 */
StreamWatchdog.prototype._runRestoreProbe = function () {
  var self = this;
  if (self.state !== STATE.FALLBACK) return libQ.resolve();
  if (!self.savedState || !self.savedState.uri) {
    self.logger.verbose(LOG + 'No saved stream URI — cannot probe for restore');
    return libQ.resolve();
  }

  return self._resolvedProbe(self.savedState.uri).then(function (ok) {
    if (!ok) {
      self.logger.verbose(LOG + 'Restore probe: stream still down');
      return;
    }
    self.logger.info(LOG + 'Restore probe passed — confirming in ' +
      (RESTORE_CONFIRM_MS / 1000) + 's');
    if (self.restoreConfirmTimer) clearTimeout(self.restoreConfirmTimer);
    self.restoreConfirmTimer = setTimeout(function () {
      self.restoreConfirmTimer = null;
      self._confirmRestore();
    }, RESTORE_CONFIRM_MS);
  });
};

/** Second of the two consecutive probes; a pass triggers the restore. */
StreamWatchdog.prototype._confirmRestore = function () {
  var self = this;
  if (self.state !== STATE.FALLBACK) return libQ.resolve();
  if (!self.savedState || !self.savedState.uri) return libQ.resolve();

  return self._resolvedProbe(self.savedState.uri).then(function (ok) {
    if (!ok) {
      self.logger.info(LOG + 'Restore not confirmed — stream down again');
      return;
    }
    self._restoreStream();
  });
};

/**
 * The saved stream is confirmed reachable. With autoRestore on, resume it;
 * otherwise just notify and stay in FALLBACK.
 */
StreamWatchdog.prototype._restoreStream = function () {
  var self  = this;
  var saved = self.savedState;
  if (!saved || !saved.uri) return;

  self._stopRestoreTimer(); // don't fire again while restoring

  if (!self._cfg('autoRestore')) {
    self.logger.info(LOG + 'Stream is back, but auto-restore is disabled');
    self.commandRouter.pushToastMessage('success', 'Stream Watchdog',
      'Stream is back online — resume it manually.');
    return; // stay in FALLBACK; a manual resume moves us back to WATCHING
  }

  self.logger.info(LOG + 'Restoring original stream: ' + saved.uri);
  self.commandRouter.pushToastMessage('success', 'Stream Watchdog',
    'Stream restored — resuming.');

  var item = { uri: saved.uri, service: saved.service, title: saved.title };

  if (typeof self.commandRouter.replaceAndPlay === 'function') {
    try {
      self.commandRouter.replaceAndPlay(item);
      return;
    } catch (e) {
      self.logger.error(LOG + 'replaceAndPlay failed: ' + e);
    }
  }
  // Older Volumio builds without replaceAndPlay: stop/clear/add/play.
  self._restoreViaQueue(item);
};

/** Fallback resume path when replaceAndPlay is unavailable. */
StreamWatchdog.prototype._restoreViaQueue = function (item) {
  var self = this;
  self.logger.info(LOG + 'Restoring via stop/clear/add/play');

  try { self.commandRouter.volumioStop(); }
  catch (e) { self.logger.error(LOG + 'volumioStop failed: ' + e); }

  setTimeout(function () {
    if (!self.ready) return; // plugin stopped mid-sequence
    try { self.commandRouter.volumioClearQueue(); }
    catch (e) { self.logger.error(LOG + 'volumioClearQueue failed: ' + e); }

    setTimeout(function () {
      if (!self.ready) return;
      try { self.commandRouter.addQueueItems([item]); }
      catch (e) { self.logger.error(LOG + 'addQueueItems failed: ' + e); }

      setTimeout(function () {
        if (!self.ready) return;
        try { self.commandRouter.volumioPlay(); }
        catch (e) { self.logger.error(LOG + 'volumioPlay failed: ' + e); }
      }, FALLBACK_STEP_MS);
    }, FALLBACK_STEP_MS);
  }, FALLBACK_STEP_MS);
};

// =============================================================================
// Configuration
// =============================================================================

/**
 * v-conf may return either a raw value or a {type, value} object depending on
 * version and how the config was last written. Always unwrap via this helper.
 */
StreamWatchdog.prototype._cfg = function (key) {
  var val = this.config.get(key);
  if (val !== null && typeof val === 'object' && 'value' in val) {
    return val.value;
  }
  return val;
};

StreamWatchdog.prototype.getUIConfig = function () {
  var self      = this;
  var defer     = libQ.defer();
  var lang_code = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  ).then(function (uiconf) {
    var content = uiconf.sections[0].content;
    content[0].value = self._cfg('offlinePlaylistName');
    content[1].value = self._cfg('streamCheckInterval');
    content[2].value = self._cfg('restoreCheckInterval');
    content[3].value = self._cfg('autoRestore');
    defer.resolve(uiconf);
  }).fail(function (e) {
    self.logger.error(LOG + 'getUIConfig failed: ' + e);
    defer.reject(new Error());
  });

  return defer.promise;
};

StreamWatchdog.prototype.setUIConfig = function (data) {
  return libQ.resolve();
};

/**
 * Save handler for the settings section. Wired via the section's `onSave`
 * (in UIConfig.json); Volumio collects the fields named in `saveButton.data`
 * and passes their current values here as a plain object.
 */
StreamWatchdog.prototype.savePluginConfig = function (data) {
  var self = this;
  data = data || {};

  // Read each value from `data`, falling back to the stored value if a
  // field is somehow absent.
  var playlist = (data.offlinePlaylistName !== undefined && data.offlinePlaylistName !== null)
    ? String(data.offlinePlaylistName).trim()
    : self._cfg('offlinePlaylistName');
  if (!playlist) playlist = 'Offline';

  var streamInterval = parseInt(data.streamCheckInterval, 10);
  if (isNaN(streamInterval)) {
    streamInterval = parseInt(self._cfg('streamCheckInterval'), 10) || 30;
  }
  var restoreInterval = parseInt(data.restoreCheckInterval, 10);
  if (isNaN(restoreInterval)) {
    restoreInterval = parseInt(self._cfg('restoreCheckInterval'), 10) || 60;
  }
  var autoRestore = (data.autoRestore !== undefined)
    ? (data.autoRestore === true || data.autoRestore === 'true')
    : !!self._cfg('autoRestore');

  // Volumio cannot refresh an open settings modal, so the toast has to be
  // the feedback — name exactly which value was raised.
  var notes = [];
  if (streamInterval < MIN_STREAM_INTERVAL) {
    streamInterval = MIN_STREAM_INTERVAL;
    notes.push('Stream Check raised to ' + MIN_STREAM_INTERVAL + 's');
  }
  if (restoreInterval < MIN_RESTORE_INTERVAL) {
    restoreInterval = MIN_RESTORE_INTERVAL;
    notes.push('Restore Check raised to ' + MIN_RESTORE_INTERVAL + 's');
  }

  self.config.set('offlinePlaylistName', playlist);
  self.config.set('streamCheckInterval', streamInterval);
  self.config.set('restoreCheckInterval', restoreInterval);
  self.config.set('autoRestore', autoRestore);
  self.config.save();

  self.logger.info(LOG + 'savePluginConfig — playlist="' + playlist +
    '" streamCheck=' + streamInterval + 's restoreCheck=' + restoreInterval +
    's autoRestore=' + autoRestore);

  // Apply the new intervals to the timer that is running right now.
  if (self.state === STATE.WATCHING || self.state === STATE.SUSPECT) {
    self._startProbeTimer();
  } else if (self.state === STATE.FALLBACK) {
    self._startRestoreTimer();
  }

  self.commandRouter.pushToastMessage('success', 'Stream Watchdog',
    notes.length ? 'Settings saved — ' + notes.join('; ') + ' (minimum allowed).'
                 : 'Settings saved.');
};
