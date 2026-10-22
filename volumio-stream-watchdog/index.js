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
// This file is the Volumio shell: lifecycle, the stop hook, observing the
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
  self._origVolumioStop = null;
  self.probe = probes.createProbe({ logger: self.logger, tag: LOG });
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

/** Arms the stop hook and the loop. Separate from onStart so tests can call it. */
StreamWatchdog.prototype.activate = function () {
  var self = this;
  try {
    self._installStopHook();
    self.ready = true;
    self.tickTimer = setInterval(self._guarded('Tick', function () { self.tick(); }), TICK_MS);
    self.logger.info(LOG + 'Active — checking the player every ' + (TICK_MS / 1000) + 's');
    self.tick();
  } catch (e) {
    // A half-armed plugin (ticking without the stop hook) would fight the
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
  self._removeStopHook();
  self.ready        = false;
  self.mem          = policy.initialMemory();
  self.pendingSince = 0;
  self.pendingWhat  = null;
  self.probe.clearCache();
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
// The user's Stop
// =============================================================================

/**
 * Anything that calls commandRouter.volumioStop — the UI, the app, another
 * plugin — is someone who wants the music off, so the watchdog stops looking
 * after the stream. The plugin itself never calls volumioStop: it switches
 * sources with replaceAndPlay, which stops through the state machine
 * directly. That is what lets one hook replace 1.x's three stop flags.
 */
StreamWatchdog.prototype._installStopHook = function () {
  var self = this;
  if (self._origVolumioStop) return;
  if (!self.commandRouter || typeof self.commandRouter.volumioStop !== 'function') {
    throw new Error('commandRouter.volumioStop unavailable');
  }
  self._origVolumioStop = self.commandRouter.volumioStop;
  self.commandRouter.volumioStop = function () {
    try { self._onUserStop(); } catch (e) { self._log('error', 'Stop hook threw: ' + e); }
    return self._origVolumioStop.apply(self.commandRouter, arguments);
  };
};

StreamWatchdog.prototype._removeStopHook = function () {
  if (this._origVolumioStop) {
    this.commandRouter.volumioStop = this._origVolumioStop;
    this._origVolumioStop = null;
  }
};

StreamWatchdog.prototype._onUserStop = function () {
  if (!this.mem.wanted) return;
  var before = this._stateName(this.mem);
  this.mem = policy.forget(this.mem);
  this._log('info', before + ' → IDLE (stop requested)');
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

  var after = self._stateName(self.mem);
  if (after !== before) self._onTransition(before, after, r.why);
  else if (r.action === ACTION.NONE && self.mem.stops > 0) {
    self._log('verbose', 'Stopped (' + self.mem.stops + ') — ' + r.why);
  }

  self._execute(r.action, r.why);
};

/** The player state, or null if it cannot be read. */
StreamWatchdog.prototype._observe = function () {
  var cr = this.commandRouter;
  try {
    // stateMachine.getState() directly: volumioGetState() writes a line to
    // the journal on every call, and this runs every few seconds.
    var sm = cr.stateMachine;
    var st = (sm && typeof sm.getState === 'function') ? sm.getState() : cr.volumioGetState();
    return st || null;
  } catch (e) {
    this._log('warn', 'Could not read the player state: ' + e);
    return null;
  }
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
