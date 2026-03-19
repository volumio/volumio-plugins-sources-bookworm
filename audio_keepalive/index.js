'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var spawn = require('child_process').spawn;
// Must match Volumio socket.io server (v1.7.4) to avoid parser/protocol mismatch; see gpio-buttons.
var io = require('socket.io-client');

var mpdConfPath = '/etc/mpd.conf';
var SENTINEL_BEGIN = '    # audio_keepalive_begin';
var SENTINEL_END = '    # audio_keepalive_end';
var LOG_PREFIX = 'AudioKeepalive: ';
var FEEDER_KILL_TIMEOUT_MS = 3000;
var FEEDER_RESTART_INITIAL_MS = 5000;
var FEEDER_RESTART_MAX_MS = 60000;
var STATE_PLAYING = 'play';
var STATE_PAUSED = 'pause';
var STATE_STOPPED = 'stop';

module.exports = AudioKeepalive;

function AudioKeepalive(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;

    this._feederPid = null;
    this._feederState = 'stopped';
    this._originalVolumioPlay = null;
    this._idleTimer = null;
    this._stateSocket = null;
    this._feederRestartTimer = null;
    this._feederRestartDelayMs = FEEDER_RESTART_INITIAL_MS;
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
    var mode = self.config.get('keepalive_mode') || 'mpd_config';

    self.commandRouter.sharedVars.registerCallback('alsa.outputdevice', self.onAlsaConfigChange.bind(self));
    self.commandRouter.sharedVars.registerCallback('alsa.outputdevicemixer', self.onAlsaConfigChange.bind(self));
    self.commandRouter.sharedVars.registerCallback('alsa.device', self.onAlsaConfigChange.bind(self));

    if (mode === 'silence_feeder' && self.config.get('keepalive_enabled')) {
        self._installVolumioPlayWrapper();
        self._registerPushStateListener();
    }

    self.waitForSystemReadyAndPatch();

    return libQ.resolve();
};

AudioKeepalive.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();
    var mode = self.config.get('keepalive_mode') || 'mpd_config';

    if (self._idleTimer) {
        clearTimeout(self._idleTimer);
        self._idleTimer = null;
    }
    if (mode === 'silence_feeder') {
        if (self._feederRestartTimer) {
            clearTimeout(self._feederRestartTimer);
            self._feederRestartTimer = null;
        }
        self._killFeederAndWait()
            .then(function () {
                self._restoreVolumioPlay();
                if (self._stateSocket) {
                    self._stateSocket.removeAllListeners('pushState');
                    self._stateSocket.removeAllListeners('connect');
                    self._stateSocket.removeAllListeners('connect_error');
                    self._stateSocket.removeAllListeners('disconnect');
                    self._stateSocket.disconnect();
                    self._stateSocket = null;
                }
                return self.removePatch();
            })
            .then(function () {
                defer.resolve();
            })
            .fail(function () {
                defer.resolve();
            });
    } else {
        self.removePatch()
            .then(function () {
                defer.resolve();
            })
            .fail(function () {
                defer.resolve();
            });
    }

    return defer.promise;
};

AudioKeepalive.prototype.onRestart = function () {
    this.patchMpd();
};

// ---------------------------------------------------------------------------
// Silence feeder (Mode 2: HDMI)
// ---------------------------------------------------------------------------

AudioKeepalive.prototype._installVolumioPlayWrapper = function () {
    var self = this;
    if (this.commandRouter.volumioPlay && !this._originalVolumioPlay) {
        this._originalVolumioPlay = this.commandRouter.volumioPlay.bind(this.commandRouter);
        this.commandRouter.volumioPlay = function () {
            var args = arguments;
            if (self._idleTimer) {
                clearTimeout(self._idleTimer);
                self._idleTimer = null;
            }
            if (self._feederRestartTimer) {
                clearTimeout(self._feederRestartTimer);
                self._feederRestartTimer = null;
            }
            return self._killFeederAndWait().then(function () {
                return self._originalVolumioPlay.apply(self.commandRouter, args);
            });
        };
        this.logger.info(LOG_PREFIX + 'volumioPlay wrapper installed');
    }
};

