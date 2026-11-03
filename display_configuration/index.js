'use strict';
// Display Configuration: the Volumio plugin shell. Loads the settings, probes the
// device, plans and applies the active profile, serves the settings page and its
// saves. Everything device-independent is in lib/ and tested on its own; this file
// is the wiring to Volumio and to the runners.

const libQ = require('kew');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const VConf = require('v-conf');
const P = require('./lib/profile');
const UI = require('./lib/ui');
const G = require('./lib/grub');
const S = require('./lib/syslinux');
const { createRunners } = require('./lib/runners');
const { createStore } = require('./lib/backup');

const PLUGIN_TYPE = 'user_interface';
const PLUGIN_NAME = 'display_configuration';
const ENDPOINT = PLUGIN_TYPE + '/' + PLUGIN_NAME;
const NS = 'DISPLAY_CONFIGURATION';
const LOG = '[display_configuration] ';
const VERSION = require('./package.json').version;
const DIAGNOSTICS_PATH = '/tmp/volumio-display-diagnostics.txt';
const X_POLL_MS = 5000;
const X_SETTLE_MS = 4000;
const LID_POLL_MS = 2000;

module.exports = DisplayConfiguration;

function DisplayConfiguration(context) {
   this.context = context;
   this.commandRouter = context.coreCommand;
   this.logger = this.commandRouter.logger;
   this.config = new VConf();
   this.cfg = P.defaults();
   this.runners = createRunners({ log: (m) => this.logger.warn(LOG + m) });
   this.store = createStore();
   this.active = false;
   this.playing = false;
   this.lastProbe = null;
   this.lastPlan = null;
   this.lastReport = null;
   this.applying = null;
   this.applyQueued = false;
   this.xPid = null;
   this.timers = [];
   this.en = null;
}

// ------------------------------------------------------------------ lifecycle

DisplayConfiguration.prototype.onVolumioStart = function () {
   this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
   this.config.loadFile(this.configFile);
   return libQ.resolve();
};

DisplayConfiguration.prototype.onStart = function () {
   const self = this;
   self.active = true;
   self.commandRouter.loadI18nStrings();
   self.loadState();
   self.subscribeState();
   self.watchX();
   self.watchLid();
   // The boot file and the Xorg snippets do not need X; the rest is applied by the
   // watcher as soon as the X server is seen, now or when the kiosk brings it up.
   self.applyAll('start').catch((e) => self.logger.error(LOG + 'start: ' + (e && e.message ? e.message : e)));
   return libQ.resolve();
};

DisplayConfiguration.prototype.onStop = function () {
   this.active = false;
   this.timers.forEach(clearInterval);
   this.timers = [];
   this.unsubscribeState();
   // rotation.cfg stays: the boot is what the user last chose; uninstall.sh removes it.
   return libQ.resolve();
};

DisplayConfiguration.prototype.onRestart = function () { return libQ.resolve(); };

DisplayConfiguration.prototype.getConfigurationFiles = function () { return ['config.json']; };

DisplayConfiguration.prototype.getI18nFile = function (langCode) {
   const file = path.join(__dirname, 'i18n', 'strings_' + langCode + '.json');
   return fs.existsSync(file) ? file : path.join(__dirname, 'i18n', 'strings_en.json');
};

// ------------------------------------------------------------------ settings

// The whole configuration is one JSON document in the v-conf key "state" (v-conf
// stores scalars only). A 0.0.x config.json (flat keys) is recognised and migrated once.
DisplayConfiguration.prototype.loadState = function () {
   const raw = this.config.get('state', '');
   if (typeof raw === 'string' && raw.trim() !== '') {
      try { this.cfg = P.validate(JSON.parse(raw)); return; }
      catch (e) {
         this.logger.error(LOG + 'settings unreadable, starting from the defaults: ' + e.message);
         try { fs.outputFileSync(path.join(this.store.dir, 'unreadable-' + Date.now() + '.txt'), raw); } catch (e2) { /* nothing to keep */ }
      }
   } else if (P.isLegacy(this.config.data)) {
      try {
         this.cfg = P.migrateFrom043(this.config.data);
         for (const key of Object.keys(this.config.data)) if (key !== 'state') this.config.delete(key);
         this.saveState(this.cfg);
         this.logger.info(LOG + 'settings migrated from the 0.0.x plugin');
         return;
      } catch (e) { this.logger.error(LOG + 'migration failed, starting from the defaults: ' + e.message); }
   }
   this.cfg = P.defaults();
   this.saveState(this.cfg);
};

