'use strict';

// =============================================================================
// Stream Watchdog 2.0 — Volumio 4 system_controller plugin
//
// One loop, one question. Every TICK_MS the plugin reads the player state and
// asks lib/decide.js: "should the radio be playing, and is it?" The answer is
// a single next step — reissue the stream, play the offline playlist, try the
// stream again — and the next tick is what checks whether that step worked.
//
// There are no events to wait for and no timers to re-arm, which is the whole
// point: every outage of 1.x that lasted hours (2026-08-29, 2026-10-13,
// 2026-10-21) was a path that issued a command and then waited for a signal
// that never came. Here the only timer is the tick, and it never stops while
// the plugin is active.
//
// This file is the Volumio shell: lifecycle, the UI hook, observing the
// player, executing actions, settings. The policy lives in lib/decide.js.
// =============================================================================

function volumioRequire(name) {
  try { return require('/volumio/node_modules/' + name); } catch (e) { return require(name); }
}

var libQ    = volumioRequire('kew');
var vconf   = volumioRequire('v-conf');
var policy  = require('./lib/decide.js');
var probes  = require('./lib/probe.js');
var offline = require('./lib/offline.js');
var sound   = require('./lib/soundcard.js');
var mpdlog  = require('./lib/mpdlog.js');

module.exports = StreamWatchdog;

var LOG    = '[StreamWatchdog] ';
var MODE   = policy.MODE;
var ACTION = policy.ACTION;

// MPD and the network take time to settle after boot (see CLAUDE.md).
var STARTUP_DELAY_MS = 30 * 1000;

// How often the loop looks at the player. Reading the state is an in-process
// call, so this is cheap; it bounds how fast a stop is noticed.
var TICK_MS = 5000;

// A probe or a playlist load still running after this long is abandoned.
// Nothing in this plugin is allowed to wait forever — that is the bug 2.0
// exists to remove.
var PENDING_MAX_MS = 30 * 1000;

var MIN_RESTORE_INTERVAL     = 30; // seconds
var DEFAULT_RESTORE_INTERVAL = 60; // seconds

// =============================================================================
// Constructor and lifecycle
// =============================================================================

function StreamWatchdog(context) {
  var self = this;
  self.context       = context;
  self.commandRouter = context.coreCommand;
  self.logger        = context.logger;
  self.configManager = context.configManager;

  self.mem          = policy.initialMemory();
  self.ready        = false;
  self.startupTimer = null;
  self.tickTimer    = null;
  self.pendingSince = 0;     // epoch ms an async step started, 0 when none
  self.pendingWhat  = null;
  self._ui = null;           // listeners on the Volumio UI socket, while active
  self.probe = probes.createProbe({ logger: self.logger, tag: LOG });
  self.card  = sound.createSampler({ commandRouter: self.commandRouter });
  self.cardNote = null;      // why the card is not being checked, once logged
  self.mpdlog = mpdlog.createWatcher();
  self.mpdNote = null;       // why mpd.log is not being checked, once logged
  self.offlineKeys = {};     // trackKey → true for the offline queue last played
}

StreamWatchdog.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new vconf();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

StreamWatchdog.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

StreamWatchdog.prototype.onStart = function () {
  var self = this;
  self.logger.info(LOG + 'Plugin starting — the loop starts in ' + (STARTUP_DELAY_MS / 1000) + 's');
  self.mem   = policy.initialMemory();
  self.ready = false;

  self.startupTimer = setTimeout(function () {
    self.startupTimer = null;
    self.activate();
  }, STARTUP_DELAY_MS);

  return libQ.resolve();
};

/** Arms the UI hook and the loop. Separate from onStart so tests can call it. */
StreamWatchdog.prototype.activate = function () {
  var self = this;
  try {
    self._installUiHook();
    self.ready = true;
    self.tickTimer = setInterval(self._guarded('Tick', function () { self.tick(); }), TICK_MS);
    self.logger.info(LOG + 'Active — checking the player every ' + (TICK_MS / 1000) + 's');
    self.tick();
  } catch (e) {
    // A half-armed plugin (ticking without the UI hook) would fight the
    // user's Stop button. Better to stay off and say so.
    self._teardown();
    self._log('error', 'Activation failed — staying inactive: ' + ((e && e.stack) || e));
  }
};

StreamWatchdog.prototype.onStop = function () {
  var self = this;
  self.logger.info(LOG + 'Plugin stopping');
  if (self.startupTimer) { clearTimeout(self.startupTimer); self.startupTimer = null; }
  self._teardown();
  return libQ.resolve();
};

