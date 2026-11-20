'use strict';

/*
 * Volumio 4 plugin "X10 RF Remote" (system_hardware/x10remote)
 *
 * remote -> driver -> /dev/input/eventX -> x10mapper.py (systemd, root)
 *   -> /dev/uinput (virtual keys / passthrough) -> Triggerhappy (part of Volumio) -> Volumio
 *
 * The plugin manages
 *  - profiles per remote in /data/INTERNAL/X10/<id>/ (keys, names, commands, description, pictures)
 *  - /data/configuration/system_hardware/x10remote/mapper.json   (configuration of the mapper)
 *  - /etc/triggerhappy/triggers.d/x10remote.conf                   (this file only; audio.conf stays unchanged)
 *  - the service x10mapper.service (started in onStart, stopped in onStop)
 *  - the web interface (key test, read-in wizard, profiles) on its own port
 */

// kew and v-conf: own node_modules, otherwise the modules of the Volumio core (read only)
function requireDep(name) {
  try {
    return require(name);
  } catch (e) {
    return require('/volumio/node_modules/' + name);
  }
}

var libQ = requireDep('kew');
var VConf = requireDep('v-conf');
var fs = require('fs');
var fsp = fs.promises;
var os = require('os');
var path = require('path');
var cp = require('child_process');

var C = require('./lib/constants');
var profilesLib = require('./lib/profiles');
var triggers = require('./lib/triggers');
var radio = require('./lib/radio');
var WebServer = require('./lib/web').WebServer;
var MobileServer = require('./lib/mobile').MobileServer;
var net = require('net');
var HttpError = require('./lib/web').HttpError;

var PLUGIN_VERSION = (function () {
  try { return require('./package.json').version; } catch (e) { return '?'; }
})();
var X10_DEVICE = '0bc7:0006';
var DEFAULT_PROFILE_ID = C.SENDER_PREFIX + 'x10-wti';
var VANILLA_ID = C.VANILLA_ID;     // built-in profile: only the original audio.conf
var MULTI_VALUE = '__multi__';

function kew(promise) {
  var d = libQ.defer();
  Promise.resolve(promise).then(function (v) { d.resolve(v); }, function (e) { d.reject(e); });
  return d.promise;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = ControllerX10Remote;

function ControllerX10Remote(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;
  this.started = false;
  this.capture = null;
  this.captureTimer = null;
  this.current = { mappings: [], problems: [], profiles: [] };
  this._applyQueue = Promise.resolve();
  this.excl = { on: false, state: 'off', timer: null, watcher: null, watchTimer: null, error: '' };
  this.prereq = { ok: true, missing: [] };
}

// ============================================================== lifecycle

ControllerX10Remote.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config = new VConf();
  this.config.loadFile(configFile);
  this.configDir = path.dirname(configFile);
  var self = this;
  this.store = new profilesLib.ProfileStore(C.PROFILE_DIR, this.logger, {
    onPermissionError: function () { return self.fixSharePermissions(); },
    onChange: function () { self.scheduleCatalog(); }
  });
  // receivers: own folder directly in /data/INTERNAL/X10, named receiver-<stored name> (receiver.json)
  this.receivers = new profilesLib.ProfileStore(C.PROFILE_DIR, this.logger, {
    exactNames: true,
    onPermissionError: function () { return self.fixSharePermissions(); },
    fileName: 'receiver.json', sanitize: profilesLib.sanitizeReceiver, kind: 'receiver', notFound: 'receiver_not_found',
    isValid: function (raw) { return !!(raw.device && raw.device.id); }
  });
  this.web = new WebServer(this, this.logger);
  this.mobile = new MobileServer(this, this.logger);
  return libQ.resolve();
};

ControllerX10Remote.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerX10Remote.prototype.onStart = function () {
  var self = this;
  self.loadI18n();
  self.started = true;
  return kew((async function () {
    await self.fixSharePermissions();
    await self.adoptFolderNames().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'folder names: ' + e.message); });
    await self.migrate();
    await self.checkPrerequisites();
    await self.ensureReceivers().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'receivers: ' + e.message); });
    await self.ensureCommandRef();
    await self.ensureRadioPresets().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'radio presets: ' + e.message); });
    await self.writeCatalog().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'radio catalog: ' + e.message); });
    await self.web.start(self.webPortSetting(), self.eventPortSetting());
    if (self.mobileEnabled()) await self.mobile.start(self.mobilePortSetting());
    await self.apply();
    if (self.isEnabled() && self.prereq.ok) {
      // restart instead of start: after an update this makes sure the new mapper version is running
      await self.systemctl(['restart', C.SERVICE]);
    } else {
      await self.systemctl(['stop', C.SERVICE]).catch(function () { /* ignore */ });
    }
    await self.updateWatchdog();
    self.startThdCheck();
    // exclusive mode: in the background after the waiting time (onStart does not wait for it)
    self.startExclusive(false).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'exclusive mode: ' + e.message);
    });
    self.logger.info(C.LOG_PREFIX + 'onStart: version ' + PLUGIN_VERSION + ', web port ' + self.web.port);
  })().catch(function (e) {
    self.logger.error(C.LOG_PREFIX + 'onStart failed: ' + (e && e.message));
    throw e;
  }));
};

ControllerX10Remote.prototype.onStop = function () {
  var self = this;
  self.started = false;
  self.stopThdCheck();
  self.clearCapture();
  clearTimeout(self.catalogTimer);      // after onStop the plugin writes nothing any more
  // onStop must never fail (disabling, updating and uninstalling depend on it):
  // each step on its own, errors only go to the log.
  var step = function (what, fn) {
    return Promise.resolve().then(fn).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'onStop ' + what + ': ' + (e && e.message));
    });
  };
  return kew((async function () {
    // stop the watchdog first so that it does not restart the stopped mapper
    await step('watchdog', function () { return self.stopWatchdog(); });
    await step('mapper', function () { return self.systemctl(['stop', C.SERVICE]); });
    // first start Triggerhappy normally again (with audio.conf)
    await step('exclusive', function () { return self.stopExclusive(); });
    await step('trigger file', function () { return self.writeThdConf(self.thdHeaderOnly()); });
    await step('triggerhappy', function () { return self.reloadTriggerhappy(); });
    await step('mobile remote', function () { return self.mobile.stop(); });
    await step('web interface', function () { return self.web.stop(); });
    self.logger.info(C.LOG_PREFIX + 'onStop: stopped');
  })());
};

ControllerX10Remote.prototype.onRestart = function () {};

ControllerX10Remote.prototype.getConf = function (key) {
  return this.config.get(key);
};

ControllerX10Remote.prototype.setConf = function (key, value) {
  this.config.set(key, value);
};

ControllerX10Remote.prototype.setUIConfig = function () {};

// =================================================================== i18n

/** Language of Volumio as a two-letter code (e.g. 'it' also for 'it_IT' or 'it-IT'). */
ControllerX10Remote.prototype.langCode = function () {
  try {
    var code = String(this.commandRouter.sharedVars.get('language_code') || 'en').trim();
    var m = /^([a-zA-Z]{2})/.exec(code);
    return m ? m[1].toLowerCase() : 'en';
  } catch (e) {
    return 'en';
  }
};

/*
 * Translations as Volumio prescribes: i18n/strings_<language code>.json, English (strings_en.json) is
 * mandatory and the fallback for missing languages and missing keys. Volumio's getI18nString does not
 * know a plugin's keys in toasts/modals - hence an own translation (t) that follows Volumio's language
 * (sharedVars language_code) and reloads when the language changes.
 */
ControllerX10Remote.prototype.langFile = function (lang) {
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(String(lang || ''))) return null;
  return path.join(__dirname, 'i18n', 'strings_' + lang + '.json');
};

ControllerX10Remote.prototype.readLang = function (lang) {
  this._langCache = this._langCache || {};
  if (this._langCache[lang] !== undefined) return this._langCache[lang];
  var data = null;
  var file = this.langFile(lang);
  if (file) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { data = null; }
  }
  this._langCache[lang] = data;
  return data;
};

/** Available languages (files in the folder i18n). */
ControllerX10Remote.prototype.languages = function () {
  try {
    return fs.readdirSync(path.join(__dirname, 'i18n')).map(function (f) {
      var m = /^strings_([a-z]{2}(?:_[A-Z]{2})?)\.json$/.exec(f);
      return m ? m[1] : null;
    }).filter(Boolean).sort();
  } catch (e) {
    return ['en'];
  }
};

ControllerX10Remote.prototype.loadI18n = function () {
  var lang = this.langCode();
  this.i18nEn = this.readLang('en');
  this.i18n = this.readLang(lang) || this.readLang(String(lang).slice(0, 2)) || this.i18nEn;
  this.i18nLang = lang;
};

/** Text in the language of Volumio (or in lang, e.g. for the web interface). */
ControllerX10Remote.prototype.t = function (key, vars, lang) {
  if (!this.i18nEn || this.i18nLang !== this.langCode()) this.loadI18n();
  var table = lang ? (this.readLang(lang) || this.i18n) : this.i18n;
  var s = (table.X10 && table.X10[key]) || this.i18nEn.X10[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
  }
  return s;
};

ControllerX10Remote.prototype.actionLabel = function (action, lang) {
  return this.t('ACTION_' + String(action || 'none').toUpperCase(), null, lang);
};

// ================================================================ settings

ControllerX10Remote.prototype.isEnabled = function () {
  var v = this.config.get('enabled');
  return v === undefined ? true : !!v;
};

/**
 * Expert mode: custom shell commands and exclusive mode can only be switched on there and only take
 * effect while expert mode is on.
 */
ControllerX10Remote.prototype.expertMode = function () {
  return this.config.get('expert_mode') === true;
};

/** Custom commands effective? (expert mode on AND explicitly allowed; default: off) */
ControllerX10Remote.prototype.allowShell = function () {
  return this.expertMode() && this.config.get('allow_shell') === true;
};

ControllerX10Remote.prototype.numConf = function (key, def, min, max) {
  var v = parseInt(this.config.get(key), 10);
  if (isNaN(v)) v = def;
  return Math.max(min, Math.min(max, v));
};

ControllerX10Remote.prototype.webPortSetting = function () {
  return this.numConf('web_port', C.DEFAULT_WEB_PORT, 1024, 65535);
};

/** UDP port (127.0.0.1 only) on which the plugin receives the events of the mapper. */
ControllerX10Remote.prototype.eventPortSetting = function () {
  return this.numConf('event_port', C.DEFAULT_EVENT_PORT, 1024, 65535);
};

ControllerX10Remote.prototype.ignoreList = function () {
  return String(this.config.get('ignore_scancodes') || '')
    .split(/[,; ]+/)
    .filter(function (s) { return s.length; })
    .map(function (s) { return parseInt(s, s.toLowerCase().indexOf('0x') === 0 ? 16 : 10); })
    .filter(function (n) { return !isNaN(n) && n >= 0; });
};

ControllerX10Remote.prototype.activeIds = function () {
  var raw = this.config.get('active_profiles');
  try {
    var list = JSON.parse(raw || '[]');
    if (Array.isArray(list)) {
      return list.filter(function (id, i) { return profilesLib.ID_RE.test(id) && list.indexOf(id) === i; });
    }
  } catch (e) { /* ignore */ }
  return [];
};

ControllerX10Remote.prototype.setActiveIds = function (ids) {
  this.config.set('active_profiles', JSON.stringify(ids));
};

// ============================================================ first start / migration

/** Is an X10 WTI receiver (ati_remote, 0bc7:0006) connected? (/proc/bus/input/devices, without root) */
ControllerX10Remote.prototype.x10Present = async function () {
  var text = await fsp.readFile('/proc/bus/input/devices', 'utf8').catch(function () { return ''; });
  return /Vendor=0bc7 Product=0006/i.test(text);
};

/**
 * First start: the X10 default profile is only created (and activated) if an X10 receiver is
 * connected. Without an X10 receiver "Volumio default – vanilla" stays active; the check is
 * repeated on every start until the receiver has been found once.
 * force: button "Create X10 default profile" (also without a connected receiver).
 */
ControllerX10Remote.prototype.migrate = async function (force) {
  var self = this;
  try {
    await self.store.ensureBase();
  } catch (e) {
    self.logger.error(C.LOG_PREFIX + 'cannot create ' + C.PROFILE_DIR + ': ' + e.message);
    throw e;
  }
  // 0.59.0: debounce time 300 -> 600 ms (ati_remote holds repeats back for 500 ms). Only the old
  // default is adjusted, a time chosen by the user stays.
  // 0.62.0: new presets for the ports (7810/7811/7812). Only the old presets are changed,
  // a port chosen by the user stays.
  if (self.config.get('ports_v62') !== true) {
    Object.keys(C.OLD_DEFAULT_PORTS).forEach(function (k) {
      if (parseInt(self.config.get(k), 10) === C.OLD_DEFAULT_PORTS[k]) {
        self.config.set(k, k === 'web_port' ? C.DEFAULT_WEB_PORT : C.DEFAULT_MOBILE_PORT);
      }
    });
    self.config.set('ports_v62', true);
  }
  if (self.config.get('debounce_v59') !== true) {
    if (parseInt(self.config.get('debounce_ms'), 10) === 300) self.config.set('debounce_ms', C.DEFAULT_DEBOUNCE_MS);
    self.config.set('debounce_v59', true);
  }
  if (self.config.get('migrated') === true && !force) return;

  var existing = await self.store.get(DEFAULT_PROFILE_ID);
  if (existing) {
    self.config.set('migrated', true);
    return;
  }
  if (!force) {
    // Only on the very first start: once profiles exist, none is ever created or activated automatically
    // again (not even when an X10 receiver is plugged in later) - the button exists for that.
    if ((await self.userProfiles()).length) {
      self.config.set('migrated', true);
      return;
    }
    if (!(await self.x10Present())) {
      self.logger.info(C.LOG_PREFIX + 'no X10 receiver connected - no default profile created');
      return;
    }
  }
  var keys = self.defaultX10Keys();
  keys.push({ name: 'DVD', type: 'key', code: 389, key_name: 'KEY_DVD', action: 'default' });
  try {
    var created = await self.store.save({
      name: 'X10 WTI RF Remote',
      description: self.t('DEFAULT_PROFILE_DESC'),
      device: { id: X10_DEVICE, name: 'X10 WTI RF receiver' },
      keys: keys
    }, { allowShell: false, version: PLUGIN_VERSION, newId: DEFAULT_PROFILE_ID });
    var ids = self.activeIds();
    if (ids.indexOf(created.id) === -1) ids.unshift(created.id);
    self.setActiveIds(ids);
    self.config.set('migrated', true);
    self.logger.info(C.LOG_PREFIX + 'created X10 default profile ' + created.id + ' (' + keys.length + ' keys)');
  } catch (e) {
    self.logger.error(C.LOG_PREFIX + 'default profile not created: ' + e.message);
  }
};

ControllerX10Remote.prototype.defaultX10Keys = function () {
  return [0x06, 0x2c, 0x2d, 0x2e, 0x05, 0x19, 0x39, 0x3a].map(function (code) {
    return { name: 'X10 ' + triggers.hex(code), type: 'scan', code: code, action: 'none' };
  });
};

/**
 * Prerequisites for the mapper: python3-evdev and /dev/uinput. If something is missing, the plugin does
 * not start the mapper (instead of letting systemd restart it forever) and reports it understandably.
 */
ControllerX10Remote.prototype.checkPrerequisites = async function () {
  var self = this;
  var missing = [];
  await self.exec('/usr/bin/python3', ['-c', 'import evdev']).catch(function () { missing.push('python3-evdev'); });
  await fsp.access(C.MAPPER_BIN).catch(function () { missing.push(C.MAPPER_BIN); });
  self.prereq = { ok: missing.length === 0, missing: missing };
  if (missing.length) {
    self.logger.error(C.LOG_PREFIX + 'missing: ' + missing.join(', ') + ' - mapper not started, please reinstall the plugin');
    self.toast('error', self.t('PREREQ_MISSING', { list: missing.join(', ') }));
  }
};

// ============================================================ applying the configuration

ControllerX10Remote.prototype.activeProfiles = async function () {
  var self = this;
  var out = [];
  var ids = self.activeIds();
  self.activeInvalid = [];
  for (var i = 0; i < ids.length; i++) {
    var p = await self.store.get(ids[i]);
    if (p) out.push(p);
    else if (self.store.invalid[ids[i]]) self.activeInvalid.push({ code: 'profile_invalid', profile: ids[i], other: self.store.invalid[ids[i]] });
  }
  // Mobile Remote: the assigned buttons of the phone page count like an active profile as soon as they
  // exist - whether or not the phone port is open (the simulation in the web interface uses them too).
  var mob = await self.mobileProfile();
  if (mob) out.push(mob);
  return out;
};

/** Folders in /data/INTERNAL/X10 whose profile.json/receiver.json is ignored because of invalid content. */
ControllerX10Remote.prototype.webInvalid = async function () {
  await this.store.list();
  await this.receivers.list();
  return this.store.invalidList().map(function (x) { return { id: x.id, kind: 'profile', reason: x.reason }; })
    .concat(this.receivers.invalidList().map(function (x) { return { id: x.id, kind: 'receiver', reason: x.reason }; }));
};

/** Profiles -> mapper.json + x10remote.conf, reload mapper and Triggerhappy. Runs one at a time. */
ControllerX10Remote.prototype.apply = function () {
  var self = this;
  var run = self._applyQueue.then(function () { return self._apply(); });
  self._applyQueue = run.catch(function () { /* errors go to the caller */ });
  return run;
};

