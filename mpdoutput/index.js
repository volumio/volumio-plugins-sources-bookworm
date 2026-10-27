'use strict';

// MPD HTTP & Icecast output for Volumio.
//
// Two MPD httpd outputs are contributed to Volumio's own mpd.conf through the
// MPD plugin's registerConfigCallback: one serves listeners on the network,
// one on 127.0.0.1 feeds the relay (relay/relay.js) that pushes the stream to
// an Icecast server. MPD itself never opens a connection to Icecast, so a
// server reboot or network cut cannot stall playback.

const libQ = require('kew');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');
const VConf = require('v-conf');

const PLUGIN_TYPE = 'audio_interface';
const PLUGIN_NAME = 'mpdoutput';
const SERVICE = 'mpd-output-relay.service';
const RELAY_STATUS_FILE = '/run/mpd-output/status.json';
const RELAY_CONTROL_SOCKET = '/run/mpd-output/control.sock';
// Named settings backups: outside the plugin and its configuration folder so they survive
// uninstall and a reinstall, and on the Internal Storage share so they can be copied to another player.
const BACKUP_DIR = '/data/INTERNAL/mpdoutput/backups';
const BACKUP_SCHEMA = 1;
const BACKUP_NAME_RE = /^[A-Za-z0-9._ -]{1,64}$/;
const BACKUP_KEYS = [
    'httpstream', 'servername', 'encoder', 'bitrate', 'format', 'portn', 'httpadd', 'max_clients', 'httpgenre', 'httpwebsite',
    'icestream', 'iceservername', 'icepublishport', 'icemountp', 'iceuser', 'icepassword', 'iceencoder', 'icebitrate', 'iceformat',
    'icestreamname', 'icepublic', 'iceadd', 'icedescription', 'icegenre', 'iceurl', 'icefeedport',
];
const MPD_CONF = '/etc/mpd.conf';
const MARKER = '# mpdoutput plugin: streaming outputs (managed by the plugin, do not edit)';
const FEED_NAME = 'mpdoutput-icecast-feed';
const LOG = '[mpdoutput] ';

module.exports = MpdOutput;

function MpdOutput(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = this.commandRouter.logger;
    this.config = new VConf();
    this.active = false;
}

// ----------------------------------------------------------------- lifecycle

MpdOutput.prototype.onVolumioStart = function () {
    this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config.loadFile(this.configFile);
    // All plugins' onVolumioStart run before any onStart, so the MPD plugin
    // sees this hook when it writes mpd.conf at boot.
    this.registerMpdHook();
    return libQ.resolve();
};

MpdOutput.prototype.onStart = function () {
    const self = this;
    self.active = true;
    self.commandRouter.loadI18nStrings();
    self.registerMpdHook();
    self.migrateLegacySettings();
    self.subscribeState();

    // At boot the MPD plugin writes mpd.conf itself (with this hook in it) and restarts MPD;
    // checking before that write has landed would restart MPD a second time. Wait for the
    // boot to complete, then verify. Enabled at runtime, the status is already 'ready'.
    self.whenBootCompleted().then(() => {
        if (!self.active || self.mpdConfIsCurrent()) return;
        self.rewriteMpdConf().fail((e) => {
            self.logger.error(LOG + 'start: ' + (e && e.message ? e.message : e));
            self.toast('error', 'ERR_MPD', { error: e && e.message ? e.message : String(e) });
        });
    });
    return self.applyRelay().then(() => 'OK');
};

MpdOutput.prototype.whenBootCompleted = function () {
    const defer = libQ.defer();
    let waited = 0;
    const tick = () => {
        if (process.env.VOLUMIO_SYSTEM_STATUS === 'ready' || waited >= 120000) defer.resolve();
        else { waited += 2000; setTimeout(tick, 2000); }
    };
    tick();
    return defer.promise;
};

MpdOutput.prototype.onStop = function () {
    const self = this;
    self.active = false;
    self.unregisterMpdHook();
    self.unsubscribeState();
    return self.systemctl('stop')
        .fail(() => undefined)
        .then(() => (self.mpdConfIsCurrent() ? libQ.resolve() : self.rewriteMpdConf()))
        .fail((e) => { self.logger.error(LOG + 'stop: ' + (e && e.message ? e.message : e)); })
        .then(() => 'OK');
};

MpdOutput.prototype.onRestart = function () {
    return libQ.resolve();
};

