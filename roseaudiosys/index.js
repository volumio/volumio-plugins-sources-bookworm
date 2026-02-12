/* System Plugin for Rose Audio Devices */
'use strict';

var libQ = require('kew');
//var fs=require('fs-extra');
const gpiox = require('@iiot2k/gpiox');
//var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
const logging = false; //Enable or disable logging

module.exports = roseaudiosys;

//Constructor
function roseaudiosys(context) {
	const self = this;

	self.context = context;
	self.commandRouter = this.context.coreCommand;
	self.logger = this.context.logger;
	self.configManager = this.context.configManager;

	self.log("Constructor > Volumio constructor called!");
}

//Volumio has started
roseaudiosys.prototype.onVolumioStart = function() {
	const self = this;
	const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, "config.json");

	//Log Volumio Starting
	self.log("onVolumioStart > Volumio is starting...");
	
	self.config = new (require('v-conf'))();
	self.config.loadFile(configFile);

    return libQ.resolve();
}

// Volumio is shutting down
roseaudiosys.prototype.onVolumioShutdown = function() {
	const self = this;

	//Log Volumio Shutdown
	self.log("onVolumioShutdown > Volumio is shutting down...");

	return libQ.resolve();
};

roseaudiosys.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

/**
 * Retrieve the audio output device name
 * @returns The audio output device name or '' if error
 * This is a configuration example
    {
        "volumestart": {
            "type": "string",
            "value": "disabled"
        },
        "volumemax": {
            "type": "string",
            "value": "100"
        },
        "volumecurvemode": {
            "type": "string",
            "value": "logarithmic"
        },
        "outputdevicecardname": {
            "type": "string",
            "value": "Player"
        },
        "outputdevicename": {
            "type": "string",
            "value": "RoseAudio Femto Player"
        },
        "outputdevice": {
            "type": "string",
            "value": "5"
        },
        "mixer_type": {
            "type": "string",
            "value": "Hardware"
        },
        "mixer": {
            "type": "string",
            "value": "RoseAudio Femto Player"
        },
        "volumesteps": {
            "type": "string",
            "value": "1"
        }
    }
 */
roseaudiosys.prototype.getAudioOutputDeviceName = function() {
    const self = this;

	try {
		const audioConfigPath = '/data/configuration/audio_interface/alsa_controller/config.json';
		const audioConfigContent = fs.readFileSync(audioConfigPath, 'utf8');
		const audioConfig = JSON.parse(audioConfigContent);

		self.log("getAudioConfig > Audio Output Device: " + audioConfig.outputdevicename.value, "info");

		return audioConfig.outputdevicename.value;
	} catch (error) {
        self.log("getAudioConfig > Failed to get audio configuration: " + error.message, "error");
        return '';
    }
}

// Plugin is starting
roseaudiosys.prototype.onStart = function() {
    const self = this;
	const defer = libQ.defer();
	const  volumioReadyGPIO = parseInt(self.config.get("volumioReadyGPIO.pin"), 10);
	
	//Log Rose Audio System Initialization Plugin startup
	self.log("onStart > Starting Rose Audio System Initialization Plugin!", "info");

	/*#######################################################################*/
	/* Retrieve the audio output device name
	/*#######################################################################*/
    const audioOutputDeviceName = self.getAudioOutputDeviceName();

	/*#######################################################################*/
	/* Disable the HDMI interface to remove any possible source of noise
	/*#######################################################################*/
	// exec("/opt/vc/bin/tvservice -o", (error, stdout, stderr) => {
	// 	if (error) {
	// 		self.log("onStart > Error disabling HDMI interface: " + error.message, "error");
	// 		//Continue even if there is an error
	// 	} else {
	// 		self.log("onStart > HDMI interface disabled successfully.", "info");
	// 		self.log("onStart > tvservice output: " + stdout, "debug");
	// 		if (stderr) {
	// 			self.log("onStart > tvservice stderr: " + stderr, "debug");
	// 		}
	// 	}
	// });

	/*#######################################################################*/
	/* Manage the GPIO pin to signal Volumio readiness to the Rose Audio hardware.
	/*#######################################################################*/
	switch (audioOutputDeviceName) {
		case "RoseAudio Femto Player":
            self.log("onStart > Audio Output Device: " + audioOutputDeviceName + " found! Applying special configuration...", "info");

			//Make sure the GPIO pin number is valid
			if (isNaN(volumioReadyGPIO)) {
				self.log("onStart > Invalid GPIO pin number for Volumio Ready signal!", "error");
				defer.reject(new Error("Invalid GPIO pin number for Volumio Ready signal!"));
				return defer.promise;
			}

			//Initialize the Volumio Ready GPIO
			gpiox.init_gpio(volumioReadyGPIO, gpiox.GPIO_MODE_OUTPUT, 0);

			// Set the Volumio Ready GPIO to High State
			self.log("onStart > Volumio Ready GPIO Number: " + volumioReadyGPIO + " set to HIGH!", "info");
			gpiox.set_gpio(volumioReadyGPIO, 1);

			break;
	
		default:
			//Warn the user that the audio output device is not supported by this plugin
			self.commandRouter.pushToastMessage("error", "Rose Audio System Initialization Plugin", "Un-supported audio output device: " + audioOutputDeviceName);
	        self.log("onStart > Un-supported hardware: " + audioOutputDeviceName, "error");
        	defer.reject("Un-supported hardware: " + audioOutputDeviceName);

            return defer.promise;
	}

	// Once the Plugin has successfull started resolve the promise
	defer.resolve();

    return defer.promise;
};