ControllerX10Remote.prototype._apply = async function () {
  var self = this;
  var profiles = await self.activeProfiles();
  var other = await triggers.readOtherTriggers(C.THD_DIR).catch(function () { return {}; });
  var built = triggers.buildMappings(profiles, self.allowShell(), other, (await self.thdKeys()).pool);
  (self.activeInvalid || []).forEach(function (x) { built.problems.push(x); });
  self.current = { mappings: built.mappings, problems: built.problems, profiles: profiles };
  await self.writeMapperConfig();
  try {
    await self.writeThdConf(triggers.buildThdConf(built.mappings, self.allowShell()));
  } catch (e) {
    // mapper and key test keep running; actions are missing until the file is writable again
    built.problems.push({ code: 'thd_conf' });
  }
  if (self.excl.on) {
    try {
      var raw = await triggers.readOtherRaw(C.THD_DIR);
      await self.writeExclusiveConf(triggers.buildExclusiveConf(built.mappings, profiles, self.allowShell(), raw));
    } catch (e) {
      self.logger.error(C.LOG_PREFIX + 'cannot write exclusive trigger file: ' + e.message);
      built.problems.push({ code: 'excl_conf' });
    }
  }
  if (self.excl.state === 'unavailable') built.problems.push({ code: 'excl_unavailable' });
  if (self.excl.state === 'failed') built.problems.push({ code: 'excl_failed' });
  if (self.excl.state === 'conflict') built.problems.push({ code: 'excl_conflict', other: self.excl.error });
  if (!self.prereq.ok) built.problems.push({ code: 'prereq_missing', other: self.prereq.missing.join(', ') });
  // Does Triggerhappy read the folder with the plugin's file at all? (e.g. another plugin with its own drop-in)
  if (!self.excl.on) {
    var tp = await self.thdTriggersPath();
    self.lastTriggersPath = tp;
    if (tp && tp.replace(/\/+$/, '') !== C.THD_DIR) built.problems.push({ code: 'thd_foreign_triggers', other: tp });
  }
  await self.reloadTriggerhappy();
  await self.reloadMapper();
  if (self.web) self.web.broadcast({ event: 'reload' });
  return built;
};

ControllerX10Remote.prototype.mapperConfig = function () {
  return {
    generated_by: 'x10remote ' + PLUGIN_VERSION,
    debounce_ms: this.numConf('debounce_ms', C.DEFAULT_DEBOUNCE_MS, 0, 2000),
    repeat_ms: this.numConf('repeat_ms', 150, 50, 2000),
    ignore_scancodes: this.ignoreList(),
    log_presses: this.config.get('log_presses') === true,
    event_port: (this.web && this.web.eventPort) || 0,
    capture: this.capture,
    mappings: this.current.mappings.map(function (m) {
      return { id: m.id, label: m.label, device: m.device, type: m.type, code: m.code,
        mode: m.mode, key: m.key, repeat: m.repeat };
    })
  };
};

ControllerX10Remote.prototype.writeMapperConfig = async function () {
  var file = path.join(this.configDir, 'mapper.json');
  var tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(this.mapperConfig(), null, 2) + '\n', { mode: 0o644 });
  await fsp.rename(tmp, file);
};

ControllerX10Remote.prototype.thdConfPath = function () {
  return path.join(C.THD_DIR, C.THD_CONF_NAME);
};

ControllerX10Remote.prototype.thdHeaderOnly = function () {
  return '# Volumio plugin "X10 RF Remote" - currently inactive\n';
};

/** The file is created by install.sh with owner volumio; therefore no sudo is needed. */
ControllerX10Remote.prototype.writeThdConf = async function (content) {
  try {
    await fsp.writeFile(this.thdConfPath(), content);
  } catch (e) {
    this.logger.error(C.LOG_PREFIX + 'cannot write ' + this.thdConfPath() + ' (' + e.code + '). Please reinstall the plugin.');
    throw HttpError(500, 'thd_conf_not_writable');
  }
};

/**
 * Triggerhappy re-reads its files on SIGHUP (triggerhappy.service has no ExecReload - "systemctl
 * reload" always fails). --kill-who=main: the signal only goes to thd itself, not to commands thd is
 * running at the moment. If Triggerhappy is not running, there is nothing to reload.
 * A restart is only needed when exclusive mode is switched (different command line).
 */
ControllerX10Remote.prototype.reloadTriggerhappy = async function () {
  var self = this;
  if (!(await self.thdActive())) return;
  // A SIGHUP ends a process that has no handler for it (yet) - e.g. Triggerhappy right after a restart.
  // Therefore send it only once the main process provably catches SIGHUP (SigCgt in
  // /proc/<pid>/status). Wait up to 3 s; otherwise do not send: after a restart Triggerhappy has read
  // the files freshly anyway.
  for (var i = 0; i < 15; i++) {
    var c = await self.thdCatchesHup();
    if (c === true) {
      await self.systemctl(['kill', '-s', 'HUP', '--kill-who=main', 'triggerhappy.service']).catch(function (e) {
        self.logger.warn(C.LOG_PREFIX + 'triggerhappy reload (SIGHUP) failed: ' + e.message);
      });
      return;
    }
    if (c === null) return;                       // no main process (just ended)
    await self.sleep(200);
  }
  self.logger.warn(C.LOG_PREFIX + 'triggerhappy does not handle SIGHUP - not signalled; changes apply after its next restart');
};

/**
 * Message from the mapper: Triggerhappy has not opened a virtual device (virtual keyboard, passthrough)
 * and it could not be registered with th-cmd either. Triggerhappy opens all input devices when it
 * starts - so restart it. At most once a minute and only between onStart and onStop.
 */
ControllerX10Remote.prototype.onThdDeviceMissing = function (ev) {
  var self = this;
  if (!self.started) return Promise.resolve(false);
  var now = Date.now();
  if (self._thdRestartAt && now - self._thdRestartAt < 60000) return Promise.resolve(false);
  self._thdRestartAt = now;
  self.logger.warn(C.LOG_PREFIX + 'triggerhappy does not read ' + triggers.oneLine(String((ev && ev.path) || '')).slice(0, 60) +
    ' - restarting triggerhappy');
  return self.thdActive().then(function (active) {
    if (!active) return false;
    return self.systemctl(['restart', 'triggerhappy.service']).then(function () { return true; });
  }).catch(function (e) {
    self.logger.error(C.LOG_PREFIX + 'triggerhappy restart failed: ' + e.message);
    return false;
  });
};

/** true/false: the main process of Triggerhappy catches SIGHUP / does not (yet); null: no process. */
ControllerX10Remote.prototype.thdCatchesHup = async function () {
  try {
    var pid = String(await this.exec('/bin/systemctl', ['show', '-p', 'MainPID', '--value', 'triggerhappy.service'])).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) return null;
    var m = /^SigCgt:\s*([0-9a-f]+)\s*$/mi.exec(await fsp.readFile('/proc/' + pid + '/status', 'utf8'));
    if (!m) return null;
    return (parseInt(m[1].slice(-1), 16) & 1) === 1;   // Bit 0 = Signal 1 (SIGHUP)
  } catch (e) {
    return null;
  }
};

ControllerX10Remote.prototype.mapperActive = async function () {
  var out = await this.exec('/bin/systemctl', ['is-active', C.SERVICE]).catch(function (e) { return e.stdout || 'unknown'; });
  return String(out).trim() || 'unknown';
};

ControllerX10Remote.prototype.reloadMapper = async function () {
  if (!this.started || !this.isEnabled()) return;
  if ((await this.mapperActive()) === 'active') {
    await this.systemctl(['reload', C.SERVICE]);
  }
};

// ============================================================ SMB share
/**
 * Establish write permissions in /data/INTERNAL/X10 (folders 0777, files 0666) - through the root
 * service x10remote-fixperms.service, because files created over SMB belong to the guest. Never fatal.
 */
ControllerX10Remote.prototype.fixSharePermissions = async function () {
  var self = this;
  await self.systemctl(['start', C.FIXPERMS_SERVICE]).catch(function (e) {
    self.logger.warn(C.LOG_PREFIX + 'fixperms: ' + e.message + ' (reinstall the plugin?)');
  });
};

// ================================================================== Watchdog
/*
 * x10remote-watchdog.timer checks Triggerhappy and x10mapper every 5 minutes and restarts them if needed.
 * The mapper only if C.MAPPER_WANTED exists (plugin active and mapper switched on).
 * The timer is only started/stopped here - never enabled at boot.
 */
ControllerX10Remote.prototype.watchdogSetting = function () {
  return this.config.get('watchdog') === true;     // default: off
};

ControllerX10Remote.prototype.setMapperWanted = async function (wanted) {
  try {
    if (wanted) await fsp.writeFile(C.MAPPER_WANTED, String(Date.now()) + '\n', { mode: 0o644 });
    else await fsp.unlink(C.MAPPER_WANTED);
  } catch (e) {
    if (e.code !== 'ENOENT') this.logger.warn(C.LOG_PREFIX + 'watchdog flag: ' + e.message);
  }
};

ControllerX10Remote.prototype.updateWatchdog = async function () {
  var self = this;
  await self.setMapperWanted(self.started && self.isEnabled() && self.prereq.ok);
  if (self.started && self.watchdogSetting()) {
    await self.systemctl(['start', C.WATCHDOG_TIMER]).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'watchdog timer not started (reinstall the plugin?): ' + e.message);
    });
  } else {
    await self.systemctl(['stop', C.WATCHDOG_TIMER]).catch(function () { /* ignore */ });
  }
};

ControllerX10Remote.prototype.stopWatchdog = async function () {
  await this.systemctl(['stop', C.WATCHDOG_TIMER]).catch(function () { /* ignore */ });
  await this.setMapperWanted(false);
};

/** Status for display: timer state, last check, last messages. */
ControllerX10Remote.prototype.watchdogStatus = async function () {
  var timer = await this.exec('/bin/systemctl', ['is-active', C.WATCHDOG_TIMER]).catch(function (e) { return e.stdout || 'unknown'; });
  var last = await fsp.readFile(C.WATCHDOG_LAST, 'utf8').catch(function () { return ''; });
  var log = await fsp.readFile(C.WATCHDOG_LOG, 'utf8').catch(function () { return ''; });
  return { timer: String(timer).trim() || 'unknown', last: last.trim(),
    log: log.split('\n').filter(function (l) { return l.trim(); }).slice(-5) };
};

// ============================================================ exclusive mode
/*
 * In exclusive mode Triggerhappy reads only C.EXCL_DIR (the plugin's file including the audio.conf
 * commands taken over). The systemd drop-in is created only when the mode is switched on: the root
 * helper x10remote-thd-exclusive@on creates it as a runtime drop-in in /run/systemd/system (gone after
 * every reboot) - but only if no other drop-in (e.g. of another plugin) already overrides ExecStart.
 * @off removes it again. audio.conf is neither modified nor moved.
 */

ControllerX10Remote.prototype.exclusiveSetting = function () {
  return this.expertMode() && this.config.get('thd_exclusive') === true;
};

ControllerX10Remote.prototype.exclusiveDelay = function () {
  return this.numConf('thd_exclusive_delay', C.EXCL_DELAY_DEFAULT, 0, C.EXCL_DELAY_MAX);
};

/** Helper installed and /run/x10remote writable? */
ControllerX10Remote.prototype.exclusiveAvailable = async function () {
  try {
    await fsp.access(C.EXCL_HELPER, fs.constants.X_OK);
    await fsp.access(C.RUN_DIR, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
};

ControllerX10Remote.prototype.thdActive = async function () {
  var out = await this.exec('/bin/systemctl', ['is-active', 'triggerhappy.service']).catch(function (e) { return e.stdout || ''; });
  return String(out).trim() === 'active';
};

/** Folder/file behind --triggers of the running Triggerhappy (command line of the process), or ''. */
ControllerX10Remote.prototype.thdTriggersPath = async function () {
  try {
    var pid = String(await this.exec('/bin/systemctl', ['show', '-p', 'MainPID', '--value', 'triggerhappy.service'])).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) return '';
    var args = (await fsp.readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\u0000');
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '--triggers' && i + 1 < args.length) return args[i + 1];
      if (args[i].indexOf('--triggers=') === 0) return args[i].slice(11);
    }
    return '';
  } catch (e) {
    return '';
  }
};

/** Does Triggerhappy really run with the plugin's folder? */
ControllerX10Remote.prototype.thdIsExclusive = async function () {
  return (await this.thdTriggersPath()).replace(/\/+$/, '') === C.EXCL_DIR;
};

ControllerX10Remote.prototype.writeExclusiveConf = async function (content) {
  await fsp.mkdir(C.EXCL_DIR, { recursive: true, mode: 0o755 });
  var file = path.join(C.EXCL_DIR, C.THD_CONF_NAME);
  var tmp = file + '.tmp';                       // no .conf extension: Triggerhappy does not read it
  await fsp.writeFile(tmp, content, { mode: 0o644 });
  await fsp.rename(tmp, file);
};

ControllerX10Remote.prototype.sleep = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

ControllerX10Remote.prototype.dropinExists = function () {
  return fsp.access(C.EXCL_DROPIN).then(function () { return true; }, function () { return false; });
};

/**
 * Start exclusive mode. immediate = without waiting time (setting was just switched on).
 * If Triggerhappy already runs exclusively (e.g. after volumio vrestart), only the file is updated.
 */
ControllerX10Remote.prototype.startExclusive = async function (immediate) {
  var self = this;
  if (self.excl.timer) { clearTimeout(self.excl.timer); self.excl.timer = null; }
  if (!self.started || !self.exclusiveSetting()) return self.stopExclusive();
  if (!(await self.exclusiveAvailable())) {
    self.excl.state = 'unavailable';
    self.logger.warn(C.LOG_PREFIX + 'exclusive mode not available (missing ' + C.EXCL_HELPER + ' or ' + C.RUN_DIR + ') - please reinstall the plugin');
    await self.apply();
    return;
  }
  if ((await self.dropinExists()) && await self.thdIsExclusive()) {
    self.excl.on = true;
    self.excl.state = 'on';
    await self.apply();
    self.watchTriggers();
    return;
  }
  self.excl.state = 'waiting';
  var delay = immediate ? 0 : self.exclusiveDelay();
  self.logger.info(C.LOG_PREFIX + 'exclusive mode: switching Triggerhappy in ' + delay + ' s');
  if (delay === 0) return self.enableExclusive();
  self.excl.timer = setTimeout(function () {
    self.excl.timer = null;
    self.enableExclusive().catch(function (e) {
      self.logger.error(C.LOG_PREFIX + 'exclusive mode failed: ' + e.message);
    });
  }, delay * 1000);
};

ControllerX10Remote.prototype.enableExclusive = async function () {
  var self = this;
  // first check whether Triggerhappy has started already (possibly not yet during boot)
  for (var i = 0; i < 20 && !(await self.thdActive()); i++) {
    if (!self.started || !self.exclusiveSetting()) return;
    await self.sleep(3000);
  }
  if (!self.started || !self.exclusiveSetting()) return;
  self.excl.on = true;
  await self.apply();                            // writes the exclusive file
  await fsp.unlink(C.EXCL_RESULT).catch(function () { /* ignore */ });
  var startErr = null;
  await self.systemctl(['start', C.EXCL_UNIT_ON]).catch(function (e) { startErr = e; });
  var result = String(await fsp.readFile(C.EXCL_RESULT, 'utf8').catch(function () { return ''; })).trim();
  await self.sleep(1500);
  if (!startErr && result === 'ok' && await self.thdIsExclusive()) {
    self.excl.state = 'on';
    self.excl.error = '';
    self.logger.info(C.LOG_PREFIX + 'exclusive mode active: Triggerhappy reads only ' + C.EXCL_DIR);
    self.watchTriggers();
  } else {
    var conflict = /^conflict (.+)$/.exec(result);
    self.logger.error(C.LOG_PREFIX + 'exclusive mode not activated (' + (result || (startErr && startErr.message) || 'unknown') + ') - reverting');
    await self.stopExclusive();
    self.excl.state = conflict ? 'conflict' : 'failed';
    self.excl.error = conflict ? conflict[1] : result;
    await self.apply();
  }
  if (self.web) self.web.broadcast({ event: 'reload' });
};

/** End exclusive mode: remove the drop-in, start Triggerhappy normally again (with audio.conf). */
ControllerX10Remote.prototype.stopExclusive = async function () {
  var self = this;
  if (self.excl.timer) { clearTimeout(self.excl.timer); self.excl.timer = null; }
  self.unwatchTriggers();
  var had = await self.dropinExists();
  var wasOn = self.excl.on;
  self.excl.on = false;
  self.excl.state = 'off';
  self.excl.error = '';
  await fsp.unlink(path.join(C.EXCL_DIR, C.THD_CONF_NAME)).catch(function () { /* ignore */ });
  if (had || wasOn) {
    await self.systemctl(['start', C.EXCL_UNIT_OFF]).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'exclusive mode off failed: ' + e.message);
    });
    self.logger.info(C.LOG_PREFIX + 'exclusive mode off: Triggerhappy reads ' + C.THD_DIR + ' again');
  }
};

/**
 * Periodic re-check (every 5 minutes, only between onStart and onStop): another plugin installed later
 * can change how Triggerhappy is started without this plugin learning about it.
 *  - exclusive mode on: if there is now a foreign drop-in with ExecStart=, or Triggerhappy no longer
 *    reads the plugin's folder -> withdraw exclusive mode and report it (never "win").
 *  - normal mode: if the --triggers path has changed -> recompute the notices.
 * Read-only (systemctl show, /proc); a restart of Triggerhappy only happens through stopExclusive().
 */
ControllerX10Remote.prototype.startThdCheck = function () {
  var self = this;
  self.stopThdCheck();
  self.thdCheckTimer = setInterval(function () {
    self.checkThd().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'triggerhappy check: ' + e.message); });
  }, C.THD_CHECK_MS);
  if (self.thdCheckTimer.unref) self.thdCheckTimer.unref();
};

ControllerX10Remote.prototype.stopThdCheck = function () {
  if (this.thdCheckTimer) clearInterval(this.thdCheckTimer);
  this.thdCheckTimer = null;
};

/** Foreign systemd drop-in for triggerhappy.service that sets ExecStart= (path) - or ''. */
ControllerX10Remote.prototype.foreignExecDropin = async function () {
  var out = await this.exec('/bin/systemctl', ['show', '-p', 'DropInPaths', '--value', 'triggerhappy.service']).catch(function () { return ''; });
  var files = String(out).split(/\s+/).filter(function (f) { return f && f !== C.EXCL_DROPIN; });
  for (var i = 0; i < files.length; i++) {
    var text = await fsp.readFile(files[i], 'utf8').catch(function () { return ''; });
    if (/^[ \t]*ExecStart=/m.test(text)) return files[i];
  }
  return '';
};

