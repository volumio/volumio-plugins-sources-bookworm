'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const net = require('node:net');

const EventEmitter = require('events').EventEmitter;
const io = require('socket.io-client');
const socket = require('socket.io-client/lib/socket');
const reIP = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

module.exports = serialampcontroller;
function serialampcontroller(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}



serialampcontroller.prototype.onVolumioStart = function() {
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);
    this.messageReceived = new EventEmitter();


    return libQ.resolve();
}

serialampcontroller.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();
    //set some important parameters
	self.debugLogging = (self.config.get('logging')==true);
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] onStart: config: ' + JSON.stringify(self.config));    
	self.loadI18nStrings(); 
    self.volume = {}; //global Volume-object for exchanging data with volumio
    self.ampStatus = {}; //global Object for storing the status of the amp
    self.ampStatus.volume = self.config.get('startupVolume');        
    self.ampStatus.mute = false;
    self.serialDevices = {};
    self.portOpen = false;
    self.status = 'stop';
    self.autoReconnect = false;
    self.ampStatus.power='off';
    self.powerupAtVolumioStart = self.config.get('powerupOnBoot');

    self.loadAmpDefinitions() //load amp definitions from file
    .then(_=> self.listSerialDevices()) //initialize list of serial devices available to the system
    .then(_ => self.setActiveAmp()) // set the active amp
    .then(_=> self.activate())
    .then(function(){
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] onStart: successfully started plugin');
            defer.resolve();
    })
    .fail(err => {
        self.logger.error('[SERIALAMPCONTROLLER] onStart: ' + err);
        defer.resolve();
    })
    return defer.promise;
};

serialampcontroller.prototype.activate = function () {
    var self = this;
    var defer = libQ.defer();
    //Check if selected interface is physically available and if selected amp supports selected interface
    if (self.selectedInterfaceExists() && self.selectedAmpSupportsInterface()) {
        //Activate Websock listener to react on messages from volumio
        self.activateSocketIO();
        //Open selected interface
        if (self.selectedAmp!==undefined && Object.keys(self.selectedAmp).length>0) {
            if (self.config.get('tcpip') == true) {
                return self.openTcpIp()
            } else {
                return self.openSerialPort()
            }
        } else defer.reject(new Error('Amp not defined yet.'))
        //Activate Parser
        //Activate events
    } else {
        defer.reject(new Error('The selected Interface does not exist or the selected amp does not support it. Check Settings.'))
    }
    return defer.promise;
}

serialampcontroller.prototype.deactivate = function () {
    var self = this;
    var defer = libQ.defer();
    self.closePort();
    if (self.socket !== undefined) self.socket.disconnect();
    self.resetVolumeSettings()
    //Check if selected interface is physically available
    //check if selected amp supports selected interface
    //Activate Websock listener to react on messages from volumio
    //Open selected interface
    //Activate Parser
    //Activate events
}

// Load Amp Definition file and initialize the list of Vendor/Amp for settings
serialampcontroller.prototype.loadAmpDefinitions = function() {
    var self = this;

    var ampDefinitionFile = this.commandRouter.pluginManager.getConfigurationFile(this.context,'ampCommands.json');
    self.ampDefinitions = new(require('v-conf'))();
    self.ampDefinitions.loadFile(ampDefinitionFile);
    // if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] loadAmpDefinitions: loaded AmpDefinitions: ' + JSON.stringify(self.ampDefinitions));
    //Generate list of Amp Names as combination of Vendor + Model
    self.ampVendorModelList = {'RS232':[],'TCPIP':[]};
    for (var n = 0; n < self.ampDefinitions.data.amps.length; n++)
    {
        if (self.ampDefinitions.data.amps[n].interfaces !== undefined) {
            if (self.ampDefinitions.data.amps[n].interfaces.includes('TCP/IP')) {
                self.ampVendorModelList.TCPIP.push(self.ampDefinitions.data.amps[n].vendor + ' - ' + self.ampDefinitions.data.amps[n].model);
            }
            if (self.ampDefinitions.data.amps[n].interfaces.includes('RS232')) {
                self.ampVendorModelList.RS232.push(self.ampDefinitions.data.amps[n].vendor + ' - ' + self.ampDefinitions.data.amps[n].model);
            }
        } else {
            self.ampVendorModelList.RS232.push(self.ampDefinitions.data.amps[n].vendor + ' - ' + self.ampDefinitions.data.amps[n].model);
        }
    };
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] loadAmpDefinitions: loaded AmpDefinitions for ' + self.ampVendorModelList.RS232.length + '(serial) and '+ self.ampVendorModelList.TCPIP.length  + ' (TCP/IP) Amplifiers.');
    return libQ.resolve();
};

//read devices connected to RPi and store in self.serialDevices
serialampcontroller.prototype.listSerialDevices = function() {
    var self = this;
    var defer = libQ.defer();

    SerialPort.list()
    .then(
        ports => {
            self.serialDevices = ports;
            self.serialDevices = self.serialDevices.filter(function(dev){
                return ((dev.pnpId !== undefined || dev.manufacturer !== undefined) && dev.path !== undefined && dev.path !== "/dev/ttyAMA0"); 
            })
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] listSerialDevices: found ' + self.serialDevices.length + ' devices.' + JSON.stringify(self.serialDevices));
            defer.resolve();
        },
        err => {
            self.logger.error('[SERIALAMPCONTROLLER] listSerialDevices: Cannot get list of serial devices - ' + err)
            defer.reject(new Error('Failed to load list serial devices via Serialport.io.'));
        }
    )

    return defer.promise;
};

//Gets called when user changes and saves SerialDevice Settings
serialampcontroller.prototype.updateSerialSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] updateSerialSettings: Saving Interface Settings:' + JSON.stringify(data));
    if (data['tcp_ip'] && !reIP.test(data['ip_address'])) {
        self.commandRouter.pushToastMessage('error', self.getI18nString('TOAST_ERROR'), self.getI18nString('TOAST_INVALID_IP'));
        if (self.debugLogging) self.logger.error('[SERIALAMPCONTROLLER] updateSerialSettings: invalid IP address provided, not saving:' + data['ip_address']);
        defer.resolve();
    } else {
        //check if interface settings did change
        if ((self.config.get('tcpip') !== data['tcp_ip']) || (self.config.get('tcpip') && self.config.get('ipaddress') !== data['ip_address']) || (!self.config.get('tcpip')) && (self.config.get('serialInterfaceDev') !== data['serial_interface_dev'].label)) {
            self.deactivate();
            self.resetVolumeSettings()
            .then(_ => {
                self.config.set('tcpip', (data['tcp_ip']));
                self.config.set('ipaddress', (data['ip_address']));
                self.config.set('serialInterfaceDev', (data['serial_interface_dev'].label));
                self.config.set('ampType','...');
                return self.commandRouter.getUIConfigOnPlugin('system_hardware', 'serialampcontroller', {})})
            .then(config => {
                self.commandRouter.broadcastMessage('pushUiConfig', config)})
            .then(_=> {
                defer.resolve();
                self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_SERIAL_SAVE'));
            })
            .fail(err => {
                self.logger.error('[SERIALAMPCONTROLLER] updateSerialSettings: FAILED ' + err);
                defer.reject(err);
            })
        } else {
            if (self.debugLogging) self.logger.error('[SERIALAMPCONTROLLER] updateSerialSettings: nothing changed - do nothing');
            defer.resolve();
        }
    }
    return defer.promise;
};

//Gets called when user selects and saves Amp Type
serialampcontroller.prototype.updateAmpType = function (data) {
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] updateAmpType: Saving Amplifier Settings:' + JSON.stringify(data));
    self.deactivate();
    self.config.set('ampType', data['amp_type'].label);
    self.config.set('volumioInput', "...");
    self.setActiveAmp();
    return self.commandRouter.getUIConfigOnPlugin('system_hardware', 'serialampcontroller', {})
    .then(config => {self.commandRouter.broadcastMessage('pushUiConfig', config)})
    //configure the serial interface and open it
    .then(_ => {
        self.activate();
    })
    .then(_=> {
        defer.resolve();        
        self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_AMP_TYPE_SAVE'));
    })  
    // return defer.promise;
};

//Gets called when user changes and saves AmpSettings
serialampcontroller.prototype.updateAmpSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] updateAmpSettings: Saving Amplifier Settings:' + JSON.stringify(data));
    // refuse volume settings that can't be right (an empty field, text, a typo like 350 for 35,
    // a minimum above the maximum), so a bad entry can never lift the cap. Nothing is saved then.
    var isLevel = v => Number.isInteger(toLevel(v)) && toLevel(v) >= 0 && toLevel(v) <= 100;
    if (!isLevel(data['max_volume']) || !isLevel(data['min_volume']) || !isLevel(data['startup_volume']) ||
        toLevel(data['min_volume']) > toLevel(data['max_volume'])) {
        self.logger.error('[SERIALAMPCONTROLLER] updateAmpSettings: invalid volume settings, not saved: min ' + data['min_volume'] + ', max ' + data['max_volume'] + ', startup ' + data['startup_volume']);
        self.commandRouter.pushToastMessage('error', self.getI18nString('TOAST_ERROR'), self.getI18nString('TOAST_VOLUME_SETTINGS_INVALID'));
        return libQ.resolve();
    }
    self.config.set('volumioInput', data['volumio_input'].label);
    self.config.set('minVolume', parseInt(data['min_volume']));
    self.config.set('maxVolume', parseInt(data['max_volume']));
    self.config.set('startupVolume',  parseInt(data['startup_volume']));
    self.config.set('volumeSteps', parseInt(data['volume_steps']));
    self.config.set('mapTo100', (data['map_to_100']));
    self.config.set('pauseWhenMuted', (data['pause_when_muted']));
    self.config.set('pauseWhenInputChanged', (data['pause_when_input_changed']));
    self.config.set('switchInputAtPlay', (data['switch_input_at_play']));
    self.config.set('startAtPowerup', (data['start_at_powerup']));
    self.config.set('powerupOnBoot', (data['powerup_on_boot']))
    self.config.set('powerupOnPlay', (data['powerup_on_play']))
    self.commandRouter.getUIConfigOnPlugin('system_hardware', 'serialampcontroller', {})
    .then(config => {self.commandRouter.broadcastMessage('pushUiConfig', config)})
    // //configure the serial interface and open it
    // .then(_ => self.closePort())
    // .then(_ => {
    //     if (self.portType == 'TCPIP') {
    //         return self.openTcpIp()
    //     } else {
    //         return self.openSerialPort()
    //     }
    // })
    //update Volume Settings and announce the updated settings to Volumio
    .then(_ => self.alsavolume(this.config.get('startupVolume')))
    .then(_ => self.initVolumeSettings())
    .then(_=> {
        defer.resolve();        
        self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_AMP_SAVE'));
    })  
    return defer.promise;
};

