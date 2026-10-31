'use strict';

// The Volumio side of Just OLED: the settings page, the audio tap's place
// in the ALSA chain, the display service, and the player's state handed to
// the display daemon over its control socket. The daemon
// (bin/<arch>/just-oled) draws; this file never touches the panel.

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var net = require('net');
var exec = require('child_process').exec;
var execFile = require('child_process').execFile;
var execSync = require('child_process').execSync;
var io = require('socket.io-client');
var boot = require('./lib/boot');

var CATEGORY = 'system_hardware';
var NAME = 'just_oled';
// The daemon's socket: under its runtime directory while the service runs, else under /tmp.
var RUN_DIR = '/run/just-oled';
var FALLBACK_SOCKET = '/tmp/just-oled.sock';
var SERVICE = 'just-oled.service';
var RUN_SH = path.join(__dirname, 'scripts', 'run.sh');
var ASOUND_TMPL = path.join(__dirname, 'alsa', 'JustOled.postJustOled.5.conf.tmpl');
var ASOUND_DIR = path.join(__dirname, 'asound');
var ASOUND_CONF = path.join(ASOUND_DIR, 'JustOled.postJustOled.5.conf');
var ASOUND_FILE = '/etc/asound.conf';
var ASOUND_MARK = 'Just OLED section';
var USERCONFIG = '/boot/userconfig.txt';
var id = 'just_oled: ';
// How often the daemon is asked who it is, so one started without the
// plugin (after a crash, an update, a hand restart) gets the player's
// state rather than waiting for the next change.
var HEARTBEAT_MS = 15000;

// How each known key is read from the form. The keys a section saves are
// UIConfig.json's, read when Save is pressed: Volumio keeps a plugin's
// code in memory across an update, so a control added by the update is
// saved by the code of the version before.
var SELECTS = ['connection', 'panel', 'i2c_address', 'i2c_speed', 'rotate', 'face', 'track_text', 'time_display', 'theme', 'idle_screen', 'clock_format', 'date_format'];
var NUMBERS = ['i2c_bus', 'i2c_sda', 'i2c_scl', 'spi_bus', 'spi_cs', 'gpio_dc', 'gpio_reset', 'gpio_bl', 'meter_gain', 'pause_timeout', 'idle_timeout'];
var SWITCHES = ['show_lifecycle', 'show_format', 'peaks', 'meter_wide', 'pause_standby', 'show_ip'];
var UI_CONFIG = path.join(__dirname, 'UIConfig.json');

module.exports = JustOled;

function JustOled(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
    this.volumioSocket = null;
    this.readyTimer = null;
    this.heartbeat = null;
    this.daemonPid = null;
    this.restartAsked = false;
}

JustOled.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

JustOled.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

JustOled.prototype.onStart = function () {
    var self = this;
    // Strings are loaded here again so a fresh install needs no restart.
    self.commandRouter.loadI18nStrings();

    self.writeAsoundContribution()
        .then(self.updateALSAConfigFile.bind(self))
        .fail(function (e) {
            self.logger.error(id + 'audio path: ' + (e && e.message ? e.message : e));
        });

    // Enabled so the display speaks from the next boot; started for this one.
    self.systemctl('enable').fail(function () { /* the installer enabled it already */ });
    self.startService().then(function () {
        self.tellReady(10);
    });
    self.followPlayer();
    self.heartbeat = setInterval(function () { self.checkDaemon(); }, HEARTBEAT_MS);
    // Volumio reads a plugin's ALSA contribution from the list it built at
    // start; a plugin installed since then joins the chain after a restart.
    setTimeout(function () { self.checkAlsaChain(); }, 12000);
    return libQ.resolve();
};