AudioKeepalive.prototype._restoreVolumioPlay = function () {
    if (this._originalVolumioPlay) {
        this.commandRouter.volumioPlay = this._originalVolumioPlay;
        this._originalVolumioPlay = null;
        this.logger.info(LOG_PREFIX + 'volumioPlay wrapper removed');
    }
};

AudioKeepalive.prototype._killFeeder = function () {
    if (this._feederPid == null) return;
    try {
        process.kill(this._feederPid, 'SIGTERM');
    } catch (e) {
        this.logger.debug(LOG_PREFIX + 'Feeder kill: ' + e.message);
    }
    this._feederPid = null;
    this._feederState = 'stopped';
};

AudioKeepalive.prototype._killFeederAndWait = function () {
    var self = this;
    var defer = libQ.defer();
    if (this._feederPid == null) {
        defer.resolve();
        return defer.promise;
    }

    var pid = this._feederPid;
    this._feederPid = null;
    this._feederState = 'stopped';
    try {
        process.kill(pid, 'SIGTERM');
    } catch (e) {
        self.logger.debug(LOG_PREFIX + 'Feeder kill: ' + e.message);
        defer.resolve();
        return defer.promise;
    }

    var deadline = Date.now() + FEEDER_KILL_TIMEOUT_MS;
    function poll() {
        if (Date.now() > deadline) {
            try { process.kill(pid, 'SIGKILL'); } catch (e) {}
            defer.resolve();
            return;
        }
        try {
            process.kill(pid, 0);
        } catch (e) {
            defer.resolve();
            return;
        }
        setTimeout(poll, 50);
    }
    setTimeout(poll, 50);
    return defer.promise;
};

AudioKeepalive.prototype._startFeeder = function () {
    var self = this;
    if (this._feederPid != null) return;
    if (this._feederRestartTimer) {
        clearTimeout(this._feederRestartTimer);
        this._feederRestartTimer = null;
    }

    var device = (this.config.get('feeder_alsa_device') || 'volumioOutput').trim() || 'volumioOutput';
    var args = ['-D', device, '-f', 'S16_LE', '-r', '44100', '-c', '2', '-t', 'raw', '/dev/zero'];

    var child = spawn('aplay', args, { stdio: 'ignore' });
    this._feederPid = child.pid;
    this._feederState = 'running';
    this._feederRestartDelayMs = FEEDER_RESTART_INITIAL_MS;

    child.on('error', function (err) {
        self.logger.error(LOG_PREFIX + 'Feeder aplay error: ' + err.message);
    });
    child.on('exit', function (code, signal) {
        if (self._feederPid === child.pid) {
            var wasRunning = self._feederState === 'running';
            self._feederPid = null;
            self._feederState = 'stopped';
            if (wasRunning && self._feederRestartTimer == null) {
                var delay = self._feederRestartDelayMs;
                self._feederRestartDelayMs = Math.min(self._feederRestartDelayMs * 2, FEEDER_RESTART_MAX_MS);
                self._feederRestartTimer = setTimeout(function () {
                    self._feederRestartTimer = null;
                    if (!self.config.get('keepalive_enabled')) return;
                    if ((self.config.get('keepalive_mode') || 'mpd_config') !== 'silence_feeder') return;
                    self._startFeeder();
                }, delay);
                self.logger.info(LOG_PREFIX + 'Feeder exited unexpectedly, restart in ' + delay + ' ms');
            }
        }
    });

    this.logger.info(LOG_PREFIX + 'Silence feeder started (PID ' + this._feederPid + ', device: ' + device + ')');
};

