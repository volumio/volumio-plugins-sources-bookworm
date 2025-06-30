'use strict';

const libQ = require('kew');
const io = require('socket.io-client');
const gpiox = require('@iiot2k/gpiox');

const socket = io.connect('http://localhost:3000');
const actions = ["playPause", "volumeUp", "volumeDown", "previous", "next", "shutdown"];
const DEBOUNCE_US = 1000; // microseconds
const logPrefix = 'gpio-buttons - ';

module.exports = GPIOButtons;

function GPIOButtons(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.triggers = new Map(); // Store pin handlers
}

GPIOButtons.prototype.onVolumioStart = function() {
    this.config = new (require('v-conf'))();
    this.config.loadFile(this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json'));
    this.logger.info(logPrefix + "GPIO-Buttons initialized");
    return libQ.resolve();
};

GPIOButtons.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

GPIOButtons.prototype.onStart = function() {
    const self = this;
    const defer = libQ.defer();

    self.createTriggers()
        .then(() => {
            self.logger.info(logPrefix + "GPIO-Buttons started");
            defer.resolve();
        })
        .fail(err => {
            self.logger.error(logPrefix + "Startup failed: " + err);
            defer.reject(err);
        });

    return defer.promise;
};

GPIOButtons.prototype.onStop = function() {
    const self = this;
    const defer = libQ.defer();

    self.clearTriggers()
        .then(() => {
            self.logger.info(logPrefix + "GPIO-Buttons stopped");
            defer.resolve();
        });

    return defer.promise;
};


GPIOButtons.prototype.onRestart = () => {};
GPIOButtons.prototype.onInstall = () => {};
GPIOButtons.prototype.onUninstall = () => {};
GPIOButtons.prototype.getConf = (varName) => {};
GPIOButtons.prototype.setConf = (varName, varValue) => {};
GPIOButtons.prototype.getAdditionalConf = (type, controller, data) => {};
GPIOButtons.prototype.setAdditionalConf = () => {};


GPIOButtons.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	self.logger.info(logPrefix +'GPIO-Buttons: Getting UI config');

	//Just for now..
	var lang_code = 'en';

	//var lang_code = this.commandRouter.sharedVars.get('language_code');

        self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
                __dirname+'/i18n/strings_en.json',
                __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {

			var i = 0;
			actions.forEach(function(action, index, array) {
 				
 				// Strings for config
				var c1 = action.concat('.enabled');
				var c2 = action.concat('.pin');
				
				// accessor supposes actions and uiconfig items are in SAME order
				// this is potentially dangerous: rewrite with a JSON search of "id" value ?				
				uiconf.sections[0].content[2*i].value = self.config.get(c1);
				uiconf.sections[0].content[2*i+1].value.value = self.config.get(c2);
				uiconf.sections[0].content[2*i+1].value.label = self.config.get(c2).toString();

				i = i + 1;
			});

            defer.resolve(uiconf);
		})
        .fail(function()
        {
            defer.reject(new Error());
        });

        return defer.promise;
};

GPIOButtons.prototype.saveConfig = function(data) {
    const self = this;
    self.logger.info(logPrefix +'RAW CONFIG DATA:', JSON.stringify(data, null, 2));
    actions.forEach(action => {
        const enabledKey = action + 'Enabled';
        const pinKey = action + 'Pin';
        self.logger.info(logPrefix +`Checking keys for ${action}: ${enabledKey}, ${pinKey}`);
        if (data[enabledKey] !== undefined && data[pinKey] !== undefined) {
            self.config.set(`${action}.enabled`, data[enabledKey]);
            self.config.set(`${action}.pin`, data[pinKey].value);
            self.config.set(`${action}.value`, 1);
            self.logger.info(logPrefix +`✅ Saved ${action}: Enabled=${data[enabledKey]}, Pin=${data[pinKey].value}`);
            self.commandRouter.pushToastMessage('success', "✅ GPIO-Buttons", "Configuration saved");

        } else {
            self.logger.error(logPrefix +`❌ Missing data for ${action} (check UI config IDs)`);
        }
    });

    self.clearTriggers().then(() => self.createTriggers());
};

GPIOButtons.prototype.createTriggers = function() {
    const self = this;
    const defer = libQ.defer();

    this.clearTriggers();
    this.logger.info(logPrefix + "Initializing GPIO triggers...");

    actions.forEach(action => {
        const enabled = this.config.get(`${action}.enabled`);
        const pin = parseInt(this.config.get(`${action}.pin`), 10);

        if (enabled && !isNaN(pin) && pin >= 2 && pin <= 27) {
            try {
                const handler = (state, edge) => {
                    self.logger.debug(logPrefix + `GPIO${pin} state=${state}, edge=${edge}`);
                    if (state === 0) { // Falling edge (pull-up -> pressed to ground)
                        self.listener(action);
                    }
                };

                gpiox.watch_gpio(
                    pin,
                    gpiox.GPIO_MODE_INPUT_PULLUP,
                    DEBOUNCE_US,
                    gpiox.GPIO_EDGE_FALLING, // Use falling edge for button press
                    handler
                );

                this.triggers.set(pin, handler);
                this.logger.info(logPrefix + `✅ GPIO${pin} configured for ${action}`);
            } catch (err) {
                this.logger.error(logPrefix + `❌ GPIO${pin} init failed: ${err.message}`);
            }
        }
    });

    defer.resolve();
    return defer.promise;
};

GPIOButtons.prototype.clearTriggers = function() {
    this.triggers.forEach((_, pin) => {
        gpiox.deinit_gpio(pin);
        this.logger.info(logPrefix + `Released GPIO${pin}`);
    });
    this.triggers.clear();
    return libQ.resolve();
};

// Modified listener to match watch.js pattern
GPIOButtons.prototype.listener = function(action) {
    this.logger.info(logPrefix + `🔥 ${action.toUpperCase()} TRIGGERED`);
    switch(action) {
        case 'playPause': this.playPause(); break;
        case 'volumeUp': this.volumeUp(); break;
        case 'volumeDown': this.volumeDown(); break;
        case 'previous': this.previous(); break;
        case 'next': this.next(); break;
        case 'shutdown': this.shutdown(); break;
    }
};

GPIOButtons.prototype.playPause = function() {
    const self = this;
    self.logger.info(logPrefix + 'GPIO-Buttons: playPause triggered');
    socket.emit('getState', '');
    socket.once('pushState', state => {
        if (state.status === 'play' && state.service === 'webradio') {
            socket.emit('stop');
        } else if (state.status === 'play') {
            socket.emit('pause');
        } else {
            socket.emit('play');
        }
    });
};

GPIOButtons.prototype.next = function() { socket.emit('next'); };
GPIOButtons.prototype.previous = function() { socket.emit('prev'); };
GPIOButtons.prototype.volumeUp = function() { socket.emit('volume', '+'); };
GPIOButtons.prototype.volumeDown = function() { socket.emit('volume', '-'); };
GPIOButtons.prototype.shutdown = function() { this.commandRouter.shutdown(); };