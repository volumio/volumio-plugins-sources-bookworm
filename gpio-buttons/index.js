'use strict';

/**
 * GPIO Buttons Plugin for Volumio 4
 * 
 * This plugin allows physical GPIO buttons to control Volumio playback
 * and execute custom WebSocket commands to any plugin.
 * 
 * FEATURES:
 * - 6 configurable buttons (button1-button6)
 * - Standard actions: playPause, volumeUp, volumeDown, previous, next, shutdown
 * - Custom emit action: call any plugin method via WebSocket
 * 
 * CUSTOM EMIT USAGE:
 * To call a plugin method, set action to "emit" and configure:
 * - emitCommand: Usually "callMethod" for plugin calls
 * - emitEndpoint: Plugin endpoint, e.g., "user_interface/randomizer"
 * - emitMethod: Method name, e.g., "randomAlbum"
 * - emitData: JSON string with data payload, e.g., "{}" or '{"key":"value"}'
 * 
 * EXAMPLE - Random Album Button:
 * - action: emit
 * - emitCommand: callMethod
 * - emitEndpoint: user_interface/randomizer
 * - emitMethod: randomAlbum
 * - emitData: {}
 * 
 * HARDWARE:
 * - Buttons should connect GPIO pin to GND when pressed
 * - Internal pull-up resistors are enabled
 * - Trigger on falling edge (button press)
 * 
 * SOCKET.IO NOTE:
 * Volumio 4 uses socket.io server v1.7.4. This plugin MUST use
 * socket.io-client v1.7.4 to match. Higher versions cause parser
 * protocol mismatch and silent WebSocket failures.
 * 
 * @author tomatpasser, Darmur, foonerd
 * @version 1.9.0
 */

const libQ = require('kew');
const io = require('socket.io-client');
const gpiox = require('@iiot2k/gpiox');

// Configuration constants
const NUM_BUTTONS = 6;
const DEBOUNCE_US = 1000; // microseconds
const LOG_PREFIX = 'gpio-buttons: ';

// Valid actions for buttons
const VALID_ACTIONS = [
    'playPause',
    'volumeUp',
    'volumeDown',
    'previous',
    'next',
    'shutdown',
    'emit'  // Custom WebSocket emit
];

// Socket connection - connects to local Volumio instance
// IMPORTANT: Must use socket.io-client 1.7.4 to match Volumio server
const socket = io.connect('http://localhost:3000');

module.exports = GPIOButtons;

/**
 * Plugin constructor
 * @param {Object} context - Volumio plugin context
 */
function GPIOButtons(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.triggers = new Map(); // Store pin handlers: Map<pin, handler>
}

/**
 * Called when Volumio starts - load configuration
 */
GPIOButtons.prototype.onVolumioStart = function() {
    var self = this;
    
    self.config = new (require('v-conf'))();
    self.config.loadFile(self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json'));
    
    // Socket connection event handlers for debugging
    socket.on('connect', function() {
        self.logger.info(LOG_PREFIX + 'Socket connected to Volumio');
    });
    
    socket.on('connect_error', function(err) {
        self.logger.error(LOG_PREFIX + 'Socket connection error: ' + err.message);
    });
    
    socket.on('disconnect', function(reason) {
        self.logger.warn(LOG_PREFIX + 'Socket disconnected: ' + reason);
    });
    
    socket.on('reconnect', function(attemptNumber) {
        self.logger.info(LOG_PREFIX + 'Socket reconnected after ' + attemptNumber + ' attempts');
    });
    
    self.logger.info(LOG_PREFIX + 'Initialized');
    return libQ.resolve();
};

GPIOButtons.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

/**
 * Called when plugin starts - setup GPIO triggers
 */
GPIOButtons.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();

    self.createTriggers()
        .then(function() {
            self.logger.info(LOG_PREFIX + 'Started successfully');
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error(LOG_PREFIX + 'Startup failed: ' + err);
            defer.reject(err);
        });

    return defer.promise;
};

/**
 * Called when plugin stops - cleanup GPIO triggers
 */