MpdOutput.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

MpdOutput.prototype.getI18nFile = function (langCode) {
    const file = path.join(__dirname, 'i18n', 'strings_' + langCode + '.json');
    return fs.existsSync(file) ? file : path.join(__dirname, 'i18n', 'strings_en.json');
};

// ------------------------------------------------------- MPD configuration hook

MpdOutput.prototype.mpdPlugin = function () {
    return this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');
};

MpdOutput.prototype.registerMpdHook = function () {
    const mpd = this.mpdPlugin();
    if (!mpd || typeof mpd.registerConfigCallback !== 'function') {
        this.logger.warn(LOG + 'MPD plugin has no registerConfigCallback; outputs cannot be added');
        return false;
    }
    const list = Array.isArray(mpd.registeredCallbacks) ? mpd.registeredCallbacks : [];
    if (!list.some((c) => c && c.type === PLUGIN_TYPE && c.plugin === PLUGIN_NAME)) {
        mpd.registerConfigCallback({ type: PLUGIN_TYPE, plugin: PLUGIN_NAME, data: 'getMpdConfig' });
    }
    return true;
};

// The backend has no unregister; a stale entry would make createMPDFile append
// the string "undefined" to mpd.conf once this instance is gone.
MpdOutput.prototype.unregisterMpdHook = function () {
    const mpd = this.mpdPlugin();
    if (mpd && Array.isArray(mpd.registeredCallbacks)) {
        mpd.registeredCallbacks = mpd.registeredCallbacks.filter((c) => !(c && c.type === PLUGIN_TYPE && c.plugin === PLUGIN_NAME));
    }
};

// Called by the MPD plugin while it assembles mpd.conf; the return value is appended verbatim.
MpdOutput.prototype.getMpdConfig = function () {
    if (!this.active) return '';
    const c = this.config;
    const http = c.get('httpstream', false) === true;
    const ice = c.get('icestream', false) === true;
    if (!http && !ice) return '';

    let out = '\n' + MARKER + '\n';
    if (http) {
        const encoder = c.get('encoder', 'lame');
        const lines = [
            ['type', 'httpd'],
            ['name', c.get('servername', 'Volumio')],
            ['encoder', encoder],
            ['port', c.get('portn', '8000')],
        ];
        pushBitrate(lines, encoder, c.get('bitrate', '320'));
        lines.push(['format', c.get('format', '44100:16:2')]);
        if (c.get('httpadd', false) === true) {
            if (isInt(c.get('max_clients', ''))) lines.push(['max_clients', c.get('max_clients')]);
            if (c.get('httpgenre', '')) lines.push(['genre', c.get('httpgenre')]);
            if (c.get('httpwebsite', '')) lines.push(['website', c.get('httpwebsite')]);
        }
        lines.push(['always_on', 'yes'], ['tags', 'yes']);
        out += block(lines);
    }
    if (ice) {
        const encoder = c.get('iceencoder', 'vorbis');
        const lines = [
            ['type', 'httpd'],
            ['name', FEED_NAME],
            ['encoder', encoder],
            ['bind_to_address', '127.0.0.1'],
            ['port', c.get('icefeedport', '8010')],
        ];
        pushBitrate(lines, encoder, c.get('icebitrate', '192'));
        // No MPD tags on the feed: the title Volumio shows on screen is sent to the server by the plugin.
        lines.push(['format', c.get('iceformat', '44100:16:2')], ['max_clients', '2'], ['always_on', 'yes'], ['tags', 'no']);
        out += block(lines);
    }
    return out;
};

function pushBitrate(lines, encoder, kbps) {
    if (encoder === 'flac') return; // lossless: no bitrate setting
    lines.push(['bitrate', encoder === 'opus' ? String(parseInt(kbps, 10) * 1000) : String(kbps)]);
}

function block(lines) {
    return 'audio_output {\n' + lines.map(([k, v]) => '    ' + k.padEnd(16) + q(v) + '\n').join('') + '}\n';
}

// mpd.conf string: double-quoted, backslash and quote escaped, no line breaks.
function q(v) {
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
}

function isInt(v) {
    return /^\d+$/.test(String(v).trim());
}

MpdOutput.prototype.mpdConfIsCurrent = function () {
    let current = '';
    try { current = fs.readFileSync(MPD_CONF, 'utf8'); } catch (e) { return false; }
    const expected = this.getMpdConfig();
    return expected === '' ? !current.includes(MARKER) : current.includes(expected);
};