ControllerX10Remote.prototype.checkThd = async function () {
  var self = this;
  if (!self.started || self._thdChecking) return;
  self._thdChecking = true;
  try {
    if (self.excl.on && self.excl.state === 'on') {
      var foreign = await self.foreignExecDropin();
      var stillExclusive = !(await self.thdActive()) || await self.thdIsExclusive();
      if (foreign || !stillExclusive) {
        self.logger.warn(C.LOG_PREFIX + 'exclusive mode withdrawn: ' + (foreign ? 'foreign drop-in ' + foreign : 'Triggerhappy no longer reads ' + C.EXCL_DIR));
        await self.stopExclusive();
        self.excl.state = foreign ? 'conflict' : 'failed';
        self.excl.error = foreign;
        await self.apply();
        self.toast('warning', self.problemText({ code: foreign ? 'excl_conflict' : 'excl_failed', other: foreign }));
      }
    } else if (!self.excl.on) {
      var tp = await self.thdTriggersPath();
      if (tp !== (self.lastTriggersPath || '') && tp) await self.apply();
    }
  } finally {
    self._thdChecking = false;
  }
};

/** Apply changes to audio.conf & co. at once in exclusive mode. */
ControllerX10Remote.prototype.watchTriggers = function () {
  var self = this;
  if (self.excl.watcher) return;
  try {
    self.excl.watcher = fs.watch(C.THD_DIR, function (ev, name) {
      if (!name || name === C.THD_CONF_NAME || !/\.conf$/.test(String(name))) return;
      if (self.excl.watchTimer) clearTimeout(self.excl.watchTimer);
      self.excl.watchTimer = setTimeout(function () {
        self.excl.watchTimer = null;
        if (!self.excl.on) return;
        self.logger.info(C.LOG_PREFIX + name + ' changed - updating exclusive trigger file');
        self.apply().catch(function (e) { self.logger.error(C.LOG_PREFIX + 'apply: ' + e.message); });
      }, 1000);
    });
    self.excl.watcher.on('error', function () { self.unwatchTriggers(); });
  } catch (e) {
    self.logger.warn(C.LOG_PREFIX + 'cannot watch ' + C.THD_DIR + ': ' + e.message);
  }
};

ControllerX10Remote.prototype.unwatchTriggers = function () {
  if (this.excl.watchTimer) { clearTimeout(this.excl.watchTimer); this.excl.watchTimer = null; }
  if (this.excl.watcher) {
    try { this.excl.watcher.close(); } catch (e) { /* ignore */ }
    this.excl.watcher = null;
  }
};

// ======================================================================== helpers

ControllerX10Remote.prototype.exec = function (file, args, opts) {
  return new Promise(function (resolve, reject) {
    cp.execFile(file, args, { timeout: (opts && opts.timeout) || 30000, maxBuffer: 2 * 1024 * 1024 },
      function (err, stdout, stderr) {
        if (err) {
          err.stdout = String(stdout || '');
          err.message = String(stderr || err.message).trim();
          reject(err);
        } else {
          resolve(String(stdout || ''));
        }
      });
  });
};

ControllerX10Remote.prototype.systemctl = function (args) {
  return this.exec('/usr/bin/sudo', ['/bin/systemctl'].concat(args));
};

ControllerX10Remote.prototype.mapperStatus = function () {
  try {
    var st = JSON.parse(fs.readFileSync(C.MAPPER_STATUS, 'utf8'));
    return st && typeof st === 'object' ? st : null;
  } catch (e) {
    return null;
  }
};

ControllerX10Remote.prototype.toast = function (type, msg) {
  this.commandRouter.pushToastMessage(type, this.t('PLUGIN_NAME'), msg);
};

ControllerX10Remote.prototype.modal = function (title, html) {
  this.commandRouter.broadcastMessage('openModal', {
    title: title,
    message: html,
    size: 'lg',
    buttons: [{ name: this.t('CLOSE'), class: 'btn btn-warning', emit: 'closeModals', payload: '' }]
  });
};

ControllerX10Remote.prototype.refreshUI = function () {
  var self = this;
  try {
    self.commandRouter.getUIConfigOnPlugin(C.PLUGIN_TYPE, C.PLUGIN_NAME, {}).then(function (conf) {
      self.commandRouter.broadcastMessage('pushUiConfig', conf);
    });
  } catch (e) {
    self.logger.warn(C.LOG_PREFIX + 'refreshUI: ' + e.message);
  }
};

ControllerX10Remote.prototype.localIPs = function () {
  var ips = [];
  var ifaces = os.networkInterfaces();
  var rank = function (n) { return /^(eth|en)/.test(n) ? 0 : (/^(wlan|wl)/.test(n) ? 1 : 2); };
  Object.keys(ifaces).sort(function (a, b) { return rank(a) - rank(b); }).forEach(function (name) {
    if (/^(docker|veth|br-|lo)/.test(name)) return;
    (ifaces[name] || []).forEach(function (a) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) ips.push(a.address);
    });
  });
  return ips;
};

ControllerX10Remote.prototype.baseUrls = function () {
  var port = (this.web && this.web.port) || this.webPortSetting();
  var urls = this.localIPs().map(function (ip) { return 'http://' + ip + ':' + port; });
  urls.push('http://' + os.hostname() + '.local:' + port);
  return urls;
};

// ================================================================= web API

/** All keys Triggerhappy recognises (`thd --listevents`) + keys from audio.conf. */
ControllerX10Remote.prototype.thdKeys = async function () {
  var self = this;
  var res = await triggers.listThdKeys(function (file, args) { return self.exec(file, args, { timeout: 10000 }); });
  var other = await triggers.readOtherTriggers(C.THD_DIR).catch(function () { return {}; });
  var keys = res.keys.slice();
  Object.keys(other).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  return { keys: keys, source: res.source, pool: res.pool };
};

ControllerX10Remote.prototype.saveOpts = async function () {
  return { allowShell: this.allowShell(), version: PLUGIN_VERSION, thdKeys: (await this.thdKeys()).keys,
    keyName: this.t('DEFAULT_KEY_NAME') };
};

// All functions return native promises; errors with status/code are answered as JSON.

/**
 * Texts of the web interface. lang = language chosen in the web interface (empty = language of Volumio).
 */
ControllerX10Remote.prototype.webI18n = function (lang) {
  if (!this.i18nEn || this.i18nLang !== this.langCode()) this.loadI18n();
  var self = this;
  var langs = self.languages();
  var use = lang && langs.indexOf(lang) !== -1 ? lang : (langs.indexOf(self.langCode()) !== -1 ? self.langCode() : 'en');
  var out = {};
  Object.keys(self.i18nEn.X10).forEach(function (k) {
    if (k.indexOf('WEB_') === 0 || k.indexOf('ACTION_') === 0 || k.indexOf('ERR_') === 0) out[k] = self.t(k, null, use);
  });
  return { lang: use, volumio_lang: self.langCode(), languages: langs, text: out };
};

ControllerX10Remote.prototype.webInfo = async function () {
  var st = this.mapperStatus();
  var thd = await this.thdKeys();
  return {
    version: PLUGIN_VERSION,
    enabled: this.isEnabled(),
    mapper: await this.mapperActive(),
    problems: (st && st.problems) || [],
    allow_shell: this.allowShell(),
    actions: { scan: C.ACTIONS_SCAN, key: C.ACTIONS_KEY },
    thd_keys: thd.keys,
    thd_keys_source: thd.source,
    virtual_keys: thd.pool,
    pool_size: thd.pool.length,
    image_slots: C.LIMITS.IMAGE_SLOTS,
    thd_mode: this.excl.state,
    capture: this.capture,
    mobile: { enabled: this.mobileEnabled(), port: (this.mobile && this.mobile.port) || null }
  };
};

/** For the key test: all keys of the active profiles with their effect. */
ControllerX10Remote.prototype.webState = async function (lang) {
  lang = this.languages().indexOf(lang) !== -1 ? lang : null;
  var self = this;
  var byId = {};
  self.current.mappings.forEach(function (m) { byId[m.id] = m; });
  var keys = [];
  self.current.profiles.forEach(function (p) {
    (p.keys || []).forEach(function (k) {
      var m = byId[p.id + '/' + k.id];
      var cmd = m ? triggers.commandFor(m, self.allowShell()) : null;
      keys.push({
        id: p.id + '/' + k.id, profile: p.id, profile_name: p.name, label: k.name,
        device: p.device.id, devices: profilesLib.receiversOf(p), type: k.type, code: k.code, source: triggers.sourceText(k),
        mode: m ? m.mode : (k.type === 'key' ? 'default' : 'none'),
        thd_key: k.type === 'scan' ? (k.thd_key || '') : null,
        key_name: k.key_name || null, virtual: m ? !!m.virtual : false,
        shielded: m ? !!m.shielded : false, shown_key: m && m.thd_key ? m.thd_key : null,
        remote_label: k.remote_label || '', description: k.description || '',
        key: m && m.key ? m.key : (k.type === 'key' ? (k.key_name || null) : null),
        action: k.action === 'custom' ? (cmd || self.actionLabel('none', lang))
          : (k.type === 'key' && k.action === 'none' ? self.t('ACTION_NONE_KEY', null, lang) : self.actionLabel(k.action, lang)),
        has_action: !!cmd || (k.type === 'key' && k.action === 'default') || (m && m.mode === 'emit' && !m.virtual)
      });
    });
  });
  var st = self.mapperStatus();
  return { mapper: await self.mapperActive(), keys: keys, problems: self.current.problems,
    mapper_problems: (st && st.problems) || [] };
};

ControllerX10Remote.prototype.webDevices = async function () {
  var st = this.mapperStatus();
  if (!st) return { running: false, devices: [] };
  var open = {};
  (st.open || []).forEach(function (o) { open[o.path] = o; });
  var seen = {};
  var devices = [];
  (st.inputs || []).forEach(function (d) {
    var o = open[d.path];
    var entry = seen[d.id];
    if (!entry) {
      entry = seen[d.id] = { id: d.id, name: d.name, paths: [], grabbed: false };
      devices.push(entry);
    }
    entry.paths.push(d.path);
    if (o && o.grabbed) entry.grabbed = true;
  });
  return { running: true, devices: devices };
};

ControllerX10Remote.prototype.webAudioConf = function () {
  return triggers.readOtherTriggers(C.THD_DIR);
};

// ------------------------------------------------- configure a single key (key test)

function normDevice(dev) {
  var d = String(dev || '');
  if (d.indexOf('name:') !== 0) d = d.toLowerCase();
  if (!/^([0-9a-f]{4}:[0-9a-f]{4}|name:[^\u0000-\u001f]{1,80})$/.test(d)) throw HttpError(400, 'device_invalid');
  return d;
}

function normKey(type, code) {
  if (type !== 'scan' && type !== 'key') throw HttpError(400, 'key_type_invalid');
  var c = typeof code === 'number' ? code : parseInt(String(code), String(code).toLowerCase().indexOf('0x') === 0 ? 16 : 10);
  if (!(Number.isInteger(c) && c >= 0 && c <= (type === 'key' ? 0x2ff : 0xffffffff))) throw HttpError(400, 'key_code_invalid');
  return c;
}

/** Current configuration of a key: profiles, audio.conf, virtual key. */
ControllerX10Remote.prototype.webKeyInfo = async function (q) {
  var self = this;
  var device = normDevice(q.get('device'));
  var type = q.get('type');
  var code = normKey(type, q.get('code'));
  var keyName = /^(KEY|BTN)_[A-Z0-9_]{1,40}$/.test(q.get('key_name') || '') ? q.get('key_name') : null;
  var ids = self.activeIds();
  var list = await self.store.list();
  var entries = [];
  var profiles = [];
  list.forEach(function (p) {
    if (profilesLib.receiversOf(p).indexOf(device) === -1) return;
    var active = ids.indexOf(p.id) !== -1;
    profiles.push({ id: p.id, name: p.name, active: active });
    p.keys.forEach(function (k) {
      if (k.type === type && k.code === code) {
        entries.push({ profile: p.id, profile_name: p.name, active: active, key: k });
        if (!keyName && k.key_name) keyName = k.key_name;
      }
    });
  });
  var mapping = self.current.mappings.filter(function (m) {
    return m.device === device && m.type === type && m.code === code;
  })[0] || null;
  var audio = [];
  if (type === 'key' && keyName) audio = (await triggers.readOtherTriggers(C.THD_DIR))[keyName] || [];
  var st = self.mapperStatus();
  var input = st && (st.inputs || []).filter(function (d) { return d.id === device; })[0];
  return {
    device: device, device_name: (input && input.name) || (list.filter(function (p) { return profilesLib.receiversOf(p).indexOf(device) !== -1; })[0] || { device: {} }).device.name || '',
    type: type, code: code, key_name: keyName, entries: entries, profiles: profiles, audio: audio,
    mapping: mapping ? { profile: mapping.profile, mode: mapping.mode, key: mapping.key, virtual: !!mapping.virtual,
      shielded: !!mapping.shielded, shown_key: mapping.thd_key || null } : null
  };
};

/**
 * Create or change a key in a profile. Without confirm, replacements are reported first
 * (existing assignment, audio.conf command, assignment in another active profile).
 */
ControllerX10Remote.prototype.webConfigureKey = async function (b) {
  var self = this;
  b = b || {};
  var device = normDevice(b.device);
  var type = b.type;
  var code = normKey(type, b.code);
  var allowed = type === 'key' ? C.ACTIONS_KEY : C.ACTIONS_SCAN;
  if (allowed.indexOf(b.action) === -1) throw HttpError(400, 'action_invalid');
  var info = await self.webKeyInfo(new URLSearchParams({ device: device, type: type, code: String(code), key_name: b.key_name || '' }));

  var target = null;
  if (b.profile) {
    target = await self.store.get(String(b.profile));
    if (!target) throw HttpError(404, 'profile_not_found');
    if (profilesLib.receiversOf(target).indexOf(device) === -1) throw HttpError(400, 'device_mismatch');
  }
  var newKey = {
    name: b.name, type: type, code: code, scan: b.scan === undefined ? null : b.scan,
    key_name: info.key_name, action: b.action, command: b.command || '', repeat: b.repeat === true,
    thd_key: type === 'scan' ? (b.thd_key || '') : null,
    remote_label: b.remote_label || '', description: b.description || ''
  };

  var notes = [];
  var existing = target ? target.keys.filter(function (k) { return k.type === type && k.code === code; })[0] : null;
  if (existing && (existing.action !== newKey.action || (existing.command || '') !== String(newKey.command).trim() ||
      (existing.thd_key || '') !== (newKey.thd_key || '') || existing.name !== String(newKey.name || '').trim() ||
      !!existing.repeat !== newKey.repeat || (existing.remote_label || '') !== String(newKey.remote_label).trim() ||
      (existing.description || '') !== String(newKey.description).trim())) {
    notes.push({ code: 'replace_profile', profile: target.name,
      old: { name: existing.name, action: existing.action, command: existing.command || '', thd_key: existing.thd_key || '' } });
  }
  if (type === 'key' && info.audio.length && b.action !== 'default') {
    notes.push({ code: 'replace_audio', commands: info.audio.map(function (a) { return (a.file === 'audio.conf' ? '' : a.file + ': ') + a.command; }) });
  }
  if (type === 'scan' && newKey.thd_key && b.action !== 'none') {
    var dbl = (await triggers.readOtherTriggers(C.THD_DIR))[newKey.thd_key] || [];
    if (dbl.length) {
      notes.push({ code: 'double_audio', key: newKey.thd_key,
        commands: dbl.map(function (a) { return (a.file === 'audio.conf' ? '' : a.file + ': ') + a.command; }) });
    }
  }
  info.entries.forEach(function (e) {
    if (e.active && (!target || e.profile !== target.id) && !(e.key.type === 'key' && e.key.action === 'default')) {
      notes.push({ code: 'conflict', profile: e.profile_name, old: { name: e.key.name, action: e.key.action, command: e.key.command || '', thd_key: e.key.thd_key || '' } });
    }
  });
  if (notes.length && b.confirm !== true) return { needs_confirm: true, notes: notes };

  var saved;
  if (target) {
    var keys = target.keys.map(function (k) {
      return (k.type === type && k.code === code) ? Object.assign({}, newKey, { id: k.id, scan: k.scan }) : k;
    });
    if (!existing) keys.push(newKey);
    saved = await self.store.save({ id: target.id, name: target.name, description: target.description, device: target.device,
      receivers: profilesLib.receiversOf(target), rf433: !!target.rf433, keys: keys },
      await self.saveOpts());
  } else {
    var rec = await self.ensureReceiver(device, info.device_name);
    if (rec && !rec.rf433 && (await self.transmittersOf(device)).length) throw HttpError(409, 'receiver_taken', rec.name);
    saved = await self.store.save({
      name: String(b.new_profile_name || info.device_name || device).slice(0, C.LIMITS.PROFILE_NAME),
      description: '', device: { id: device, name: info.device_name || '' }, keys: [newKey]
    }, await self.saveOpts());
  }
  var ids = self.activeIds();
  if (b.activate === true && ids.indexOf(saved.id) === -1) {
    ids.push(saved.id);
    self.setActiveIds(ids);
  }
  var problems = [];
  if (self.activeIds().indexOf(saved.id) !== -1) {
    problems = (await self.apply()).problems.filter(function (x) { return x.profile === saved.id; });
  }
  self.refreshUI();
  return { ok: true, profile: saved.id, active: self.activeIds().indexOf(saved.id) !== -1, notes: notes, problems: problems };
};

ControllerX10Remote.prototype.webSelect = async function (id) {
  var built = await this.selectProfile(String(id || ''));
  this.refreshUI();
  return { selected: id, problems: built.problems };
};

ControllerX10Remote.prototype.webProfiles = async function (lang) {
  var self = this;
  lang = self.languages().indexOf(lang) !== -1 ? lang : null;
  var ids = this.activeIds();
  var list = await this.userProfiles();
  var recvInfo = {};
  (await this.receivers.list()).forEach(function (r) { recvInfo[r.device.id] = { id: r.id, device: r.device.id, name: r.name, rf433: !!r.rf433 }; });
  return list.map(function (p) {
    return {
      id: p.id, name: p.name, description: self.localizeDescription(p.description, lang), device: p.device,
      receivers: profilesLib.receiversOf(p).map(function (d) { return recvInfo[d] || { device: d, name: d }; }), rf433: !!p.rf433,
      keys: p.keys.length, images: p.images.map(function (x) { return !!x; }),
      active: ids.indexOf(p.id) !== -1, updated: p.updated
    };
  });
};