DisplayConfiguration.prototype.saveState = function (cfg) {
   this.cfg = P.validate(cfg);
   this.config.set('state', JSON.stringify(this.cfg));
   this.config.save();
};

DisplayConfiguration.prototype.profile = function () { return this.cfg.profiles[this.cfg.activeProfile]; };

DisplayConfiguration.prototype.debug = function (text) { if (this.cfg.debug) this.logger.info(LOG + text); };

// ------------------------------------------------------------------ apply

// Probe, plan, apply; one at a time, a save during an apply runs once more after it.
DisplayConfiguration.prototype.applyAll = function (reason) {
   const self = this;
   if (self.applying) { self.applyQueued = true; return self.applying; }
   self.applying = (async () => {
      const probe = await self.runners.probe();
      self.lastProbe = probe;
      const plan = P.plan(self.cfg, probe);
      self.lastPlan = plan;
      const report = await self.runners.apply(plan, probe, { playing: self.playing });
      self.lastReport = report;
      self.debug('apply (' + reason + '): ' + report.commands.map((c) => c.join(' ')).join(' | '));
      for (const w of report.warnings) self.logger.warn(LOG + w);
      for (const e of report.errors) self.logger.error(LOG + e);
      return report;
   })().finally(() => {
      self.applying = null;
      if (self.applyQueued) { self.applyQueued = false; self.applyAll('queued').catch(() => undefined); }
   });
   return self.applying;
};

// The X server comes up after this plugin (the kiosk waits for Volumio) and comes up
// again whenever the kiosk restarts; each new server needs the turn and the session
// settings again. The InputClass holds the touch matrices on its own.
DisplayConfiguration.prototype.watchX = function () {
   const self = this;
   const tick = async () => {
      if (!self.active) return;
      const pid = await self.runners.xServerPid();
      if (pid === self.xPid) return;
      const was = self.xPid;
      self.xPid = pid;
      if (pid === null) { self.debug('X server gone'); return; }
      self.debug('X server ' + (was === null ? 'up' : 'restarted') + ' (pid ' + pid + ')');
      setTimeout(() => { if (self.active && self.xPid === pid) self.applyAll('x up').catch(() => undefined); }, X_SETTLE_MS).unref();
   };
   // The server already up at start is handled by the start apply; the watcher takes
   // it from there.
   self.runners.xServerPid().then((pid) => {
      self.xPid = pid;
      if (self.active) self.timers.push(setInterval(tick, X_POLL_MS).unref());
   });
};

// A laptop lid: closed turns the panel off, opened turns it on. Nothing where no lid.
DisplayConfiguration.prototype.watchLid = function () {
   const self = this;
   const dir = '/proc/acpi/button/lid';
   let lids = [];
   try { lids = fs.readdirSync(dir).map((l) => path.join(dir, l, 'state')).filter((f) => fs.existsSync(f)); } catch (e) { lids = []; }
   if (!lids.length) return;
   let closed = false;
   const tick = () => {
      let now = false;
      for (const f of lids) { try { if (/closed/i.test(fs.readFileSync(f, 'utf8'))) now = true; } catch (e) { /* lid read failed; unchanged */ } }
      if (now === closed) return;
      closed = now;
      self.debug('lid ' + (closed ? 'closed' : 'opened'));
      (closed ? self.runners.screenOff() : self.runners.screenOn()).catch(() => undefined);
   };
   this.timers.push(setInterval(tick, LID_POLL_MS).unref());
};

// ------------------------------------------------------------------ player state

DisplayConfiguration.prototype.subscribeState = function () {
   if (this.stateCallback) return;
   this.stateCallback = (state) => this.onVolumioState(state);
   this.commandRouter.addCallback('volumioPushState', this.stateCallback);
   try { this.onVolumioState(this.commandRouter.volumioGetState()); } catch (e) { /* no state yet */ }
};

