'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;

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

    var startChain = libQ.resolve();
    if (self.needsDisplay()) {
        startChain = self.ensureOverlayLoaded()
            .then(function() {
                return self.waitForFramebuffer(15, 1000);
            });
    }

    startChain
        .then(function() {
            return self.syncPluginServices(true);
        })
        .then(function() {
            self.logger.info('[RaspDacMini LCD] Plugin services synced');
            if (self.config.get('lcd_active')) {
                self.commandRouter.pushToastMessage('success', 'RaspDacMini LCD', 'Display service started');
            }
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[RaspDacMini LCD] Failed to start plugin services: ' + error);
            self.commandRouter.pushToastMessage('error', 'RaspDacMini LCD', 'Failed to start display services');
            defer.reject(error);
        });

    return defer.promise;
};

raspdacMiniLCD.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[RaspDacMini LCD] Stopping plugin');

    self.syncPluginServices(false)
        .then(function() {
            self.logger.info('[RaspDacMini LCD] Plugin services stopped');
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[RaspDacMini LCD] Failed to stop plugin services: ' + error);
            defer.resolve();
        });

    return defer.promise;
};

raspdacMiniLCD.prototype.onRestart = function() {
    var self = this;

    self.logger.info('[RaspDacMini LCD] Restarting plugin');

    self.onStop()
        .then(function() {
            return self.onStart();
        });
};

/*
 * Volumio calls onVolumioShutdown() / onVolumioReboot() the moment the user
 * presses Power Off / Reboot in the UI, and WAITS for the returned promise
 * before running `systemctl poweroff` / `reboot`. This is the single canonical
 * point to take ownership of the LCD: stop the compositor and paint the
 * shutdown/reboot splash once, so it stays on screen continuously until power
 * is cut (no blank gap, no competing painters).
 */
raspdacMiniLCD.prototype.paintLifecycleSplash = function(frame) {
    var self = this;

    if (!self.getBootSplashEnabled()) {
        return libQ.resolve();
    }

    var defer = libQ.defer();
    var settled = false;
    var finish = function() {
        if (settled) {
            return;
        }
        settled = true;
        defer.resolve();
    };

    // Never block system shutdown: settle regardless after a hard cap.
    var guard = setTimeout(function() {
        self.logger.error('[RaspDacMini LCD] ' + frame + ' splash timed out');
        finish();
    }, 8000);

    exec('/usr/bin/sudo /usr/local/bin/rdmlcd-shutdown-splash.sh ' + frame, {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        clearTimeout(guard);
        if (error) {
            self.logger.error('[RaspDacMini LCD] ' + frame + ' splash failed: ' + (stderr || error));
        } else {
            self.logger.info('[RaspDacMini LCD] ' + frame + ' splash painted');
        }
        finish();
    });

    return defer.promise;
};

raspdacMiniLCD.prototype.onVolumioShutdown = function() {
    var self = this;
    self.logger.info('[RaspDacMini LCD] onVolumioShutdown');
    return self.paintLifecycleSplash('shutdown');
};

raspdacMiniLCD.prototype.onVolumioReboot = function() {
    var self = this;
    self.logger.info('[RaspDacMini LCD] onVolumioReboot');
    return self.paintLifecycleSplash('reboot');
};

raspdacMiniLCD.prototype.onInstall = function() {
    var self = this;
    // Handled by install.sh
};

raspdacMiniLCD.prototype.onUninstall = function() {
    var self = this;
    // Handled by uninstall.sh
};

raspdacMiniLCD.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            uiconf.sections[0].content[0].value = self.config.get('lcd_active');
            uiconf.sections[0].content[1].value = self.getBootSplashEnabled();
            uiconf.sections[0].content[2].value = self.config.get('sleep_after');

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
};

/* Configuration Methods */

