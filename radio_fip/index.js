/*
 * Radio FIP Volumio Plugin
 *
 * File        : index.js
 * Version     : 1.0.6
 * Date        : 04-09-2026
 * Author      : Stef
 *
 * Description :
 *     Volumio music service plugin for FIP Radio stations.
 *     Provides access to FIP live streams, station browsing,
 *     metadata updates and bitrate information.
 *
 * Compatibility :
 *     Volumio 3.x / Volumio 4.x
 *
 * License :
 *     GPL License
 *
 * Copyright (C) 2026 Stef
 *
 */

'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var Metadata = require('./metadata');

// Set to true to enable debug logging
var DEBUG = false;

module.exports = ControllerFIP;

/*
 * Constructor
 *
 * Initializes the FIP radio controller instance.
 * Stores Volumio services references and initializes
 * internal state variables.
 */
function ControllerFIP(context) {
    var self = this;
    self.context = context;
    self.commandRouter = context.coreCommand;
    self.logger = context.logger;
    self.configManager = context.configManager;
    self.serviceName = 'radio_fip';
    self.radioStations = [];
    self.lastMetadata = '';
    self.metadataTimer = null;
    self.state = {};
}

/*
 * Called when Volumio starts.
 *
 * Loads the plugin configuration file and prepares
 * the service environment.
 */
ControllerFIP.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(
        self.context,
        'config.json'
    );
    self.getConf(self.configFile);
    self.logger.info('[radio_fip] onVolumioStart');
    return libQ.resolve();
};

/*
 * Builds the plugin configuration interface.
 *
 * Loads localized UI strings and fills the current
 * configuration values displayed in Volumio settings.
 */
ControllerFIP.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    self.debugLog('[radio_fip] getUIConfig() CALLED');
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    self.logger.info(
        '[radio_fip] language=' + lang_code
    );
    self.getConf(self.configFile);
    self.debugLog(
        '[radio_fip] i18n fr exists=' +
        fs.existsSync(__dirname + '/i18n/strings_' + lang_code + '.json')
    );

    self.debugLog(
        '[radio_fip] i18n content=' +
        JSON.stringify(
            fs.readJsonSync(__dirname + '/i18n/strings_' + lang_code + '.json')
        )
    );
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function (uiconf) {
        self.debugLog(
            '[radio_fip] translated UI=' +
            JSON.stringify(uiconf)
        );
        var apiDelay = self.config.get('apiDelay');
        if (!apiDelay) {
            apiDelay = 5;
            self.config.set(
                'apiDelay',
                apiDelay
            );
        }
        if (
            uiconf.sections &&
            uiconf.sections[0] &&
            uiconf.sections[0].content &&
            uiconf.sections[0].content[0]
        ) {
            uiconf.sections[0].content[0].value = apiDelay;
        }
        defer.resolve(uiconf);
    })
    .fail(function (err) {
        self.logger.error(
            '[radio_fip] getUIConfig error: ' +
            err.message
        );
        defer.reject(err);
    });
    return defer.promise;
};

/*
 * Updates the plugin configuration.
 *
 * Saves configuration values modified from
 * the Volumio plugin settings interface.
 */
ControllerFIP.prototype.updateConfig = function (data) {
    var self = this;
    self.getConf(self.configFile);
    if (data && data.apiDelay !== undefined) {
        self.config.set(
            'apiDelay',
            data.apiDelay
        );
        self.logger.info(
            '[radio_fip] apiDelay saved: ' +
            data.apiDelay
        );
    }
    return libQ.resolve();
};

/*
 * Loads the plugin configuration file.
 *
 * Creates a v-conf instance and loads persistent
 * configuration values from disk.
 */
ControllerFIP.prototype.getConf = function (configFile) {
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
};

/*
 * Writes a debug message to the Volumio log.
 *
 * Debug messages are only displayed when
 * the DEBUG flag is enabled.
 */
ControllerFIP.prototype.debugLog = function(message) {
    if (DEBUG && this.logger) {
        this.logger.info('[radio_fip][DEBUG] ' + message);
    }
};