// Volumio's own writer, then its own restart (which also reconnects the backend's MPD client).
MpdOutput.prototype.rewriteMpdConf = function () {
    const self = this;
    const defer = libQ.defer();
    const mpd = self.mpdPlugin();
    if (!mpd || typeof mpd.createMPDFile !== 'function') {
        return libQ.reject(new Error('MPD plugin not available'));
    }
    try {
        mpd.createMPDFile((err) => {
            if (err) { defer.reject(err); return; }
            // createMPDFile calls back before its asynchronous write lands; the backend's own
            // callers restart immediately, a short pause keeps the restart behind the write.
            setTimeout(() => {
                try { mpd.restartMpd(); defer.resolve(); } catch (e) { defer.reject(e); }
            }, 500);
        });
    } catch (e) {
        defer.reject(e);
    }
    return defer.promise;
};

// ------------------------------------------------------------------- relay

MpdOutput.prototype.relayConfigFile = function () {
    return path.join(path.dirname(this.configFile), 'relay.json');
};

MpdOutput.prototype.writeRelayConfig = function () {
    const c = this.config;
    const cfg = {
        source: { host: '127.0.0.1', port: parseInt(c.get('icefeedport', '8010'), 10) },
        icecast: {
            host: String(c.get('iceservername', '')).trim(),
            port: parseInt(c.get('icepublishport', '8000'), 10),
            mount: String(c.get('icemountp', '/volumio.ogg')).trim(),
            user: String(c.get('iceuser', 'source') || 'source'),
            password: String(c.get('icepassword', '')),
            name: String(c.get('icestreamname', 'Volumio')),
            description: c.get('iceadd', false) === true ? String(c.get('icedescription', '')) : '',
            genre: c.get('iceadd', false) === true ? String(c.get('icegenre', '')) : '',
            url: c.get('iceadd', false) === true ? String(c.get('iceurl', '')) : '',
            public: c.get('icepublic', 'no') === 'yes',
            tls: false,
        },
        bitrate_kbps: parseInt(c.get('icebitrate', '192'), 10) || 0,
        stall_seconds: 8,
    };
    fs.writeFileSync(this.relayConfigFile(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
};

MpdOutput.prototype.applyRelay = function () {
    const self = this;
    if (!self.active || self.config.get('icestream', false) !== true) {
        return self.systemctl('stop').fail(() => undefined);
    }
    try {
        self.writeRelayConfig();
    } catch (e) {
        self.toast('error', 'ERR_RELAY', { error: e.message });
        return libQ.resolve();
    }
    return self.systemctl('restart').then(() => {
        setTimeout(() => self.onVolumioState(self.currentState()), 1500); // relay just started: seed its title
    }).fail((e) => {
        self.toast('error', 'ERR_RELAY', { error: e.message });
    });
};

// ------------------------------------------------------- title: what the screen shows

MpdOutput.prototype.subscribeState = function () {
    if (this.stateCallback) return;
    this.stateCallback = (state) => this.onVolumioState(state);
    this.commandRouter.addCallback('volumioPushState', this.stateCallback);
};

// The backend has no removeCallback; a left-over closure would outlive this instance.
MpdOutput.prototype.unsubscribeState = function () {
    const all = this.commandRouter.callbacks;
    if (this.stateCallback && all && Array.isArray(all.volumioPushState)) {
        all.volumioPushState = all.volumioPushState.filter((f) => f !== this.stateCallback);
    }
    this.stateCallback = null;
};

MpdOutput.prototype.currentState = function () {
    try { return this.commandRouter.volumioGetState(); } catch (e) { return null; }
};

// Every state push while playing is handed over; the relay sends it on only when Icecast's title differs.
MpdOutput.prototype.onVolumioState = function (state) {
    if (!this.active || this.config.get('icestream', false) !== true) return;
    if (!state || state.status !== 'play') return;
    const title = screenTitle(state);
    if (!title) return;
    const c = net.connect(RELAY_CONTROL_SOCKET);
    c.on('error', () => { }); // relay not running (Icecast stream off): nothing to update
    c.on('connect', () => {
        if (title !== this.lastLoggedTitle) { this.lastLoggedTitle = title; this.logger.info(LOG + 'title: ' + title); }
    });
    c.end(JSON.stringify({ title }) + '\n');
};

function screenTitle(state) {
    const title = String(state.title || '').trim();
    const artist = String(state.artist || '').trim();
    return artist && title ? artist + ' - ' + title : (title || artist);
}

MpdOutput.prototype.systemctl = function (verb) {
    const self = this;
    const defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl ' + verb + ' ' + SERVICE, { uid: 1000, gid: 1000, timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
            self.logger.error(LOG + 'systemctl ' + verb + ': ' + (stderr || error.message));
            defer.reject(new Error((stderr || error.message).trim()));
        } else {
            defer.resolve();
        }
    });
    return defer.promise;
};