//Gets called when user changes and saves debug settings
serialampcontroller.prototype.updateDebugSettings = function (data) {
    var self = this;
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] updateDebugSettings: Saving Debug Settings:' + JSON.stringify(data));
    self.config.set('logging', (data['logging']))
    self.debugLogging = data['logging'];
    ;
    self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_DEBUG_SAVE'));
    return libQ.resolve();
};

serialampcontroller.prototype.activateSocketIO = function () {
    var self = this;
    self.socket = io.connect('http://localhost:3000');
	self.socket.emit('getState');
	self.socket.on('pushState',function(data){
        if (data === undefined || data === null) return;
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] on:pushState: ' + (self.volumioStatus !== undefined ? self.volumioStatus.status : 'undefined') + ' -> ' + data.status + ' (service: ' + data.service + ', volume: ' + data.volume + ')');
        // remember the previous state, so that only a start of playback powers the amp on and switches the input
        // (not every 'play' update: track changes, seeks, metadata)
        var wasPlaying = (self.volumioStatus !== undefined && self.volumioStatus.status == 'play');
        self.volumioStatus = data;
        if (data.status == 'play') {
            // still warming up (see startPlaybackHold), e.g. play pressed again in the app: pause again
            if (self.playbackHold !== undefined && self.playbackHold.paused && Date.now() - self.playbackHold.lastPause > 1500) {
                self.playbackHold.lastPause = Date.now();
                self.logger.info('[SERIALAMPCONTROLLER] playbackHold: the amp is still warming up: pausing again');
                self.socket.emit('pause');
            }
            // a new start of playback re-arms automatic power-on after the amp was switched off
            if (!wasPlaying) self.suppressAutoPowerOn = false;
            // treat an unknown power state ('off' = never reported) like standby,
            // so amps that do not answer a power query still get woken up on play.
            // Works for every Volumio source, including Qobuz Connect, Spotify Connect and AirPlay.
            if (self.ampStatus.power != 'on') {
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] on:pushState: amp in standby (or state unknown: ' + self.ampStatus.power + ')');
                if (self.config.get('powerupOnPlay') && !self.powerOnPending && !self.suppressAutoPowerOn) {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] on:pushState: amp in standby - send powerup after play pressed');
                    // only one power-up sequence at a time, until the amp is reported on (or 25s have passed)
                    self.powerOnPending = true;
                    clearTimeout(self.powerOnPendingTimer);
                    self.powerOnPendingTimer = setTimeout(() => { self.powerOnPending = false; }, 25000);
                    // some amps (e.g. McIntosh) reject other commands while waking up: wait before switching input
                    var settleMs = self.selectedAmp.powerOnSettleMs || 0;
                    self.startPlaybackHold(data);
                    self.sendCommand('powerOn')
                    .then(_ => setTimeout(() => {
                        if (self.port === undefined) return;
                        self.sendCommand('source',self.config.get('volumioInput'))
                        .fail(err => self.logger.error('[SERIALAMPCONTROLLER] on:pushState: could not switch input after power-up: ' + err));
                    }, settleMs))
                    .fail(err => self.logger.error('[SERIALAMPCONTROLLER] on:pushState: could not power up the amp: ' + err));
                }
            } else if (!wasPlaying && self.config.get('switchInputAtPlay')) {
                self.sendCommand('source',self.config.get('volumioInput'));
            }
        }
        self.followServiceVolume(data);
	})
}

// follow volume changes made from a streaming service's own app (e.g. the Qobuz app
// while using Qobuz Connect). Such services update Volumio's volume, which shows up in pushState,
// but may not go through this plugin's volume override. "followServiceVolume" in ampCommands.json
// is a regex matched against the state's service, trackType and URI scheme (on Volumio 4 a Qobuz
// track can show up as service "mpd" with trackType "qobuz" and uri "qobuz://..."); leave it out to disable this.
serialampcontroller.prototype.followServiceVolume = function(data) {
    var self = this;
    var pattern = (self.selectedAmp !== undefined) ? self.selectedAmp.followServiceVolume : undefined;
    if (!pattern || data.status != 'play' || typeof data.volume != 'number') return;
    var re = new RegExp(pattern, 'i');
    var uriScheme = (typeof data.uri == 'string' && data.uri.indexOf('://') > 0) ? data.uri.split('://')[0] : undefined;
    var source = [data.service, data.trackType, uriScheme].find(v => v !== undefined && v !== null && re.test(String(v)));
    if (source === undefined) return;
    if (self.ampStatus.power != 'on' || self.parser === undefined || self.port === undefined) return;
    // current amp volume on Volumio's scale (same as getVolumeObject, without its side effects)
    var current = self.ampToVolumio(self.ampStatus.volume);
    if (data.volume === current) return; //already in sync
    var now = Date.now();
    // a value we reported ourselves in the last few seconds, arriving late (e.g. while the knob is turning)
    if ((self.reportedVolumes || []).some(r => r.vol === data.volume && now - r.t < 3000)) return;
    if (self.lastFollowedVolume === data.volume && now - self.lastFollowedTime < 2000) return; //just sent this one
    self.lastFollowedVolume = data.volume;
    self.lastFollowedTime = now;
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] followServiceVolume: ' + source + ' changed volume to ' + data.volume + ' (amp is at ' + current + ')');
    self.alsavolume(data.volume);
}

serialampcontroller.prototype.getAmpStatus = function() {
    var self = this;

    //send some requests to determine the current settings of the amp
    if (self.parser!=undefined && (self.selectedAmp.initCommands !== undefined || self.selectedAmp.commandSpacingMs !== undefined)) {
        // send init commands (e.g. enable status notifications) first,
        // then the status requests one by one with a pause between them
        var requests = (self.selectedAmp.initCommands || []).slice();
        ['reqModel','reqPower','reqVolume','reqMute','reqSource'].forEach(req => {
            if (self.selectedAmp.statusRequests && self.selectedAmp.statusRequests[req]) requests.push(self.selectedAmp.statusRequests[req]);
        });
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getAmpStatus: sending init and status requests to Amp: ' + JSON.stringify(requests));
        return self.writeSequence(requests, self.selectedAmp.commandSpacingMs || 0);
    } else if (self.parser!=undefined) {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getAmpStatus: sending status requests to Amp');
        self.sendStatusRequest('reqModel');
        self.sendStatusRequest('reqPower');
        self.sendStatusRequest('reqVolume');
        self.sendStatusRequest('reqMute');
        self.sendStatusRequest('reqSource');
    } else {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getAmpStatus: listener not yet available');
    }
    return libQ.resolve();
}

// a volume level from the settings or a request: a finite number (number or numeric string), else NaN
function toLevel(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
    return NaN;
}

// the volume window from the settings. Returns undefined if the settings can't be used
// (then no volume command is sent at all: fail closed). If the minimum is above the maximum, the maximum wins.
serialampcontroller.prototype.getVolumeLimits = function() {
    var self = this;
    // v-conf throws if a number setting holds text (e.g. a hand-edited config.json): treat that as unusable too
    var read = key => { try { return self.config.get(key); } catch (e) { return undefined; } };
    var max = toLevel(read('maxVolume'));
    var min = toLevel(read('minVolume'));
    if (!Number.isFinite(max) || max < 0 || max > 100) return undefined;
    max = Math.floor(max); // whole steps only, rounded towards quiet
    min = (Number.isFinite(min) && min > 0) ? Math.ceil(min) : 0;
    return {min: Math.min(min, max), max: max};
}

// unusable volume settings switch volume control off (fail closed); say so on screen, at most once a minute
serialampcontroller.prototype.warnInvalidVolumeSettings = function() {
    var self = this;
    if (self.lastInvalidSettingsToast !== undefined && Date.now() - self.lastInvalidSettingsToast < 60000) return;
    self.lastInvalidSettingsToast = Date.now();
    self.commandRouter.pushToastMessage('error', self.getI18nString('TOAST_ERROR'), self.getI18nString('TOAST_VOLUME_CONTROL_OFF'));
}

// an amp level on Volumio's 0..100 scale (mapTo100), safe for min == max and unusable settings
serialampcontroller.prototype.ampToVolumio = function(level) {
    var self = this;
    var v = toLevel(level);
    if (!Number.isFinite(v)) return 0;
    if (self.config.get('mapTo100')) {
        var limits = self.getVolumeLimits();
        if (limits === undefined) return 0;
        // rounded up: the smallest Volumio value that alsavolume maps back to this same level (it rounds down),
        // so a streaming app sending the reported value back never moves the amp
        v = (limits.max > limits.min) ? Math.ceil((v - limits.min) * 100 / (limits.max - limits.min)) : (v >= limits.max ? 100 : 0);
    }
    return Math.max(0, Math.min(100, Math.floor(v)));
}

