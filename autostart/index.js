'use strict';

let libQ = require('kew');
let fs = require('fs-extra');
let config = new (require('v-conf'))();

module.exports = AutoStart;

function AutoStart(context) {
    // This fixed variable will let us refer to 'this' object at deeper scopes
    const self = this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
}

AutoStart.prototype.onVolumioStart = function () {

    this.logger.info('AutoStart - onVolumioStart - read config.json');

    const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
}

AutoStart.prototype.onStart = function () {
    const self = this;
    const defer = libQ.defer();

    this.logger.info('AutoStart - onStart - waiting for system ready state');

    const playFromLastPosition = this.config.get('playFromLastPosition') || false;
    const lastPosition = this.config.get('lastPosition') || -1;
    const autostartDelay = this.config.get('autostartDelay') || 5000;

    // Startup volume settings
    const autostartVolumeEnabled = this.config.get('autostartVolumeEnabled') || false;
    const autostartVolumeLevel = this.config.get('autostartVolumeLevel');

    // Configurable polling settings
    const pollingInterval = this.config.get('pollingInterval') || 5000;
    const maxPollingAttempts = this.config.get('maxPollingAttempts') || 60;

    this.logger.info('AutoStart - Polling config: interval=' + pollingInterval + 'ms, maxAttempts=' + maxPollingAttempts);
    this.logger.info('AutoStart - Maximum wait time: ' + ((pollingInterval * maxPollingAttempts) / 1000) + ' seconds');

    if (autostartVolumeEnabled) {
        this.logger.info('AutoStart - Startup volume enabled, level=' + autostartVolumeLevel);
    } else {
        this.logger.info('AutoStart - Startup volume disabled');
    }

    let attempts = 0;

    function checkSystemReady() {
        attempts++;

        // Check if Volumio system is ready
        const systemStatus = process.env.VOLUMIO_SYSTEM_STATUS;

        self.logger.info('AutoStart - Check #' + attempts + '/' + maxPollingAttempts + ' - VOLUMIO_SYSTEM_STATUS = ' + systemStatus);

        if (systemStatus === 'ready') {
            self.logger.info('AutoStart - System ready state CONFIRMED after ' + attempts + ' checks');

            // Set startup volume if enabled
            if (autostartVolumeEnabled && autostartVolumeLevel !== undefined) {
                self.setStartupVolume(autostartVolumeLevel);
            }

            // Apply the additional user-configured delay before playback
            self.logger.info('AutoStart - Applying additional delay of ' + autostartDelay + 'ms before playback');

            setTimeout(function () {
                self.startPlayback(playFromLastPosition, lastPosition);
            }, autostartDelay);

        } else if (attempts < maxPollingAttempts) {
            // Not ready yet - check again
            setTimeout(checkSystemReady, pollingInterval);

        } else {
            // Timeout reached - log error but try to play anyway
            self.logger.error('AutoStart - TIMEOUT waiting for system ready after ' + attempts + ' attempts (' + ((pollingInterval * attempts) / 1000) + ' seconds)');
            self.logger.info('AutoStart - Attempting playback anyway');

            // Still try to set volume even on timeout
            if (autostartVolumeEnabled && autostartVolumeLevel !== undefined) {
                self.setStartupVolume(autostartVolumeLevel);
            }

            self.startPlayback(playFromLastPosition, lastPosition);
        }
    }

    // Start checking for system ready state
    checkSystemReady();

    // Resolve promise immediately - the plugin is started, playback will happen when ready
    defer.resolve();

    return defer.promise;
};

AutoStart.prototype.setStartupVolume = function (level) {
    const self = this;

    self.logger.info('AutoStart - Setting startup volume to ' + level);

    try {
        // Use Volumio's volume control method
        self.commandRouter.volumiosetvolume(level);
        self.logger.info('AutoStart - Startup volume set successfully to ' + level);
    } catch (error) {
        // Graceful handling - mixer may be set to none
        self.logger.warn('AutoStart - Failed to set startup volume: ' + error.message);
        self.logger.warn('AutoStart - This may occur if mixer is set to None. Continuing anyway.');
    }
};

AutoStart.prototype.startPlayback = function (playFromLastPosition, lastPosition) {
    const self = this;

    self.logger.info('AutoStart - startPlayback called');

    let queue = self.commandRouter.volumioGetQueue();

    if (queue && queue.length > 0) {
        self.logger.info('AutoStart - Queue has ' + queue.length + ' items');

        if (playFromLastPosition === true && lastPosition !== -1) {
            self.logger.info('AutoStart - Playing from position ' + lastPosition);
            self.commandRouter.volumioPlay(lastPosition);
        } else {
            self.logger.info('AutoStart - Playing from position 0');
            self.commandRouter.volumioPlay(0);
        }
    } else {
        self.logger.info('AutoStart - Queue is empty, nothing to play');
    }
};

AutoStart.prototype.onStop = function () {
    const self = this;

    this.logger.info('AutoStart - onStop');

    if (this.config.get('playFromLastPosition') === true) {

        const state = this.commandRouter.volumioGetState();

        if (state && state.position) {

            this.logger.info('AutoStart - save lastPosition');
            this.config.set('lastPosition', state.position);
            // force dump to disk or config will not be saved before shutdown
            this.config.save();
        }
    }

    return libQ.resolve();
};

