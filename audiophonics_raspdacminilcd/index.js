'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

module.exports = raspdacMiniLCD;

function raspdacMiniLCD(context) {
    var self = this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
}

/* Volumio Plugin Lifecycle Methods */

raspdacMiniLCD.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
};

raspdacMiniLCD.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[RaspDacMini LCD] Starting plugin');

    // Check if framebuffer device exists
    if (!self.checkFramebuffer()) {
        self.logger.error('[RaspDacMini LCD] Framebuffer /dev/fb1 not found. Ensure dtoverlay is loaded.');
        self.commandRouter.pushToastMessage('error', 'RaspDacMini LCD', 'Display device not found. Check dtoverlay installation.');
        defer.reject(new Error('Framebuffer /dev/fb1 not found'));
        return defer.promise;
    }

    // Check if LCD is enabled in config
    if (!self.config.get('lcd_active')) {
        self.logger.info('[RaspDacMini LCD] LCD is disabled in configuration');
        defer.resolve();
        return defer.promise;
    }

    // Start the compositor service
    self.systemctl('start', 'rdmlcd.service')
        .then(function() {
            self.logger.info('[RaspDacMini LCD] Service started successfully');
            self.commandRouter.pushToastMessage('success', 'RaspDacMini LCD', 'Display service started');
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[RaspDacMini LCD] Failed to start service: ' + error);
            self.commandRouter.pushToastMessage('error', 'RaspDacMini LCD', 'Failed to start display service');
            defer.reject(error);
        });

    return defer.promise;
};

raspdacMiniLCD.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[RaspDacMini LCD] Stopping plugin');

    // Stop the compositor service
    self.systemctl('stop', 'rdmlcd.service')
        .then(function() {
            self.logger.info('[RaspDacMini LCD] Service stopped successfully');
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[RaspDacMini LCD] Failed to stop service: ' + error);
            // Resolve anyway to allow plugin to stop
            defer.resolve();
        });

    return defer.promise;
};

raspdacMiniLCD.prototype.onRestart = function() {
    var self = this;
    
    self.logger.info('[RaspDacMini LCD] Restarting plugin');
    
    // Stop then start
    self.onStop()
        .then(function() {
            return self.onStart();
        });
};

raspdacMiniLCD.prototype.onInstall = function() {
    var self = this;
    // Placeholder: Handled by install.sh
};

raspdacMiniLCD.prototype.onUninstall = function() {
    var self = this;
    // Placeholder: Handled by uninstall.sh
};

raspdacMiniLCD.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            // Placeholder: Load current config values into UI
            uiconf.sections[0].content[0].value = self.config.get('lcd_active');
            uiconf.sections[0].content[1].value = self.config.get('sleep_after');

            defer.resolve(uiconf);
        })
        .fail(function() {
            defer.reject(new Error());
        });

    return defer.promise;
};

raspdacMiniLCD.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

raspdacMiniLCD.prototype.setUIConfig = function(data) {
    var self = this;
    // Placeholder: Implementation needed
};

/* Configuration Methods */

raspdacMiniLCD.prototype.updateLCDConfig = function(data) {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[RaspDacMini LCD] Updating configuration');

    // Save configuration
    self.config.set('lcd_active', data['lcd_active']);
    self.config.set('sleep_after', data['sleep_after']);

    // Update service environment file
    self.updateServiceEnvironment()
        .then(function() {
            // Restart service if LCD is active
            if (data['lcd_active']) {
                return self.systemctl('restart', 'rdmlcd.service');
            } else {
                return self.systemctl('stop', 'rdmlcd.service');
            }
        })
        .then(function() {
            self.commandRouter.pushToastMessage('success', 'RaspDacMini LCD', 'Configuration saved and service restarted');
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[RaspDacMini LCD] Failed to update configuration: ' + error);
            self.commandRouter.pushToastMessage('error', 'RaspDacMini LCD', 'Failed to apply configuration');
            defer.reject(error);
        });

    return defer.promise;
};

raspdacMiniLCD.prototype.restartLCD = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[RaspDacMini LCD] User requested LCD service restart');

    if (!self.config.get('lcd_active')) {
        self.commandRouter.pushToastMessage('info', 'RaspDacMini LCD', 'LCD is disabled. Enable it first.');
        defer.resolve();
        return defer.promise;
    }

    self.commandRouter.pushToastMessage('info', 'RaspDacMini LCD', 'Restarting display service...');

    self.systemctl('restart', 'rdmlcd.service')
        .then(function() {
            self.logger.info('[RaspDacMini LCD] Service restarted successfully');
            self.commandRouter.pushToastMessage('success', 'RaspDacMini LCD', 'Display service restarted');
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[RaspDacMini LCD] Failed to restart service: ' + error);
            self.commandRouter.pushToastMessage('error', 'RaspDacMini LCD', 'Failed to restart display service');
            defer.reject(error);
        });

    return defer.promise;
};

/* Helper Methods */

raspdacMiniLCD.prototype.checkFramebuffer = function() {
    var self = this;
    
    try {
        var fbExists = fs.existsSync('/dev/fb1');
        if (fbExists) {
            self.logger.info('[RaspDacMini LCD] Framebuffer /dev/fb1 detected');
            return true;
        } else {
            self.logger.error('[RaspDacMini LCD] Framebuffer /dev/fb1 not found');
            return false;
        }
    } catch (error) {
        self.logger.error('[RaspDacMini LCD] Error checking framebuffer: ' + error);
        return false;
    }
};

raspdacMiniLCD.prototype.updateServiceEnvironment = function() {
    var self = this;
    var defer = libQ.defer();

    var sleep_after = self.config.get('sleep_after') || 900;

    self.logger.info('[RaspDacMini LCD] Updating service environment: SLEEP_AFTER=' + sleep_after);

    // Use helper script to update service environment (handles mkdir, write, daemon-reload)
    exec('/usr/bin/sudo /usr/local/bin/rdmlcd-update-env.sh ' + sleep_after, {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        if (error) {
            self.logger.error('[RaspDacMini LCD] Failed to update service environment: ' + error);
            defer.reject(error);
        } else {
            self.logger.info('[RaspDacMini LCD] Service environment updated');
            defer.resolve();
        }
    });

    return defer.promise;
};

raspdacMiniLCD.prototype.systemctl = function(cmd, service) {
    var self = this;
    var defer = libQ.defer();

    // Placeholder: Implementation needed
    var command = '/usr/bin/sudo /bin/systemctl ' + cmd + ' ' + service;

    exec(command, {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        if (error) {
            self.logger.error('[RaspDacMini LCD] systemctl ' + cmd + ' ' + service + ' failed: ' + error);
            defer.reject(error);
        } else {
            self.logger.info('[RaspDacMini LCD] systemctl ' + cmd + ' ' + service + ' succeeded');
            defer.resolve();
        }
    });

    return defer.promise;
};