AudioKeepalive.prototype._registerPushStateListener = function () {
    var self = this;
    if (this._stateSocket) return;

    this._stateSocket = io.connect('http://localhost:3000');
    this._stateSocket.on('connect', function () {
        self.logger.info(LOG_PREFIX + 'State socket connected');
    });
    this._stateSocket.on('connect_error', function (err) {
        self.logger.error(LOG_PREFIX + 'State socket error: ' + (err && err.message ? err.message : err));
    });
    this._stateSocket.on('disconnect', function (reason) {
        self.logger.warn(LOG_PREFIX + 'State socket disconnected: ' + reason);
    });
    this._stateSocket.on('pushState', function (state) {
        if (!self.config.get('keepalive_enabled')) return;
        if ((self.config.get('keepalive_mode') || 'mpd_config') !== 'silence_feeder') return;

        var status = (state && state.status) ? state.status : '';
        if (status === STATE_PLAYING) {
            if (self._idleTimer) {
                clearTimeout(self._idleTimer);
                self._idleTimer = null;
            }
            if (self._feederRestartTimer) {
                clearTimeout(self._feederRestartTimer);
                self._feederRestartTimer = null;
            }
            self._killFeeder();
            return;
        }
        if (status === STATE_PAUSED || status === STATE_STOPPED) {
            if (self._idleTimer) clearTimeout(self._idleTimer);
            var delay = Math.max(0, parseInt(self.config.get('idle_delay_ms'), 10) || 1000);
            self._idleTimer = setTimeout(function () {
                self._idleTimer = null;
                self._startFeeder();
            }, delay);
        }
    });
    this.logger.info(LOG_PREFIX + 'Push state listener registered');
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
    if ((self.config.get('keepalive_mode') || 'mpd_config') === 'silence_feeder') return;
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
        var c = uiconf.sections[0].content;
        c[0].value = self.config.get('keepalive_enabled');

        var mode = self.config.get('keepalive_mode') || 'mpd_config';
        c[1].value.value = mode;
        c[1].value.label = self.getLabelForSelect(c[1].options, mode);

        var idleDelay = self.config.get('idle_delay_ms');
        var idleStr = (idleDelay !== undefined && idleDelay !== null) ? String(idleDelay) : '1000';
        c[2].value.value = idleStr;
        c[2].value.label = self.getLabelForSelect(c[2].options, idleStr);

        c[3].value = (self.config.get('feeder_alsa_device') || 'volumioOutput').trim() || 'volumioOutput';

        var bufferTime = self.config.get('buffer_time') || '';
        c[4].value.value = bufferTime;
        c[4].value.label = self.getLabelForSelect(c[4].options, bufferTime);

        var periodTime = self.config.get('period_time') || '';
        c[5].value.value = periodTime;
        c[5].value.label = self.getLabelForSelect(c[5].options, periodTime);

        c[6].value = self.config.get('stop_dsd_silence');

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
    var prevMode = self.config.get('keepalive_mode') || 'mpd_config';
    var prevEnabled = self.config.get('keepalive_enabled');

    self.config.set('keepalive_enabled', data.keepalive_enabled);
    self.config.set('keepalive_mode', data.keepalive_mode ? (data.keepalive_mode.value || data.keepalive_mode) : 'mpd_config');
    var idleMs = data.idle_delay_ms;
    if (idleMs != null) {
        var v = idleMs.value !== undefined ? idleMs.value : idleMs;
        self.config.set('idle_delay_ms', parseInt(v, 10) || 1000);
    }
    self.config.set('feeder_alsa_device', (data.feeder_alsa_device || 'volumioOutput').trim() || 'volumioOutput');
    self.config.set('buffer_time', data.buffer_time ? data.buffer_time.value : '');
    self.config.set('period_time', data.period_time ? data.period_time.value : '');
    self.config.set('stop_dsd_silence', data.stop_dsd_silence);

    var nextMode = self.config.get('keepalive_mode') || 'mpd_config';
    var nextEnabled = self.config.get('keepalive_enabled');
    var wasFeederActive = prevMode === 'silence_feeder' && prevEnabled;
    var isFeederActive = nextMode === 'silence_feeder' && nextEnabled;

    if (wasFeederActive && !isFeederActive) {
        if (self._idleTimer) {
            clearTimeout(self._idleTimer);
            self._idleTimer = null;
        }
        if (self._feederRestartTimer) {
            clearTimeout(self._feederRestartTimer);
            self._feederRestartTimer = null;
        }
        self._killFeederAndWait();
        self._restoreVolumioPlay();
        if (self._stateSocket) {
            self._stateSocket.removeAllListeners('pushState');
            self._stateSocket.removeAllListeners('connect');
            self._stateSocket.removeAllListeners('connect_error');
            self._stateSocket.removeAllListeners('disconnect');
            self._stateSocket.disconnect();
            self._stateSocket = null;
        }
    } else if (isFeederActive && !wasFeederActive) {
        self._installVolumioPlayWrapper();
        self._registerPushStateListener();
    }

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
    if ((this.config.get('keepalive_mode') || 'mpd_config') === 'silence_feeder') {
        return '';
    }
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