// The backend has no removeCallback; a left-over closure would outlive this instance.
DisplayConfiguration.prototype.unsubscribeState = function () {
   const all = this.commandRouter.callbacks;
   if (this.stateCallback && all && Array.isArray(all.volumioPushState)) {
      all.volumioPushState = all.volumioPushState.filter((f) => f !== this.stateCallback);
   }
   this.stateCallback = null;
};

DisplayConfiguration.prototype.onVolumioState = function (state) {
   const playing = Boolean(state && state.status === 'play');
   if (playing === this.playing) return;
   this.playing = playing;
   const p = this.profile();
   if (!p.screensaver.notWhilePlaying || !this.lastProbe || !this.lastProbe.xAvailable || this.applying) return;
   const report = { warnings: [] };
   this.runners.applyScreensaver(Object.assign({ action: 'screensaver' }, p.screensaver), this.lastProbe, report, { playing })
      .then(() => this.debug('screensaver ' + (playing ? 'held off while playing' : 'armed')))
      .catch((e) => this.logger.warn(LOG + 'screensaver: ' + e.message));
};

// ------------------------------------------------------------------ settings page

DisplayConfiguration.prototype.t = function (key, vars) {
   let s = this.commandRouter.getI18nString(NS + '.' + key);
   if (s === NS + '.' + key || s === key) {
      if (!this.en) { try { this.en = fs.readJsonSync(path.join(__dirname, 'i18n', 'strings_en.json'))[NS]; } catch (e) { this.en = {}; } }
      s = this.en[key] || key;
   }
   if (vars) Object.keys(vars).forEach((k) => { s = s.split('{{' + k + '}}').join(String(vars[k])); });
   return s;
};

DisplayConfiguration.prototype.toast = function (type, key, vars) {
   this.commandRouter.pushToastMessage(type, this.t('PLUGIN_NAME'), this.t(key, vars));
};

DisplayConfiguration.prototype.getUIConfig = function () {
   const self = this;
   const defer = libQ.defer();
   const lang = self.commandRouter.sharedVars.get('language_code');
   self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'), path.join(__dirname, 'i18n', 'strings_en.json'), path.join(__dirname, 'UIConfig.json'))
      .then((template) => self.runners.probe().then((probe) => {
         self.lastProbe = probe;
         const ui = UI.build(template, { cfg: self.cfg, probe, backups: self.store.list(), t: self.t.bind(self), endpoint: ENDPOINT, tools: probe.tools });
         defer.resolve(ui);
      }))
      .fail((e) => { self.logger.error(LOG + 'settings page: ' + (e && e.message ? e.message : e)); defer.reject(new Error()); });
   return defer.promise;
};

DisplayConfiguration.prototype.refreshUi = function () {
   const self = this;
   if (typeof self.commandRouter.getUIConfigOnPlugin !== 'function') return libQ.resolve();
   return self.commandRouter.getUIConfigOnPlugin(PLUGIN_TYPE, PLUGIN_NAME, {})
      .then((ui) => { self.commandRouter.broadcastMessage('pushUiConfig', ui); })
      .fail(() => undefined);
};

// Validate, save, apply, tell the user, refresh the page. `mutate` edits a copy of
// the configuration; a validation error leaves the saved settings untouched.
DisplayConfiguration.prototype.commit = function (mutate, { successKey = 'APPLIED', successVars = {}, apply = true } = {}) {
   const self = this;
   const defer = libQ.defer();
   let next;
   try {
      next = JSON.parse(JSON.stringify(self.cfg));
      const r = mutate(next);
      if (r && r.error) { self.toast('error', r.error, r.vars); defer.resolve(); return defer.promise; }
      if (r && r.successKey) { successKey = r.successKey; successVars = r.vars || {}; }
      self.saveState(next);
   } catch (e) {
      self.toast('error', 'ERR_INVALID', { text: e.message });
      defer.resolve();
      return defer.promise;
   }
   const done = (report) => {
      if (report && report.errors.length) self.toast('error', 'APPLY_FAILED', { text: report.errors.join('; ') });
      else {
         const key = report && report.rebootNeeded && successKey === 'APPLIED' ? 'APPLIED_REBOOT' : successKey;
         const warnings = report ? report.warnings.join(' ') : '';
         self.commandRouter.pushToastMessage(warnings ? 'warning' : 'success', self.t('PLUGIN_NAME'), self.t(key, successVars) + (warnings ? ' ' + warnings : ''));
      }
      if (report && report.geometryChanged) self.commandRouter.reloadUi();
      return self.refreshUi();
   };
   (apply ? self.applyAll('save') : Promise.resolve(null))
      .then(done, (e) => { self.toast('error', 'APPLY_FAILED', { text: e.message }); return self.refreshUi(); })
      .then(() => defer.resolve(), () => defer.resolve());
   return defer.promise;
};

