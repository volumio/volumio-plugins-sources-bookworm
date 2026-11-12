'use strict';
// MPDantic: the plugin shell. It owns the plugin's lifecycle, the settings page, the
// core's service and the pages' announcement on the network; the core (bin/mpdantic)
// does the work on the library and serves the management pages. Nothing heavy runs in
// this process.

const libQ = require('kew');
const fs = require('fs');
const os = require('os');
const path = require('path');
const v8 = require('v8');
const { execFile, execFileSync } = require('child_process');
const VConf = require('v-conf');
const h = require('./helpers');

const LOG = 'mpdantic: ';
const SERVICE = 'mpdantic.service';
const RUN_DIR = '/run/mpdantic';
const STATUS_FILE = RUN_DIR + '/status.json';
// The pages announced on the network, as Volumio announces its own page: a service
// file Avahi watches for.
const AVAHI_FILE = '/etc/avahi/services/mpdantic.service';
// What Volumio's MPD plugin writes from its template and the registered hooks.
const MPD_CONF = '/etc/mpd.conf';
const PLUGIN_TYPE = 'system_controller';
const PLUGIN_NAME = 'mpdantic';

const msg = (e) => (e && e.message ? e.message : String(e));

function Mpdantic(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = this.commandRouter.logger;
    this.config = new VConf();
    this.active = false;
    this.settingsFile = null;
    this.mpdVersionRead = undefined;
}

// ----------------------------------------------------------------- lifecycle

Mpdantic.prototype.onVolumioStart = function () {
    this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config.loadFile(this.configFile);
    // The settings as the core reads them, beside the configuration.
    this.settingsFile = path.join(path.dirname(this.configFile), 'settings.json');
    // Every plugin's onVolumioStart runs before any onStart, so the MPD plugin sees the
    // hook when it writes mpd.conf at boot.
    this.registerMpdHook();
    this.watchLanguage();
    return libQ.resolve();
};

// The pages follow Volumio's language: the settings are rewritten at every change of
// it (the appearance plugin sets the shared value), and the core reads them at the
// next page. Volumio keeps every callback registered, so this registers once.
Mpdantic.prototype.watchLanguage = function () {
    const self = this;
    if (self.languageWatched) return;
    const vars = self.commandRouter.sharedVars;
    if (!vars || typeof vars.registerCallback !== 'function') return;
    self.languageWatched = true;
    vars.registerCallback('language_code', () => {
        if (!self.active) return;
        try { self.writeSettings(); } catch (e) { self.logger.error(LOG + 'settings: ' + msg(e)); }
    });
};

Mpdantic.prototype.onStart = function () {
    const self = this;
    self.active = true;
    self.commandRouter.loadI18nStrings();
    self.registerMpdHook();
    // The core reads the settings at its start: the file is written first.
    try { self.writeSettings(); } catch (e) { self.logger.error(LOG + 'settings: ' + msg(e)); }
    try { self.writePlan(); } catch (e) { self.logger.error(LOG + 'plan: ' + msg(e)); }
    // At boot the MPD plugin writes mpd.conf itself, with the hook in it, and restarts
    // MPD; a check before that write has landed would restart MPD a second time, so
    // the check waits for the boot to complete. Enabled at runtime, it runs at once.
    self.whenBootCompleted().then(() => {
        if (!self.active || self.mpdConfIsCurrent()) return;
        self.rewriteMpdConf().fail((e) => {
            self.logger.error(LOG + 'mpd.conf: ' + msg(e));
            self.toast('error', 'ERR_MPD', { error: msg(e) });
        });
    });
    return self.announce()
        .fail((e) => { self.logger.warn(LOG + 'announce: ' + msg(e)); })
        .then(() => self.startCore())
        .fail((e) => {
            self.logger.error(LOG + 'start: ' + msg(e));
            self.toast('error', 'ERR_CORE', { error: msg(e) });
        })
        .then(() => 'OK');
};