/*
 * Returns the list of configuration files
 * used by the plugin.
 */
ControllerFIP.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

/*
 * Starts the FIP radio service.
 *
 * Loads resources, initializes MPD access,
 * loads translations and registers the browse source.
 */
ControllerFIP.prototype.onStart = function() {
    var self = this;

    self.mpdPlugin = self.commandRouter.pluginManager.getPlugin(
        'music_service',
        'mpd'
    );
    self.debugLog(
        JSON.stringify(
            self.commandRouter.volumioGetBrowseSources()
        )
    );
    self.loadRadioI18nStrings();
    self.addRadioResource();
    return self.addToBrowseSources().then(function() {
        self.logger.info('[radio_fip] Started');
    });
};

/*
 * Stops the FIP radio service.
 *
 * Stops metadata updates and releases timers.
 */
ControllerFIP.prototype.onStop = function() {
    var self = this;
    self.debugLog('[radio_fip] onStop called');
    self.stopMetadataTimer();
    self.removeToBrowseSources();
    return libQ.resolve();
};

/*
 * Called before plugin removal.
 *
 * Removes the FIP browse source registration.
 */
ControllerFIP.prototype.onRemove = function() {
    var self = this;
    self.debugLog('[radio_fip] onRemove called');
    self.stopMetadataTimer();
    self.removeToBrowseSources();
    return libQ.resolve();
};

/*
 * Restarts the FIP radio service.
 *
 * Currently no additional restart action is required.
 */
ControllerFIP.prototype.onRestart = function() {
    return libQ.resolve();
};

/*
 * Returns the station logo filename.
 *
 * Uses a default logo when the requested image
 * is missing.
 */
ControllerFIP.prototype.getStationLogo = function(station) {
    var defaultLogo = 'fip-cover-black.png';
    if (!station || !station.logo) {
        return defaultLogo;
    }
    var logoPath = __dirname + '/images/' + station.logo;
    if (fs.existsSync(logoPath)) {
        return station.logo;
    }
    this.logger.info('[radio_fip] Missing logo ' + station.logo);
    return defaultLogo;
};

/*
 * Registers FIP Radio as a Volumio browse source.
 */
ControllerFIP.prototype.addToBrowseSources = function() {
    var self = this;
    try {
        self.commandRouter.volumioRemoveToBrowseSources(
            'fip'
        );
        self.debugLog(
            '[radio_fip] Old browse source removed'
        );
    }
    catch(e) {
        self.debugLog(
            '[radio_fip] No previous browse source'
        );
    }
    self.commandRouter.volumioAddToBrowseSources({
        name: 'FIP Radio',
        uri: 'fip',
        plugin_type: 'music_service',
        plugin_name: 'radio_fip',
        albumart:
            '/albumart?sourceicon=music_service/radio_fip/images/fip-cover-black.png'
    });
    self.debugLog(
        '[radio_fip] Browse source added'
    );
    return libQ.resolve();
};

/*
 * Removes FIP Radio from Volumio browse sources.
 *
 * Compatible with Volumio 3.x and 4.x.
 */
ControllerFIP.prototype.removeToBrowseSources = function() {
    var self = this;
    try {
        self.commandRouter.volumioRemoveToBrowseSources(
            'FIP Radio'
        );
        self.debugLog(
            '[radio_fip] Browse source removed'
        );
    }
    catch(e) {
        self.logger.error(
            '[radio_fip] Browse source remove error: ' +
            e.message
        );
    }
};

/*
 * Handles browse requests from Volumio UI.
 *
 * Routes requests either to the root station list
 * or to a specific station.
 */
ControllerFIP.prototype.handleBrowseUri = function(curUri) {
    this.logger.info(
        '[radio_fip] BROWSE CALL uri=' + curUri
    );
    if (!curUri || curUri === 'fip' || curUri === 'fip/') {
        return this.getRootContent();
    }
    if (curUri.indexOf('fip/') === 0) {
        return this.getStationContent(curUri);
    }
    return libQ.resolve({
        navigation: {
            lists: [{
                availableListViews: ['list'],
                items: []
            }]
        }
    });
};