MpdOutput.prototype.relayStatus = function () {
    const self = this;
    const c = self.config;
    if (c.get('icestream', false) !== true) {
        self.toast('info', 'STATUS_OFF', {}, 'STATUS_TITLE');
        return libQ.resolve();
    }
    let st = null;
    try { st = JSON.parse(fs.readFileSync(RELAY_STATUS_FILE, 'utf8')); } catch (e) { st = null; }
    exec('/usr/bin/sudo /bin/systemctl is-active ' + SERVICE, { uid: 1000, gid: 1000, timeout: 10000 }, (error, stdout) => {
        const running = !error && String(stdout).trim() === 'active';
        const lastErr = st && st.lastError ? self.i18n('STATUS_LAST_ERROR', { error: st.lastError }) : '';
        if (!running || !st) {
            self.toast('error', 'STATUS_NOT_RUNNING', {}, 'STATUS_TITLE');
        } else if (st.icecast === 'connected') {
            self.toast('success', 'STATUS_CONNECTED', {
                host: c.get('iceservername', ''), port: c.get('icepublishport', ''), mount: c.get('icemountp', ''),
                since: st.since ? new Date(st.since).toLocaleString() : '-', reconnects: st.reconnects || 0,
            }, 'STATUS_TITLE');
        } else if (st.mpd !== 'connected') {
            self.toast('info', 'STATUS_WAITING', {}, 'STATUS_TITLE');
        } else {
            self.toast('info', 'STATUS_CONNECTING', { error: lastErr }, 'STATUS_TITLE');
        }
    });
    return libQ.resolve();
};

// ---------------------------------------------------------------- settings

MpdOutput.prototype.migrateLegacySettings = function () {
    const proto = this.config.get('iceprotocol', 'icecast2');
    if (proto !== 'icecast2') {
        this.config.set('iceprotocol', 'icecast2');
        if (this.config.get('icestream', false) === true) {
            this.toast('info', 'LEGACY_PROTOCOL', { protocol: proto });
        }
    }
    if (!this.config.has('icefeedport')) this.config.set('icefeedport', '8010');
    if (!this.config.has('httpgenre')) this.config.set('httpgenre', '');
    if (!this.config.has('httpwebsite')) this.config.set('httpwebsite', '');
};

