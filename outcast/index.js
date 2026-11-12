'use strict';
// Outcast Uplink: the plugin shell. It owns the audio path (the tap's ALSA contribution,
// proved with the player's own ALSA before it is registered and taken back when the
// chain does not take it), the core's service, the title from the player's state, and
// the settings page, whose settings it hands to the core as one file. The core
// (bin/outcast) carries the sound to the uplinks.

const libQ = require('kew');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const VConf = require('v-conf');
const h = require('./helpers');
const dj = require('./dj');

const LOG = 'outcast: ';
const CONTRIBUTION = 'Outcast.postOutcast.5.conf';
const TEMPLATE = path.join(__dirname, CONTRIBUTION + '.tmpl');
const CONTRIBUTION_FILE = path.join(__dirname, 'asound', CONTRIBUTION);
const LIBRARY = path.join(__dirname, 'lib', 'libevotap.so');
const ALSA_FILE = '/etc/asound.conf';
const SERVICE = 'outcast.service';
const RUN_DIR = '/run/outcast';
const JINGLES_DIR = '/data/INTERNAL/outcast/jingles';
const STATUS_FILE = RUN_DIR + '/status.json';
const CONTROL_SOCKET = RUN_DIR + '/control.sock';
const CHECK_CONF = '/tmp/outcast-check.conf';
const CHECK_TAG = 'outcast-check';

const msg = (e) => (e && e.message ? e.message : String(e));
// An error that names the string the user sees.
function keyed(key, e) {
    const err = new Error(msg(e));
    err.key = key;
    return err;
}

function Outcast(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = this.commandRouter.logger;
    this.config = new VConf();
    this.active = false;
    this.stateCallback = null;
    this.alsaWatcher = null;
    // off, ready, failed or lost: where the tap stands in the audio chain.
    this.audioPath = 'off';
    this.audioPathError = '';
    this.lastLoggedTitle = '';
    this.uplinksFile = null;
    // DJ mode: the programme, the scheduler's decisions, the last state seen.
    this.djFile = null;
    this.dj = { enabled: false, blocks: [] };
    this.sched = new dj.Scheduler();
    this.inserts = new dj.Inserts();
    this.djTimer = null;
    this.lastState = null;
    this.lastUri = null;
    this.lastDjKey = '';
}

// ----------------------------------------------------------------- lifecycle

Outcast.prototype.onVolumioStart = function () {
    this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config.loadFile(this.configFile);
    // The uplinks, as the core reads them, beside the configuration.
    this.uplinksFile = path.join(path.dirname(this.configFile), 'uplinks.json');
    this.djFile = path.join(path.dirname(this.configFile), 'dj.json');
    this.loadDj();
    return libQ.resolve();
};

Outcast.prototype.onStart = function () {
    const self = this;
    self.active = true;
    self.commandRouter.loadI18nStrings();
    self.subscribeState();
    // The core reads the uplinks at its start: the file is written first, whatever the
    // audio path's fate; the core's status says what it sees.
    try { self.writeUplinks(); } catch (e) { self.logger.error(LOG + 'uplinks: ' + msg(e)); }
    self.djTimer = setInterval(() => { try { self.djTick(); } catch (e) { self.logger.error(LOG + 'dj: ' + msg(e)); } }, 15000);
    return self.installAudioPath()
        .fail(() => undefined)
        .then(() => self.startCore())
        .fail((e) => {
            self.logger.error(LOG + 'start: ' + msg(e));
            self.toast('error', 'ERR_CORE', { error: msg(e) });
        })
        .then(() => 'OK');
};

Outcast.prototype.onStop = function () {
    const self = this;
    self.active = false;
    self.unsubscribeState();
    self.unwatchChain();
    if (self.djTimer) { clearInterval(self.djTimer); self.djTimer = null; }
    return self.stopCore()
        .fail((e) => { self.logger.warn(LOG + 'stop: ' + msg(e)); })
        .then(() => self.removeAudioPath())
        .fail((e) => { self.logger.error(LOG + 'stop: ' + msg(e)); })
        .then(() => 'OK');
};

Outcast.prototype.onRestart = function () {
    return libQ.resolve();
};

Outcast.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

Outcast.prototype.getI18nFile = function (langCode) {
    const file = path.join(__dirname, 'i18n', 'strings_' + langCode + '.json');
    return fs.existsSync(file) ? file : path.join(__dirname, 'i18n', 'strings_en.json');
};