// ---- saves, one per section

DisplayConfiguration.prototype.saveProfiles = function (data) {
   const { action, profile, mode, name } = UI.readProfiles(data || {});
   return this.commit((cfg) => {
      if (!cfg.profiles[profile]) return { error: 'ERR_INVALID', vars: { text: 'unknown profile' } };
      const nameOk = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(name);
      if (action === 'use') { cfg.activeProfile = profile; cfg.profiles[profile].mode = mode; return { successKey: 'PROFILE_SWITCHED', vars: { name: profile } }; }
      if (action === 'copy') {
         if (!nameOk) return { error: 'ERR_PROFILE_NAME' };
         if (cfg.profiles[name]) return { error: 'ERR_PROFILE_EXISTS', vars: { name } };
         cfg.profiles[name] = Object.assign(JSON.parse(JSON.stringify(cfg.profiles[profile])), { name, mode });
         cfg.activeProfile = name;
         return { successKey: 'PROFILE_COPIED', vars: { name } };
      }
      if (action === 'rename') {
         if (!nameOk) return { error: 'ERR_PROFILE_NAME' };
         if (name !== profile && cfg.profiles[name]) return { error: 'ERR_PROFILE_EXISTS', vars: { name } };
         const p = cfg.profiles[profile]; delete cfg.profiles[profile]; p.name = name; p.mode = mode; cfg.profiles[name] = p;
         if (cfg.activeProfile === profile) cfg.activeProfile = name;
         return { successKey: 'PROFILE_RENAMED', vars: { name } };
      }
      if (action === 'delete') {
         if (Object.keys(cfg.profiles).length <= 1) return { error: 'ERR_PROFILE_LAST' };
         delete cfg.profiles[profile];
         if (cfg.activeProfile === profile) cfg.activeProfile = Object.keys(cfg.profiles).sort()[0];
         return { successKey: 'PROFILE_DELETED', vars: { name: profile } };
      }
      return { error: 'ERR_INVALID', vars: { text: 'unknown action ' + action } };
   });
};

// The fields of one screen carry its connector name; a single screen's settings go
// to the "*" entry it was read from, so they follow the screen to another port.
DisplayConfiguration.prototype.saveOutput = function (data) {
   const outputs = this.lastProbe ? this.lastProbe.outputs.filter((o) => o.connected) : [];
   return this.commit((cfg) => {
      const p = cfg.profiles[cfg.activeProfile];
      let touched = 0;
      for (const out of outputs) {
         const o = UI.readOutput(data || {}, out.name, out);
         if (!o) continue;
         touched += 1;
         if (p.outputs[out.name]) p.outputs[out.name] = o;
         else if (outputs.length === 1 && p.outputs[P.ANY]) p.outputs[P.ANY] = o;
         else p.outputs[out.name] = o;
      }
      if (!touched) return { error: 'ERR_NO_X' };
      return null;
   });
};

DisplayConfiguration.prototype.saveInputs = function (data) {
   const inputs = this.lastProbe ? this.lastProbe.inputs : [];
   return this.commit((cfg) => {
      const p = cfg.profiles[cfg.activeProfile];
      const read = UI.readInputs(data || {}, inputs);
      for (const dev of inputs) {
         const want = read[dev.name];
         if (!want) continue;
         const generic = dev.kind === 'relative' ? 'relative:*' : P.ANY;
         const alone = inputs.filter((d) => d.kind === dev.kind).length === 1;
         if (p.inputs[dev.name]) p.inputs[dev.name] = want;
         else if (alone && dev.kind !== 'pointer') p.inputs[generic] = want;
         else p.inputs[dev.name] = want;
      }
      return null;
   });
};

