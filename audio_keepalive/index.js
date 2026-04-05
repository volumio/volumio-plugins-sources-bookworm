'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');

var LOG_PREFIX = 'AudioKeepalive: ';
var ASOUND_CONTRIBUTION_FILENAME = 'keepaliveProxy.keepaliveProxyOut.-1.conf';
var ASOUND_CONTRIBUTION_CONTENT = [
    'pcm.keepaliveProxy {',
    '    type keepalive',
    '    slave.pcm "keepaliveProxyOut"',
    '}'
].join('\n') + '\n';

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

    if (self.config.get('keepalive_enabled')) {
        self._ensureAsoundContribution();
        self._rebuildALSAConfig();
    }

    return libQ.resolve();
};

AudioKeepalive.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();

    self._removeAsoundContribution();
    self._rebuildALSAConfig()
        .then(function () {
            defer.resolve();
        })
        .fail(function () {
            defer.resolve();
        });

    return defer.promise;
};

AudioKeepalive.prototype.onRestart = function () {
};

// ---------------------------------------------------------------------------
// ALSA contribution management
// ---------------------------------------------------------------------------

AudioKeepalive.prototype._ensureAsoundContribution = function () {
    var asoundDir = path.join(__dirname, 'asound');
    var contributionPath = path.join(asoundDir, ASOUND_CONTRIBUTION_FILENAME);
    try {
        fs.ensureDirSync(asoundDir);
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
            fs.removeSync(contributionPath);
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
    var wasEnabled = self.config.get('keepalive_enabled');
    var isEnabled = data.keepalive_enabled;

    self.config.set('keepalive_enabled', isEnabled);

    if (isEnabled && !wasEnabled) {
        self._ensureAsoundContribution();
    } else if (!isEnabled && wasEnabled) {
        self._removeAsoundContribution();
    }

    self._rebuildALSAConfig()
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
