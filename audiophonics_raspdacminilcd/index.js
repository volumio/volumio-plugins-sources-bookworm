'use strict';

// The Volumio side of the RaspDac Mini's display: the settings page, the
// display's service, the word to the display that the player is going
// down, the tap in the player's audio path that the level meters read, and
// the one thing the display has to ask the player for through its plugin,
// a shutdown. The program the service runs (bin/raspdacmini-panel) draws
// the glass, reads the remote and sets the DAC; this file touches none of
// them.

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var remote = require('./lib/remote');
var form = require('./lib/form');
var tap = require('./lib/tap');
var volume = require('./lib/volume');

var SERVICE = 'raspdacmini-panel.service';
var REMOTE_STATUS = '/run/raspdacmini-panel/remote.json';
var USERCONFIG = '/boot/userconfig.txt';
var SPI_DEVICE = '/dev/spidev0.0';
var GRAPHICS = '/sys/class/graphics';
var PANEL_FB = 'fb_ili9341';
var RC_DEVICES = '/sys/class/rc';
var BOOT_HELPER = '/usr/local/bin/raspdacmini-boot';
var BOOT_MARK = '# >>> raspdac_mini_lcd';
// Where Volumio looks for what a plugin adds to the player's ALSA
// configuration, and the configuration it writes from all of them.
var ASOUND_DIR = path.join(__dirname, 'asound');
var ASOUND_FILE = '/etc/asound.conf';
// The quiet left after Volumio's restore of the mixer before the volume is
// asked for again, and before a mute follows the volume.
var VOLUME_AFTER = 1500;
var MUTE_AFTER = 1000;
// How long after a rebuild the configuration is looked at for the tap.
var CHAIN_AFTER = 5000;
// The name the display's program calls this plugin by at the player.
var ENDPOINT = { endpoint: 'raspdac_mini_lcd', type: 'system_hardware', name: 'raspdac_mini_lcd', method: 'panelAsks' };
var id = 'raspdac_mini_lcd: ';

module.exports = RaspDacMini;

function RaspDacMini(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
    this.reloadTimer = null;
    this.chainTimer = null;
    this.pathTimers = [];
}

RaspDacMini.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

RaspDacMini.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

RaspDacMini.prototype.onStart = function () {
    var self = this;
    // Strings are loaded here again so a fresh install needs no restart.
    self.commandRouter.loadI18nStrings();
    self.commandRouter.addPluginRestEndpoint(ENDPOINT);
    // The plugin starts whether or not the display does: a display that
    // cannot come up is said on the page, and the settings stay reachable.
    return self.applyService().then(function () {
        self.askRestartIfNeeded();
        return self.applyAudioPath();
    });
};

RaspDacMini.prototype.onStop = function () {
    var self = this;
    if (self.reloadTimer) { clearTimeout(self.reloadTimer); self.reloadTimer = null; }
    self.commandRouter.removePluginRestEndpoint(ENDPOINT);
    return self.systemctl('disable --now')
        .fail(function () { /* said in the log */ })
        .then(function () { return self.leaveAudioPath(); });
};

RaspDacMini.prototype.onRestart = function () { };
RaspDacMini.prototype.onInstall = function () { };
RaspDacMini.prototype.onUninstall = function () { };

// The player is going down: the display says so before the system stops it.
RaspDacMini.prototype.onVolumioShutdown = function () {
    return this.farewell('SIGUSR1');
};

RaspDacMini.prototype.onVolumioReboot = function () {
    return this.farewell('SIGUSR2');
};

RaspDacMini.prototype.farewell = function (signal) {
    var defer = libQ.defer();
    this.signal(signal).fin(function () {
        // The display looks for the signal twice a second; give it that.
        setTimeout(function () { defer.resolve(); }, 700);
    });
    return defer.promise;
};

// What the display's program asks of the player through this plugin. The
// remote's Power key is a shutdown, and only the player can shut the player
// down properly: it tells every plugin first, this one included.
RaspDacMini.prototype.panelAsks = function (word) {
    if (word === 'shutdown') {
        this.logger.info(id + 'the remote asked for a shutdown');
        this.commandRouter.shutdown();
        return libQ.resolve({ asked: 'shutdown' });
    }
    this.logger.error(id + 'asked for something it does not do: ' + String(word).slice(0, 40));
    return libQ.reject(new Error('not something this plugin does'));
};

