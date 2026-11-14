'use strict';

// The Volumio side of the EVO Sabre's second display: the settings page,
// the display's service, and the word to the display that the player is
// going down. The program the service runs (bin/evosabre-panel) draws the
// glass and reads the remote; this file touches neither.
//
// It also switches click prevention: a daemon that holds the audio output
// open (keepalive/audio-keepalive-daemon), and the contribution that puts
// it into the player's ALSA chain.

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var remote = require('./lib/remote');
var form = require('./lib/form');
var keepalive = require('./lib/keepalive');
var tap = require('./lib/tap');
var volume = require('./lib/volume');
var sequence = require('./lib/sequence');

var SERVICE = 'evosabre-panel.service';
var KEEPALIVE_SERVICE = 'evosabre-keepalive.service';
var ASOUND_DIR = path.join(__dirname, 'asound');
var ASOUND_FILE = '/etc/asound.conf';
var REMOTE_STATUS = '/run/evosabre-panel/remote.json';
var USERCONFIG = '/boot/userconfig.txt';
var SPI_DEVICE = '/dev/spidev0.0';
var RC_DEVICES = '/sys/class/rc';
var BOOT_MARK = '# >>> audiophonics_evo_sabre';
var id = 'audiophonics_evo_sabre: ';

module.exports = EvoSabre;

function EvoSabre(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
    this.reloadTimer = null;
    this.chainTimer = null;
    this.pathTimers = [];
    this.pathPending = null;
}

EvoSabre.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

EvoSabre.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

EvoSabre.prototype.onStart = function () {
    var self = this;
    // Strings are loaded here again so a fresh install needs no restart.
    self.commandRouter.loadI18nStrings();
    // The plugin starts whether or not the display does: a display that
    // cannot come up is said on the page, and the settings stay reachable.
    return self.applyService().then(function () {
        self.askRestartIfNeeded();
        return self.applyAudioPath();
    });
};

EvoSabre.prototype.onStop = function () {
    var self = this;
    if (self.reloadTimer) { clearTimeout(self.reloadTimer); self.reloadTimer = null; }
    if (self.chainTimer) { clearTimeout(self.chainTimer); self.chainTimer = null; }
    return self.systemctl('disable --now')
        .fail(function () { /* said in the log */ })
        .then(function () { return self.leaveAudioPath(); });
};

EvoSabre.prototype.onRestart = function () { };
EvoSabre.prototype.onInstall = function () { };
EvoSabre.prototype.onUninstall = function () { };

// The player is going down: the display says so before the system stops it.
EvoSabre.prototype.onVolumioShutdown = function () {
    return this.farewell('SIGUSR1');
};

EvoSabre.prototype.onVolumioReboot = function () {
    return this.farewell('SIGUSR2');
};

EvoSabre.prototype.farewell = function (signal) {
    var defer = libQ.defer();
    this.signal(signal).fin(function () {
        // The display looks for the signal twice a second; give it that.
        setTimeout(function () { defer.resolve(); }, 700);
    });
    return defer.promise;
};

// -----------------------------------------------------------------------------
// The display's service.
// -----------------------------------------------------------------------------

EvoSabre.prototype.systemctl = function (verb, service) {
    var self = this;
    var defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl ' + verb + ' ' + (service || SERVICE), { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
        if (error) {
            self.logger.error(id + 'systemctl ' + verb + ': ' + String(stderr || error).trim());
            defer.reject(new Error(String(stderr || error.message || error).trim()));
        } else {
            defer.resolve();
        }
    });
    return defer.promise;
};

// The service follows the Display switch: on, it is started now and with
// the system; off, it is stopped and stays down.
EvoSabre.prototype.applyService = function () {
    var self = this;
    var on = form.isOn(self.config.get('oled_active'), true);
    return self.systemctl(on ? 'enable --now' : 'disable --now').fail(function (e) {
        if (on) {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('EVOSABRE.PLUGIN_NAME'),
                self.commandRouter.getI18nString('EVOSABRE.SERVICE_FAILED').replace('{{error}}', e && e.message ? e.message : e));
        }
    });
};

// The service's main process, or 0 when it is not running.
EvoSabre.prototype.mainPid = function () {
    var defer = libQ.defer();
    exec('/bin/systemctl show --property MainPID --value ' + SERVICE, function (error, stdout) {
        var pid = error ? 0 : parseInt(String(stdout).trim(), 10);
        defer.resolve(isNaN(pid) ? 0 : pid);
    });
    return defer.promise;
};