// Configuration Methods -----------------------------------------------------------------------------

AutoStart.prototype.getUIConfig = function () {
    const self = this;
    const defer = libQ.defer();

    this.logger.info('AutoStart - getUIConfig');

    const lang_code = this.commandRouter.sharedVars.get('language_code');

    this.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function (uiconf) {

            // Section 0 - Playback settings
            uiconf.sections[0].content[0].value = self.config.get('playFromLastPosition');
            uiconf.sections[0].content[1].value = self.config.get('autostartDelay') || 5000;

            // Section 3 - Startup volume settings
            uiconf.sections[3].content[0].value = self.config.get('autostartVolumeEnabled') || false;

            // For volume level: use stored value, or read current system volume
            var storedVolumeLevel = self.config.get('autostartVolumeLevel');
            if (storedVolumeLevel !== undefined) {
                uiconf.sections[3].content[1].value = storedVolumeLevel;
            } else {
                // Read current system volume as default
                try {
                    var currentState = self.commandRouter.volumioGetState();
                    if (currentState && currentState.volume !== undefined) {
                        uiconf.sections[3].content[1].value = currentState.volume;
                        self.logger.info('AutoStart - Using current system volume as default: ' + currentState.volume);
                    } else {
                        uiconf.sections[3].content[1].value = 50;
                        self.logger.info('AutoStart - Could not read system volume, using default: 50');
                    }
                } catch (error) {
                    uiconf.sections[3].content[1].value = 50;
                    self.logger.warn('AutoStart - Error reading system volume: ' + error.message);
                }
            }

            // Section 4 - Polling settings (advanced)
            uiconf.sections[4].content[0].value = self.config.get('showPollingSettings') || false;
            uiconf.sections[4].content[1].value = self.config.get('pollingInterval') || 5000;
            uiconf.sections[4].content[2].value = self.config.get('maxPollingAttempts') || 60;

            defer.resolve(uiconf);
        })
        .fail(function (error) {
            self.logger.error('AutoStart - Failed to parse UI Configuration page: ' + error);
            defer.reject(new Error());
        });

    return defer.promise;
};

AutoStart.prototype.saveOptions = function (data) {
    const self = this;

    this.logger.info('AutoStart - saving playback settings');

    const playFromLastPosition = data['playFromLastPosition'] || false;
    const autostartDelay = data['autostartDelay'] || 5000;
    this.config.set('playFromLastPosition', playFromLastPosition);
    this.config.set('autostartDelay', autostartDelay);

    this.commandRouter.pushToastMessage('success', 'AutoStart', this.commandRouter.getI18nString("COMMON.CONFIGURATION_UPDATE_DESCRIPTION"));

    this.logger.info('AutoStart - playback settings saved');

    return libQ.resolve();
};

AutoStart.prototype.saveVolumeOptions = function (data) {
    const self = this;

    this.logger.info('AutoStart - saving volume settings');

    const autostartVolumeEnabled = data['autostartVolumeEnabled'] || false;
    const autostartVolumeLevel = data['autostartVolumeLevel'];

    // Validate volume level is within range
    var volumeLevel = parseInt(autostartVolumeLevel, 10);
    if (isNaN(volumeLevel) || volumeLevel < 0) {
        volumeLevel = 0;
    } else if (volumeLevel > 100) {
        volumeLevel = 100;
    }

    this.config.set('autostartVolumeEnabled', autostartVolumeEnabled);
    this.config.set('autostartVolumeLevel', volumeLevel);

    this.logger.info('AutoStart - Volume settings: enabled=' + autostartVolumeEnabled + ', level=' + volumeLevel);

    this.commandRouter.pushToastMessage('success', 'AutoStart', this.commandRouter.getI18nString("COMMON.CONFIGURATION_UPDATE_DESCRIPTION"));

    this.logger.info('AutoStart - volume settings saved');

    return libQ.resolve();
};

AutoStart.prototype.savePollingOptions = function (data) {
    const self = this;

    this.logger.info('AutoStart - saving polling settings');

    const showPollingSettings = data['showPollingSettings'] || false;
    const pollingInterval = data['pollingInterval'] || 5000;
    const maxPollingAttempts = data['maxPollingAttempts'] || 60;

    this.config.set('showPollingSettings', showPollingSettings);
    this.config.set('pollingInterval', pollingInterval);
    this.config.set('maxPollingAttempts', maxPollingAttempts);

    const totalWaitTime = (pollingInterval * maxPollingAttempts) / 1000;
    this.logger.info('AutoStart - New maximum wait time: ' + totalWaitTime + ' seconds');

    this.commandRouter.pushToastMessage('success', 'AutoStart', this.commandRouter.getI18nString("COMMON.CONFIGURATION_UPDATE_DESCRIPTION"));

    this.logger.info('AutoStart - polling settings saved');

    return libQ.resolve();
};

AutoStart.prototype.getConfigurationFiles = function () {
    return ['config.json'];
}
