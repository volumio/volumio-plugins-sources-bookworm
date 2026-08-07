'use strict';
// the imports from libraries 
var libQ = require("kew");
var fs = require("fs-extra");
var config = new (require("v-conf"))();
var io = require('socket.io-client');
var socket;

// Event string consts
// Events that we can detect and do something
const SYSTEM_STARTUP = "systemStartup";
const SYSTEM_SHUTDOWN = "systemShutdown";
const MUSIC_PLAY = "musicPlay";
const MUSIC_PAUSE = "musicPause";
const MUSIC_STOP = "musicStop";

// IR device related settings - these are only defaults, subject to change from loading config
const lirc = require('lirc-client')({
    path: '/var/run/lirc/lircd'
});
var start_button = 'KEY_POWER';
var stop_button = 'KEY_POWER2';
var vol_down_button = 'KEY_VOLUMEDOWN';
var vol_up_button = 'KEY_VOLUMEUP';

// behavior related settings -
var stopToTurnOffDelay = 60;
var keypressTimeOut = 300;
var laststate = {"volume": -1, "mute": false, "status": "jiberish"};


module.exports = IRControl;


// Constructor
function IRControl(context) {
    var self = this;
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.load18nStrings();
    this.stopRequested = false;
    this.stopInProgress = false;
    this.log('Initializing IRControl');
    this.amplifierOn = false;
    this.savedDesiredConfig = {"volume": -1};
    this.desiredVolume = 0;
    this.volumeOperationInProgress = false;
}

// Volumio is starting
// read the states from the config file
IRControl.prototype.onVolumioStart = function () {
    var self = this;
    this.log('onVolumioStart');
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, "config.json");
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    // Initialize runtime settings from stored config (with sensible defaults)
    self.devicename = self.config.get('deviceName', 'receiver');
    start_button = self.config.get('startButton', start_button);
    stop_button = self.config.get('stopButton', stop_button);
    vol_up_button = self.config.get('volUpButton', vol_up_button);
    vol_down_button = self.config.get('volDownButton', vol_down_button);
    self.powerOnOnPlay = self.config.get('powerOnOnPlay', true);
    self.powerOffOnStop = self.config.get('powerOffOnStop', true);
    self.powerOffOnPause = self.config.get('powerOffOnPause', false);
    stopToTurnOffDelay = Number(self.config.get('powerOffDelay', stopToTurnOffDelay)) || stopToTurnOffDelay;

    this.log('Configuration loaded: ' + JSON.stringify({
        deviceName: self.devicename,
        startButton: start_button,
        stopButton: stop_button,
        volUpButton: vol_up_button,
        volDownButton: vol_down_button,
        powerOnOnPlay: self.powerOnOnPlay,
        powerOffOnStop: self.powerOffOnStop,
        powerOffOnPause: self.powerOffOnPause,
        powerOffDelay: stopToTurnOffDelay
    }));

    this.amplifierOn = false;
    this.log("Initialized");
    return libQ.resolve();
}

IRControl.prototype.getConfigurationFiles = function () {
    return ['config.json'];
}

// Volumio is shutting down
// todo - on volumio shutdown let's save the state and compare with what does mpd says about it (volume for example)
// on stopping volumio, we may need to set the amplifier to play back radio or something (not sure yet)
IRControl.prototype.onVolumioShutdown = function () {
    var self = this;
    self.handleEvent(SYSTEM_SHUTDOWN, state);
    return libQ.resolve();
};

// Return config filename
IRControl.prototype.getConfigurationFiles = function () {
    return ["config.json"];
}



// Plugin has started
IRControl.prototype.onStart = function () {
    var self = this;
    var defer = libQ.defer();
    self.volumeListener();
    self.log('onStart: finished loading volumeListener');
    defer.resolve();
    return defer.promise;
};

// Pluging has stopped
IRControl.prototype.onStop = function () {
    //todo let's save all the states of volumio to the config file
    var self = this;
    var defer = libQ.defer();
    self.handleEvent(SYSTEM_SHUTDOWN);
    defer.resolve();
    return libQ.resolve();
};

// The usual plugin guff :p

IRControl.prototype.onRestart = function () {
    var self = this;
};

IRControl.prototype.onInstall = function () {
    var self = this;
};

IRControl.prototype.onUninstall = function () {
    var self = this;
};

IRControl.prototype.getConf = function (varName) {
    var self = this;
};