MpdOutput.prototype.getUIConfig = function () {
    const self = this;
    const defer = libQ.defer();
    const lang = self.commandRouter.sharedVars.get('language_code');
    const c = self.config;

    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then((uiconf) => {
            const http = uiconf.sections[0].content;
            setValue(http, 'httpstream', c.get('httpstream', false) === true);
            setValue(http, 'servername', c.get('servername', 'Volumio'));
            setSelect(http, 'encoder', c.get('encoder', 'lame'));
            setSelect(http, 'bitrate', c.get('bitrate', '320'));
            setSelect(http, 'format', c.get('format', '44100:16:2'));
            setValue(http, 'portn', c.get('portn', '8000'));
            setValue(http, 'httpadd', c.get('httpadd', false) === true);
            setValue(http, 'max_clients', c.get('max_clients', '5'));
            setValue(http, 'httpgenre', c.get('httpgenre', ''));
            setValue(http, 'httpwebsite', c.get('httpwebsite', ''));

            const ice = uiconf.sections[1].content;
            setValue(ice, 'icestream', c.get('icestream', false) === true);
            setValue(ice, 'iceservername', c.get('iceservername', ''));
            setValue(ice, 'icepublishport', c.get('icepublishport', '8000'));
            setValue(ice, 'icemountp', c.get('icemountp', '/volumio.ogg'));
            setValue(ice, 'iceuser', c.get('iceuser', 'source'));
            setValue(ice, 'icepassword', c.get('icepassword', ''));
            setSelect(ice, 'iceencoder', c.get('iceencoder', 'vorbis'));
            setSelect(ice, 'icebitrate', c.get('icebitrate', '192'));
            setSelect(ice, 'iceformat', c.get('iceformat', '44100:16:2'));
            setValue(ice, 'icestreamname', c.get('icestreamname', 'Volumio'));
            setValue(ice, 'icepublic', c.get('icepublic', 'no') === 'yes');
            setValue(ice, 'iceadd', c.get('iceadd', false) === true);
            setValue(ice, 'icedescription', c.get('icedescription', ''));
            setValue(ice, 'icegenre', c.get('icegenre', ''));
            setValue(ice, 'iceurl', c.get('iceurl', ''));
            setValue(ice, 'icefeedport', c.get('icefeedport', '8010'));

            const backups = self.listBackups();
            const none = { value: '', label: self.i18n('BACKUP_NONE_YET') };
            ['selected_backup', 'selected_backup_delete'].forEach((id) => {
                uiconf.sections.forEach((s) => {
                    const item = (s.content || []).find((x) => x.id === id);
                    if (!item) return;
                    item.options = backups.length ? backups : [none];
                    item.value = backups.length ? backups[0] : none;
                });
            });
            defer.resolve(uiconf);
        })
        .fail((e) => {
            self.logger.error(LOG + 'getUIConfig: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

function setValue(content, id, value) {
    const item = content.find((x) => x.id === id);
    if (item) item.value = value;
}

function setSelect(content, id, value) {
    const item = content.find((x) => x.id === id);
    if (!item) return;
    const opt = (item.options || []).find((o) => o.value === value);
    item.value = opt ? { value: opt.value, label: opt.label } : { value: value, label: String(value) };
}

function sel(v) {
    return v && typeof v === 'object' ? v.value : v;
}

MpdOutput.prototype.updateConfig = function (data) {
    const self = this;
    const c = self.config;
    const err = self.validateHttp(data, { icestream: c.get('icestream', false) === true, icefeedport: c.get('icefeedport', '8010') });
    if (err) {
        self.toast('error', err);
        return libQ.reject(new Error(err));
    }
    self.applyHttp(data);
    return self.saveAndApply();
};

MpdOutput.prototype.updateConfigIce = function (data) {
    const self = this;
    const c = self.config;
    const err = self.validateIce(data, { httpstream: c.get('httpstream', false) === true, portn: c.get('portn', '8000') });
    if (err) {
        self.toast('error', err);
        return libQ.reject(new Error(err));
    }
    self.applyIce(data);
    return self.saveAndApply();
};

// `other` carries the counterpart stream's state for the port clash check (current config on a
// save, the snapshot's own values on a restore).
MpdOutput.prototype.validateHttp = function (data, other) {
    const self = this;
    if (data.httpstream !== true) return null;
    return checkPort(self, data.portn, 'HTTP_PORT') ||
        checkText(self, data.servername, 'SERVERNAME') ||
        (data.httpadd === true && (
            checkInt(self, data.max_clients, 'MAX_CLIENTS') ||
            checkText(self, data.httpgenre, 'ICE_GENRE') ||
            checkText(self, data.httpwebsite, 'ICE_URL'))) ||
        (other.icestream && String(data.portn).trim() === String(other.icefeedport).trim() ? self.i18n('ERR_PORTS_DIFFER') : null) ||
        null;
};

MpdOutput.prototype.validateIce = function (data, other) {
    const self = this;
    if (data.icestream !== true) return null;
    return (!data.iceservername || !String(data.iceservername).trim() ? self.i18n('ERR_HOST') : null) ||
        checkPort(self, data.icepublishport, 'ICE_PORT') ||
        checkPort(self, data.icefeedport, 'ICE_FEED_PORT') ||
        (!/^\/\S*$/.test(String(data.icemountp || '').trim()) ? self.i18n('ERR_MOUNT') : null) ||
        (!data.icepassword ? self.i18n('ERR_PASSWORD') : null) ||
        checkText(self, data.icestreamname, 'ICE_NAME') ||
        (data.iceadd === true && (
            checkText(self, data.icedescription, 'ICE_DESCRIPTION') ||
            checkText(self, data.icegenre, 'ICE_GENRE') ||
            checkText(self, data.iceurl, 'ICE_URL'))) ||
        (other.httpstream && String(data.icefeedport).trim() === String(other.portn).trim() ? self.i18n('ERR_PORTS_DIFFER') : null) ||
        null;
};

MpdOutput.prototype.applyHttp = function (data) {
    const c = this.config;
    const on = data.httpstream === true;
    c.set('httpstream', on);
    if (!on) return;
    c.set('servername', String(data.servername).trim());
    c.set('encoder', sel(data.encoder));
    c.set('bitrate', sel(data.bitrate));
    c.set('format', sel(data.format));
    c.set('portn', String(data.portn).trim());
    c.set('httpadd', data.httpadd === true);
    if (data.httpadd === true) {
        c.set('max_clients', String(data.max_clients).trim());
        c.set('httpgenre', String(data.httpgenre || '').trim());
        c.set('httpwebsite', String(data.httpwebsite || '').trim());
    }
};

MpdOutput.prototype.applyIce = function (data) {
    const c = this.config;
    const on = data.icestream === true;
    c.set('icestream', on);
    if (!on) return;
    c.set('iceservername', String(data.iceservername).trim());
    c.set('icepublishport', String(data.icepublishport).trim());
    c.set('iceprotocol', 'icecast2');
    c.set('icemountp', String(data.icemountp).trim());
    c.set('iceencoder', sel(data.iceencoder));
    c.set('icebitrate', sel(data.icebitrate));
    c.set('iceformat', sel(data.iceformat));
    c.set('iceuser', String(data.iceuser || 'source').trim() || 'source');
    c.set('icepassword', String(data.icepassword));
    c.set('icestreamname', String(data.icestreamname).trim());
    c.set('icepublic', data.icepublic === true ? 'yes' : 'no');
    c.set('iceadd', data.iceadd === true);
    if (data.iceadd === true) {
        c.set('icedescription', String(data.icedescription || '').trim());
        c.set('icegenre', String(data.icegenre || '').trim());
        c.set('iceurl', String(data.iceurl || '').trim());
        c.set('icefeedport', String(data.icefeedport).trim());
    }
};

function checkPort(self, v, field) {
    const n = parseInt(String(v).trim(), 10);
    return /^\d+$/.test(String(v).trim()) && n >= 1 && n <= 65535 ? null : self.i18n('ERR_PORT', { field: self.i18n(field) });
}

function checkInt(self, v, field) {
    return isInt(v) ? null : self.i18n('ERR_NUMBER', { field: self.i18n(field) });
}

function checkText(self, v, field) {
    return /["\r\n]/.test(String(v || '')) ? self.i18n('ERR_TEXT', { field: self.i18n(field) }) : null;
}

MpdOutput.prototype.saveAndApply = function () {
    const self = this;
    const both = self.config.get('httpstream', false) === true || self.config.get('icestream', false) === true;
    const run = self.mpdConfIsCurrent() ? libQ.resolve() : self.rewriteMpdConf();
    return run
        .then(() => self.applyRelay())
        .then(() => {
            self.toast('success', both ? 'SAVED' : 'NOTHING_ENABLED');
        })
        .fail((e) => {
            self.toast('error', 'ERR_MPD', { error: e && e.message ? e.message : String(e) });
        });
};

// -------------------------------------------------------- settings backups

function backupName(raw) {
    const name = String(raw == null ? '' : raw).trim();
    return BACKUP_NAME_RE.test(name) && !name.includes('..') ? name : '';
}

function backupPath(name) {
    return path.join(BACKUP_DIR, name + '.json');
}

MpdOutput.prototype.backupSnapshot = function (name) {
    const values = {};
    BACKUP_KEYS.forEach((k) => { if (this.config.has(k)) values[k] = this.config.get(k); });
    let version = '';
    try { version = require('./package.json').version; } catch (e) { /* informational */ }
    return { schema_version: BACKUP_SCHEMA, plugin: PLUGIN_NAME, plugin_version: version, name, created: new Date().toISOString(), values };
};

MpdOutput.prototype.readBackup = function (name) {
    const safe = backupName(name);
    if (!safe) return { error: 'ERR_BACKUP_CHOOSE' };
    let snap;
    try { snap = JSON.parse(fs.readFileSync(backupPath(safe), 'utf8')); } catch (e) { return { error: 'ERR_BACKUP_MISSING' }; }
    if (!snap || snap.schema_version !== BACKUP_SCHEMA || !snap.values || typeof snap.values !== 'object') return { error: 'ERR_BACKUP_INVALID' };
    return { name: safe, snapshot: snap };
};

MpdOutput.prototype.listBackups = function () {
    let files = [];
    try { files = fs.readdirSync(BACKUP_DIR); } catch (e) { return []; }
    return files
        .filter((f) => f.endsWith('.json') && backupName(f.slice(0, -5)))
        .map((f) => this.readBackup(f.slice(0, -5)))
        .filter((r) => !r.error)
        .sort((a, b) => String(b.snapshot.created).localeCompare(String(a.snapshot.created)))
        .map((r) => ({ value: r.name, label: r.name + ' (' + String(r.snapshot.created).slice(0, 10) + ')' }));
};

MpdOutput.prototype.createBackup = function (data) {
    const name = backupName(data && data.backup_name);
    if (!name) { this.toast('error', 'ERR_BACKUP_NAME'); return libQ.resolve(); }
    try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
        // Carries the Icecast source password: owner-only like relay.json.
        fs.writeFileSync(backupPath(name), JSON.stringify(this.backupSnapshot(name), null, 2) + '\n', { mode: 0o600 });
    } catch (e) {
        this.logger.error(LOG + 'backup: ' + (e && e.message ? e.message : e));
        this.toast('error', 'ERR_BACKUP_WRITE', { error: e && e.message ? e.message : String(e) });
        return libQ.resolve();
    }
    this.toast('success', 'BACKUP_SAVED', { name });
    return this.refreshUi();
};

// Values are checked by the same rules as a save, against the snapshot itself; applied with one MPD restart.
MpdOutput.prototype.restoreBackup = function (data) {
    const read = this.readBackup(sel(data && data.selected_backup));
    if (read.error) { this.toast('error', read.error); return libQ.resolve(); }
    const v = read.snapshot.values;
    const http = Object.assign({}, v, { httpstream: v.httpstream === true, httpadd: v.httpadd === true });
    const ice = Object.assign({}, v, { icestream: v.icestream === true, iceadd: v.iceadd === true, icepublic: v.icepublic === 'yes' || v.icepublic === true });
    const err = this.validateHttp(http, { icestream: ice.icestream, icefeedport: ice.icefeedport }) ||
        this.validateIce(ice, { httpstream: http.httpstream, portn: http.portn });
    if (err) { this.toast('error', 'ERR_BACKUP_REJECTED', { error: err }); return libQ.resolve(); }
    this.applyHttp(http);
    this.applyIce(ice);
    const self = this;
    return this.saveAndApply().then(() => { self.toast('success', 'RESTORED', { name: read.name }); return self.refreshUi(); });
};

MpdOutput.prototype.deleteBackup = function (data) {
    const name = backupName(sel(data && data.selected_backup_delete));
    if (!name) { this.toast('error', 'ERR_BACKUP_CHOOSE'); return libQ.resolve(); }
    try { fs.unlinkSync(backupPath(name)); } catch (e) { this.toast('error', 'ERR_BACKUP_MISSING'); return libQ.resolve(); }
    this.toast('success', 'BACKUP_DELETED', { name });
    return this.refreshUi();
};

MpdOutput.prototype.refreshUi = function () {
    const self = this;
    if (typeof self.commandRouter.getUIConfigOnPlugin !== 'function') return libQ.resolve();
    return self.commandRouter.getUIConfigOnPlugin(PLUGIN_TYPE, PLUGIN_NAME, {})
        .then((ui) => { self.commandRouter.broadcastMessage('pushUiConfig', ui); })
        .fail(() => undefined);
};

// ------------------------------------------------------------------- i18n

MpdOutput.prototype.i18n = function (key, vars) {
    let s = this.commandRouter.getI18nString('MPDOUTPUT.' + key);
    if (s === 'MPDOUTPUT.' + key) s = key;
    if (vars) {
        Object.keys(vars).forEach((k) => { s = s.split('{{' + k + '}}').join(String(vars[k])); });
    }
    return s;
};

MpdOutput.prototype.toast = function (type, keyOrText, vars, titleKey) {
    const title = this.i18n(titleKey || 'PLUGIN_NAME');
    const text = /^[A-Z_]+$/.test(keyOrText) ? this.i18n(keyOrText, vars) : keyOrText;
    this.commandRouter.pushToastMessage(type, title, text);
};