// A signal to the display, which runs as this user. Resolves either way:
// a display that is down has nothing to be told.
EvoSabre.prototype.signal = function (signal) {
    var self = this;
    return self.mainPid().then(function (pid) {
        if (pid > 0) {
            try {
                process.kill(pid, signal);
            } catch (e) {
                self.logger.error(id + signal + ' to the display: ' + e.message);
            }
        }
    });
};

// The display reads the settings again. The configuration store writes a
// moment after the set, so the word follows a moment later.
EvoSabre.prototype.reloadDisplay = function () {
    var self = this;
    if (self.reloadTimer) { clearTimeout(self.reloadTimer); }
    self.reloadTimer = setTimeout(function () {
        self.reloadTimer = null;
        self.signal('SIGHUP');
    }, 1500);
};

// The display and the receiver are switched on in the boot configuration,
// which the installer wrote; until the player has restarted on it, one or
// both are not there. Asked once per start, and only when that is the case.
EvoSabre.prototype.askRestartIfNeeded = function () {
    var self = this;
    var written = false;
    try { written = fs.readFileSync(USERCONFIG, 'utf8').indexOf(BOOT_MARK) !== -1; } catch (e) { /* no boot configuration here */ }
    if (!written || (fs.existsSync(SPI_DEVICE) && remote.receiverPresent(RC_DEVICES))) {
        return;
    }
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('EVOSABRE.RESTART_TITLE'),
        message: self.commandRouter.getI18nString('EVOSABRE.RESTART_MSG'),
        size: 'lg',
        buttons: [
            { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
            { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
        ]
    });
};

// -----------------------------------------------------------------------------
// Click prevention: the audio output held open, so the DAC's clocks do not
// stop between tracks.
// -----------------------------------------------------------------------------

// Volumio's ALSA configuration, written again from every plugin's
// contribution. Resolves with whether Volumio wrote a new file, which is
// when it has ALSA restore its stored mixer state; resolves whatever
// becomes of it, and the page says the rest.
EvoSabre.prototype.rebuildAlsa = function () {
    var self = this;
    var defer = libQ.defer();
    var done = false;
    var finish = function (result) {
        if (done) { return; }
        done = true;
        defer.resolve(Boolean(result && result.changed));
    };
    var asked;
    try {
        asked = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'updateALSAConfigFile');
    } catch (e) {
        self.logger.error(id + 'updateALSAConfigFile: ' + e);
        finish();
        return defer.promise;
    }
    if (asked && typeof asked.then === 'function') {
        asked.then(finish).fail(function () { finish(); });
    } else {
        finish();
    }
    return defer.promise;
};

EvoSabre.prototype.volumeNow = function () {
    try {
        return volume.held(this.commandRouter.volumioGetState());
    } catch (e) {
        return null;
    }
};

// Whatever is still due from an earlier change of the audio path is
// dropped: a later change has its own order.
EvoSabre.prototype.cancelPath = function () {
    (this.pathTimers || []).forEach(function (timer) { clearTimeout(timer); });
    this.pathTimers = [];
    if (this.pathPending) {
        // Whoever waited on the earlier change is let go.
        this.pathPending.resolve();
        this.pathPending = null;
    }
};

// The steps lib/sequence.js gives, each at its time. Resolves when the last
// is done, and rejects if the program behind Click prevention did not
// start.
EvoSabre.prototype.carryOut = function (steps) {
    var self = this;
    var defer = libQ.defer();
    var left = steps.length;
    var failure = null;
    if (!left) { return libQ.resolve(); }
    self.pathPending = defer;
    var done = function () {
        left -= 1;
        if (left > 0) { return; }
        if (self.pathPending === defer) { self.pathPending = null; }
        if (failure) { defer.reject(failure); } else { defer.resolve(); }
    };
    steps.forEach(function (s) {
        self.pathTimers.push(setTimeout(function () {
            if (s.step === 'start') {
                self.systemctl('restart', KEEPALIVE_SERVICE)
                    .then(done)
                    .fail(function (e) { failure = e; done(); });
                return;
            }
            try {
                self.commandRouter.volumiosetvolume(s.value);
            } catch (e) {
                self.logger.error(id + 'volume: ' + e);
            }
            done();
        }, s.at));
    });
    return defer.promise;
};

