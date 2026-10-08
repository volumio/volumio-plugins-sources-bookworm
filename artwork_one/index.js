'use strict';

/*
 * Artwork One — the interface as a Volumio plugin.
 *
 * Two jobs. The interface itself: static files under ui/, registered with Volumio as a third-party
 * interface on start (Settings → System → User Interface layout design), taken out again on stop.
 * And the place the interface keeps its settings: the theme (dark, light, system), the ambient
 * display and the pins — a set of static files has nowhere to keep anything, so a choice made in
 * one browser never reached another, and a display the player drives on HDMI could not be told
 * anything at all. The plugin answers a screen that asks and pushes every accepted change to all.
 *
 * Contract (the interface's side: core/store/companion.ts):
 *   callMethod user_interface/artwork_one getSettings {}             -> pushArtworkSettings to the caller
 *   callMethod user_interface/artwork_one setSettings {theme?, ambient?, pins?}
 *                                                                    -> pushArtworkSettings to everyone
 * A key is absent until someone chooses it. A partial payload never clears the other keys.
 * (The interface also asks the old endpoint miscellanea/artwork_companion, for a script install
 * that still has the Companion; whichever answers first is followed — core/store/companion.ts.)
 *
 * Volumio registers a third-party interface by path and never unregisters: an entry disappears
 * only when its folder is gone, and a second entry for the same name is added when the path
 * differs. So the plugin removes the script install's entry (/data/artwork-ui) when it starts,
 * and its own when it stops — switching the player to another interface first when it is the
 * active one, so nobody is left on a page that no longer exists.
 *
 * kew and v-conf, the only modules, are declared in package.json: Volumio installs them with the
 * plugin. A copy put in place by hand, without node_modules, gets them from the core tree.
 */

// kew and v-conf are declared in package.json (Volumio installs them with the plugin); the core
// tree is the fallback for a copy put in place by hand, without node_modules
function core(name) {
  try { return require(name); } catch (e) { return require('/volumio/node_modules/' + name); }
}
var libQ = core('kew');
var VConf = core('v-conf');
var fs = require('fs');
var path = require('path');

var THEMES = ['dark', 'light', 'system'];
var DELAYS = [-1, 0, 1, 2, 5, 10];   // -1: always in ambient
var TEXT_SIZES = ['s', 'm', 'l', 'xl'];
var LAYOUTS = ['cover', 'clock', 'bleed'];
var CLOCKS = ['24', '12'];
var EVENT = 'pushArtworkSettings';

var UI_NAME = 'artwork';
var UI_PRETTY_NAME = 'Artwork One';
// the files the plugin reads and writes (under a test root when the tests run)
var ROOT = process.env.ARTWORK_ONE_TEST_ROOT || '';
var PATHS = {
  UI_DIR: ROOT ? path.join(ROOT, 'ui') : path.join(__dirname, 'ui'),
  UI_LIST: ROOT + '/data/thirdPartyUisList.json',
  ACTIVE_UI: ROOT + '/data/active_volumio_ui',
  CORE_UI_LIST: ROOT + '/volumio/volumioUisList.json',
  SCRIPT_INSTALL: ROOT + '/data/artwork-ui',   // Artwork One 1.x–3.1 put by the older scripts/install.sh
  OLD_CONF: ROOT + '/data/configuration/miscellanea/artwork_companion/config.json'
};

module.exports = ArtworkOne;

function ArtworkOne(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;
  this.config = new VConf();
  this.paths = Object.assign({}, PATHS);
}

ArtworkOne.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ArtworkOne.prototype.onVolumioStart = function () {
  this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config.loadFile(this.configFile);
  return libQ.resolve();
};

ArtworkOne.prototype.onStart = function () {
  var self = this;
  try {
    self.takeOverScriptInstall();
    self.registerUI();
    self.comeBack();
  } catch (e) {
    self.logger.error('[artwork_one] start failed: ' + e);
    return libQ.reject(new Error('Artwork One could not register its interface: ' + e));
  }
  self.logger.info('[artwork_one] started; ' + JSON.stringify(self.snapshot()));
  return libQ.resolve();
};