Mpdantic.prototype.onStop = function () {
    const self = this;
    self.active = false;
    self.unregisterMpdHook();
    return self.unannounce()
        .fail((e) => { self.logger.warn(LOG + 'unannounce: ' + msg(e)); })
        .then(() => self.stopCore())
        .fail((e) => { self.logger.warn(LOG + 'stop: ' + msg(e)); })
        // The line the plugin appended goes with it.
        .then(() => (self.mpdConfIsCurrent() ? libQ.resolve() : self.rewriteMpdConf()))
        .fail((e) => { self.logger.error(LOG + 'mpd.conf: ' + msg(e)); })
        .then(() => 'OK');
};

Mpdantic.prototype.onRestart = function () {
    return libQ.resolve();
};

Mpdantic.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

Mpdantic.prototype.getI18nFile = function (langCode) {
    const file = path.join(__dirname, 'i18n', 'strings_' + langCode + '.json');
    return fs.existsSync(file) ? file : path.join(__dirname, 'i18n', 'strings_en.json');
};

// ---------------------------------------------------------------------- core

Mpdantic.prototype.systemctl = function (verb) {
    const self = this;
    const defer = libQ.defer();
    execFile('/usr/bin/sudo', ['/bin/systemctl', verb, SERVICE], { timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
            self.logger.error(LOG + 'systemctl ' + verb + ': ' + String(stderr || error.message).trim());
            defer.reject(new Error(String(stderr || error.message).trim()));
        } else {
            defer.resolve();
        }
    });
    return defer.promise;
};

Mpdantic.prototype.startCore = function () {
    return this.systemctl('restart');
};

Mpdantic.prototype.stopCore = function () {
    return this.systemctl('stop');
};

Mpdantic.prototype.readStatus = function () {
    try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (e) { return null; }
};

// The settings as the core reads them, with the player's language, written whole and
// moved into place.
Mpdantic.prototype.writeSettings = function () {
    const self = this;
    const language = self.commandRouter.sharedVars ? self.commandRouter.sharedVars.get('language_code') : undefined;
    const text = JSON.stringify(h.settingsFrom((k, d) => self.config.get(k, d), language), null, 2) + '\n';
    const part = self.settingsFile + '.part';
    fs.writeFileSync(part, text);
    fs.renameSync(part, self.settingsFile);
};

// ---------------------------------------------------------- the output buffer

// MPD's output buffer sized to the player, through the MPD plugin's own hook: its
// createMPDFile appends what every registered plugin method returns to mpd.conf,
// and MPD takes the later of two values for a top-level setting.

Mpdantic.prototype.mpdPlugin = function () {
    return this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');
};

Mpdantic.prototype.registerMpdHook = function () {
    const mpd = this.mpdPlugin();
    if (!h.registerMpdHook(mpd, PLUGIN_TYPE, PLUGIN_NAME)) {
        this.logger.warn(LOG + 'the MPD plugin has no registerConfigCallback; the output buffer is not sized');
        return false;
    }
    return true;
};

// The backend has no unregister; a stale entry would make createMPDFile append the
// word "undefined" to mpd.conf.
Mpdantic.prototype.unregisterMpdHook = function () {
    h.unregisterMpdHook(this.mpdPlugin(), PLUGIN_TYPE, PLUGIN_NAME);
};

// MPD's version, read once: it says whether a second value for a setting counts.
Mpdantic.prototype.mpdVersion = function () {
    if (this.mpdVersionRead === undefined) {
        try {
            this.mpdVersionRead = h.parseMpdVersion(execFileSync('/usr/bin/mpd', ['--version'], { timeout: 5000, encoding: 'utf8' }));
        } catch (e) {
            this.logger.warn(LOG + 'mpd --version: ' + msg(e));
            this.mpdVersionRead = null;
        }
    }
    return this.mpdVersionRead;
};

// The buffer this player gets, from what is read on it now. The shell runs inside the
// backend, so the heap limit is the backend's own.
Mpdantic.prototype.bufferPlan = function () {
    return h.bufferPlan({
        memTotal: os.totalmem(),
        heapLimit: v8.getHeapStatistics().heap_size_limit,
        arch: process.arch,
        mpdVersion: this.mpdVersion(),
        enabled: this.config.get('buffer_auto', true) === true
    });
};

