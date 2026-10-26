'use strict';

// The Volumio side of the LCD1602 VU meter: the settings page, the audio
// tap's place in the ALSA chain, the display service, and the player's
// state handed to the display daemon over its control socket. The daemon
// (bin/<arch>/lcd1602-vumeter) draws; this file never touches the glass.

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var net = require('net');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var io = require('socket.io-client');
var boot = require('./lib/boot');

var CATEGORY = 'system_hardware';
var NAME = 'lcd1602_vumeter';
// The daemon's socket: under its runtime directory while the service runs, else under /tmp.
var RUN_DIR = '/run/lcd1602-vumeter';
var FALLBACK_SOCKET = '/tmp/lcd1602-vumeter.sock';
var SERVICE = 'lcd1602-vumeter.service';
var ASOUND_TMPL = path.join(__dirname, 'alsa', 'Lcd1602.postLcd1602.5.conf.tmpl');
var ASOUND_DIR = path.join(__dirname, 'asound');
var ASOUND_CONF = path.join(ASOUND_DIR, 'Lcd1602.postLcd1602.5.conf');
var ASOUND_FILE = '/etc/asound.conf';
var ASOUND_MARK = 'LCD1602 VU meter section';
var USERCONFIG = '/boot/userconfig.txt';
var id = 'lcd1602_vumeter: ';

// The keys each settings section saves, and how each is read from the form.
var SELECTS = ['i2c_mode', 'panel_type', 'panel_address', 'pcf_pinmap', 'rgb_address', 'meter_source', 'bar_style', 'idle_layout', 'idle_row1', 'idle_row2', 'clock_format', 'date_format', 'rgb_mode'];
var NUMBERS = ['sda_pin', 'scl_pin', 'contrast', 'gain_db', 'range_db', 'peak_hold_ms', 'fps', 'pause_timeout', 'backlight_idle_off_s', 'rgb_brightness', 'i2c_bus'];
var SWITCHES = ['peak_hold', 'labels', 'show_lifecycle', 'pause_standby'];
var COLORS = ['rgb_play', 'rgb_pause', 'rgb_idle'];

module.exports = Lcd1602;

function Lcd1602(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
    this.volumioSocket = null;
    this.readyTimer = null;
    this.restartAsked = false;
}

Lcd1602.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

Lcd1602.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

Lcd1602.prototype.onStart = function () {
    var self = this;
    // Strings are loaded here again so a fresh install needs no restart.
    self.commandRouter.loadI18nStrings();

    self.writeAsoundContribution()
        .then(self.updateALSAConfigFile.bind(self))
        .fail(function (e) {
            self.logger.error(id + 'audio path: ' + (e && e.message ? e.message : e));
        });

    self.startService().then(function () {
        self.tellReady(10);
    });
    self.followPlayer();
    // Volumio reads a plugin's ALSA contribution from the list it built at
    // start; a plugin installed since then joins the chain after a restart.
    setTimeout(function () { self.checkAlsaChain(); }, 12000);
    return libQ.resolve();
};

Lcd1602.prototype.onStop = function () {
    var self = this;
    if (self.readyTimer) { clearTimeout(self.readyTimer); self.readyTimer = null; }
    if (self.volumioSocket) {
        try { self.volumioSocket.off('pushState'); self.volumioSocket.disconnect(); } catch (e) { /* gone already */ }
        self.volumioSocket = null;
    }
    return self.systemctl('stop');
};

Lcd1602.prototype.onRestart = function () { };
Lcd1602.prototype.onInstall = function () { };
Lcd1602.prototype.onUninstall = function () { };

// The player is going down: the display says so before the service is stopped.
Lcd1602.prototype.onVolumioShutdown = function () {
    return this.farewell('shutdown');
};

Lcd1602.prototype.onVolumioReboot = function () {
    return this.farewell('reboot');
};

Lcd1602.prototype.farewell = function (reason) {
    var self = this;
    var defer = libQ.defer();
    self.send({ kind: 'farewell', reason: reason }, function () {
        // A moment for the daemon to write the rows before the system stops it.
        setTimeout(function () { defer.resolve(); }, 300);
    });
    return defer.promise;
};

// -----------------------------------------------------------------------------
// The audio path: the tap heads the plugin's ALSA contribution.
// -----------------------------------------------------------------------------