raspdacMiniLCD.prototype.updateLCDConfig = function(data) {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('[RaspDacMini LCD] Updating configuration');

    self.config.set('lcd_active', data['lcd_active']);
    self.config.set('boot_splash', data['boot_splash']);
    self.config.set('sleep_after', data['sleep_after']);

    self.updateServiceEnvironment()
        .then(function() {
            if (self.needsDisplay()) {
                return self.ensureOverlayLoaded()
                    .then(function() {
                        return self.waitForFramebuffer(15, 1000);
                    });
            }
            return libQ.resolve();
        })
        .then(function() {
            return self.syncPluginServices(true);
        })
        .then(function() {
            self.commandRouter.pushToastMessage('success', 'RaspDacMini LCD', 'Configuration saved and services updated');
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

    self.ensureOverlayLoaded()
        .then(function() {
            return self.waitForFramebuffer(15, 1000);
        })
        .then(function() {
            self.commandRouter.pushToastMessage('info', 'RaspDacMini LCD', 'Restarting display service...');
            return self.systemctl('restart', 'rdmlcd.service');
        })
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

raspdacMiniLCD.prototype.needsDisplay = function() {
    return this.config.get('lcd_active') || this.getBootSplashEnabled();
};

raspdacMiniLCD.prototype.ensureOverlayLoaded = function() {
    var self = this;
    var defer = libQ.defer();

    if (self.checkFramebuffer()) {
        defer.resolve();
        return defer.promise;
    }

    self.logger.info('[RaspDacMini LCD] Framebuffer missing, loading device tree overlay');

    exec('/usr/bin/sudo /usr/local/bin/rdmlcd-overlay.sh load', {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        if (stdout) {
            self.logger.info('[RaspDacMini LCD] ' + stdout.trim());
        }
        if (error) {
            self.logger.error('[RaspDacMini LCD] Failed to load overlay: ' + (stderr || error));
            defer.reject(new Error('Failed to load LCD device tree overlay'));
        } else {
            defer.resolve();
        }
    });

    return defer.promise;
};

raspdacMiniLCD.prototype.getBootSplashEnabled = function() {
    var value = this.config.get('boot_splash');
    if (value === undefined || value === null) {
        return true;
    }
    return value === true || value === 'true' || value === 1;
};

raspdacMiniLCD.prototype.syncPluginServices = function(pluginEnabled) {
    var self = this;
    var defer = libQ.defer();

    var command;
    if (!pluginEnabled) {
        command = '/usr/bin/sudo /usr/local/bin/rdmlcd-plugin-services.sh disable-all';
    } else {
        var bootSplash = self.getBootSplashEnabled() ? '1' : '0';
        var lcdActive = self.config.get('lcd_active') ? '1' : '0';
        command = '/usr/bin/sudo /usr/local/bin/rdmlcd-plugin-services.sh sync ' + bootSplash + ' ' + lcdActive;
    }

    exec(command, {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        if (error) {
            self.logger.error('[RaspDacMini LCD] syncPluginServices failed: ' + error);
            defer.reject(error);
        } else {
            if (stdout) {
                self.logger.info('[RaspDacMini LCD] ' + stdout.trim());
            }
            defer.resolve();
        }
    });

    return defer.promise;
};

raspdacMiniLCD.prototype.checkFramebuffer = function() {
    var self = this;

    try {
        var fbExists = fs.existsSync('/dev/fb1');
        if (fbExists) {
            self.logger.info('[RaspDacMini LCD] Framebuffer /dev/fb1 detected');
            return true;
        }
        self.logger.error('[RaspDacMini LCD] Framebuffer /dev/fb1 not found');
        return false;
    } catch (error) {
        self.logger.error('[RaspDacMini LCD] Error checking framebuffer: ' + error);
        return false;
    }
};

raspdacMiniLCD.prototype.waitForFramebuffer = function(retries, delay) {
    var self = this;
    var defer = libQ.defer();
    var attempt = 0;

    function tryCheck() {
        attempt++;
        if (self.checkFramebuffer()) {
            defer.resolve();
            return;
        }
        if (attempt >= retries) {
            defer.reject(new Error('Framebuffer /dev/fb1 not found'));
            return;
        }
        setTimeout(tryCheck, delay);
    }

    tryCheck();
    return defer.promise;
};

raspdacMiniLCD.prototype.updateServiceEnvironment = function() {
    var self = this;
    var defer = libQ.defer();

    var sleep_after = parseInt(self.config.get('sleep_after'), 10);
    if (isNaN(sleep_after) || sleep_after < 0) {
        sleep_after = 900;
    }

    self.logger.info('[RaspDacMini LCD] Updating service environment: SLEEP_AFTER=' + sleep_after);

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