GPIOButtons.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.clearTriggers()
        .then(function() {
            self.logger.info(LOG_PREFIX + 'Stopped');
            defer.resolve();
        });

    return defer.promise;
};

// Required plugin interface methods (no-op implementations)
GPIOButtons.prototype.onRestart = function() {};
GPIOButtons.prototype.onInstall = function() {};
GPIOButtons.prototype.onUninstall = function() {};
GPIOButtons.prototype.getConf = function(varName) {};
GPIOButtons.prototype.setConf = function(varName, varValue) {};
GPIOButtons.prototype.getAdditionalConf = function(type, controller, data) {};
GPIOButtons.prototype.setAdditionalConf = function() {};

/**
 * Build and return UI configuration
 */
GPIOButtons.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    self.logger.info(LOG_PREFIX + 'Loading UI config');

    var lang_code = 'en';

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // Populate values for each button section
        for (var i = 0; i < NUM_BUTTONS; i++) {
            var buttonKey = 'button' + (i + 1);
            var section = uiconf.sections[i];
            
            // enabled switch
            section.content[0].value = self.config.get(buttonKey + '.enabled');
            
            // pin select
            var pinValue = self.config.get(buttonKey + '.pin');
            section.content[1].value.value = pinValue;
            section.content[1].value.label = pinValue.toString();
            
            // action select
            var actionValue = self.config.get(buttonKey + '.action');
            section.content[2].value.value = actionValue;
            section.content[2].value.label = self.getActionLabel(actionValue);
            
            // emit fields
            section.content[3].value = self.config.get(buttonKey + '.emitCommand') || 'callMethod';
            section.content[4].value = self.config.get(buttonKey + '.emitEndpoint') || '';
            section.content[5].value = self.config.get(buttonKey + '.emitMethod') || '';
            section.content[6].value = self.config.get(buttonKey + '.emitData') || '{}';
        }
        
        defer.resolve(uiconf);
    })
    .fail(function() {
        defer.reject(new Error());
    });

    return defer.promise;
};

/**
 * Get display label for action value
 */
GPIOButtons.prototype.getActionLabel = function(action) {
    var labels = {
        'playPause': 'Play/Pause',
        'volumeUp': 'Volume Up',
        'volumeDown': 'Volume Down',
        'previous': 'Previous Track',
        'next': 'Next Track',
        'shutdown': 'Shutdown',
        'emit': 'Custom Emit'
    };
    return labels[action] || action;
};

/**
 * Save configuration from UI
 * @param {Object} data - Form data from UI
 */
GPIOButtons.prototype.saveConfig = function(data) {
    var self = this;
    
    self.logger.info(LOG_PREFIX + 'Saving config: ' + JSON.stringify(data));
    
    // Determine which button is being saved from the data keys
    var buttonNum = null;
    for (var i = 1; i <= NUM_BUTTONS; i++) {
        if (data['button' + i + 'Enabled'] !== undefined) {
            buttonNum = i;
            break;
        }
    }
    
    if (buttonNum === null) {
        self.logger.error(LOG_PREFIX + 'Could not determine button number from data');
        return;
    }
    
    var buttonKey = 'button' + buttonNum;
    var prefix = buttonKey;
    
    // Save all fields for this button
    self.config.set(buttonKey + '.enabled', data[prefix + 'Enabled']);
    self.config.set(buttonKey + '.pin', data[prefix + 'Pin'].value);
    self.config.set(buttonKey + '.action', data[prefix + 'Action'].value);
    self.config.set(buttonKey + '.emitCommand', data[prefix + 'EmitCommand'] || 'callMethod');
    self.config.set(buttonKey + '.emitEndpoint', data[prefix + 'EmitEndpoint'] || '');
    self.config.set(buttonKey + '.emitMethod', data[prefix + 'EmitMethod'] || '');
    self.config.set(buttonKey + '.emitData', data[prefix + 'EmitData'] || '{}');
    
    self.logger.info(LOG_PREFIX + 'Saved ' + buttonKey + ': action=' + data[prefix + 'Action'].value);
    
    self.commandRouter.pushToastMessage('success', 'GPIO Buttons', 'Configuration saved for Button ' + buttonNum);
    
    // Recreate triggers with new config
    self.clearTriggers().then(function() {
        self.createTriggers();
    });
};