// -----------------------------------------------------------------------------
// The display's service.
// -----------------------------------------------------------------------------

RaspDacMini.prototype.systemctl = function (verb) {
    var self = this;
    var defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl ' + verb + ' ' + SERVICE, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
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
RaspDacMini.prototype.applyService = function () {
    var self = this;
    var on = form.isOn(self.config.get('lcd_active'), true);
    return self.systemctl(on ? 'enable --now' : 'disable --now').fail(function (e) {
        if (on) {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('RASPDACMINI.PLUGIN_NAME'),
                self.commandRouter.getI18nString('RASPDACMINI.SERVICE_FAILED').replace('{{error}}', e && e.message ? e.message : e));
        }
    });
};

// The service's main process, or 0 when it is not running.
RaspDacMini.prototype.mainPid = function () {
    var defer = libQ.defer();
    exec('/bin/systemctl show --property MainPID --value ' + SERVICE, function (error, stdout) {
        var pid = error ? 0 : parseInt(String(stdout).trim(), 10);
        defer.resolve(isNaN(pid) ? 0 : pid);
    });
    return defer.promise;
};

// A signal to the display, which runs as this user. Resolves either way:
// a display that is down has nothing to be told.
RaspDacMini.prototype.signal = function (signal) {
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
RaspDacMini.prototype.reloadDisplay = function () {
    var self = this;
    if (self.reloadTimer) { clearTimeout(self.reloadTimer); }
    self.reloadTimer = setTimeout(function () {
        self.reloadTimer = null;
        self.signal('SIGHUP');
    }, 1500);
};

// Whether the panel is there the way the settings have it driven: as the
// kernel's framebuffer for it, or as the SPI device.
RaspDacMini.prototype.panelPresent = function () {
    if (form.driver(this.config.get('display_driver')) === 'spi') {
        return fs.existsSync(SPI_DEVICE);
    }
    var names;
    try { names = fs.readdirSync(GRAPHICS); } catch (e) { return false; }
    return names.some(function (name) {
        try {
            return fs.readFileSync(path.join(GRAPHICS, name, 'name'), 'utf8').trim() === PANEL_FB;
        } catch (e) {
            return false;
        }
    });
};

// The plugin's lines in the boot configuration, as the Display driver
// setting has them. Resolves with whether the file changed, which is when
// the player has to restart; resolves false, with a word on the page, when
// it could not be written.
RaspDacMini.prototype.applyBoot = function () {
    var self = this;
    var defer = libQ.defer();
    var driver = form.driver(self.config.get('display_driver'));
    exec('/usr/bin/sudo ' + BOOT_HELPER + ' ' + driver, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
        if (error) {
            var why = String(stderr || error.message || error).trim();
            self.logger.error(id + 'boot configuration: ' + why);
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('RASPDACMINI.PLUGIN_NAME'),
                self.commandRouter.getI18nString('RASPDACMINI.BOOT_FAILED').replace('{{error}}', why));
            defer.resolve(false);
        } else {
            defer.resolve(String(stdout).trim() === 'changed');
        }
    });
    return defer.promise;
};

RaspDacMini.prototype.askRestart = function (message) {
    var self = this;
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('RASPDACMINI.RESTART_TITLE'),
        message: self.commandRouter.getI18nString(message),
        size: 'lg',
        buttons: [
            { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
            { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
        ]
    });
};