// ---------------------------------------------------------------- audio path

// The tap into the player's chain, in four steps, none of which touches the chain
// before the one before it has passed: the library is there; the player's own ALSA
// loads it and plays a second through it into nothing; the contribution is written and
// the player asked to write its chain; the chain as written carries the tap and parses.
// A step that fails takes the contribution back, so nothing of the plugin stays in the
// chain, and says why. The player gathers contributions from the plugins it has marked
// enabled, and on the first start after an install it starts the plugin before the
// mark lands: a chain written without the tap is asked for again, a few times, before
// it counts as refused.
const CHAIN_TRIES = 5;
const CHAIN_RETRY_MS = 3000;

Outcast.prototype.installAudioPath = function () {
    const self = this;
    const start = fs.existsSync(LIBRARY) ? libQ.resolve() : libQ.reject(keyed('ERR_LIBRARY', new Error(LIBRARY + ' is missing')));
    const attempt = (left) => self.updateChain()
        .then(() => self.verifyChain())
        .fail((e) => {
            if (left <= 1 || !(e && e.key === 'ERR_CHAIN')) throw e;
            self.logger.info(LOG + 'the chain was written without the tap; asked again in ' + (CHAIN_RETRY_MS / 1000) + ' s (' + (left - 1) + ' left)');
            const defer = libQ.defer();
            setTimeout(() => defer.resolve(), CHAIN_RETRY_MS);
            return defer.promise.then(() => attempt(left - 1));
        });
    return start
        .then(() => self.preflight())
        .then(() => self.writeContribution())
        .then(() => attempt(CHAIN_TRIES))
        .then(() => {
            self.audioPath = 'ready';
            self.audioPathError = '';
            self.tapNote = self.chainLibraryNote();
            self.watchChain();
            self.logger.info(LOG + 'the tap is in the audio chain');
        })
        .fail((e) => {
            const reason = msg(e);
            self.logger.error(LOG + 'audio path: ' + reason);
            self.audioPath = 'failed';
            self.audioPathError = reason;
            return self.removeAudioPath()
                .fail((back) => { self.logger.error(LOG + 'audio path: the back-out failed too: ' + msg(back)); })
                .then(() => {
                    self.toast('error', e && e.key ? e.key : 'ERR_CHAIN', { error: reason });
                    throw e;
                });
        });
};

// The library loaded by the player's own ALSA, as a PCM of its own that plays one
// second of silence into nothing: proves the library is this machine's, that ALSA takes
// the plugin type, and that the ring is made. The player's chain is not in it.
Outcast.prototype.preflight = function () {
    const self = this;
    const defer = libQ.defer();
    try {
        fs.writeFileSync(CHECK_CONF, h.checkConfig(LIBRARY, CHECK_TAG));
    } catch (e) {
        return libQ.reject(keyed('ERR_PREFLIGHT', e));
    }
    execFile('/usr/bin/aplay', ['-D', 'OutcastCheck', '-q', '-f', 'S16_LE', '-r', '48000', '-c', '2', '-d', '1', '/dev/zero'],
        { env: Object.assign({}, process.env, { ALSA_CONFIG_PATH: CHECK_CONF }), timeout: 15000 },
        (error, stdout, stderr) => {
            try { fs.unlinkSync(CHECK_CONF); } catch (e) { /* already gone */ }
            if (error) {
                defer.reject(keyed('ERR_PREFLIGHT', new Error(String(stderr || error.message).trim())));
            } else {
                self.logger.info(LOG + 'preflight: the tap loads and plays through');
                defer.resolve();
            }
        });
    return defer.promise;
};

Outcast.prototype.writeContribution = function () {
    try {
        fs.mkdirSync(path.dirname(CONTRIBUTION_FILE), { recursive: true });
        fs.writeFileSync(CONTRIBUTION_FILE, fs.readFileSync(TEMPLATE, 'utf8'), 'utf8');
        return libQ.resolve();
    } catch (e) {
        return libQ.reject(keyed('ERR_CHAIN', e));
    }
};