// One contribution's file as it should stand: written with `text`, or gone
// when there is none.
EvoSabre.prototype.contribute = function (name, text) {
    var file = path.join(ASOUND_DIR, name);
    if (text === null) {
        if (fs.existsSync(file)) { fs.unlinkSync(file); }
        return;
    }
    fs.ensureDirSync(ASOUND_DIR);
    fs.writeFileSync(file, text, 'utf8');
};

// What the settings ask of the player's audio path: the keeper behind
// Click prevention, and the tap the meters read. Where the Audio Keepalive
// plugin already holds the output open, no second keeper is put behind it.
EvoSabre.prototype.audioPathWanted = function () {
    var keeper = form.isOn(this.config.get('click_prevention'), false);
    var standalone = keeper && keepalive.standaloneOn();
    return {
        keeper: keeper && !standalone,
        standalone: standalone,
        tap: form.isOn(this.config.get('meters'), false)
    };
};

// The audio path as the settings stand, in an order that keeps writes to
// the DAC board apart from changes of its clocks (lib/sequence.js). The
// program behind Click prevention is stopped first, so that nothing of the
// plugin's holds the output; both contributions are written or removed;
// the configuration is rebuilt once around them, and Volumio restores the
// mixer if it came out different; then, each after a quiet moment, the
// volume the player had is asked for again and the program is started
// where it is wanted.
EvoSabre.prototype.applyAudioPath = function () {
    var self = this;
    var name = self.commandRouter.getI18nString('EVOSABRE.PLUGIN_NAME');
    var want = self.audioPathWanted();
    var was = self.volumeNow();
    var failed = function (e) {
        self.commandRouter.pushToastMessage('error', name,
            self.commandRouter.getI18nString('EVOSABRE.PATH_FAILED').replace('{{error}}', e && e.message ? e.message : e));
    };
    if (want.standalone) {
        self.commandRouter.pushToastMessage('info', name, self.commandRouter.getI18nString('EVOSABRE.CLICK_STANDALONE'));
    }
    self.cancelPath();
    return self.systemctl('stop', KEEPALIVE_SERVICE)
        .fail(function () { /* not running */ })
        .then(function () {
            self.contribute(keepalive.CONTRIBUTION, want.keeper ? keepalive.contribution(__dirname) : null);
            self.contribute(tap.CONTRIBUTION, want.tap ? tap.contribution(__dirname) : null);
            return self.rebuildAlsa();
        })
        .then(function (changed) {
            return self.carryOut(sequence.after(changed, was, want.keeper));
        })
        .then(function () {
            if (want.keeper || want.tap) { self.checkChain(want); }
        })
        .fail(failed);
};

// Out of the audio path altogether, as the plugin stops. The volume is put
// back after the same quiet moment, and is not waited for.
EvoSabre.prototype.leaveAudioPath = function () {
    var self = this;
    var was = self.volumeNow();
    self.cancelPath();
    return self.systemctl('stop', KEEPALIVE_SERVICE)
        .fail(function () { /* not running */ })
        .then(function () {
            var had = fs.existsSync(path.join(ASOUND_DIR, keepalive.CONTRIBUTION)) ||
                fs.existsSync(path.join(ASOUND_DIR, tap.CONTRIBUTION));
            try {
                self.contribute(keepalive.CONTRIBUTION, null);
                self.contribute(tap.CONTRIBUTION, null);
            } catch (e) {
                self.logger.error(id + 'audio path: ' + e.message);
            }
            return had ? self.rebuildAlsa() : libQ.resolve(false);
        })
        .then(function (changed) {
            self.carryOut(sequence.after(changed, was, false));
        });
};