// Stopped — disabled, uninstalled, or updated (the core stops a plugin before replacing its files
// and starts it again only with Volumio): the interface leaves Volumio's list, and a player showing
// it is switched to a core interface first, so nobody is left on a page nothing answers for. That
// it was the active one is remembered: the next start brings it back.
ArtworkOne.prototype.onStop = function () {
  var self = this;
  try {
    var active = self.isActive();
    if (active) { self.switchToCoreUI(); }
    self.config.set('wasActive', active);
    self.unregisterUI();
  } catch (e) { self.logger.error('[artwork_one] stop: ' + e); }
  return libQ.resolve();
};

// the player showed Artwork One when the plugin was last stopped (an update, or a disable the user
// has just undone): it does again, with the Appearance plugin's own switch when that one is up —
// a toast and a reload for the screens — and by hand when it is not yet (at boot nobody is watching)
ArtworkOne.prototype.comeBack = function () {
  if (!this.config.get('wasActive')) { return; }
  this.config.set('wasActive', false);
  if (this.isActive()) { return; }
  try { this.setActiveUI(UI_NAME); } catch (e) { this.logger.warn('[artwork_one] appearance switch: ' + e); }
  if (!this.isActive()) {
    this.writeJson(this.paths.ACTIVE_UI, this.uiEntry());
    process.env.VOLUMIO_ACTIVE_UI_PATH = this.paths.UI_DIR; process.env.VOLUMIO_ACTIVE_UI_NAME = UI_NAME; process.env.VOLUMIO_ACTIVE_UI_PRETTY_NAME = UI_PRETTY_NAME;
  }
  this.logger.info('[artwork_one] the player showed Artwork One before the stop: it does again');
};

// --- the interface in Volumio's list --------------------------------------------------------

ArtworkOne.prototype.uiEntry = function () { return { uiPrettyName: UI_PRETTY_NAME, uiName: UI_NAME, uiPath: this.paths.UI_DIR }; };

ArtworkOne.prototype.readJson = function (file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
};
ArtworkOne.prototype.writeJson = function (file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; }
  catch (e) { this.logger.error('[artwork_one] could not write ' + file + ': ' + e); return false; }
};

ArtworkOne.prototype.registerUI = function () {
  var hasUi = false;
  try { hasUi = fs.existsSync(path.join(this.paths.UI_DIR, 'index.html')); } catch (e) { hasUi = false; }
  if (!hasUi) { throw new Error('ui/index.html is missing'); }
  // Volumio adds by path and keeps every path: ours only once, and nothing else under our name
  var list = this.readJson(this.paths.UI_LIST, []);
  var dir = this.paths.UI_DIR;
  if (!Array.isArray(list)) { list = []; }
  list = list.filter(function (u) { return u && u.uiName !== UI_NAME && u.uiPath !== dir; });
  list.push(this.uiEntry());
  this.writeJson(this.paths.UI_LIST, list);
  this.commandRouter.registerThirdPartyUI(this.uiEntry());   // the core's own bookkeeping (a no-op now, the entry is there)
  this.logger.info('[artwork_one] interface registered at ' + this.paths.UI_DIR);
};

ArtworkOne.prototype.unregisterUI = function () {
  var list = this.readJson(this.paths.UI_LIST, []);
  var dir = this.paths.UI_DIR;
  if (!Array.isArray(list)) { return; }
  var kept = list.filter(function (u) { return u && u.uiPath !== dir; });
  if (kept.length !== list.length) { this.writeJson(this.paths.UI_LIST, kept); this.logger.info('[artwork_one] interface unregistered'); }
};

// Artwork One 1.x–3.1 was put in /data/artwork-ui by a script, with the same uiName: without this the
// interface would be listed twice, and the player might still serve the old files. The plugin takes
// the entry over (the files are left alone: the uninstaller of that install knows about them).
ArtworkOne.prototype.takeOverScriptInstall = function () {
  var active = this.readJson(this.paths.ACTIVE_UI, null);
  if (active && active.uiPath === this.paths.SCRIPT_INSTALL) {
    this.writeJson(this.paths.ACTIVE_UI, this.uiEntry());
    process.env.VOLUMIO_ACTIVE_UI_PATH = this.paths.UI_DIR; process.env.VOLUMIO_ACTIVE_UI_NAME = UI_NAME; process.env.VOLUMIO_ACTIVE_UI_PRETTY_NAME = UI_PRETTY_NAME;
    this.logger.info('[artwork_one] the active interface was the script install: now the plugin\'s');
  }
  // the old companion's settings come along, once
  var oldConf = this.paths.OLD_CONF;
  var hasOld = false;
  try { hasOld = !this.config.get('migrated') && fs.existsSync(oldConf); } catch (e) { hasOld = false; }
  if (hasOld) {
    var old = this.readJson(oldConf, {});
    var self = this;
    ['theme', 'ambient', 'pins'].forEach(function (k) { if (old[k] && old[k].value !== undefined && old[k].value !== '' && !self.config.get(k)) { self.config.set(k, old[k].value); } });
    this.config.set('migrated', true);
    this.logger.info('[artwork_one] settings taken over from the Artwork One Companion');
  }
};