// the level the amp is at, or will be at once it has carried out the last volume command
// we sent (whichever is more recent), so several clicks sent before the amp answers can't add up.
serialampcontroller.prototype.expectedVolume = function() {
    var self = this;
    var c = self.lastVolumeCommand;
    if (c !== undefined && c.t >= (self.ampStatus.volumeTime || 0) && Date.now() - c.t < 2000) return c.vol;
    return toLevel(self.ampStatus.volume);
}

// if the amp reports a level above the maximum, set it back to the maximum. Nothing the
// plugin sends can exceed it, but the amp comes back from standby at its last level, which may be from
// before the plugin was installed or from before the maximum was lowered (or the knob/remote was used).
serialampcontroller.prototype.enforceMaxVolume = function() {
    var self = this;
    if (self.selectedAmp === undefined || !self.selectedAmp.enforceMaxVolume) return;
    var limits = self.getVolumeLimits();
    var level = toLevel(self.ampStatus.volume);
    if (limits === undefined || !Number.isFinite(level) || level <= limits.max) return;
    var now = Date.now();
    if (self.lastEnforce !== undefined && now - self.lastEnforce < 500) {
        // just corrected it; look again shortly (at most twice a second, so an amp that doesn't obey can't cause a flood)
        if (self.enforceTimer === undefined) self.enforceTimer = setTimeout(() => { self.enforceTimer = undefined; self.enforceMaxVolume(); }, 500 - (now - self.lastEnforce));
        return;
    }
    self.lastEnforce = now;
    self.logger.info('[SERIALAMPCONTROLLER] enforceMaxVolume: the amp reported volume ' + level + ', above the maximum of ' + limits.max + ': setting it to ' + limits.max);
    self.sendCommand('volValue', limits.max)
    .fail(err => self.logger.error('[SERIALAMPCONTROLLER] enforceMaxVolume: could not set the volume: ' + err));
}

// after a power-up the amp is back at its last level. Ask for it every 500 ms until it answers
// (McIntosh amps reject commands while waking up), so enforceMaxVolume can act as early as possible.
serialampcontroller.prototype.checkVolumeAfterWake = function() {
    var self = this;
    var req = (self.selectedAmp !== undefined && self.selectedAmp.statusRequests !== undefined) ? self.selectedAmp.statusRequests.reqVolume : undefined;
    if (!self.selectedAmp.enforceMaxVolume || !req) return;
    clearTimeout(self.wakeCheckTimer);
    var since = Date.now();
    var until = since + (self.selectedAmp.powerOnSettleMs || 0) + 5000;
    var ask = function() {
        if (self.port === undefined || (self.ampStatus.volumeTime || 0) > since || Date.now() > until) return;
        self.port.write(req, 'ascii', err => {
            if (err) self.logger.error('[SERIALAMPCONTROLLER] checkVolumeAfterWake: Failed to send "' + req + '": ' + err);
        });
        self.wakeCheckTimer = setTimeout(ask, 500);
    };
    self.wakeCheckTimer = setTimeout(ask, 200);
}

// "holdPlaybackWhileWaking" in ampCommands.json: the MA352 un-mutes at the end of its ~16 s tube
// warm-up at its remembered level and only then carries out commands sent during the warm-up, so a remembered
// level above the maximum was audible for ~0.1 s (tested 2026-11-06). So when playback wakes the amp, no signal
// may reach it while it un-mutes above the maximum. Two ways, depending on the source:
// - full hold (Volumio's own queue and the volatile sources in HOLD_RESUMABLE_VOLATILE): pause at once, and press
//   play again when the warm-up is over and the amp has reported a level at or below the maximum. The start of the
//   track isn't lost in the warm-up either.
// - safety-only hold (every other volatile source): these can't be relied on to resume after a ~17 s pause. AirPlay
//   (shairport-sync 3.3 on Volumio 4.239) ends its session ~3 s after a pause and drops its remote control link
//   ~10 s later, so nothing but the sending device can restart it (tested 2026-11-07). They keep playing while the
//   amp warms up (muted), and are paused only if the amp wakes up above the maximum (or doesn't report its level
//   within HOLD_QUIET_MS); then a message asks the user to press play once the amp is ready.
// Bounded: ends at the resume, at the decision not to pause, or after HOLD_GIVE_UP_MS (paused, with a message).
var HOLD_QUIET_MS = 2000;    // reports in the first 2 s after the power-on reply are the wake-up dump, not the end of the warm-up
var HOLD_SETTLE_MS = 1000;   // resume this long after the last report at or below the maximum
var HOLD_GIVE_UP_MS = 40000;
var HOLD_RESUMABLE_VOLATILE = ['qobuzconnect']; // tested: pauses and resumes at the same position with 'volatilePlay'
var HOLD_SAFETY_ONLY = ['airplay_emulation'];   // even before Volumio marks it volatile (it does so ~1 s after AirPlay starts)
serialampcontroller.prototype.startPlaybackHold = function(state) {
    var self = this;
    if (self.selectedAmp === undefined || !self.selectedAmp.holdPlaybackWhileWaking) return;
    self.endPlaybackHold();
    var volatile = state !== undefined && state.volatile === true;
    var hold = self.playbackHold = { started: Date.now(), service: state !== undefined ? state.service : undefined,
        full: (!volatile || HOLD_RESUMABLE_VOLATILE.indexOf(state.service) >= 0) && !(state !== undefined && HOLD_SAFETY_ONLY.indexOf(state.service) >= 0),
        paused: false };
    if (hold.full) self.playbackHoldPause(hold, 'pausing playback until the amp has warmed up at a safe volume');
    else self.logger.info('[SERIALAMPCONTROLLER] playbackHold: ' + hold.service + ' keeps playing while the amp warms up, unless it wakes up above the maximum');
    hold.giveUpTimer = setTimeout(() => {
        if (self.playbackHold !== hold) return;
        self.endPlaybackHold();
        if (!hold.paused) return;
        self.logger.error('[SERIALAMPCONTROLLER] playbackHold: the amp did not report a volume at or below the maximum after waking; playback stays paused');
        self.commandRouter.pushToastMessage('error', self.getI18nString('TOAST_ERROR'), self.getI18nString('TOAST_PLAYBACK_HELD'));
    }, HOLD_GIVE_UP_MS);
}

serialampcontroller.prototype.playbackHoldPause = function(hold, why) {
    var self = this;
    hold.paused = true;
    hold.lastPause = Date.now();
    self.logger.info('[SERIALAMPCONTROLLER] playbackHold: ' + why);
    self.socket.emit('pause');
}

serialampcontroller.prototype.endPlaybackHold = function() {
    var self = this;
    var hold = self.playbackHold;
    if (hold === undefined) return;
    clearTimeout(hold.giveUpTimer); clearTimeout(hold.resumeTimer); clearTimeout(hold.askTimer); clearTimeout(hold.quietTimer);
    self.playbackHold = undefined;
}

// on respPowerOn: start asking for the volume. The MA352 holds its replies during the warm-up and sends them all
// at its end, so the answers to these queries mark the end of the warm-up (and carry the level the amp is at).
serialampcontroller.prototype.playbackHoldAmpAwake = function() {
    var self = this;
    var hold = self.playbackHold;
    if (hold === undefined || hold.wokeAt !== undefined) return;
    hold.wokeAt = Date.now();
    var req = self.selectedAmp.statusRequests !== undefined ? self.selectedAmp.statusRequests.reqVolume : undefined;
    var ask = function() {
        if (self.playbackHold !== hold || self.port === undefined || !req) return;
        self.port.write(req, 'ascii', err => { if (err) self.logger.error('[SERIALAMPCONTROLLER] playbackHold: Failed to send "' + req + '": ' + err); });
        hold.askTimer = setTimeout(ask, 2000);
    };
    hold.askTimer = setTimeout(ask, HOLD_QUIET_MS + 500);
    // safety-only hold: no level reported right after waking (the MA352 sends it in its wake-up dump) -> unknown, so pause
    if (!hold.full) hold.quietTimer = setTimeout(() => {
        if (self.playbackHold === hold && !hold.paused && !hold.levelSeen) {
            hold.manualResume = true;
            self.playbackHoldPause(hold, 'the amp did not report its volume after waking: pausing playback until it has warmed up');
        }
    }, HOLD_QUIET_MS);
}