Lcd1602.prototype.writeAsoundContribution = function () {
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

Lcd1602.prototype.updateALSAConfigFile = function () {
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
Lcd1602.prototype.checkAlsaChain = function () {
    var self = this;
    var present = false;
    try { present = fs.readFileSync(ASOUND_FILE, 'utf8').indexOf(ASOUND_MARK) !== -1; } catch (e) { /* no file yet */ }
    if (present || self.restartAsked) {
        return;
    }
    self.restartAsked = true;
    self.logger.warn(id + 'the ALSA chain does not carry the tap yet; a restart is needed');
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('LCD1602.RESTART_TITLE'),
        message: self.commandRouter.getI18nString('LCD1602.RESTART_MSG'),
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

Lcd1602.prototype.systemctl = function (verb) {
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

Lcd1602.prototype.startService = function () {
    var self = this;
    return self.systemctl('start').fail(function (e) {
        self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('LCD1602.PLUGIN_NAME'),
            self.commandRouter.getI18nString('LCD1602.SERVICE_FAILED').replace('{{error}}', e && e.message ? e.message : e));
    });
};

// One line to the daemon; `done(err)` once, when the line is on its way or
// the socket refused.
Lcd1602.prototype.send = function (message, done) {
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

// The daemon shows the ready rows once the plugin has started; a daemon
// still coming up is told again, a few times.
Lcd1602.prototype.tellReady = function (tries) {
    var self = this;
    self.send({ kind: 'ready' }, function (err) {
        if (err && tries > 0) {
            self.readyTimer = setTimeout(function () { self.tellReady(tries - 1); }, 1000);
        } else if (!err) {
            self.pushState();
        }
    });
};

// The player's state, as Volumio pushes it, to the daemon.
Lcd1602.prototype.followPlayer = function () {
    var self = this;
    self.volumioSocket = io.connect('http://localhost:3000');
    self.volumioSocket.on('pushState', function (state) {
        if (!state || typeof state !== 'object' || !state.status) {
            return;
        }
        self.lastStatus = state.status;
        self.send({ kind: 'state', status: state.status });
    });
    self.volumioSocket.emit('getState', '');
};

Lcd1602.prototype.pushState = function () {
    var self = this;
    if (self.lastStatus) {
        self.send({ kind: 'state', status: self.lastStatus });
    } else if (self.volumioSocket) {
        self.volumioSocket.emit('getState', '');
    }
};

Lcd1602.prototype.reloadDaemon = function () {
    var self = this;
    // The configuration store writes a moment after the set; the daemon reads the file.
    setTimeout(function () { self.send({ kind: 'reload' }); }, 1500);
};

// -----------------------------------------------------------------------------
// The settings page.
// -----------------------------------------------------------------------------

Lcd1602.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var lang = self.commandRouter.sharedVars.get('language_code');
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then(function (uiconf) {
            uiconf.sections.forEach(function (section) {
                (section.content || []).forEach(function (element) {
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
        })
        .fail(function (e) {
            self.logger.error(id + 'UI config: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

Lcd1602.prototype.setUIConfig = function () { };
Lcd1602.prototype.getConf = function (varName) { return this.config.get(varName); };
Lcd1602.prototype.setConf = function (varName, varValue) { this.config.set(varName, varValue); };

// A form value into the store, by the kind of control it came from.
Lcd1602.prototype.take = function (data, key) {
    var self = this;
    if (!(key in data)) {
        return true;
    }
    var raw = data[key];
    if (SELECTS.indexOf(key) !== -1) {
        self.config.set(key, raw && typeof raw === 'object' ? String(raw.value) : String(raw));
    } else if (NUMBERS.indexOf(key) !== -1) {
        var n = Number(raw);
        if (!isNaN(n)) { self.config.set(key, n); }
    } else if (SWITCHES.indexOf(key) !== -1) {
        self.config.set(key, raw === true || raw === 'true');
    } else if (COLORS.indexOf(key) !== -1) {
        var hex = String(raw || '').trim().replace(/^#/, '').toUpperCase();
        if (!/^[0-9A-F]{6}$/.test(hex)) {
            return false;
        }
        self.config.set(key, hex);
    } else {
        self.config.set(key, String(raw === undefined || raw === null ? '' : raw));
    }
    return true;
};

Lcd1602.prototype.saveSection = function (data, keys, after) {
    var self = this;
    var bad = [];
    keys.forEach(function (key) {
        if (!self.take(data, key)) { bad.push(key); }
    });
    var name = self.commandRouter.getI18nString('LCD1602.PLUGIN_NAME');
    if (bad.length) {
        self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('LCD1602.BAD_COLOR').replace('{{field}}', bad.join(', ')));
        return libQ.resolve();
    }
    var note = after ? after() : null;
    self.commandRouter.pushToastMessage('success', name, note || self.commandRouter.getI18nString('LCD1602.SAVED'));
    self.reloadDaemon();
    return libQ.resolve();
};

Lcd1602.prototype.saveBus = function (data) {
    var self = this;
    return self.saveSection(data, ['i2c_mode', 'sda_pin', 'scl_pin', 'panel_type', 'panel_address', 'pcf_pinmap', 'contrast', 'rgb_address'], function () {
        var mode = self.config.get('i2c_mode');
        self.config.set('i2c_bus', boot.busFor(mode));
        var result = self.applyBootConfig(mode, self.config.get('sda_pin'), self.config.get('scl_pin'));
        if (result.error) {
            return self.commandRouter.getI18nString('LCD1602.SAVE_FAILED').replace('{{error}}', result.error);
        }
        if (result.changed) {
            self.askRestart();
            return self.commandRouter.getI18nString('LCD1602.SAVED_RESTART');
        }
        return null;
    });
};

Lcd1602.prototype.saveMeter = function (data) {
    return this.saveSection(data, ['gain_db', 'meter_source', 'range_db', 'bar_style', 'peak_hold', 'peak_hold_ms', 'labels', 'fps']);
};

Lcd1602.prototype.saveIdle = function (data) {
    return this.saveSection(data, ['pause_standby', 'pause_timeout', 'idle_layout', 'idle_row1', 'idle_row2', 'idle_text', 'clock_format', 'date_format', 'backlight_idle_off_s']);
};

Lcd1602.prototype.saveMessages = function (data) {
    return this.saveSection(data, ['show_lifecycle', 'text_boot', 'text_ready', 'text_pause', 'text_shutdown', 'text_reboot']);
};

Lcd1602.prototype.saveRgb = function (data) {
    return this.saveSection(data, ['rgb_mode', 'rgb_play', 'rgb_pause', 'rgb_idle', 'rgb_brightness']);
};

// The lines for the chosen bus into /boot/userconfig.txt, through sudo tee,
// which the installer allowed. Returns { changed, error }.
Lcd1602.prototype.applyBootConfig = function (mode, sda, scl) {
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
    var next = boot.rewrite(current, boot.linesFor(mode, sda, scl));
    if (!next.changed) {
        return { changed: false, error: null };
    }
    try {
        execSync('/usr/bin/sudo /usr/bin/tee ' + USERCONFIG + ' > /dev/null', { input: next.content, uid: 1000, gid: 1000, encoding: 'utf8' });
        self.logger.info(id + USERCONFIG + ' updated for I2C mode ' + mode);
        return { changed: true, error: null };
    } catch (e) {
        self.logger.error(id + USERCONFIG + ': ' + e.message);
        return { changed: false, error: e.message };
    }
};

Lcd1602.prototype.askRestart = function () {
    var self = this;
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('LCD1602.RESTART_TITLE'),
        message: self.commandRouter.getI18nString('LCD1602.SAVED_RESTART'),
        size: 'lg',
        buttons: [
            { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
            { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
        ]
    });
};

// The bus scanned with i2cdetect, the addresses named where they are known.
Lcd1602.prototype.detectDisplay = function () {
    var self = this;
    var defer = libQ.defer();
    var bus = parseInt(self.config.get('i2c_bus'), 10);
    if (isNaN(bus)) { bus = 1; }
    var name = self.commandRouter.getI18nString('LCD1602.PLUGIN_NAME');
    exec('/usr/bin/sudo /usr/sbin/i2cdetect -y ' + bus, { uid: 1000, gid: 1000, timeout: 10000 }, function (error, stdout, stderr) {
        if (error) {
            self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('LCD1602.DETECT_FAILED').replace('{{error}}', (stderr || error.message || '').trim()));
            defer.resolve();
            return;
        }
        var found = parseI2cdetect(stdout);
        if (!found.length) {
            self.commandRouter.pushToastMessage('warning', name, self.commandRouter.getI18nString('LCD1602.DETECTED_NOTHING').replace('{{bus}}', bus));
        } else {
            var list = found.map(function (addr) { return '0x' + addr.toString(16).toUpperCase() + describeAddress(addr); }).join(', ');
            self.commandRouter.pushToastMessage('success', name, self.commandRouter.getI18nString('LCD1602.DETECTED').replace('{{list}}', list));
        }
        defer.resolve();
    });
    return defer.promise;
};

Lcd1602.prototype.testDisplay = function () {
    var self = this;
    var defer = libQ.defer();
    var name = self.commandRouter.getI18nString('LCD1602.PLUGIN_NAME');
    self.send({ kind: 'message', lines: ['LCD1602 VU meter', 'test  0123456789'], hold_ms: 4000 }, function (err) {
        if (err) {
            self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('LCD1602.TEST_FAILED').replace('{{error}}', err.message));
        } else {
            self.commandRouter.pushToastMessage('success', name, self.commandRouter.getI18nString('LCD1602.TEST_SENT'));
        }
        defer.resolve();
    });
    return defer.promise;
};

function socketPath() {
    return fs.existsSync(RUN_DIR) ? path.join(RUN_DIR, 'control.sock') : FALLBACK_SOCKET;
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
        case 0x3E: return ' (AiP31068/ST7032 LCD)';
        case 0x3C: case 0x3D: return ' (US2066 OLED)';
        case 0x27: return ' (PCF8574 backpack)';
        case 0x3F: return ' (PCF8574A backpack)';
        case 0x60: case 0x62: return ' (PCA9633 RGB)';
        case 0x2D: return ' (SGM31323 RGB)';
        case 0x6B: case 0x30: return ' (RGB driver)';
        default: return '';
    }
}

// called from commandrouter to find the language file
Lcd1602.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';
    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};

Lcd1602.parseI2cdetect = parseI2cdetect;