// What the hook gives the MPD plugin for mpd.conf.
Mpdantic.prototype.getMpdConfig = function () {
    if (!this.active) return '';
    return h.mpdConfigText(this.bufferPlan());
};

Mpdantic.prototype.mpdConfIsCurrent = function () {
    let current = '';
    try { current = fs.readFileSync(MPD_CONF, 'utf8'); } catch (e) { return false; }
    return h.mpdConfCurrent(current, this.getMpdConfig());
};

// The plan written beside the settings for the core's player report, whole and moved
// into place; only the shell knows the backend's heap.
Mpdantic.prototype.writePlan = function () {
    const plan = this.bufferPlan();
    const text = h.bufferPlanFile(plan, h.bufferSummary(plan, (k, v) => this.i18n(k, v)));
    const file = path.join(path.dirname(this.settingsFile), 'buffer.json');
    fs.writeFileSync(file + '.part', text);
    fs.renameSync(file + '.part', file);
};

// Volumio's own writer, then its own restart, which also reconnects the backend's MPD
// client. createMPDFile calls back before its asynchronous write lands; the backend's
// own callers restart at once, and a short pause keeps the restart behind the write.
Mpdantic.prototype.rewriteMpdConf = function () {
    const defer = libQ.defer();
    const mpd = this.mpdPlugin();
    if (!mpd || typeof mpd.createMPDFile !== 'function') return libQ.reject(new Error('the MPD plugin is not available'));
    try {
        mpd.createMPDFile((err) => {
            if (err) { defer.reject(err); return; }
            setTimeout(() => {
                try { mpd.restartMpd(); defer.resolve(); } catch (e) { defer.reject(e); }
            }, 500);
        });
    } catch (e) {
        defer.reject(e);
    }
    return defer.promise;
};

Mpdantic.prototype.whenBootCompleted = function () {
    const defer = libQ.defer();
    let waited = 0;
    const tick = () => {
        if (process.env.VOLUMIO_SYSTEM_STATUS === 'ready' || waited >= 120000) defer.resolve();
        else { waited += 2000; setTimeout(tick, 2000); }
    };
    tick();
    return defer.promise;
};

// The buffer section saved: the switch stored, mpd.conf rewritten when what the hook
// gives has changed.
Mpdantic.prototype.updateBuffer = function (data) {
    const self = this;
    self.config.set('buffer_auto', !!(data && data.buffer_auto === true));
    try { self.writePlan(); } catch (e) { self.logger.error(LOG + 'plan: ' + msg(e)); }
    if (self.mpdConfIsCurrent()) {
        self.toast('success', 'SAVED_BUFFER', { line: h.bufferSummary(self.bufferPlan(), (k, v) => self.i18n(k, v)) });
        return libQ.resolve();
    }
    return self.rewriteMpdConf()
        .then(() => { self.toast('success', 'BUFFER_APPLIED'); })
        .fail((e) => {
            self.logger.error(LOG + 'mpd.conf: ' + msg(e));
            self.toast('error', 'ERR_MPD', { error: msg(e) });
        })
        .then(() => libQ.resolve());
};

// ------------------------------------------------------------ the announcement

// Written directly when the folder allows it (Volumio's own system plugin opens it
// up), else through sudo tee, which the volumio user has.
Mpdantic.prototype.announce = function () {
    const self = this;
    const text = h.avahiService(h.settingsFrom((k, d) => self.config.get(k, d)).port);
    const plan = h.announceWrite((body) => fs.writeFileSync(AVAHI_FILE, body), text);
    if (plan.via === 'direct') return libQ.resolve();
    if (plan.via === 'error') return libQ.reject(plan.error);
    const defer = libQ.defer();
    const child = execFile('/usr/bin/sudo', ['/usr/bin/tee', AVAHI_FILE], { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) defer.reject(new Error(String(stderr || error.message).trim()));
        else defer.resolve();
    });
    child.stdin.on('error', () => { /* the exit says it */ });
    child.stdin.end(text);
    return defer.promise;
};

