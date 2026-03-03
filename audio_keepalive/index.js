'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');

var mpdConfPath = '/etc/mpd.conf';
var SENTINEL_BEGIN = '    # audio_keepalive_begin';
var SENTINEL_END = '    # audio_keepalive_end';
var LOG_PREFIX = 'AudioKeepalive: ';

module.exports = AudioKeepalive;

function AudioKeepalive(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

AudioKeepalive.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

AudioKeepalive.prototype.onStart = function () {
    var self = this;

    self.commandRouter.sharedVars.registerCallback('alsa.outputdevice', self.onAlsaConfigChange.bind(self));
    self.commandRouter.sharedVars.registerCallback('alsa.outputdevicemixer', self.onAlsaConfigChange.bind(self));
    self.commandRouter.sharedVars.registerCallback('alsa.device', self.onAlsaConfigChange.bind(self));

    self.waitForSystemReadyAndPatch();

    return libQ.resolve();
};

AudioKeepalive.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();

    self.removePatch()
        .then(function () {
            defer.resolve();
        })
        .fail(function () {
            defer.resolve();
        });

    return defer.promise;
};

AudioKeepalive.prototype.onRestart = function () {
    this.patchMpd();
};

// ---------------------------------------------------------------------------
// System ready polling (process.env.VOLUMIO_SYSTEM_STATUS)
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.waitForSystemReadyAndPatch = function () {
    var self = this;
    var attempts = 0;
    var maxAttempts = 60;
    var interval = 5000;

    function check() {
        attempts++;
        var status = process.env.VOLUMIO_SYSTEM_STATUS;

        if (status === 'ready') {
            self.logger.info(LOG_PREFIX + 'System ready after ' + attempts + ' checks');
            self.patchMpd();
        } else if (attempts < maxAttempts) {
            setTimeout(check, interval);
        } else {
            self.logger.warn(LOG_PREFIX + 'Timeout waiting for system ready, patching anyway');
            self.patchMpd();
        }
    }

    check();
};

// ---------------------------------------------------------------------------
// ALSA config change callback
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.onAlsaConfigChange = function () {
    var self = this;
    self.logger.info(LOG_PREFIX + 'ALSA config changed, re-patching after delay');
    setTimeout(function () {
        self.patchMpd();
    }, 3000);
};

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';

    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};

AudioKeepalive.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    var langCode = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + langCode + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    ).then(function (uiconf) {
        uiconf.sections[0].content[0].value = self.config.get('keepalive_enabled');

        var bufferTime = self.config.get('buffer_time') || '';
        uiconf.sections[0].content[1].value.value = bufferTime;
        uiconf.sections[0].content[1].value.label = self.getLabelForSelect(
            uiconf.sections[0].content[1].options, bufferTime
        );

        var periodTime = self.config.get('period_time') || '';
        uiconf.sections[0].content[2].value.value = periodTime;
        uiconf.sections[0].content[2].value.label = self.getLabelForSelect(
            uiconf.sections[0].content[2].options, periodTime
        );

        uiconf.sections[0].content[3].value = self.config.get('stop_dsd_silence');

        defer.resolve(uiconf);
    }).fail(function (e) {
        self.logger.error(LOG_PREFIX + 'Failed to parse UI config: ' + e);
        defer.reject(new Error());
    });

    return defer.promise;
};

AudioKeepalive.prototype.getLabelForSelect = function (options, key) {
    for (var i = 0; i < options.length; i++) {
        if (options[i].value === key) {
            return options[i].label;
        }
    }
    return 'Default';
};

