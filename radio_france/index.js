/*
 * Radio France Volumio Plugin
 *
 *
 * balbuze 4, October 26
 * Inspiratted Stef with Rafio_Fip
 *
 */

'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var Metadata = require('./metadata');

// Set to true to enable debug logging
var DEBUG = true;

module.exports = ControllerRadioFrance;

function ControllerRadioFrance(context) {
    var self = this;
    self.context = context;
    self.commandRouter = context.coreCommand;
    self.logger = context.logger;
    self.configManager = context.configManager;
    self.serviceName = 'radio_france';
    self.radioStations = [];
    self.lastMetadata = '';
    self.metadataTimer = null;
    self.state = {};
}

ControllerRadioFrance.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(
        self.context,
        'config.json'
    );
    self.getConf(self.configFile);
    self.logger.info('RadioFrance onVolumioStart');
    return libQ.resolve();
};

ControllerRadioFrance.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    self.debugLog('RadioFrance getUIConfig() CALLED');
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    self.logger.info(
        'RadioFrance language=' + lang_code
    );
    self.getConf(self.configFile);
    self.debugLog(
        'RadioFrance i18n fr exists=' +
        fs.existsSync(__dirname + '/i18n/strings_' + lang_code + '.json')
    );

    self.debugLog(
        'RadioFrance i18n content=' +
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
            'RadioFrance translated UI=' +
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
            'RadioFrance getUIConfig error: ' +
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
ControllerRadioFrance.prototype.updateConfig = function (data) {
    var self = this;
    self.getConf(self.configFile);
    if (data && data.apiDelay !== undefined) {
        self.config.set(
            'apiDelay',
            data.apiDelay
        );
        self.logger.info(
            'RadioFrance apiDelay saved: ' +
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
ControllerRadioFrance.prototype.getConf = function (configFile) {
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
};

/*
 * Writes a debug message to the Volumio log.
 *
 * Debug messages are only displayed when
 * the DEBUG flag is enabled.
 */
ControllerRadioFrance.prototype.debugLog = function(message) {
    if (DEBUG && this.logger) {
        this.logger.info('RadioFrance[DEBUG] ' + message);
    }
};

/*
 * Returns the list of configuration files
 * used by the plugin.
 */
ControllerRadioFrance.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

/*
 * Starts the Radio France service.
 *
 * Loads resources, initializes MPD access,
 * loads translations and registers the browse source.
 */
ControllerRadioFrance.prototype.onStart = function() {
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
        self.logger.info('RadioFrance Started');
    });
};

/*
 * Stops the Radio France service.
 *
 * Stops metadata updates and releases timers.
 */
ControllerRadioFrance.prototype.onStop = function() {
    var self = this;
    self.debugLog('RadioFrance onStop called');
    self.stopMetadataTimer();
    self.removeToBrowseSources();
    return libQ.resolve();
};

/*
 * Called before plugin removal.
 *
 * Removes the Radio France browse source registration.
 */
ControllerRadioFrance.prototype.onRemove = function() {
    var self = this;
    self.debugLog('RadioFrance onRemove called');
    self.stopMetadataTimer();
    self.removeToBrowseSources();
    return libQ.resolve();
};

/*
 * Restarts the Radio France service.
 *
 * Currently no additional restart action is required.
 */
ControllerRadioFrance.prototype.onRestart = function() {
    return libQ.resolve();
};

/*
 * Returns the station logo filename.
 *
 * Uses a default logo when the requested image
 * is missing.
 */
ControllerRadioFrance.prototype.getStationLogo = function(station) {
    var defaultLogo = 'radio-france-logo.png';
    if (!station || !station.logo) {
        return defaultLogo;
    }
    var logoPath = __dirname + '/images/' + station.logo;
    if (fs.existsSync(logoPath)) {
        return station.logo;
    }
    this.logger.info('RadioFrance Missing logo ' + station.logo);
    return defaultLogo;
};

/*
 * Returns the Radio France brand for a station.
 */
ControllerRadioFrance.prototype.getRadioType = function(station) {
    if (station && station.metadataType === 'ici') {
        return 'ICI';
    }
    if (station && station.metadataType === 'national') {
        return 'Radio France';
    }
    return 'Radio-France';
};

/*
 * Registers Radio France as a Volumio browse source.
 */
ControllerRadioFrance.prototype.addToBrowseSources = function() {
    var self = this;
    try {
        self.commandRouter.volumioRemoveToBrowseSources(
            'Radio France'
        );
        self.debugLog(
            'RadioFrance Old browse source removed'
        );
    }
    catch(e) {
        self.debugLog(
            'RadioFrance No previous browse source'
        );
    }
    self.commandRouter.volumioAddToBrowseSources({
        name: 'Radio France',
        uri: 'france-radio',
        plugin_type: 'music_service',
        plugin_name: 'radio_france',
        albumart:
            '/albumart?sourceicon=music_service/radio_france/images/radio-france-logo.png'
    });
    self.debugLog(
        'RadioFrance Browse source added'
    );
    return libQ.resolve();
};

ControllerRadioFrance.prototype.removeToBrowseSources = function() {
    var self = this;
    try {
        self.commandRouter.volumioRemoveToBrowseSources(
            'Radio France'
        );
        self.debugLog(
            'RadioFrance Browse source removed'
        );
    }
    catch(e) {
        self.logger.error(
            'RadioFrance Browse source remove error: ' +
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
ControllerRadioFrance.prototype.handleBrowseUri = function(curUri) {
    this.logger.info(
        'RadioFrance BROWSE CALL uri=' + curUri
    );
    if (!curUri || curUri === 'france-radio' || curUri === 'france-radio/') {
        return this.getRootContent();
    }
    if (curUri.indexOf('france-radio/') === 0) {
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
 * Builds the browse item for one station.
 * Shared by the root list and search results.
 */
ControllerRadioFrance.prototype.getStationItem = function(station) {
    return {
        service: this.serviceName,
        type: 'mywebradio',
        title: station.title,
        artist: '',
        album: '',
        icon: 'fa fa-music',
        uri: 'france-radio/' + station.id,
        albumart:
            '/albumart?sourceicon=music_service/radio_france/images/' +
            this.getStationLogo(station)
    };
};

/*
 * Builds the Radio France root navigation content.
 *
 * Creates the list of available Radio France stations.
 */
ControllerRadioFrance.prototype.getRootContent = function() {
    var self = this;
    var items = self.radioStations.map(function(station) {
        return self.getStationItem(station);
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

ControllerRadioFrance.prototype.getStationContent = function(uri) {
    var self = this;
    var stationId = uri.replace(/^france-radio\//, '');
    var station = self.radioStations.find(function(item) {
        return item.id === stationId;
    });
    self.debugLog(
        'RadioFrance station lookup id=' +
        stationId +
        ' result=' +
        JSON.stringify(station)
    );
    if (!station) {
        self.logger.error(
            'RadioFrance Station not found: ' + stationId
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
        'RadioFrance getStationContent station=' +
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
                        '/albumart?sourceicon=music_service/radio_france/images/' +
                        self.getStationLogo(station)
                }]
            }]
        }
    });
};

/*
 * Converts a Radio France station URI into a playable track.
 *
 * Used by Volumio playback engine.
 */
ControllerRadioFrance.prototype.explodeUri = function(uri) {
    var self = this;
    self.debugLog(
        'RadioFrance explodeUri uri=' + uri
    );
    var stationId =
        uri.replace(/^france-radio\//, '');
    var station =
        self.radioStations.find(function(item) {
            return item.id === stationId;
        });
    if (!station) {
        self.logger.error(
            'RadioFrance explodeUri station not found id=' +
            stationId
        );
        return libQ.resolve([]);
    }
    self.debugLog(
        'RadioFrance explodeUri OK station=' +
        station.title
    );
    return libQ.resolve([{
        service: self.serviceName,
        type: 'track',
        trackType: 'webradio',
        radioType: self.getRadioType(station),
        title: station.title,
        name: station.title,
        artist: '',
        album: '',
        uri: station.stream,
        stationId: station.id,
        stationTitle: station.title,
        albumart:
            '/albumart?sourceicon=music_service/radio_france/images/' +
            self.getStationLogo(station),
        duration: 0
    }]);
};

/*
 * Starts playback of a Radio France stream.
 *
 * Clears the MPD queue, adds the stream,
 * starts playback and initializes metadata updates.
 */
ControllerRadioFrance.prototype.clearAddPlayTrack = function(track) {
    var self = this;
    var station;
    if (track.uri) {
        station = self.radioStations.find(function(item) {
            return item.stream === track.uri;
        });
    }
   self.debugLog(
        'RadioFrance clearAddPlayTrack station=' +
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
		// trackType: station ? station.title : 'Radio France',
        // To use webradio in circle
        trackType: 'webradio',
        radioType: self.getRadioType(station),
        bitrate: '',
        title: station ?
            station.title :
            'Radio France',
        name: station ?
            station.title :
            'Radio France',
        artist: '',
        album: '',
        albumart:
            '/albumart?sourceicon=music_service/radio_france/images/' +
            self.getStationLogo(station),
        uri: track.uri,
        streaming: true,
        stream: station ? station.title : 'Radio France',
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
            'RadioFrance BEFORE INITIAL PUSH=' +
            JSON.stringify(self.state)
        );
        self.commandRouter.servicePushState(
            self.state,
            self.serviceName
        );
        self.debugLog(
            'RadioFrance AFTER INITIAL PUSH=' +
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
            'RadioFrance Playback started station=' +
            (station ? station.title : 'unknown')
        );
        return true;
    });
};

/*
 * Loads Radio France station definitions
 * from radio_stations.json.
 */
ControllerRadioFrance.prototype.addRadioResource = function() {
    var self = this;
    try {
        var data = fs.readJsonSync(
            __dirname + '/radio_stations.json'
        );
        self.radioStations = Array.isArray(data) ? data : data.stations;
    } catch (e) {
        self.logger.error(
            'RadioFrance stations error ' + e.message
        );
        self.radioStations = [];
    }
    self.logger.info(
        'RadioFrance Loaded ' +
        self.radioStations.length +
        ' stations'
    );
};

/*
 * Loads internationalization strings.
 */
ControllerRadioFrance.prototype.loadRadioI18nStrings = function() {
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
ControllerRadioFrance.prototype.getRadioI18nString = function(key) {
    return this.i18nStrings[key] || key;
};

/*
 * Starts periodic metadata updates.
 *
 * Queries Radio France metadata every few seconds.
 */
ControllerRadioFrance.prototype.startMetadataTimer = function(station) {
    var self = this;
    self.debugLog(
        'RadioFrance startMetadataTimer ' +
        (station ? station.title : 'unknown')
    );
    self.stopMetadataTimer();
    if (!station) {
        self.logger.error(
            'RadioFrance Cannot start metadata timer without station'
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
        'RadioFrance Metadata interval: ' +
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
                'RadioFrance Metadata timer exception ' +
                err.message
            );
        }
    }, apiDelay * 1000);
    self.logger.info(
        'RadioFrance Metadata timer started'
    );
};

ControllerRadioFrance.prototype.stopMetadataTimer = function() {
    if (this.metadataTimer) {
        clearInterval(this.metadataTimer);
        this.metadataTimer = null;
    }
};

ControllerRadioFrance.prototype.pushSongState = function(data, station) {
    var self = this;
    var state = {
        status: 'play',
        service: self.serviceName,
		type: 'track',
		trackType: self.getRadioType(station),
		radioType: self.getRadioType(station),
        samplerate: self.state.samplerate || '',
		bitdepth: self.state.bitdepth || '',
		channels: self.state.channels || '',
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

ControllerRadioFrance.prototype.updateMetadata = function(station) {
    var self = this;
    Metadata.getMetadata(
        station.metadataId,
        station.metadataType
    )
    .then(function(data) {
        if (!data) {
            return;
        }
        if (!data.artist && !data.title) {
            return;
        }
        var current =
            station.id + '|' +
            data.artist + '|' +
            data.title + '|' +
            data.album + '|' +
            data.albumart;
        if (current === self.lastMetadata) {
            return;
        }
        self.lastMetadata = current;
        self.debugLog(
            'RadioFrance ' +
            data.artist +
            ' - ' +
            data.title
        );
        var stationAlbumart =
            '/albumart?sourceicon=music_service/radio_france/images/' +
            self.getStationLogo(station);
        var radioType = self.getRadioType(station);
        var state = Object.assign({}, self.state, {
            status: 'play',
            service: self.serviceName,
            type: 'track',
            // To use green circle with duration
            // trackType: station ? station.title : 'Radio France',
            // To use webradio in circle
            trackType: 'webradio',
            radioType: radioType,
            title: data.title,
            name: station.title,
            artist: data.artist,
            album: data.album,
            // Keep the station logo.
            // Radio France "cover" is a UUID, not a Volumio albumart URL.
            albumart: data.albumart || stationAlbumart,
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
                    data.albumart || stationAlbumart;
                queueItem.uri =
                    station.stream;
                // To use green circle with duration
                // queueItem.trackType =
                //    'Radio France';
                // To use webradio in circle
                queueItem.trackType =
                    'webradio';
                queueItem.type =
                    'track';
                queueItem.duration = 0;
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
                'RadioFrance queue update error ' +
                e.message
            );
        }
        self.debugLog(
            'RadioFrance METADATA PUSH station=' +
            station.title +
            ' artist=' +
            data.artist +
            ' title=' +
            data.title
        );
        self.debugLog(
            'RadioFrance BEFORE METADATA PUSH=' +
            JSON.stringify(state)
        );
        self.commandRouter.servicePushState(
            state,
            self.serviceName
        );
        self.debugLog(
            'RadioFrance Metadata PUSH done'
        );
    })
    .catch(function(err) {
        self.logger.error(
            'RadioFrance metadata error ' +
            err.message
        );
    });
};

ControllerRadioFrance.prototype.stop = function() {
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

ControllerRadioFrance.prototype.updateBitrate = function() {
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
                self.state.name || 'Radio France';
        }
        var audioMatch = response.match(
            /audio:\s*(\d+):(\d+):(\d+)/
        );
        if (audioMatch) {
            var sampleRate = parseInt(audioMatch[1], 10);
            var sampleRateKHz = sampleRate / 1000;
            self.state.samplerate =
                (sampleRate % 1000 === 0 ?
                    sampleRateKHz.toFixed(0) :
                    sampleRateKHz.toFixed(1)) +
                ' KHz';
            self.state.bitdepth =
                audioMatch[2] + ' bit';
            self.state.channels =
                parseInt(audioMatch[3], 10);

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
                'RadioFrance Audio detected ' +
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
		// self.state.trackType = self.state.name || 'Radio France';
        // To use webradio in circle
        self.state.trackType = 'webradio';
		self.state.streaming = true;
		self.state.stream = self.state.name || 'Radio France';
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
            'RadioFrance Bitrate socket error ' +
            err.message
        );
    });
};

/*
 * Lowercases and strips accents, so "bearn" finds "ICI Béarn Bigorre".
 */
ControllerRadioFrance.prototype.normalizeSearchText = function(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
};

/*
 * Searches the station list by title.
 *
 * Every word of the query has to appear in the station title,
 * in any order: "ici" finds all ICI stations, "ici azur" only ICI Azur.
 * Returns one list in the same shape as the root browse list,
 * or an empty array when nothing matches.
 */
ControllerRadioFrance.prototype.search = function(query) {
    var self = this;
    var value = query && query.value ? query.value : '';
    var words = self.normalizeSearchText(value)
        .split(/\s+/)
        .filter(function(word) {
            return word.length > 0;
        });
    if (words.length === 0) {
        return libQ.resolve([]);
    }
    var items = [];
    self.radioStations.forEach(function(station) {
        var title = self.normalizeSearchText(station.title);
        var matches = words.every(function(word) {
            return title.indexOf(word) !== -1;
        });
        if (matches) {
            items.push(self.getStationItem(station));
        }
    });
    self.debugLog(
        'RadioFrance search "' + value + '" found ' + items.length + ' stations'
    );
    if (items.length === 0) {
        return libQ.resolve([]);
    }
    return libQ.resolve({
        title: 'Radio France',
        icon: 'fa fa-music',
        availableListViews: ['list'],
        items: items
    });
};
