'use strict';

/**
 * GPIO Button LED Plugin for Volumio 4
 * 
 * Mimics Audiophonics MCU behavior without external microcontroller.
 * Uses kernel gpio-shutdown overlay for button (works in halt state).
 * Software-controlled dual-pin LED with configurable polarity.
 */

var libQ = require('kew');
var fs = require('fs-extra');
var gpiox = require('@iiot2k/gpiox');
var exec = require('child_process').exec;

var USERCONFIG_PATH = '/boot/userconfig.txt';
var BLINK_SLOW = 500;     // Boot: 500ms period
var BLINK_FAST = 100;     // Shutdown: 100ms period

module.exports = GPIOButtonLED;

function GPIOButtonLED(context) {
    var self = this;
    
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    
    // GPIO state
    self.ledPosPin = null;
    self.ledNegPin = null;
    self.ledPolarity = 'normal';
    self.initializedPins = [];
    
    // Blink control
    self.blinkInterval = null;
    self.blinkState = false;
    
    // Flags
    self.shutdownInProgress = false;
    self.rebootRequired = false;
}

GPIOButtonLED.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    self.config = new (require('v-conf'))();
    self.config.loadFile(configFile);
    
    return libQ.resolve();
};

GPIOButtonLED.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

GPIOButtonLED.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('GPIOButtonLED: Starting plugin');
    
    // Sync dtoverlay with config
    self.syncDtoverlay()
        .then(function() {
            // Initialize LED
            self.initLed();
            
            // Start with slow blink
            self.setLedBlink(false);
            
            // After 2 seconds, go solid
            setTimeout(function() {
                if (!self.shutdownInProgress) {
                    self.setLedSolid(true);
                    self.logger.info('GPIOButtonLED: Boot complete - LED solid');
                }
            }, 2000);
            
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('GPIOButtonLED: Start failed: ' + err);
            defer.reject(err);
        });
    
    return defer.promise;
};

GPIOButtonLED.prototype.onStop = function() {
    var self = this;
    
    self.logger.info('GPIOButtonLED: Stopping plugin');
    self.stopBlink();
    self.clearGPIOs();
    
    return libQ.resolve();
};

// ============================================================
// LED CONTROL
// ============================================================

GPIOButtonLED.prototype.initLed = function() {
    var self = this;
    
    var posPin = self.config.get('led_pos_pin');
    var negPin = self.config.get('led_neg_pin');
    self.ledPolarity = self.config.get('led_polarity') || 'normal';
    
    // Initialize LED+ pin
    if (posPin && posPin > 0) {
        self.ledPosPin = parseInt(posPin, 10);
        try {
            gpiox.init_gpio(self.ledPosPin, gpiox.GPIO_MODE_OUTPUT, 0);
            self.initializedPins.push(self.ledPosPin);
            self.logger.info('GPIOButtonLED: LED+ on GPIO ' + self.ledPosPin);
        } catch (err) {
            self.logger.error('GPIOButtonLED: LED+ init failed: ' + err.message);
            self.ledPosPin = null;
        }
    }
    
    // Initialize LED- pin
    if (negPin && negPin > 0) {
        self.ledNegPin = parseInt(negPin, 10);
        try {
            gpiox.init_gpio(self.ledNegPin, gpiox.GPIO_MODE_OUTPUT, 0);
            self.initializedPins.push(self.ledNegPin);
            self.logger.info('GPIOButtonLED: LED- on GPIO ' + self.ledNegPin);
        } catch (err) {
            self.logger.error('GPIOButtonLED: LED- init failed: ' + err.message);
            self.ledNegPin = null;
        }
    }
    
    self.logger.info('GPIOButtonLED: LED polarity = ' + self.ledPolarity);
};

GPIOButtonLED.prototype.setLedState = function(on) {
    var self = this;
    
    if (self.ledPosPin === null && self.ledNegPin === null) return;
    
    var posState, negState;
    
    if (on) {
        if (self.ledPolarity === 'normal') {
            posState = 1;  // LED+  = HIGH
            negState = 0;  // LED-  = LOW
        } else {
            posState = 0;  // LED+  = LOW (reversed)
            negState = 1;  // LED-  = HIGH (reversed)
        }
    } else {
        posState = 0;
        negState = 0;
    }
    
    try {
        if (self.ledPosPin !== null) gpiox.set_gpio(self.ledPosPin, posState);
        if (self.ledNegPin !== null) gpiox.set_gpio(self.ledNegPin, negState);
    } catch (err) {
        self.logger.error('GPIOButtonLED: LED set error: ' + err.message);
    }
};