/**
 * Setup GPIO triggers for all enabled buttons
 */
GPIOButtons.prototype.createTriggers = function() {
    var self = this;
    var defer = libQ.defer();

    self.clearTriggers();
    self.logger.info(LOG_PREFIX + 'Creating GPIO triggers...');

    for (var i = 1; i <= NUM_BUTTONS; i++) {
        var buttonKey = 'button' + i;
        var enabled = self.config.get(buttonKey + '.enabled');
        var pin = parseInt(self.config.get(buttonKey + '.pin'), 10);

        if (enabled && !isNaN(pin) && pin >= 2 && pin <= 27) {
            self.setupButtonTrigger(buttonKey, pin);
        }
    }

    defer.resolve();
    return defer.promise;
};

/**
 * Setup GPIO trigger for a single button
 * @param {string} buttonKey - Button identifier (button1-button6)
 * @param {number} pin - GPIO pin number
 */
GPIOButtons.prototype.setupButtonTrigger = function(buttonKey, pin) {
    var self = this;
    
    try {
        var handler = function(state, edge) {
            self.logger.debug(LOG_PREFIX + 'GPIO' + pin + ' state=' + state + ', edge=' + edge);
            if (state === 0) { // Falling edge (pull-up -> pressed to ground)
                self.executeAction(buttonKey);
            }
        };

        gpiox.watch_gpio(
            pin,
            gpiox.GPIO_MODE_INPUT_PULLUP,
            DEBOUNCE_US,
            gpiox.GPIO_EDGE_FALLING,
            handler
        );

        self.triggers.set(pin, handler);
        var action = self.config.get(buttonKey + '.action');
        self.logger.info(LOG_PREFIX + 'GPIO' + pin + ' configured: ' + buttonKey + ' -> ' + action);
    } catch (err) {
        self.logger.error(LOG_PREFIX + 'GPIO' + pin + ' init failed: ' + err.message);
    }
};

/**
 * Remove all GPIO triggers
 */
GPIOButtons.prototype.clearTriggers = function() {
    var self = this;
    
    self.triggers.forEach(function(handler, pin) {
        gpiox.deinit_gpio(pin);
        self.logger.info(LOG_PREFIX + 'Released GPIO' + pin);
    });
    self.triggers.clear();
    
    return libQ.resolve();
};

/**
 * Execute the configured action for a button
 * @param {string} buttonKey - Button identifier (button1-button6)
 */
GPIOButtons.prototype.executeAction = function(buttonKey) {
    var self = this;
    var action = self.config.get(buttonKey + '.action');
    
    self.logger.info(LOG_PREFIX + buttonKey + ' triggered: ' + action);
    
    switch (action) {
        case 'playPause':
            self.doPlayPause();
            break;
        case 'volumeUp':
            self.doVolumeUp();
            break;
        case 'volumeDown':
            self.doVolumeDown();
            break;
        case 'previous':
            self.doPrevious();
            break;
        case 'next':
            self.doNext();
            break;
        case 'shutdown':
            self.doShutdown();
            break;
        case 'emit':
            self.doCustomEmit(buttonKey);
            break;
        default:
            self.logger.warn(LOG_PREFIX + 'Unknown action: ' + action);
    }
};

/**
 * Play/Pause toggle - handles webradio specially (stop instead of pause)
 */
GPIOButtons.prototype.doPlayPause = function() {
    var self = this;
    self.logger.info(LOG_PREFIX + 'Action: playPause');
    
    socket.emit('getState', '');
    socket.once('pushState', function(state) {
        if (state.status === 'play' && state.service === 'webradio') {
            socket.emit('stop');
        } else if (state.status === 'play') {
            socket.emit('pause');
        } else {
            socket.emit('play');
        }
    });
};

