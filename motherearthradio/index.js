'use strict';

/**
 * Mother Earth Radio Plugin v1.5.1
 * Volumio Standard Pattern (function/prototype)
 */

var libQ = require('kew');
var https = require('https');
var url = require('url');

var SSE_RECONNECT_DELAY_MS = 3000;
var SSE_MAX_RECONNECT_ATTEMPTS = 10;
var SERVICE_NAME = 'motherearthradio';

module.exports = ControllerMotherEarthRadio;

function ControllerMotherEarthRadio(context) {
    var self = this;
    
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    self.configManager = self.context.configManager;
    
    self.serviceName = SERVICE_NAME;
    
    self.state = {
        title: '',
        artist: ''
    };
    self.currentUri = null;
    self.currentChannel = null;
    self.currentQuality = null;
    self.isPlaying = false;
    
    self.sseRequest = null;
    self.sseResponse = null;
    self.sseReconnectAttempts = 0;
    self.sseReconnectTimer = null;
    
    self.apiHost = 'stream.motherearthradio.de';
    
    self.channels = {
        'radio': {
            name: 'Radio',
            shortcode: 'motherearth',
            streams: {
                flac192: 'https://stream.motherearthradio.de/listen/motherearth/motherearth',
                flac96: 'https://stream.motherearthradio.de/listen/motherearth/motherearth.flac-lo',
                aac: 'https://stream.motherearthradio.de/listen/motherearth/motherearth.aac',
                mono192: 'https://stream.motherearthradio.de/listen/motherearth/motherearth.mono'
            }
        },
        'klassik': {
            name: 'Klassik',
            shortcode: 'motherearth_klassik',
            streams: {
                flac192: 'https://stream.motherearthradio.de/listen/motherearth_klassik/motherearth.klassik',
                flac96: 'https://stream.motherearthradio.de/listen/motherearth_klassik/motherearth.klassik.flac-lo',
                aac: 'https://stream.motherearthradio.de/listen/motherearth_klassik/motherearth.klassik.aac',
                mono192: 'https://stream.motherearthradio.de/listen/motherearth_klassik/motherearth.klassik.mono'
            }
        },
        'instrumental': {
            name: 'Instrumental',
            shortcode: 'motherearth_instrumental',
            streams: {
                flac192: 'https://stream.motherearthradio.de/listen/motherearth_instrumental/motherearth.instrumental',
                flac96: 'https://stream.motherearthradio.de/listen/motherearth_instrumental/motherearth.instrumental.flac-lo',
                aac: 'https://stream.motherearthradio.de/listen/motherearth_instrumental/motherearth.instrumental.aac',
                mono192: 'https://stream.motherearthradio.de/listen/motherearth_instrumental/motherearth.instrumental.mono'
            }
        },
        'jazz': {
            name: 'Jazz',
            shortcode: 'motherearth_jazz',
            streams: {
                flac192: 'https://stream.motherearthradio.de/listen/motherearth_jazz/motherearth.jazz',
                flac96: 'https://stream.motherearthradio.de/listen/motherearth_jazz/motherearth.jazz.flac-lo',
                aac: 'https://stream.motherearthradio.de/listen/motherearth_jazz/motherearth.jazz.mp4',
                mono192: 'https://stream.motherearthradio.de/listen/motherearth_jazz/motherearth.jazz.mono'
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// VOLUMIO LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

ControllerMotherEarthRadio.prototype.onVolumioStart = function() {
    var self = this;
    // No configuration needed - plugin is ready
    return libQ.resolve();
};

ControllerMotherEarthRadio.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.mpdPlugin = self.commandRouter.pluginManager.getPlugin('music_service', 'mpd');
    self.addToBrowseSources();
    self.logger.info('[MER] Plugin started (SSE mode)');
    
    defer.resolve();
    return defer.promise;
};

ControllerMotherEarthRadio.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.stopSSE();
    self.removeFromBrowseSources();
    
    defer.resolve();
    return defer.promise;
};

ControllerMotherEarthRadio.prototype.onRestart = function() {
    var self = this;
    return libQ.resolve();
};

ControllerMotherEarthRadio.prototype.getConfigurationFiles = function() {
    return [];
};

// ═══════════════════════════════════════════════════════════════════════════
// SSE (SERVER-SENT EVENTS)
// ═══════════════════════════════════════════════════════════════════════════

ControllerMotherEarthRadio.prototype.startSSE = function(channelKey) {
    var self = this;
    
    self.stopSSE();
    
    var channel = self.channels[channelKey];
    if (!channel) {
        self.logger.error('[MER] Unknown channel: ' + channelKey);
        return;
    }
    
    var subs = { subs: {} };
    subs.subs['station:' + channel.shortcode] = {};
    var sseUrl = 'https://' + self.apiHost + '/api/live/nowplaying/sse?cf_connect=' + encodeURIComponent(JSON.stringify(subs));
    
    self.logger.info('[MER] 🔌 Starting SSE for ' + channel.name);
    self.connectSSE(sseUrl, channelKey);
};

ControllerMotherEarthRadio.prototype.connectSSE = function(sseUrl, channelKey) {
    var self = this;
    var parsedUrl = new url.URL(sseUrl);
    
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    };

    self.sseRequest = https.request(options, function(response) {
        if (response.statusCode !== 200) {
            self.logger.error('[MER] SSE connection failed: ' + response.statusCode);
            self.scheduleSSEReconnect(sseUrl, channelKey);
            return;
        }

        self.logger.info('[MER] ✅ SSE connected');
        self.sseReconnectAttempts = 0;
        
        self.sseResponse = response;

        var buffer = '';

        response.on('data', function(chunk) {
            buffer += chunk.toString();
            
            var messages = buffer.split('\n\n');
            buffer = messages.pop();
            
            for (var i = 0; i < messages.length; i++) {
                self.handleSSEMessage(messages[i], channelKey);
            }
        });

        response.on('end', function() {
            self.logger.warn('[MER] SSE connection closed');
            self.scheduleSSEReconnect(sseUrl, channelKey);
        });

        response.on('error', function(err) {
            self.logger.error('[MER] SSE error: ' + err.message);
            self.scheduleSSEReconnect(sseUrl, channelKey);
        });
    });

    self.sseRequest.on('error', function(err) {
        self.logger.error('[MER] SSE request error: ' + err.message);
        self.scheduleSSEReconnect(sseUrl, channelKey);
    });

    self.sseRequest.end();
};

ControllerMotherEarthRadio.prototype.handleSSEMessage = function(message, channelKey) {
    var self = this;
    var lines = message.split('\n');
    var data = null;
    var rawData = null;
    
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('data: ') === 0) {
            rawData = lines[i].substring(6).trim();
            
            if (rawData === '' || rawData === '{}') {
                return;
            }
            
            try {
                data = JSON.parse(rawData);
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
    
    if (!data) return;
    
    if (Object.keys(data).length === 0) {
        return;
    }
    
    if (data.connect) {
        if (data.connect.data && Array.isArray(data.connect.data)) {
            for (var j = 0; j < data.connect.data.length; j++) {
                self.processNowPlayingData(data.connect.data[j], channelKey);
            }
        }
        return;
    }
    
    self.processNowPlayingData(data, channelKey);
};

ControllerMotherEarthRadio.prototype.processNowPlayingData = function(data, channelKey) {
    var self = this;
    
    if (!self.isPlaying) {
        return;
    }
    
    if (channelKey !== self.currentChannel) {
        self.logger.info('[MER] ⏭️ Ignoring metadata from ' + channelKey + ' (playing: ' + self.currentChannel + ')');
        return;
    }
    
    var np = (data && data.pub && data.pub.data && data.pub.data.np) || (data && data.np);
    
    if (!np || !np.now_playing) return;

    var song = np.now_playing.song;
    var duration = np.now_playing.duration || np.now_playing.remaining || 0;
    var elapsed = np.now_playing.elapsed || 0;
    
    if (!song || !song.title || !song.artist) {
        return;
    }

    if (self.state.title === song.title && self.state.artist === song.artist) {
        return;
    }

    self.logger.info('[MER] 🎵 ' + song.artist + ' - ' + song.title);
    self.pushMetadata(song, duration, elapsed);
};

ControllerMotherEarthRadio.prototype.pushMetadata = function(song, duration, elapsed) {
    var self = this;
    
    if (!self.isPlaying) {
        self.logger.info('[MER] ⏸️ pushMetadata ignored - not playing');
        return;
    }
    
    var channel = self.channels[self.currentChannel];
    if (!channel) return;

    var samplerate = self.getSampleRate(self.currentQuality);
    var bitdepth = self.getBitDepth(self.currentQuality);
    var albumart = song.art || '/albumart?sourceicon=music_service/motherearthradio/mer-logo-cube-bold-1x 512.png';

    var merState = {
        status: 'play',
        service: SERVICE_NAME,
        type: 'webradio',
        trackType: (self.currentQuality === 'aac') ? 'aac' : 'flac',
        radioType: 'mer',
        albumart: albumart,
        uri: self.currentUri,
        name: song.title || 'Unknown',
        title: song.title || 'Unknown',
        artist: song.artist || 'Mother Earth Radio',
        album: song.album || channel.name,
        streaming: true,
        disableUiControls: true,
        duration: duration,
        seek: 0,
        samplerate: samplerate,
        bitdepth: bitdepth,
        channels: (self.currentQuality === 'mono192') ? 1 : 2
    };
    
    self.state = merState;
    
    try {
        var vState = self.commandRouter.stateMachine.getState();
        var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
        
        if (queueItem) {
            queueItem.name = song.title || 'Unknown';
            queueItem.title = song.title || 'Unknown';
            queueItem.artist = song.artist || 'Mother Earth Radio';
            queueItem.album = song.album || channel.name;
            queueItem.albumart = albumart;
            queueItem.trackType = 'Mother Earth ' + channel.name;
            queueItem.duration = duration;
            queueItem.samplerate = samplerate;
            queueItem.bitdepth = bitdepth;
            queueItem.channels = (self.currentQuality === 'mono192') ? 1 : 2;
        }
        
        self.commandRouter.stateMachine.currentSeek = 0;
        self.commandRouter.stateMachine.playbackStart = Date.now();
        self.commandRouter.stateMachine.currentSongDuration = duration;
        self.commandRouter.stateMachine.askedForPrefetch = false;
        self.commandRouter.stateMachine.prefetchDone = false;
        self.commandRouter.stateMachine.simulateStopStartDone = false;
    } catch (e) {
        self.logger.error('[MER] Queue update failed: ' + e.message);
    }

    self.logger.info('[MER] 📤 ' + song.artist + ' - ' + song.title);
    
    self.commandRouter.servicePushState(merState, SERVICE_NAME);
};

ControllerMotherEarthRadio.prototype.scheduleSSEReconnect = function(sseUrl, channelKey) {
    var self = this;
    
    if (!self.isPlaying) {
        return;
    }
    
    if (self.sseReconnectAttempts >= SSE_MAX_RECONNECT_ATTEMPTS) {
        self.logger.error('[MER] SSE: Max reconnect attempts reached');
        return;
    }

    self.sseReconnectAttempts++;
    var delay = SSE_RECONNECT_DELAY_MS * self.sseReconnectAttempts;
    
    self.logger.info('[MER] SSE: Reconnecting in ' + delay + 'ms');
    
    self.sseReconnectTimer = setTimeout(function() {
        self.connectSSE(sseUrl, channelKey);
    }, delay);
};

ControllerMotherEarthRadio.prototype.stopSSE = function() {
    var self = this;
    
    if (self.sseReconnectTimer) {
        clearTimeout(self.sseReconnectTimer);
        self.sseReconnectTimer = null;
    }
    
    if (self.sseResponse) {
        try {
            self.sseResponse.removeAllListeners();
            self.sseResponse.destroy();
        } catch (e) {
            self.logger.error('[MER] Error destroying SSE response: ' + e.message);
        }
        self.sseResponse = null;
    }
    
    if (self.sseRequest) {
        try {
            self.sseRequest.removeAllListeners();
            self.sseRequest.destroy();
        } catch (e) {
            self.logger.error('[MER] Error destroying SSE request: ' + e.message);
        }
        self.sseRequest = null;
    }
    
    self.sseReconnectAttempts = 0;
};

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK CONTROL
// ═══════════════════════════════════════════════════════════════════════════

ControllerMotherEarthRadio.prototype.clearAddPlayTrack = function(track) {
    var self = this;
    var defer = libQ.defer();
    
    self.stopSSE();
    
    self.currentChannel = self.getChannelFromUri(track.uri);
    self.currentQuality = self.getQualityFromUri(track.uri);
    self.currentUri = track.uri;
    self.isPlaying = true;
    
    var streamUrl = self.getStreamUrl(self.currentChannel, self.currentQuality);
    
    if (!streamUrl) {
        defer.reject('Unknown channel');
        return defer.promise;
    }
    
    self.logger.info('[MER] ▶️ Playing: ' + streamUrl);
    
    self.startSSE(self.currentChannel);
    
    self.mpdPlugin.sendMpdCommand('stop', [])
        .then(function() { 
            return self.mpdPlugin.sendMpdCommand('clear', []); 
        })
        .then(function() { 
            return self.mpdPlugin.sendMpdCommand('add "' + streamUrl + '"', []); 
        })
        .then(function() {
            self.commandRouter.pushToastMessage('info', 'Mother Earth Radio', 'Connecting to stream...');
            return self.mpdPlugin.sendMpdCommand('play', []);
        })
        .then(function() {
            var channel = self.channels[self.currentChannel];
            var qualityLabel = self.getQualityLabel(self.currentQuality);
            
            self.commandRouter.servicePushState({
                status: 'play',
                service: SERVICE_NAME,
                type: 'webradio',
                trackType: (self.currentQuality === 'aac') ? 'aac' : 'flac',
                radioType: 'mer',
                title: 'Connecting...',
                artist: 'Mother Earth Radio',
                album: channel.name + ' · ' + qualityLabel,
                albumart: '/albumart?sourceicon=music_service/motherearthradio/mer-logo-cube-bold-1x 512.png',
                uri: track.uri,
                streaming: true,
                disableUiControls: true,
                samplerate: self.getSampleRate(self.currentQuality),
                bitdepth: self.getBitDepth(self.currentQuality),
                duration: 0,
                seek: 0
            }, SERVICE_NAME);
            
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('[MER] Play failed: ' + err);
            self.isPlaying = false;
            defer.reject(err);
        });
    
    return defer.promise;
};

ControllerMotherEarthRadio.prototype.stop = function() {
    var self = this;
    
    self.isPlaying = false;
    self.stopSSE();
    
    self.commandRouter.pushToastMessage('info', 'Mother Earth Radio', 'Stopped playback');
    
    self.commandRouter.servicePushState({
        status: 'stop',
        service: SERVICE_NAME
    }, SERVICE_NAME);
    
    return self.mpdPlugin.stop();
};

ControllerMotherEarthRadio.prototype.pause = function() {
    var self = this;
    return self.stop();
};

ControllerMotherEarthRadio.prototype.resume = function() {
    var self = this;
    if (self.currentUri) {
        return self.clearAddPlayTrack({ uri: self.currentUri });
    }
    return libQ.resolve();
};

// ═══════════════════════════════════════════════════════════════════════════
// BROWSE / NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

ControllerMotherEarthRadio.prototype.addToBrowseSources = function() {
    var self = this;
    self.commandRouter.volumioAddToBrowseSources({
        name: 'Mother Earth Radio',
        uri: 'motherearthradio',
        plugin_type: 'music_service',
        plugin_name: SERVICE_NAME,
        albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg'
    });
};

ControllerMotherEarthRadio.prototype.removeFromBrowseSources = function() {
    var self = this;
    self.commandRouter.volumioRemoveToBrowseSources('Mother Earth Radio');
};

ControllerMotherEarthRadio.prototype.handleBrowseUri = function(curUri) {
    var self = this;
    if (curUri.indexOf('motherearthradio') === 0) {
        return self.browseRoot();
    }
    return libQ.resolve({ navigation: { lists: [] } });
};

ControllerMotherEarthRadio.prototype.browseRoot = function() {
    var self = this;
    var defer = libQ.defer();
    var items = [];
    var keys = Object.keys(self.channels);
    
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var channel = self.channels[key];
        
        items.push({
            service: SERVICE_NAME,
            type: 'mywebradio',
            title: channel.name + ' (FLAC 192kHz/24bit)',
            icon: 'fa fa-music',
            uri: 'motherearthradio/' + key + '/flac192',
            albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg'
        });
        
        items.push({
            service: SERVICE_NAME,
            type: 'mywebradio',
            title: channel.name + ' (FLAC 96kHz/24bit)',
            icon: 'fa fa-music',
            uri: 'motherearthradio/' + key + '/flac96',
            albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg'
        });
        
        items.push({
            service: SERVICE_NAME,
            type: 'mywebradio',
            title: channel.name + ' (FLAC 192kHz/24bit Mono - Reduced Listening Effort)',
            icon: 'fa fa-music',
            uri: 'motherearthradio/' + key + '/mono192',
            albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg'
        });
        
        items.push({
            service: SERVICE_NAME,
            type: 'mywebradio',
            title: channel.name + ' (AAC 96kHz)',
            icon: 'fa fa-music',
            uri: 'motherearthradio/' + key + '/aac',
            albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg'
        });
    }

    defer.resolve({
        navigation: {
            lists: [{
                availableListViews: ['list', 'grid'],
                items: items
            }],
            prev: { uri: '/' }
        }
    });
    
    return defer.promise;
};

ControllerMotherEarthRadio.prototype.explodeUri = function(uri) {
    var self = this;
    var defer = libQ.defer();
    
    var channelKey = self.getChannelFromUri(uri);
    var quality = self.getQualityFromUri(uri);
    var channel = self.channels[channelKey];
    
    if (!channel) {
        defer.reject('Unknown channel');
        return defer.promise;
    }

    var qualityLabel = self.getQualityLabel(quality);
    
    defer.resolve([{
        service: SERVICE_NAME,
        type: 'track',
        trackType: (quality === 'aac') ? 'aac' : 'flac',
        radioType: SERVICE_NAME,
        title: channel.name + ' (' + qualityLabel + ')',
        name: channel.name,
        uri: uri,
        albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg',
        duration: 0,
        samplerate: self.getSampleRate(quality),
        bitdepth: self.getBitDepth(quality)
    }]);
    
    return defer.promise;
};

ControllerMotherEarthRadio.prototype.search = function(query) {
    return libQ.resolve([]);
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

ControllerMotherEarthRadio.prototype.getChannelFromUri = function(uri) {
    var self = this;
    if (!uri) return 'radio';
    var parts = uri.split('/');
    if (parts[0] === 'motherearthradio' && parts.length >= 2) {
        if (self.channels[parts[1]]) return parts[1];
    }
    return 'radio';
};

ControllerMotherEarthRadio.prototype.getQualityFromUri = function(uri) {
    if (!uri) return 'flac192';
    var parts = uri.split('/');
    if (parts[0] === 'motherearthradio' && parts.length >= 3) {
        if (['flac192', 'flac96', 'aac', 'mono192'].indexOf(parts[2]) >= 0) {
            return parts[2];
        }
    }
    return 'flac192';
};

ControllerMotherEarthRadio.prototype.getStreamUrl = function(channelKey, quality) {
    var self = this;
    var channel = self.channels[channelKey];
    if (!channel) return null;
    return channel.streams[quality] || channel.streams.flac192;
};

ControllerMotherEarthRadio.prototype.getQualityLabel = function(quality) {
    if (quality === 'flac192') return 'FLAC 192kHz/24bit Stereo';
    if (quality === 'flac96') return 'FLAC 96kHz/24bit Stereo';
    if (quality === 'mono192') return 'FLAC 192kHz/24bit Mono';
    if (quality === 'aac') return 'AAC 96kHz';
    return quality;
};

ControllerMotherEarthRadio.prototype.getSampleRate = function(quality) {
    if (quality === 'flac192') return '192 kHz';
    if (quality === 'flac96') return '96 kHz';
    if (quality === 'mono192') return 'MONO/192 kHz';
    if (quality === 'aac') return '96 kHz';
    return '';
};

ControllerMotherEarthRadio.prototype.getBitDepth = function(quality) {
    if (quality === 'flac192') return '24 bit';
    if (quality === 'flac96') return '24 bit';
    if (quality === 'mono192') return '24 bit';
    return '';
};