ControllerX10Remote.prototype.webProfile = async function (id, lang) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  var p = await this.store.get(id);
  if (!p) throw HttpError(404, 'profile_not_found');
  p.description = this.localizeDescription(p.description, this.languages().indexOf(lang) !== -1 ? lang : null);
  var mapped = {};
  this.current.mappings.forEach(function (m) { if (m.profile === id) mapped[m.key_id] = { mode: m.mode, key: m.key, virtual: !!m.virtual,
    shielded: !!m.shielded, shown_key: m.thd_key || null }; });
  return { profile: p, active: this.activeIds().indexOf(id) !== -1, mapped: mapped,
    receivers: await this.receiverChoices(p), duplicates: profilesLib.thdDuplicates(p),
    problems: this.current.problems.filter(function (x) { return x.profile === id; }) };
};

ControllerX10Remote.prototype.webSaveProfile = async function (input, activate) {
  this.assertNotMobile(input && input.id);
  var before = input && input.id ? await this.store.get(String(input.id)).catch(function () { return null; }) : null;
  var opts = await this.saveOpts();
  var logos = this.takeLogoData(input);                                // new station logos (data URL) per key index
  var check = profilesLib.sanitizeProfile(input, before, opts);       // throws on invalid data
  if (check.receivers.indexOf(C.MOBILE_DEVICE) !== -1) throw HttpError(400, 'profile_reserved');
  var willBeActive = activate || (before && this.activeIds().indexOf(before.id) !== -1);
  await this.checkReceiverRules(check.receivers, before ? before.id : null, input && input.device && input.device.name);
  var profile = await this.store.save(input, opts);
  if (logos.length || profile.keys.some(function (k) { return k.radio; })) profile = await this.storeLogos(profile, logos);
  var oldId = null;
  if (before && before.name !== profile.name) {
    // name changed: rename the folder accordingly
    var moved = await this.store.rename(profile.id, profile.name);
    oldId = moved.old_id !== moved.id ? moved.old_id : null;
    this.profileMoved(moved.old_id, moved.id);
    profile = moved;
  }
  var ids = this.activeIds();
  var isActive = ids.indexOf(profile.id) !== -1;
  if (activate && !isActive) {
    ids.push(profile.id);
    this.setActiveIds(ids);
    isActive = true;
  }
  var problems = [];
  if (isActive) {
    var built = await this.apply();
    problems = built.problems.filter(function (x) { return x.profile === profile.id; });
  }
  if (oldId) this.refreshUI();
  return { id: profile.id, old_id: oldId, profile: profile, active: isActive, problems: problems };
};

ControllerX10Remote.prototype.webDeleteProfile = async function (id) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  this.assertNotMobile(id);
  var ids = this.activeIds();
  var wasActive = ids.indexOf(id) !== -1;
  if (wasActive) this.setActiveIds(ids.filter(function (x) { return x !== id; }));
  await this.store.remove(id);
  if (wasActive) await this.apply();
  this.refreshUI();
  return { ok: true };
};

/** After a folder was renamed: switch the active profiles to the new id. */
ControllerX10Remote.prototype.profileMoved = function (oldId, newId) {
  if (!oldId || oldId === newId) return false;
  var ids = this.activeIds();
  var i = ids.indexOf(oldId);
  if (i !== -1) {
    ids[i] = newId;
    this.setActiveIds(ids);
  }
  this.logger.info(C.LOG_PREFIX + 'profile folder ' + oldId + ' renamed to ' + newId);
  return i !== -1;
};

/**
 * Folders in /data/INTERNAL/X10 show their kind in the name (sender-…, receiver-…, template-…). Older
 * folders without prefix - also ones copied in by hand - are renamed at start; active profiles stay active.
 * The Mobile Remote keeps its fixed folder.
 */
ControllerX10Remote.prototype.adoptFolderNames = async function () {
  var self = this;
  await self.migrateReceiverFolders().catch(function () { /* continue with what is there */ });
  (await self.store.adoptPrefix([C.MOBILE_ID])).forEach(function (m) { self.profileMoved(m.old_id, m.id); });
  (await self.receivers.adoptPrefix([])).forEach(function (m) {
    self.logger.info(C.LOG_PREFIX + 'receiver folder ' + m.old_id + ' renamed to ' + m.id);
  });
};

ControllerX10Remote.prototype.webRenameProfile = async function (id, name) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  this.assertNotMobile(id);
  var p = await this.store.rename(id, name);
  this.profileMoved(p.old_id, p.id);
  if (this.activeIds().indexOf(p.id) !== -1) await this.apply();   // id and names are in mapper.json/the thd file
  this.refreshUI();
  return { id: p.id, old_id: p.old_id, name: p.name };
};

ControllerX10Remote.prototype.webDuplicateProfile = async function (id) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  this.assertNotMobile(id);
  var copy = await this.store.duplicate(id);
  this.logger.info(C.LOG_PREFIX + 'profile ' + id + ' duplicated as ' + copy.id);
  this.refreshUI();
  return { id: copy.id, name: copy.name };
};

// ================================================================= Mobile Remote
/*
 * A phone page (own port, lib/mobile.js) with 20 buttons (5 x 4), title/artist/album and volume.
 * The buttons are stored like the keys of a remote: as a profile with the fixed id C.MOBILE_ID and the
 * pseudo device C.MOBILE_DEVICE (scan codes 1..20). So the same validation, the same Triggerhappy
 * choice, built-in actions, custom commands (expert mode only) and radio stations apply.
 * A button press goes plugin -> mapper (Unix socket) -> virtual key -> Triggerhappy -> command; the
 * plugin never executes a command itself. The profile does not appear in the profile list and cannot be
 * changed, renamed, duplicated, deleted or (de)activated there.
 */

ControllerX10Remote.prototype.mobileEnabled = function () {
  return this.config.get('mobile_enabled') === true;
};

ControllerX10Remote.prototype.mobilePortSetting = function () {
  return this.numConf('mobile_port', C.DEFAULT_MOBILE_PORT, 1024, 65535);
};

function isMobile(p) {
  return !!p && (p.id === C.MOBILE_ID || profilesLib.receiversOf(p).indexOf(C.MOBILE_DEVICE) !== -1);
}

ControllerX10Remote.prototype.assertNotMobile = function (id) {
  if (id === C.MOBILE_ID) throw HttpError(400, 'profile_reserved');
};

/** Profiles of the remotes (without the profile of the Mobile Remote). */
ControllerX10Remote.prototype.userProfiles = async function () {
  return (await this.store.list()).filter(function (p) { return !isMobile(p); });
};

ControllerX10Remote.prototype.mobileProfile = async function () {
  var p = await this.store.get(C.MOBILE_ID);
  return p && profilesLib.receiversOf(p).length === 1 && profilesLib.receiversOf(p)[0] === C.MOBILE_DEVICE ? p : null;
};

ControllerX10Remote.prototype.mobileUrls = function () {
  var port = (this.mobile && this.mobile.port) || this.mobilePortSetting();
  var urls = this.localIPs().map(function (ip) { return 'http://' + ip + ':' + port + '/'; });
  urls.push('http://' + os.hostname() + '.local:' + port + '/');
  return urls;
};

/** Configuration page: always all 20 buttons (unassigned ones with action "none"). */
ControllerX10Remote.prototype.webMobile = async function () {
  var self = this;
  var p = await self.mobileProfile();
  var byCode = {};
  (p ? p.keys : []).forEach(function (k) { if (k.type === 'scan') byCode[k.code] = k; });
  var keys = [];
  for (var n = 1; n <= C.MOBILE_BUTTONS; n++) {
    keys.push(byCode[n] || { id: null, name: '', type: 'scan', code: n, scan: n, action: 'none', command: '', thd_key: '',
      repeat: false, remote_label: '', description: '' });
  }
  var mapped = {};
  self.current.mappings.forEach(function (m) { if (m.profile === C.MOBILE_ID) mapped[m.key_id] = { mode: m.mode, key: m.key, virtual: !!m.virtual,
    shielded: !!m.shielded, shown_key: m.thd_key || null }; });
  return {
    graphics: self.mobileGraphics(p),
    id: C.MOBILE_ID, enabled: self.mobileEnabled(), port: self.mobilePortSetting(), running_port: self.mobile.port,
    error: self.mobile.error || '', urls: self.mobileEnabled() ? self.mobileUrls() : [], keys: keys, mapped: mapped,
    mapper: self.isEnabled() && await self.mapperActive(), duplicates: p ? profilesLib.thdDuplicates(p) : [],
    problems: self.current.problems.filter(function (x) { return x.profile === C.MOBILE_ID; })
  };
};

ControllerX10Remote.prototype.webMobileSave = async function (body) {
  var self = this;
  body = body && typeof body === 'object' ? body : {};
  var enabled = body.enabled === true;
  var port = parseInt(body.port, 10);
  if (!(port >= 1024 && port <= 65535)) throw HttpError(400, 'mobile_port_invalid');
  if (port === (self.web.port || self.webPortSetting()) || port === self.eventPortSetting()) throw HttpError(400, 'mobile_port_invalid');
  if (!Array.isArray(body.keys) || body.keys.length > C.MOBILE_BUTTONS) throw HttpError(400, 'keys_invalid');
  var seen = {};
  var keys = [];
  body.keys.forEach(function (k) {
    var code = k && typeof k === 'object' ? parseInt(k.code, 10) : NaN;
    if (!(code >= 1 && code <= C.MOBILE_BUTTONS) || seen[code]) throw HttpError(400, 'keys_invalid');
    seen[code] = true;
    // unassigned buttons are not stored (they would otherwise use up a virtual key)
    if ((!k.action || k.action === 'none') && !k.thd_key) return;
    var copy = Object.assign({}, k, { type: 'scan', code: code, scan: code, key_name: null });
    if (!String(copy.name || '').trim()) copy.name = String(code);
    keys.push(copy);
  });
  var before = await self.store.get(C.MOBILE_ID);
  if (before && !(await self.mobileProfile())) throw HttpError(409, 'mobile_folder_taken');
  var input = { id: before ? C.MOBILE_ID : undefined, name: C.MOBILE_NAME, description: before ? before.description : '',
    device: { id: C.MOBILE_DEVICE, name: C.MOBILE_NAME }, receivers: [C.MOBILE_DEVICE], rf433: false, keys: keys };
  var opts = await self.saveOpts();
  opts.newId = C.MOBILE_ID;
  var logos = self.takeLogoData(input);
  var check = profilesLib.sanitizeProfile(input, before, opts);        // throws on invalid data
  var profile = await self.store.save(input, opts);
  if (profile.id !== C.MOBILE_ID) {                                    // the folder was taken
    await self.store.remove(profile.id).catch(function () { /* ignore */ });
    throw HttpError(409, 'mobile_folder_taken');
  }
  if (logos.length || profile.keys.some(function (k) { return k.radio; })) await self.storeLogos(profile, logos);

  var wasEnabled = self.mobileEnabled();
  var oldPort = self.mobilePortSetting();
  self.config.set('mobile_enabled', enabled);
  self.config.set('mobile_port', port);
  if (self.started) {
    if (!enabled) await self.mobile.stop();
    else if (!wasEnabled || port !== oldPort || !self.mobile.port) await self.mobile.start(port);
  }
  await self.apply();
  self.scheduleCatalog && self.scheduleCatalog();
  return self.webMobile();
};

/*
 * Picture above the volume control: the user can choose one own image file each for light and dark
 * mode (PNG/JPG/WebP, checked by file signature like all pictures). Stored as picture 1 (light) and
 * picture 2 (dark) of the reserved profile. If only one is chosen, it is used for both modes; if none
 * is chosen, the phone page shows the word for "volume" as text. The plugin ships no picture itself.
 */
var MOBILE_GRAPHIC_SLOT = { light: 1, dark: 2 };

/** { light: bool, dark: bool, v: version marker } */
ControllerX10Remote.prototype.mobileGraphics = function (p) {
  var img = (p && p.images) || [];
  return { light: !!img[0], dark: !!img[1], v: p ? String(p.updated || '') : '' };
};

ControllerX10Remote.prototype.mobileGraphicFile = async function (theme) {
  if (!Object.prototype.hasOwnProperty.call(MOBILE_GRAPHIC_SLOT, theme)) return null;
  var p = await this.mobileProfile();
  if (!p) return null;
  var slot = MOBILE_GRAPHIC_SLOT[theme];
  if (!p.images[slot - 1]) slot = slot === 1 ? 2 : 1;       // only one chosen: for both modes
  return this.store.imageFile(C.MOBILE_ID, slot);
};

/** Set the picture (data URL) or remove it with empty data. Creates the reserved profile if needed. */
ControllerX10Remote.prototype.webMobileGraphic = async function (theme, data) {
  var self = this;
  if (typeof theme !== 'string' || !Object.prototype.hasOwnProperty.call(MOBILE_GRAPHIC_SLOT, theme)) throw HttpError(400, 'graphic_invalid');
  var slot = MOBILE_GRAPHIC_SLOT[theme];
  var before = await self.store.get(C.MOBILE_ID);
  if (before && !(await self.mobileProfile())) throw HttpError(409, 'mobile_folder_taken');
  if (!before) {
    if (!data) return { graphics: self.mobileGraphics(null) };
    var opts = await self.saveOpts();
    opts.newId = C.MOBILE_ID;
    var created = await self.store.save({ name: C.MOBILE_NAME, device: { id: C.MOBILE_DEVICE, name: C.MOBILE_NAME },
      receivers: [C.MOBILE_DEVICE], rf433: false, keys: [] }, opts);
    if (created.id !== C.MOBILE_ID) {
      await self.store.remove(created.id).catch(function () { /* ignore */ });
      throw HttpError(409, 'mobile_folder_taken');
    }
  }
  var p = data ? await self.store.setImage(C.MOBILE_ID, slot, data) : await self.store.deleteImage(C.MOBILE_ID, slot);
  return { graphics: self.mobileGraphics(p) };
};

/** State for the phone page: what is playing, volume, labels of the buttons. Nothing else. */
ControllerX10Remote.prototype.mobileState = async function (address) {
  var self = this;
  // address under which the phone reached this device (otherwise the first own address)
  var ip = typeof address === 'string' ? address.replace(/^::ffff:/, '') : '';
  if (!ip || ip === '127.0.0.1' || ip === '::1') ip = self.localIPs()[0] || ip;
  var mp = await self.mobileProfile();
  var gr = self.mobileGraphics(mp);
  var gv = gr.v ? '?v=' + encodeURIComponent(gr.v) : '';
  var st = {};
  try {
    st = await Promise.resolve(self.commandRouter.volumioGetState());
  } catch (e) {
    st = {};
  }
  st = st && typeof st === 'object' ? st : {};
  var text = function (v) { return typeof v === 'string' ? v.slice(0, 200) : ''; };
  var vol = parseInt(st.volume, 10);
  var buttons = [];
  var byCode = {};
  self.current.mappings.forEach(function (m) { if (m.profile === C.MOBILE_ID && m.mode === 'emit') byCode[m.code] = m; });
  for (var n = 1; n <= C.MOBILE_BUTTONS; n++) {
    buttons.push({ n: n, label: byCode[n] ? String(byCode[n].label || n) : String(n), on: !!byCode[n] });
  }
  return {
    host: os.hostname().slice(0, 64), ip: String(ip || '').slice(0, 45),
    graphic: { light: gr.light || gr.dark ? 'graphic-light' + gv : null, dark: gr.light || gr.dark ? 'graphic-dark' + gv : null },
    title: text(st.title), artist: text(st.artist), album: text(st.album), status: text(st.status),
    volume: vol >= 0 && vol <= 100 ? vol : null, mute: st.mute === true,
    buttons: buttons, ready: self.isEnabled(),
    text: { nothing: self.t('MOBILE_NOTHING'), quieter: self.t('MOBILE_QUIETER'), louder: self.t('MOBILE_LOUDER'),
      volume: self.t('MOBILE_VOLUME'), offline: self.t('MOBILE_OFFLINE'), unassigned: self.t('MOBILE_UNASSIGNED'),
      prev: self.t('ACTION_PREV'), pause: self.t('ACTION_PAUSE'), play: self.t('ACTION_PLAY'), next: self.t('ACTION_NEXT') },
    lang: self.langCode()
  };
};

/** Button n (1..20) of the phone page: report it to the mapper, which emits the assigned virtual key. */
ControllerX10Remote.prototype.mobilePress = function (n) {
  var self = this;
  if (typeof n !== 'number' || n !== Math.floor(n) || n < 1 || n > C.MOBILE_BUTTONS) return Promise.reject(HttpError(400, 'button_invalid'));
  if (!self.started) return Promise.reject(HttpError(409, 'mobile_off'));
  return new Promise(function (resolve, reject) {
    var done = false;
    var buf = '';
    var finish = function (err, res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch (e) { /* ignore */ }
      if (err) reject(err); else resolve(res);
    };
    var sock = net.connect(C.INJECT_SOCKET);
    var timer = setTimeout(function () { finish(HttpError(409, 'mapper_off')); }, 1500);
    sock.on('connect', function () { sock.write(JSON.stringify({ inject: n }) + '\n'); });
    sock.on('data', function (d) {
      buf += d.toString('utf8');
      if (buf.length > 512) return finish(HttpError(409, 'mapper_off'));
      if (buf.indexOf('\n') === -1) return;
      var reply = null;
      try { reply = JSON.parse(buf); } catch (e) { /* below */ }
      if (reply && reply.ok === true) return finish(null, { ok: true });
      finish(HttpError(409, reply && reply.error === 'not_assigned' ? 'button_unassigned' : 'mapper_off'));
    });
    sock.on('error', function () { finish(HttpError(409, 'mapper_off')); });
    sock.on('close', function () { finish(HttpError(409, 'mapper_off')); });
  });
};

/**
 * The four fixed buttons below the volume control: Volumio's own commands (like the buttons of the
 * Volumio interface), not through Triggerhappy and not assignable.
 */
var MOBILE_TRANSPORT = { prev: 'volumioPrevious', pause: 'volumioPause', play: 'volumioPlay', next: 'volumioNext' };