IRControl.prototype.setConf = function (varName, varValue) {
    var self = this;
};

IRControl.prototype.getAdditionalConf = function (type, controller, data) {
    var self = this;
};

IRControl.prototype.setAdditionalConf = function () {
    var self = this;
};

IRControl.prototype.setUIConfig = function (data) {
    var self = this;
};

// Read config from UI
IRControl.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    var lang_code = self.commandRouter.sharedVars.get("language_code");
    self.log(`language_code ${lang_code}`);
    var UIConfigFile;
    UIConfigFile = __dirname + "/UIConfig.json";
    self.log(`UI Config file ${UIConfigFile}`);

    self.commandRouter.i18nJson(
        __dirname + "/i18n/strings_" + lang_code + ".json",
        __dirname + "/i18n/strings_en.json",
        UIConfigFile)
        .then(function (uiconf) {
            // populate UI fields with saved config values
            try {
                var g = function(k, d) { return self.config.get(k, d); };
                // switches
                self.setSwitchElement(uiconf, 'powerOnOnPlay', g('powerOnOnPlay', true));
                self.setSwitchElement(uiconf, 'powerOffOnStop', g('powerOffOnStop', true));
                self.setSwitchElement(uiconf, 'powerOffOnPause', g('powerOffOnPause', false));
                // text fields
                let el = self.getUIElement(uiconf, 'deviceName'); if (el) el.value = g('deviceName','RAV300');
                el = self.getUIElement(uiconf, 'startButton'); if (el) el.value = g('startButton','KEY_POWER');
                el = self.getUIElement(uiconf, 'stopButton'); if (el) el.value = g('stopButton','KEY_POWER2');
                el = self.getUIElement(uiconf, 'volUpButton'); if (el) el.value = g('volUpButton','KEY_VOLUMEUP');
                el = self.getUIElement(uiconf, 'volDownButton'); if (el) el.value = g('volDownButton','KEY_VOLUMEDOWN');
                el = self.getUIElement(uiconf, 'powerOffDelay'); if (el) el.value = String(g('powerOffDelay', stopToTurnOffDelay));
            } catch (e) {
                self.log('Error populating UI config: '+e);
            }
            self.log(`getUIConfig sending uiconf`);
            defer.resolve(uiconf);
        })
        .fail(function () {
            self.log(`Error occurred during getUIConff`);
            defer.reject(new Error('Failed to load configuration'));
        });

    return defer.promise;

};

// Save config
IRControl.prototype.saveConfig = function (data) {
    var self = this;

    // Ensure we have a config instance
    if (!self.config) self.config = new (require('v-conf'))();

    // Helper to extract primitive value from UI input objects
    var raw = function (v, def) {
        if (v === undefined || v === null) return def;
        if (typeof v === 'object' && v.hasOwnProperty('value')) return v.value;
        return v;
    };

    var deviceName = raw(data.deviceName, 'RAV300');
    var startButton = raw(data.startButton, start_button);
    var stopButton = raw(data.stopButton, stop_button);
    var volUpButton = raw(data.volUpButton, vol_up_button);
    var volDownButton = raw(data.volDownButton, vol_down_button);

    var powerOnOnPlay = !!raw(data.powerOnOnPlay, true);
    var powerOffOnStop = !!raw(data.powerOffOnStop, true);
    var powerOffOnPause = !!raw(data.powerOffOnPause, false);

    var delayRaw = raw(data.powerOffDelay, stopToTurnOffDelay);
    var delay = parseInt(delayRaw, 10);
    if (isNaN(delay) || delay < 0) delay = stopToTurnOffDelay;

    // Persist primitive values into the config storage
    self.config.set('deviceName', deviceName);
    self.config.set('startButton', startButton);
    self.config.set('stopButton', stopButton);
    self.config.set('volUpButton', volUpButton);
    self.config.set('volDownButton', volDownButton);
    self.config.set('powerOnOnPlay', powerOnOnPlay);
    self.config.set('powerOffOnStop', powerOffOnStop);
    self.config.set('powerOffOnPause', powerOffOnPause);
    self.config.set('powerOffDelay', delay);

    // Apply changes immediately to runtime variables
    self.devicename = deviceName;
    start_button = startButton;
    stop_button = stopButton;
    vol_up_button = volUpButton;
    vol_down_button = volDownButton;
    self.powerOnOnPlay = powerOnOnPlay;
    self.powerOffOnStop = powerOffOnStop;
    self.powerOffOnPause = powerOffOnPause;
    stopToTurnOffDelay = delay;

    // Persist configuration to disk (config.json) as plain key/value pairs
    try {
        var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, "config.json");
        var toWrite = {
            deviceName: deviceName,
            startButton: startButton,
            stopButton: stopButton,
            volUpButton: volUpButton,
            volDownButton: volDownButton,
            powerOnOnPlay: powerOnOnPlay,
            powerOffOnStop: powerOffOnStop,
            powerOffOnPause: powerOffOnPause,
            powerOffDelay: delay
        };
        // backup previous config
        try { if (fs.existsSync(configFile)) fs.copyFileSync(configFile, configFile + '.bak.' + (new Date()).toISOString().replace(/[:.]/g, '-')); } catch (e) { /* non-fatal */ }
        fs.writeJsonSync(configFile, toWrite, {spaces: 2});
        self.log('Configuration saved to ' + configFile);
    } catch (e) {
        self.log('Failed writing configuration file: ' + e);
        self.commandRouter.pushToastMessage('error', self.getI18nString("PLUGIN_CONFIGURATION"), 'Failed to save configuration to file');
    }

    self.log("Saving config");
    self.commandRouter.pushToastMessage('success', self.getI18nString("PLUGIN_CONFIGURATION"), self.getI18nString("SETTINGS_SAVED"));
};