// on respVolume
serialampcontroller.prototype.playbackHoldVolumeReport = function() {
    var self = this;
    var hold = self.playbackHold;
    if (hold === undefined || hold.wokeAt === undefined) return;
    var limits = self.getVolumeLimits();
    var level = toLevel(self.ampStatus.volume);
    var safe = limits !== undefined && Number.isFinite(level) && level <= limits.max;
    if (!hold.full && !hold.levelSeen && !hold.paused) {
        // safety-only hold: the first report after waking is the level the amp will un-mute at
        hold.levelSeen = true;
        if (safe) {
            self.logger.info('[SERIALAMPCONTROLLER] playbackHold: the amp woke up at volume ' + level + ' (maximum ' + limits.max + '): ' + hold.service + ' keeps playing');
            self.endPlaybackHold();
            return;
        }
        hold.manualResume = true;
        self.playbackHoldPause(hold, 'the amp woke up above the maximum: pausing ' + hold.service + ' until it has warmed up');
        return;
    }
    if (!hold.paused || Date.now() - hold.wokeAt < HOLD_QUIET_MS) return;
    clearTimeout(hold.resumeTimer);
    if (!safe) return; // enforceMaxVolume is on it; wait for the next report
    hold.resumeTimer = setTimeout(() => {
        if (self.playbackHold !== hold) return;
        var limitsNow = self.getVolumeLimits();
        var levelNow = toLevel(self.ampStatus.volume);
        if (limitsNow === undefined || !Number.isFinite(levelNow) || levelNow > limitsNow.max) return;
        self.endPlaybackHold();
        var paused = self.volumioStatus !== undefined && self.volumioStatus.status == 'pause';
        // a paused "volatile" source (Qobuz Connect, ...) resumes with volatilePlay: Volumio's 'play' ends that
        // session and plays Volumio's own queue instead (seen with Qobuz Connect on 4.239); 'play' resumes the queue
        var resume = (paused && self.volumioStatus.volatile === true) ? 'volatilePlay' : 'play';
        self.logger.info('[SERIALAMPCONTROLLER] playbackHold: the amp has warmed up at volume ' + levelNow + ' (maximum ' + limitsNow.max + ')' + (paused ? ': resuming playback (' + resume + ')' : ''));
        if (hold.manualResume) {
            // a source that may not resume by itself (AirPlay ends its session when paused): try, and tell the user
            if (paused && self.volumioStatus.volatile === true && self.volumioStatus.service === hold.service) self.socket.emit('volatilePlay');
            self.commandRouter.pushToastMessage('warning', self.getI18nString('TOAST_PLAYBACK_PAUSED_TITLE'), self.getI18nString('TOAST_PLAYBACK_PRESS_PLAY'));
            return;
        }
        if (paused) self.socket.emit(resume);
    }, HOLD_SETTLE_MS);
}

// write a list of raw command strings to the amp, waiting delayMs between them.
// Always resolves (errors are logged), so it can be used safely inside promise chains.
serialampcontroller.prototype.writeSequence = function(strings, delayMs) {
    var self = this;
    var defer = libQ.defer();
    var list = (strings || []).filter(s => typeof s === 'string' && s !== '');
    var writeNext = function(i) {
        if (i >= list.length || self.port === undefined) {
            defer.resolve();
            return;
        }
        self.port.write(list[i], 'ascii', function(err) {
            if (err) {
                self.logger.error('[SERIALAMPCONTROLLER] writeSequence: Failed to send "' + list[i] + '": ' + err);
            } else if (self.debugLogging) {
                self.logger.info('[SERIALAMPCONTROLLER] writeSequence: sent "' + list[i] + '"');
            }
            setTimeout(() => writeNext(i + 1), delayMs || 0);
        });
    };
    writeNext(0);
    return defer.promise;
}

serialampcontroller.prototype.setActiveAmp = function() {
    var self = this;
    var tcpIp = false;
    var ampType = '';
    if ((self.config.get('tcpip')!==undefined)) {
        tcpIp = self.config.get('tcpip')
    }
    self.selectedAmp = {}
    ampType = self.config.get('ampType')
    if ((ampType!==undefined) && (ampType!=='...'))  {
        self.selectedAmp = self.ampDefinitions.data.amps.find((amp) => {
            if (tcpIp) {
                return (((amp.vendor + ' - ' + amp.model) == ampType) && (amp.interfaces!==undefined) && (amp.interfaces.includes('TCP/IP')))
            } else {
                return (((amp.vendor + ' - ' + amp.model) == ampType) && ((amp.interfaces==undefined) || (amp.interfaces.includes('RS232'))))
            }
        });
        if (self.selectedAmp !== undefined) {
            //save all possible responses that can be received in an array, currently not yet used
            self.responses = [];
            self.selectedAmp.responses.forEach(obj => {
                self.responses.push(obj.cmd)
            })
            if (self.debugLogging) {
                self.logger.info('[SERIALAMPCONTROLLER] setActiveAmp: ' + JSON.stringify(self.selectedAmp));
                self.logger.info('[SERIALAMPCONTROLLER] setActiveAmp: can send these responses: ' + self.responses);
            }
        } else {
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] setActiveAmp: Found no configuration for "' + ampType +'" and interface '+ (tcpIp?"TCP/IP":"RS232"));
            self.selectedAmp = {}
        }
    } else {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] setActiveAmp: not yet configured');
        self.selectedAmp = {};
    }
}

serialampcontroller.prototype.getConfigurationFiles = function() {
	return ['config.json','ampCommands.json'];
}

serialampcontroller.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

    self.deactivate()
    // // self.socket.off('pushState');
    // self.closePort()
    // .then(_ => {
    //     // self.resetVolumeSettings();
    //     defer.resolve();
    // })
    // .fail(err => {
    //     if (self.debugLogging) self.logger.error('[SERIALAMPCONTROLLER] onStop: failed to stop plugin: ' + err); 
    //     defer.resolve()       
    // })
    // return defer.promise;
    return defer.resolve();
};


serialampcontroller.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};


// Configuration Methods -----------------------------------------------------------------------------

serialampcontroller.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var selected = 0;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    var tcpIp = self.config.get('tcpip');
    if (tcpIp == undefined) tcpIp = false;
    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            //serial_interface section
            var serialFromConfig = self.config.get('serialInterfaceDev')
            selected = 0;
            let devLabel = '';
            uiconf.sections[0].content[0].value = tcpIp;
            var ip = self.config.get('ipaddress');
            if (ip == undefined) ip = '127.0.0.1'
            uiconf.sections[0].content[2].value = ip;
            for (var n = 0; n < self.serialDevices.length; n++)
            {
                if (self.serialDevices[n].pnpId != undefined) {
                    devLabel = self.serialDevices[n].pnpId
                } else if (self.serialDevices[n].manufacturer != undefined){
                    devLabel = self.serialDevices[n].manufacturer
                } else {
                    self.logger.error('[SERIALAMPCONTROLLER] getUIConfig: serialDevice has no pnpId and no Manufacturer name.');
                }
                self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[1].options', {
                    value: n+1,
                    label: devLabel
                });
                if (devLabel == serialFromConfig) {
                    selected = n+1;
                }
            };
            if (selected > 0) {
                uiconf.sections[0].content[1].value.value = selected;
                uiconf.sections[0].content[1].value.label = serialFromConfig;                
            } 

            // amp_type section
            var ampFromConfig = self.config.get('ampType');
            selected = 0;
            // filter amps by interface
            var usableModels = [];
            if (tcpIp) {
                usableModels = self.ampVendorModelList.TCPIP
            } else {
                usableModels = self.ampVendorModelList.RS232
            }
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getUIConfig: interface: ' + (tcpIp?'TCP/IP':'RS232') + '; amps: ' + JSON.stringify(usableModels) + 'selected: ' + ampFromConfig);
            for (var n = 0; n < usableModels.length; n++)
            {
                self.configManager.pushUIConfigParam(uiconf, 'sections[1].content[0].options', {
                    value: n+1,
                    label: usableModels[n]
                });
                if (usableModels[n] === ampFromConfig) {
                    selected = n+1;
                }
            };
            if (selected >= 0) {
                uiconf.sections[1].content[0].value.value = selected;
                uiconf.sections[1].content[0].value.label = ampFromConfig;                
            }
            // amp_settings section
            //populate input selector drop-down
            if (ampFromConfig !== "..." && self.selectedAmp !== undefined && self.selectedAmp.sources !== undefined) {
                selected = 0;
                for (var n = 0; n < self.selectedAmp.sources.length; n++)
                {
                    self.configManager.pushUIConfigParam(uiconf, 'sections[2].content[0].options', {
                        value: n+1,
                        label: self.selectedAmp.sources[n]
                    });
                    if (self.config.get('volumioInput')==self.selectedAmp.sources[n]) {
                        selected = n+1;
                    }
                };       
                if (selected > 0) {
                    uiconf.sections[2].content[0].value.value = selected;
                    uiconf.sections[2].content[0].value.label = self.config.get('volumioInput');                
                }
            } 
            //min, max and start volume
			uiconf.sections[2].content[1].value = (self.config.get('minVolume'));
			uiconf.sections[2].content[2].value = (self.config.get('maxVolume'));
			uiconf.sections[2].content[3].value = (self.config.get('startupVolume'));
			uiconf.sections[2].content[4].value = (self.config.get('volumeSteps'));
			uiconf.sections[2].content[5].value = (self.config.get('mapTo100')==true);
			uiconf.sections[2].content[6].value = (self.config.get('pauseWhenMuted')==true);
			uiconf.sections[2].content[7].value = (self.config.get('pauseWhenInputChanged')==true);
			uiconf.sections[2].content[8].value = (self.config.get('switchInputAtPlay')==true);
			uiconf.sections[2].content[9].value = (self.config.get('startAtPowerup')==true);
			uiconf.sections[2].content[10].value = (self.config.get('powerupOnPlay')==true);
			uiconf.sections[2].content[11].value = (self.config.get('powerupOnBoot')==true);
            // debug_settings section
			uiconf.sections[3].content[0].value = (self.config.get('logging')==true)
            defer.resolve(uiconf);
        })
        .fail(function(err)
        {
            self.logger.error('[SERIALAMPCONTROLLER] getUIConfig: failed: ' + err);
            defer.reject(new Error());
        });

    return defer.promise;
};

serialampcontroller.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

serialampcontroller.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

serialampcontroller.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

