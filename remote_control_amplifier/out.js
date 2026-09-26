// IR device related settings - these are only defaults, subject to change from loading config
const lirc = require('lirc-client')({
    path: '/var/run/lirc/lircd'
});

var devicename = 'receiver';
var start_button = 'KEY_POWER';
var stop_button = 'KEY_POWER2';
var vol_down_button = 'KEY_VOLUMEDOWN';
var vol_up_button = 'KEY_VOLUMEUP';

// behavior related settings -
var stopToTurnOffDelay = 60;







// Create ir objects for future events
// todo this function needs to be replaced with ir specific stuff
IRControl.prototype.recreateState = function () {
    var self = this;
    self.log("Reading config and setting volumes");
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, "config.json");
    config.loadFile(configFile);
    self.log("recreateState was called");
    self.savedDesiredConfig.volume = config.volume;
    self.log("recreateState has ended");
    return libQ.resolve();
};


// Function for printing booleans
IRControl.prototype.boolToString = function (value) {
    var self = this;
    return value ? self.getI18nString("ON") : self.getI18nString("OFF");
}


IRControl.prototype.saveDesiredState = function (data) {
    // not yet used
    var self = this;
    self.savedDesiredConfig.set("volume", data.volume);
    self.savedDesiredConfig.set("on", data.on);
    return libQ.resolve();
};










