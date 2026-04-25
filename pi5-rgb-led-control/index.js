'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var path = require('path');

module.exports = ControllerPi5Led;

function ControllerPi5Led(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.pythonProcess = null;
}

ControllerPi5Led.prototype.onVolumioStart = function () {
    var self = this;
    var configFile = path.join(__dirname, 'config.json');
    this.config = new (require('v-conf'))();
    if (!fs.existsSync(configFile)) {
        fs.writeJsonSync(configFile, {});
    }
    this.config.loadFile(configFile);
    return libQ.resolve();
};

ControllerPi5Led.prototype.onStart = function () {
    var self = this;
    var defer = libQ.defer();

    var isEnabled = self.config.get('ENABLED');
    if (isEnabled === undefined) isEnabled = true; 

    // Kill any stray engines
    exec("pkill -f led_engine.py > /dev/null 2>&1", (error, stdout, stderr) => {
        
        if (!isEnabled) {
            self.logger.info("[Pi5-LED] LED Output is DISABLED in settings. Engine not started.");
            return defer.resolve();
        }

        self.logger.info("[Pi5-LED] Starting LED Engine...");
        var enginePath = path.join(__dirname, 'led_engine.py');
        
        // Start the engine and redirect all output to /dev/null
        exec("python3 " + enginePath + " > /dev/null 2>&1 &");
        defer.resolve();
    });

    return defer.promise;
};

ControllerPi5Led.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info("[Pi5-LED] Stopping LED Engine (Singularity)...");
    
    exec("pkill -15 -f led_engine.py", (error, stdout, stderr) => {
        setTimeout(function() {
            defer.resolve();
        }, 4000); 
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

ControllerPi5Led.prototype.saveLEDConfig = function (data) {
    var self = this;
    var defer = libQ.defer();
    var settingsPath = path.join(__dirname, 'led_settings.json');

    try {
        for (var key in data) {
            self.config.set(key, data[key]);
        }

        var s = {};
        if (fs.existsSync(settingsPath)) {
            s = fs.readJsonSync(settingsPath);
        }

        for (var key in data) {
            if (data[key] !== null && typeof data[key] === 'object' && data[key].value !== undefined) {
                s[key] = data[key].value;
            } else {
                s[key] = data[key];
            }
        }

        fs.writeJsonSync(settingsPath, s);
        fs.chmodSync(settingsPath, '0777'); 

        if (data.ENABLED !== undefined) {
            self.onStart(); 
        }

        self.commandRouter.pushToastMessage('success', "Pi5 RGB Link", "Settings Applied.");
        defer.resolve();
    } catch (e) {
        self.logger.error("[Pi5-LED] Save failed: " + e);
        self.commandRouter.pushToastMessage('error', "Save Failed", "Check log for details.");
        defer.reject(e);
    }
    return defer.promise;
};

ControllerPi5Led.prototype.getConfigurationFiles = function() { return ['config.json']; };