// The display and the receiver are switched on in the boot configuration,
// which the installer wrote; until the player has restarted on it, one or
// both are not there. Asked once per start, and only when that is the case.
RaspDacMini.prototype.askRestartIfNeeded = function () {
    var self = this;
    var written = false;
    try { written = fs.readFileSync(USERCONFIG, 'utf8').indexOf(BOOT_MARK) !== -1; } catch (e) { /* no boot configuration here */ }
    if (!written || (self.panelPresent() && remote.receiverPresent(RC_DEVICES))) {
        return;
    }
    self.commandRouter.broadcastMessage('openModal', {
        title: self.commandRouter.getI18nString('RASPDACMINI.RESTART_TITLE'),
        message: self.commandRouter.getI18nString('RASPDACMINI.RESTART_MSG'),
        size: 'lg',
        buttons: [
            { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
            { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
        ]
    });
};

// -----------------------------------------------------------------------------
// The level meters: a tap in the player's audio path.
// -----------------------------------------------------------------------------

// Volumio's ALSA configuration, written again from every plugin's
// contribution. Resolves with whether Volumio wrote a new file, which is
// when it has ALSA restore its stored mixer state; resolves whatever
// becomes of it, and the page says the rest.
RaspDacMini.prototype.rebuildAlsa = function () {
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

// The volume and the mute the player has now, or nothing where it has no
// volume of its own.
RaspDacMini.prototype.volumeNow = function () {
    try {
        return volume.held(this.commandRouter.volumioGetState());
    } catch (e) {
        return null;
    }
};

// Whatever is still due from an earlier change of the audio path is
// dropped: a later change has its own.
RaspDacMini.prototype.cancelPath = function () {
    (this.pathTimers || []).forEach(function (timer) { clearTimeout(timer); });
    this.pathTimers = [];
    if (this.chainTimer) { clearTimeout(this.chainTimer); this.chainTimer = null; }
};

// The volume the player had, asked for again after a rebuild that changed
// the configuration: Volumio has ALSA restore the mixer then, and what it
// restores is rarely what the player had. The mute follows the volume.
RaspDacMini.prototype.putVolumeBack = function (changed, was) {
    var self = this;
    if (!changed) { return; }
    volume.steps(was).forEach(function (value, i) {
        self.pathTimers.push(setTimeout(function () {
            try {
                self.commandRouter.volumiosetvolume(value);
            } catch (e) {
                self.logger.error(id + 'volume: ' + e);
            }
        }, VOLUME_AFTER + i * MUTE_AFTER));
    });
};

// The tap's contribution as it should stand: written, or gone. Returns
// whether that changed what is there.
RaspDacMini.prototype.contribute = function (wanted) {
    var file = path.join(ASOUND_DIR, tap.CONTRIBUTION);
    var there = fs.existsSync(file);
    if (!wanted) {
        if (there) { fs.unlinkSync(file); }
        return there;
    }
    var text = tap.contribution(__dirname);
    if (there && fs.readFileSync(file, 'utf8') === text) { return false; }
    fs.ensureDirSync(ASOUND_DIR);
    fs.writeFileSync(file, text, 'utf8');
    return true;
};

// The audio path as the settings stand: the tap in it while the meters are
// on, and out of it while they are off. The player's configuration is
// rebuilt only when that changes something.
RaspDacMini.prototype.applyAudioPath = function () {
    var self = this;
    var wanted = form.isOn(self.config.get('meters'), false);
    var was = self.volumeNow();
    self.cancelPath();
    var changed;
    try {
        changed = self.contribute(wanted);
    } catch (e) {
        self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('RASPDACMINI.PLUGIN_NAME'),
            self.commandRouter.getI18nString('RASPDACMINI.PATH_FAILED').replace('{{error}}', e.message));
        return libQ.resolve();
    }
    if (!changed) {
        if (wanted) { self.checkChain(); }
        return libQ.resolve();
    }
    return self.rebuildAlsa().then(function (rewritten) {
        self.putVolumeBack(rewritten, was);
        if (wanted) { self.checkChain(); }
    });
};

// Out of the audio path, as the plugin stops.
RaspDacMini.prototype.leaveAudioPath = function () {
    var self = this;
    var was = self.volumeNow();
    self.cancelPath();
    var had = false;
    try {
        had = self.contribute(false);
    } catch (e) {
        self.logger.error(id + 'audio path: ' + e.message);
    }
    if (!had) { return libQ.resolve(); }
    return self.rebuildAlsa().then(function (rewritten) {
        self.putVolumeBack(rewritten, was);
    });
};

// Volumio asks for contributions only from the plugins it knew when it
// started: one installed since joins the chain after a restart. Looked at a
// moment after the rebuild, and asked for once.
RaspDacMini.prototype.checkChain = function () {
    var self = this;
    if (self.chainTimer) { clearTimeout(self.chainTimer); }
    self.chainTimer = setTimeout(function () {
        self.chainTimer = null;
        var asound = '';
        try { asound = fs.readFileSync(ASOUND_FILE, 'utf8'); } catch (e) { /* not written yet */ }
        if (tap.inChain(asound)) { return; }
        self.askRestart('RASPDACMINI.PATH_RESTART_MSG');
    }, CHAIN_AFTER);
};

// -----------------------------------------------------------------------------
// The settings page.
// -----------------------------------------------------------------------------

RaspDacMini.prototype.getUIConfig = function () {
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

RaspDacMini.prototype.setUIConfig = function () { };
RaspDacMini.prototype.getConf = function (varName) { return this.config.get(varName); };
RaspDacMini.prototype.setConf = function (varName, varValue) { this.config.set(varName, varValue); };

// The values of one section into the store, or a word about the first that
// cannot be taken. Returns whether they were saved.
RaspDacMini.prototype.save = function (data, keys) {
    var self = this;
    var name = self.commandRouter.getI18nString('RASPDACMINI.PLUGIN_NAME');
    var taken = form.take(data, keys);
    if (taken.bad) {
        self.commandRouter.pushToastMessage('error', name, self.commandRouter.getI18nString('RASPDACMINI.BAD_NUMBER')
            .replace('{{field}}', self.commandRouter.getI18nString('RASPDACMINI.' + taken.bad.key.toUpperCase()))
            .replace('{{min}}', taken.bad.min)
            .replace('{{max}}', taken.bad.max));
        return false;
    }
    Object.keys(taken.values).forEach(function (key) {
        self.config.set(key, taken.values[key]);
    });
    self.commandRouter.pushToastMessage('success', name, self.commandRouter.getI18nString('RASPDACMINI.SAVED'));
    return true;
};

RaspDacMini.prototype.saveDisplay = function (data) {
    var self = this;
    var was = form.isOn(self.config.get('lcd_active'), true);
    var driven = form.driver(self.config.get('display_driver'));
    var metered = form.isOn(self.config.get('meters'), false);
    if (!self.save(data, ['lcd_active', 'display_driver', 'boot_splash', 'sleep_after', 'meters', 'meters_style', 'meters_gain'])) {
        return libQ.resolve();
    }
    if (form.isOn(self.config.get('meters'), false) !== metered) {
        // The meters read a tap in the player's audio path: in with them,
        // out without.
        self.applyAudioPath();
    }
    if (form.driver(self.config.get('display_driver')) !== driven) {
        // The way the display is driven is in the boot configuration: the
        // display goes on as it is until the player has restarted on it.
        self.applyBoot().then(function (changed) {
            if (changed) {
                self.askRestart('RASPDACMINI.DRIVER_RESTART_MSG');
            }
        });
    }
    if (form.isOn(self.config.get('lcd_active'), true) !== was) {
        // A display just switched on starts before the store has written
        // what was saved with it; it is told to read again once it has.
        return self.applyService().then(function () {
            self.reloadDisplay();
        });
    }
    self.reloadDisplay();
    return libQ.resolve();
};

RaspDacMini.prototype.saveRemote = function (data) {
    if (this.save(data, ['remote_active'])) {
        this.reloadDisplay();
    }
    return libQ.resolve();
};

RaspDacMini.prototype.saveJournal = function (data) {
    if (this.save(data, ['log_level'])) {
        this.reloadDisplay();
    }
    return libQ.resolve();
};

// What the running display says of its remote: whether the receiver is
// read, and the key that arrived last.
RaspDacMini.prototype.checkRemote = function () {
    var self = this;
    var name = self.commandRouter.getI18nString('RASPDACMINI.PLUGIN_NAME');
    var strings = {
        receiver: self.commandRouter.getI18nString('RASPDACMINI.REMOTE_RECEIVER'),
        last: self.commandRouter.getI18nString('RASPDACMINI.REMOTE_LAST'),
        none: self.commandRouter.getI18nString('RASPDACMINI.REMOTE_NONE')
    };
    return self.mainPid().then(function (pid) {
        var status = null;
        if (pid > 0) {
            try { status = JSON.parse(fs.readFileSync(REMOTE_STATUS, 'utf8')); } catch (e) { /* not written yet */ }
        }
        if (!status) {
            self.commandRouter.pushToastMessage('warning', name, self.commandRouter.getI18nString('RASPDACMINI.REMOTE_NOT_RUNNING'));
            return;
        }
        var report = remote.describe(status, Math.floor(Date.now() / 1000), strings);
        self.commandRouter.pushToastMessage(report.reading ? 'info' : 'warning', name, report.text);
    });
};

// called from commandrouter to find the language file
RaspDacMini.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';
    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};