StreamWatchdog.prototype._teardown = function () {
  var self = this;
  if (self.tickTimer) { clearInterval(self.tickTimer); self.tickTimer = null; }
  self._removeUiHook();
  self.ready        = false;
  self.mem          = policy.initialMemory();
  self.pendingSince = 0;
  self.pendingWhat  = null;
  self.offlineKeys  = {};
  self.mpdlog.reset();
  self.probe.clearCache();
  self.card.reset();
  self.cardNote = null;
  self.mpdNote  = null;
};

/**
 * Wraps a timer callback so an exception stays inside the plugin, named and
 * logged. A throw from a timer has no caller left to catch it and lands on
 * Volumio's global handler, which flags the whole player as broken.
 */
StreamWatchdog.prototype._guarded = function (label, fn) {
  var self = this;
  return function () {
    try { return fn.apply(this, arguments); }
    catch (e) { self._log('error', label + ' threw: ' + ((e && e.stack) || e)); }
  };
};

StreamWatchdog.prototype._log = function (level, msg) {
  try { this.logger[level](LOG + msg); } catch (ignored) { /* a broken logger must not crash us */ }
};

// =============================================================================
// The user's intent: buttons pressed in the Volumio UI
// =============================================================================

// What the Volumio web UIs (www, www3, www4) emit for the transport buttons.
var UI_COMMANDS = ['stop', 'pause', 'next', 'prev'];

/**
 * Only the Volumio UI says what the user wants: a person opened it and
 * pressed Stop, Pause, Next or Back. The same commands through the REST API
 * or the CLI — a Bluetooth remote via triggerhappy (2026-10-30: five `next`
 * in 7 s), a script — reach the same commandRouter methods, so hooking those
 * cannot tell them apart. The UI's socket events can: the plugin listens on
 * every UI connection, next to Volumio's own handlers, and never sends one.
 */
StreamWatchdog.prototype._installUiHook = function () {
  var self = this;
  if (self._ui) return;
  var pm  = self.commandRouter && self.commandRouter.pluginManager;
  var web = pm && typeof pm.getPlugin === 'function' && pm.getPlugin('user_interface', 'websocket');
  var nsp = web && web.libSocketIO && web.libSocketIO.sockets;
  if (!nsp || typeof nsp.on !== 'function') {
    throw new Error('the Volumio UI socket (websocket plugin) is unavailable');
  }
  var handlers = {};
  UI_COMMANDS.forEach(function (cmd) {
    handlers[cmd] = function () {
      try { self._onUiCommand(cmd, this); } catch (e) { self._log('error', 'UI hook threw: ' + e); }
    };
  });
  function attach(socket) {
    UI_COMMANDS.forEach(function (cmd) { socket.on(cmd, handlers[cmd]); });
  }
  self._ui = { nsp: nsp, handlers: handlers, attach: attach };
  uiSockets(nsp).forEach(attach);   // pages already open when the plugin starts
  nsp.on('connection', attach);
};

StreamWatchdog.prototype._removeUiHook = function () {
  var ui = this._ui;
  if (!ui) return;
  this._ui = null;
  ui.nsp.removeListener('connection', ui.attach);
  uiSockets(ui.nsp).forEach(function (socket) {
    UI_COMMANDS.forEach(function (cmd) { socket.removeListener(cmd, ui.handlers[cmd]); });
  });
};

/** The connected sockets: an object by id in socket.io 1.x, a Map in 3+. */
function uiSockets(nsp) {
  var s = nsp.connected || nsp.sockets;
  if (!s) return [];
  if (Array.isArray(s)) return s.slice();
  if (typeof s.values === 'function') return Array.from(s.values());
  return Object.keys(s).map(function (k) { return s[k]; });
}

StreamWatchdog.prototype._onUiCommand = function (cmd, socket) {
  var r = policy.userCommand(this.mem, cmd);
  if (!r.forgot) return;
  var before = this._stateName(this.mem);
  this.mem = r.mem;
  this._log('info', before + ' → IDLE (' + cmd + ' pressed in the Volumio UI)');
  var from = socket && socket.handshake && socket.handshake.address;
  if (from) this._log('verbose', 'UI ' + cmd + ' came from ' + from);
};

// =============================================================================
// The loop
// =============================================================================