// ---------------------------------------------------------------------------
// Save settings
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.saveSettings = function (data) {
    var self = this;
    var defer = libQ.defer();

    self.config.set('keepalive_enabled', data.keepalive_enabled);
    self.config.set('buffer_time', data.buffer_time ? data.buffer_time.value : '');
    self.config.set('period_time', data.period_time ? data.period_time.value : '');
    self.config.set('stop_dsd_silence', data.stop_dsd_silence);

    self.patchMpd()
        .then(function () {
            self.commandRouter.pushToastMessage('success', 'Audio Keepalive',
                self.commandRouter.getI18nString('SETTINGS_SAVED'));
            defer.resolve();
        })
        .fail(function (err) {
            self.commandRouter.pushToastMessage('error', 'Audio Keepalive',
                'Failed to apply settings');
            defer.reject(err);
        });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// MPD config patching
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.buildConfigString = function () {
    var lines = [];

    if (this.config.get('keepalive_enabled')) {
        lines.push('    always_on       "yes"');
        lines.push('    close_on_pause  "no"');
    }

    var bufferTime = this.config.get('buffer_time');
    if (bufferTime) {
        lines.push('    buffer_time     "' + bufferTime + '"');
    }

    var periodTime = this.config.get('period_time');
    if (periodTime) {
        lines.push('    period_time     "' + periodTime + '"');
    }

    if (this.config.get('stop_dsd_silence')) {
        lines.push('    stop_dsd_silence "yes"');
    }

    if (lines.length === 0) {
        return '';
    }
    return lines.join('\n') + '\n';
};

AudioKeepalive.prototype.injectConfig = function (fileData, configString) {
    var escapedBegin = SENTINEL_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var escapedEnd = SENTINEL_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var sentinelRegex = new RegExp(escapedBegin + '[\\s\\S]*?' + escapedEnd + '\\n?');

    if (sentinelRegex.test(fileData)) {
        if (configString) {
            return fileData.replace(sentinelRegex,
                SENTINEL_BEGIN + '\n' + configString + SENTINEL_END + '\n');
        }
        return fileData.replace(sentinelRegex, '');
    }

    if (!configString) {
        return fileData;
    }

    var alsaMatch = fileData.match(/type\s+"alsa"/);
    if (!alsaMatch) {
        return null;
    }

    var alsaIndex = fileData.indexOf(alsaMatch[0]);
    var closingBrace = fileData.indexOf('}', alsaIndex);
    if (closingBrace === -1) {
        return null;
    }

    var injection = SENTINEL_BEGIN + '\n' + configString + SENTINEL_END + '\n';
    return fileData.substring(0, closingBrace) + injection + fileData.substring(closingBrace);
};

AudioKeepalive.prototype.patchMpd = function () {
    var self = this;
    var defer = libQ.defer();
    var configString = self.buildConfigString();

    fs.readFile(mpdConfPath, 'utf8', function (err, fileData) {
        if (err) {
            self.logger.error(LOG_PREFIX + 'Error reading mpd.conf: ' + err);
            defer.reject(err);
            return;
        }

        var newData = self.injectConfig(fileData, configString);

        if (newData === null) {
            self.logger.warn(LOG_PREFIX + 'No ALSA audio_output block found in mpd.conf');
            defer.resolve();
            return;
        }

        if (newData === fileData) {
            self.logger.info(LOG_PREFIX + 'mpd.conf already up to date');
            defer.resolve();
            return;
        }

        fs.writeFile(mpdConfPath, newData, 'utf8', function (err) {
            if (err) {
                self.logger.error(LOG_PREFIX + 'Error writing mpd.conf: ' + err);
                defer.reject(err);
                return;
            }

            self.logger.info(LOG_PREFIX + 'mpd.conf patched');
            setTimeout(function () {
                self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
                defer.resolve();
            }, 1000);
        });
    });

    return defer.promise;
};

AudioKeepalive.prototype.removePatch = function () {
    var self = this;
    var defer = libQ.defer();

    fs.readFile(mpdConfPath, 'utf8', function (err, fileData) {
        if (err) {
            self.logger.error(LOG_PREFIX + 'Error reading mpd.conf for removal: ' + err);
            defer.resolve();
            return;
        }

        var newData = self.injectConfig(fileData, '');

        if (newData === null || newData === fileData) {
            defer.resolve();
            return;
        }

        fs.writeFile(mpdConfPath, newData, 'utf8', function (err) {
            if (err) {
                self.logger.error(LOG_PREFIX + 'Error writing mpd.conf for removal: ' + err);
                defer.resolve();
                return;
            }

            self.logger.info(LOG_PREFIX + 'Patch removed from mpd.conf');
            setTimeout(function () {
                self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
                defer.resolve();
            }, 1000);
        });
    });

    return defer.promise;
};
