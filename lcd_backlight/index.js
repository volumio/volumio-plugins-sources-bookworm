'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var glob = require('glob');

module.exports = lcdBacklight;

function lcdBacklight(context) {
    var self = this;
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
    this.backlightPath = null;
}

lcdBacklight.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    
    // Find backlight path
    self.findBacklightPath();
    
    return libQ.resolve();
}

lcdBacklight.prototype.findBacklightPath = function() {
    var self = this;
    try {
        var paths = glob.sync('/sys/class/backlight/*');
        if (paths.length > 0) {
            self.backlightPath = paths[0];
            self.logger.info('[LCD Backlight] Found backlight at: ' + self.backlightPath);
        } else {
            self.logger.error('[LCD Backlight] No backlight device found');
        }
    } catch (e) {
        self.logger.error('[LCD Backlight] Error finding backlight: ' + e);
    }
}

lcdBacklight.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('[LCD Backlight] Starting plugin');
    
    // Set enabled to true when plugin starts
    self.config.set('enabled', true);
    self.logger.info('[LCD Backlight] Setting enabled to true');
    
    // Load i18n strings
    self.loadI18nStrings();
    
    // Write initial configuration
    self.writeConfigToSysfs()
        .then(function() {
            // Start service
            self.logger.info('[LCD Backlight] Starting backlight service');
            return self.startService();
        })
        .then(function() {
            // Wait for service to fully start
            return new Promise(function(resolve) {
                setTimeout(resolve, 1500);
            });
        })
        .then(function() {
            // Check and broadcast service status
            return self.getServiceStatus();
        })
        .then(function(isActive) {
            self.logger.info('[LCD Backlight] Service status: ' + (isActive ? 'active' : 'inactive'));
            
            // Broadcast status to UI
            self.commandRouter.broadcastMessage('pushPluginStatus', {
                plugin: 'lcd_backlight',
                category: 'system_hardware',
                status: isActive ? 'active' : 'inactive'
            });
            
            if (isActive) {
                self.commandRouter.pushToastMessage('success', 
                    self.getI18nString('PLUGIN_NAME'),
                    'Plugin started successfully');
            }
            
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[LCD Backlight] Start failed: ' + error);
            
            self.commandRouter.broadcastMessage('pushPluginStatus', {
                plugin: 'lcd_backlight',
                category: 'system_hardware',
                status: 'inactive'
            });
            
            defer.reject(error);
        });
    
    return defer.promise;
};

lcdBacklight.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('[LCD Backlight] Stopping plugin');
    
    // Set enabled to false when plugin stops
    self.config.set('enabled', false);
    self.logger.info('[LCD Backlight] Setting enabled to false');
    
    // Write lcd_enabled = 0 to config file
    self.writeDisabledFlag()
        .then(function() {
            // Stop service
            return self.stopService();
        })
        .then(function() {
            // Wait a moment
            return new Promise(function(resolve) {
                setTimeout(resolve, 500);
            });
        })
        .then(function() {
            // Notify Volumio about plugin state change
            self.logger.info('[LCD Backlight] Notifying Volumio about state change');
            self.commandRouter.pushToastMessage('info', 
                self.getI18nString('PLUGIN_NAME'),
                'Plugin stopped');
            
            // Force UI refresh
            self.commandRouter.broadcastMessage('pushPluginStatus', {
                plugin: 'lcd_backlight',
                category: 'system_hardware',
                status: 'inactive'
            });
            
            defer.resolve();
        })
        .fail(function(error) {
            self.logger.error('[LCD Backlight] Stop failed: ' + error);
            defer.resolve(); // Resolve anyway
        });
    
    return defer.promise;
};

lcdBacklight.prototype.onRestart = function() {
    var self = this;
    // Not needed
};

// Configuration Methods



lcdBacklight.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var lang_code = this.commandRouter.sharedVars.get('language_code');
    
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // All settings are now in uiconf.sections[0].content
        var content = uiconf.sections[0].content;
        
        // General Settings 
        content[0].value = self.config.get('int_time');       // int_time (new index 0)
        
        // Backlight Settings
        content[1].value = self.config.get('min_backlight');   // min_backlight (new index 1)
        content[2].value = self.config.get('max_backlight');   // max_backlight (new index 2)
        
        // Sensor Settings 
        content[3].value = self.config.get('lux_multiplier');  // lux_multiplier (new index 3)
        content[4].value = self.config.get('smoothing_factor'); // smoothing_factor (new index 4)
        
        defer.resolve(uiconf);
    })
    .fail(function() {
        defer.reject(new Error());
    });
    
    return defer.promise;
};

lcdBacklight.prototype.getConfigurationFiles = function() {
    return ['config.json'];
}


