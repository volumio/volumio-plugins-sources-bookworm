'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

module.exports = alloRelayAttenuator;

function alloRelayAttenuator(context) {
    var self = this;
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
}

alloRelayAttenuator.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

alloRelayAttenuator.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('Allo Relay Attenuator: Starting plugin');

    // Load i18n strings
    self.loadI18n();

    // Update service file based on IR config, then start daemon
    self.updateServiceFile()
        .then(function() {
            return self.startDaemon();
        })
        .then(function() {
            // Register volume scripts with Volumio
            self.addVolumeScripts();

            // Apply startup settings
            self.applyStartupSettings();

            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('Allo Relay Attenuator: Failed to start - ' + err);
            defer.reject(err);
        });

    return defer.promise;
};

alloRelayAttenuator.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('Allo Relay Attenuator: Stopping plugin');

    // Save current volume for "Remember Last" feature
    self.saveCurrentVolume();

    self.removeVolumeScripts();
    self.stopDaemon()
        .then(function() {
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('Allo Relay Attenuator: Error stopping - ' + err);
            defer.resolve(); // Resolve anyway to not block shutdown
        });

    return defer.promise;
};

alloRelayAttenuator.prototype.onRestart = function() {
    var self = this;
    self.stopDaemon();
    setTimeout(function() {
        self.startDaemon();
    }, 1000);
};

alloRelayAttenuator.prototype.rebootSystem = function() {
    var self = this;
    self.commandRouter.pushToastMessage('info', 'Allo Relay Attenuator', 'Rebooting system...');
    return self.commandRouter.reboot();
};

alloRelayAttenuator.prototype.initRebootCountdown = function() {
    var self = this;
    var seconds = 15;
    
    // Show initial modal with cancel button
    self.showRebootModal(seconds);
    
    self.rebootTimer = setInterval(function() {
        seconds = seconds - 1;
        if (seconds > 0) {
            self.showRebootModal(seconds);
        } else {
            clearInterval(self.rebootTimer);
            self.rebootTimer = null;
            self.commandRouter.closeModals();
            self.commandRouter.reboot();
        }
    }, 1000);
};

alloRelayAttenuator.prototype.showRebootModal = function(seconds) {
    var self = this;
    var modalData = {
        title: self.getI18n('REBOOT_REQUIRED'),
        message: self.getI18n('REBOOT_MESSAGE') + ' ' + seconds + ' ' + self.getI18n('SECONDS'),
        size: 'lg',
        buttons: [
            {
                name: self.commandRouter.getI18nString('COMMON.CANCEL'),
                class: 'btn btn-warning',
                emit: 'callMethod',
                payload: {
                    'endpoint': 'system_hardware/allo_relay_attenuator',
                    'method': 'cancelReboot',
                    'data': ''
                }
            }
        ]
    };
    self.commandRouter.broadcastMessage('openModal', modalData);
};

alloRelayAttenuator.prototype.cancelReboot = function() {
    var self = this;
    if (self.rebootTimer) {
        clearInterval(self.rebootTimer);
        self.rebootTimer = null;
    }
    self.commandRouter.closeModals();
    self.commandRouter.pushToastMessage('info', 'Allo Relay Attenuator', self.getI18n('REBOOT_CANCELLED'));
};

alloRelayAttenuator.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

alloRelayAttenuator.prototype.loadI18n = function() {
    var self = this;
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    
    try {
        var langFile = __dirname + '/i18n/strings_' + lang_code + '.json';
        if (fs.existsSync(langFile)) {
            self.i18nStrings = fs.readJsonSync(langFile);
        } else {
            self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
        }
    } catch (e) {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }
};

alloRelayAttenuator.prototype.getI18n = function(key) {
    var self = this;
    if (self.i18nStrings && self.i18nStrings.ALLO_RELAY_ATTENUATOR && self.i18nStrings.ALLO_RELAY_ATTENUATOR[key]) {
        return self.i18nStrings.ALLO_RELAY_ATTENUATOR[key];
    }
    return key;
};

// ============================================================================
// UI Configuration
// ============================================================================