ControllerX10Remote.prototype.mobileTransport = async function (action) {
  var self = this;
  if (!self.started) throw HttpError(409, 'mobile_off');
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(MOBILE_TRANSPORT, action)) throw HttpError(400, 'transport_invalid');
  try {
    await Promise.resolve(self.commandRouter[MOBILE_TRANSPORT[action]]());
  } catch (e) {
    self.logger.warn(C.LOG_PREFIX + 'mobile remote: ' + action + ' failed: ' + (e && e.message));
    throw HttpError(409, 'transport_failed');
  }
  return { ok: true };
};

/** Volume through Volumio itself (like the controls of the Volumio interface): { step: '+'|'-' } or { value: 0..100 }. */
ControllerX10Remote.prototype.mobileVolume = async function (body) {
  var self = this;
  if (!self.started) throw HttpError(409, 'mobile_off');
  var arg;
  if (body && (body.step === '+' || body.step === '-')) {
    arg = body.step;
  } else if (body && typeof body.value === 'number' && body.value === Math.floor(body.value) && body.value >= 0 && body.value <= 100) {
    arg = body.value;
  } else {
    throw HttpError(400, 'volume_invalid');
  }
  try {
    await Promise.resolve(self.commandRouter.volumiosetvolume(arg));
  } catch (e) {
    self.logger.warn(C.LOG_PREFIX + 'mobile remote: volume not set: ' + (e && e.message));
    throw HttpError(409, 'volume_failed');
  }
  return { ok: true };
};

// ================================================================= receivers

/** 433 MHz preset for new receivers: X10 radio receivers (vendor 0bc7) work with many transmitters. */
function defaultRf433(deviceId) {
  return /^0bc7:/.test(String(deviceId || ''));
}

ControllerX10Remote.prototype.receiverByDevice = async function (deviceId) {
  return (await this.receivers.list()).filter(function (r) { return r.device.id === deviceId; })[0] || null;
};

/** Return the receiver entry of a USB device, create it if needed (name = device name). */
ControllerX10Remote.prototype.ensureReceiver = async function (deviceId, usbName, rf433) {
  var rec = await this.receiverByDevice(deviceId);
  if (rec) return rec;
  if ((await this.receivers.list()).length >= C.LIMITS.RECEIVERS) throw HttpError(400, 'too_many_receivers', String(C.LIMITS.RECEIVERS));
  var st = this.mapperStatus();
  var input = st && (st.inputs || []).filter(function (d) { return d.id === deviceId; })[0];
  var name = String(usbName || (input && input.name) || deviceId).slice(0, C.LIMITS.PROFILE_NAME);
  rec = await this.receivers.save({ name: name, device: { id: deviceId, name: (input && input.name) || usbName || '' },
    rf433: rf433 === undefined ? defaultRf433(deviceId) : rf433 === true }, { version: PLUGIN_VERSION });
  this.logger.info(C.LOG_PREFIX + 'receiver ' + rec.id + ' created for ' + deviceId);
  return rec;
};

/**
 * 0.57.0 stored receivers under X10/_receivers/<short name>. From 0.58.0 on every receiver lives in exactly
 * one folder directly in X10. Old folders are moved once.
 */
ControllerX10Remote.prototype.migrateReceiverFolders = async function () {
  var self = this;
  var old = path.join(C.PROFILE_DIR, C.RECEIVER_DIR);
  var entries;
  try { entries = await fsp.readdir(old, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    var src = path.join(old, entries[i].name);
    var raw;
    try { raw = JSON.parse(await fsp.readFile(path.join(src, 'receiver.json'), 'utf8')); } catch (e) { continue; }
    var target = await self.receivers._idForName(raw.name || entries[i].name, null);
    await fsp.rename(src, path.join(C.PROFILE_DIR, target));
    self.logger.info(C.LOG_PREFIX + 'receiver folder moved: _receivers/' + entries[i].name + ' -> ' + target);
  }
  try { await fsp.rmdir(old); } catch (e) { self.logger.warn(C.LOG_PREFIX + 'cannot remove ' + old + ': ' + e.message); }
};

/** At start: make sure a receiver entry exists for every device a profile uses. */
ControllerX10Remote.prototype.ensureReceivers = async function () {
  await this.migrateReceiverFolders().catch(function () { /* continue with what is there */ });
  var count = {};
  var names = {};
  (await this.store.list()).forEach(function (p) {
    profilesLib.receiversOf(p).forEach(function (d) {
      if (d === C.MOBILE_DEVICE) return;           // pseudo device of the Mobile Remote: not a receiver
      count[d] = (count[d] || 0) + 1;
      if (!names[d] && p.device && p.device.id === d && p.device.name) names[d] = p.device.name;
    });
  });
  var devices = Object.keys(count);
  for (var i = 0; i < devices.length; i++) {
    var d = devices[i];
    // several transmitters on one receiver existed already: take it over as a 433 MHz receiver
    await this.ensureReceiver(d, names[d], count[d] > 1 || defaultRf433(d));
  }
};

/** Transmitters (profiles) assigned to a receiver. */
ControllerX10Remote.prototype.transmittersOf = async function (deviceId, excludeId) {
  return (await this.store.list()).filter(function (p) {
    return p.id !== excludeId && profilesLib.receiversOf(p).indexOf(deviceId) !== -1;
  });
};

/** A receiver without the 433 MHz mark belongs to exactly one transmitter. */
ControllerX10Remote.prototype.checkReceiverRules = async function (devices, ownId, usbName) {
  for (var i = 0; i < devices.length; i++) {
    var rec = await this.ensureReceiver(devices[i], i === 0 ? usbName : '');
    if (rec.rf433) continue;
    var others = await this.transmittersOf(devices[i], ownId);
    if (others.length) throw HttpError(409, 'receiver_taken', rec.name + ' → ' + others[0].name);
  }
};

/** Selection list for the profile page: all receivers with their assignment. */
ControllerX10Remote.prototype.receiverChoices = async function (p) {
  var self = this;
  var mine = p ? profilesLib.receiversOf(p) : [];
  var all = await self.receivers.list();
  var profiles = await self.store.list();
  var connected = self.connectedDevices();
  return all.map(function (r) {
    var users = profiles.filter(function (x) { return (!p || x.id !== p.id) && profilesLib.receiversOf(x).indexOf(r.device.id) !== -1; })
      .map(function (x) { return x.name; });
    return { id: r.id, device: r.device.id, usb_name: r.device.name, name: r.name, rf433: !!r.rf433,
      assigned: mine.indexOf(r.device.id) !== -1, others: users, connected: connected.indexOf(r.device.id) !== -1,
      image: r.images.map(function (x, i) { return x ? i + 1 : 0; }).filter(Boolean)[0] || 0, updated: r.updated };
  });
};

ControllerX10Remote.prototype.connectedDevices = function () {
  var st = this.mapperStatus();
  var out = [];
  ((st && st.inputs) || []).forEach(function (d) { if (out.indexOf(d.id) === -1) out.push(d.id); });
  return out;
};

ControllerX10Remote.prototype.webReceivers = async function () {
  var profiles = await this.store.list();
  var connected = this.connectedDevices();
  return (await this.receivers.list()).map(function (r) {
    return { id: r.id, name: r.name, description: r.description, device: r.device, rf433: !!r.rf433,
      images: r.images.map(function (x) { return !!x; }), updated: r.updated, connected: connected.indexOf(r.device.id) !== -1,
      transmitters: profiles.filter(function (p) { return profilesLib.receiversOf(p).indexOf(r.device.id) !== -1; })
        .map(function (p) { return { id: p.id, name: p.name }; }) };
  });
};

ControllerX10Remote.prototype.webReceiver = async function (id) {
  if (!this.receivers.idOk(id)) throw HttpError(400, 'receiver_id_invalid');
  var r = await this.receivers.get(id);
  if (!r) throw HttpError(404, 'receiver_not_found');
  var tx = await this.transmittersOf(r.device.id);
  return { receiver: r, connected: this.connectedDevices().indexOf(r.device.id) !== -1,
    transmitters: tx.map(function (p) { return { id: p.id, name: p.name, rf433: !!p.rf433 }; }) };
};

/** Create a receiver (from the device selection) or change it. One entry per USB device. */
ControllerX10Remote.prototype.webSaveReceiver = async function (input) {
  input = input || {};
  var before = null;
  if (input.id) {
    if (!this.receivers.idOk(input.id)) throw HttpError(400, 'receiver_id_invalid');
    before = await this.receivers.get(String(input.id));
    if (!before) throw HttpError(404, 'receiver_not_found');
  } else {
    var dev = profilesLib.normDeviceId(input.device && input.device.id);
    if (!profilesLib.DEVICE_RE.test(dev)) throw HttpError(400, 'device_invalid');
    var exists = await this.receiverByDevice(dev);
    if (exists) { input.id = exists.id; before = exists; }
    else if ((await this.receivers.list()).length >= C.LIMITS.RECEIVERS) throw HttpError(400, 'too_many_receivers', String(C.LIMITS.RECEIVERS));
  }
  var rf433 = input.rf433 === undefined ? (before ? !!before.rf433 : defaultRf433(input.device && input.device.id)) : input.rf433 === true;
  if (before && !rf433) {
    var tx = await this.transmittersOf(before.device.id);
    if (tx.length > 1) throw HttpError(409, 'receiver_has_many', tx.map(function (p) { return p.name; }).join(', '));
  }
  input.rf433 = rf433;
  var rec = await this.receivers.save(input, { version: PLUGIN_VERSION });
  var oldId = null;
  if (before && before.name !== rec.name) {
    var moved = await this.receivers.rename(rec.id, rec.name);
    oldId = moved.old_id !== moved.id ? moved.old_id : null;
    rec = moved;
  }
  return { id: rec.id, old_id: oldId, receiver: rec };
};

ControllerX10Remote.prototype.webDeleteReceiver = async function (id) {
  if (!this.receivers.idOk(id)) throw HttpError(400, 'receiver_id_invalid');
  var r = await this.receivers.get(id);
  if (!r) throw HttpError(404, 'receiver_not_found');
  var tx = await this.transmittersOf(r.device.id);
  if (tx.length) throw HttpError(409, 'receiver_in_use', tx.map(function (p) { return p.name; }).join(', '));
  await this.receivers.remove(id);
  return { ok: true };
};

ControllerX10Remote.prototype.webSetReceiverImage = async function (id, slot, data) {
  var r = await this.receivers.setImage(id, slot, data);
  return { images: r.images };
};

ControllerX10Remote.prototype.webDeleteReceiverImage = async function (id, slot) {
  var r = await this.receivers.deleteImage(id, slot);
  return { images: r.images };
};

/**
 * Triggerhappy keys another key already uses (for information only; choosing a key several times is allowed).
 * Considered: fixed keys of scan-code keys of other profiles that are active or share a receiver with
 * this profile. Keys of the own profile are checked by the interface itself (unsaved).
 */
ControllerX10Remote.prototype.webThdUsed = async function (q) {
  var exclude = String(q.get('exclude') || '');
  var devices = String(q.get('devices') || '').split(',').map(profilesLib.normDeviceId).filter(function (d) { return profilesLib.DEVICE_RE.test(d); });
  var ids = this.activeIds();
  ids = ids.concat([C.MOBILE_ID]);
  var used = {};
  (await this.store.list()).forEach(function (p) {
    if (p.id === exclude) return;
    var shares = profilesLib.receiversOf(p).some(function (d) { return devices.indexOf(d) !== -1; });
    if (!shares && ids.indexOf(p.id) === -1) return;
    p.keys.forEach(function (k) {
      if (k.type === 'scan' && k.thd_key && !used[k.thd_key]) used[k.thd_key] = { profile: p.name, key: k.remote_label || k.name };
    });
  });
  return { used: used };
};

// ================================================================= radio stations

/** Take new logos from the keys (radio.logo_data) - they are stored as files after saving. */
ControllerX10Remote.prototype.takeLogoData = function (input) {
  var out = [];
  ((input && Array.isArray(input.keys)) ? input.keys : []).forEach(function (k, i) {
    if (k && k.radio && typeof k.radio === 'object' && typeof k.radio.logo_data === 'string') {
      out.push({ index: i, data: k.radio.logo_data });
      delete k.radio.logo_data;
    }
  });
  return out;
};

/**
 * Store station logos in the profile folder (logo-<hash>.<ext>, content checked by file signature) and
 * remove logos that are no longer used.
 */
ControllerX10Remote.prototype.storeLogos = async function (profile, logos) {
  var self = this;
  var dir = self.store.dirOf(profile.id);
  var changed = false;
  for (var i = 0; i < logos.length; i++) {
    var k = profile.keys[logos[i].index];
    if (!k || !k.radio) continue;
    if (logos[i].data === '') { k.radio.logo = null; changed = true; continue; }      // logo removed
    var img = profilesLib.decodeImage(logos[i].data, C.LIMITS.RADIO_LOGO_BYTES);
    var file = 'logo-' + require('crypto').createHash('sha1').update(img.buf).digest('hex').slice(0, 12) + '.' + img.ext;
    await fsp.writeFile(path.join(dir, file), img.buf, { mode: C.SHARE_FILE_MODE });
    await fsp.chmod(path.join(dir, file), C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
    k.radio.logo = file;
    changed = true;
  }
  if (changed) profile = await self.store.save(profile, await self.saveOpts());
  var used = profile.keys.map(function (k) { return k.radio && k.radio.logo; }).filter(Boolean);
  var files = await fsp.readdir(dir).catch(function () { return []; });
  for (var f = 0; f < files.length; f++) {
    if (profilesLib.LOGO_RE.test(files[f]) && used.indexOf(files[f]) === -1) await fsp.unlink(path.join(dir, files[f])).catch(function () { /* ignore */ });
  }
  return profile;
};

ControllerX10Remote.prototype.logoFile = async function (profileId, file) {
  if (!profilesLib.ID_RE.test(String(profileId || '')) || !profilesLib.LOGO_RE.test(String(file || ''))) return null;
  var ext = file.split('.').pop();
  return { path: path.join(this.store.dirOf(profileId), file), mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext };
};

/** Rewrite the catalogue of all radio stations (delayed, after changes to profiles). */
ControllerX10Remote.prototype.scheduleCatalog = function () {
  var self = this;
  clearTimeout(self.catalogTimer);
  self.catalogTimer = setTimeout(function () {
    if (!self.started) return;
    self.writeCatalog().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'radio catalog: ' + e.message); });
  }, 300);
};

ControllerX10Remote.prototype.writeCatalog = async function () {
  var cat = radio.buildCatalog(await this.store.list(), this.activeIds(), PLUGIN_VERSION);
  var file = path.join(C.PROFILE_DIR, C.RADIO_CATALOG);
  var text = JSON.stringify(cat, null, 2) + '\n';
  var old = await fsp.readFile(file, 'utf8').catch(function () { return ''; });
  if (old.replace(/"generated": "[^"]*"/, '') === text.replace(/"generated": "[^"]*"/, '')) return cat;
  await this.store._writeJson(file, cat);
  return cat;
};