// Volumio asks for contributions only from the plugins it knew when it
// started: one installed since joins the chain after a restart. Looked at a
// moment after the rebuild, and asked for once.
EvoSabre.prototype.checkChain = function (want) {
    var self = this;
    if (self.chainTimer) { clearTimeout(self.chainTimer); }
    self.chainTimer = setTimeout(function () {
        self.chainTimer = null;
        var asound = '';
        try { asound = fs.readFileSync(ASOUND_FILE, 'utf8'); } catch (e) { /* not written yet */ }
        if ((!want.keeper || keepalive.inChain(asound)) && (!want.tap || tap.inChain(asound))) {
            return;
        }
        self.commandRouter.broadcastMessage('openModal', {
            title: self.commandRouter.getI18nString('EVOSABRE.PATH_RESTART_TITLE'),
            message: self.commandRouter.getI18nString('EVOSABRE.PATH_RESTART_MSG'),
            size: 'lg',
            buttons: [
                { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
                { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
            ]
        });
    }, 5000);
};

// -----------------------------------------------------------------------------
// The settings page.
// -----------------------------------------------------------------------------

EvoSabre.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var lang = self.commandRouter.sharedVars.get('language_code');
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then(function (uiconf) {
            form.fill(uiconf, function (key) {
                return self.config.has(key) ? self.config.get(key) : undefined;
            });
            defer.resolve(uiconf);
        })
        .fail(function (e) {
            self.logger.error(id + 'UI config: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

EvoSabre.prototype.setUIConfig = function () { };
EvoSabre.prototype.getConf = function (varName) { return this.config.get(varName); };
EvoSabre.prototype.setConf = function (varName, varValue) { this.config.set(varName, varValue); };

// The values of one section into the store, or a word about the first that
// cannot be taken. Returns whether they were saved.
EvoSabre.prototype.save = function (data, keys) {
    var self = this;
    var name = self.commandRouter.getI18nString('EVOSABRE.PLUGIN_NAME');
    var taken = form.take(data, keys);
    if (taken.bad) {
        self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('EVOSABRE.BAD_NUMBER')
            .replace('{{field}}', self.commandRouter.getI18nString('EVOSABRE.' + taken.bad.key.toUpperCase()))
            .replace('{{min}}', taken.bad.min)
            .replace('{{max}}', taken.bad.max));
        return false;
    }
    Object.keys(taken.values).forEach(function (key) {
        self.config.set(key, taken.values[key]);
    });
    self.commandRouter.pushToastMessage('success', name, self.commandRouter.getI18nString('EVOSABRE.SAVED'));
    return true;
};

EvoSabre.prototype.saveDisplay = function (data) {
    var self = this;
    var was = form.isOn(self.config.get('oled_active'), true);
    var metered = form.isOn(self.config.get('meters'), false);
    if (!self.save(data, ['oled_active', 'contrast', 'track_time', 'meters', 'meters_style', 'meters_gain', 'clock_after', 'clock_segments', 'sleep_after', 'deep_sleep_after'])) {
        return libQ.resolve();
    }
    if (form.isOn(self.config.get('meters'), false) !== metered) {
        // The meters read a tap in the player's audio path: in with them,
        // out without.
        self.applyAudioPath();
    }
    if (form.isOn(self.config.get('oled_active'), true) !== was) {
        // A display just switched on starts before the store has written
        // what was saved with it; it is told to read again once it has.
        return self.applyService().then(function () {
            self.reloadDisplay();
        });
    }
    self.reloadDisplay();
    return libQ.resolve();
};

EvoSabre.prototype.saveRemote = function (data) {
    if (this.save(data, ['remote_active'])) {
        this.reloadDisplay();
    }
    return libQ.resolve();
};

EvoSabre.prototype.saveSound = function (data) {
    if (this.save(data, ['click_prevention'])) {
        return this.applyAudioPath();
    }
    return libQ.resolve();
};

EvoSabre.prototype.saveJournal = function (data) {
    if (this.save(data, ['log_level'])) {
        this.reloadDisplay();
    }
    return libQ.resolve();
};

// What the running display says of its remote: whether the receiver is
// read, and the key that arrived last.
EvoSabre.prototype.checkRemote = function () {
    var self = this;
    var name = self.commandRouter.getI18nString('EVOSABRE.PLUGIN_NAME');
    var strings = {
        receiver: self.commandRouter.getI18nString('EVOSABRE.REMOTE_RECEIVER'),
        last: self.commandRouter.getI18nString('EVOSABRE.REMOTE_LAST'),
        none: self.commandRouter.getI18nString('EVOSABRE.REMOTE_NONE')
    };
    return self.mainPid().then(function (pid) {
        var status = null;
        if (pid > 0) {
            try { status = JSON.parse(fs.readFileSync(REMOTE_STATUS, 'utf8')); } catch (e) { /* not written yet */ }
        }
        if (!status) {
            self.commandRouter.pushToastMessage('warning', name, self.commandRouter.getI18nString('EVOSABRE.REMOTE_NOT_RUNNING'));
            return;
        }
        var report = remote.describe(status, Math.floor(Date.now() / 1000), strings);
        self.commandRouter.pushToastMessage(report.reading ? 'info' : 'warning', name, report.text);
    });
};

// called from commandrouter to find the language file
EvoSabre.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';
    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};