//function for attaching parser to the port
serialampcontroller.prototype.attachParser = function (){
    var self = this;

    const parserOptions = {};
    parserOptions.delimiter = self.selectedAmp.delimiter;
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] attachParser: Port is now open. Connecting Parser with delimiter: ' + parserOptions.delimiter);
    // pipe the port to a parser
    self.parser = self.port.pipe(new ReadlineParser(parserOptions));
    //attach a listener to the parser output
    self.parser.on('data', data => {
        if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] [parser:data]: Listener received: " + data);
        if (typeof(data) == 'string' && self.selectedAmp !== undefined && self.selectedAmp.responses !== undefined && self.selectedAmp.responses.length > 0) {
            var cmdFound = false;
            self.selectedAmp.responses.forEach(response => {
                let match = data.match(new RegExp(response.rx,'i'));
                if (match !==null) {
                    cmdFound = true;
                    if (match.length==1){
                        if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] parser:data: call processResponse with: " + response.cmd[0]);
                        self.processResponse(response.cmd[0])
                    } else {
                        for (let i = 1; i < match.length; i++){
                            if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] parser:data: call processResponse with: " + response.cmd[i-1],match[i]);
                            self.processResponse(response.cmd[i-1],match[i])
                        }
                    }
                } 
            })
            if (self.debugLogging && !cmdFound) self.logger.info('[SERIALAMPCONTROLLER] parser:data: no matching regex for: ' + data);
        } else {
            self.logger.error("[SERIALAMPCONTROLLER] parser:data: do not have any information, what to do with message: " + data + "is the 'ampCommands.json' complete?");
        }
    });
}

serialampcontroller.prototype.selectedInterfaceExists = function(){
    var self = this;
    if ((self.config.get('tcpip')!==undefined) &&  (self.config.get('tcpip')==true)){
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] selectedInterfaceExists: TCP/IP selected. Expect network connection to exist.');
        return true; //system should always have a network card, so return true
    } else {
        if ((self.config.get('serialInterfaceDev')!==undefined) && (self.config.get('serialInterfaceDev')!=='...')) {
            //lookup the path to the selected device
            self.serialInterfaceDev = undefined;
            self.serialInterfaceDev = self.serialDevices.filter(dev => {
                return (dev.pnpId === self.config.get('serialInterfaceDev') || dev.manufacturer === self.config.get('serialInterfaceDev'))
            });
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] selectedInterfaceExists: ' + self.config.get('serialInterfaceDev') + ' in ' + JSON.stringify(self.serialDevices) + '?: ' + (self.serialInterfaceDev !== undefined));
            return (self.serialInterfaceDev !== undefined);
        }
    }
}

serialampcontroller.prototype.selectedAmpSupportsInterface = function(){
    var self = this;
    var tcpip = ((self.config.get('tcpip')!==undefined) &&  (self.config.get('tcpip')==true))
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] selectedAmpSupportsInterface: ' + (tcpip?'TCP/IP':'RS232') + ' in ' + (JSON.stringify(self.selectedAmp.interfaces) || '[]'));
    if (tcpip){
        return (self.selectedAmp.interfaces!==undefined &&
                self.selectedAmp.interfaces.includes('TCP/IP') &&
                self.selectedAmp.tcpport!==undefined)
    } else {
        return (self.selectedAmp.interfaces==undefined || self.selectedAmp.interfaces.includes('RS232'))
    }
}

//configure serial interface according to ampDefinition file
serialampcontroller.prototype.openSerialPort = function (){
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openSerialPort: starting');
    if ((self.config.get('serialInterfaceDev')!==undefined) && 
        (self.config.get('serialInterfaceDev')!=='...') &&
        (Object.keys(self.selectedAmp).length > 0))  {
            //SerialPort and Amp selected, now check if all settings are defined
            if (self.selectedAmp.baudRate!==undefined &&
                    self.selectedAmp.dataBits!==undefined &&
                    self.selectedAmp.stopBits!==undefined &&
                    self.selectedAmp.parity!==undefined &&
                    self.selectedAmp.rtscts!==undefined &&
                    self.selectedAmp.xon!==undefined &&
                    self.selectedAmp.xoff!==undefined &&
                    self.selectedAmp.xany!==undefined && 
                    self.selectedAmp.delimiter!==undefined) {
                //define the configuration of the serial interface
                self.serialOptions = {autoOpen: false, lock: false, endOnClose: true};
                self.serialOptions.baudRate = self.selectedAmp.baudRate;
                self.serialOptions.dataBits = self.selectedAmp.dataBits;
                self.serialOptions.stopBits = self.selectedAmp.stopBits;
                self.serialOptions.parity = self.selectedAmp.parity;
                self.serialOptions.rtscts = self.selectedAmp.rtscts;
                self.serialOptions.xon = self.selectedAmp.xon;
                self.serialOptions.xoff = self.selectedAmp.xoff;
                self.serialOptions.xany = self.selectedAmp.xany;

                //lookup the path to the selected device
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openSerialPort: check for ' + self.config.get('serialInterfaceDev') + ' in ' + JSON.stringify(self.serialDevices));
                self.serialInterfaceDev = self.serialDevices.filter(dev => {
                    return (dev.pnpId === self.config.get('serialInterfaceDev') || dev.manufacturer === self.config.get('serialInterfaceDev'))
                });
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openSerialPort: connect to ' + JSON.stringify(self.serialInterfaceDev) +' configured with: ' + JSON.stringify(self.serialOptions) + ' at ' + self.serialInterfaceDev[0].path);
                self.serialOptions.path = self.serialInterfaceDev[0].path;
                self.port = new SerialPort(self.serialOptions);
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openSerialPort: Now trying to open port');
                self.port.on('close', ()=>{
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] serial port [event:close]: Port is now closed.');
                });
                self.port.on('error', err => {
                    self.logger.error('[SERIALAMPCONTROLLER] serial port [event:error]: Port generated an error: ' + err);
                });
                self.port.on('open', ()=>{
                    self.attachParser()
                    //determine the current settings of the amp
                    self.getAmpStatus()
                    // //update Volume Settings and announce the updated settings to Volumio
                    .then(_ => self.alsavolume(this.config.get('startupVolume')))
                    .then(_ => self.initVolumeSettings());
                });
                self.port.open(err=>{
                    if (err) {
                        self.logger.error('[SERIALAMPCONTROLLER] openSerialPort: could not open port: ' + err.message);
                    } else {
                        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openSerialPort: Connection established.');
                        defer.resolve();
                    }
                })
            } else {
                self.logger.error('[SERIALAMPCONTROLLER] openSerialPort: AmpCommands.js has insufficient interface parameters for ' + self.selectedAmp.vendor + " - " + self.selectedAmp.model);
                defer.resolve();
            }
    } else {
        self.serialInterfaceDev = '';
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openSerialPort: Configuration incomplete. Interface or Amp not configured yet.');
        defer.resolve('');
    }
    return defer.promise
};

//Callback for closing TCP-IP Socket
serialampcontroller.prototype.onTcpClose = function(){
    var self = this;
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] onTcpClose: Port has closed, removing listeners.');
    //try to reconnect
    if (self.autoReconnect) {
        self.reconnectTCP();
    };
}

serialampcontroller.prototype.closePort = function () {
    var self = this;
    var defer = libQ.defer();
    // no more volume checks/corrections on a closed port
    clearTimeout(self.wakeCheckTimer);
    clearTimeout(self.enforceTimer);
    clearTimeout(self.volumeReportTimer);
    self.endPlaybackHold();
    self.enforceTimer = undefined;

    if (self.port !== undefined) {
        if (self.port instanceof net.Socket) { //open TCP/IP port needs to be closed
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] closePorts: closing TCP/IP');
            self.port.unpipe();
            self.port.resume();
            self.port.removeAllListeners();
            self.autoReconnect = false;
            self.waitingForReconnect = false;
            self.port.end(() => {
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] closePorts: closed TCP/IP socket');     
                self.port = undefined;   
                defer.resolve()
            })
        } else if (self.port instanceof SerialPort) { //open Serialport needs to be closed
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] closePorts: closing RS232');     
            // self.parser.removeAllListeners();
            self.port.unpipe();
            self.port.resume();
            self.port.removeAllListeners();
            if (self.port.isOpen) {
                self.port.close(error => {
                    if (error) {
                        defer.reject(error)
                    } else {
                        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] closePorts: closed serial port');
                        let {_pool, ...rest} = self.port;
                        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] closePorts: remaining config: ' + JSON.stringify(rest));
                        self.port.destroy();
                        defer.resolve();
                    }
                });
            } else {
                self.port = undefined;   
                defer.resolve();
            }            
        }
    } else {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] closePorts: port is undefined');
        defer.resolve()
    }
    return defer.promise;
}
serialampcontroller.prototype.reconnectTCP = function (params) {
 var self = this;
    if ((self.port==undefined || self.port.readyState == undefined) || (self.port.readyState == '') || (self.port.readyState == 'closed'))
        if (!self.waitingForReconnect) {
            self.waitingForReconnect = true;
            setTimeout(()=>{
                if (self.waitingForReconnect) {
                    self.waitingForReconnect = false;
                    self.port = net.createConnection({port: self.netOptions.port, host: self.netOptions.ip},() => {
                        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openTcpIp: Connected to: ' + self.netOptions.ip + ':' + self.netOptions.port);
                    });
                    self.port.setKeepAlive(true, 1000);
                    if (self.port.listenerCount('close') == 0) self.port.on('close', self.onTcpClose.bind(self));
                    if (self.port.listenerCount('error') == 0) self.port.on('error', self.onTcpError.bind(self));
                    if (self.port.listenerCount('ready') == 0) self.port.on('ready', self.connectTcpIp.bind(self));
                }
            }, 5000)
        }    
}

//Callback for error on TCP-IP Socket
serialampcontroller.prototype.onTcpError = function(err){
    var self = this;
    if(err.message.indexOf('ECONNREFUSED') > -1) {
        self.logger.error('[SERIALAMPCONTROLLER] onTcpError: Connection refused, trying to reconnect in 5 seconds.');
        //do recconect
        if (self.autoReconnect) {
          self.reconnectTCP();
        }
    } else {
        self.logger.error('[SERIALAMPCONTROLLER] onTcpError: Port generated an error: ' + err);
    }
}