GPIOButtonLED.prototype.setLedSolid = function(on) {
    var self = this;
    self.stopBlink();
    self.setLedState(on);
};

GPIOButtonLED.prototype.setLedBlink = function(fast) {
    var self = this;
    
    self.stopBlink();
    
    var period = fast ? BLINK_FAST : BLINK_SLOW;
    self.blinkState = false;
    
    self.blinkInterval = setInterval(function() {
        self.blinkState = !self.blinkState;
        self.setLedState(self.blinkState);
    }, period);
    
    self.logger.info('GPIOButtonLED: LED blink ' + (fast ? 'fast' : 'slow'));
};

GPIOButtonLED.prototype.stopBlink = function() {
    var self = this;
    
    if (self.blinkInterval) {
        clearInterval(self.blinkInterval);
        self.blinkInterval = null;
    }
};

GPIOButtonLED.prototype.clearGPIOs = function() {
    var self = this;
    
    self.stopBlink();
    
    self.initializedPins.forEach(function(pin) {
        try {
            gpiox.deinit_gpio(pin);
            self.logger.info('GPIOButtonLED: Released GPIO ' + pin);
        } catch (err) {
            self.logger.error('GPIOButtonLED: Error releasing GPIO ' + pin);
        }
    });
    
    self.initializedPins = [];
    self.ledPosPin = null;
    self.ledNegPin = null;
};

// ============================================================
// DTOVERLAY MANAGEMENT
// ============================================================

GPIOButtonLED.prototype.syncDtoverlay = function() {
    var self = this;
    var defer = libQ.defer();
    
    var buttonPin = self.config.get('button_pin');
    var buttonType = self.config.get('button_type') || 'NO';
    var buttonDebounce = self.config.get('button_debounce') || 100;
    
    self.readUserconfig()
        .then(function(content) {
            var currentOverlay = self.parseDtoverlay(content);
            var desiredOverlay = self.buildDtoverlay(buttonPin, buttonType, buttonDebounce);
            
            if (currentOverlay !== desiredOverlay) {
                self.logger.info('GPIOButtonLED: Updating dtoverlay');
                return self.updateUserconfig(content, desiredOverlay);
            } else {
                self.logger.info('GPIOButtonLED: dtoverlay already correct');
                return libQ.resolve();
            }
        })
        .then(function() {
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('GPIOButtonLED: dtoverlay sync failed: ' + err);
            defer.resolve(); // Continue anyway
        });
    
    return defer.promise;
};

GPIOButtonLED.prototype.readUserconfig = function() {
    var self = this;
    var defer = libQ.defer();
    
    fs.readFile(USERCONFIG_PATH, 'utf8', function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                defer.resolve('');  // File doesn't exist, start fresh
            } else {
                defer.reject(err);
            }
        } else {
            defer.resolve(data);
        }
    });
    
    return defer.promise;
};

GPIOButtonLED.prototype.parseDtoverlay = function(content) {
    // Extract existing gpio-shutdown line
    var match = content.match(/^dtoverlay=gpio-shutdown.*$/m);
    return match ? match[0] : null;
};

GPIOButtonLED.prototype.buildDtoverlay = function(pin, type, debounce) {
    if (!pin || pin <= 0) {
        return null;  // Button disabled
    }
    
    // NO: active_low=1 (pressed = LOW)
    // NC: active_low=0 (pressed = HIGH, because NC opens on press)
    var activeLow = (type === 'NO') ? 1 : 0;
    
    // Debounce in milliseconds (default 100ms)
    var debounceMs = debounce || 100;
    
    return 'dtoverlay=gpio-shutdown,gpio_pin=' + pin + ',active_low=' + activeLow + ',gpio_pull=up,debounce=' + debounceMs;
};

GPIOButtonLED.prototype.updateUserconfig = function(content, newOverlay) {
    var self = this;
    var defer = libQ.defer();
    
    var lines = content.split('\n');
    var found = false;
    var newLines = [];
    
    // Process existing lines
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.match(/^dtoverlay=gpio-shutdown/)) {
            found = true;
            if (newOverlay) {
                newLines.push(newOverlay);
            }
            // else: remove line (button disabled)
        } else {
            newLines.push(line);
        }
    }
    
    // Add new overlay if not found and enabled
    if (!found && newOverlay) {
        newLines.push(newOverlay);
    }
    
    // Remove trailing empty lines, ensure single newline at end
    while (newLines.length > 0 && newLines[newLines.length - 1].trim() === '') {
        newLines.pop();
    }
    
    var newContent = newLines.join('\n');
    if (newContent.length > 0) {
        newContent += '\n';
    }
    
    fs.writeFile(USERCONFIG_PATH, newContent, 'utf8', function(err) {
        if (err) {
            defer.reject(err);
        } else {
            self.rebootRequired = true;
            self.logger.info('GPIOButtonLED: userconfig.txt updated');
            defer.resolve();
        }
    });
    
    return defer.promise;
};