Mpdantic.prototype.unannounce = function () {
    try {
        fs.unlinkSync(AVAHI_FILE);
        return libQ.resolve();
    } catch (e) {
        if (e.code === 'ENOENT') return libQ.resolve();
        if (e.code !== 'EACCES' && e.code !== 'EPERM') return libQ.reject(e);
    }
    const defer = libQ.defer();
    execFile('/usr/bin/sudo', ['/bin/rm', '-f', AVAHI_FILE], { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) defer.reject(new Error(String(stderr || error.message).trim()));
        else defer.resolve();
    });
    return defer.promise;
};

// ------------------------------------------------------------- the settings

Mpdantic.prototype.getUIConfig = function () {
    const self = this;
    const defer = libQ.defer();
    const lang = self.commandRouter.sharedVars.get('language_code');
    const c = self.config;
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then((uiconf) => {
            const section = (id) => (uiconf.sections.find((s) => s.id === id) || { content: [] }).content;
            const mgmt = section('management_section');
            const port = h.settingsFrom((k, d) => c.get(k, d)).port;
            setValue(mgmt, 'port', String(port));
            // The address browsers reach the player by: the operator's when set, else the
            // one found on the player's own interfaces (an IP address, so a network whose
            // .local names do not resolve still gets there); the one found is the field's
            // placeholder.
            const found = h.lanAddress(os.networkInterfaces());
            const override = String(c.get('address', '')).trim();
            setValue(mgmt, 'address', override);
            const addressField = mgmt.find((x) => x.id === 'address');
            if (addressField && addressField.attributes && addressField.attributes[0]) addressField.attributes[0].placeholder = found || '';
            // The buttons open the core's pages at that address, here inside Volumio's own
            // page or in a tab of their own; without an address there are no buttons.
            const here = mgmt.find((x) => x.id === 'open_here');
            const tab = mgmt.find((x) => x.id === 'open_tab');
            const address = override || found;
            if (address) {
                const links = h.pageLinks(address, port);
                if (here) here.onClick.performerUrl = links.here;
                if (tab) {
                    tab.onClick.url = links.url;
                    tab.doc = self.i18n('OPEN_TAB_DESC') + ' ' + links.url;
                }
            } else {
                if (here) here.hidden = true;
                if (tab) tab.hidden = true;
            }
            // The buffer section: the switch as set, its text the value this player gets.
            const buffer = section('buffer_section');
            const plan = self.bufferPlan();
            setValue(buffer, 'buffer_auto', plan.enabled);
            const auto = buffer.find((x) => x.id === 'buffer_auto');
            if (auto) auto.doc = h.bufferSummary(plan, (k, v) => self.i18n(k, v));
            const mb = section('mb_section');
            setValue(mb, 'mb_mirror', c.get('mb_mirror', false) === true);
            setValue(mb, 'mb_url', String(c.get('mb_url', '') || ''));
            defer.resolve(uiconf);
        })
        .fail((e) => {
            self.logger.error(LOG + 'settings page: ' + msg(e));
            defer.reject(new Error());
        });
    return defer.promise;
};

// The management section saved: the port and the address checked and stored, the
// announcement rewritten, the core restarted on the port.
Mpdantic.prototype.updateManagement = function (data) {
    const self = this;
    const port = h.validatePort(data && data.port);
    if (!port.ok) {
        self.toast('error', 'ERR_PORT', { value: String(data && data.port) });
        return libQ.resolve();
    }
    const address = h.validateAddress(data && data.address);
    if (!address.ok) {
        self.toast('error', 'ERR_ADDRESS', { value: String(data && data.address) });
        return libQ.resolve();
    }
    self.config.set('port', String(port.value));
    self.config.set('address', address.value);
    try { self.writeSettings(); } catch (e) { self.logger.error(LOG + 'settings: ' + msg(e)); }
    self.toast('success', 'SAVED');
    return self.announce()
        .fail((e) => { self.logger.warn(LOG + 'announce: ' + msg(e)); })
        .then(() => self.startCore())
        .fail((e) => {
            self.logger.error(LOG + 'restart: ' + msg(e));
            self.toast('error', 'ERR_CORE', { error: msg(e) });
        })
        .then(() => libQ.resolve());
};