serialampcontroller.prototype.connectTcpIp = function() {
    var self = this;
    self.attachParser()
    //determine the current settings of the amp
    self.getAmpStatus()
    // //update Volume Settings and announce the updated settings to Volumio
    .then(_ => self.alsavolume(this.config.get('startupVolume')))
    .then(_ => self.initVolumeSettings());

}

//configure tcp-ip according to ampDefinition file
serialampcontroller.prototype.openTcpIp = function (){
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openTcpIp: starting');
    if ((self.config.get('tcpip')!==undefined) && 
        (self.config.get('tcpip')==true) &&
        (Object.keys(self.selectedAmp).length > 0))  {
            //port and Amp selected, now check if all settings are defined
            if (self.selectedAmp.interfaces!==undefined &&
                    self.selectedAmp.interfaces.includes('TCP/IP') &&
                    self.selectedAmp.tcpport!==undefined) {
                //define the configuration of the serial interface
                self.netOptions = {}
                self.netOptions.ip = self.config.get('ipaddress')
                self.netOptions.port = self.selectedAmp.tcpport;

                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openTcpIp: connect to ' + self.netOptions.ip +' on port: ' + self.netOptions.port);
                self.port = net.createConnection({port: self.netOptions.port, host: self.netOptions.ip},() => {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openTcpIp: Connected to: ' + self.netOptions.ip + ':' + self.netOptions.port);
                });
                self.port.setKeepAlive(true, 1000);
                self.autoReconnect = true;
                if (self.port.listenerCount('close') == 0) self.port.on('close', self.onTcpClose.bind(self));
                if (self.port.listenerCount('error') == 0) self.port.on('error', self.onTcpError.bind(self));
                if (self.port.listenerCount('ready') == 0) self.port.on('ready', self.connectTcpIp.bind(self));
                defer.resolve();
            } else {
                self.logger.error('[SERIALAMPCONTROLLER] openTcpIp: AmpCommands.js has no TCP/IP parameters for ' + self.selectedAmp.vendor + " - " + self.selectedAmp.model);
                defer.resolve();
            }
    } else {
        self.serialInterfaceDev = '';
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] openTcpIp: Configuration still incomplete. No interface configured yet.');
        defer.resolve('');
    }
    return defer.promise;
};

// //send commands to the amp
serialampcontroller.prototype.sendCommand  = function(...cmd) {
    var self = this;
    var defer = libQ.defer();

    var cmdString = '';
    if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] sendCommand: send " + cmd);
    if (self.selectedAmp != undefined && self.selectedAmp.commands != undefined && self.selectedAmp.sources != undefined && self.selectedAmp.sourceCmd != undefined) {
        switch (cmd[0]) {
            case  "powerOn":
                if (self.ampStatus.Powering != 'up') {
                    cmdString = cmdString + self.selectedAmp.commands.powerOn;
                    // if the amp never confirms the power-up, do not block further power-on attempts forever
                    clearTimeout(self.poweringTimer);
                    self.poweringTimer = setTimeout(() => {
                        if (self.ampStatus.Powering == 'up') {
                            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] sendCommand: no power-on confirmation received, resetting powering state');
                            self.ampStatus.Powering = '';
                        }
                    }, 20000);
                }
                self.ampStatus.Powering = 'up';
                break;
            case  "powerToggle": 
                if (self.ampStatus.Powering == '') cmdString = cmdString = cmdString + self.selectedAmp.commands.powerToggle;
                if (self.ampStatus.power == 'on' && self.ampStatus.Powering == '' ) {
                    self.ampStatus.Powering = 'down'
                } else if (self.ampStatus.power == 'standby' && self.ampStatus.Powering == '') {
                    self.ampStatus.Powering = 'up'
                }
                break;
            case  "volUp":
                // never step past the maximum, counting steps the amp hasn't confirmed yet
                // (assumes the amp's step is 1, as on McIntosh amps)
                var limitsUp = self.getVolumeLimits();
                var fromUp = self.expectedVolume();
                if (limitsUp !== undefined && Number.isFinite(fromUp) && fromUp + 1 <= limitsUp.max) {
                    cmdString = cmdString + self.selectedAmp.commands.volUp;
                    self.lastVolumeCommand = {vol: fromUp + 1, t: Date.now()};
                } else {
                    self.logger.info('[SERIALAMPCONTROLLER] sendCommand: not sending volUp: ' + (limitsUp === undefined ? 'the Minimum/Maximum Volume settings are not valid' : 'already at the maximum of ' + limitsUp.max));
                }
                break;
            case  "volDown":
                cmdString = cmdString + self.selectedAmp.commands.volDown;
                var fromDown = self.expectedVolume();
                if (Number.isFinite(fromDown)) self.lastVolumeCommand = {vol: Math.max(fromDown - 1, 0), t: Date.now()};
                break;
            case  "volValue":
                // last line of defence for the volume limit. Whatever asked for it, every level sent
                // to the amp is a whole number within the Minimum..Maximum Volume settings. If the settings can't be
                // read or the value isn't a number, nothing is sent.
                var limits = self.getVolumeLimits();
                var level = Math.floor(toLevel(cmd[1]));
                if (limits === undefined || !Number.isFinite(level)) {
                    self.logger.error('[SERIALAMPCONTROLLER] sendCommand: not sending volume "' + cmd[1] + '": ' + (limits === undefined ? 'the Minimum/Maximum Volume settings are not valid' : 'not a number'));
                    if (limits === undefined) self.warnInvalidVolumeSettings();
                    break;
                }
                level = Math.min(Math.max(level, limits.min), limits.max);
                var template = self.selectedAmp.commands.volValue || '';
                var count = (template.match(/#/g) || []).length;
                if (count > 0) {
                    cmdString = template.replace(new RegExp("#".repeat(count)), String(level).padStart(count, "0"));
                    self.lastVolumeCommand = {vol: level, t: Date.now()};
                } else {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] sendCommand: volValue command string has no ## characters. Do not know how to send volume value.')
                }
                break;
            case  "mute": 
                cmdString = cmdString + self.selectedAmp.commands.mute;
                break;
            case  "muteOn": 
                cmdString = cmdString + self.selectedAmp.commands.muteOn;
                break;
            case  "muteOff": 
                cmdString = cmdString + self.selectedAmp.commands.muteOff;
                break;
            case  "source": 
                if (cmd[1]!=='...') {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] sendCommand: switch to source: ' + cmd[1]);
                    cmdString =  self.selectedAmp.sourceCmd[self.selectedAmp.sources.indexOf(cmd[1])];
                }
                break;
            default:
                break;
        }
    }
    if (self.port !== undefined && cmdString!==''){
        if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] sendCommand: now sending cmdString: " + cmdString);
        // some amps need the power-on command twice to wake from standby
        var repeatDelay = (cmd[0] == 'powerOn' && self.selectedAmp.powerOnRepeatDelayMs) ? self.selectedAmp.powerOnRepeatDelayMs : 0;
        self.port.write(cmdString,'ascii',function(err) {
            if (err) {
                self.logger.error('[SERIALAMPCONTROLLER] sendCommand: Could not send command to serial interface "' + cmdString + '": ' + err)
                defer.reject()
                return;
            }
            if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] sendCommand: sent cmdString: " + cmdString);
            if (repeatDelay > 0) {
                setTimeout(() => {
                    if (self.port === undefined) { defer.resolve(); return; }
                    self.port.write(cmdString,'ascii',function(err2) {
                        if (err2) self.logger.error('[SERIALAMPCONTROLLER] sendCommand: Could not repeat command "' + cmdString + '": ' + err2);
                        else if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] sendCommand: repeated cmdString: " + cmdString);
                        defer.resolve();
                    });
                }, repeatDelay);
            } else {
                defer.resolve();
            }
        });
    } else {
        // nothing to send - resolve instead of leaving the caller waiting forever
        defer.resolve();
    }
    return defer.promise;
}