// ============================================================
// VOLUMIO HOOKS
// ============================================================

GPIOButtonLED.prototype.onVolumioShutdown = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('GPIOButtonLED: Shutdown detected');
    self.shutdownInProgress = true;
    
    // Fast blink during shutdown
    self.setLedBlink(true);
    
    // After 3 seconds, turn off
    setTimeout(function() {
        self.setLedSolid(false);
        self.logger.info('GPIOButtonLED: LED off');
        defer.resolve();
    }, 3000);
    
    return defer.promise;
};

GPIOButtonLED.prototype.onVolumioReboot = function() {
    var self = this;
    
    self.logger.info('GPIOButtonLED: Reboot detected');
    self.shutdownInProgress = true;
    
    // Fast blink during reboot
    self.setLedBlink(true);
    
    return libQ.resolve();
};

// ============================================================
// CONFIGURATION UI
// ============================================================

GPIOButtonLED.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // Button settings
        uiconf.sections[0].content[0].value = self.config.get('button_pin');
        
        var buttonType = self.config.get('button_type') || 'NO';
        uiconf.sections[0].content[1].value.value = buttonType;
        uiconf.sections[0].content[1].value.label = buttonType;
        
        uiconf.sections[0].content[2].value = self.config.get('button_debounce') || 100;
        
        // LED settings
        uiconf.sections[1].content[0].value = self.config.get('led_pos_pin');
        uiconf.sections[1].content[1].value = self.config.get('led_neg_pin');
        
        var ledPolarity = self.config.get('led_polarity') || 'normal';
        uiconf.sections[1].content[2].value.value = ledPolarity;
        uiconf.sections[1].content[2].value.label = ledPolarity === 'normal' ? 'Normal' : 'Reversed';
        
        defer.resolve(uiconf);
    })
    .fail(function() {
        defer.reject(new Error());
    });
    
    return defer.promise;
};

GPIOButtonLED.prototype.saveButtonConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    var oldPin = self.config.get('button_pin');
    var oldType = self.config.get('button_type');
    var oldDebounce = self.config.get('button_debounce');
    var newPin = parseInt(data['button_pin'], 10) || 0;
    var newType = data['button_type'].value;
    var newDebounce = parseInt(data['button_debounce'], 10) || 100;
    
    self.config.set('button_pin', newPin);
    self.config.set('button_type', newType);
    self.config.set('button_debounce', newDebounce);
    
    var buttonChanged = (oldPin !== newPin || oldType !== newType || oldDebounce !== newDebounce);
    
    if (buttonChanged) {
        self.syncDtoverlay()
            .then(function() {
                self.commandRouter.pushToastMessage('warning', 'GPIO Button LED', 
                    'Button configuration saved. Reboot required.');
                defer.resolve();
            });
    } else {
        self.commandRouter.pushToastMessage('info', 'GPIO Button LED', 'No changes detected.');
        defer.resolve();
    }
    
    return defer.promise;
};

GPIOButtonLED.prototype.saveLedConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    // Clear current LED
    self.clearGPIOs();
    
    // Save new config
    self.config.set('led_pos_pin', parseInt(data['led_pos_pin'], 10) || 0);
    self.config.set('led_neg_pin', parseInt(data['led_neg_pin'], 10) || 0);
    self.config.set('led_polarity', data['led_polarity'].value);
    
    // Reinitialize LED
    self.initLed();
    self.setLedSolid(true);
    
    self.commandRouter.pushToastMessage('success', 'GPIO Button LED', 'LED configuration saved.');
    defer.resolve();
    
    return defer.promise;
};

// ============================================================
// REQUIRED STUBS
// ============================================================

GPIOButtonLED.prototype.onRestart = function() {};
GPIOButtonLED.prototype.onInstall = function() {};
GPIOButtonLED.prototype.onUninstall = function() { this.clearGPIOs(); };
GPIOButtonLED.prototype.getConf = function(varName) { return this.config.get(varName); };
GPIOButtonLED.prototype.setConf = function(varName, varValue) { this.config.set(varName, varValue); };
GPIOButtonLED.prototype.getAdditionalConf = function() {};
GPIOButtonLED.prototype.setAdditionalConf = function() {};
GPIOButtonLED.prototype.setUIConfig = function() {};