DisplayConfiguration.prototype.saveBoot = function (data) {
   return this.commit((cfg) => { cfg.profiles[cfg.activeProfile].boot = UI.readBoot(data || {}); return null; });
};

DisplayConfiguration.prototype.saveScreensaver = function (data) {
   return this.commit((cfg) => {
      const r = UI.readScreensaver(data || {});
      const p = cfg.profiles[cfg.activeProfile];
      p.screensaver = r.screensaver;
      p.brightness = r.brightness;
      return null;
   });
};

DisplayConfiguration.prototype.saveVirtual = function (data) {
   return this.commit((cfg) => { cfg.profiles[cfg.activeProfile].virtual = UI.readVirtual(data || {}); return null; });
};

DisplayConfiguration.prototype.saveMaintenance = function (data) {
   return this.commit((cfg) => { cfg.debug = data && (data.debug === true || data.debug === 'true'); return null; }, { successKey: 'SAVED', apply: false });
};

DisplayConfiguration.prototype.runBackup = function (data) {
   const self = this;
   const { action, name, selected } = UI.readBackup(data || {});
   const defer = libQ.defer();
   const finish = (p) => p.then(() => self.refreshUi()).then(() => defer.resolve(), () => defer.resolve());
   try {
      if (action === 'create') {
         const n = name || self.store.suggestName();
         self.store.write(n, self.cfg, { pluginVersion: VERSION, hostname: os.hostname() });
         self.toast('success', 'BACKUP_CREATED', { name: n });
         return finish(Promise.resolve());
      }
      if (action === 'delete') {
         if (!selected) { self.toast('error', 'ERR_BACKUP_CHOOSE'); return finish(Promise.resolve()); }
         try { self.store.remove(selected); } catch (e) { self.toast('error', 'ERR_BACKUP_MISSING'); return finish(Promise.resolve()); }
         self.toast('success', 'BACKUP_DELETED', { name: selected });
         return finish(Promise.resolve());
      }
      if (action === 'restore') {
         if (!selected) { self.toast('error', 'ERR_BACKUP_CHOOSE'); return finish(Promise.resolve()); }
         let back;
         try { back = self.store.read(selected); }
         catch (e) { self.toast('error', e.code === 'ENOENT' ? 'ERR_BACKUP_MISSING' : 'ERR_BACKUP_INVALID', { text: e.message }); return finish(Promise.resolve()); }
         return self.commit((cfg) => { Object.assign(cfg, back.config); return null; }, { successKey: 'BACKUP_RESTORED', successVars: { name: selected } }).then(() => defer.resolve());
      }
      if (action === 'reset') {
         return self.commit((cfg) => { Object.assign(cfg, P.defaults()); return null; }, { successKey: 'RESET_DONE' }).then(() => defer.resolve());
      }
      self.toast('error', 'ERR_INVALID', { text: 'unknown action ' + action });
   } catch (e) {
      self.toast('error', 'ERR_INVALID', { text: e.message });
   }
   return finish(Promise.resolve());
};

// ---- buttons

DisplayConfiguration.prototype.applyNow = function () {
   const self = this;
   const defer = libQ.defer();
   self.applyAll('button').then((report) => {
      if (report.errors.length) self.toast('error', 'APPLY_FAILED', { text: report.errors.join('; ') });
      else {
         const warnings = report.warnings.join(' ');
         self.commandRouter.pushToastMessage(warnings ? 'warning' : 'success', self.t('PLUGIN_NAME'), self.t(report.rebootNeeded ? 'APPLIED_REBOOT' : 'APPLIED') + (warnings ? ' ' + warnings : ''));
      }
      return self.refreshUi();
   }, (e) => self.toast('error', 'APPLY_FAILED', { text: e.message })).then(() => defer.resolve(), () => defer.resolve());
   return defer.promise;
};

DisplayConfiguration.prototype.restartKiosk = function () {
   const self = this;
   const defer = libQ.defer();
   self.runners.kiosk('restart').then((r) => {
      if (r.code === 0) self.toast('success', 'KIOSK_RESTARTING');
      else self.toast('error', 'KIOSK_RESTART_FAILED', { text: (r.stderr || r.error || '').trim() });
      defer.resolve();
   });
   return defer.promise;
};

