'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var gpiox = require('@iiot2k/gpiox');

// Debounce time in microseconds
var DEBOUNCE_US = 10000;

module.exports = ControllerAudiophonicsOnOff;

function ControllerAudiophonicsOnOff(context) {
    var self = this;
    
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    
    // GPIO pin numbers (will be set from config)
    self.softShutdownPin = null;
    self.shutdownButtonPin = null;
    self.bootOkPin = null;
    
    // Track initialized pins for cleanup
    self.initializedPins = [];
    
    // Flag to indicate shutdown in progress
    self.shutdownInProgress = false;
}

ControllerAudiophonicsOnOff.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    self.config = new (require('v-conf'))();
    self.config.loadFile(configFile);
    
    return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

ControllerAudiophonicsOnOff.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('AudiophonicsOnOff: Starting plugin');
    self.logger.info('AudiophonicsOnOff: Configuring GPIO pins');
    
    // Initialize soft shutdown output pin (active HIGH signal to hardware)
    var softShutdownConfig = self.tryParse(self.config.get('soft_shutdown'), 0);
    if (softShutdownConfig !== 0) {
        self.softShutdownPin = softShutdownConfig;
        try {
            // Initialize as output, initial state LOW
            gpiox.init_gpio(self.softShutdownPin, gpiox.GPIO_MODE_OUTPUT, 0);
            self.initializedPins.push(self.softShutdownPin);
            self.logger.info('AudiophonicsOnOff: Soft shutdown GPIO ' + self.softShutdownPin + ' initialized');
        } catch (err) {
            self.logger.error('AudiophonicsOnOff: Failed to initialize soft shutdown GPIO: ' + err.message);
            self.softShutdownPin = null;
        }
    }
    
    // Initialize boot OK output pin (active HIGH signal to hardware)
    var bootOkConfig = self.tryParse(self.config.get('boot_ok'), 0);
    if (bootOkConfig !== 0) {
        self.bootOkPin = bootOkConfig;
        try {
            // Initialize as output, set HIGH immediately to signal boot complete
            gpiox.init_gpio(self.bootOkPin, gpiox.GPIO_MODE_OUTPUT, 1);
            self.initializedPins.push(self.bootOkPin);
            self.logger.info('AudiophonicsOnOff: Boot OK GPIO ' + self.bootOkPin + ' set HIGH');
        } catch (err) {
            self.logger.error('AudiophonicsOnOff: Failed to initialize boot OK GPIO: ' + err.message);
            self.bootOkPin = null;
        }
    }
    
    // Initialize shutdown button input pin
    // Audiophonics hardware uses ACTIVE HIGH with PULL-DOWN
    // Button press connects GPIO to 3.3V, triggering RISING edge
    var shutdownButtonConfig = self.tryParse(self.config.get('shutdown_button'), 0);
    if (shutdownButtonConfig !== 0) {
        self.shutdownButtonPin = shutdownButtonConfig;
        try {
            gpiox.watch_gpio(
                self.shutdownButtonPin,
                gpiox.GPIO_MODE_INPUT_PULLDOWN,  // Pull-down: idle=LOW, pressed=HIGH
                DEBOUNCE_US,
                gpiox.GPIO_EDGE_RISING,          // Detect LOW->HIGH (button press)
                function(state, edge) {
                    self.logger.info('AudiophonicsOnOff: Button event - state=' + state + ', edge=' + edge);
                    if (state === 1) {  // HIGH = button pressed
                        self.hardShutdownRequest();
                    }
                }
            );
            self.initializedPins.push(self.shutdownButtonPin);
            self.logger.info('AudiophonicsOnOff: Shutdown button GPIO ' + self.shutdownButtonPin + ' watching (PULLDOWN, RISING edge)');
        } catch (err) {
            self.logger.error('AudiophonicsOnOff: Failed to initialize shutdown button GPIO: ' + err.message);
            self.shutdownButtonPin = null;
        }
    }
    
    self.logger.info('AudiophonicsOnOff: Plugin started successfully');
    defer.resolve();
    
    return defer.promise;
};

ControllerAudiophonicsOnOff.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('AudiophonicsOnOff: Stopping plugin');
    self.clearGPIOs();
    defer.resolve();
    
    return defer.promise;
};

ControllerAudiophonicsOnOff.prototype.onRestart = function() {
    var self = this;
    self.logger.info('AudiophonicsOnOff: Restarting plugin');
};

ControllerAudiophonicsOnOff.prototype.onInstall = function() {
    var self = this;
    self.logger.info('AudiophonicsOnOff: Plugin installed');
};

ControllerAudiophonicsOnOff.prototype.onUninstall = function() {
    var self = this;
    self.logger.info('AudiophonicsOnOff: Plugin uninstalled');
    self.clearGPIOs();
};

ControllerAudiophonicsOnOff.prototype.getConf = function(varName) {
    var self = this;
    return self.config.get(varName);
};

ControllerAudiophonicsOnOff.prototype.setConf = function(varName, varValue) {
    var self = this;
    self.config.set(varName, varValue);
};

ControllerAudiophonicsOnOff.prototype.getAdditionalConf = function(type, controller, data) {
    var self = this;
};

