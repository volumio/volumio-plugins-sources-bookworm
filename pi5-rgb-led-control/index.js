'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var path = require('path');

module.exports = ControllerPi5Led;

function ControllerPi5Led(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
}

// STEP 1: Load config from the "Standard Place"
ControllerPi5Led.prototype.onVolumioStart = function () {
    var self = this;
    // This line tells Volumio to look in /data/configuration/system_hardware/pi5-rgb-led-control/
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

ControllerPi5Led.prototype.onStart = function () {
    var self = this;
    var defer = libQ.defer();

    var isEnabled = self.config.get('ENABLED');
    if (isEnabled === undefined) isEnabled = true; 

    exec("pkill -f led_engine.py > /dev/null 2>&1", (error, stdout, stderr) => {
        if (!isEnabled) {
            self.logger.info("[Pi5-LED] LED Output is DISABLED. Engine not started.");
            return defer.resolve();
        }

        self.logger.info("[Pi5-LED] Starting LED Engine...");
        var enginePath = path.join(__dirname, 'led_engine.py');
        
        // Start engine
        exec("python3 " + enginePath + " > /dev/null 2>&1 &");
        defer.resolve();
    });

    return defer.promise;
};

ControllerPi5Led.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();
    self.logger.info("[Pi5-LED] Stopping LED Engine...");
    exec("pkill -15 -f led_engine.py", (error, stdout, stderr) => {
        setTimeout(function() {
            defer.resolve();
        }, 2000); 
    });
    return defer.promise;
};

ControllerPi5Led.prototype.getSelfConf = function (uiconf, id) {
    var result = null;
    uiconf.sections.forEach(section => {
        section.content.forEach(content => {
            if (content.id === id) {
                result = content;
            } else if (content.type === 'column') {
                content.content.forEach(colContent => {
                    if (colContent.id === id) result = colContent;
                });
            }
        });
    });
    return result;
};

ControllerPi5Led.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    var fp = path.join(__dirname, 'UIConfig.json');

    fs.readJson(fp, function (err, uiconf) {
        if (err) {
            self.logger.error("[Pi5-LED] Failed to read UIConfig: " + err);
            defer.reject(new Error());
        } else {
            var configKeys = self.config.getKeys();
            configKeys.forEach(function (key) {
                var element = self.getSelfConf(uiconf, key);
                if (element) {
                    element.value = self.config.get(key);
                }
            });
            defer.resolve(uiconf);
        }
    });
    return defer.promise;
};

// STEP 2: Save using the official self.config.set method
ControllerPi5Led.prototype.saveLEDConfig = function (data) {
    var self = this;

    try {
        for (var key in data) {
            // Handle Dropdowns/Selects like balbuze showed you
            if (data[key] !== null && typeof data[key] === 'object' && data[key].value !== undefined) {
                self.config.set(key, {
                    value: data[key].value,
                    label: data[key].label
                });
            } else {
                // Handle standard numbers/booleans/strings
                self.config.set(key, data[key]);
            }
        }

        // Trigger engine restart to apply settings
        self.onStop().then(() => {
            return self.onStart();
        });

        self.commandRouter.pushToastMessage('success', "Pi5 RGB Link", "Settings Applied.");
    } catch (e) {
        self.logger.error("[Pi5-LED] Save failed: " + e);
        self.commandRouter.pushToastMessage('error', "Save Failed", "Check log for details.");
    }
    return libQ.resolve();
};

ControllerPi5Led.prototype.getConfigurationFiles = function() { return ['config.json']; };