// Whose library serves the tap: ALSA takes the last `pcm_type.evotap` in the chain, and
// another plugin (Glass) names its own copy. The same bytes are the same library and
// need no word; a different file is said in the status, and the core's ring reader has
// the last word on the ring's version.
Outcast.prototype.chainLibraryNote = function () {
    let text = '';
    try { text = fs.readFileSync(ALSA_FILE, 'utf8'); } catch (e) { return null; }
    const libs = h.chainLibraries(text);
    const last = libs[libs.length - 1];
    if (!last || path.resolve(last) === path.resolve(LIBRARY)) return null;
    const digest = (file) => {
        try { return require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (e) { return null; }
    };
    const same = digest(last) !== null && digest(last) === digest(LIBRARY);
    this.logger[same ? 'info' : 'warn'](LOG + 'the chain\'s tap library is ' + last + (same ? ' (the same library as ours)' : ' (not the same bytes as ours)'));
    return same ? { key: 'STATUS_TAP_SHARED', vars: { path: last } } : { key: 'STATUS_TAP_FOREIGN', vars: { path: last } };
};

// The player writes its chain from every enabled plugin's contribution.
Outcast.prototype.updateChain = function () {
    const self = this;
    const defer = libQ.defer();
    let done = false;
    const finish = () => { if (!done) { done = true; defer.resolve(); } };
    let ret;
    try {
        ret = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'updateALSAConfigFile');
    } catch (e) {
        return libQ.reject(keyed('ERR_CHAIN', e));
    }
    if (ret && typeof ret.then === 'function') {
        ret.then(finish, (e) => { if (!done) { done = true; defer.reject(keyed('ERR_CHAIN', e)); } });
    } else {
        finish();
    }
    return defer.promise;
};

// The chain as written carries the tap, and the player's ALSA reads it whole.
Outcast.prototype.verifyChain = function () {
    const defer = libQ.defer();
    let text = '';
    try { text = fs.readFileSync(ALSA_FILE, 'utf8'); } catch (e) { return libQ.reject(keyed('ERR_CHAIN', e)); }
    if (!h.chainHasTap(text)) {
        return libQ.reject(keyed('ERR_CHAIN', new Error('the player did not take the contribution into ' + ALSA_FILE)));
    }
    execFile('/usr/bin/aplay', ['-L'], { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) defer.reject(keyed('ERR_CHAIN', new Error(String(stderr || error.message).trim())));
        else defer.resolve();
    });
    return defer.promise;
};

// Nothing of the plugin left in the chain: the contribution gone, the chain written
// again where it was there.
Outcast.prototype.removeAudioPath = function () {
    const self = this;
    self.unwatchChain();
    if (!fs.existsSync(CONTRIBUTION_FILE)) return libQ.resolve();
    try { fs.unlinkSync(CONTRIBUTION_FILE); } catch (e) { return libQ.reject(e); }
    if (self.audioPath !== 'off') self.audioPath = 'off';
    return self.updateChain();
};

// The player writes its chain again as other plugins start and stop; a chain written
// without the tap while the plugin runs is noted, for the status and the journal.
Outcast.prototype.watchChain = function () {
    const self = this;
    self.unwatchChain();
    self.alsaWatcher = (curr, prev) => {
        if (!curr || !prev || curr.mtimeMs === prev.mtimeMs) return;
        let text = '';
        try { text = fs.readFileSync(ALSA_FILE, 'utf8'); } catch (e) { return; }
        if (h.chainHasTap(text)) {
            if (self.audioPath === 'lost') { self.audioPath = 'ready'; self.logger.info(LOG + 'the tap is in the audio chain again'); }
        } else if (self.audioPath === 'ready') {
            self.audioPath = 'lost';
            self.logger.warn(LOG + 'the audio chain was written without the tap');
        }
    };
    try {
        fs.watchFile(ALSA_FILE, { interval: 5000, persistent: false }, self.alsaWatcher);
    } catch (e) {
        self.logger.warn(LOG + 'chain watch: ' + msg(e));
    }
};

Outcast.prototype.unwatchChain = function () {
    if (this.alsaWatcher) {
        try { fs.unwatchFile(ALSA_FILE, this.alsaWatcher); } catch (e) { /* not watched */ }
        this.alsaWatcher = null;
    }
};

// ---------------------------------------------------------------------- core