StreamWatchdog.prototype.tick = function () {
  var self = this;
  if (!self.ready) return;

  var now = Date.now();
  if (self.pendingSince) {
    if (now - self.pendingSince < PENDING_MAX_MS) return; // let it finish
    self._log('warn', self.pendingWhat + ' still pending after ' +
      (PENDING_MAX_MS / 1000) + 's — giving up on it');
    self._end();
  }

  var obs    = self._observe();
  var before = self._stateName(self.mem);
  var r      = policy.decide(obs, self.mem, now, self._policyConfig());
  self.mem   = r.mem;
  self._forgetOfflineQueue(obs, now);

  if (r.cardIdle) {
    self._log('info', 'Sound card idle while Volumio says play (' + obs.card + ')');
  }
  if (r.starved) {
    self._log('info', 'MPD playing silence while Volumio says play (' + obs.mpd + ')');
  }

  var after = self._stateName(self.mem);
  if (after !== before) self._onTransition(before, after, r.why);
  else if (r.action === ACTION.NONE && self.mem.stops > 0) {
    self._log('verbose', 'Stopped (' + self.mem.stops + ') — ' + r.why);
  }

  self._execute(r.action, r.why);
};

/**
 * The offline queue is ours for as long as its tracks sit in Volumio's queue.
 * It is forgotten when nothing is looked after, or when the radio plays (past
 * the playlist's start-up grace) and Volumio's queue holds none of them any
 * more — from then on local music is the user's again; with the library
 * fallback the list would otherwise hold every local track.
 *
 * Not by time alone: on 2026-11-05 the reissued radio won a race against the
 * offline playlist inside MPD, the list was forgotten the moment the radio
 * was seen, and 4 min 42 later Volumio — still counting down the first
 * offline track in its own queue — announced the second. Taken for the
 * user's choice: IDLE for four hours with the radio on air.
 */
StreamWatchdog.prototype._forgetOfflineQueue = function (obs, now) {
  var self = this;
  var m = self.mem;
  if (!m.wanted) { self.offlineKeys = {}; return; }
  if (!(m.mode === MODE.RADIO && obs && obs.status === 'play' && policy.isStream(obs) &&
        now - m.offlineAt >= policy.DEFAULTS.offlineGraceMs)) return;
  var queue = self._volumioQueue();
  // An unreadable queue is no evidence that the tracks are gone: keep them.
  if (!queue) return;
  var still = queue.some(function (it) { return it && self.offlineKeys[offline.trackKey(it.uri)]; });
  if (!still) self.offlineKeys = {};
};

/**
 * Volumio's play queue, or null when it cannot be read. The array itself:
 * stateMachine.getQueue() writes a journal line per call.
 */
StreamWatchdog.prototype._volumioQueue = function () {
  try {
    var sm = this.commandRouter.stateMachine;
    var q  = sm && sm.playQueue && sm.playQueue.arrayQueue;
    return Array.isArray(q) ? q : null;
  } catch (e) { return null; }
};

/**
 * The player state, or null if it cannot be read. While Volumio says `play`
 * or `pause` it also carries `starved` (MPD played silence since the last
 * tick — lib/mpdlog.js) and `audio`: whether the sound card is actually
 * playing (Volumio can say either one wrongly — see lib/decide.js).
 */
StreamWatchdog.prototype._observe = function () {
  var cr = this.commandRouter;
  var st;
  try {
    // stateMachine.getState() directly: volumioGetState() writes a line to
    // the journal on every call, and this runs every few seconds.
    var sm = cr.stateMachine;
    st = (sm && typeof sm.getState === 'function') ? sm.getState() : cr.volumioGetState();
  } catch (e) {
    this._log('warn', 'Could not read the player state: ' + e);
    return null;
  }
  if (!st) return null;
  // mpd.log is read every tick, so that only what MPD wrote since the last
  // tick is ever counted.
  var mpd = this._readMpdLog();
  if (st.status !== 'play' && st.status !== 'pause') { this.card.reset(); return st; }
  var card = this._readCard();
  return Object.assign({}, st, { audio: card.audio, card: card.detail,
                                 starved: mpd.starved, mpd: mpd.detail,
                                 offline: !!this.offlineKeys[offline.trackKey(st.uri)] });
};

/** MPD's log, or { starved: null } when it cannot be read — logged once. */
StreamWatchdog.prototype._readMpdLog = function () {
  var r;
  try { r = this.mpdlog.read(); }
  catch (e) { r = { starved: null, detail: 'read threw: ' + e }; }
  if (r.starved === null || r.starved === undefined) {
    if (r.detail !== this.mpdNote) {
      this.mpdNote = r.detail;
      this._log('info', 'MPD log not checked (' + r.detail + ')');
    }
  } else if (this.mpdNote) {
    this.mpdNote = null;
    this._log('info', 'MPD log checked again');
  }
  return r;
};