// A plugin disabled by hand takes its service down with it, so a panel
// does not show the boot rows for a plugin that is off.
JustOled.prototype.onStop = function () {
    var self = this;
    if (self.readyTimer) { clearTimeout(self.readyTimer); self.readyTimer = null; }
    if (self.heartbeat) { clearInterval(self.heartbeat); self.heartbeat = null; }
    self.daemonPid = null;
    if (self.volumioSocket) {
        try { self.volumioSocket.off('pushState'); self.volumioSocket.disconnect(); } catch (e) { /* gone already */ }
        self.volumioSocket = null;
    }
    return self.systemctl('stop').then(function () {
        return self.systemctl('disable');
    });
};

JustOled.prototype.onRestart = function () { };
JustOled.prototype.onInstall = function () { };
JustOled.prototype.onUninstall = function () { };

// The player is going down: the display says so before the service is stopped.
JustOled.prototype.onVolumioShutdown = function () {
    return this.farewell('shutdown');
};

JustOled.prototype.onVolumioReboot = function () {
    return this.farewell('reboot');
};

JustOled.prototype.farewell = function (reason) {
    var self = this;
    var defer = libQ.defer();
    self.send({ kind: 'farewell', reason: reason }, function () {
        // A moment for the daemon to draw before the system stops it.
        setTimeout(function () { defer.resolve(); }, 300);
    });
    return defer.promise;
};

// -----------------------------------------------------------------------------
// The audio path: the tap heads the plugin's ALSA contribution.
// -----------------------------------------------------------------------------

JustOled.prototype.writeAsoundContribution = function () {
    var self = this;
    var defer = libQ.defer();
    try {
        fs.ensureDirSync(ASOUND_DIR);
        fs.writeFileSync(ASOUND_CONF, fs.readFileSync(ASOUND_TMPL, 'utf8'), 'utf8');
        self.logger.info(id + 'ALSA contribution written: ' + ASOUND_CONF);
        defer.resolve();
    } catch (e) {
        defer.reject(e);
    }
    return defer.promise;
};

JustOled.prototype.updateALSAConfigFile = function () {
    var self = this;
    var defer = libQ.defer();
    var done = false;
    var finish = function () { if (!done) { done = true; defer.resolve(); } };
    var ret;
    try {
        ret = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'updateALSAConfigFile');
    } catch (e) {
        self.logger.error(id + 'updateALSAConfigFile: ' + e);
        finish();
        return defer.promise;
    }
    if (ret && typeof ret.then === 'function') {
        ret.then(finish).fail(finish);
    } else {
        finish();
    }
    return defer.promise;
};

// Whether the rebuilt ALSA chain carries the tap; if not, ask for a restart, once.
JustOled.prototype.checkAlsaChain = function () {
    var self = this;
    var present = false;
    try { present = fs.readFileSync(ASOUND_FILE, 'utf8').indexOf(ASOUND_MARK) !== -1; } catch (e) { /* no file yet */ }
    if (present || self.restartAsked) {
        return;
    }
    self.restartAsked = true;
    self.logger.warn(id + 'the ALSA chain does not carry the tap yet; a restart is needed');
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('JUSTOLED.RESTART_TITLE'),
        message: self.commandRouter.getI18nString('JUSTOLED.RESTART_MSG'),
        size: 'lg',
        buttons: [
            { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
            { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
        ]
    });
};

// -----------------------------------------------------------------------------
// The display service and its control socket.
// -----------------------------------------------------------------------------

JustOled.prototype.systemctl = function (verb) {
    var self = this;
    var defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl ' + verb + ' ' + SERVICE, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
        if (error) {
            self.logger.error(id + 'systemctl ' + verb + ': ' + (stderr || error));
            defer.reject(error);
        } else {
            defer.resolve();
        }
    });
    return defer.promise;
};

JustOled.prototype.startService = function () {
    var self = this;
    return self.systemctl('start').fail(function (e) {
        self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('JUSTOLED.PLUGIN_NAME'),
            self.commandRouter.getI18nString('JUSTOLED.SERVICE_FAILED').replace('{{error}}', e && e.message ? e.message : e));
    });
};