// Output to log
IRControl.prototype.log = function (s) {
    var self = this;
    self.logger.info("[amplifier_remote_Control] " + s);
}

// Output to log
IRControl.prototype.debug = function (s) {
    var self = this;
    self.logger.debug("[amplifier_remote_Control] " + s);
}

IRControl.prototype.error = function (s) {
    var self = this;
    self.logger.error("[amplifier_remote_Control] " + s);
}


// A method to get some language strings used by the plugin
IRControl.prototype.load18nStrings = function () {
    var self = this;

    try {
        var language_code = self.commandRouter.sharedVars.get('language_code');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + ".json");
    } catch (e) {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }

    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

// Retrieve a string
IRControl.prototype.getI18nString = function (key) {
    var self = this;

    if (self.i18nStrings[key] !== undefined)
        return self.i18nStrings[key];
    else
        return self.i18nStringsDefaults[key];
};

// Retrieve a UI element from UI config
IRControl.prototype.getUIElement = function (obj, field) {
    var self = this;
    self.log('getUIElement was called');

    function searchContent(content) {
        if (!content || !Array.isArray(content)) return null;
        for (let i = 0; i < content.length; i++) {
            const el = content[i];
            if (!el) continue;
            if (el.id === field) return el;
            if (el.content && Array.isArray(el.content)) {
                const found = searchContent(el.content);
                if (found) return found;
            }
        }
        return null;
    }

    if (!obj || !Array.isArray(obj.sections)) return null;
    for (let s = 0; s < obj.sections.length; s++) {
        const sec = obj.sections[s];
        if (!sec) continue;
        const found = searchContent(sec.content);
        if (found) return found;
    }

    return null;
}

// Populate switch UI element
IRControl.prototype.setSwitchElement = function (obj, field, value) {
    var self = this;
    self.log('setSwitchElement was called');
    var result = self.getUIElement(obj, field);
    if (result)
        result.value = value;
}

// Populate select UI element
IRControl.prototype.setSelectElement = function (obj, field, value, label) {
    var self = this;
    self.log('setSelectElement was called');
    var result = self.getUIElement(obj, field);
    if (result) {
        result.value.value = value;
        result.value.label = label;
    }
}

// Populate select UI element when value matches the label
IRControl.prototype.setSelectElementStr = function (obj, field, value) {
    var self = this;
    self.setSelectElement(obj, field, value, value.toString());
}