// process Responses received from Amp, trigger actions and update volumio 
serialampcontroller.prototype.processResponse = function(response, ...args) {
    var self = this;
    switch (response) {
        case "respPowerOn":
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp signaled PowerOn. Previous state is: ' + self.ampStatus.power);
            if (self.ampStatus.Powering == 'up') self.ampStatus.Powering = '';
            if (self.powerupAtVolumioStart) {self.powerupAtVolumioStart = false};
            // the amp is back at its last level: check it against the maximum as soon as possible
            self.checkVolumeAfterWake();
            self.playbackHoldAmpAwake();
            // re-send init commands (e.g. status notifications) after a power-up,
            // at most once every 30s so an echo can never cause a loop
            if (self.selectedAmp.initCommands !== undefined && self.ampStatus.power != 'on' &&
                (self.lastInitResend === undefined || Date.now() - self.lastInitResend > 30000)) {
                self.lastInitResend = Date.now();
                // after the settle time: a waking amp rejects commands
                setTimeout(() => self.writeSequence(self.selectedAmp.initCommands, self.selectedAmp.commandSpacingMs || 0), Math.max(1000, (self.selectedAmp.powerOnSettleMs || 0) + 200));
            }
            // switched off again within these 10 s: don't mark it on (it would then not be woken at the next play)
            var powerOffsBefore = self.powerOffCount || 0;
            setTimeout(() => {
                if ((self.powerOffCount || 0) !== powerOffsBefore) return;
                self.initVolumeSettings()
                .then(_ => {
                    if (self.config.get('startAtPowerup') && self.playbackHold === undefined) { // the hold resumes by itself
                        self.sendCommand('source',self.config.get('volumioInput'));
                        self.socket.emit('play');
                    }
                    self.messageReceived.emit('power', 'on');
                    self.ampStatus.power='on';
                    self.powerOnPending = false;
                })                
            }, 10000);
            break;
        case "respPowerOff":
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp signaled PowerOff');            
            if (self.ampStatus.Powering == 'down') self.ampStatus.Powering = '';
            self.powerOffCount = (self.powerOffCount || 0) + 1; // cancels a pending "power on" from respPowerOn
            self.endPlaybackHold(); // switched off while waking: don't resume
            // if the amp is switched off while music plays, do not switch it straight back on;
            // automatic power-on is re-armed the next time playback starts
            if (self.volumioStatus !== undefined && self.volumioStatus.status == 'play') self.suppressAutoPowerOn = true;
            self.powerOnPending = false;
            self.socket.emit('pause'); //stops volumio if amp is powered down
            self.messageReceived.emit('power', 'standby');
            self.ampStatus.power='standby';
            if (self.powerupAtVolumioStart) {
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Sending PowerUp command to Amp after Volumio start');            
                self.powerupAtVolumioStart = false;   
                self.sendCommand('powerOn');
            }
            break;
        case "respMuteOff":
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp signaled MuteOff');            
            // only when the mute state changes (a repeated status reply must not restart playback)
            if (self.config.get('pauseWhenMuted') && self.ampStatus.mute) {
                self.socket.emit('play');
            }
            self.ampStatus.mute = false;
            self.getVolumeObject(); //reports the new state to Volumio (see getVolumeObject)
            self.messageReceived.emit('mute', false);
            break;
        case "respMuteOn":
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp signaled MuteOn');            
            if (self.config.get('pauseWhenMuted') && !self.ampStatus.mute) {
                self.socket.emit('pause');
            }
            self.ampStatus.mute = true;
            self.getVolumeObject(); //reports the new state to Volumio (see getVolumeObject)
            self.messageReceived.emit('mute', true);
            break;
        case 'respVolume':
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp signaled volume is ' + args[0]);
            self.ampStatus.volume = parseInt(args[0]);
            self.ampStatus.volumeTime = Date.now();
            self.getVolumeObject(); //reports the new state to Volumio (see getVolumeObject)
            self.messageReceived.emit('volume', args[0]);
            self.enforceMaxVolume();
            self.playbackHoldVolumeReport();
            // the MA352 reports every step of a volume change in one burst, and Volumio's own update
            // for the command (made at the first step) can arrive after the last one; report once more when the
            // reports stop, so Volumio (and the Qobuz app) end on the amp's final level
            clearTimeout(self.volumeReportTimer);
            self.volumeReportTimer = setTimeout(() => self.getVolumeObject(), 300);
            break;
        case 'respSource':
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp signaled source is ' + args[0]);
            // only when the input changes (a repeated status reply must not pause or restart playback)
            if (self.config.get('pauseWhenInputChanged') && self.ampStatus.source != args[0]) {
                var idx = self.selectedAmp.sources.indexOf(self.config.get('volumioInput'));
                if ((self.selectedAmp.sourceRespPostfix[idx] == args[0])) {
                    self.socket.emit('play');
                } else {
                    self.socket.emit('pause');
                }
            }
            self.ampStatus.source = args[0];         
            self.messageReceived.emit('source', args[0]);
            break;
        case 'respPassthru':
            // in PASSTHRU the amp bypasses its volume control, so no limit applies. Say so loudly
            // (log every time, on screen at most once a minute).
            self.logger.error('[SERIALAMPCONTROLLER] processResponse: the amp is in PASSTHRU on this input: its volume is fixed and the plugin can NOT limit it. Turn Passthru off for this input in the amp\'s Setup menu.');
            if (self.lastPassthruToast === undefined || Date.now() - self.lastPassthruToast > 60000) {
                self.lastPassthruToast = Date.now();
                self.commandRouter.pushToastMessage('error', self.getI18nString('TOAST_PASSTHRU_TITLE'), self.getI18nString('TOAST_PASSTHRU'));
            }
            break;
        default:
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: unhandled response "' + response +'"');
            break;
    }
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] processResponse: Amp Status is now ' + JSON.stringify(self.ampStatus));
};

//update the volumio Volume Settings, mainly makes this an Override plugin
serialampcontroller.prototype.initVolumeSettings = function() {
	var self = this;
    var defer = libQ.defer();

    //Prepare the data for updating the Volume Settings
    //first read the audio-device information, since we won't configure this 
    if (self.selectedAmp !==undefined && Object.keys(self.selectedAmp).length >0 &&
        ((self.port instanceof SerialPort && self.serialInterfaceDev != undefined) || (self.port instanceof net.Socket)) && 
        self.parser != undefined) {
        var volSettingsData = {
            'pluginType': 'system_hardware',
            'pluginName': 'serialampcontroller',
            'volumeOverride': true
        };
        volSettingsData.device = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'outputdevice');
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] initVolumeSettings: getAlsaCards ' + JSON.stringify(volSettingsData.device));
        let alsaCards = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getAlsaCards', '');
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] initVolumeSettings: getAlsaCards ' + JSON.stringify(alsaCards));
        if (alsaCards!=undefined) {
            let card = alsaCards.filter(element => element.id == volSettingsData.device)
            if (card.length > 0) {
                volSettingsData.name = card[0].name
                // volSettingsData.alsacard = card[0].alsacard
            } else {
                volSettingsData.name = '';
            }
        } else {
            volSettingsData.name = '';
        }
        volSettingsData.devicename = self.config.get('ampType');
        volSettingsData.mixer = '';
        volSettingsData.mixertype = 'None';
        volSettingsData.maxvolume = self.config.get('maxVolume');
        volSettingsData.volumecurve = '';
        volSettingsData.volumesteps = self.config.get('volumeSteps');
        volSettingsData.currentmute = self.volume.mute;
        self.commandRouter.volumioUpdateVolumeSettings(volSettingsData)
        .then(_ => {
            defer.resolve();
        })
        .fail(err => {
            self.logger.error("[SERIALAMPCONTROLLER] initVolumeSettings: volumioUpdateVolumeSettings failed:" + err );
            defer.reject(err)
        })            
    } else {
        if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] initVolumeSettings: Amp, serial Interface not yet set or listener not yet active.");
        defer.resolve();
    }
    return defer.promise;
};

serialampcontroller.prototype.resetVolumeSettings = function() {
	var self = this;
    var defer = libQ.defer();

    //Prepare the data for resetting the Volume Settings
    //first read the audio-device information, since we won't configure this 
    if (self.selectedAmp !=undefined && self.serialInterfaceDev != undefined && self.parser != undefined) {
        var volSettingsData = {};
        volSettingsData.device = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'outputdevice');
        volSettingsData.mixer = '';
        volSettingsData.devicename = '';
        volSettingsData.mixertype = 'None';
        volSettingsData.maxvolume = 100;
        volSettingsData.volumecurve = 'logarithmic';
        volSettingsData.volumesteps = 1;
        volSettingsData.currentmute = true;
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] resetVolumeSettings: getAlsaCards ' + JSON.stringify(volSettingsData.device));
        let alsaCards = self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getAlsaCards', '');
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] resetVolumeSettings: getAlsaCards ' + JSON.stringify(alsaCards));
        if (alsaCards!=undefined) {
            let card = alsaCards.filter(element => element.id == volSettingsData.device)
            if (card.length > 0) {
                volSettingsData.name = card[0].name
            } else {
                volSettingsData.name = '';
            }
        } else {
            volSettingsData.name = '';
        }
        self.commandRouter.volumioUpdateVolumeSettings(volSettingsData)
        .then(resp => {
            if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] resetVolumeSettings: " + JSON.stringify(volSettingsData) + ' ' + resp);
            defer.resolve();
        })
        .fail(err => {
            self.logger.error("[SERIALAMPCONTROLLER] resetVolumeSettings: volumioUpdateVolumeSettings failed:" + err );
            defer.reject(err)
        })
    } else {
        if (self.debugLogging) self.logger.info("[SERIALAMPCONTROLLER] resetVolumeSettings: Volume settings have been reset.");
        defer.resolve();
    }
    return defer.promise;
};

//update the volumio Volume Settings, mainly makes this an Override plugin
serialampcontroller.prototype.updateVolumeSettings = function(data) {
	var self = this;
    var defer = libQ.defer();

    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] updateVolumeSettings: received ' + JSON.stringify(data));
    return self.retrievevolume();
};


//used to send status requests to the amp. If the requested messageType is not available, 
//the functions just plots an error message and returns
serialampcontroller.prototype.sendStatusRequest = function(messageType) {
    var self = this;
    var cmdString = '';

    switch (messageType) {
        case "reqPower":
            cmdString = self.selectedAmp.statusRequests.reqPower;
            break;
        case "reqSource":
            cmdString = self.selectedAmp.statusRequests.reqSource;
            break;
        case "reqVolume":
            cmdString = self.selectedAmp.statusRequests.reqVolume;
            break;
        case "reqMute":
            cmdString = self.selectedAmp.statusRequests.reqMute;
            break;
        case "reqModel":
            cmdString = self.selectedAmp.statusRequests.reqModel;
            break;    
        default:
            break;
    };
    if (self.port!==undefined && cmdString!=='') {
        self.port.write(cmdString,'ascii',function(err) {
            if (err) {
                self.logger.error('[SERIALAMPCONTROLLER] sendStatusRequest: Failed to send: "' + cmdString + '" ' + err);
            }
            if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] sendStatusRequest: Sent command for "' + messageType + '": ' + cmdString);
        });
    }
}