DisplayConfiguration.prototype.screenOff = function () {
   const self = this;
   const defer = libQ.defer();
   self.runners.screenOff().then((r) => {
      if (r.code === 0) self.toast('success', 'SCREEN_OFF_DONE'); else self.toast('error', 'ERR_NO_X');
      defer.resolve();
   });
   return defer.promise;
};

DisplayConfiguration.prototype.openScreensaverSettings = function () {
   const self = this;
   const defer = libQ.defer();
   const tools = (self.lastProbe && self.lastProbe.tools) || {};
   if (!tools['xscreensaver-settings']) { self.toast('error', 'XSCREENSAVER_MISSING'); defer.resolve(); return defer.promise; }
   self.runners.openScreensaverSettings().then(() => { self.toast('success', 'XSCREENSAVER_OPENED'); defer.resolve(); });
   return defer.promise;
};

DisplayConfiguration.prototype.generateDiagnostics = function () {
   const self = this;
   const defer = libQ.defer();
   (async () => {
      const probe = await self.runners.probe();
      self.lastProbe = probe;
      const plan = P.plan(self.cfg, probe);
      const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'raw' || k === 'modes' ? undefined : v)));
      const tail = async (cmd, args) => { const r = await self.runners.run(cmd, args, { timeout: 8000 }); return r.code === 0 ? r.stdout : '(' + cmd + ': ' + (r.stderr || r.error || 'unavailable').trim() + ')'; };
      const sections = [
         ['Display Configuration ' + VERSION + ', ' + new Date().toISOString() + ', ' + os.hostname(), ''],
         ['Settings', JSON.stringify(self.cfg, null, 2)],
         ['Probe', JSON.stringify(strip(probe), null, 2)],
         ['Plan', JSON.stringify(plan, null, 2)],
         ['Last apply', JSON.stringify(self.lastReport, null, 2)],
         ['Kernel command line', probe.cmdline],
         ['Bootloader', probe.bootloader + (self.lastReport && self.lastReport.boot ? ', boot settings ' + (self.lastReport.boot.inEffect ? 'in effect' : 'not in effect (restart needed)') : '')],
         ['rotation.cfg', fs.existsSync(G.PATH) ? fs.readFileSync(G.PATH, 'utf8') : '(absent)'],
         ['syslinux.cfg', fs.existsSync(S.PATH) ? fs.readFileSync(S.PATH, 'utf8') : '(absent)'],
         ['xrandr --verbose', (probe.raw && probe.raw.xrandr) || '(no X)'],
         ['xinput list', (probe.raw && probe.raw.xinput) || '(no X)'],
         ['Xorg snippets', await tail('sh', ['-c', 'for f in /etc/X11/xorg.conf.d/*display-configuration*; do [ -f "$f" ] && { echo "== $f"; cat "$f"; }; done 2>/dev/null; true'])],
         ['volumio-kiosk.service', await tail('systemctl', ['status', '--no-pager', '-l', 'volumio-kiosk.service'])],
         ['Kiosk log', fs.existsSync('/var/log/volumiokiosk.log') ? fs.readFileSync('/var/log/volumiokiosk.log', 'utf8').split('\n').slice(-60).join('\n') : '(absent)'],
         ['Xorg log', fs.existsSync('/var/log/Xorg.0.log') ? fs.readFileSync('/var/log/Xorg.0.log', 'utf8').split('\n').filter((l) => /\(EE\)|\(WW\)|modeset|panel|rotat|TransformationMatrix|Calibration/i.test(l)).slice(-80).join('\n') : '(absent)'],
      ];
      const text = sections.map(([h, b]) => '==== ' + h + '\n' + (b || '').replace(/\s+$/, '') + '\n').join('\n');
      fs.outputFileSync(DIAGNOSTICS_PATH, text, { mode: 0o644 });
   })().then(() => self.toast('success', 'DIAGNOSTICS_WRITTEN', { path: DIAGNOSTICS_PATH }), (e) => self.toast('error', 'DIAGNOSTICS_FAILED', { text: e.message }))
      .then(() => defer.resolve(), () => defer.resolve());
   return defer.promise;
};
