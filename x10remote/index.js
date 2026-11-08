'use strict';

/*
 * Volumio 4 plugin "X10 RF Remote" (system_hardware/x10remote)
 *
 * Fernbedienung -> Treiber -> /dev/input/eventX -> x10mapper.py (systemd, root)
 *   -> /dev/uinput (virtuelle Tasten / Durchreichen) -> Triggerhappy (Teil von Volumio) -> Volumio
 *
 * Das Plugin verwaltet
 *  - Profile je Fernbedienung in /data/INTERNAL/X10/<id>/ (Tasten, Namen, Befehle, Beschreibung, Bilder)
 *  - /data/configuration/system_hardware/x10remote/mapper.json   (Konfiguration des Mappers)
 *  - /etc/triggerhappy/triggers.d/x10remote.conf                   (nur diese Datei; audio.conf bleibt unveraendert)
 *  - den Dienst x10mapper.service (Start in onStart, Stopp in onStop)
 *  - die Weboberflaeche (Tastentest, Einlese-Assistent, Profile) auf eigenem Port
 */

// kew und v-conf: eigene node_modules, sonst die Module des Volumio-Kerns (nur lesend)
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
var HttpError = require('./lib/web').HttpError;

var PLUGIN_VERSION = (function () {
  try { return require('./package.json').version; } catch (e) { return '?'; }
})();
var X10_DEVICE = '0bc7:0006';
var DEFAULT_PROFILE_ID = 'x10-wti';
var VANILLA_ID = C.VANILLA_ID;     // eingebautes Profil: nur audio.conf im Original
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
}

// ============================================================== Lebenszyklus

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
  // Empfaenger: eigener Ordner direkt in /data/INTERNAL/X10, Ordnername = gespeicherter Name (receiver.json)
  this.receivers = new profilesLib.ProfileStore(C.PROFILE_DIR, this.logger, {
    exactNames: true,
    onPermissionError: function () { return self.fixSharePermissions(); },
    fileName: 'receiver.json', sanitize: profilesLib.sanitizeReceiver, kind: 'receiver', notFound: 'receiver_not_found',
    isValid: function (raw) { return !!(raw.device && raw.device.id); }
  });
  this.web = new WebServer(this, this.logger);
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
    await self.migrate();
    await self.ensureReceivers().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'receivers: ' + e.message); });
    await self.ensureCommandRef();
    await self.ensureRadioPresets().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'radio presets: ' + e.message); });
    await self.writeCatalog().catch(function (e) { self.logger.warn(C.LOG_PREFIX + 'radio catalog: ' + e.message); });
    await self.web.start(self.webPortSetting(), C.DEFAULT_EVENT_PORT);
    await self.cleanupLegacyAutostart();
    await self.apply();
    if (self.isEnabled()) {
      // restart statt start: nach einem Update laeuft so sicher die neue Mapper-Version
      await self.systemctl(['restart', C.SERVICE]);
    } else {
      await self.systemctl(['stop', C.SERVICE]).catch(function () { /* ignore */ });
    }
    await self.updateWatchdog();
    // Exklusivbetrieb: nach der Wartezeit im Hintergrund (onStart wartet nicht darauf)
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
  self.clearCapture();
  return kew((async function () {
    // Watchdog zuerst anhalten, damit er den gestoppten Mapper nicht wieder startet
    await self.stopWatchdog();
    await self.systemctl(['stop', C.SERVICE]).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'onStop: ' + e.message);
    });
    // zuerst Triggerhappy wieder normal (mit audio.conf) starten
    await self.stopExclusive().catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'onStop exclusive: ' + e.message);
    });
    await self.writeThdConf(self.thdHeaderOnly()).catch(function () { /* ignore */ });
    await self.reloadTriggerhappy();
    await self.web.stop();
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

/** Sprache von Volumio als zweistelliger Code (z. B. 'it' auch fuer 'it_IT' oder 'it-IT'). */
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
 * Uebersetzungen nach Volumio-Vorgabe: i18n/strings_<Sprachcode>.json, Englisch (strings_en.json) ist
 * Pflicht und Rueckfall fuer fehlende Sprachen und fehlende Schluessel. Volumios getI18nString kennt die
 * Schluessel eines Plugins in Toasts/Modals nicht - daher eigene Uebersetzung (t), die der Sprache von
 * Volumio folgt (sharedVars language_code) und bei einem Sprachwechsel neu laedt.
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

/** Verfuegbare Sprachen (Dateien im Ordner i18n). */
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

/** Text in der Sprache von Volumio (oder in lang, z. B. fuer die Weboberflaeche). */
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

// ================================================================ Einstellungen

ControllerX10Remote.prototype.isEnabled = function () {
  var v = this.config.get('enabled');
  return v === undefined ? true : !!v;
};

/**
 * Expertenmodus: Eigene Shell-Befehle und der Exklusivbetrieb lassen sich nur dort einschalten und wirken
 * nur, solange der Expertenmodus an ist.
 */
ControllerX10Remote.prototype.expertMode = function () {
  return this.config.get('expert_mode') === true;
};

/** Eigene Befehle wirksam? (Expertenmodus an UND ausdruecklich erlaubt; Standard: aus) */
ControllerX10Remote.prototype.allowShell = function () {
  return this.expertMode() && this.config.get('allow_shell') === true;
};

ControllerX10Remote.prototype.numConf = function (key, def, min, max) {
  var v = parseInt(this.config.get(key), 10);
  if (isNaN(v)) v = def;
  return Math.max(min, Math.min(max, v));
};