/** Put radiopresets.txt into /data/INTERNAL/X10 once; freely editable there, never overwritten. */
ControllerX10Remote.prototype.ensureRadioPresets = async function () {
  var target = path.join(C.PROFILE_DIR, C.RADIO_PRESETS);
  var copied = await fsp.copyFile(path.join(__dirname, C.RADIO_PRESETS), target, fs.constants.COPYFILE_EXCL)
    .then(function () { return true; }, function () { return false; });
  if (copied) await fsp.chmod(target, C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
  return copied;
};

ControllerX10Remote.prototype.webRadioPresets = async function () {
  var file = path.join(C.PROFILE_DIR, C.RADIO_PRESETS);
  var text = await fsp.readFile(file, 'utf8').catch(function () { return null; });
  if (text === null) {
    await this.ensureRadioPresets().catch(function () { /* ignore */ });
    text = await fsp.readFile(file, 'utf8').catch(function () { return ''; });
  }
  var parsed = radio.parsePresets(text.slice(0, 512 * 1024));
  return { file: file, stations: parsed.stations, warnings: parsed.warnings };
};

/** Check single station URIs (dialog "Radio station"). */
ControllerX10Remote.prototype.webRadioCheck = async function (uris) {
  var list = [];
  (Array.isArray(uris) ? uris : []).slice(0, C.LIMITS.RADIO_URIS).forEach(function (u) {
    var c = profilesLib.cleanUri(u);
    if (c === null) throw HttpError(400, 'radio_uri_invalid', String(u).slice(0, 80));
    if (c) list.push(c);
  });
  if (!list.length) throw HttpError(400, 'radio_uri_required');
  return { results: await radio.checkMany(list, 3) };
};

function stamp() {
  var d = new Date();
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
}

/** Check all web radio URIs used in profiles and store a text report in /data/INTERNAL/X10. */
ControllerX10Remote.prototype.webRadioCheckAll = async function (lang) {
  var self = this;
  lang = self.languages().indexOf(lang) !== -1 ? lang : self.langCode();
  var t = function (k, v) { return self.t(k, v, lang); };
  var cat = radio.buildCatalog(await self.store.list(), self.activeIds(), PLUGIN_VERSION);
  var uris = [];
  cat.stations.forEach(function (st) { st.uris.forEach(function (u) { if (uris.indexOf(u) === -1) uris.push(u); }); });
  var results = await radio.checkMany(uris, 4);
  var byUri = {};
  results.forEach(function (r) { byUri[r.uri] = r; });
  var okCount = results.filter(function (r) { return r.ok; }).length;
  var lines = [];
  lines.push(t('RADIO_REPORT_TITLE'));
  lines.push('='.repeat(60));
  lines.push(t('RADIO_REPORT_DATE', { date: new Date().toLocaleString(lang) }) + '   ' + 'x10remote ' + PLUGIN_VERSION);
  lines.push(t('RADIO_REPORT_SUMMARY', { stations: cat.stations.length, uris: uris.length, ok: okCount, failed: uris.length - okCount }));
  lines.push('');
  if (!cat.stations.length) lines.push(t('RADIO_REPORT_NONE'));
  var failedStations = 0;
  cat.stations.forEach(function (st) {
    var anyOk = st.uris.some(function (u) { return byUri[u] && byUri[u].ok; });
    if (!anyOk) failedStations++;
    lines.push((anyOk ? '[OK]   ' : '[FAIL] ') + st.name + '   (' + st.profile.name + ' · ' + (st.key.remote_label || st.key.name) + ')');
    st.uris.forEach(function (u, i) {
      var r = byUri[u] || {};
      var detail = r.ok ? ('HTTP ' + r.status + (r.type ? ', ' + r.type : '') + (r.bitrate ? ', ' + r.bitrate + ' kbit/s' : '') + ', ' + r.ms + ' ms')
        : (t('RADIO_REPORT_ERROR') + ': ' + (r.error || '?') + (r.status ? ' (HTTP ' + r.status + ')' : ''));
      lines.push('       ' + (i + 1) + '. ' + (r.ok ? 'ok' : t('RADIO_REPORT_FAIL_SHORT')).padEnd(8) + u);
      lines.push('          ' + detail + (r.final_uri && r.final_uri !== u ? ' → ' + r.final_uri : ''));
    });
    lines.push('');
  });
  lines.push(t('RADIO_REPORT_FOOT', { n: failedStations }));
  var text = lines.join('\r\n') + '\r\n';
  var file = path.join(C.PROFILE_DIR, C.RADIO_REPORT_PREFIX + stamp() + '.txt');
  await fsp.writeFile(file, text, { mode: C.SHARE_FILE_MODE });
  await fsp.chmod(file, C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
  self.logger.info(C.LOG_PREFIX + 'webradio check: ' + okCount + '/' + uris.length + ' reachable, report ' + file);
  return { file: file, text: text, stations: cat.stations.length, uris: uris.length, ok: okCount, failed_stations: failedStations };
};

/**
 * Add the stations of a profile to Volumio's "My Web Radios" - through Volumio's own function
 * addToMyWebRadio (correct format, also with the MyVolumio cloud). The file is backed up first.
 * Same name with a different URI: additional entry "Name (X10)". Same URI: skipped.
 */
ControllerX10Remote.prototype.webRadioFavourites = async function (id) {
  var self = this;
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  var p = await self.store.get(id);
  if (!p) throw HttpError(404, 'profile_not_found');
  var plm = self.commandRouter && self.commandRouter.playListManager;
  if (!plm || typeof plm.addToMyWebRadio !== 'function' || typeof plm.getMyWebRadioContent !== 'function') {
    throw HttpError(409, 'favourites_unavailable');
  }
  var stations = p.keys.filter(function (k) { return k.action === 'radio' && k.radio; }).map(function (k) { return k.radio; });
  if (!stations.length) throw HttpError(400, 'no_radio_keys');
  var current = await Promise.resolve(plm.getMyWebRadioContent()).catch(function () { return null; });
  if (!Array.isArray(current)) current = [];
  // backup
  var backup = null;
  var raw = await fsp.readFile(C.FAVOURITES_FILE).catch(function () { return null; });
  if (raw) {
    var bdir = path.join(C.PROFILE_DIR, C.RADIO_BACKUP_DIR);
    await profilesLib.mkdirShared(bdir);
    backup = path.join(bdir, 'my-web-radio-' + stamp() + '.json');
    await fsp.writeFile(backup, raw, { mode: C.SHARE_FILE_MODE });
    await fsp.chmod(backup, C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
  }
  var report = { added: [], skipped: [], renamed: [], backup: backup };
  var names = current.map(function (e) { return String(e.name); });
  var uris = current.map(function (e) { return String(e.uri); });
  for (var i = 0; i < stations.length; i++) {
    var st = stations[i];
    var uri = st.uris[0];
    var uIdx = uris.indexOf(uri);
    if (uIdx !== -1) { report.skipped.push({ name: st.name, uri: uri, as: names[uIdx] }); continue; }
    var name = st.name;
    if (names.indexOf(name) !== -1) {
      name = st.name + ' (X10)';
      for (var n = 2; names.indexOf(name) !== -1 && n < 100; n++) name = st.name + ' (X10 ' + n + ')';
      report.renamed.push({ name: st.name, as: name, uri: uri });
    } else {
      report.added.push({ name: name, uri: uri });
    }
    await Promise.resolve(plm.addToMyWebRadio('webradio', name, uri));
    names.push(name);
    uris.push(uri);
  }
  self.logger.info(C.LOG_PREFIX + 'my-web-radio: ' + (report.added.length + report.renamed.length) + ' added, ' + report.skipped.length + ' skipped');
  return report;
};

// ================================================================= templates

/** Text of a template in the requested language ({de, en, ...} or plain text). */
// ------------------------------------------------------------------ templates
// Shipped: <plugin>/templates/template-<short name>/template.json (+ pictures).
// Own ("Save as template"): /data/INTERNAL/X10/template-<short name>/ - same layout; an own template
// with the same id takes precedence. Own templates live on the share and count as unchecked like every
// file there: when a profile is created their texts pass the same validation as a saved profile.
var TEMPLATE_ID_RE = /^template-[a-z0-9][a-z0-9-]{0,55}$/;
var TPL_IMAGE_RE = /^image[1-6]\.(jpg|png|webp)$/;
var TPL_RIMAGE_RE = /^receiver(10|[1-9])-image[1-6]\.(jpg|png|webp)$/;
var TPL_MAX_BYTES = 512 * 1024;

function presetText(v, lang) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  return String(v[lang] || v.en || v.de || v[Object.keys(v)[0]] || '');
}

ControllerX10Remote.prototype.templateDir = function (id, user) {
  if (!TEMPLATE_ID_RE.test(String(id || ''))) throw HttpError(400, 'preset_id_invalid');
  return user ? path.join(C.PROFILE_DIR, id) : path.join(__dirname, C.TEMPLATE_DIR, id);
};

/** Read a template: the own one first, then the shipped one. Returns it with id, user, dir - or null. */
ControllerX10Remote.prototype.readTemplate = async function (id) {
  var self = this;
  for (var u = 0; u < 2; u++) {
    var dir = self.templateDir(id, u === 0);
    try {
      var file = path.join(dir, C.TEMPLATE_FILE);
      if ((await fsp.stat(file)).size > TPL_MAX_BYTES) throw new Error('too large');
      var raw = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.keys) || !Array.isArray(raw.receivers)) continue;
      raw.id = id;
      raw.user = u === 0;
      raw.dir = dir;
      raw.kind = raw.kind === 'mobile' ? 'mobile' : 'sender';
      return raw;
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') self.logger.warn(C.LOG_PREFIX + 'template ' + id + ' unreadable: ' + e.message);
    }
  }
  return null;
};

ControllerX10Remote.prototype.templateIds = async function () {
  var ids = {};
  var dirs = [C.PROFILE_DIR, path.join(__dirname, C.TEMPLATE_DIR)];
  for (var i = 0; i < dirs.length; i++) {
    try {
      (await fsp.readdir(dirs[i], { withFileTypes: true })).forEach(function (d) {
        if (d.isDirectory() && TEMPLATE_ID_RE.test(d.name)) ids[d.name] = true;
      });
    } catch (e) { /* folder missing */ }
  }
  return Object.keys(ids).sort();
};

/** Pictures of the templates for /pimg/<id>/<n> (only file names image1..6 in the template's folder). */
ControllerX10Remote.prototype.templateImages = function () {
  var self = this;
  return {
    imageFile: async function (id, slot) {
      var p = await self.readTemplate(id);
      var file = p && Array.isArray(p.images) ? p.images[parseInt(slot, 10) - 1] : null;
      if (typeof file !== 'string' || !TPL_IMAGE_RE.test(file)) return null;
      var ext = file.split('.').pop();
      return { path: path.join(p.dir, file), mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext };
    }
  };
};

function templateReceivers(p) {
  return p.receivers.filter(function (r) { return r && typeof r === 'object'; }).slice(0, C.LIMITS.RECEIVERS_PER_PROFILE);
}

ControllerX10Remote.prototype.webTemplates = async function (lang) {
  lang = this.languages().indexOf(lang) !== -1 ? lang : this.langCode();
  var ids = await this.templateIds();
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var p = await this.readTemplate(ids[i]);
    if (!p) continue;
    out.push({
      id: p.id, user: p.user, kind: p.kind,
      name: presetText(p.name, lang).slice(0, C.LIMITS.PROFILE_NAME), description: presetText(p.description, lang).slice(0, C.LIMITS.DESCRIPTION),
      rf433: p.rf433 === true,
      receivers: templateReceivers(p).map(function (r) {
        return { device: String(r.device || '').slice(0, 100), name: presetText(r.name, lang).slice(0, C.LIMITS.PROFILE_NAME), rf433: r.rf433 === true };
      }),
      keys: p.keys.length, images: (Array.isArray(p.images) ? p.images : []).slice(0, C.LIMITS.IMAGE_SLOTS).map(function (x) { return typeof x === 'string' && TPL_IMAGE_RE.test(x); })
    });
  }
  return out;
};

/**
 * Keys of a template as input for a profile: texts in the requested language, labels unchanged.
 * Custom commands are only taken over if they are allowed (otherwise the key gets no command).
 * withLogos: pass station logos from the template folder as data URLs (they are checked on saving).
 */
ControllerX10Remote.prototype.templateKeys = async function (p, lang, withLogos) {
  var self = this;
  var allowShell = self.allowShell();
  var skipped = 0;
  var keys = [];
  var list = p.keys.filter(function (k) { return k && typeof k === 'object'; }).slice(0, C.LIMITS.KEYS_PER_PROFILE);
  for (var i = 0; i < list.length; i++) {
    var k = list[i];
    var key = { type: k.type, code: k.code, scan: k.scan, key_name: k.key_name, action: k.action, command: k.command || '',
      thd_key: k.thd_key, repeat: k.repeat === true, name: presetText(k.name, lang), description: presetText(k.description, lang),
      remote_label: typeof k.remote_label === 'string' ? k.remote_label : '' };      // label: never translated
    if (key.action === 'custom' && !allowShell) { key.action = 'none'; key.command = ''; skipped++; }
    if (k.radio && typeof k.radio === 'object') {
      key.radio = { name: k.radio.name, uris: k.radio.uris, quality: k.radio.quality, format: k.radio.format, logo: null };
      if (withLogos && typeof k.radio.logo === 'string' && profilesLib.LOGO_RE.test(k.radio.logo)) {
        try {
          var buf = await fsp.readFile(path.join(p.dir, k.radio.logo));
          var ext = k.radio.logo.split('.').pop();
          if (buf.length <= C.LIMITS.RADIO_LOGO_BYTES) key.radio.logo_data = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + buf.toString('base64');
        } catch (e) { /* without logo */ }
      }
    }
    keys.push(key);
  }
  return { keys: keys, skipped: skipped };
};

/** One template for the page "Mobile Remote" (buttons to load into the table, nothing saved yet). */
ControllerX10Remote.prototype.webTemplate = async function (id, lang) {
  lang = this.languages().indexOf(lang) !== -1 ? lang : this.langCode();
  var p = await this.readTemplate(id);
  if (!p) throw HttpError(404, 'preset_not_found');
  var res = await this.templateKeys(p, lang, false);
  return { id: p.id, user: p.user, kind: p.kind, name: presetText(p.name, lang).slice(0, C.LIMITS.PROFILE_NAME), keys: res.keys, skipped_custom: res.skipped };
};

/** Create a profile from a template: texts in Volumio's language, labels unchanged, pictures copied. */
ControllerX10Remote.prototype.webCreateFromTemplate = async function (id, activate) {
  var self = this;
  var lang = self.langCode();
  var p = await self.readTemplate(id);
  if (!p) throw HttpError(404, 'preset_not_found');
  if (p.kind === 'mobile') throw HttpError(400, 'template_is_mobile');
  var recs = templateReceivers(p);
  if (!recs.length) throw HttpError(400, 'template_invalid');
  var devices = [];
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var dev = profilesLib.normDeviceId(r.device);
    if (!profilesLib.DEVICE_RE.test(dev) || dev === C.MOBILE_DEVICE) throw HttpError(400, 'template_invalid');
    var had = await self.receiverByDevice(dev);
    var rec = await self.ensureReceiver(dev, presetText(r.name, lang) || presetText(r.usb_name, lang), r.rf433 === true);
    if (!had) await self.fillReceiverFromTemplate(rec, r, i, p, lang);     // existing receivers stay unchanged
    devices.push(dev);
  }
  var tk = await self.templateKeys(p, lang, true);
  var input = {
    name: presetText(p.name, lang),
    description: presetText(p.description, lang),
    notes: presetText(p.notes, lang),
    rf433: p.rf433 === true,
    device: { id: devices[0], name: presetText(recs[0].usb_name || recs[0].name, lang) },
    receivers: p.rf433 === true ? devices : devices.slice(0, 1),
    keys: tk.keys
  };
  var res = await self.webSaveProfile(input, activate);
  var images = Array.isArray(p.images) ? p.images : [];
  for (var n = 0; n < images.length && n < C.LIMITS.IMAGE_SLOTS; n++) {
    if (typeof images[n] !== 'string' || !TPL_IMAGE_RE.test(images[n]) || images[n].charAt(5) !== String(n + 1)) continue;
    await self.store.setImageFile(res.id, n + 1, path.join(p.dir, images[n])).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'template image ' + images[n] + ': ' + e.message);
    });
  }
  self.refreshUI();
  return { id: res.id, active: res.active, problems: res.problems, skipped_custom: tk.skipped };
};

/** Newly created receiver: description, notes, USB name and pictures from the template. */
ControllerX10Remote.prototype.fillReceiverFromTemplate = async function (rec, r, index, p, lang) {
  var self = this;
  try {
    await self.receivers.save({ id: rec.id, name: rec.name, description: presetText(r.description, lang), notes: presetText(r.notes, lang),
      device: { id: rec.device.id, name: presetText(r.usb_name, lang) || rec.device.name }, rf433: rec.rf433 }, { version: PLUGIN_VERSION });
    var images = Array.isArray(r.images) ? r.images : [];
    for (var n = 0; n < images.length && n < C.LIMITS.IMAGE_SLOTS; n++) {
      var f = images[n];
      if (typeof f !== 'string' || !TPL_RIMAGE_RE.test(f) || f.indexOf('receiver' + (index + 1) + '-image' + (n + 1) + '.') !== 0) continue;
      await self.receivers.setImageFile(rec.id, n + 1, path.join(p.dir, f));
    }
  } catch (e) {
    self.logger.warn(C.LOG_PREFIX + 'receiver data from template ' + p.id + ': ' + e.message);
  }
};

/**
 * Save a profile (or the assignment of the Mobile Remote) as template:
 * /data/INTERNAL/X10/template-<short name>/template.json + pictures of the profile, station logos and
 * pictures of the assigned receivers. An existing own template of the same profile is replaced.
 */
ControllerX10Remote.prototype.webSaveTemplate = async function (id) {
  var self = this;
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  var p = await self.store.get(id);
  if (!p) throw HttpError(404, 'profile_not_found');
  var mobile = id === C.MOBILE_ID;
  var short = id.indexOf(C.SENDER_PREFIX) === 0 ? id.slice(C.SENDER_PREFIX.length) : id;
  var tid = C.TEMPLATE_PREFIX + short;
  if (!TEMPLATE_ID_RE.test(tid)) throw HttpError(400, 'profile_id_invalid');
  var dir = path.join(C.PROFILE_DIR, tid);
  // The target folder is replaced - but only if it is a template (never a profile, a receiver or anything foreign)
  var existing = await fsp.readdir(dir).catch(function () { return null; });
  if (existing && existing.length && existing.indexOf(C.TEMPLATE_FILE) === -1) throw HttpError(409, 'template_conflict', tid);
  if (existing && (existing.indexOf('profile.json') !== -1 || existing.indexOf('receiver.json') !== -1)) throw HttpError(409, 'template_conflict', tid);
  var tmp = path.join(C.PROFILE_DIR, '.' + tid + '.tmp-' + process.pid);
  await fsp.rm(tmp, { recursive: true, force: true });
  await profilesLib.mkdirShared(tmp);
  try {
    var copy = async function (from, name) {
      try { await fsp.copyFile(from, path.join(tmp, name)); return name; } catch (e) { return null; }
    };
    var tpl = {
      format: 1, kind: mobile ? 'mobile' : 'sender',
      name: p.name, description: p.description || '', notes: p.notes || '', rf433: p.rf433 === true,
      receivers: [], images: new Array(C.LIMITS.IMAGE_SLOTS).fill(null), keys: [],
      source: 'profile ' + id + ', ' + new Date().toISOString().slice(0, 10) + ', plugin ' + PLUGIN_VERSION
    };
    if (!mobile) {
      // Pictures of the Mobile Remote are the own picture of the phone page - they do not belong in a template
      for (var n = 0; n < C.LIMITS.IMAGE_SLOTS; n++) {
        var f = p.images[n];
        if (f && TPL_IMAGE_RE.test(f)) tpl.images[n] = await copy(path.join(self.store.dirOf(id), f), f);
      }
      var devices = profilesLib.receiversOf(p).filter(function (d) { return d !== C.MOBILE_DEVICE; });
      for (var i = 0; i < devices.length; i++) {
        var rec = await self.receiverByDevice(devices[i]);
        var entry = { device: devices[i], name: rec ? rec.name : (p.device && p.device.name) || devices[i],
          usb_name: rec ? rec.device.name : (p.device && p.device.name) || '', description: rec ? rec.description : '',
          notes: rec ? rec.notes : '', rf433: rec ? rec.rf433 === true : p.rf433 === true, images: new Array(C.LIMITS.IMAGE_SLOTS).fill(null) };
        for (var m = 0; rec && m < C.LIMITS.IMAGE_SLOTS; m++) {
          var rf = rec.images[m];
          if (rf && TPL_IMAGE_RE.test(rf)) {
            entry.images[m] = await copy(path.join(self.receivers.dirOf(rec.id), rf), 'receiver' + (i + 1) + '-image' + (m + 1) + '.' + rf.split('.').pop());
          }
        }
        tpl.receivers.push(entry);
      }
    }
    for (var k = 0; k < p.keys.length; k++) {
      var key = Object.assign({}, p.keys[k]);
      delete key.id;
      if (key.radio) {
        key.radio = Object.assign({}, key.radio);
        if (key.radio.logo && profilesLib.LOGO_RE.test(key.radio.logo)) {
          key.radio.logo = await copy(path.join(self.store.dirOf(id), key.radio.logo), key.radio.logo);
        } else {
          key.radio.logo = null;
        }
      }
      tpl.keys.push(key);
    }
    await self.store._writeJson(path.join(tmp, C.TEMPLATE_FILE), tpl);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(tmp, dir);
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(function () { /* ignore */ });
    throw e;
  }
  await self.fixSharePermissions().catch(function () { /* only permissions for the file explorer */ });
  self.logger.info(C.LOG_PREFIX + 'profile ' + id + ' saved as template ' + tid);
  return { id: tid, folder: tid, name: p.name, kind: tpl.kind };
};