alloRelayAttenuator.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // Volume settings
        uiconf.sections[0].content[0].value = self.config.get('map_to_100', false);

        var startupVol = self.config.get('startup_volume', 'remember');
        uiconf.sections[0].content[1].value.value = startupVol;
        uiconf.sections[0].content[1].value.label = self.getStartupVolumeLabel(startupVol);

        uiconf.sections[0].content[2].value = self.config.get('mute_on_startup', false);

        // IR settings
        uiconf.sections[1].content[0].value = self.config.get('ir_enabled', false);

        var irSource = self.config.get('ir_source', 'gpio');
        uiconf.sections[1].content[1].value.value = irSource;
        uiconf.sections[1].content[1].value.label = self.getIRSourceLabel(irSource);

        var irPin = self.config.get('ir_gpio_pin', 17).toString();
        uiconf.sections[1].content[2].value.value = irPin;
        uiconf.sections[1].content[2].value.label = self.getGPIOPinLabel(irPin);

        // Hardware buttons and Resources sections use static values from UIConfig.json

        defer.resolve(uiconf);
    })
    .fail(function(err) {
        self.logger.error('Allo Relay Attenuator: Failed to load UI config - ' + err);
        defer.reject(new Error());
    });

    return defer.promise;
};

alloRelayAttenuator.prototype.getStartupVolumeLabel = function(value) {
    var labels = {
        'remember': 'Remember Last',
        '0': '0 (Quietest)',
        '16': '16 (Low)',
        '31': '31 (Medium)',
        '48': '48 (High)',
        '63': '63 (Maximum)'
    };
    return labels[value] || value;
};

alloRelayAttenuator.prototype.getIRSourceLabel = function(value) {
    var labels = {
        'gpio': 'GPIO (Onboard/DAC)',
        'usb': 'USB IR Dongle',
        'disabled': 'Disabled'
    };
    return labels[value] || value;
};

alloRelayAttenuator.prototype.getGPIOPinLabel = function(value) {
    if (value === '17') {
        return 'GPIO 17 (Default - via Piano DAC)';
    }
    if (value === '5') {
        return 'GPIO 5 (Direct wiring)';
    }
    return 'GPIO ' + value;
};