// The MusicBrainz section saved: mirror switch and URL; written into settings.json
// for the core. A bad URL with the switch on is refused.
Mpdantic.prototype.updateMusicBrainz = function (data) {
    const self = this;
    const mirror = !!(data && data.mb_mirror === true);
    let url = '';
    if (mirror) {
        const checked = h.validateMbUrl(data && data.mb_url);
        if (!checked.ok) {
            self.toast('error', 'ERR_MB_URL', { value: String(data && data.mb_url) });
            return libQ.resolve();
        }
        url = checked.value;
    }
    self.config.set('mb_mirror', mirror);
    self.config.set('mb_url', url);
    try { self.writeSettings(); } catch (e) { self.logger.error(LOG + 'settings: ' + msg(e)); }
    const where = mirror
        ? self.i18n('MB_WHERE_MIRROR', { url: url })
        : self.i18n('MB_WHERE_PUBLIC');
    self.toast('success', 'MB_SAVED', { where: where });
    return self.startCore()
        .fail((e) => {
            self.logger.error(LOG + 'restart: ' + msg(e));
            self.toast('error', 'ERR_CORE', { error: msg(e) });
        })
        .then(() => libQ.resolve());
};

// A tiny release search against the mirror URL from the form (or the saved one).
Mpdantic.prototype.testMusicBrainz = function (data) {
    const self = this;
    const mirror = data && Object.prototype.hasOwnProperty.call(data, 'mb_mirror')
        ? data.mb_mirror === true
        : self.config.get('mb_mirror', false) === true;
    const typed = data && Object.prototype.hasOwnProperty.call(data, 'mb_url')
        ? data.mb_url
        : self.config.get('mb_url', '');
    if (!mirror) {
        self.toast('info', 'MB_SAVED', { where: self.i18n('MB_WHERE_PUBLIC') });
        return libQ.resolve();
    }
    const base = h.mbEndpoint(true, typed);
    if (!base) {
        self.toast('error', 'ERR_MB_URL', { value: String(typed) });
        return libQ.resolve();
    }
    const target = base + '/ws/2/release/?query=*&fmt=json&limit=1';
    const defer = libQ.defer();
    const lib = target.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(target, {
        headers: {
            'User-Agent': 'MPDantic/' + (require('./package.json').version) + ' ( https://github.com/foonerd/mpdantic )',
            Accept: 'application/json'
        },
        timeout: 10000
    }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
            self.toast('success', 'MB_TEST_OK', { status: String(res.statusCode) });
        } else {
            self.toast('error', 'MB_TEST_FAIL', { error: 'HTTP ' + res.statusCode });
        }
        defer.resolve();
    });
    req.on('timeout', () => { req.destroy(); });
    req.on('error', (e) => {
        self.toast('error', 'MB_TEST_FAIL', { error: msg(e) });
        defer.resolve();
    });
    return defer.promise;
};

// The status button: what the core says, as one toast.
Mpdantic.prototype.showStatus = function () {
    const self = this;
    const t = (key, vars) => self.i18n(key, vars);
    const line = h.summarize(self.readStatus(), t, h.bufferSummary(self.bufferPlan(), t));
    self.commandRouter.pushToastMessage('info', self.i18n('STATUS_TITLE'), line);
    return libQ.resolve();
};

// ------------------------------------------------------------------ strings

// A string of the plugin's, with its {{variables}} filled in.
Mpdantic.prototype.i18n = function (key, vars) {
    let text = this.commandRouter.getI18nString('MPDANTIC.' + key);
    if (typeof text !== 'string') text = key;
    Object.keys(vars || {}).forEach((k) => { text = text.split('{{' + k + '}}').join(String(vars[k])); });
    return text;
};

Mpdantic.prototype.toast = function (type, key, vars) {
    this.commandRouter.pushToastMessage(type, this.i18n('PLUGIN_NAME'), this.i18n(key, vars));
};

function setValue(content, id, value) {
    const item = content.find((c) => c.id === id);
    if (item) item.value = value;
}

module.exports = Mpdantic;