/** Delete an own template (shipped ones cannot be deleted). */
ControllerX10Remote.prototype.webDeleteTemplate = async function (id) {
  var dir = this.templateDir(id, true);
  var files = await fsp.readdir(dir).catch(function () { return null; });
  if (!files) throw HttpError((await this.readTemplate(id)) ? 400 : 404, (await this.readTemplate(id)) ? 'template_builtin' : 'preset_not_found');
  if (files.indexOf(C.TEMPLATE_FILE) === -1 || files.indexOf('profile.json') !== -1 || files.indexOf('receiver.json') !== -1) {
    throw HttpError(409, 'template_conflict', id);
  }
  await fsp.rm(dir, { recursive: true, force: true });
  this.logger.info(C.LOG_PREFIX + 'template ' + id + ' deleted');
  return { ok: true };
};

/**
 * Print/copy list of a profile: per key label, description, actual command, signal (scan code / KEY_*)
 * and Triggerhappy key. For inactive profiles the assignment is computed as if only this profile were
 * active.
 */
ControllerX10Remote.prototype.webPrintProfile = async function (id, lang) {
  lang = this.languages().indexOf(lang) !== -1 ? lang : null;
  var self = this;
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  var p = await self.store.get(id);
  if (!p) throw HttpError(404, 'profile_not_found');
  var active = self.activeIds().indexOf(id) !== -1;
  var other = await triggers.readOtherTriggers(C.THD_DIR).catch(function () { return {}; });
  var mappings = active ? self.current.mappings.filter(function (m) { return m.profile === id; })
    : triggers.buildMappings([p], self.allowShell(), other, (await self.thdKeys()).pool).mappings;
  var byKey = {};
  mappings.forEach(function (m) { byKey[m.key_id] = m; });
  var audio = function (key) {
    var list = other[key] || [];
    var press = list.filter(function (x) { return x.value === 1; });
    return (press.length ? press : list).map(function (x) { return x.command; })
      .filter(function (c, i, arr) { return arr.indexOf(c) === i; });
  };
  var rows = p.keys.map(function (k) {
    var m = byKey[k.id];
    var cmd = m ? triggers.commandFor(m, self.allowShell()) : null;
    var command;
    var source = 'plugin';
    var thdKey = m && m.key ? (m.thd_key || m.key) : (k.type === 'key' ? k.key_name : null);
    if (m && m.mode === 'swallow') {
      command = self.t('ACTION_NONE_KEY', null, lang);
      source = 'locked';
    } else if (cmd) {
      command = cmd;
    } else if (k.action === 'custom' && !self.allowShell()) {
      command = k.command + '  (' + self.t('PRINT_SHELL_OFF', null, lang) + ')';
      source = 'disabled';
    } else {
      var a = thdKey ? audio(thdKey) : [];
      command = a.length ? a.join(' ; ') : '–';
      source = a.length ? 'audio' : 'none';
    }
    var signal = k.type === 'scan' ? 'Scan ' + triggers.hex(k.code)
      : (k.key_name || 'Key ' + k.code) + (k.scan !== null && k.scan !== undefined ? ' (Scan ' + triggers.hex(k.scan) + ')' : '');
    return {
      name: k.name, remote_label: k.remote_label || '', description: k.description || '',
      action: k.action === 'custom' ? self.t('ACTION_CUSTOM', null, lang) : (k.type === 'key' && k.action === 'none' ? self.t('ACTION_NONE_KEY', null, lang) : self.actionLabel(k.action, lang)),
      command: command, source: source, signal: signal,
      thd_key: thdKey || '–', internal: m && m.shielded ? m.key : null
    };
  });
  return { id: p.id, name: p.name, description: self.localizeDescription(p.description || '', lang), device: p.device, active: active,
    version: PLUGIN_VERSION, rows: rows };
};

/*
 * Command reference: /data/INTERNAL/X10/command reference.txt (the user may extend it).
 * Templates per language in the plugin: command_reference_<language>.txt (English as fallback).
 * As long as the file is identical to a template, it is shown in the chosen language and adapted to
 * Volumio's language at start; a file the user changed is never touched.
 */
ControllerX10Remote.prototype.cmdRefTemplate = function (lang) {
  var file = path.join(__dirname, C.CMDREF_TEMPLATE.replace('{lang}', lang));
  if (/^[a-z]{2}$/.test(String(lang)) && fs.existsSync(file)) return file;
  return path.join(__dirname, C.CMDREF_TEMPLATE.replace('{lang}', 'en'));
};

function sha256(buf) {
  return require('crypto').createHash('sha256').update(buf).digest('hex');
}

/** Hashes of all known, unmodified templates (earlier versions + all current languages). */
ControllerX10Remote.prototype.cmdRefTemplateHashes = function () {
  var self = this;
  if (self._cmdRefHashes) return self._cmdRefHashes;
  var hashes = [];
  self.languages().forEach(function (l) {
    try { hashes.push(sha256(fs.readFileSync(self.cmdRefTemplate(l)))); } catch (e) { /* ignore */ }
  });
  self._cmdRefHashes = hashes;
  return hashes;
};

ControllerX10Remote.prototype.readLimited = async function (file) {
  var st = await fsp.stat(file);
  if (!st.isFile()) throw new Error('not a file');
  var fh = await fsp.open(file, 'r');
  try {
    var buf = Buffer.alloc(Math.min(st.size, C.CMDREF_MAX_BYTES));
    await fh.read(buf, 0, buf.length, 0);
    return { buf: buf, truncated: st.size > C.CMDREF_MAX_BYTES };
  } finally {
    await fh.close();
  }
};

ControllerX10Remote.prototype.webCommandRef = async function (lang) {
  var self = this;
  lang = self.languages().indexOf(lang) !== -1 ? lang : self.langCode();
  var target = path.join(C.PROFILE_DIR, C.CMDREF_NAME);
  var user = null;
  try { user = await self.readLimited(target); } catch (e) { user = null; }
  if (user && self.cmdRefTemplateHashes().indexOf(sha256(user.buf)) === -1) {
    return { file: target, text: user.buf.toString('utf8').replace(/\u0000/g, ''), truncated: user.truncated, edited: true };
  }
  try {
    var tpl = await self.readLimited(self.cmdRefTemplate(lang));
    return { file: target, text: tpl.buf.toString('utf8'), truncated: false, edited: false };
  } catch (e) {
    throw HttpError(404, 'cmdref_missing');
  }
};

/**
 * Create the command reference in /data/INTERNAL/X10 (language of Volumio). An existing file is only
 * replaced if it is byte-identical to a template (i.e. was never changed by the user) - e.g. after a
 * language change or a new template.
 */
ControllerX10Remote.prototype.ensureCommandRef = async function () {
  var self = this;
  var target = path.join(C.PROFILE_DIR, C.CMDREF_NAME);
  var source = self.cmdRefTemplate(self.langCode());
  var copied = await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL).then(function () { return true; }, function () { return false; });
  if (copied) {
    await fsp.chmod(target, C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
    return 'created';
  }
  try {
    var hash = sha256(await fsp.readFile(target));
    if (self.cmdRefTemplateHashes().indexOf(hash) === -1) return 'kept';
    if (hash === sha256(await fsp.readFile(source))) return 'current';
    var tmp = target + '.tmp';
    await fsp.copyFile(source, tmp);
    await fsp.chmod(tmp, C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
    await fsp.rename(tmp, target);
    self.logger.info(C.LOG_PREFIX + 'command reference updated (template ' + path.basename(source) + ')');
    return 'updated';
  } catch (e) {
    return 'kept';
  }
};

ControllerX10Remote.prototype.webActivate = async function (id, active) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  this.assertNotMobile(id);
  var prof = await this.store.get(id);
  if (!prof) throw HttpError(404, 'profile_not_found');
  var ids = this.activeIds().filter(function (x) { return x !== id; });
  if (active) ids.push(id);
  this.setActiveIds(ids);
  var built = await this.apply();
  this.refreshUI();
  return { active: active, problems: built.problems.filter(function (x) { return x.profile === id; }) };
};

ControllerX10Remote.prototype.webSetImage = async function (id, slot, data) {
  var p = await this.store.setImage(id, slot, data);
  return { images: p.images };
};

ControllerX10Remote.prototype.webDeleteImage = async function (id, slot) {
  var p = await this.store.deleteImage(id, slot);
  return { images: p.images };
};

/** Capture for the wizard: identify = observe all devices, start = read in one device exclusively. */
ControllerX10Remote.prototype.webCapture = async function (mode, device) {
  var self = this;
  var now = Date.now() / 1000;
  if (mode === 'stop') {
    if (self.capture) {
      self.clearCapture();
      await self.writeMapperConfig();
      await self.reloadMapper();
    }
    return { capture: null };
  }
  if (!self.isEnabled() || (await self.mapperActive()) !== 'active') throw HttpError(409, 'mapper_not_running');
  if (mode === 'identify') {
    // Detecting: the mapper reads only remote-like devices exclusively (so their power key triggers
    // nothing). Keyboards are only observed, mice and touchscreens not at all - a kiosk display stays
    // usable. The user has to confirm the device in the wizard (same key twice).
    self.setCapture({ device: '*', grab: true, until: now + C.LIMITS.IDENTIFY_SECONDS });
  } else if (mode === 'start') {
    var dev = String(device || '');
    if (dev.indexOf('name:') !== 0) dev = dev.toLowerCase();
    if (!/^([0-9a-f]{4}:[0-9a-f]{4}|name:[^\u0000-\u001f]{1,80})$/.test(dev)) throw HttpError(400, 'device_invalid');
    self.setCapture({ device: dev, grab: true, until: now + C.LIMITS.CAPTURE_SECONDS });
  } else if (mode === 'keepalive') {
    if (!self.capture) return { capture: null };
    var span = self.capture.device === '*' ? C.LIMITS.IDENTIFY_SECONDS : C.LIMITS.CAPTURE_SECONDS;
    self.setCapture(Object.assign({}, self.capture, { until: now + span }));
  } else {
    throw HttpError(400, 'mode_invalid');
  }
  var since = Date.now() / 1000;
  await self.writeMapperConfig();
  await self.reloadMapper();
  if (mode === 'keepalive') return { capture: self.capture };
  return { capture: self.capture, grab: await self.waitGrab(self.capture.device, since) };
};

/**
 * Waits (max. 3 s) until the mapper has taken over the capture and reports whether all affected input
 * devices are read exclusively. ok=false: keys could trigger something while being read in.
 */