// One line to the daemon; `done(err)` once, when the line is on its way or
// the socket refused.
JustOled.prototype.send = function (message, done) {
    var self = this;
    var finished = false;
    var finish = function (err) { if (!finished) { finished = true; if (done) done(err); } };
    var client = net.createConnection(socketPath());
    client.setTimeout(2000);
    client.on('connect', function () { client.end(JSON.stringify(message) + '\n'); });
    client.on('error', function (e) { self.logger.info(id + 'daemon not reachable: ' + e.message); finish(e); });
    client.on('timeout', function () { client.destroy(); finish(new Error('timeout')); });
    client.on('close', function () { finish(null); });
};

// One line to the daemon and its one-line answer; `done(err, reply)` once.
JustOled.prototype.ask = function (message, done) {
    var finished = false;
    var finish = function (err, reply) { if (!finished) { finished = true; done(err, reply); } };
    var got = '';
    var client = net.createConnection(socketPath());
    client.setTimeout(2000);
    client.on('connect', function () { client.write(JSON.stringify(message) + '\n'); });
    client.on('data', function (chunk) {
        got += chunk.toString();
        var nl = got.indexOf('\n');
        if (nl !== -1) {
            var reply = null;
            try { reply = JSON.parse(got.slice(0, nl)); } catch (e) { /* not ours */ }
            client.end();
            finish(reply ? null : new Error('no answer'), reply);
        }
    });
    client.on('error', function (e) { finish(e); });
    client.on('timeout', function () { client.destroy(); finish(new Error('timeout')); });
    client.on('close', function () { finish(new Error('closed')); });
};

// Whether `pong` comes from a daemon other than the one last seen as `known`.
function daemonIsNew(pong, known) {
    return !!pong && pong.kind === 'pong' && typeof pong.pid === 'number' && pong.pid !== known;
}

// The heartbeat: a daemon not seen before is given the player's state,
// fetched from Volumio so the position is current; a state replayed from
// memory would set the clock back to where it was when it arrived. The
// first sighting counts too: a daemon up later than the ready retries
// would otherwise wait for the player's next change.
JustOled.prototype.checkDaemon = function () {
    var self = this;
    self.ask({ kind: 'ping' }, function (err, pong) {
        if (err || !daemonIsNew(pong, self.daemonPid)) {
            return;
        }
        self.logger.info(id + 'daemon pid ' + pong.pid + (self.daemonPid === null ? '' : ', started anew') + '; asking for the player state');
        self.daemonPid = pong.pid;
        self.askState();
    });
};

// The daemon shows the ready rows once the plugin has started; a daemon
// still coming up is told again, a few times.
JustOled.prototype.tellReady = function (tries) {
    var self = this;
    self.send({ kind: 'ready' }, function (err) {
        if (err && tries > 0) {
            self.readyTimer = setTimeout(function () { self.tellReady(tries - 1); }, 1000);
        } else if (!err) {
            self.pushState();
        }
    });
};

// The player's state, as Volumio pushes it, to the daemon: the status and
// what is playing, for the now-playing page. A (re)connected link asks
// for the state, so nothing pushed while it was down is missed.
JustOled.prototype.followPlayer = function () {
    var self = this;
    self.volumioSocket = io.connect('http://localhost:3000');
    self.volumioSocket.on('pushState', function (state) {
        if (!state || typeof state !== 'object' || !state.status) {
            return;
        }
        self.lastState = stateForDaemon(state);
        self.send(self.lastState);
    });
    self.volumioSocket.on('connect', function () { self.askState(); });
};

// Volumio's current state, which comes back as a pushState.
JustOled.prototype.askState = function () {
    if (this.volumioSocket) {
        this.volumioSocket.emit('getState', '');
    }
};

JustOled.prototype.pushState = function () {
    var self = this;
    if (self.lastState) {
        self.send(self.lastState);
    } else {
        self.askState();
    }
};

JustOled.prototype.reloadDaemon = function () {
    var self = this;
    // The configuration store writes a moment after the set; the daemon reads the file.
    setTimeout(function () { self.send({ kind: 'reload' }); }, 1500);
};