Outcast.prototype.systemctl = function (verb) {
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

Outcast.prototype.startCore = function () {
    return this.systemctl('restart');
};

Outcast.prototype.stopCore = function () {
    return this.systemctl('stop');
};

Outcast.prototype.readStatus = function () {
    try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (e) { return null; }
};

// One line to the core's control socket; nothing waits on the answer.
Outcast.prototype.tellCore = function (request) {
    const c = net.connect(CONTROL_SOCKET);
    c.on('error', () => { /* the core is not up: nothing to tell */ });
    c.end(JSON.stringify(request) + '\n');
};

// The uplinks as the core reads them, from the configuration, written whole and moved
// into place; the file holds the source password, so it is the plugin's alone.
Outcast.prototype.writeUplinks = function () {
    const self = this;
    const text = JSON.stringify(h.uplinksFrom((k, d) => self.config.get(k, d)), null, 2) + '\n';
    const part = self.uplinksFile + '.part';
    fs.writeFileSync(part, text, { mode: 0o600 });
    fs.renameSync(part, self.uplinksFile);
};

// ----------------------------------------------------------------- the title

Outcast.prototype.subscribeState = function () {
    if (this.stateCallback) return;
    this.stateCallback = (state) => this.onVolumioState(state);
    this.commandRouter.addCallback('volumioPushState', this.stateCallback);
};

// The backend has no removeCallback; a left-over closure would outlive this instance.
Outcast.prototype.unsubscribeState = function () {
    const all = this.commandRouter.callbacks;
    if (this.stateCallback && all && Array.isArray(all.volumioPushState)) {
        all.volumioPushState = all.volumioPushState.filter((f) => f !== this.stateCallback);
    }
    this.stateCallback = null;
};

// Every state push while playing is handed to the core, which carries a title on only
// where it differs from the one an uplink has.
Outcast.prototype.onVolumioState = function (state) {
    if (!this.active || !state) return;
    this.lastState = state;
    try { this.djTick(state); } catch (e) { this.logger.error(LOG + 'dj: ' + msg(e)); }
    if (state.status !== 'play') return;
    const title = h.screenTitle(state);
    if (!title) return;
    if (title !== this.lastLoggedTitle) {
        this.lastLoggedTitle = title;
        this.logger.info(LOG + 'title: ' + title);
    }
    this.tellCore({ op: 'title', title });
};

// -------------------------------------------------------------------- DJ mode
// The programme (dj.json beside the configuration) drives the player through the
// command router; the scheduler decides, this acts and tells the core for the status.

Outcast.prototype.loadDj = function () {
    try { this.dj = dj.tidy(JSON.parse(fs.readFileSync(this.djFile, 'utf8'))); } catch (e) { this.dj = { enabled: false, blocks: [], inserts: [] }; }
    try { fs.mkdirSync(JINGLES_DIR, { recursive: true }); } catch (e) { /* the folder is made by the install; a player without it says so in the status */ }
};

// The WAV files in the jingles folder, for the programme page.
Outcast.prototype.jingles = function () {
    try { return fs.readdirSync(JINGLES_DIR).filter((f) => /\.wav$/i.test(f)).sort(); } catch (e) { return []; }
};

Outcast.prototype.saveDjFile = function () {
    const part = this.djFile + '.part';
    fs.writeFileSync(part, JSON.stringify(this.dj, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(part, this.djFile);
};

Outcast.prototype.djReport = function () {
    return this.sched.report(this.dj, new Date());
};

// To the editor page over the player's socket, as the Volumio page is told things.
Outcast.prototype.pushDj = function (extra) {
    this.commandRouter.broadcastMessage('pushDj', Object.assign({ now: this.djReport() }, extra || {}));
};

Outcast.prototype.djGet = function () { this.pushDj({ programme: this.dj, files: this.jingles(), folder: JINGLES_DIR }); return libQ.resolve(); };
Outcast.prototype.djNow = function () { this.pushDj({}); return libQ.resolve(); };

Outcast.prototype.djSave = function (data) {
    const err = dj.validate(data);
    if (err) { this.pushDj({ error: this.i18n(err) }); return libQ.resolve(); }
    this.dj = dj.tidy(data);
    try { this.saveDjFile(); } catch (e) { this.pushDj({ error: this.i18n('ERR_SAVE', { error: msg(e) }) }); return libQ.resolve(); }
    this.logger.info(LOG + 'dj: programme saved, ' + this.dj.blocks.length + ' blocks, ' + (this.dj.enabled ? 'on' : 'off'));
    this.pushDj({ programme: this.dj, saved: true, files: this.jingles(), folder: JINGLES_DIR });
    this.djTick();
    return libQ.resolve();
};

// An insert played into the stream by the core: the file from the jingles folder.
Outcast.prototype.djInsert = function (insert) {
    this.logger.info(LOG + 'dj: insert ' + insert.name + ' (' + insert.file + ')');
    this.tellCore({ op: 'insert', file: path.join(JINGLES_DIR, insert.file), name: insert.name, duck_db: insert.duck_db });
};

// The programme page asks for an insert now, by its id.
Outcast.prototype.djPlayInsert = function (data) {
    const ins = (this.dj.inserts || []).find((i) => i.id === String(data && data.id));
    if (ins) this.djInsert(ins);
    return libQ.resolve();
};

Outcast.prototype.djTakeOver = function () {
    this.sched.takeOver();
    this.djTick();
    this.pushDj({});
    return libQ.resolve();
};

// The Volumio page's switch alone; the blocks are the editor's.
Outcast.prototype.updateDj = function (data) {
    this.dj.enabled = data && data.dj_enabled === true;
    try { this.saveDjFile(); } catch (e) { this.toast('error', 'ERR_SAVE', { error: msg(e) }); return libQ.resolve(); }
    this.toast('success', 'DJ_SAVED');
    this.djTick();
    return libQ.resolve();
};

// One look: the block in force against the player; acted on when due; the core told.
Outcast.prototype.djTick = function (state) {
    const self = this;
    if (!self.active) return;
    let st = state || self.lastState;
    if (!st) { try { st = self.commandRouter.volumioGetState(); } catch (e) { st = null; } }
    let queue = null;
    try { const q = self.commandRouter.volumioGetQueue(); queue = Array.isArray(q) ? q : null; } catch (e) { queue = null; }
    self.sched.settle(queue);
    const now = new Date();
    const d = self.sched.decide(self.dj, now, st ? { status: st.status, uri: st.uri } : null, queue);
    if (d.action === 'act') self.djAct(d.block);
    else self.tellDj('');
    // A track ended: the playing uri changed while playing. The inserts due go to the core.
    const uri = st && st.status === 'play' ? String(st.uri || '') : null;
    const boundary = uri !== null && self.lastUri !== null && uri !== self.lastUri;
    if (uri !== null) self.lastUri = uri;
    if (self.dj.enabled) {
        for (const ins of self.inserts.tick(self.dj.inserts, now, boundary, d.action === 'act')) self.djInsert(ins);
    }
};

Outcast.prototype.djAct = function (block) {
    const self = this;
    self.sched.didAct(block, new Date());
    self.logger.info(LOG + 'dj: ' + block.name + ' (' + block.source.kind + ')');
    try {
        if (block.source.kind === 'playlist') {
            self.commandRouter.volumioRandom(block.random === true);
            self.commandRouter.playListManager.playPlaylist(block.source.name);
        } else if (block.source.kind === 'webradio') {
            self.commandRouter.replaceAndPlay({ uri: block.source.uri, service: 'webradio', title: block.source.title || block.name, type: 'webradio' });
        }
    } catch (e) { self.logger.error(LOG + 'dj: ' + block.name + ': ' + msg(e)); }
    self.tellDj('DJ mode: ' + block.name + ' started');
};

// The core told once per change, so the status and the dashboard carry DJ mode; told
// again whenever the core's status lacks it, since the core may have been starting
// when the last word went (at the plugin's start the core is restarted), or restarted
// since.
Outcast.prototype.tellDj = function (event) {
    const r = this.djReport();
    const key = JSON.stringify([r.enabled, r.block, r.next, r.yielded, r.acted_at]);
    const status = this.readStatus();
    const known = status && status.dj && typeof status.dj === 'object';
    if (!event && key === this.lastDjKey && known) return;
    this.lastDjKey = key;
    this.tellCore(event ? { op: 'dj', dj: r, event } : { op: 'dj', dj: r });
};

// ------------------------------------------------------------------ the page

function setValue(content, id, value) {
    const item = content.find((c) => c.id === id);
    if (item) item.value = value;
}

function setSelect(content, id, value) {
    const item = content.find((c) => c.id === id);
    if (!item) return;
    const option = (item.options || []).find((o) => String(o.value) === String(value));
    if (option) item.value = { value: option.value, label: option.label };
}

Outcast.prototype.getUIConfig = function () {
    const self = this;
    const defer = libQ.defer();
    const lang = self.commandRouter.sharedVars.get('language_code');
    const c = self.config;
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then((uiconf) => {
            const section = (id) => (uiconf.sections.find((s) => s.id === id) || { content: [] }).content;
            // The encoding fields: the preset and, under Advanced, the operator's own. A
            // player from a release without presets shows its values under Advanced.
            const encoding = (content, prefix) => {
                const preset = String(c.get(prefix + '_preset', ''));
                const fallback = h.PRESETS[h.DEFAULT_PRESET[prefix]];
                setSelect(content, prefix + '_preset', h.PRESETS[preset] ? preset : h.DEFAULT_PRESET[prefix]);
                setValue(content, prefix + '_advanced', preset === '' || c.get(prefix + '_advanced', false) === true);
                setSelect(content, prefix + '_codec', c.get(prefix + '_codec', fallback.codec));
                setValue(content, prefix + '_bitrate', String(c.get(prefix + '_bitrate', String(fallback.bitrate))));
                setValue(content, prefix + '_rate', String(c.get(prefix + '_rate', String(fallback.rate))));
                setSelect(content, prefix + '_channels', String(c.get(prefix + '_channels', String(fallback.channels))));
            };
            h.ICE_SLOTS.forEach((p) => {
                const ice = section(p === 'ice' ? 'icecast_section' : 'icecast' + p.slice(3) + '_section');
                setValue(ice, p + '_enabled', c.get(p + '_enabled', false) === true);
                ['host', 'port', 'mount', 'user', 'password', 'name', 'description', 'genre', 'url']
                    .forEach((k) => setValue(ice, p + '_' + k, String(c.get(p + '_' + k, ''))));
                setSelect(ice, p + '_protocol', c.get(p + '_protocol', 'icecast2'));
                setValue(ice, p + '_stream_id', String(c.get(p + '_stream_id', '1')));
                encoding(ice, p);
                setValue(ice, p + '_more', c.get(p + '_more', false) === true);
                setValue(ice, p + '_public', c.get(p + '_public', false) === true);
                setValue(ice, p + '_keep_alive', c.get(p + '_keep_alive', true) !== false);
                h.hideWhenOff(ice, p, (k, d) => c.get(k, d));
            });

            const lan = section('lan_section');
            setValue(lan, 'lan_enabled', c.get('lan_enabled', false) === true);
            setValue(lan, 'lan_port', String(c.get('lan_port', '8000')));
            encoding(lan, 'lan');
            setValue(lan, 'lan_name', String(c.get('lan_name', 'Volumio')));
            setValue(lan, 'lan_max_listeners', String(c.get('lan_max_listeners', '5')));
            setValue(lan, 'lan_keep_alive', c.get('lan_keep_alive', true) !== false);
            h.hideWhenOff(lan, 'lan', (k, d) => c.get(k, d));

            const rec = section('record_section');
            setValue(rec, 'rec_enabled', c.get('rec_enabled', false) === true);
            setValue(rec, 'rec_folder', String(c.get('rec_folder', '/data/INTERNAL/outcast/recordings')));
            encoding(rec, 'rec');
            setSelect(rec, 'rec_split', c.get('rec_split', 'track'));
            setValue(rec, 'rec_title_in_name', c.get('rec_title_in_name', true) !== false);
            h.hideWhenOff(rec, 'rec', (k, d) => c.get(k, d));

            const srt = section('srt_section');
            setValue(srt, 'srt_enabled', c.get('srt_enabled', false) === true);
            ['srt_host', 'srt_port', 'srt_stream_id', 'srt_passphrase', 'srt_latency']
                .forEach((k) => setValue(srt, k, String(c.get(k, ''))));
            encoding(srt, 'srt');
            setValue(srt, 'srt_keep_alive', c.get('srt_keep_alive', true) !== false);
            h.hideWhenOff(srt, 'srt', (k, d) => c.get(k, d));

            const rtmp = section('rtmp_section');
            setValue(rtmp, 'rtmp_enabled', c.get('rtmp_enabled', false) === true);
            setValue(rtmp, 'rtmp_url', String(c.get('rtmp_url', '')));
            setValue(rtmp, 'rtmp_key', String(c.get('rtmp_key', '')));
            encoding(rtmp, 'rtmp');
            setValue(rtmp, 'rtmp_ca_file', String(c.get('rtmp_ca_file', '')));
            setValue(rtmp, 'rtmp_keep_alive', c.get('rtmp_keep_alive', true) !== false);
            h.hideWhenOff(rtmp, 'rtmp', (k, d) => c.get(k, d));

            const ts = section('ts_section');
            setValue(ts, 'ts_enabled', c.get('ts_enabled', false) === true);
            setSelect(ts, 'ts_transport', c.get('ts_transport', 'tcp'));
            ['ts_host', 'ts_port', 'ts_ttl'].forEach((k) => setValue(ts, k, String(c.get(k, ''))));
            encoding(ts, 'ts');
            setValue(ts, 'ts_keep_alive', c.get('ts_keep_alive', true) !== false);
            h.hideWhenOff(ts, 'ts', (k, d) => c.get(k, d));

            const hls = section('hls_section');
            setValue(hls, 'hls_enabled', c.get('hls_enabled', false) === true);
            setValue(hls, 'hls_name', String(c.get('hls_name', 'stream')));
            encoding(hls, 'hls');
            ['hls_segment_seconds', 'hls_window', 'hls_port', 'hls_max_connections', 'hls_origin_url', 'hls_origin_user', 'hls_origin_password', 'hls_ca_file',
                'hls_s3_endpoint', 'hls_s3_bucket', 'hls_s3_prefix', 'hls_s3_region', 'hls_s3_access_key', 'hls_s3_secret_key', 'hls_s3_ca_file']
                .forEach((k) => setValue(hls, k, String(c.get(k, ''))));
            setValue(hls, 'hls_s3_path_style', c.get('hls_s3_path_style', true) !== false);
            setValue(hls, 'hls_serve', c.get('hls_serve', true) !== false);
            setValue(hls, 'hls_keep_alive', c.get('hls_keep_alive', true) !== false);
            setSelect(hls, 'hls_origin', c.get('hls_origin', 'none'));
            setSelect(hls, 'hls_form', c.get('hls_form', 'packed'));
            setValue(hls, 'hls_dash', c.get('hls_dash', false) === true);
            h.hideWhenOff(hls, 'hls', (k, d) => c.get(k, d));

            // DJ mode: the switch from the programme file, the editor's buttons at the
            // dashboard's address.
            const djs = section('dj_section');
            setValue(djs, 'dj_enabled', self.dj.enabled === true);
            const djHere = djs.find((x) => x.id === 'open_dj');
            const djTab = djs.find((x) => x.id === 'open_dj_tab');
            {
                const found2 = h.lanAddress(require('os').networkInterfaces());
                const address2 = String(c.get('mon_dashboard_host', '')).trim() || found2;
                if (c.get('mon_dashboard', true) !== false && address2) {
                    const links = h.dashboardLinks(address2, c.get('mon_dashboard_port', '8020'), 'dj');
                    if (djHere) djHere.onClick.performerUrl = links.here;
                    if (djTab) {
                        djTab.onClick.url = links.url;
                        djTab.doc = self.commandRouter.getI18nString('OUTCAST.DJ_OPEN_TAB_DESC') + ' ' + links.url;
                    }
                } else {
                    if (djHere) djHere.hidden = true;
                    if (djTab) djTab.hidden = true;
                }
            }
            const mon = section('monitor_section');
            setValue(mon, 'mon_dashboard', c.get('mon_dashboard', true) !== false);
            setValue(mon, 'mon_dashboard_port', String(c.get('mon_dashboard_port', '8020')));
            // The address browsers reach the player by: the operator's when set, else the
            // one found on the player's own interfaces (an IP address, so a network whose
            // .local names do not resolve still gets there); the one found is the field's
            // placeholder.
            const found = h.lanAddress(require('os').networkInterfaces());
            const override = String(c.get('mon_dashboard_host', '')).trim();
            setValue(mon, 'mon_dashboard_host', override);
            const hostField = mon.find((x) => x.id === 'mon_dashboard_host');
            if (hostField && hostField.attributes && hostField.attributes[0]) hostField.attributes[0].placeholder = found || '';
            // The dashboard's buttons open the core's page at that address, here inside
            // Volumio's own page or in a tab of its own; without the dashboard the buttons
            // are not there.
            const stat = section('status_section');
            const here = stat.find((x) => x.id === 'open_dashboard');
            const tab = stat.find((x) => x.id === 'open_dashboard_tab');
            const address = override || found;
            if (c.get('mon_dashboard', true) !== false && address) {
                const links = h.dashboardLinks(address, c.get('mon_dashboard_port', '8020'));
                if (here) here.onClick.performerUrl = links.here;
                if (tab) {
                    tab.onClick.url = links.url;
                    tab.doc = self.commandRouter.getI18nString('OUTCAST.STATUS_DASHBOARD_TAB_DESC') + ' ' + links.url;
                }
            } else {
                if (here) here.hidden = true;
                if (tab) tab.hidden = true;
            }
            setValue(mon, 'mon_enabled', c.get('mon_enabled', true) !== false);
            setValue(mon, 'mon_level', String(c.get('mon_level', '-60')));
            setValue(mon, 'mon_seconds', String(c.get('mon_seconds', '30')));
            defer.resolve(uiconf);
        })
        .fail((e) => {
            self.logger.error(LOG + 'getUIConfig: ' + msg(e));
            defer.reject(new Error());
        });
    return defer.promise;
};

// A section saved: checked, kept, written for the core, and the core told.
Outcast.prototype.saveSection = function (data, validate, apply) {
    const self = this;
    const err = validate(data, (k, v) => self.i18n(k, v));
    if (err) {
        self.toast('error', err);
        return libQ.reject(new Error(err));
    }
    try {
        apply(data, (k, v) => self.config.set(k, v));
        self.writeUplinks();
    } catch (e) {
        self.logger.error(LOG + 'save: ' + msg(e));
        self.toast('error', 'ERR_SAVE', { error: msg(e) });
        return libQ.reject(e);
    }
    self.tellCore({ op: 'reload' });
    self.toast('success', 'SAVED');
    return libQ.resolve();
};

Outcast.prototype.updateIcecast = function (data) {
    return this.saveSection(data, h.validateIcecast, h.applyIcecast);
};

Outcast.prototype.updateIcecast2 = function (data) {
    return this.saveSection(data, (d, t) => h.validateIcecast(d, t, 'ice2'), (d, set) => h.applyIcecast(d, set, 'ice2'));
};

Outcast.prototype.updateIcecast3 = function (data) {
    return this.saveSection(data, (d, t) => h.validateIcecast(d, t, 'ice3'), (d, set) => h.applyIcecast(d, set, 'ice3'));
};

Outcast.prototype.updateLan = function (data) {
    return this.saveSection(data, h.validateLan, h.applyLan);
};

Outcast.prototype.updateRecord = function (data) {
    return this.saveSection(data, h.validateRecord, h.applyRecord);
};

Outcast.prototype.updateSrt = function (data) {
    return this.saveSection(data, h.validateSrt, h.applySrt);
};

Outcast.prototype.updateRtmp = function (data) {
    return this.saveSection(data, h.validateRtmp, h.applyRtmp);
};

Outcast.prototype.updateTs = function (data) {
    return this.saveSection(data, h.validateTs, h.applyTs);
};

Outcast.prototype.updateHls = function (data) {
    return this.saveSection(data, h.validateHls, h.applyHls);
};

Outcast.prototype.updateMonitor = function (data) {
    return this.saveSection(data, h.validateMonitor, h.applyMonitor);
};

Outcast.prototype.showStatus = function () {
    const self = this;
    const lines = h.summarize(self.readStatus(), self.audioPath, self.audioPathError, (key, vars) => self.i18n(key, vars), self.tapNote);
    self.commandRouter.pushToastMessage('info', self.i18n('STATUS_TITLE'), lines.join(' '));
    return libQ.resolve();
};

// A string of the plugin's own dictionary, with its variables filled; a string that is
// not a key (a validation message already made) passes as it is.
Outcast.prototype.i18n = function (key, vars) {
    let s = this.commandRouter.getI18nString('OUTCAST.' + key);
    if (!s || s === 'OUTCAST.' + key) s = key;
    return h.fill(s, vars);
};

Outcast.prototype.toast = function (type, key, vars) {
    this.commandRouter.pushToastMessage(type, this.i18n('PLUGIN_NAME'), this.i18n(key, vars));
};

module.exports = Outcast;