/**
 * The sound card, or { audio: null } when it cannot be told. An unreadable
 * card is no evidence and never causes a reissue: it is logged once, and
 * the loop goes on with Volumio's state alone.
 */
StreamWatchdog.prototype._readCard = function () {
  var c;
  try { c = this.card.read(); }
  catch (e) { c = { audio: null, detail: 'read threw: ' + e }; }
  if (c.audio === null || c.audio === undefined) {
    if (c.detail !== this.cardNote) {
      this.cardNote = c.detail;
      this._log('info', 'Sound card not checked — using Volumio\'s state only (' + c.detail + ')');
    }
  } else if (this.cardNote) {
    this.cardNote = null;
    this._log('info', 'Sound card checked again (' + c.detail + ')');
  }
  return c;
};

StreamWatchdog.prototype._policyConfig = function () {
  return {
    restoreIntervalMs: this._restoreInterval() * 1000,
    autoRestore:       this._autoRestore()
  };
};

/** Names used in the log — the telemetry collector reads these. */
StreamWatchdog.prototype._stateName = function (mem) {
  if (!mem.wanted) return 'IDLE';
  return mem.mode === MODE.FALLBACK ? 'FALLBACK' : 'WATCHING';
};

StreamWatchdog.prototype._onTransition = function (before, after, why) {
  this._log('info', before + ' → ' + after + ' (' + why + ')');
  if (before === 'WATCHING' && after === 'FALLBACK') {
    this._toast('warning', 'Stream lost — switching to local music.');
  } else if (before === 'FALLBACK' && after === 'WATCHING') {
    this._toast('success', 'Stream is back — resumed.');
  }
};

StreamWatchdog.prototype._execute = function (action, why) {
  switch (action) {
    case ACTION.ADOPT:
      this._log('info', 'Watching stream: ' + this.mem.wanted.uri);
      break;
    case ACTION.PLAY_RADIO:
      this._log('info', 'Reissuing stream (' + why + '): ' + this.mem.wanted.uri);
      this._playRadio();
      break;
    case ACTION.PLAY_OFFLINE:
      this._playOffline(why);
      break;
    case ACTION.TRY_RADIO:
      this._tryRadio();
      break;
    default:
      break; // NONE and FORGET need no command
  }
};

// =============================================================================
// Actions
// =============================================================================

StreamWatchdog.prototype._playRadio = function () {
  var w = this.mem.wanted;
  if (!w) return;
  this._replaceAndPlay({ uri: w.uri, service: w.service || 'webradio', title: w.title },
    'play the stream');
};

StreamWatchdog.prototype._playOffline = function (why) {
  var self = this;
  var name = self._playlistName();
  self._log('info', 'Playing offline playlist "' + name + '" (' + why + ')');
  self._begin('Loading the offline playlist');

  offline.loadTracks(self.commandRouter, name, self.logger, LOG).then(function (res) {
    self._end();
    if (!self.ready || !self.mem.wanted || self.mem.mode !== MODE.FALLBACK) return;
    if (!res.items.length) {
      self._log('error', 'No offline music found — create a playlist named "' + name + '"');
      self._toast('error', 'No local music found. Create a playlist named "' + name + '".');
      return; // the next ticks try again; nothing waits on this
    }
    var list = offline.shuffle(res.items);
    self._log('info', 'Offline queue: ' + list.length + ' tracks from the ' + res.source + ', shuffled');
    // Remembered so the policy never takes our own playlist for the user's.
    self.offlineKeys = {};
    list.forEach(function (it) { self.offlineKeys[offline.trackKey(it.uri)] = true; });
    self.mem = policy.noteOffline(self.mem, Date.now());
    self._replaceAndPlay({ list: list, index: 0 }, 'play the offline playlist');
  }).fail(function (e) {
    self._end();
    self._log('error', 'Offline playlist failed: ' + e);
  });
};

StreamWatchdog.prototype._tryRadio = function () {
  var self = this;
  var w = self.mem.wanted;
  if (!w) return;
  self._begin('Restore check');

  self.probe.probe(w.uri).then(function (ok) {
    self._end();
    if (!self.ready || !self.mem.wanted || self.mem.mode !== MODE.FALLBACK) return;
    if (!ok) {
      self._log('verbose', 'Restore check: stream still down');
      return;
    }
    // A passing HEAD only says the server answers. Whether audio flows is
    // for the next ticks: playing → WATCHING; stopped → back to the offline
    // playlist two ticks later.
    self._log('info', 'Restore check: stream answers — trying it: ' + w.uri);
    self.mem = policy.noteAttempt(self.mem);
    self._log('verbose', 'Restore check: if it fails, the next one is in ' +
      Math.round(policy.restoreWait(self.mem, self._policyConfig()) / 1000) + 's');
    self._playRadio();
  }).fail(function (e) {
    self._end();
    self._log('error', 'Restore check failed: ' + e);
  });
};

