/* System Plugin for Rose Audio Devices */
'use strict';

var libQ = require('kew');
//var fs=require('fs-extra');
const gpiox = require('@iiot2k/gpiox');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
const logging = false; //Enable or disable logging

module.exports = roseaudiosys;

//Constructor
function roseaudiosys(context) {
	const self = this;

	//Volumio variables
	self.context = context;
	self.commandRouter = this.context.coreCommand;
	self.logger = this.context.logger;
	self.configManager = this.context.configManager;

	//Rose Audio variables
	self.audioOutputDeviceName = '';
	self.volumioReadyGPIO = null;

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

		self.log("getAudioOutputDeviceName > Audio Output Device: " + audioConfig.outputdevicename.value, "info");

		return audioConfig.outputdevicename.value;
	} catch (error) {
        self.log("getAudioOutputDeviceName > Failed to get audio configuration: " + error.message, "error");
        return '';
    }
}

/**
 * Check if the system is ready by checking the Volumio System Status environment variable
 * @return true if the system is ready, false otherwise
 */
roseaudiosys.prototype.isSystemReady = function() {
	const self = this;

	//Check if the system is ready
	const systemStatus = process.env.VOLUMIO_SYSTEM_STATUS;
	self.log("isSystemReady > Checking if system is ready... Status: " + systemStatus + ".", "info");

	return systemStatus && systemStatus.toLowerCase() === 'ready';
}

/**
 * Create a promise that resolves after a specified time (in milliseconds)
 * @param {Time to sleep in milleseconds} ms 
 * @returns A promise that resolves after the specified time has passed
 */