//override the alsavolume function to send volume commands to the amp
serialampcontroller.prototype.alsavolume = function (VolumeInteger) {
	var self = this;
    var defer = libQ.defer();
    
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: Set volume "' + VolumeInteger + '" ' + self.parser )
    if (self.selectedAmp!=undefined && (self.port instanceof net.Socket || self.serialInterfaceDev!=undefined) && self.parser != undefined) {
        switch (VolumeInteger) {
            case 'mute':
            // Mute
                if (self.selectedAmp.commands.muteOn != undefined) {
                    //amp supports dedicated mute on command
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send dedicated muteOn.');
                    defer.resolve(self.waitForAcknowledge('mute'));
                    self.sendCommand('muteOn');
                } else if (self.selectedAmp.commands.mute != undefined) {
                    //amp only supports toggle mute command
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send toggle mute.');
                    if (!self.ampStatus.mute) {
                        defer.resolve(self.waitForAcknowledge('mute'));
                        self.sendCommand('mute');
                    }
                } else {
                    //amp supports no mute command so we just put volume to defined min Vol
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send Volume=min to mimic mute.');
                    if (self.ampStatus.volume>self.config.get('minVolume')) {
                        self.ampStatus.premutevolume = self.ampStatus.volume;
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volValue',self.config.get('minVolume'))
                    }
                }
                break;
            case 'unmute':
            // Unmute (inverse of mute)
                if (self.selectedAmp.commands.muteOff != undefined) {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send dedicated muteOff.');
                    defer.resolve(self.waitForAcknowledge('mute'));
                    self.sendCommand('muteOff')
                } else if (self.selectedAmp.commands.mute != undefined) {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send toggle mute.');
                    if (self.ampStatus.mute) {
                        defer.resolve(self.waitForAcknowledge('mute'));
                        self.sendCommand('mute')
                    }
                } else {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: set Volume to premute value.');
                    if (self.ampStatus.volume==self.config.get('minVolume')) {
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volValue',self.ampStatus.premutevolume)
                    }
                }
                break;
            case 'toggle':
            // Toggle mute
                if (self.selectedAmp.commands.mute != undefined) {
                    //amp supports toggle function
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send toggle mute.');
                    defer.resolve(self.waitForAcknowledge('mute'));
                    self.sendCommand('mute')
                } else if (self.selectedAmp.commands.muteOn != undefined && self.selectedAmp.commands.muteOff != undefined) {
                    //amp only supports dedicated mute and off functions
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: send dedicated muteOn/Off based on current state.');
                    defer.resolve(self.waitForAcknowledge('mute'));
                    if (self.ampStatus.mute) { // the amp's mute state (self.volume.mute is never set)
                        self.sendCommand('muteOff')
                    } else {
                        self.sendCommand('muteOn')
                    }
                } else {
                    //amp supports no mute function
                    if (Volume.mute) {
                        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: set volume to 0 or premute value, depending on state.');
                        self.volume.vol = self.volume.premutevolume;
                        if (self.config.get('mapTo100')) {
                            //calculate the equivalent volume on a 0...100 scale
                            self.ampVolume = parseInt(self.volume.vol * (self.config.get('maxVolume')-self.config.get('minVolume'))/100+self.config.get('minVolume'));
                        } else {
                            self.ampVolume = self.volume.vol;
                        }
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volValue',self.ampVolume)
                    } else {
                        self.volume.premutevolume = self.volume.vol;
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volValue',self.config.get('minVolume'))
                    }
                }
                break;
            case '+':
            //increase volume by 1 step
                var limitsPlus = self.getVolumeLimits();
                var fromPlus = self.expectedVolume();
                if (limitsPlus !== undefined && Number.isFinite(fromPlus) && fromPlus < limitsPlus.max) {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: increase volume by single step.');
                    if (self.selectedAmp.commands.volValue != undefined) {
                        // send the new level rather than a relative step, so clicks sent before the
                        // amp has answered can't add up past the maximum
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volValue', Math.min(fromPlus + Math.max(1, parseInt(self.config.get('volumeSteps')) || 1), limitsPlus.max));
                    } else if (self.selectedAmp.commands.volUp != undefined) {
                        //amp supports stepwise volume increase only
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volUp')
                    }
                } else {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: not increasing the volume, at the maximum (or the volume settings are not valid).');
                    if (limitsPlus !== undefined) defer.resolve(self.getVolumeObject()); // show Volumio the real level
                }
                break;
            case '-':
            // decrease volume by 1 step
                var limitsMinus = self.getVolumeLimits();
                var fromMinus = self.expectedVolume();
                if (limitsMinus !== undefined && Number.isFinite(fromMinus) && fromMinus > limitsMinus.min) {
                    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: decrease volume by single step.');
                    if (self.selectedAmp.commands.volDown != undefined) {
                        //amp supports stepwise volume decrease
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volDown')
                    } else {
                        //amp only supports sending of absolute volume
                        defer.resolve(self.waitForAcknowledge('volume'));
                        self.sendCommand('volValue', Math.max(fromMinus - Math.max(1, parseInt(self.config.get('volumeSteps')) || 1), limitsMinus.min))
                    }
                }
            break;
            default:
            //set volume to integer
                // only numbers (or numeric strings); Volumio's 0..100 scale is enforced before
                // mapping, and the maximum is applied last so it wins even over a minimum set above it
                var limitsSet = self.getVolumeLimits();
                var requested = toLevel(VolumeInteger);
                if (limitsSet === undefined || Number.isNaN(requested)) {
                    self.logger.error('[SERIALAMPCONTROLLER] alsavolume: not setting volume "' + VolumeInteger + '": ' + (limitsSet === undefined ? 'the Minimum/Maximum Volume settings are not valid' : 'not a number'));
                    if (limitsSet === undefined) self.warnInvalidVolumeSettings();
                    defer.resolve(limitsSet !== undefined ? self.getVolumeObject() : undefined);
                    break;
                }
                if (self.config.get('mapTo100')) {
                    requested = Math.min(Math.max(requested, 0), 100);
                    // multiply first: exact for whole numbers (sendCommand rounds down), see ampToVolumio
                    requested = limitsSet.min + requested * (limitsSet.max - limitsSet.min) / 100;
                }
                requested = Math.min(Math.max(requested, limitsSet.min), limitsSet.max);
                if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: set volume to integer value ' + requested);
                defer.resolve(self.waitForAcknowledge('volume'));
                self.sendCommand('volValue',requested);
                break;
        };
        
    } else {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] alsavolume: either Serial Interface, listener or Ampconfig missing');
        defer.resolve();
    }
    return defer.promise;
};

serialampcontroller.prototype.waitForAcknowledge = function(eventType) {
    var self = this;
    var defer = libQ.defer();

    self.messageReceived.once(eventType,(response) => {
        //check if response is correct, if yes, resolve the promise
        defer.resolve(self.getVolumeObject())
    })
    return defer.promise;
}

// Retrieve a string
serialampcontroller.prototype.getI18nString = function (key) {
    var self = this;

    if (self.i18nStrings[key] !== undefined) {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getI18nString("'+key+'"):'+ self.i18nStrings[key]);
        return self.i18nStrings[key];
    } else {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getI18nString("'+key+'")'+ self.i18nStringsDefaults[key]);
        // strings_en.json is flat (there is no 'SERIALAMPCONTROL' section): a key missing from another language
        // threw a TypeError here instead of falling back to English
        return self.i18nStringsDefaults[key];
    };
}
// A method to get some language strings used by the plugin
serialampcontroller.prototype.loadI18nStrings = function() {
    var self = this;

    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] loadI18nStrings: '+__dirname + '/i18n/strings_' + language_code + ".json");
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + ".json");
    }
    catch (e) {
        if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] loadI18nStrings: ' + language_code + ' not found. Fallback to en');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }

    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

serialampcontroller.prototype.getVolumeObject = function() {
    // returns the current amplifier settings in an object that volumio can use
    var volume = {};
    var defer = libQ.defer();
    var self = this;

    volume.mute = self.ampStatus.mute;
    volume.currentDisableVolumeControl = false;
    volume.disableVolumeControl = false; // Volumio's state machine reads this name, not the one above
    //on Volumio's 0...100 scale (mapTo100), limited to 0..100; no division by zero if min == max
    volume.vol = self.ampToVolumio(self.ampStatus.volume);
    if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] getVolumeObject: ' + JSON.stringify(volume));
    // remember what we told Volumio, so followServiceVolume can tell these values
    // (echoed back in pushState) apart from volume changes made in a streaming app
    var now = Date.now();
    self.reportedVolumes = (self.reportedVolumes || []).filter(r => now - r.t < 3000);
    self.reportedVolumes.push({vol: volume.vol, t: now});
    // Note: this also reports the volume to Volumio. Callers must not pass the returned promise to
    // commandRouter.volumioupdatevolume (on Volumio 4 that pushes "volume: undefined" and writes 100 to /tmp/volume).
    return libQ.resolve(volume)
    .then(function (volume) {
      defer.resolve(volume);
      self.commandRouter.volumioupdatevolume(volume);
      // resolve with the volume object (it resolved with undefined, which broke Volumio's
      // volumiosetvolume -> volumioupdatevolume(result) and the state machine's getcurrentVolume)
      return volume;
    });
};

serialampcontroller.prototype.volumioupdatevolume = function() {
    var self = this;
    return self.getVolumeObject(); //reports to Volumio itself
};

serialampcontroller.prototype.retrievevolume = function () {
    var self = this;
	if (self.debugLogging) self.logger.info('[SERIALAMPCONTROLLER] retrieveVolume: ');
    return self.getVolumeObject();
}