// --- the active interface -------------------------------------------------------------------

ArtworkOne.prototype.isActive = function () {
  var active = this.readJson(this.paths.ACTIVE_UI, null);
  return !!(active && active.uiPath === this.paths.UI_DIR);
};

// the Appearance plugin's own switch: writes the flag file, updates the live env, pushes a toast, reloads every screen
ArtworkOne.prototype.setActiveUI = function (uiName) {
  return this.commandRouter.executeOnPlugin('miscellanea', 'appearance', 'setVolumio3UI', { volumio3_ui: { value: uiName } });
};

ArtworkOne.prototype.switchToCoreUI = function () {
  var core = this.readJson(this.paths.CORE_UI_LIST, []);
  var exists = function (p) { try { return fs.existsSync(p); } catch (e) { return false; } };
  var next = (Array.isArray(core) ? core : []).filter(function (u) { return u && u.uiName !== UI_NAME && u.uiPath && exists(u.uiPath); })[0];
  if (!next) { this.logger.warn('[artwork_one] no core interface found to switch to'); return; }
  this.logger.info('[artwork_one] switching the player to ' + next.uiPrettyName);
  this.setActiveUI(next.uiName);
};

// the button on the plugin's page
ArtworkOne.prototype.switchTo = function () {
  var self = this;
  try {
    if (self.isActive()) {
      self.commandRouter.pushToastMessage('info', UI_PRETTY_NAME, self.t('ACTIVE'));
      return libQ.resolve();
    }
    self.setActiveUI(UI_NAME);   // the entry is there since onStart; Appearance looks it up by name
  } catch (e) {
    self.logger.error('[artwork_one] switch: ' + e);
    self.commandRouter.pushToastMessage('error', UI_PRETTY_NAME, String(e.message || e));
  }
  return libQ.resolve();
};

ArtworkOne.prototype.t = function (key) {
  var lang = this.commandRouter.sharedVars.get('language_code');
  var strings = this.readJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'), null) || this.readJson(path.join(__dirname, 'i18n', 'strings_en.json'), {});
  return (strings.ARTWORK_ONE && strings.ARTWORK_ONE[key]) || key;
};
ArtworkOne.prototype.onRestart = function () {};

// --- the settings page: one line that says where the settings really are -------------------

ArtworkOne.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;
  var lang = this.commandRouter.sharedVars.get('language_code');
  this.commandRouter.i18nJson(
    path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
    path.join(__dirname, 'i18n', 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json')
  ).then(function (uiconf) {
    try {
      var active = self.isActive();
      var status = uiconf.sections[0].content[0]; status.value = self.t(active ? 'ACTIVE' : 'INACTIVE');
      if (active) { uiconf.sections[0].content[1].hidden = true; }   // nothing to switch to
    } catch (e) { self.logger.warn('[artwork_one] ui config: ' + e); }
    defer.resolve(uiconf);
  }).fail(function (e) { defer.reject(new Error(e)); });
  return defer.promise;
};

ArtworkOne.prototype.setUIConfig = function () {};
ArtworkOne.prototype.getConf = function (key) { return this.config.get(key); };
ArtworkOne.prototype.setConf = function (key, value) { this.config.set(key, value); };

// --- what the screens ask ------------------------------------------------------------------

// everything a screen needs, with only the keys that were ever chosen
ArtworkOne.prototype.snapshot = function () {
  var out = { version: 2, plugin: 'user_interface/artwork_one' };   // which plugin answers: the interface addresses it from then on
  var theme = this.config.get('theme');
  if (THEMES.indexOf(theme) > -1) { out.theme = theme; }
  var ambient = this.readAmbient();
  if (ambient) { out.ambient = ambient; }
  var pins = this.readPins();
  if (pins) { out.pins = pins; }
  return out;
};