// this file will store everything that was taken out of index.js 
IRControl.prototype.volumeListener = function () {
    var self = this;
    self.log("Starting volumeListener (socket.io)");

    // Clean up existing socket if any
    try {
        if (socket) {
            socket.removeAllListeners();
            socket.close();
        }
    } catch (e) { /* ignore */ }

    // Prefer websocket transport to avoid polling parser issues
    socket = io.connect('http://localhost:3000', {
        reconnection: true,
        transports: ['websocket'],
        timeout: 20000
    });

    socket.on('connect', function() {
        self.log('socket.io connected');
        try { socket.emit('getState'); self.log('sent getState'); } catch (e) { self.log('Failed to emit getState: '+e); }
    });

    socket.on('connect_error', function(err) {
        self.error('socket.io connect_error: ' + String(err));
        // Detect common version mismatch message and provide guidance
        try {
            var msg = (err && err.message) ? err.message : String(err);
            if (msg.indexOf('v2.x') !== -1 && msg.indexOf('v3.x') !== -1) {
                self.error('Socket.IO version mismatch detected between client and server; consider using socket.io-client v2.x or updating server to v3.x+');
            }
        } catch (e) { /* ignore */ }

        // Fallback: attempt polling transport if websocket failed for non-version reasons
        try {
            if (socket && socket.io && socket.io.opts && Array.isArray(socket.io.opts.transports) && socket.io.opts.transports.includes('websocket')) {
                self.log('Attempting fallback to polling transport');
                try { socket.disconnect(); } catch(e){}
                socket = io.connect('http://localhost:3000', {reconnection: true, transports: ['polling'], timeout: 20000});
            }
        } catch (e) { self.error('Fallback attempt failed: '+e); }
    });

    socket.on('disconnect', function(reason) {
        self.log('socket.io disconnected: ' + String(reason));
    });

    // Ensure single pushState handler and robust processing
    try { socket.off('pushState'); } catch (e) {}
    socket.on('pushState', function(state) {
        self.debug('socket.io pushState received');
        if (state && state.volume !== undefined && state.mute !== undefined) {
            const volNum = Number(state.volume);
            if (Number.isNaN(volNum)) {
                self.log('pushState: volume is not numeric, ignoring');
                return;
            }
            let volume = parseInt(volNum, 10);
            let mute = state.mute;
            if (mute) volume = 0;
            if (laststate.volume == volume && laststate.mute == mute && laststate.status == state.status) {
                self.debug('volumeListener: State is the same as before, not doing anything');
            } else {
                self.log('volumeListener: State is different from before, doing something');
                laststate.volume = volume;
                laststate.mute = mute;
                laststate.status = state.status;
                self.log('volumeListener: Received state: ' + JSON.stringify(state));
                self.statusChanged(state);
            }
        }
    });
};

// Playing status has changed
// (might not always be a play or pause action)
IRControl.prototype.statusChanged = function (state) {
    var self = this;
    self.debug('State is like ' + String(state.status));
    if (state.status == "play") {
        self.debug("we are playing");
        self.handleEvent(MUSIC_PLAY, state);
    }
    else if (state.status == "pause") {
        self.debug("we are pausing");
        self.handleEvent(MUSIC_PAUSE, state);
    }
    else if (state.status == "stop") {
        self.debug("we are stopping");
        self.handleEvent(MUSIC_STOP, state);
    }
}

// An event has happened so do something about it
// handleevent needs to look at the event and check all the stuff that mpd has to offer
// todo refactor to multiple methods 
IRControl.prototype.handleEvent = function (e, state = {"volume": 1}) {
    var self = this;
    self.log('handleEvent was called for ' + e + ' volume:' + state.volume + ' mute:' + state.mute+ ' status:' + state.status);
    if (e == MUSIC_PAUSE) {
        if (self.powerOffOnPause == true) {
        self.turnOffAmplifierWithDelay();
        } else {
            self.log('powerOffOnPause is false - not turning off amplifier on pause');
        }
    }
    if (e == MUSIC_STOP) {
        if (self.powerOffOnStop == true) {
        self.turnOffAmplifierWithDelay();
        } else {
            self.log('powerOffOnStop is false - not turning off amplifier on stop');
        }
    }
    if (e == MUSIC_PLAY) {
            if (self.powerOnOnPlay == true) {
        self.turnOnAmplifier();
        self.setVolume(state.volume);
            } else {
                self.log('powerOnOnPlay is false - not turning on amplifier on play');
            }
    }
    if (e == SYSTEM_SHUTDOWN) {
        if (self.powerOffOnStop == true) {
        self.turnItOff();
        } else {
            self.log('powerOffOnStop is false - not turning off amplifier on shutdown');
        }
    }
    if (e == SYSTEM_STARTUP) {
        self.log('This is startup - we assume that the amplifier is stopped.');
        self.amplifierOn = false;
    }
}