/*
 * Builds the FIP root navigation content.
 *
 * Creates the list of available FIP stations.
 */
ControllerFIP.prototype.getRootContent = function() {
    var self = this;
    var items = [];
    self.radioStations.forEach(function(station) {
        items.push({
            service: self.serviceName,
            type: 'mywebradio',
            title: station.title,
            artist: '',
            album: '',
            icon: 'fa fa-music',
            uri: 'fip/' + station.id,
            albumart:
                '/albumart?sourceicon=music_service/radio_fip/images/' +
                self.getStationLogo(station)
        });
    });
    return libQ.resolve({
        navigation: {
            lists: [{
                availableListViews: ['list'],
                items: items
            }]
        }
    });
};

/*
 * Builds the content for a selected FIP station.
 *
 * Returns the playable stream item.
 */
ControllerFIP.prototype.getStationContent = function(uri) {
    var self = this;
    var stationId = uri.replace(/^fip\//, '');
    var station = self.radioStations.find(function(item) {
        return item.id === stationId;
    });
    self.debugLog(
        '[radio_fip] station lookup id=' +
        stationId +
        ' result=' +
        JSON.stringify(station)
    );
    if (!station) {
        self.logger.error(
            '[radio_fip] Station not found: ' + stationId
        );
        return libQ.resolve({
            navigation: {
                lists: [{
                    availableListViews: ['list'],
                    items: []
                }]
            }
        });
    }
    self.debugLog(
        '[radio_fip] getStationContent station=' +
        station.title
    );
    return libQ.resolve({
        navigation: {
            lists: [{
                availableListViews: ['list'],
                items: [{
                    service: self.serviceName,
                    type: 'mywebradio',
                    title: station.title,
                    name: station.title,
                    artist: '',
                    album: '',
                    uri: station.stream,
                    icon: 'fa fa-music',
                    albumart:
                        '/albumart?sourceicon=music_service/radio_fip/images/' +
                        self.getStationLogo(station)
                }]
            }]
        }
    });
};

/*
 * Converts a FIP station URI into a playable track.
 *
 * Used by Volumio playback engine.
 */
ControllerFIP.prototype.explodeUri = function(uri) {
    var self = this;
    self.debugLog(
        '[radio_fip] explodeUri uri=' + uri
    );
    var stationId =
        uri.replace(/^fip\//, '');
    var station =
        self.radioStations.find(function(item) {
            return item.id === stationId;
        });
    if (!station) {
        self.logger.error(
            '[radio_fip] explodeUri station not found id=' +
            stationId
        );
        return libQ.resolve([]);
    }
    self.debugLog(
        '[radio_fip] explodeUri OK station=' +
        station.title
    );
    return libQ.resolve([{
        service: self.serviceName,
        type: 'track',
        trackType: 'webradio',
        radioType: 'FIP',
        title: station.title,
        name: station.title,
        artist: '',
        album: '',
        uri: station.stream,
        stationId: station.id,
        stationTitle: station.title,
        albumart:
            '/albumart?sourceicon=music_service/radio_fip/images/' +
            self.getStationLogo(station),
        duration: 0
    }]);
};

/*
 * Starts playback of a FIP radio stream.
 *
 * Clears the MPD queue, adds the stream,
 * starts playback and initializes metadata updates.
 */
ControllerFIP.prototype.clearAddPlayTrack = function(track) {
    var self = this;
    var station;
    if (track.uri) {
        station = self.radioStations.find(function(item) {
            return item.stream === track.uri;
        });
    }
   self.debugLog(
        '[radio_fip] clearAddPlayTrack station=' +
        JSON.stringify(station)
    );
    if (!self.mpdPlugin) {
        return libQ.reject('MPD plugin unavailable');
    }
    self.state = {
        status: 'play',
        service: self.serviceName,
		type: 'track',
        // To use green circle with duration
		// trackType: station ? station.title : 'FIP',
        // To use webradio in circle
        trackType: 'webradio',
        radioType: 'FIP',
        bitrate: '',
        title: station ?
            station.title :
            'FIP Radio',
        name: station ?
            station.title :
            'FIP Radio',
        artist: '',
        album: '',
        albumart:
            '/albumart?sourceicon=music_service/radio_fip/images/' +
            self.getStationLogo(station),
        uri: track.uri,
        streaming: true,
        stream: station ? station.title : 'FIP',
        // To use green circle with duration
        // samplerate: '44.1 KHz',
		// bitdepth: '16 bit',
		// channels: 2,
		// To use webradio in circle
		samplerate: '',
		bitdepth: '',
		channels: '',
        disableUiControls: true,
        // To use green circle with duration
        // duration: 1,
        // To use webradio in circle
        duration: 0,
        seek: 0
    };
    return self.mpdPlugin.sendMpdCommand(
        'stop',
        []
    )
    .then(function(){
        return self.mpdPlugin.sendMpdCommand(
            'clear',
            []
        );
    })
    .then(function(){
        return self.mpdPlugin.sendMpdCommand(
            'add "' + track.uri + '"',
            []
        );
    })
    .then(function(){
        return self.mpdPlugin.sendMpdCommand(
            'play',
            []
        );
    })
    .then(function(){
        self.commandRouter.stateMachine
            .setConsumeUpdateService(
                self.serviceName
            );
        self.commandRouter.stateMachine.currentService =
    		self.serviceName;
        self.debugLog(
            '[radio_fip] BEFORE INITIAL PUSH=' +
            JSON.stringify(self.state)
        );
        self.commandRouter.servicePushState(
            self.state,
            self.serviceName
        );
        self.debugLog(
            '[radio_fip] AFTER INITIAL PUSH=' +
            JSON.stringify(self.state)
        );
        if (station) {
            self.startMetadataTimer(
                station
            );
            setTimeout(function(){
                self.updateBitrate();
            },3000);
        }
        self.debugLog(
            '[radio_fip] Playback started station=' +
            (station ? station.title : 'unknown')
        );
        return true;
    });
};

/*
 * Loads FIP radio station definitions
 * from radio_stations.json.
 */
ControllerFIP.prototype.addRadioResource = function() {
    var self = this;
    try {
        var data = fs.readJsonSync(
            __dirname + '/radio_stations.json'
        );
        self.radioStations = Array.isArray(data) ? data : data.stations;
    } catch (e) {
        self.logger.error(
            '[radio_fip] stations error ' + e.message
        );
        self.radioStations = [];
    }
    self.logger.info(
        '[radio_fip] Loaded ' +
        self.radioStations.length +
        ' stations'
    );
};

/*
 * Loads internationalization strings.
 */
ControllerFIP.prototype.loadRadioI18nStrings = function() {
    try {
        this.i18nStrings = fs.readJsonSync(
            __dirname + '/i18n/strings_en.json'
        );
    } catch (e) {
        this.i18nStrings = {};
    }
};

/*
 * Returns a translated string.
 */
ControllerFIP.prototype.getRadioI18nString = function(key) {
    return this.i18nStrings[key] || key;
};

/*
 * Starts periodic metadata updates.
 *
 * Queries Radio France metadata every few seconds.
 */
ControllerFIP.prototype.startMetadataTimer = function(station) {
    var self = this;
    self.debugLog(
        '[radio_fip] startMetadataTimer ' +
        (station ? station.title : 'unknown')
    );
    self.stopMetadataTimer();
    if (!station) {
        self.logger.error(
            '[radio_fip] Cannot start metadata timer without station'
        );
        return;
    }
    var apiDelay = parseInt(
        self.config.get('apiDelay'),
        10
    );
    if (!apiDelay || apiDelay < 1) {
        apiDelay = 5;
    }
    self.debugLog(
        '[radio_fip] Metadata interval: ' +
        apiDelay +
        ' seconds'
    );
    self.updateMetadata(station);
    self.metadataTimer = setInterval(function() {
        try {
            self.updateMetadata(station);
        }
        catch (err) {
            self.logger.error(
                '[radio_fip] Metadata timer exception ' +
                err.message
            );
        }
    }, apiDelay * 1000);
    self.logger.info(
        '[radio_fip] Metadata timer started'
    );
};

/*
 * Stops metadata update timer.
 */
ControllerFIP.prototype.stopMetadataTimer = function() {
    if (this.metadataTimer) {
        clearInterval(this.metadataTimer);
        this.metadataTimer = null;
    }
};

/*
 * Pushes metadata information to the Volumio state machine.
 *
 * Updates the current playback state with artist,
 * title, album and artwork information.
 */
ControllerFIP.prototype.pushSongState = function(data, station) {
    var self = this;
    var state = {
        status: 'play',
        service: self.serviceName,
		type: 'track',
		trackType: 'FIP Radio',
        radioType: 'FIP',
        samplerate: '44.1 KHz',
		bitdepth: '16 bit',
		channels: 2,
        bitrate: self.state.bitrate || '',
        title: data.title,
        name: data.title,
        artist: data.artist,
        album: data.album,
        albumart: data.albumart,
        uri: station.stream,
        streaming: true,
        disableUiControls: true,
        duration: 1,
        seek: 0
    };
    self.state = state;
    self.commandRouter.servicePushState(
        state,
        self.serviceName
    );
};

/*
 * Retrieves and pushes current Radio France metadata.
 *
 * Updates Volumio state and playback queue information.
 */
ControllerFIP.prototype.updateMetadata = function(station) {
    var self = this;
    Metadata.getMetadata(station.metadataId)
    .then(function(data) {
        if (!data) {
            return;
        }
        if (!data.artist && !data.title) {
            return;
        }
        var current =
            data.artist + '|' +
            data.title + '|' +
            data.album;
        if (current === self.lastMetadata) {
            return;
        }
        self.lastMetadata = current;
        self.debugLog(
            '[radio_fip] ' +
            data.artist +
            ' - ' +
            data.title
        );
        var state = Object.assign({}, self.state, {
            status: 'play',
            service: self.serviceName,
            type: 'track',
            // To use green circle with duration
            // trackType: station ? station.title : 'FIP',
            // To use webradio in circle
            trackType: 'webradio',
            // To use green circle with duration
            // samplerate: '44.1 KHz',
            // bitdepth: '16 bit',
            // channels: 2,
            // To use webradio in circle
            samplerate: '',
            bitdepth: '',
            channels: '',
            radioType: 'FIP',
            title: data.title,
            name: station.title,
            artist: data.artist,
            album: data.album,
            // Keep the station logo.
            // Radio France "cover" is a UUID, not a Volumio albumart URL.
            albumart: data.albumart,
            uri: station.stream,
            streaming: true,
            disableUiControls: true,
            // To use green circle with duration
            // duration: 1,
            // To use webradio in circle
            duration: 0,
            seek: 0
        });
        self.state = state;
        try {
            var vState =
                self.commandRouter
                .stateMachine
                .getState();
            var queueItem =
                self.commandRouter
                .stateMachine
                .playQueue
                .arrayQueue[vState.position];
            if (queueItem) {
                queueItem.name =
                    station.title;
                queueItem.title =
                    data.title;
                queueItem.artist =
                    data.artist;
                queueItem.album =
                    data.album;
                // Keep the station logo in the queue item.
                queueItem.albumart =
                    data.albumart;
                queueItem.uri =
                    station.stream;
                // To use green circle with duration
                // queueItem.trackType =
                //    'FIP Radio';
                // To use webradio in circle
                queueItem.trackType =
                    'webradio';
                queueItem.type =
                    'track';
                queueItem.duration = 0;
                queueItem.samplerate = '44.1 KHz';
                queueItem.bitdepth = '16 bit';
                queueItem.channels = 2;
            }
            self.commandRouter
                .stateMachine
                .currentSeek = 0;
            self.commandRouter
                .stateMachine
                .playbackStart =
                    Date.now();
            self.commandRouter
                .stateMachine
                .currentSongDuration = 0;
            self.commandRouter
                .stateMachine
                .setConsumeUpdateService(
                    self.serviceName
                );
        }
        catch(e) {
            self.logger.error(
                '[radio_fip] queue update error ' +
                e.message
            );
        }
        self.debugLog(
            '[radio_fip] METADATA PUSH station=' +
            station.title +
            ' artist=' +
            data.artist +
            ' title=' +
            data.title
        );
        self.debugLog(
            '[radio_fip] BEFORE METADATA PUSH=' +
            JSON.stringify(state)
        );
        self.commandRouter.servicePushState(
            state,
            self.serviceName
        );
        self.debugLog(
            '[radio_fip] Metadata PUSH done'
        );
    })
    .catch(function(err) {
        self.logger.error(
            '[radio_fip] metadata error ' +
            err.message
        );
    });
};

/*
 * Stops FIP radio playback.
 *
 * Stops MPD playback, releases metadata timers
 * and updates the Volumio playback state.
 */
ControllerFIP.prototype.stop = function() {
    var self = this;
    self.stopMetadataTimer();
    if(self.mpdPlugin){
        return self.mpdPlugin.sendMpdCommand(
            'stop',
            []
        )
        .then(function(){
            self.state.status = 'stop';
            self.commandRouter.servicePushState(
                self.state,
                self.serviceName
            );
        });
    }
    return libQ.resolve();
};

/*
 * Retrieves the current MPD stream bitrate.
 *
 * Reads MPD status information and updates
 * the Volumio playback state.
 */
ControllerFIP.prototype.updateBitrate = function() {
    var self = this;
    var net = require('net');
    var socket = new net.Socket();
    var response = '';
    socket.setTimeout(3000);
    socket.connect(
        6600,
        '127.0.0.1',
        function() {
            socket.write(
                'status\ncurrentsong\nclose\n'
            );
        }
    );
    socket.on('data', function(data) {
        response += data.toString();
    });
    socket.on('close', function() {
        var bitrateMatch = response.match(
            /bitrate:\s*(\d+)/
        );
        if (bitrateMatch) {
            self.state.bitrate =
                self.state.name || 'FIP';
        }
        var audioMatch = response.match(
            /audio:\s*(\d+):(\d+):(\d+)/
        );
        if (audioMatch) {
        	// To use green circle with duration
            // self.state.samplerate =
            //     (parseInt(audioMatch[1]) / 1000)
            //     .toFixed(1) + ' KHz';
            // self.state.bitdepth =
            //     audioMatch[2] + ' bit';
            // self.state.channels =
            //     parseInt(audioMatch[3]);
			// To use webradio in circle
		    self.state.samplerate = '';
		    self.state.bitdepth = '';
		    self.state.channels = '';

			var vState =
			    self.commandRouter.stateMachine.getState();
			var queueItem =
			    self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
			if (queueItem) {
			    queueItem.samplerate = self.state.samplerate;
			    queueItem.bitdepth = self.state.bitdepth;
			    queueItem.channels = self.state.channels;
			}
            self.debugLog(
                '[radio_fip] Audio detected ' +
                self.state.samplerate +
                ' ' +
                self.state.bitdepth +
                ' ' +
                self.state.channels +
                'ch'
            );
        }
        self.state.status = 'play';
        self.state.service = self.serviceName;
        self.state.type = 'track';
        // To use green circle with duration
		// self.state.trackType = self.state.name || 'FIP';
        // To use webradio in circle
        self.state.trackType = 'webradio';
		self.state.streaming = true;
		self.state.stream = self.state.name || 'FIP';
		// To use green circle with duration
        // self.state.duration = 1;
        // To use webradio in circle
        self.state.duration = 0;
        self.state.seek = 0;
        self.commandRouter.stateMachine
            .setConsumeUpdateService(
                self.serviceName
            );
        self.commandRouter.servicePushState(
            self.state,
            self.serviceName
        );
    });
    socket.on('timeout', function() {
        socket.destroy();
    });
    socket.on('error', function(err) {
        self.logger.error(
            '[radio_fip] Bitrate socket error ' +
            err.message
        );
    });
};

/*
 * Searches FIP radio content.
 *
 * FIP does not currently provide searchable content,
 * therefore this method returns an empty result.
 */
ControllerFIP.prototype.search = function() {
    return libQ.resolve([]);
};