alloRelayAttenuator.prototype.saveVolumeSettings = function(data) {
    var self = this;
    var defer = libQ.defer();

    self.config.set('map_to_100', data['map_to_100']);
    self.config.set('startup_volume', data['startup_volume'].value);
    self.config.set('mute_on_startup', data['mute_on_startup']);

    self.addVolumeScripts();

    self.commandRouter.pushToastMessage('success', 'Allo Relay Attenuator', self.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
    defer.resolve({});

    return defer.promise;
};

alloRelayAttenuator.prototype.saveIRSettings = function(data) {
    var self = this;
    var defer = libQ.defer();

    var irEnabled = data['ir_enabled'];
    var irSource = data['ir_source'] ? data['ir_source'].value : 'gpio';
    var irPin = data['ir_gpio_pin'] ? data['ir_gpio_pin'].value : '17';

    // Check if IR setting actually changed
    var previousIrEnabled = self.config.get('ir_enabled', false);
    var previousIrPin = self.config.get('ir_gpio_pin', 17);
    var irSettingChanged = (irEnabled !== previousIrEnabled) || (parseInt(irPin) !== previousIrPin);

    self.config.set('ir_enabled', irEnabled);
    self.config.set('ir_source', irSource);
    self.config.set('ir_gpio_pin', parseInt(irPin));

    self.commandRouter.pushToastMessage('info', 'Allo Relay Attenuator', 'Applying settings...');

    // Stop daemon, update service file, configure IR, then restart
    self.stopDaemon()
        .then(function() {
            return self.updateServiceFile();
        })
        .then(function() {
            return self.configureIR();
        })
        .then(function() {
            return self.startDaemon();
        })
        .then(function() {
            // If IR setting changed, reboot is required for gpio-ir overlay
            if (irSettingChanged) {
                self.initRebootCountdown();
                defer.resolve({});
            } else {
                self.commandRouter.pushToastMessage('success', 'Allo Relay Attenuator', self.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
                defer.resolve({});
            }
        })
        .fail(function(err) {
            self.logger.error('Allo Relay Attenuator: Failed to apply IR settings - ' + err);
            self.commandRouter.pushToastMessage('error', 'Allo Relay Attenuator', self.commandRouter.getI18nString('COMMON.SETTINGS_SAVE_ERROR'));
            defer.resolve({});
        });

    return defer.promise;
};

// ============================================================================
// Daemon Control
// ============================================================================

alloRelayAttenuator.prototype.startDaemon = function() {
    var self = this;
    var defer = libQ.defer();

    exec('/usr/bin/sudo /bin/systemctl start fn-rattenu.service', { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('Allo Relay Attenuator: Cannot start daemon - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('Allo Relay Attenuator: Daemon started');
                defer.resolve();
            }
        }
    );

    return defer.promise;
};

alloRelayAttenuator.prototype.updateServiceFile = function() {
    var self = this;
    var defer = libQ.defer();
    var fs = require('fs');

    var irEnabled = self.config.get('ir_enabled', false);
    // When IR enabled: full LIRC support with lircrc
    // When IR disabled: -l flag to run without LIRC
    var execLine = irEnabled 
        ? '/usr/bin/fn-rattenu -n fn-rattenu -c /etc/lirc/lircrc' 
        : '/usr/bin/fn-rattenu -l';

    var serviceContent = '[Unit]\n' +
        'Description=Allo Relay Attenuator Daemon\n' +
        'After=local-fs.target\n' +
        '\n' +
        '[Service]\n' +
        'Type=simple\n' +
        'ExecStart=' + execLine + '\n' +
        'Restart=on-failure\n' +
        'RestartSec=5\n' +
        'StandardOutput=journal\n' +
        'StandardError=journal\n' +
        'SyslogIdentifier=fn-rattenu\n' +
        'User=root\n' +
        'Group=root\n' +
        '\n' +
        '[Install]\n' +
        'WantedBy=multi-user.target\n';

    var tempPath = '/tmp/fn-rattenu.service';
    var servicePath = '/lib/systemd/system/fn-rattenu.service';

    // Write to temp file first (no sudo needed)
    try {
        fs.writeFileSync(tempPath, serviceContent);
    } catch (err) {
        self.logger.error('Allo Relay Attenuator: Failed to write temp service file - ' + err);
        defer.reject(err);
        return defer.promise;
    }

    // Copy temp file to systemd location using sudo cp
    exec('/usr/bin/sudo /bin/cp ' + tempPath + ' ' + servicePath, { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            // Clean up temp file
            try { fs.unlinkSync(tempPath); } catch (e) {}
            
            if (error !== null) {
                self.logger.error('Allo Relay Attenuator: Failed to copy service file - ' + error);
                defer.reject(error);
            } else {
                // Reload systemd
                exec('/usr/bin/sudo /bin/systemctl daemon-reload', { uid: 1000, gid: 1000 },
                    function(error2, stdout2, stderr2) {
                        if (error2 !== null) {
                            self.logger.error('Allo Relay Attenuator: Failed to reload systemd - ' + error2);
                            defer.reject(error2);
                        } else {
                            self.logger.info('Allo Relay Attenuator: Service file updated, IR ' + (irEnabled ? 'enabled' : 'disabled'));
                            defer.resolve();
                        }
                    }
                );
            }
        }
    );

    return defer.promise;
};

alloRelayAttenuator.prototype.stopDaemon = function() {
    var self = this;
    var defer = libQ.defer();

    exec('/usr/bin/sudo /bin/systemctl stop fn-rattenu.service', { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('Allo Relay Attenuator: Cannot stop daemon - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('Allo Relay Attenuator: Daemon stopped');
                defer.resolve();
            }
        }
    );

    return defer.promise;
};

alloRelayAttenuator.prototype.restartDaemon = function() {
    var self = this;
    var defer = libQ.defer();

    exec('/usr/bin/sudo /bin/systemctl restart fn-rattenu.service', { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('Allo Relay Attenuator: Cannot restart daemon - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('Allo Relay Attenuator: Daemon restarted');
                defer.resolve();
            }
        }
    );

    return defer.promise;
};

// ============================================================================
// Volume Scripts
// ============================================================================

alloRelayAttenuator.prototype.addVolumeScripts = function() {
    var self = this;
    var pluginDir = '/data/plugins/system_hardware/allo_relay_attenuator';

    var data = {
        enabled: true,
        setvolumescript: pluginDir + '/setvolume.sh',
        getvolumescript: pluginDir + '/getvolume.sh',
        setmutescript: pluginDir + '/setmute.sh',
        getmutescript: pluginDir + '/getmute.sh',
        minVol: 0,
        maxVol: 63,
        mapTo100: self.config.get('map_to_100', false)
    };

    self.logger.info('Allo Relay Attenuator: Registering volume scripts - ' + JSON.stringify(data));
    self.commandRouter.updateVolumeScripts(data);
};

alloRelayAttenuator.prototype.removeVolumeScripts = function() {
    var self = this;

    var data = {
        enabled: false,
        setvolumescript: '',
        getvolumescript: '',
        setmutescript: '',
        getmutescript: '',
        minVol: 0,
        maxVol: 100,
        mapTo100: false
    };

    self.commandRouter.updateVolumeScripts(data);
};

// ============================================================================
// Startup Settings
// ============================================================================

alloRelayAttenuator.prototype.saveCurrentVolume = function() {
    var self = this;

    try {
        var output = execSync('/usr/bin/sudo /usr/bin/fn-rattenuc -c GET_VOLUME', { encoding: 'utf8' });
        var vol = parseInt(output.trim());
        if (!isNaN(vol) && vol >= 0 && vol <= 63) {
            self.config.set('last_volume', vol);
            self.logger.info('Allo Relay Attenuator: Saved volume ' + vol + ' for Remember Last');
        }
    } catch (e) {
        self.logger.error('Allo Relay Attenuator: Failed to save current volume - ' + e);
    }
};

alloRelayAttenuator.prototype.applyStartupSettings = function() {
    var self = this;
    var startupVol = self.config.get('startup_volume', 'remember');
    var muteOnStartup = self.config.get('mute_on_startup', false);

    setTimeout(function() {
        var vol;

        if (startupVol !== 'remember') {
            // Use preset value
            vol = parseInt(startupVol);
        } else {
            // Remember Last - restore saved volume
            vol = self.config.get('last_volume', 31);
        }

        exec('/usr/bin/sudo /usr/bin/fn-rattenuc -c SET_VOLUME=' + vol, function(error, stdout, stderr) {
            if (error) {
                self.logger.error('Allo Relay Attenuator: Failed to set startup volume - ' + error);
            } else {
                self.logger.info('Allo Relay Attenuator: Startup volume set to ' + vol);
                // Sync Volumio UI with hardware volume
                self.commandRouter.volumioretrievevolume();
            }
        });

        // Apply mute on startup if enabled
        if (muteOnStartup) {
            exec('/usr/bin/sudo /usr/bin/fn-rattenuc -c SET_MUTE=1', function(error, stdout, stderr) {
                if (error) {
                    self.logger.error('Allo Relay Attenuator: Failed to mute on startup - ' + error);
                } else {
                    self.logger.info('Allo Relay Attenuator: Muted on startup');
                }
            });
        }
    }, 2000);
};

// ============================================================================
// IR Configuration
// ============================================================================

alloRelayAttenuator.prototype.configureIR = function() {
    var self = this;
    var defer = libQ.defer();

    var irEnabled = self.config.get('ir_enabled', false);
    var irSource = self.config.get('ir_source', 'gpio');
    var irPin = self.config.get('ir_gpio_pin', 17);

    if (!irEnabled || irSource === 'disabled') {
        // Disable LIRC
        exec('/usr/bin/sudo /bin/systemctl stop lircd.service', function(error, stdout, stderr) {
            self.logger.info('Allo Relay Attenuator: LIRC disabled');
            defer.resolve();
        });
    } else if (irSource === 'gpio') {
        // Configure GPIO IR
        self.configureGPIOIR(irPin)
            .then(function() {
                defer.resolve();
            })
            .fail(function(err) {
                defer.reject(err);
            });
    } else if (irSource === 'usb') {
        // Configure USB IR
        self.configureUSBIR()
            .then(function() {
                defer.resolve();
            })
            .fail(function(err) {
                defer.reject(err);
            });
    } else {
        defer.resolve();
    }

    return defer.promise;
};

alloRelayAttenuator.prototype.configureGPIOIR = function(pin) {
    var self = this;
    var defer = libQ.defer();

    // Update dtoverlay in userconfig.txt (survives OTA updates)
    var configFile = '/boot/userconfig.txt';
    var overlayLine = 'dtoverlay=gpio-ir,gpio_pin=' + pin;

    exec('/usr/bin/sudo sed -i "/^dtoverlay=gpio-ir/d" ' + configFile, function(error, stdout, stderr) {
        exec('echo "' + overlayLine + '" | /usr/bin/sudo tee -a ' + configFile, function(error, stdout, stderr) {
            if (error) {
                self.logger.error('Allo Relay Attenuator: Failed to configure GPIO IR - ' + error);
                defer.reject(error);
            } else {
                // Start LIRC
                exec('/usr/bin/sudo /bin/systemctl restart lircd.service', function(error, stdout, stderr) {
                    self.logger.info('Allo Relay Attenuator: GPIO IR configured on pin ' + pin);
                    defer.resolve();
                });
            }
        });
    });

    return defer.promise;
};

alloRelayAttenuator.prototype.configureUSBIR = function() {
    var self = this;
    var defer = libQ.defer();

    // For USB IR, just ensure LIRC is running with default driver
    exec('/usr/bin/sudo /bin/systemctl restart lircd.service', function(error, stdout, stderr) {
        if (error) {
            self.logger.error('Allo Relay Attenuator: Failed to start LIRC for USB IR - ' + error);
            defer.reject(error);
        } else {
            self.logger.info('Allo Relay Attenuator: USB IR configured');
            defer.resolve();
        }
    });

    return defer.promise;
};