// -----------------------------------------------------------------------------
// The settings page.
// -----------------------------------------------------------------------------

JustOled.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var lang = self.commandRouter.sharedVars.get('language_code');
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then(function (uiconf) {
            return self.catalog().then(function (entries) {
                uiconf.sections.forEach(function (section) {
                    (section.content || []).forEach(function (element) {
                        if (element.id === 'panel') {
                            element.options = panelOptions(entries);
                        }
                        if (!self.config.has(element.id)) {
                            return;
                        }
                        var value = self.config.get(element.id);
                        if (element.element === 'select') {
                            var chosen = (element.options || []).filter(function (o) { return String(o.value) === String(value); })[0];
                            if (chosen) {
                                element.value = { value: chosen.value, label: chosen.label };
                            }
                        } else if (element.element === 'switch') {
                            element.value = value === true || value === 'true';
                        } else if (element.element === 'input') {
                            element.value = value;
                        }
                    });
                });
                defer.resolve(uiconf);
            });
        })
        .fail(function (e) {
            self.logger.error(id + 'UI config: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

// The catalogue from the daemon itself, so the page lists exactly what the
// shipped binary drives. An unreadable binary gives an empty list and a log line.
JustOled.prototype.catalog = function () {
    var self = this;
    var defer = libQ.defer();
    execFile(RUN_SH, ['--list', '--json'], { timeout: 5000, encoding: 'utf8' }, function (error, stdout, stderr) {
        if (error) {
            self.logger.error(id + 'catalogue: ' + (stderr || error.message));
            defer.resolve([]);
            return;
        }
        try {
            defer.resolve(JSON.parse(stdout));
        } catch (e) {
            self.logger.error(id + 'catalogue did not parse: ' + e.message);
            defer.resolve([]);
        }
    });
    return defer.promise;
};

JustOled.prototype.setUIConfig = function () { };
JustOled.prototype.getConf = function (varName) { return this.config.get(varName); };
JustOled.prototype.setConf = function (varName, varValue) { this.config.set(varName, varValue); };

// A form value into the store, by the kind of control it came from; a
// key not in the lists is read by its shape.
JustOled.prototype.take = function (data, key) {
    var self = this;
    if (!(key in data)) {
        return;
    }
    var raw = data[key];
    if (SELECTS.indexOf(key) !== -1) {
        self.config.set(key, raw && typeof raw === 'object' ? String(raw.value) : String(raw));
    } else if (NUMBERS.indexOf(key) !== -1) {
        var n = Number(raw);
        if (!isNaN(n)) { self.config.set(key, n); }
    } else if (SWITCHES.indexOf(key) !== -1) {
        self.config.set(key, raw === true || raw === 'true');
    } else if (raw && typeof raw === 'object' && 'value' in raw) {
        self.config.set(key, String(raw.value));
    } else if (typeof raw === 'boolean' || typeof raw === 'number') {
        self.config.set(key, raw);
    } else {
        self.config.set(key, String(raw === undefined || raw === null ? '' : raw));
    }
};

// The keys the section saved by `method` declares in UIConfig.json.
function sectionKeys(method) {
    var ui = JSON.parse(fs.readFileSync(UI_CONFIG, 'utf8'));
    var section = (ui.sections || []).filter(function (s) {
        return s.onSave && s.onSave.method === method;
    })[0];
    return section && section.saveButton && Array.isArray(section.saveButton.data) ? section.saveButton.data : [];
}

JustOled.prototype.saveSection = function (data, method, after) {
    var self = this;
    var keys;
    try {
        keys = sectionKeys(method);
    } catch (e) {
        self.logger.error(id + method + ': ' + UI_CONFIG + ' unreadable: ' + (e && e.message ? e.message : e));
        keys = [];
    }
    keys.forEach(function (key) { self.take(data, key); });
    var name = self.commandRouter.getI18nString('JUSTOLED.PLUGIN_NAME');
    var note = after ? after() : null;
    self.commandRouter.pushToastMessage('success', name, note || self.commandRouter.getI18nString('JUSTOLED.SAVED'));
    self.reloadDaemon();
    return libQ.resolve();
};

// The wiring: a preset writes its pins over the stored ones, so the daemon
// and the drawings read one set of keys whichever way they were chosen.
JustOled.prototype.saveConnection = function (data) {
    var self = this;
    return self.saveSection(data, 'saveConnection', function () {
        var connection = self.config.get('connection');
        var fixed = boot.preset(connection);
        Object.keys(fixed).forEach(function (key) {
            if (key !== 'bus') { self.config.set(key, fixed[key]); }
        });
        var result = self.applyBootConfig(connection, self.config.get('i2c_bus'), self.config.get('i2c_sda'), self.config.get('i2c_scl'), self.config.get('i2c_speed'));
        if (result.error) {
            return self.commandRouter.getI18nString('JUSTOLED.SAVE_FAILED').replace('{{error}}', result.error);
        }
        if (result.changed) {
            self.askRestart();
            return self.commandRouter.getI18nString('JUSTOLED.SAVED_RESTART');
        }
        return null;
    });
};

JustOled.prototype.saveFace = function (data) {
    return this.saveSection(data, 'saveFace');
};

JustOled.prototype.saveStandby = function (data) {
    return this.saveSection(data, 'saveStandby');
};

JustOled.prototype.saveMessages = function (data) {
    return this.saveSection(data, 'saveMessages');
};

// The lines for a custom I2C bus or a faster clock into /boot/userconfig.txt,
// through sudo tee, which the installer allowed. Returns { changed, error }.
JustOled.prototype.applyBootConfig = function (connection, bus, sda, scl, speed) {
    var self = this;
    var current = '';
    try {
        current = fs.readFileSync(USERCONFIG, 'utf8');
    } catch (e) {
        if (e.code !== 'ENOENT') {
            return { changed: false, error: e.message };
        }
        // No boot configuration on this machine (a PC): nothing to write, nothing needed.
        if (!fs.existsSync('/boot/config.txt')) {
            return { changed: false, error: null };
        }
    }
    var next = boot.rewrite(current, boot.linesFor(connection, bus, sda, scl, speed));
    if (!next.changed) {
        return { changed: false, error: null };
    }
    try {
        execSync('/usr/bin/sudo /usr/bin/tee ' + USERCONFIG + ' > /dev/null', { input: next.content, uid: 1000, gid: 1000, encoding: 'utf8' });
        self.logger.info(id + USERCONFIG + ' updated for ' + connection + ' bus ' + bus);
        return { changed: true, error: null };
    } catch (e) {
        self.logger.error(id + USERCONFIG + ': ' + e.message);
        return { changed: false, error: e.message };
    }
};

JustOled.prototype.askRestart = function () {
    var self = this;
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('JUSTOLED.RESTART_TITLE'),
        message: self.commandRouter.getI18nString('JUSTOLED.SAVED_RESTART'),
        size: 'lg',
        buttons: [
            { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
            { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
        ]
    });
};

// The bus read with i2cdetect; the addresses OLED controllers use are named.
JustOled.prototype.detectDisplay = function () {
    var self = this;
    var defer = libQ.defer();
    var bus = parseInt(self.config.get('i2c_bus'), 10);
    if (isNaN(bus)) { bus = 1; }
    var name = self.commandRouter.getI18nString('JUSTOLED.PLUGIN_NAME');
    exec('/usr/bin/sudo /usr/sbin/i2cdetect -y ' + bus, { uid: 1000, gid: 1000, timeout: 10000 }, function (error, stdout, stderr) {
        if (error) {
            self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('JUSTOLED.DETECT_FAILED').replace('{{error}}', (stderr || error.message || '').trim()));
            defer.resolve();
            return;
        }
        var found = parseI2cdetect(stdout);
        if (!found.length) {
            self.commandRouter.pushToastMessage('warning', name, self.commandRouter.getI18nString('JUSTOLED.DETECTED_NOTHING').replace('{{bus}}', bus));
        } else {
            var list = found.map(function (addr) { return '0x' + addr.toString(16).toUpperCase() + describeAddress(addr); }).join(', ');
            self.commandRouter.pushToastMessage('success', name, self.commandRouter.getI18nString('JUSTOLED.DETECTED').replace('{{list}}', list));
        }
        defer.resolve();
    });
    return defer.promise;
};

JustOled.prototype.testDisplay = function () {
    var self = this;
    var defer = libQ.defer();
    var name = self.commandRouter.getI18nString('JUSTOLED.PLUGIN_NAME');
    self.send({ kind: 'test', hold_ms: 4000 }, function (err) {
        if (err) {
            self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('JUSTOLED.TEST_FAILED').replace('{{error}}', err.message));
        } else {
            self.commandRouter.pushToastMessage('success', name, self.commandRouter.getI18nString('JUSTOLED.TEST_SENT'));
        }
        defer.resolve();
    });
    return defer.promise;
};

function socketPath() {
    return fs.existsSync(RUN_DIR) ? path.join(RUN_DIR, 'just-oled.sock') : FALLBACK_SOCKET;
}

// What the daemon needs of a pushState: the status, the track, the volume.
function stateForDaemon(state) {
    var text = function (v) { return v === undefined || v === null ? '' : String(v); };
    return {
        kind: 'state',
        status: text(state.status),
        title: text(state.title),
        artist: text(state.artist),
        album: text(state.album),
        service: text(state.service),
        trackType: text(state.trackType),
        samplerate: text(state.samplerate),
        bitdepth: text(state.bitdepth),
        bitrate: text(state.bitrate),
        volume: typeof state.volume === 'number' ? state.volume : parseInt(state.volume, 10) || 0,
        mute: state.mute === true,
        seek: typeof state.seek === 'number' ? state.seek : 0,
        duration: typeof state.duration === 'number' ? state.duration : 0
    };
}

// The select's options from the daemon's catalogue: the id as the value,
// the chip and size as the label. An entry the binary cannot drive yet is
// left out rather than offered as a dead end.
function panelOptions(entries) {
    return (Array.isArray(entries) ? entries : [])
        .filter(function (e) { return e && typeof e.id === 'string' && e.driven !== false; })
        .map(function (e) {
            return { value: e.id, label: e.controller + ' ' + e.width + 'x' + e.height + (e.verified === 'verified' ? '' : ' (described)') };
        });
}

// The addresses in i2cdetect's table.
function parseI2cdetect(text) {
    var found = [];
    String(text || '').split('\n').forEach(function (line) {
        var m = /^([0-9a-f]0):((?:\s+(?:[0-9a-f]{2}|--|UU))+)\s*$/i.exec(line);
        if (!m) { return; }
        var base = parseInt(m[1], 16);
        var cells = m[2].trim().split(/\s+/);
        // The first row starts at 0x08 and the last ends at 0x77; the gaps are blank.
        var offset = base === 0 ? 3 : 0;
        cells.forEach(function (cell, i) {
            if (/^[0-9a-f]{2}$/i.test(cell)) {
                found.push(base + offset + i);
            }
        });
    });
    return found;
}

function describeAddress(addr) {
    switch (addr) {
        case 0x3C: case 0x3D: return ' (OLED controller)';
        case 0x3E: return ' (character LCD, not an OLED)';
        case 0x27: case 0x3F: return ' (PCF8574 backpack, not an OLED)';
        default: return '';
    }
}

// called from commandrouter to find the language file
JustOled.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';
    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};

JustOled.parseI2cdetect = parseI2cdetect;
JustOled.panelOptions = panelOptions;
JustOled.stateForDaemon = stateForDaemon;
JustOled.sectionKeys = sectionKeys;
JustOled.daemonIsNew = daemonIsNew;