// the pins: quick access on Home, up to 24, each only what a tile needs
ArtworkOne.prototype.readPins = function () {
  var raw = this.config.get('pins');
  if (!raw) { return null; }
  try { return this.cleanPins(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch (e) { return null; }
};

ArtworkOne.prototype.cleanPins = function (list) {
  if (!Array.isArray(list)) { return null; }
  var out = [], seen = {};
  list.forEach(function (p) {
    if (!p || typeof p !== 'object' || !p.uri || seen[p.uri] || out.length >= 24) { return; }
    seen[p.uri] = true;
    var pin = { uri: String(p.uri).slice(0, 600), service: String(p.service || '').slice(0, 40), type: String(p.type || '').slice(0, 40), title: String(p.title || '').slice(0, 200) };
    if (p.albumart) { pin.albumart = String(p.albumart).slice(0, 600); }
    if (p.artist) { pin.artist = String(p.artist).slice(0, 200); }
    if (p.album) { pin.album = String(p.album).slice(0, 200); }
    out.push(pin);
  });
  return out;
};

ArtworkOne.prototype.readAmbient = function () {
  var raw = this.config.get('ambient');
  if (!raw) { return null; }
  try { return this.cleanAmbient(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch (e) { return null; }
};

// keeps only the fields the interface knows, each in its own range
ArtworkOne.prototype.cleanAmbient = function (a) {
  if (!a || typeof a !== 'object') { return null; }
  var out = {};
  if (typeof a.on === 'boolean') { out.on = a.on; }
  if (DELAYS.indexOf(Number(a.delay)) > -1) { out.delay = Number(a.delay); }
  if (LAYOUTS.indexOf(a.layout) > -1) { out.layout = a.layout; }
  if (CLOCKS.indexOf(String(a.clock)) > -1) { out.clock = String(a.clock); }
  if (typeof a.night === 'boolean') { out.night = a.night; }
  if (isTime(a.nightFrom)) { out.nightFrom = a.nightFrom; }
  if (isTime(a.nightTo)) { out.nightTo = a.nightTo; }
  if (TEXT_SIZES.indexOf(a.textSize) > -1) { out.textSize = a.textSize; }   // the display's own text size and volume
  if (typeof a.hideVolume === 'boolean') { out.hideVolume = a.hideVolume; }
  return Object.keys(out).length ? out : null;
};

function isTime(v) { return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || '')); }

// callMethod → answered to the caller only
ArtworkOne.prototype.getSettings = function () {
  return { message: EVENT, payload: this.snapshot() };
};

// callMethod → saved, then pushed to every screen
ArtworkOne.prototype.setSettings = function (data) {
  var d = data || {};
  var changed = false;
  if (d.theme !== undefined) {
    if (d.theme === null || d.theme === '') { this.config.set('theme', ''); changed = true; }   // '' = nobody chose; v-conf keeps the key
    else if (THEMES.indexOf(d.theme) > -1) { this.config.set('theme', d.theme); changed = true; }
    else { this.logger.warn('[artwork_one] refused theme ' + JSON.stringify(d.theme)); }
  }
  if (d.ambient !== undefined) {
    if (d.ambient === null) { this.config.set('ambient', ''); changed = true; }
    else {
      // the patch is cleaned first: a field out of range is dropped, never the stored one
      var patch = this.cleanAmbient(d.ambient);
      if (patch) { this.config.set('ambient', JSON.stringify(Object.assign({}, this.readAmbient() || {}, patch))); changed = true; }
      else { this.logger.warn('[artwork_one] refused ambient ' + JSON.stringify(d.ambient)); }
    }
  }
  if (d.pins !== undefined) {
    var pins = this.cleanPins(d.pins);
    if (pins) { this.config.set('pins', JSON.stringify(pins)); changed = true; }
    else { this.logger.warn('[artwork_one] refused pins'); }
  }
  var snap = this.snapshot();
  if (changed) {
    this.logger.info('[artwork_one] settings ' + JSON.stringify(snap));
    this.commandRouter.broadcastMessage(EVENT, snap);
  }
  return { message: EVENT, payload: snap };
};