// plugin is stopping
roseaudiosys.prototype.onStop = function() {
    const self = this;
    const defer = libQ.defer();
	const  volumioReadyGPIO = parseInt(self.config.get("volumioReadyGPIO.pin"), 10);
   
	//Log Rose Audio System Initialization Plugin shutdown
	self.log("onStop > Stopping Rose Audio System Plugin!", "info");

	//Make sure the GPIO pin number is valid
	if (isNaN(volumioReadyGPIO)) {
		self.log("onStop > Invalid GPIO pin number for Volumio Ready signal!", "error");
		defer.resolve(); //Do not fail on stop
		//defer.reject(new Error("Invalid GPIO pin number for Volumio Ready signal"));
		return defer.promise;
	}

	// Set the Volumio Ready GPIO to Low State
	self.log("onStop > Volumio Ready GPIO Number: " + volumioReadyGPIO + " set to LOW!", "info");
	gpiox.set_gpio(volumioReadyGPIO, 0);

	// Deinitialize the Volumio Ready GPIO
	gpiox.deinit_gpio(volumioReadyGPIO);

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();

    return defer.promise;
};

// Plugin is restarting
roseaudiosys.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

/**
 * Logging Method
 * @param {*} message : the message to log 
 * @param {*} level : the log level (e.g. "info", "error", "debug"). Default is "info".
 * @returns 
 */
const LogLevels = {
	"info": "info",
	"warn": "warn",
	"error": "error",
	"debug": "debug"
};
roseaudiosys.prototype.log = function(message, level = "info") {
	const self = this;

	//Check if logging is enabled
	if (!logging) {
		return; //Do not log if logging is disabled
	}

	//Check log level is valid
	if (!LogLevels.hasOwnProperty(level)) {
		level = "info"; //Default to info if invalid log level is provided
	}

	if (level === "info") {
		self.logger.info(`[roseaudiosys] ${message}`);
		return;
	}

	if (level === "warn") {
		self.logger.warn(`[roseaudiosys] ${message}`);
		return;
	}

	if (level === "error") {
		self.logger.error(`[roseaudiosys] ${message}`);
		return;
	}

	if (level === "debug") {
		self.logger.debug(`[roseaudiosys] ${message}`);
		return;
	}
}


// Configuration Methods -----------------------------------------------------------------------------
roseaudiosys.prototype.getUIConfig = function() {
    const defer = libQ.defer();
    const self = this;

    const lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            defer.resolve(uiconf);
        })
        .fail(function(){
            defer.reject(new Error());
        });

    return defer.promise;
};

roseaudiosys.prototype.setUIConfig = function(data) {
	const self = this;
	//Perform your installation tasks here
};

roseaudiosys.prototype.getConf = function(varName) {
	const self = this;
	//Perform your installation tasks here
};

roseaudiosys.prototype.setConf = function(varName, varValue) {
	const self = this;
	//Perform your installation tasks here
};