ControllerX10Remote.prototype.waitGrab = async function (device, since) {
  var deadline = Date.now() + 3000;
  var st = null;
  while (Date.now() < deadline) {
    st = this.mapperStatus();
    if (st && st.time >= since && st.capture && st.capture.device === device) break;
    st = null;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  if (!st) return { ok: false, confirmed: false, devices: [] };
  // detecting: only the devices that are to be grabbed (remotes); reading in: the chosen device
  var devs = (st.open || []).filter(function (o) {
    return device === '*' ? o.grab_wanted !== false && o.class !== 'keyboard' : o.id === device && o.grab_wanted !== false;
  });
  return {
    ok: device === '*' ? devs.every(function (o) { return o.grabbed; }) : devs.length > 0 && devs.every(function (o) { return o.grabbed; }),
    confirmed: true,
    devices: devs.map(function (o) { return { id: o.id, name: o.name, grabbed: !!o.grabbed, error: o.error || '' }; })
  };
};

ControllerX10Remote.prototype.setCapture = function (cap) {
  var self = this;
  self.capture = cap;
  if (self.captureTimer) clearTimeout(self.captureTimer);
  var ms = Math.max(1000, (cap.until - Date.now() / 1000) * 1000 + 1000);
  self.captureTimer = setTimeout(function () {
    self.captureTimer = null;
    if (self.capture && self.capture.until <= Date.now() / 1000 + 0.5) {
      self.capture = null;
      self.writeMapperConfig().catch(function () { /* ignore */ });
    }
  }, ms);
  if (self.captureTimer.unref) self.captureTimer.unref();
};

ControllerX10Remote.prototype.clearCapture = function () {
  if (this.captureTimer) clearTimeout(this.captureTimer);
  this.captureTimer = null;
  this.capture = null;
};

// ============================================================ Volumio settings

ControllerX10Remote.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();
  self.loadI18n();
  var lang = self.langCode();
  self.commandRouter.i18nJson(
    path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
    path.join(__dirname, 'i18n', 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json')
  ).then(function (uiconf) {
    return kew(self.fillUIConfig(uiconf));
  }).then(function (uiconf) {
    defer.resolve(uiconf);
  }).fail(function (e) {
    self.logger.error(C.LOG_PREFIX + 'getUIConfig: ' + (e && e.message));
    defer.reject(e);
  });
  return defer.promise;
};

ControllerX10Remote.prototype.fillUIConfig = async function (uiconf) {
  var self = this;
  var section = function (id) { return uiconf.sections.filter(function (s) { return s.id === id; })[0]; };
  var base = self.baseUrls()[0];

  var general = section('section_general');
  general.description = general.description + ' (' + self.t('VERSION') + ' ' + PLUGIN_VERSION + ')';
  general.content.forEach(function (el) {
    switch (el.id) {
      case 'enabled': el.value = self.isEnabled(); break;
      case 'debounce_ms': el.value = self.numConf('debounce_ms', C.DEFAULT_DEBOUNCE_MS, 0, 2000); break;
      case 'repeat_ms': el.value = self.numConf('repeat_ms', 150, 50, 2000); break;
      case 'ignore_scancodes': el.value = String(self.config.get('ignore_scancodes') || ''); break;
      case 'expert_mode': el.value = self.expertMode(); break;
      case 'allow_shell': el.value = self.allowShell(); break;
      case 'log_presses': el.value = self.config.get('log_presses') === true; break;
      case 'web_port': el.value = self.webPortSetting(); break;
      case 'event_port': el.value = self.eventPortSetting(); break;
      case 'mobile_port': el.value = self.mobilePortSetting(); break;
      case 'thd_exclusive': el.value = self.exclusiveSetting(); break;
      case 'watchdog': el.value = self.watchdogSetting(); break;
      case 'thd_exclusive_delay': el.value = self.exclusiveDelay(); break;
    }
  });

  var web = section('section_web');
  web.description = web.description + ' ' + base + '/';
  web.content.forEach(function (el) {
    if (el.id === 'btn_open_wizard') el.onClick = { type: 'openUrl', url: base + '/wizard.html' };
    if (el.id === 'btn_open_profiles') el.onClick = { type: 'openUrl', url: base + '/profiles.html' };
    if (el.id === 'btn_open_test') el.onClick = { type: 'openUrl', url: base + '/test.html' };
    if (el.id === 'btn_open_mobile') el.onClick = { type: 'openUrl', url: base + '/mobile.html' };
    if (el.id === 'btn_open_mobilesim') el.onClick = { type: 'openUrl', url: base + '/mobilesim.html' };
  });

  var prof = section('section_profiles');
  var list = await self.userProfiles().catch(function () { return []; });
  var sel = self.profileSelection(list);
  prof.content = [{
    id: 'active_profile', element: 'select', label: self.t('PROFILE_SELECT'), doc: self.t('PROFILE_SELECT_DOC'),
    value: { value: sel.value, label: sel.label }, options: sel.options
  }];
  prof.saveButton.data = ['active_profile'];
  web.description = web.description + ' ' + self.t('CURRENT_PROFILE', { name: sel.label }) + ' (' + self.t('VERSION') + ' ' + PLUGIN_VERSION + ')';
  return uiconf;
};

ControllerX10Remote.prototype.saveGeneral = function (data) {
  var self = this;
  var wasEnabled = self.isEnabled();
  var oldPort = self.webPortSetting();
  var oldEvent = self.eventPortSetting();
  var oldMobile = self.mobilePortSetting();
  self.config.set('enabled', !!data.enabled);
  if (data.watchdog !== undefined) self.config.set('watchdog', !!data.watchdog);
  ['debounce_ms', 'repeat_ms'].forEach(function (k) {
    var v = parseInt(data[k], 10);
    if (!isNaN(v)) self.config.set(k, v);
  });
  // ports: freely selectable (1024-65535) but all different - otherwise all three stay unchanged
  var ports = {};
  var portsOk = true;
  [['web_port', oldPort], ['event_port', oldEvent], ['mobile_port', oldMobile]].forEach(function (x) {
    var v = data[x[0]] === undefined || data[x[0]] === '' ? x[1] : parseInt(data[x[0]], 10);
    if (!(v >= 1024 && v <= 65535)) portsOk = false;
    ports[x[0]] = v;
  });
  if (ports.web_port === ports.event_port || ports.web_port === ports.mobile_port || ports.event_port === ports.mobile_port) portsOk = false;
  if (portsOk) Object.keys(ports).forEach(function (k) { self.config.set(k, ports[k]); });
  if (data.ignore_scancodes !== undefined) {
    self.config.set('ignore_scancodes', String(data.ignore_scancodes).replace(/[^0-9a-fx,; ]/gi, '').trim());
  }
  self.config.set('log_presses', !!data.log_presses);

  return kew((async function () {
    if (self.webPortSetting() !== oldPort || self.eventPortSetting() !== oldEvent) {
      await self.web.start(self.webPortSetting(), self.eventPortSetting());
    }
    if (self.mobileEnabled() && self.mobilePortSetting() !== oldMobile) await self.mobile.start(self.mobilePortSetting());
    await self.apply();
    if (self.isEnabled() && !wasEnabled) await self.systemctl(['restart', C.SERVICE]);
    if (!self.isEnabled() && wasEnabled) {
      self.clearCapture();
      await self.systemctl(['stop', C.SERVICE]);
    }
    await self.updateWatchdog();
    if (portsOk) self.toast('success', self.t('SAVED'));
    else self.toast('warning', self.t('PORTS_INVALID'));
    self.refreshUI();
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

/**
 * Section "Expert mode": switches expert mode, custom commands, Triggerhappy exclusive (+ waiting time).
 * Custom commands are only switched on after a notice about the risks has been confirmed.
 * Expert mode off -> custom commands and exclusive mode off.
 */
ControllerX10Remote.prototype.saveExpert = function (data) {
  var self = this;
  data = data || {};
  var oldExcl = self.exclusiveSetting();
  var expert = !!data.expert_mode;
  var wantShell = expert && !!data.allow_shell;
  var askShell = wantShell && !self.allowShell();
  self.config.set('expert_mode', expert);
  if (!expert || !wantShell) self.config.set('allow_shell', false);
  self.config.set('thd_exclusive', expert && !!data.thd_exclusive);
  var d = parseInt(data.thd_exclusive_delay, 10);
  if (!isNaN(d)) self.config.set('thd_exclusive_delay', Math.max(0, Math.min(C.EXCL_DELAY_MAX, d)));

  return kew((async function () {
    await self.apply();
    if (self.exclusiveSetting() !== oldExcl) {
      if (self.exclusiveSetting()) {
        self.startExclusive(true).then(function () {
          self.toast(self.excl.state === 'on' ? 'success' : 'error', self.t('EXCL_STATE_' + self.excl.state.toUpperCase()));
          self.refreshUI();
        }, function (e) { self.toast('error', self.t('ERROR') + ': ' + e.message); });
      } else {
        await self.stopExclusive();
        await self.apply();
      }
    }
    self.toast('success', self.t('SAVED'));
    if (askShell) self.showShellRisks();
    self.refreshUI();
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

/** Notice about the risks of custom commands with "Activate anyway" / "Cancel". */
ControllerX10Remote.prototype.showShellRisks = function () {
  var self = this;
  var li = ['SHELL_RISK_1', 'SHELL_RISK_2', 'SHELL_RISK_3', 'SHELL_RISK_4', 'SHELL_RISK_5']
    .map(function (k) { return '<li>' + escapeHtml(self.t(k, { port: String(self.web.port || self.webPortSetting()) })) + '</li>'; }).join('');
  var html = '<p>' + escapeHtml(self.t('SHELL_RISK_INTRO')) + '</p><ul>' + li + '</ul>' +
    '<p><b>' + escapeHtml(self.t('SHELL_RISK_LAN_TITLE')) + '</b> ' + escapeHtml(self.t('SHELL_RISK_LAN')) + '</p>' +
    '<p>' + escapeHtml(self.t('SHELL_RISK_ADVICE')) + '</p>';
  var call = function (method) {
    return { endpoint: C.ENDPOINT, method: method, data: {} };
  };
  self.commandRouter.broadcastMessage('openModal', {
    title: self.t('SHELL_RISK_TITLE'),
    message: html,
    size: 'lg',
    buttons: [
      { name: self.t('SHELL_RISK_CANCEL'), class: 'btn btn-info', emit: 'callMethod', payload: call('cancelAllowShell') },
      { name: self.t('SHELL_RISK_CONFIRM'), class: 'btn btn-warning', emit: 'callMethod', payload: call('confirmAllowShell') }
    ]
  });
};

ControllerX10Remote.prototype.confirmAllowShell = function () {
  var self = this;
  return kew((async function () {
    if (!self.expertMode()) return;
    self.config.set('allow_shell', true);
    self.logger.info(C.LOG_PREFIX + 'custom commands enabled (risks confirmed)');
    await self.apply();
    self.toast('success', self.t('SHELL_ENABLED'));
    self.refreshUI();
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

ControllerX10Remote.prototype.cancelAllowShell = function () {
  this.config.set('allow_shell', false);
  this.toast('info', this.t('SHELL_NOT_ENABLED'));
  this.refreshUI();
  return kew(Promise.resolve());
};

/** Selection list "Active profile": vanilla, every profile, possibly "several active". */
ControllerX10Remote.prototype.profileSelection = function (list) {
  var self = this;
  var ids = self.activeIds().filter(function (id) { return list.some(function (p) { return p.id === id; }); });
  var options = [{ value: VANILLA_ID, label: self.t('VANILLA_NAME') }].concat(list.map(function (p) {
    return { value: p.id, label: p.name };
  }));
  var value = VANILLA_ID;
  var label = self.t('VANILLA_NAME');
  if (ids.length === 1) {
    value = ids[0];
    label = list.filter(function (p) { return p.id === ids[0]; })[0].name;
  } else if (ids.length > 1) {
    value = MULTI_VALUE;
    label = self.t('MULTI_ACTIVE', { names: ids.map(function (id) {
      return list.filter(function (p) { return p.id === id; })[0].name;
    }).join(', ') });
    options.push({ value: MULTI_VALUE, label: label });
  }
  return { value: value, label: label, options: options };
};

/** Activate exactly one profile - or none (vanilla: audio.conf only). */
ControllerX10Remote.prototype.selectProfile = async function (id) {
  if (id === VANILLA_ID) {
    this.setActiveIds([]);
  } else {
    if (!profilesLib.ID_RE.test(String(id || '')) || !(await this.store.get(id))) throw HttpError(404, 'profile_not_found');
    this.assertNotMobile(id);
    this.setActiveIds([id]);
  }
  return this.apply();
};

ControllerX10Remote.prototype.saveProfiles = function (data) {
  var self = this;
  return kew((async function () {
    var value = data && data.active_profile && typeof data.active_profile === 'object'
      ? data.active_profile.value : (data && data.active_profile);
    if (!value || value === MULTI_VALUE) {
      self.toast('info', self.t('SAVED'));
      return;
    }
    var built = await self.selectProfile(String(value));
    self.refreshUI();
    if (built.problems.length) self.toast('warning', self.problemText(built.problems[0]));
    else self.toast('success', self.t('SAVED'));
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

/** systemd state (active, inactive, failed …) in the language of Volumio. */
ControllerX10Remote.prototype.stateText = function (state, lang) {
  var s = String(state || '').trim().toLowerCase();
  var key = 'STATE_' + (/^(active|inactive|failed|activating|deactivating|reloading)$/.test(s) ? s.toUpperCase() : 'UNKNOWN');
  return this.t(key, null, lang);
};

/**
 * Show the description of the X10 default profile generated by the plugin in the chosen language
 * (it was stored in the language of that time when it was created). Own texts stay unchanged.
 */
ControllerX10Remote.prototype.localizeDescription = function (desc, lang) {
  var self = this;
  if (!desc) return desc;
  var known = self.languages().some(function (l) { return self.t('DEFAULT_PROFILE_DESC', null, l) === desc; });
  return known ? self.t('DEFAULT_PROFILE_DESC', null, lang) : desc;
};

ControllerX10Remote.prototype.problemText = function (p) {
  return this.t('PROBLEM_' + String(p.code).toUpperCase(), { profile: p.profile || '', key: p.key || '', other: p.other || '', max: p.max || '' });
};

ControllerX10Remote.prototype.openAddresses = function () {
  var self = this;
  var lines = self.baseUrls().map(function (u) {
    return '<p style="font-size:18px;font-weight:bold;user-select:all">' + escapeHtml(u) + '/</p>';
  }).join('');
  var warn = self.web.port ? '' : '<p style="color:#d9534f">' + escapeHtml(self.t('WEB_NOT_RUNNING', { error: self.web.error || '' })) + '</p>';
  var mob = '';
  if (self.mobileEnabled() && self.mobile.port) {
    mob = '<p>' + escapeHtml(self.t('MOBILE_ADDRESSES')) + '</p>' + self.mobileUrls().map(function (u) {
      return '<p style="font-size:18px;font-weight:bold;user-select:all">' + escapeHtml(u) + '</p>';
    }).join('');
  }
  self.modal(self.t('WEB_TITLE'), warn + '<p>' + escapeHtml(self.t('ADDRESSES_INFO')) + '</p>' + lines + mob);
  return libQ.resolve();
};

ControllerX10Remote.prototype.restartService = function () {
  var self = this;
  return kew((async function () {
    await self.apply();
    await self.systemctl(['restart', C.SERVICE]);
    self.toast('success', self.t('SERVICE_RESTARTED'));
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

ControllerX10Remote.prototype.showStatus = function () {
  var self = this;
  return kew((async function () {
    var mapper = await self.mapperActive();
    var thd = await self.exec('/bin/systemctl', ['is-active', 'triggerhappy.service']).catch(function (e) { return e.stdout || '?'; });
    var st = self.mapperStatus();
    var wd = await self.watchdogStatus();
    var html = '<p><b>' + escapeHtml(self.t('ST_MAPPER')) + ':</b> ' + escapeHtml(self.stateText(mapper)) + '<br>' +
      '<b>' + escapeHtml(self.t('ST_THD')) + ':</b> ' + escapeHtml(self.stateText(thd)) + '<br>' +
      '<b>' + escapeHtml(self.t('ST_THD_MODE')) + ':</b> ' + escapeHtml(self.t('EXCL_STATE_' + self.excl.state.toUpperCase())) + '<br>' +
      '<b>' + escapeHtml(self.t('ST_WATCHDOG')) + ':</b> ' + escapeHtml(wd.timer === 'active'
        ? self.t('ST_WATCHDOG_ON', { last: wd.last || '–' }) : self.t(self.watchdogSetting() ? 'ST_WATCHDOG_MISSING' : 'ST_WATCHDOG_OFF')) + '<br>' +
      '<b>' + escapeHtml(self.t('WEB_TITLE')) + ':</b> ' + escapeHtml(self.web.port ? self.baseUrls()[0] + '/' : self.t('WEB_NOT_RUNNING', { error: self.web.error || '' })) + '</p>';
    html += '<p><b>' + escapeHtml(self.t('ST_PROFILES')) + ':</b> ' +
      escapeHtml(self.current.profiles.map(function (p) { return p.name; }).join(', ') || '-') + '</p>';
    if (st) {
      html += '<p><b>' + escapeHtml(self.t('ST_DEVICES')) + ':</b></p><ul>';
      (st.open || []).forEach(function (o) {
        html += '<li>' + escapeHtml(o.path + ' – ' + o.name + ' [' + o.id + ']' + (o.grabbed ? ' – ' + self.t('ST_EXCLUSIVE') : '')) + '</li>';
      });
      html += '</ul>';
    }
    if (wd.log.length) {
      html += '<p><b>' + escapeHtml(self.t('ST_WATCHDOG_LOG')) + ':</b></p><pre style="white-space:pre-wrap;font-size:12px">' +
        escapeHtml(wd.log.join('\n')) + '</pre>';
    }
    var problems = self.current.problems.map(function (p) { return self.problemText(p); })
      .concat((st && st.problems) || []);
    if (problems.length) {
      html += '<p style="color:#d9534f">' + problems.map(escapeHtml).join('<br>') + '</p>';
    }
    self.modal(self.t('STATUS_TITLE'), html);
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

ControllerX10Remote.prototype.showLog = function () {
  var self = this;
  var args = ['-u', C.SERVICE, '-n', '30', '--no-pager', '-o', 'short-iso'];
  // read without sudo; if the journal is not readable, get the messages through "systemctl status"
  // (sudo for systemctl only - Volumio rule)
  var hasEntries = function (out) { return /^\d{4}-\d\d-\d\dT/m.test(String(out || '')); };
  return kew(self.exec('/bin/journalctl', args).catch(function () { return ''; })
    .then(function (out) {
      if (hasEntries(out)) return out;
      return self.systemctl(['status', C.SERVICE, '-n', '30', '--no-pager', '-o', 'short-iso'])
        .catch(function (e) { return e.stdout || e.message; });
    })
    .then(function (out) {
      self.modal(self.t('LOG_TITLE'), '<pre style="white-space:pre-wrap;font-size:12px">' + escapeHtml(String(out).trim() || '-') + '</pre>');
    }));
};

ControllerX10Remote.prototype.showGeneratedConfig = function () {
  var self = this;
  var file = self.excl.on ? path.join(C.EXCL_DIR, C.THD_CONF_NAME) : self.thdConfPath();
  return kew(fsp.readFile(file, 'utf8').catch(function () { return '-'; }).then(function (text) {
    text = file + '\n\n' + text;
    self.modal(self.t('THD_TITLE'), '<pre style="white-space:pre-wrap;font-size:12px">' + escapeHtml(text) + '</pre>');
  }));
};

/** Which commands from audio.conf (and other files) are replaced for which remote? */
ControllerX10Remote.prototype.showOverrides = function () {
  var self = this;
  self.logger.info(C.LOG_PREFIX + 'showOverrides');
  return kew(triggers.readOtherTriggers(C.THD_DIR).catch(function () { return {}; }).then(function (other) {
    var rows = self.current.mappings.filter(function (m) { return m.type === 'key'; }).map(function (m) {
      var orig = (other[m.key_name] || []).map(function (o) { return o.file + ': ' + o.command; }).join('; ') || '-';
      var now = m.mode === 'swallow' ? self.t('ACTION_NONE_KEY') : (triggers.commandFor(m, self.allowShell()) || '-');
      return '<li><b>' + escapeHtml(m.profile_name + ' – ' + m.label + ' (' + (m.key_name || m.code) + ')') + '</b><br>' +
        escapeHtml(self.t('OVR_BEFORE') + ': ' + orig) + '<br>' + escapeHtml(self.t('OVR_NOW') + ': ' + now) + '</li>';
    });
    if (!rows.length) self.toast('info', self.t('OVR_NONE'));
    self.modal(self.t('OVR_TITLE'), (rows.length ? '<p>' + escapeHtml(self.t('OVR_INFO')) + '</p><ul>' + rows.join('') + '</ul>'
      : '<p>' + escapeHtml(self.t('OVR_NONE')) + '</p><p>' + escapeHtml(self.t('OVR_INFO')) + '</p>'));
  }).catch(function (e) {
    self.logger.error(C.LOG_PREFIX + 'showOverrides: ' + e.message);
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

ControllerX10Remote.prototype.recreateDefaultProfile = function () {
  var self = this;
  return kew((async function () {
    var existing = await self.store.get(DEFAULT_PROFILE_ID);
    if (existing) {
      self.toast('info', self.t('DEFAULT_EXISTS'));
      return;
    }
    await self.migrate(true);
    await self.apply();
    self.toast('success', self.t('DEFAULT_CREATED'));
    self.refreshUI();
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

/** Standalone wrapper (without the plugin) as .tar.gz in /data/INTERNAL. */
ControllerX10Remote.prototype.exportWrapper = function () {
  var self = this;
  return kew((async function () {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    var name = 'x10remote-wrapper-' + stamp;
    var base = C.EXPORT_BASE;
    var dir = path.join(base, name);
    await fsp.mkdir(path.join(dir, 'profiles'), { recursive: true });
    var cfg = self.mapperConfig();
    cfg.capture = null;
    cfg.event_port = 0;
    await fsp.writeFile(path.join(dir, 'mapper.json'), JSON.stringify(cfg, null, 2) + '\n');
    await fsp.writeFile(path.join(dir, 'x10remote.conf'), triggers.buildThdConf(self.current.mappings, self.allowShell()));
    await fsp.copyFile(path.join(__dirname, 'bin', 'x10mapper.py'), path.join(dir, 'x10mapper.py'));
    await fsp.copyFile(path.join(__dirname, 'bin', 'x10remote-action'), path.join(dir, 'x10remote-action'));
    var unit = await fsp.readFile(path.join(__dirname, 'bin', 'x10mapper.service'), 'utf8');
    await fsp.writeFile(path.join(dir, 'x10mapper.service'),
      unit.replace('/data/configuration/system_hardware/x10remote/mapper.json', '/etc/x10remote/mapper.json'));
    for (var i = 0; i < self.current.profiles.length; i++) {
      var p = self.current.profiles[i];
      await fsp.writeFile(path.join(dir, 'profiles', p.id + '.json'), JSON.stringify(p, null, 2) + '\n');
    }
    await fsp.writeFile(path.join(dir, 'install.sh'), [
      '#!/bin/sh',
      '# Standalone installation of the X10 wrapper (without the Volumio plugin). Run as root.',
      'set -e',
      'cd "$(dirname "$0")"',
      'python3 -c "import evdev" 2>/dev/null || { apt-get update && apt-get install -y --no-install-recommends python3-evdev; }',
      'modprobe uinput || true',
      '[ -f /etc/modules-load.d/x10remote.conf ] || echo uinput > /etc/modules-load.d/x10remote.conf',
      'install -d /etc/x10remote',
      'install -m 644 mapper.json /etc/x10remote/mapper.json',
      'install -m 755 x10mapper.py /usr/local/bin/x10mapper.py',
      'install -m 755 x10remote-action /usr/local/bin/x10remote-action',
      'install -m 644 x10mapper.service /etc/systemd/system/x10mapper.service',
      'install -d /etc/triggerhappy/triggers.d',
      'install -m 644 x10remote.conf /etc/triggerhappy/triggers.d/x10remote.conf',
      'systemctl daemon-reload',
      'systemctl enable --now x10mapper.service',
      'systemctl restart triggerhappy.service || true',
      'echo "X10 wrapper installed. Test: journalctl -fu x10mapper"',
      ''
    ].join('\n'), { mode: 0o755 });
    await fsp.writeFile(path.join(dir, 'README.txt'), [
      'X10 wrapper, exported from the Volumio plugin "X10 RF Remote" ' + PLUGIN_VERSION + ' on ' + new Date().toISOString(),
      '',
      'Contents: x10mapper.py, mapper.json (active profiles), x10mapper.service, x10remote.conf,',
      'x10remote-action, profiles/*.json (profile descriptions), install.sh (as root: sh install.sh)',
      '',
      'Active profiles: ' + (self.current.profiles.map(function (p) { return p.name; }).join(', ') || '-'),
      ''
    ].join('\n'));
    await self.exec('/bin/tar', ['-czf', path.join(base, name + '.tar.gz'), '-C', base, name]);
    await fsp.chmod(path.join(base, name + '.tar.gz'), C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
    await fsp.rm(dir, { recursive: true, force: true });
    self.toast('success', self.t('EXPORT_OK', { path: path.join(base, name + '.tar.gz') }));
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};