roseaudiosys.prototype.sleep = function(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for the system to be ready by checking the Volumio System Status environment variable at regular intervals.
 *	https://www.sitepoint.com/delay-sleep-pause-wait/
 *	https://javascript.info/async-await
 *  https://github.com/volumio/volumio-plugins-sources-bookworm/blob/4cbedc927025e09508fb8017216b8ac24534f5ab/autostart/index.js
 */
roseaudiosys.prototype.waitSystemReadyAndInitialize = function() {
	const self = this;
	const SYSTEM_READY_CHECK_INTERVAL = 1000; //Interval in milliseconds to check if system is ready
	const SYSTEM_READY_MAX_RETRIES = 90; //Maximum number of retries to check if system is ready
	let retryCount = 0;

	new Promise(async (resolve, reject) => {
		self.log("waitSystemReadyAndInitialize > Waiting for system to be ready...", "info");
		while (!self.isSystemReady() && (retryCount < SYSTEM_READY_MAX_RETRIES)) {
			if (retryCount > 0) self.log("waitSystemReady > Checking if system is ready... Retry count: " + retryCount, "info");
			await self.sleep(SYSTEM_READY_CHECK_INTERVAL); //Wait for SYSTEM_READY_CHECK_INTERVAL ms before checking again
			retryCount++;
		}

		//If the system is not ready after maximum retries, log an error but continue with the plugin initialization.
		if (retryCount >= SYSTEM_READY_MAX_RETRIES) {
			//self.log("waitSystemReady > System is not ready after maximum retries!", "error");
			reject(new Error("waitSystemReadyAndInitialize > System is not ready after all retries!"));
		} else {
			self.log("waitSystemReadyAndInitialize > System is ready after " + retryCount + " retries (seconds)!", "info");
			resolve("waitSystemReadyAndInitialize > System is ready after " + retryCount + " retries (seconds)!");
		}

		//Initialize the player in all cases, even if the system is not ready, to avoid leaving the Rose Audio Player Ready LED Off
		self.initializePlayer();
	}).then(() => {
		//Initialization successful
	}).catch((error) => {
		self.log("waitSystemReadyAndInitialize > Initialization error: " + error.message, "error");
	});
}

/**
 * Initialize the player based on the detected audio output device. This method is called after the system is ready.
 * @returns true if the player was initialized successfully, false otherwise
 */
roseaudiosys.prototype.initializePlayer = function() {
    const self = this;
	
	/*#######################################################################*/
	/* Manage the GPIO pin to signal Volumio readiness to the Rose Audio hardware.
	/*#######################################################################*/
	switch (self.audioOutputDeviceName) {
		case "RoseAudio Femto Player":
			//Log applying special configuration for Rose Audio Femto Player
            self.log("initializePlayer > Applying Rose Audio Femto Player special configuration...", "info");
			
			//Retrieve the Volumio Ready GPIO pin number from the plugin configuration
			self.volumioReadyGPIO = parseInt(self.config.get("femtoPlayerVolumioReadyGPIO.pin"), 10);

			//Make sure the GPIO pin number is valid
			if (isNaN(self.volumioReadyGPIO)) {
				self.log("initializePlayer > Invalid GPIO pin number for Volumio Ready signal!", "error");
				defer.reject(new Error("Invalid GPIO pin number for Volumio Ready signal!"));
				return defer.promise;
			}

			//Initialize the Volumio Ready GPIO
			gpiox.init_gpio(self.volumioReadyGPIO, gpiox.GPIO_MODE_OUTPUT, 0);

			// Set the Volumio Ready GPIO to High State
			self.log("initializePlayer > Volumio Ready GPIO Number: " + self.volumioReadyGPIO + " set to HIGH!", "info");
			gpiox.set_gpio(self.volumioReadyGPIO, 1);

			//Log the successful initialization of the Rose Audio Femto Player
			self.log("initializePlayer > Rose Audio Femto Player initialization completed successfully!", "info", true);

		break;
	
		default:
			// //Warn the user that the audio output device is not supported by this plugin
	        // self.Log(self.commandRouter.getI18nString("ERROR") + self.commandRouter.getI18nString("PLUGIN_CONFIGURATION") + self.commandRouter.getI18nString("HARDWARE_NOT_SUPPORTED"), "info", true);
			// self.commandRouter.pushToastMessage(self.commandRouter.getI18nString("ERROR"), self.commandRouter.getI18nString("PLUGIN_CONFIGURATION"), self.commandRouter.getI18nString("HARDWARE_NOT_SUPPORTED") + ": " + self.audioOutputDeviceName + "!");
	        self.log("initializePlayer > Un-supported hardware: " +self.audioOutputDeviceName, "error", true);

			
        	return false;
	}

	return true;
}

// Plugin is starting
roseaudiosys.prototype.onStart = function() {
    const self = this;
	const defer = libQ.defer();
	
	//Log Rose Audio System Initialization Plugin startup
	self.log("onStart > Starting Rose Audio System Initialization Plugin!", "info", true);

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
	/* Retrieve the audio output device name
	/*#######################################################################*/
    self.audioOutputDeviceName = self.getAudioOutputDeviceName();

	//Wait for the system to be ready and initialize the player
	self.waitSystemReadyAndInitialize();

	// Once the Plugin has successfull started resolve the promise
	defer.resolve();
	self.log("onStart > Rose Audio System Initialization Plugin started successfully!", "info", true);

    return defer.promise;
};

// plugin is stopping
roseaudiosys.prototype.onStop = function() {
    const self = this;
    const defer = libQ.defer();
	//const  volumioReadyGPIO = parseInt(self.config.get("RoseAudioFemtoPlayerVolumioReadyGPIO.pin"), 10);
   
	//Log Rose Audio System Initialization Plugin shutdown
	self.log("onStop > Stopping Rose Audio System Plugin!", "info");

	/*#######################################################################*/
	/* Manage the GPIO pin to signal Volumio readiness to the Rose Audio hardware.
	/*#######################################################################*/
	//Assuming all Rose Audio devices has a Volumio Readu GPIO pin. The GPIO pin
	//corresponding to the specific Rose Audio device is retrieved in the onStart method.
	if (typeof self.volumioReadyGPIO === "number" && !isNaN(self.volumioReadyGPIO)) {
		// Set the Volumio Ready GPIO to Low State
		self.log("onStop > Volumio Ready GPIO Number: " + self.volumioReadyGPIO + " set to LOW!", "info");
		gpiox.set_gpio(self.volumioReadyGPIO, 0);

		// Deinitialize the Volumio Ready GPIO
		gpiox.deinit_gpio(self.volumioReadyGPIO);
	}

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();

    return defer.promise;
};

// Plugin is restarting
roseaudiosys.prototype.onRestart = function() {
    const self = this;
    // Optional, use if you need it
};

/**
 * Logging Method
 * @param {*} message : the message to log 
 * @param {*} level : the log level (e.g. "info", "error", "debug"). Default is "info".
 * @param {*} force : if true, the message will be logged even if logging is disabled. Default is false.
 * @returns 
 */
const LogLevels = {
	"info": "info",
	"warn": "warn",
	"error": "error",
	"debug": "debug"
};
roseaudiosys.prototype.log = function(message, level = "info", force = false) {
	const self = this;

	//Check if logging is enabled
	if (!logging && !force) {
		return; //Do not log if logging is disabled and force is false
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