ControllerX10Remote.prototype.webPortSetting = function () {
  // test_port: Name der Einstellung bis Version 1.2.x
  var key = this.config.get('web_port') === undefined && this.config.get('test_port') !== undefined ? 'test_port' : 'web_port';
  return this.numConf(key, C.DEFAULT_WEB_PORT, 1024, 65535);
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

// ================================================================== Migration

/** Uebernimmt die Belegungen aus Version 1.1/1.2 einmalig als Profil "X10 WTI RF Remote". */
ControllerX10Remote.prototype.migrate = async function () {
  var self = this;
  try {
    await self.store.ensureBase();
  } catch (e) {
    self.logger.error(C.LOG_PREFIX + 'cannot create ' + C.PROFILE_DIR + ': ' + e.message);
    throw e;
  }
  // Expertenmodus (eingefuehrt mit 0.55.0). Eigene Befehle standardmaessig aus. Bestehende Installationen einmalig umstellen:
  // nutzt ein Profil bereits eigene Befehle, bleiben sie wirksam (Expertenmodus + erlaubt), sonst aus.
  if (self.config.get('expert_v17') !== true) {
    var usesCustom = false;
    try {
      var all = await self.store.list();
      for (var i = 0; i < all.length && !usesCustom; i++) {
        var pr = await self.store.get(all[i].id);
        usesCustom = !!(pr && pr.keys.some(function (k) { return k.action === 'custom' && k.command; }));
      }
    } catch (e) { usesCustom = false; }
    var keepShell = usesCustom && self.config.get('allow_shell') === true;
    var keepExcl = self.config.get('thd_exclusive') === true;
    self.config.set('expert_mode', keepShell || keepExcl);
    self.config.set('allow_shell', keepShell);
    self.config.set('expert_v17', true);
    self.logger.info(C.LOG_PREFIX + 'expert mode migration: expert_mode=' + (keepShell || keepExcl) + ', allow_shell=' + keepShell);
  }
  if (self.config.get('migrated') === true) return;

  var legacy = [];
  try { legacy = JSON.parse(self.config.get('mappings') || '[]'); } catch (e) { legacy = []; }
  if (!Array.isArray(legacy)) legacy = [];

  var existing = await self.store.get(DEFAULT_PROFILE_ID);
  if (!existing) {
    var keys;
    if (legacy.length) {
      keys = legacy.map(function (m) {
        return {
          name: m.label || '', type: m.type === 'key' ? 'key' : 'scan', code: m.code,
          key_name: m.key_name || null,
          action: m.type === 'key' ? (m.action === 'none' ? 'default' : m.action) : (m.action || 'none'),
          command: m.command || '', repeat: !!m.repeat
        };
      });
      if (legacy.some(function (m) { return m.action === 'custom' && m.command; })) {
        self.config.set('allow_shell', true);    // eigene Befehle aus der alten Version weiter erlauben
        self.config.set('expert_mode', true);
      }
    } else {
      keys = self.defaultX10Keys();
    }
    var hasDvd = keys.some(function (k) { return k.type === 'key' && Number(k.code) === 389; });
    if (!hasDvd) keys.push({ name: 'DVD', type: 'key', code: 389, key_name: 'KEY_DVD', action: 'default' });
    try {
      var created = await self.store.save({
        name: 'X10 WTI RF Remote',
        description: self.t('DEFAULT_PROFILE_DESC'),
        device: { id: X10_DEVICE, name: 'X10 WTI RF receiver' },
        keys: keys
      }, { allowShell: self.allowShell(), version: PLUGIN_VERSION, newId: DEFAULT_PROFILE_ID });
      if (created.id !== DEFAULT_PROFILE_ID) self.logger.warn(C.LOG_PREFIX + 'default profile saved as ' + created.id);
      var ids = self.activeIds();
      if (ids.indexOf(created.id) === -1) ids.unshift(created.id);
      self.setActiveIds(ids);
      self.logger.info(C.LOG_PREFIX + 'migrate: created profile ' + created.id + ' (' + keys.length + ' keys)');
    } catch (e) {
      self.logger.error(C.LOG_PREFIX + 'migrate failed: ' + e.message);
    }
  } else if (!self.activeIds().length) {
    // Neuinstallation mit erhaltenen Profilen: Standardprofil wieder aktivieren
    self.setActiveIds([existing.id]);
  }
  self.config.set('migrated', true);
};

ControllerX10Remote.prototype.defaultX10Keys = function () {
  return [0x06, 0x2c, 0x2d, 0x2e, 0x05, 0x19, 0x39, 0x3a].map(function (code) {
    return { name: 'X10 ' + triggers.hex(code), type: 'scan', code: code, action: 'none' };
  });
};

/** Aeltere Versionen haben den Dienst beim Systemstart aktiviert - jetzt startet ihn nur onStart. */
ControllerX10Remote.prototype.cleanupLegacyAutostart = async function () {
  var enabled = await this.exec('/bin/systemctl', ['is-enabled', C.SERVICE]).catch(function (e) { return e.stdout || ''; });
  if (String(enabled).trim() === 'enabled') {
    await this.systemctl(['disable', C.SERVICE]).catch(function () { /* ignore */ });
  }
};

// ============================================================ Anwenden der Konfiguration

ControllerX10Remote.prototype.activeProfiles = async function () {
  var self = this;
  var out = [];
  var ids = self.activeIds();
  for (var i = 0; i < ids.length; i++) {
    var p = await self.store.get(ids[i]);
    if (p) out.push(p);
  }
  return out;
};

/** Profile -> mapper.json + x10remote.conf, Mapper und Triggerhappy neu laden. Laeuft nacheinander. */
ControllerX10Remote.prototype.apply = function () {
  var self = this;
  var run = self._applyQueue.then(function () { return self._apply(); });
  self._applyQueue = run.catch(function () { /* Fehler gehen an den Aufrufer */ });
  return run;
};

ControllerX10Remote.prototype._apply = async function () {
  var self = this;
  var profiles = await self.activeProfiles();
  var other = await triggers.readOtherTriggers(C.THD_DIR).catch(function () { return {}; });
  var built = triggers.buildMappings(profiles, self.allowShell(), other);
  self.current = { mappings: built.mappings, problems: built.problems, profiles: profiles };
  await self.writeMapperConfig();
  try {
    await self.writeThdConf(triggers.buildThdConf(built.mappings, self.allowShell()));
  } catch (e) {
    // Mapper und Tastentest laufen weiter; Aktionen fehlen, bis die Datei wieder beschreibbar ist
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
  await self.reloadTriggerhappy();
  await self.reloadMapper();
  if (self.web) self.web.broadcast({ event: 'reload' });
  return built;
};

ControllerX10Remote.prototype.mapperConfig = function () {
  return {
    generated_by: 'x10remote ' + PLUGIN_VERSION,
    debounce_ms: this.numConf('debounce_ms', 300, 0, 2000),
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

/** Die Datei wird von install.sh mit Besitzer volumio angelegt; daher kein sudo noetig. */
ControllerX10Remote.prototype.writeThdConf = async function (content) {
  try {
    await fsp.writeFile(this.thdConfPath(), content);
  } catch (e) {
    this.logger.error(C.LOG_PREFIX + 'cannot write ' + this.thdConfPath() + ' (' + e.code + '). Please reinstall the plugin.');
    throw HttpError(500, 'thd_conf_not_writable');
  }
};

ControllerX10Remote.prototype.reloadTriggerhappy = async function () {
  var self = this;
  try {
    await self.systemctl(['reload', 'triggerhappy.service']);
  } catch (e) {
    await self.systemctl(['restart', 'triggerhappy.service']).catch(function (e2) {
      self.logger.warn(C.LOG_PREFIX + 'triggerhappy reload failed: ' + e2.message);
    });
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

// ============================================================ SMB-Freigabe
/**
 * Schreibrechte in /data/INTERNAL/X10 herstellen (Ordner 0777, Dateien 0666) - ueber den root-Dienst
 * x10remote-fixperms.service, da per SMB angelegte Dateien dem Gast gehoeren. Nie fatal.
 */
ControllerX10Remote.prototype.fixSharePermissions = async function () {
  var self = this;
  await self.systemctl(['start', C.FIXPERMS_SERVICE]).catch(function (e) {
    self.logger.warn(C.LOG_PREFIX + 'fixperms: ' + e.message + ' (reinstall the plugin?)');
  });
};

// ================================================================== Watchdog
/*
 * x10remote-watchdog.timer prueft alle 5 Minuten Triggerhappy und x10mapper und startet sie bei Bedarf neu.
 * Den Mapper nur, wenn C.MAPPER_WANTED existiert (Plugin aktiv und Mapper eingeschaltet).
 * Der Timer wird nur hier gestartet/gestoppt - nie beim Systemstart aktiviert.
 */
ControllerX10Remote.prototype.watchdogSetting = function () {
  var v = this.config.get('watchdog');
  return v === undefined ? true : !!v;
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
  await self.setMapperWanted(self.started && self.isEnabled());
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

/** Status fuer die Anzeige: Timer-Zustand, letzte Pruefung, letzte Meldungen. */
ControllerX10Remote.prototype.watchdogStatus = async function () {
  var timer = await this.exec('/bin/systemctl', ['is-active', C.WATCHDOG_TIMER]).catch(function (e) { return e.stdout || 'unknown'; });
  var last = await fsp.readFile(C.WATCHDOG_LAST, 'utf8').catch(function () { return ''; });
  var log = await fsp.readFile(C.WATCHDOG_LOG, 'utf8').catch(function () { return ''; });
  return { timer: String(timer).trim() || 'unknown', last: last.trim(),
    log: log.split('\n').filter(function (l) { return l.trim(); }).slice(-5) };
};

// ============================================================ Exklusivbetrieb
/*
 * Triggerhappy liest im Exklusivbetrieb nur C.EXCL_DIR (Datei des Plugins inkl. uebernommener
 * audio.conf-Befehle). Umschalten ueber die von install.sh angelegte systemd-Ergaenzung, die den Ordner
 * aus C.THD_ENV liest; fehlt die Datei, startet Triggerhappy wie immer mit /etc/triggerhappy/triggers.d.
 * audio.conf wird weder veraendert noch verschoben. /run ist ein tmpfs: nach einem Neustart des Geraets
 * laeuft Triggerhappy zuerst normal, bis das Plugin nach der Wartezeit umschaltet.
 */

ControllerX10Remote.prototype.exclusiveSetting = function () {
  return this.expertMode() && this.config.get('thd_exclusive') === true;
};

ControllerX10Remote.prototype.exclusiveDelay = function () {
  return this.numConf('thd_exclusive_delay', C.EXCL_DELAY_DEFAULT, 0, C.EXCL_DELAY_MAX);
};

/** Ergaenzung von install.sh vorhanden und /run/x10remote beschreibbar? */
ControllerX10Remote.prototype.exclusiveAvailable = async function () {
  try {
    var dropin = await fsp.readFile(C.THD_DROPIN, 'utf8');
    if (dropin.indexOf(C.THD_ENV_VAR) === -1) return false;
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

/** Laeuft Triggerhappy tatsaechlich mit dem Ordner des Plugins? (Kommandozeile des Prozesses) */
ControllerX10Remote.prototype.thdIsExclusive = async function () {
  try {
    var pid = String(await this.exec('/bin/systemctl', ['show', '-p', 'MainPID', '--value', 'triggerhappy.service'])).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) return false;
    var cmd = await fsp.readFile('/proc/' + pid + '/cmdline', 'utf8');
    return cmd.split('\u0000').some(function (a) { return a.replace(/\/+$/, '') === C.EXCL_DIR; });
  } catch (e) {
    return false;
  }
};

ControllerX10Remote.prototype.writeExclusiveConf = async function (content) {
  await fsp.mkdir(C.EXCL_DIR, { recursive: true, mode: 0o755 });
  var file = path.join(C.EXCL_DIR, C.THD_CONF_NAME);
  var tmp = file + '.tmp';                       // keine .conf-Endung: Triggerhappy liest sie nicht
  await fsp.writeFile(tmp, content, { mode: 0o644 });
  await fsp.rename(tmp, file);
};

ControllerX10Remote.prototype.sleep = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

/**
 * Exklusivbetrieb einleiten. immediate = ohne Wartezeit (Einstellung gerade eingeschaltet).
 * Laeuft Triggerhappy bereits exklusiv (z. B. nach volumio vrestart), wird nur die Datei aktualisiert.
 */
ControllerX10Remote.prototype.startExclusive = async function (immediate) {
  var self = this;
  if (self.excl.timer) { clearTimeout(self.excl.timer); self.excl.timer = null; }
  if (!self.started || !self.exclusiveSetting()) return self.stopExclusive();
  if (!(await self.exclusiveAvailable())) {
    self.excl.state = 'unavailable';
    self.logger.warn(C.LOG_PREFIX + 'exclusive mode not available (missing ' + C.THD_DROPIN + ' or ' + C.RUN_DIR + ') - please reinstall the plugin');
    await self.apply();
    return;
  }
  var envExists = await fsp.access(C.THD_ENV).then(function () { return true; }, function () { return false; });
  if (envExists && await self.thdIsExclusive()) {
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
  // erst pruefen, ob Triggerhappy bereits gestartet ist (beim Hochfahren evtl. noch nicht)
  for (var i = 0; i < 20 && !(await self.thdActive()); i++) {
    if (!self.started || !self.exclusiveSetting()) return;
    await self.sleep(3000);
  }
  if (!self.started || !self.exclusiveSetting()) return;
  self.excl.on = true;
  await self.apply();                            // schreibt die exklusive Datei
  var tmp = C.THD_ENV + '.tmp';
  await fsp.writeFile(tmp, C.THD_ENV_VAR + '=' + C.EXCL_DIR + '/\n', { mode: 0o644 });
  await fsp.rename(tmp, C.THD_ENV);
  await self.systemctl(['restart', 'triggerhappy.service']);
  await self.sleep(1500);
  if (await self.thdIsExclusive()) {
    self.excl.state = 'on';
    self.excl.error = '';
    self.logger.info(C.LOG_PREFIX + 'exclusive mode active: Triggerhappy reads only ' + C.EXCL_DIR);
    self.watchTriggers();
  } else {
    self.logger.error(C.LOG_PREFIX + 'exclusive mode: Triggerhappy did not start with ' + C.EXCL_DIR + ' - reverting');
    await self.stopExclusive();
    self.excl.state = 'failed';
    await self.apply();
  }
  if (self.web) self.web.broadcast({ event: 'reload' });
};

/** Exklusivbetrieb beenden: Triggerhappy wieder normal (mit audio.conf) starten. */
ControllerX10Remote.prototype.stopExclusive = async function () {
  var self = this;
  if (self.excl.timer) { clearTimeout(self.excl.timer); self.excl.timer = null; }
  self.unwatchTriggers();
  var had = await fsp.unlink(C.THD_ENV).then(function () { return true; }, function () { return false; });
  var wasOn = self.excl.on;
  self.excl.on = false;
  self.excl.state = 'off';
  await fsp.unlink(path.join(C.EXCL_DIR, C.THD_CONF_NAME)).catch(function () { /* ignore */ });
  if (had || wasOn) {
    await self.systemctl(['restart', 'triggerhappy.service']).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'triggerhappy restart failed: ' + e.message);
    });
    self.logger.info(C.LOG_PREFIX + 'exclusive mode off: Triggerhappy reads ' + C.THD_DIR + ' again');
  }
};

/** Aenderungen an audio.conf & Co. im Exklusivbetrieb sofort uebernehmen. */
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

// ======================================================================== Hilfen

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

// ================================================================= Web-API

/** Alle von Triggerhappy erkannten Tasten (`thd --listevents`) + Tasten aus audio.conf. */
ControllerX10Remote.prototype.thdKeys = async function () {
  var self = this;
  var res = await triggers.listThdKeys(function (file, args) { return self.exec(file, args, { timeout: 10000 }); });
  var other = await triggers.readOtherTriggers(C.THD_DIR).catch(function () { return {}; });
  var keys = res.keys.slice();
  Object.keys(other).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  return { keys: keys, source: res.source };
};

ControllerX10Remote.prototype.saveOpts = async function () {
  return { allowShell: this.allowShell(), version: PLUGIN_VERSION, thdKeys: (await this.thdKeys()).keys,
    keyName: this.t('DEFAULT_KEY_NAME') };
};

// Alle Funktionen liefern native Promises; Fehler mit status/code werden als JSON beantwortet.

/**
 * Texte der Weboberflaeche. lang = gewaehlte Sprache der Weboberflaeche (leer = Sprache von Volumio).
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
    virtual_keys: C.VIRTUAL_KEYS,
    pool_size: C.VIRTUAL_KEYS.length,
    image_slots: C.LIMITS.IMAGE_SLOTS,
    thd_mode: this.excl.state,
    capture: this.capture
  };
};

/** Fuer den Tastentest: alle Tasten der aktiven Profile mit ihrer Wirkung. */
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
        thd_key: k.type === 'scan' ? (k.thd_key || (k.action === 'tkey' ? k.target : '') || '') : null,
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

// ------------------------------------------------- Einzelne Taste konfigurieren (Tastentest)

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

/** Aktuelle Konfiguration einer Taste: Profile, audio.conf, virtuelle Taste. */
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
 * Taste in einem Profil anlegen oder aendern. Ohne confirm werden Ersetzungen zuerst gemeldet
 * (bestehende Belegung, audio.conf-Befehl, Belegung in einem anderen aktiven Profil).
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
  var list = await this.store.list();
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
  var before = input && input.id ? await this.store.get(String(input.id)).catch(function () { return null; }) : null;
  var opts = await this.saveOpts();
  var logos = this.takeLogoData(input);                                // neue Senderlogos (data-URL) je Tastenindex
  var check = profilesLib.sanitizeProfile(input, before, opts);       // wirft bei ungueltigen Daten
  var willBeActive = activate || (before && this.activeIds().indexOf(before.id) !== -1);
  if (willBeActive) this.assertNoDuplicates(check);
  await this.checkReceiverRules(check.receivers, before ? before.id : null, input && input.device && input.device.name);
  var profile = await this.store.save(input, opts);
  if (logos.length || profile.keys.some(function (k) { return k.radio; })) profile = await this.storeLogos(profile, logos);
  var oldId = null;
  if (before && before.name !== profile.name) {
    // Name geaendert: Ordner gleichnamig umbenennen
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
  var ids = this.activeIds();
  var wasActive = ids.indexOf(id) !== -1;
  if (wasActive) this.setActiveIds(ids.filter(function (x) { return x !== id; }));
  await this.store.remove(id);
  if (wasActive) await this.apply();
  this.refreshUI();
  return { ok: true };
};

/** Nach dem Umbenennen eines Ordners: aktive Profile auf die neue Kennung umstellen. */
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

ControllerX10Remote.prototype.webRenameProfile = async function (id, name) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  var p = await this.store.rename(id, name);
  this.profileMoved(p.old_id, p.id);
  if (this.activeIds().indexOf(p.id) !== -1) await this.apply();   // Kennung und Namen stehen in mapper.json/thd-Datei
  this.refreshUI();
  return { id: p.id, old_id: p.old_id, name: p.name };
};

ControllerX10Remote.prototype.webDuplicateProfile = async function (id) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'profile_id_invalid');
  var copy = await this.store.duplicate(id);
  this.logger.info(C.LOG_PREFIX + 'profile ' + id + ' duplicated as ' + copy.id);
  this.refreshUI();
  return { id: copy.id, name: copy.name };
};

// ================================================================= Empfaenger

/** 433-MHz-Voreinstellung fuer neue Empfaenger: X10-Funkempfaenger (Hersteller 0bc7) arbeiten mit vielen Sendern. */
function defaultRf433(deviceId) {
  return /^0bc7:/.test(String(deviceId || ''));
}

ControllerX10Remote.prototype.receiverByDevice = async function (deviceId) {
  return (await this.receivers.list()).filter(function (r) { return r.device.id === deviceId; })[0] || null;
};

/** Empfaenger-Eintrag zu einem USB-Geraet liefern, bei Bedarf anlegen (Name = Geraetename). */
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
 * 0.57.0 legte Empfaenger unter X10/_receivers/<kurzform> ab. Ab 0.58.0 liegt jeder Empfaenger in genau einem
 * Ordner direkt in X10, der wie der Empfaenger heisst. Alte Ordner werden einmalig verschoben.
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

/** Beim Start: fuer jedes Geraet, das ein Profil verwendet, einen Empfaenger-Eintrag sicherstellen. */
ControllerX10Remote.prototype.ensureReceivers = async function () {
  await this.migrateReceiverFolders().catch(function () { /* weiter mit dem, was da ist */ });
  var count = {};
  var names = {};
  (await this.store.list()).forEach(function (p) {
    profilesLib.receiversOf(p).forEach(function (d) {
      count[d] = (count[d] || 0) + 1;
      if (!names[d] && p.device && p.device.id === d && p.device.name) names[d] = p.device.name;
    });
  });
  var devices = Object.keys(count);
  for (var i = 0; i < devices.length; i++) {
    var d = devices[i];
    // mehrere Sender an einem Empfaenger gab es schon: als 433-MHz-Empfaenger uebernehmen
    await this.ensureReceiver(d, names[d], count[d] > 1 || defaultRf433(d));
  }
};

/** Sender (Profile), die einem Empfaenger zugeordnet sind. */
ControllerX10Remote.prototype.transmittersOf = async function (deviceId, excludeId) {
  return (await this.store.list()).filter(function (p) {
    return p.id !== excludeId && profilesLib.receiversOf(p).indexOf(deviceId) !== -1;
  });
};

/** Ein Empfaenger ohne 433-MHz-Haken gehoert genau einem Sender. */
ControllerX10Remote.prototype.checkReceiverRules = async function (devices, ownId, usbName) {
  for (var i = 0; i < devices.length; i++) {
    var rec = await this.ensureReceiver(devices[i], i === 0 ? usbName : '');
    if (rec.rf433) continue;
    var others = await this.transmittersOf(devices[i], ownId);
    if (others.length) throw HttpError(409, 'receiver_taken', rec.name + ' → ' + others[0].name);
  }
};

/** Auswahlliste fuer die Profilseite: alle Empfaenger mit Belegung. */
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

/** Empfaenger anlegen (aus der Geraeteauswahl) oder aendern. Ein Eintrag je USB-Geraet. */
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
 * Triggerhappy-Tasten, die schon eine andere Taste verwendet (Auswahlliste: ausgegraut).
 * Beruecksichtigt: fest gewaehlte Tasten von Scan-Code-Tasten anderer Profile, die aktiv sind oder einen
 * Empfaenger mit diesem Profil teilen. Tasten des eigenen Profils prueft die Oberflaeche selbst (ungespeichert).
 */
ControllerX10Remote.prototype.webThdUsed = async function (q) {
  var exclude = String(q.get('exclude') || '');
  var devices = String(q.get('devices') || '').split(',').map(profilesLib.normDeviceId).filter(function (d) { return profilesLib.DEVICE_RE.test(d); });
  var ids = this.activeIds();
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

// ================================================================= Radiosender

/** Ein Profil mit doppelt gewaehlten Triggerhappy-Tasten darf nicht aktiv sein. */
ControllerX10Remote.prototype.assertNoDuplicates = function (p) {
  var dup = profilesLib.thdDuplicates(p);
  if (dup.length) {
    throw HttpError(409, 'thd_duplicate', dup.map(function (d) { return d.key + ': ' + d.names.join(', '); }).join('; '));
  }
};

/** Neue Logos aus den Tasten nehmen (radio.logo_data) - sie werden nach dem Speichern als Datei abgelegt. */
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
 * Senderlogos im Profilordner ablegen (logo-<hash>.<ext>, Inhalt per Dateisignatur geprueft) und
 * nicht mehr verwendete Logos entfernen.
 */
ControllerX10Remote.prototype.storeLogos = async function (profile, logos) {
  var self = this;
  var dir = self.store.dirOf(profile.id);
  var changed = false;
  for (var i = 0; i < logos.length; i++) {
    var k = profile.keys[logos[i].index];
    if (!k || !k.radio) continue;
    if (logos[i].data === '') { k.radio.logo = null; changed = true; continue; }      // Logo entfernt
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

/** Katalog aller Radiosender neu schreiben (verzoegert, nach Aenderungen an Profilen). */
ControllerX10Remote.prototype.scheduleCatalog = function () {
  var self = this;
  clearTimeout(self.catalogTimer);
  self.catalogTimer = setTimeout(function () {
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

/** radiopresets.txt einmalig nach /data/INTERNAL/X10 legen; dort frei bearbeitbar, wird nie ueberschrieben. */
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

/** Einzelne Sender-URIs pruefen (Dialog "Radiosender"). */
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

/** Alle in Profilen verwendeten Webradio-URIs pruefen und einen Textbericht in /data/INTERNAL/X10 ablegen. */
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
 * Sender eines Profils zu Volumios "Meine Webradios" hinzufuegen - ueber Volumios eigene Funktion
 * addToMyWebRadio (richtiges Format, auch mit MyVolumio-Cloud). Vorher Sicherung der Datei.
 * Gleicher Name mit anderer URI: zusaetzlicher Eintrag "Name (X10)". Gleiche URI: wird uebersprungen.
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
  // Sicherung
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

// ================================================================= Vorlagen

/** Text einer Vorlage in der gewuenschten Sprache ({de, en, ...} oder einfacher Text). */
function presetText(v, lang) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  return String(v[lang] || v.en || v.de || v[Object.keys(v)[0]] || '');
}

ControllerX10Remote.prototype.presetDir = function (id) {
  if (!profilesLib.ID_RE.test(String(id || ''))) throw HttpError(400, 'preset_id_invalid');
  return path.join(__dirname, C.PRESET_DIR, id);
};

ControllerX10Remote.prototype.readPreset = async function (id) {
  try {
    var raw = JSON.parse(await fsp.readFile(path.join(this.presetDir(id), 'preset.json'), 'utf8'));
    if (!raw || !Array.isArray(raw.keys) || !Array.isArray(raw.receivers)) return null;
    raw.id = id;
    return raw;
  } catch (e) {
    if (e.status) throw e;
    if (e.code !== 'ENOENT') this.logger.warn(C.LOG_PREFIX + 'preset ' + id + ' unreadable: ' + e.message);
    return null;
  }
};

ControllerX10Remote.prototype.presetIds = async function () {
  try {
    return (await fsp.readdir(path.join(__dirname, C.PRESET_DIR), { withFileTypes: true }))
      .filter(function (d) { return d.isDirectory() && profilesLib.ID_RE.test(d.name); }).map(function (d) { return d.name; }).sort();
  } catch (e) {
    return [];
  }
};

/** Bilder der Vorlagen fuer /pimg/<id>/<n> (nur Dateinamen image1..6 aus dem Plugin-Ordner). */
ControllerX10Remote.prototype.presetImages = function () {
  var self = this;
  return {
    imageFile: async function (id, slot) {
      var p = await self.readPreset(id);
      var file = p && Array.isArray(p.images) ? p.images[parseInt(slot, 10) - 1] : null;
      if (!file || !/^image[1-6]\.(jpg|png|webp)$/.test(file)) return null;
      var ext = file.split('.').pop();
      return { path: path.join(self.presetDir(id), file), mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext };
    }
  };
};

ControllerX10Remote.prototype.webPresets = async function (lang) {
  lang = this.languages().indexOf(lang) !== -1 ? lang : this.langCode();
  var ids = await this.presetIds();
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var p = await this.readPreset(ids[i]);
    if (!p) continue;
    out.push({
      id: p.id, name: presetText(p.name, lang), description: presetText(p.description, lang), rf433: p.rf433 === true,
      receivers: p.receivers.map(function (r) { return { device: r.device, name: presetText(r.name, lang), rf433: r.rf433 === true }; }),
      keys: p.keys.length, images: (p.images || []).map(function (x) { return !!x; })
    });
  }
  return out;
};

/** Profil aus einer Vorlage anlegen: Texte in der Volumio-Sprache, Beschriftungen unveraendert, Bilder kopiert. */
ControllerX10Remote.prototype.webCreateFromPreset = async function (id, activate) {
  var self = this;
  var lang = self.langCode();
  var p = await self.readPreset(id);
  if (!p) throw HttpError(404, 'preset_not_found');
  var devices = [];
  for (var i = 0; i < p.receivers.length; i++) {
    var r = p.receivers[i];
    await self.ensureReceiver(profilesLib.normDeviceId(r.device), presetText(r.name, lang), r.rf433 === true);
    devices.push(profilesLib.normDeviceId(r.device));
  }
  var input = {
    name: presetText(p.name, lang),
    description: presetText(p.description, lang),
    notes: presetText(p.notes, lang),
    rf433: p.rf433 === true,
    device: { id: devices[0], name: presetText(p.receivers[0].usb_name || p.receivers[0].name, lang) },
    receivers: p.rf433 === true ? devices : devices.slice(0, 1),
    keys: p.keys.map(function (k) {
      return Object.assign({}, k, { id: undefined, name: presetText(k.name, lang), description: presetText(k.description, lang),
        remote_label: typeof k.remote_label === 'string' ? k.remote_label : '' });      // Beschriftung: nie uebersetzt
    })
  };
  var res = await self.webSaveProfile(input, activate);
  var images = Array.isArray(p.images) ? p.images : [];
  for (var n = 0; n < images.length && n < C.LIMITS.IMAGE_SLOTS; n++) {
    if (!images[n] || !/^image[1-6]\.(jpg|png|webp)$/.test(images[n])) continue;
    await self.store.setImageFile(res.id, n + 1, path.join(self.presetDir(id), images[n])).catch(function (e) {
      self.logger.warn(C.LOG_PREFIX + 'preset image ' + images[n] + ': ' + e.message);
    });
  }
  self.refreshUI();
  return { id: res.id, active: res.active, problems: res.problems };
};

/**
 * Druck-/Kopierliste eines Profils: je Taste Beschriftung, Beschreibung, tatsaechlicher Befehl,
 * Signal (Scan-Code / KEY_*) und Triggerhappy-Taste. Fuer inaktive Profile wird die Belegung berechnet,
 * als waere nur dieses Profil aktiv.
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
    : triggers.buildMappings([p], self.allowShell(), other).mappings;
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
 * Befehlsreferenz: /data/INTERNAL/X10/command reference.txt (vom Nutzer erweiterbar).
 * Vorlagen je Sprache im Plugin: command_reference_<sprache>.txt (Englisch als Rueckfall).
 * Solange die Datei unveraendert einer Vorlage entspricht, wird sie in der gewaehlten Sprache angezeigt
 * und beim Start an die Sprache von Volumio angepasst; eine selbst geaenderte Datei bleibt immer unberuehrt.
 */
ControllerX10Remote.prototype.cmdRefTemplate = function (lang) {
  var file = path.join(__dirname, C.CMDREF_TEMPLATE.replace('{lang}', lang));
  if (/^[a-z]{2}$/.test(String(lang)) && fs.existsSync(file)) return file;
  return path.join(__dirname, C.CMDREF_TEMPLATE.replace('{lang}', 'en'));
};

function sha256(buf) {
  return require('crypto').createHash('sha256').update(buf).digest('hex');
}

/** Hashes aller bekannten, unveraenderten Vorlagen (fruehere Versionen + alle aktuellen Sprachen). */
ControllerX10Remote.prototype.cmdRefTemplateHashes = function () {
  var self = this;
  if (self._cmdRefHashes) return self._cmdRefHashes;
  var hashes = C.CMDREF_OLD_TEMPLATES.slice();
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
 * Befehlsreferenz in /data/INTERNAL/X10 anlegen (Sprache von Volumio). Eine vorhandene Datei wird nur ersetzt,
 * wenn sie byte-genau einer Vorlage entspricht (also nie vom Nutzer geaendert wurde) - z. B. nach einem
 * Sprachwechsel oder einer neuen Vorlage.
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
  var prof = await this.store.get(id);
  if (!prof) throw HttpError(404, 'profile_not_found');
  if (active) this.assertNoDuplicates(prof);
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

/** Erfassung fuer den Assistenten: identify = alle Geraete beobachten, start = ein Geraet exklusiv einlesen. */
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
    // Waehrend des Erkennens werden alle Eingabegeraete exklusiv gelesen: kein Tastendruck loest etwas aus
    // (z. B. Ausschalttaste), auch nicht ueber audio.conf oder systemd-logind.
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
 * Wartet (max. 3 s), bis der Mapper die Erfassung uebernommen hat, und meldet, ob alle betroffenen
 * Eingabegeraete exklusiv gelesen werden. ok=false: Tasten koennten waehrend des Einlesens etwas ausloesen.
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
  var devs = (st.open || []).filter(function (o) { return device === '*' || o.id === device; });
  return {
    ok: devs.length > 0 && devs.every(function (o) { return o.grabbed; }),
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

// ============================================================ Volumio-Einstellungen

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
      case 'debounce_ms': el.value = self.numConf('debounce_ms', 300, 0, 2000); break;
      case 'repeat_ms': el.value = self.numConf('repeat_ms', 150, 50, 2000); break;
      case 'ignore_scancodes': el.value = String(self.config.get('ignore_scancodes') || ''); break;
      case 'expert_mode': el.value = self.expertMode(); break;
      case 'allow_shell': el.value = self.allowShell(); break;
      case 'log_presses': el.value = self.config.get('log_presses') === true; break;
      case 'web_port': el.value = self.webPortSetting(); break;
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
  });

  var prof = section('section_profiles');
  var list = await self.store.list().catch(function () { return []; });
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
  self.config.set('enabled', !!data.enabled);
  if (data.watchdog !== undefined) self.config.set('watchdog', !!data.watchdog);
  ['debounce_ms', 'repeat_ms', 'web_port'].forEach(function (k) {
    var v = parseInt(data[k], 10);
    if (!isNaN(v)) self.config.set(k, v);
  });
  if (data.ignore_scancodes !== undefined) {
    self.config.set('ignore_scancodes', String(data.ignore_scancodes).replace(/[^0-9a-fx,; ]/gi, '').trim());
  }
  self.config.set('log_presses', !!data.log_presses);

  return kew((async function () {
    if (self.webPortSetting() !== oldPort) await self.web.start(self.webPortSetting(), C.DEFAULT_EVENT_PORT);
    await self.apply();
    if (self.isEnabled() && !wasEnabled) await self.systemctl(['restart', C.SERVICE]);
    if (!self.isEnabled() && wasEnabled) {
      self.clearCapture();
      await self.systemctl(['stop', C.SERVICE]);
    }
    await self.updateWatchdog();
    self.toast('success', self.t('SAVED'));
    self.refreshUI();
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

/**
 * Abschnitt "Expertenmodus": Schalter Expertenmodus, eigene Befehle, Triggerhappy exklusiv (+ Wartezeit).
 * Eigene Befehle werden erst nach Bestaetigung eines Hinweises auf die Risiken eingeschaltet.
 * Expertenmodus aus -> eigene Befehle und Exklusivbetrieb aus.
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

/** Hinweis auf die Risiken eigener Befehle mit "Trotzdem aktivieren" / "Abbrechen". */
ControllerX10Remote.prototype.showShellRisks = function () {
  var self = this;
  var li = ['SHELL_RISK_1', 'SHELL_RISK_2', 'SHELL_RISK_3', 'SHELL_RISK_4', 'SHELL_RISK_5']
    .map(function (k) { return '<li>' + escapeHtml(self.t(k)) + '</li>'; }).join('');
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

/** Auswahlliste "Aktives Profil": Vanilla, jedes Profil, ggf. "mehrere aktiv". */
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

/** Genau ein Profil aktivieren - oder keines (Vanilla: nur audio.conf). */
ControllerX10Remote.prototype.selectProfile = async function (id) {
  if (id === VANILLA_ID) {
    this.setActiveIds([]);
  } else {
    if (!profilesLib.ID_RE.test(String(id || '')) || !(await this.store.get(id))) throw HttpError(404, 'profile_not_found');
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

/** systemd-Zustand (active, inactive, failed …) in der Sprache von Volumio. */
ControllerX10Remote.prototype.stateText = function (state, lang) {
  var s = String(state || '').trim().toLowerCase();
  var key = 'STATE_' + (/^(active|inactive|failed|activating|deactivating|reloading)$/.test(s) ? s.toUpperCase() : 'UNKNOWN');
  return this.t(key, null, lang);
};

/**
 * Vom Plugin erzeugte Beschreibung des X10-Standardprofils in der gewaehlten Sprache anzeigen
 * (sie wurde beim Anlegen in der damaligen Sprache gespeichert). Eigene Texte bleiben unveraendert.
 */
ControllerX10Remote.prototype.localizeDescription = function (desc, lang) {
  var self = this;
  if (!desc) return desc;
  var known = self.languages().some(function (l) { return self.t('DEFAULT_PROFILE_DESC', null, l) === desc; });
  return known ? self.t('DEFAULT_PROFILE_DESC', null, lang) : desc;
};

ControllerX10Remote.prototype.problemText = function (p) {
  return this.t('PROBLEM_' + String(p.code).toUpperCase(), { profile: p.profile || '', key: p.key || '', other: p.other || '' });
};

ControllerX10Remote.prototype.openAddresses = function () {
  var self = this;
  var lines = self.baseUrls().map(function (u) {
    return '<p style="font-size:18px;font-weight:bold;user-select:all">' + escapeHtml(u) + '/</p>';
  }).join('');
  var warn = self.web.port ? '' : '<p style="color:#d9534f">' + escapeHtml(self.t('WEB_NOT_RUNNING', { error: self.web.error || '' })) + '</p>';
  self.modal(self.t('WEB_TITLE'), warn + '<p>' + escapeHtml(self.t('ADDRESSES_INFO')) + '</p>' + lines);
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
  // ohne sudo lesen; fehlt das Leserecht aufs Journal, die Meldungen ueber "systemctl status" holen
  // (sudo nur fuer systemctl - Volumio-Regel)
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

/** Welche Befehle aus audio.conf (und anderen Dateien) werden fuer welche Fernbedienung ersetzt? */
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
    self.config.set('migrated', false);
    self.config.set('mappings', '');
    await self.migrate();
    await self.apply();
    self.toast('success', self.t('DEFAULT_CREATED'));
    self.refreshUI();
  })().catch(function (e) {
    self.toast('error', self.t('ERROR') + ': ' + e.message);
  }));
};

/** Eigenstaendiger Wrapper (ohne Plugin) als .tar.gz in /data/INTERNAL. */
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
