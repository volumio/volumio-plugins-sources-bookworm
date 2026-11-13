'use strict';

var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

// The zip carries no node_modules: kew and v-conf are Volumio's own copies,
// so the promises handed back are the kind the plugin manager checks for.
function coreModule(name) {
    try {
        return require('/volumio/node_modules/' + name);
    } catch (e) {
        return require(name);
    }
}

var libQ = coreModule('kew');

var LOG_PREFIX = 'AudioKeepalive: ';
var ASOUND_CONTRIBUTION_FILENAME = 'keepaliveProxy.keepaliveProxyOut.-1.conf';
// The ALSA client stays in the plugin's asound folder: pcm_type names the
// module by path, so nothing is installed under the system's alsa-lib
// directory. install.sh links asound/<module> to the build for this machine;
// alsa_controller reads only the *.conf files there.
var ALSA_MODULE = path.join(__dirname, 'asound', 'libasound_module_pcm_keepalive.so');
var ASOUND_CONTRIBUTION_CONTENT = [
    'pcm_type.keepalive {',
    '    lib "' + ALSA_MODULE + '"',
    '}',
    '',
    'pcm.keepaliveProxy {',
    '    type keepalive',
    '    socket "/run/audio-keepalive/ctl.sock"',
    '}'
].join('\n') + '\n';
var SYSTEMCTL = '/usr/bin/sudo /bin/systemctl';
var SERVICE = 'audio-keepalive.service';

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
    this.config = new (coreModule('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

AudioKeepalive.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

AudioKeepalive.prototype.onStart = function () {
    var self = this;

    if (self.config.get('keepalive_enabled')) {
        return self._applyEnabled();
    }

    return self._stopDaemon();
};

AudioKeepalive.prototype.onStop = function () {
    var self = this;

    return self._stopDaemon()
        .then(function () {
            self._removeAsoundContribution();
            return self._rebuildALSAConfig();
        })
        .fail(function () {
            return libQ.resolve();
        });
};

AudioKeepalive.prototype.onRestart = function () {
};

// ---------------------------------------------------------------------------
// ALSA contribution + daemon
// ---------------------------------------------------------------------------

AudioKeepalive.prototype._ensureAsoundContribution = function () {
    var asoundDir = path.join(__dirname, 'asound');
    var contributionPath = path.join(asoundDir, ASOUND_CONTRIBUTION_FILENAME);
    try {
        fs.mkdirSync(asoundDir, { recursive: true });
        fs.writeFileSync(contributionPath, ASOUND_CONTRIBUTION_CONTENT, 'utf8');
        this.logger.info(LOG_PREFIX + 'ALSA contribution file written');
    } catch (e) {
        this.logger.error(LOG_PREFIX + 'Failed to write ALSA contribution: ' + e.message);
    }
};

AudioKeepalive.prototype._removeAsoundContribution = function () {
    var contributionPath = path.join(__dirname, 'asound', ASOUND_CONTRIBUTION_FILENAME);
    try {
        if (fs.existsSync(contributionPath)) {
            fs.unlinkSync(contributionPath);
            this.logger.info(LOG_PREFIX + 'ALSA contribution file removed');
        }
    } catch (e) {
        this.logger.error(LOG_PREFIX + 'Failed to remove ALSA contribution: ' + e.message);
    }
};

AudioKeepalive.prototype._rebuildALSAConfig = function () {
    var self = this;
    try {
        return self.commandRouter.executeOnPlugin(
            'audio_interface', 'alsa_controller', 'updateALSAConfigFile');
    } catch (e) {
        self.logger.error(LOG_PREFIX + 'Failed to rebuild ALSA config: ' + e.message);
        return libQ.resolve();
    }
};

AudioKeepalive.prototype._systemctl = function (action) {
    var self = this;
    var defer = libQ.defer();
    var cmd = SYSTEMCTL + ' ' + action + ' ' + SERVICE;

    exec(cmd, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
        if (error) {
            self.logger.error(LOG_PREFIX + 'systemctl ' + action + ' failed: ' +
                (stderr || error.message));
            defer.reject(error);
            return;
        }
        self.logger.info(LOG_PREFIX + 'systemctl ' + action + ' ok');
        defer.resolve();
    });
    return defer.promise;
};

AudioKeepalive.prototype._startDaemon = function () {
    return this._systemctl('start');
};

AudioKeepalive.prototype._stopDaemon = function () {
    var self = this;
    return self._systemctl('stop').fail(function () {
        return libQ.resolve();
    });
};

AudioKeepalive.prototype._restartDaemon = function () {
    var self = this;
    return self._systemctl('restart').fail(function () {
        return self._startDaemon();
    });
};

AudioKeepalive.prototype._applyEnabled = function () {
    var self = this;

    self._ensureAsoundContribution();
    return self._rebuildALSAConfig()
        .then(function () {
            return self._restartDaemon();
        });
};

AudioKeepalive.prototype._applyDisabled = function () {
    var self = this;

    return self._stopDaemon()
        .then(function () {
            self._removeAsoundContribution();
            return self._rebuildALSAConfig();
        });
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
        defer.resolve(uiconf);
    }).fail(function (e) {
        self.logger.error(LOG_PREFIX + 'Failed to parse UI config: ' + e);
        defer.reject(new Error());
    });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// Save settings
// ---------------------------------------------------------------------------

AudioKeepalive.prototype.saveSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    var isEnabled = data.keepalive_enabled;

    self.config.set('keepalive_enabled', isEnabled);

    var apply = isEnabled ? self._applyEnabled() : self._applyDisabled();

    apply
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