/**
 * Volume up
 */
GPIOButtons.prototype.doVolumeUp = function() {
    this.logger.info(LOG_PREFIX + 'Action: volumeUp');
    socket.emit('volume', '+');
};

/**
 * Volume down
 */
GPIOButtons.prototype.doVolumeDown = function() {
    this.logger.info(LOG_PREFIX + 'Action: volumeDown');
    socket.emit('volume', '-');
};

/**
 * Previous track
 */
GPIOButtons.prototype.doPrevious = function() {
    this.logger.info(LOG_PREFIX + 'Action: previous');
    socket.emit('prev');
};

/**
 * Next track
 */
GPIOButtons.prototype.doNext = function() {
    this.logger.info(LOG_PREFIX + 'Action: next');
    socket.emit('next');
};

/**
 * System shutdown
 */
GPIOButtons.prototype.doShutdown = function() {
    this.logger.info(LOG_PREFIX + 'Action: shutdown');
    this.commandRouter.shutdown();
};

/**
 * Custom WebSocket emit - call any plugin method
 * 
 * This allows buttons to trigger any plugin functionality via WebSocket.
 * 
 * CONFIGURATION:
 * - emitCommand: The socket event name (usually "callMethod" for plugins)
 * - emitEndpoint: Plugin endpoint path (e.g., "user_interface/randomizer")
 * - emitMethod: Method name to call (e.g., "randomAlbum")
 * - emitData: JSON string with additional data (e.g., "{}" or '{"param":"value"}')
 * 
 * EXAMPLE - Randomizer Plugin:
 * - emitCommand: callMethod
 * - emitEndpoint: user_interface/randomizer
 * - emitMethod: randomAlbum
 * - emitData: {}
 * 
 * This will emit:
 * socket.emit('callMethod', {
 *     endpoint: 'user_interface/randomizer',
 *     method: 'randomAlbum',
 *     data: {}
 * });
 * 
 * @param {string} buttonKey - Button identifier to get config from
 */
GPIOButtons.prototype.doCustomEmit = function(buttonKey) {
    var self = this;
    
    var emitCommand = self.config.get(buttonKey + '.emitCommand') || 'callMethod';
    var emitEndpoint = self.config.get(buttonKey + '.emitEndpoint') || '';
    var emitMethod = self.config.get(buttonKey + '.emitMethod') || '';
    var emitDataStr = self.config.get(buttonKey + '.emitData') || '{}';
    
    self.logger.info(LOG_PREFIX + 'Custom emit: ' + emitCommand);
    self.logger.info(LOG_PREFIX + '  endpoint: ' + emitEndpoint);
    self.logger.info(LOG_PREFIX + '  method: ' + emitMethod);
    self.logger.info(LOG_PREFIX + '  data: ' + emitDataStr);
    
    // Validate required fields
    if (!emitEndpoint || !emitMethod) {
        self.logger.error(LOG_PREFIX + 'Custom emit requires endpoint and method');
        self.commandRouter.pushToastMessage('error', 'GPIO Buttons', 'Custom emit requires endpoint and method');
        return;
    }
    
    // Parse data JSON
    var emitData;
    try {
        emitData = JSON.parse(emitDataStr);
    } catch (e) {
        self.logger.error(LOG_PREFIX + 'Invalid JSON in emitData: ' + e.message);
        self.commandRouter.pushToastMessage('error', 'GPIO Buttons', 'Invalid JSON in emit data');
        return;
    }
    
    // Build payload for callMethod
    if (emitCommand === 'callMethod') {
        var payload = {
            endpoint: emitEndpoint,
            method: emitMethod,
            data: emitData
        };
        self.logger.info(LOG_PREFIX + 'Emitting callMethod: ' + JSON.stringify(payload));
        socket.emit('callMethod', payload);
    } else {
        // For other commands, emit directly with parsed data
        self.logger.info(LOG_PREFIX + 'Emitting ' + emitCommand + ': ' + JSON.stringify(emitData));
        socket.emit(emitCommand, emitData);
    }
};