ControllerAudiophonicsOnOff.prototype.setAdditionalConf = function() {
    var self = this;
};

// Configuration UI
ControllerAudiophonicsOnOff.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // GPIO configuration
        uiconf.sections[0].content[0].value = self.config.get('soft_shutdown');
        uiconf.sections[0].content[1].value = self.config.get('shutdown_button');
        uiconf.sections[0].content[2].value = self.config.get('boot_ok');
        
        defer.resolve(uiconf);
    })
    .fail(function() {
        defer.reject(new Error());
    });
    
    return defer.promise;
};

ControllerAudiophonicsOnOff.prototype.setUIConfig = function(data) {
    var self = this;
};

ControllerAudiophonicsOnOff.prototype.updateButtonConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('AudiophonicsOnOff: Saving configuration');
    
    // Clear existing GPIO configuration
    self.clearGPIOs();
    
    // Save new configuration
    self.config.set('soft_shutdown', data['soft_shutdown']);
    self.config.set('shutdown_button', data['shutdown_button']);
    self.config.set('boot_ok', data['boot_ok']);
    
    // Reinitialize with new settings
    self.onStart()
        .then(function() {
            self.commandRouter.pushToastMessage('success', 'Audiophonics', 'Configuration saved');
            defer.resolve();
        })
        .fail(function(err) {
            self.commandRouter.pushToastMessage('error', 'Audiophonics', 'Failed to apply configuration');
            defer.reject(err);
        });
    
    return defer.promise;
};

// GPIO cleanup
ControllerAudiophonicsOnOff.prototype.clearGPIOs = function() {
    var self = this;
    
    self.initializedPins.forEach(function(pin) {
        // During shutdown, keep soft_shutdown pin active
        if (self.shutdownInProgress && pin === self.softShutdownPin) {
            self.logger.info('AudiophonicsOnOff: Keeping soft shutdown GPIO ' + pin + ' active during shutdown');
            return;
        }
        try {
            gpiox.deinit_gpio(pin);
            self.logger.info('AudiophonicsOnOff: Released GPIO ' + pin);
        } catch (err) {
            self.logger.error('AudiophonicsOnOff: Error releasing GPIO ' + pin + ': ' + err.message);
        }
    });
    
    if (!self.shutdownInProgress) {
        self.initializedPins = [];
        self.softShutdownPin = null;
    }
    self.shutdownButtonPin = null;
    self.bootOkPin = null;
};

// Shutdown handlers
ControllerAudiophonicsOnOff.prototype.hardShutdownRequest = function() {
    var self = this;
    self.logger.info('AudiophonicsOnOff: Hardware shutdown button pressed - initiating shutdown');
    self.commandRouter.shutdown();
};

// Called by Volumio when shutdown is triggered (software or hardware)
ControllerAudiophonicsOnOff.prototype.onVolumioShutdown = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('AudiophonicsOnOff: Volumio shutdown detected');
    self.shutdownInProgress = true;
    
    // Signal to hardware that software shutdown is in progress
    // Send pulse: HIGH for 1 second, then LOW (matches original behavior)
    if (self.softShutdownPin !== null) {
        try {
            gpiox.set_gpio(self.softShutdownPin, 1);
            self.logger.info('AudiophonicsOnOff: Soft shutdown pulse HIGH on GPIO ' + self.softShutdownPin);
            
            setTimeout(function() {
                try {
                    gpiox.set_gpio(self.softShutdownPin, 0);
                    self.logger.info('AudiophonicsOnOff: Soft shutdown pulse LOW on GPIO ' + self.softShutdownPin);
                } catch (err) {
                    self.logger.error('AudiophonicsOnOff: Failed to complete soft shutdown pulse: ' + err.message);
                }
                defer.resolve();
            }, 1000);
        } catch (err) {
            self.logger.error('AudiophonicsOnOff: Failed to send soft shutdown signal: ' + err.message);
            defer.resolve();
        }
    } else {
        defer.resolve();
    }
    
    return defer.promise;
};

// Called by Volumio when reboot is triggered
ControllerAudiophonicsOnOff.prototype.onVolumioReboot = function() {
    var self = this;
    
    self.logger.info('AudiophonicsOnOff: Volumio reboot detected');
    
    // Signal to hardware that reboot is in progress (just HIGH, no pulse)
    if (self.softShutdownPin !== null) {
        try {
            gpiox.set_gpio(self.softShutdownPin, 1);
            self.logger.info('AudiophonicsOnOff: Reboot signal HIGH on GPIO ' + self.softShutdownPin);
        } catch (err) {
            self.logger.error('AudiophonicsOnOff: Failed to send reboot signal: ' + err.message);
        }
    }
    
    return libQ.resolve();
};

// Utility function to safely parse integers
ControllerAudiophonicsOnOff.prototype.tryParse = function(str, defaultValue) {
    var retValue = defaultValue;
    if (str !== null && str !== undefined) {
        if (typeof str === 'number') {
            retValue = str;
        } else if (typeof str === 'string' && str.length > 0) {
            if (!isNaN(str)) {
                retValue = parseInt(str, 10);
            }
        }
    }
    return retValue;
};