StreamWatchdog.prototype._replaceAndPlay = function (data, what) {
  var self = this;
  var cr = self.commandRouter;
  if (typeof cr.replaceAndPlay !== 'function') {
    self._log('error', 'replaceAndPlay unavailable on this Volumio build — cannot ' + what);
    return;
  }
  try {
    var p = cr.replaceAndPlay(data);
    if (p && typeof p.fail === 'function') {
      p.fail(function (e) { self._log('error', 'Could not ' + what + ': ' + e); });
    }
  } catch (e) {
    self._log('error', 'Could not ' + what + ': ' + e);
  }
};

StreamWatchdog.prototype._begin = function (what) {
  this.pendingSince = Date.now();
  this.pendingWhat  = what;
};

StreamWatchdog.prototype._end = function () {
  this.pendingSince = 0;
  this.pendingWhat  = null;
};

StreamWatchdog.prototype._toast = function (type, message) {
  try { this.commandRouter.pushToastMessage(type, 'Stream Watchdog', message); }
  catch (e) { this._log('warn', 'Toast failed: ' + e); }
};

// =============================================================================
// Settings
// =============================================================================

StreamWatchdog.prototype._cfg = function (key) {
  var val = this.config ? this.config.get(key) : undefined;
  if (val !== null && typeof val === 'object' && 'value' in val) return val.value;
  return val;
};

StreamWatchdog.prototype._playlistName = function () {
  var n = this._cfg('offlinePlaylistName');
  return (n && String(n).trim()) || 'Offline';
};

StreamWatchdog.prototype._restoreInterval = function () {
  var n = parseInt(this._cfg('restoreCheckInterval'), 10);
  if (isNaN(n)) n = DEFAULT_RESTORE_INTERVAL;
  return Math.max(MIN_RESTORE_INTERVAL, n);
};

StreamWatchdog.prototype._autoRestore = function () {
  var v = this._cfg('autoRestore');
  if (v === undefined || v === null) return true;
  return v === true || v === 'true';
};

StreamWatchdog.prototype.getUIConfig = function () {
  var self  = this;
  var defer = libQ.defer();
  var lang  = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  ).then(function (uiconf) {
    // By id, never by position: inserting a field must not shift values.
    var byId = {};
    (uiconf.sections[0].content || []).forEach(function (c) { byId[c.id] = c; });
    function put(id, value) {
      if (byId[id]) byId[id].value = value;
      else self._log('error', 'getUIConfig: field "' + id + '" is missing from UIConfig.json');
    }
    put('offlinePlaylistName',  self._playlistName());
    put('restoreCheckInterval', self._restoreInterval());
    put('autoRestore',          self._autoRestore());
    defer.resolve(uiconf);
  }).fail(function (e) {
    self._log('error', 'getUIConfig failed: ' + e);
    defer.reject(new Error());
  });
  return defer.promise;
};

StreamWatchdog.prototype.setUIConfig = function () {
  return libQ.resolve();
};

/** Save handler, wired via the section's onSave/saveButton in UIConfig.json. */
StreamWatchdog.prototype.savePluginConfig = function (data) {
  var self = this;
  data = data || {};

  var playlist = (data.offlinePlaylistName !== undefined && data.offlinePlaylistName !== null)
    ? String(data.offlinePlaylistName).trim() : self._playlistName();
  if (!playlist) playlist = 'Offline';

  var restore = parseInt(data.restoreCheckInterval, 10);
  if (isNaN(restore)) restore = self._restoreInterval();
  var raised = restore < MIN_RESTORE_INTERVAL;
  if (raised) restore = MIN_RESTORE_INTERVAL;

  var autoRestore = (data.autoRestore !== undefined)
    ? (data.autoRestore === true || data.autoRestore === 'true') : self._autoRestore();

  self.config.set('offlinePlaylistName', playlist);
  self.config.set('restoreCheckInterval', restore);
  self.config.set('autoRestore', autoRestore);
  self.config.save();

  // Nothing to restart: the next tick reads the new values.
  self._log('info', 'Settings saved — playlist="' + playlist + '" restoreCheck=' + restore +
    's autoRestore=' + autoRestore);
  self._toast('success', raised
    ? 'Settings saved — Restore Check raised to ' + MIN_RESTORE_INTERVAL + 's (minimum allowed).'
    : 'Settings saved.');
};