lcdBacklight.prototype.saveConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('[LCD Backlight] Saving configuration');
    self.logger.info('[LCD Backlight] Received data: ' + JSON.stringify(data));
    
    try {
        // Step 1: Save all received values to persistent configuration (config.json)
        self.config.set('enabled', true); // switch on enabled=true
        
        if (data.int_time !== undefined) {
            self.config.set('int_time', parseFloat(data.int_time));
        }
        if (data.min_backlight !== undefined) {
            self.config.set('min_backlight', parseInt(data.min_backlight));
        }
        if (data.max_backlight !== undefined) {
            self.config.set('max_backlight', parseInt(data.max_backlight));
        }
        if (data.lux_multiplier !== undefined) {
            self.config.set('lux_multiplier', parseFloat(data.lux_multiplier));
        }
        if (data.smoothing_factor !== undefined) {
            self.config.set('smoothing_factor', parseFloat(data.smoothing_factor));
        }
        
        self.logger.info('[LCD Backlight] Configuration saved to config.json.');
        
        // Step 2: Write data to /etc/lcd_backlight (calling an existing function)
        self.writeConfigToSysfs()
            .then(function() {
                // Step 3: Restart the service to apply the new settings
                self.logger.info('[LCD Backlight] Configuration written to files. Restarting service.');
                return self.stopService(); // first stop it
            })
            .then(function() {
                return new Promise(function(resolve) { setTimeout(resolve, 500); }); // short pause
            })
            .then(function() {
                return self.startService(); // after make start
            })
            .then(function() {
                self.commandRouter.pushToastMessage('success', 
                    self.getI18nString('PLUGIN_NAME'),
                    self.getI18nString('SAVE_SUCCESS')); 
                defer.resolve();
            })
            .fail(function(error) {
                self.logger.error('[LCD Backlight] Error during service restart: ' + error);
                self.commandRouter.pushToastMessage('error', 
                    self.getI18nString('PLUGIN_NAME'),
                    self.getI18nString('SAVE_ERROR') + ': ' + error);
                defer.reject(error);
            });
            
    } catch (e) {
        self.logger.error('[LCD Backlight] Error during saveConfig: ' + e);
        self.commandRouter.pushToastMessage('error', 
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('SAVE_ERROR') + ': ' + e);
        defer.reject(e);
    }
    
    return defer.promise;
};


lcdBacklight.prototype.writeDisabledFlag = function() {
    var self = this;
    var defer = libQ.defer();
    var configDir = '/etc/lcd_backlight';
    var filePath = configDir + '/lcd_enabled';
    
    self.logger.info('[LCD Backlight] Writing disabled flag to: ' + filePath);
    
    // Write lcd_enabled = 0 (directory exists from install.sh, volumio has write permissions)
    fs.writeFile(filePath, '0', function(err) {
        if (err) {
            self.logger.warn('[LCD Backlight] Could not write disabled flag: ' + err);
            defer.reject(err);
        } else {
            self.logger.info('[LCD Backlight] Disabled flag written');
            defer.resolve();
        }
    });
    
    return defer.promise;
};

lcdBacklight.prototype.writeConfigToSysfs = function() {
    var self = this;
    var defer = libQ.defer();
    var configDir = '/etc/lcd_backlight';
    
    var configs = {
        'lcd_enabled': self.config.get('enabled') ? '1' : '0',
        'lcd_int_time': self.config.get('int_time').toString(),
        'lcd_min_backlight': self.config.get('min_backlight').toString(),
        'lcd_max_backlight': self.config.get('max_backlight').toString(),
        'lcd_lux_multiplier': self.config.get('lux_multiplier').toString(),
        'lcd_smoothing_factor': self.config.get('smoothing_factor').toString()
    };
    
    var promises = [];
    
    for (var key in configs) {
        var filePath = configDir + '/' + key;
        var value = configs[key];
        
        (function(path, val) {
            var p = libQ.defer();
            
            // Direct write using fs (directory exists from install.sh, volumio has write permissions)
            fs.writeFile(path, val, function(err) {
                if (err) {
                    self.logger.warn('[LCD Backlight] Could not write ' + path + ': ' + err);
                } else {
                    self.logger.info('[LCD Backlight] Wrote ' + path + ' = ' + val);
                }
                p.resolve();
            });
            
            promises.push(p.promise);
        })(filePath, value);
    }
    
    libQ.all(promises)
        .then(function() {
            defer.resolve();
        })
        .fail(function(error) {
            defer.reject(error);
        });
    
    return defer.promise;
};

lcdBacklight.prototype.startService = function() {
    var self = this;
    var defer = libQ.defer();
    
    exec('/usr/bin/sudo /bin/systemctl start lcd_backlight.service', {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        if (error) {
            self.logger.error('[LCD Backlight] Failed to start service: ' + error);
            defer.reject(error);
        } else {
            self.logger.info('[LCD Backlight] Service started');
            defer.resolve();
        }
    });
    
    return defer.promise;
};

lcdBacklight.prototype.stopService = function() {
    var self = this;
    var defer = libQ.defer();
    
    exec('/usr/bin/sudo /bin/systemctl stop lcd_backlight.service', {uid: 1000, gid: 1000}, function(error, stdout, stderr) {
        if (error) {
            self.logger.error('[LCD Backlight] Failed to stop service: ' + error);
            defer.reject(error);
        } else {
            self.logger.info('[LCD Backlight] Service stopped');
            defer.resolve();
        }
    });
    
    return defer.promise;
};

lcdBacklight.prototype.getServiceStatus = function() {
    var self = this;
    var defer = libQ.defer();
    
    exec('systemctl is-active lcd_backlight.service', function(error, stdout, stderr) {
        var status = stdout.trim();
        defer.resolve(status === 'active');
    });
    
    return defer.promise;
};

// i18n

lcdBacklight.prototype.loadI18nStrings = function() {
    var self = this;
    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + '.json');
    } catch (e) {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }
    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

lcdBacklight.prototype.getI18nString = function(key) {
    var self = this;
    if (self.i18nStrings && self.i18nStrings[key] !== undefined) {
        return self.i18nStrings[key];
    } else {
        return self.i18nStringsDefaults[key];
    }
};