// this function will turn off the amplifier
IRControl.prototype.turnItOff = function () {
    var self = this;
   
    self.debug(`Sending ${self.devicename} the button ${stop_button}`)
    lirc.sendOnce(self.devicename, stop_button).catch(error => {
        if (error) self.error('error occurred during turnItOff'+ String(error));
    });

}

// this function will turn on the amplifier
IRControl.prototype.turnItOn = function () {
    var self = this;
    self.debug(`Sending ${this.devicename} the button ${start_button}`)
    lirc.sendOnce(self.devicename, start_button).catch(error => {
        if (error) self.error('error occurred during turnItOn'+ String(error));
    });
}

IRControl.prototype.turnOnAmplifier = function () {
    // if there is a counter already started to stop the amplifier, stop this and press the power button (anyway it doesn't hurt)
    var self = this;
    self.stopInProgress = false;
    self.stopRequested = false;
    self.turnItOn();
    self.amplifierOn = true;
}


IRControl.prototype.setVolume = async function (newvolume) {
    var indexer = 0;
    this.desiredVolume = newvolume;
    this.log(`The desired volume has changed to ${newvolume}`);
    if (this.savedDesiredConfig.volume<0) {
        this.log(`We are starting up. Let's set the savedDesiredConfig to the ${newvolume}`);
        this.savedDesiredConfig.volume = newvolume; 
    } else {
    while (this.desiredVolume != this.savedDesiredConfig.volume) {
        
    if (this.desiredVolume < this.savedDesiredConfig.volume) {
        let delta_volume = this.savedDesiredConfig.volume - this.desiredVolume;
        this.log('decreasing volume by ' + String(delta_volume));
        this.volumeOperationInProgress = true;
        this.decreaseVolume(delta_volume);
        this.log('decreasing Waiting for ' + String(keypressTimeOut));
        this.log("Decreasing volume from " + this.savedDesiredConfig.volume + " to " + this.desiredVolume );
        await new Promise(resolve => setTimeout(resolve, keypressTimeOut));
    }
    if (this.desiredVolume > this.savedDesiredConfig.volume) {
        let delta_volume = this.desiredVolume - this.savedDesiredConfig.volume; 
        this.log('increasing volume by ' + String(delta_volume));
        this.increaseVolume(delta_volume);
        this.log('increasing Waiting for ' + String(keypressTimeOut));
        await new Promise(resolve => setTimeout(resolve, keypressTimeOut));
        }
    }
    this.volumeOperationInProgress = false;
    this.savedDesiredConfig = {"volume": this.desiredVolume};
    }
}

IRControl.prototype.increaseVolume = function (delta_volume) {
    var self = this;
    self.debug(`Sending ${self.devicename} the button ${vol_up_button}`)
    lirc.sendOnce(self.devicename, vol_up_button, delta_volume).catch(error => {
        if (error) self.error('error occurred during increaseVolumio'+ String(error));
    });
    self.log('Increased volume by a bit');
    self.savedDesiredConfig.volume = self.savedDesiredConfig.volume + delta_volume;
}

IRControl.prototype.decreaseVolume = function (delta_volume) {
    var self = this;
    self.debug(`Sending ${self.devicename} the button ${vol_down_button}`)
    lirc.sendOnce(self.devicename, vol_down_button,delta_volume).catch(error => {
        if (error) self.error('error occurred during decreaseVolume'+ String(error));
    });
    self.log('Decreased volume by a bit');
    self.savedDesiredConfig.volume = self.savedDesiredConfig.volume - delta_volume;
}

IRControl.prototype.turnOffAmplifierWithDelay = async function () {
    var self = this;
    self.log('turnOffAmplifierWithDelay was called');
    if (!self.stopInProgress) {
        self.log('Playback was stopped, amplifier will be turned off in ' + stopToTurnOffDelay + ' seconds');
        self.stopInProgress = true;
        self.stopRequested = true;
        return new Promise(function (resolve, reject) {
            setTimeout(() => {
                if (self.stopRequested === true) {
                    self.turnItOff();
                    self.log('Amplifier was turned off');
                    self.amplifierOn = false;
                    self.stopInProgress = false;
                    self.stopRequested = false;
                    resolve();
                } else {
                    self.log('Stopping was cancelled');
                    self.stopRequested = false;
                    self.stopInProgress = false;
                    resolve();
                }
            }, stopToTurnOffDelay * 1000);
        })
    }
}

