'use strict';

/**
 * Mother Earth Radio Plugin v1.4
 */

const libQ = require('kew');
const fs = require('fs-extra');
const https = require('https');
const { URL } = require('url');

const SSE_RECONNECT_DELAY_MS = 3000;
const SSE_MAX_RECONNECT_ATTEMPTS = 10;
const HIGH_LATENCY_BUFFER_KB = 32768;
const HIGH_LATENCY_DELAY_MS = 2000;
const NORMAL_BUFFER_KB = 4096;
const SERVICE_NAME = 'motherearthradio';

class MotherEarthRadio {
    constructor(context) {
        this.context = context;
        this.commandRouter = context.coreCommand;
        this.logger = context.logger;
        this.configManager = context.configManager;
        
        this.serviceName = SERVICE_NAME;
        
        this.state = {
            title: '',
            artist: ''
        };
        this.currentUri = null;
        this.currentChannel = null;
        this.currentQuality = null;
        this.isPlaying = false;
        
        this.sseRequest = null;
        this.sseReconnectAttempts = 0;
        this.sseReconnectTimer = null;
        
        this.metadataDelay = 0;
        this.highLatencyMode = false;
        
        this.apiHost = 'motherearth.streamserver24.com';
        
        this.channels = {
            'radio': {
                name: 'Radio',
                shortcode: 'motherearth',
                streams: {
                    flac192: 'https://motherearth.streamserver24.com/listen/motherearth/motherearth',
                    flac96: 'https://motherearth.streamserver24.com/listen/motherearth/motherearth.flac-lo',
                    aac: 'https://motherearth.streamserver24.com/listen/motherearth/motherearth.aac'
                }
            },
            'klassik': {
                name: 'Klassik',
                shortcode: 'motherearth_klassik',
                streams: {
                    flac192: 'https://motherearth.streamserver24.com/listen/motherearth_klassik/motherearth.klassik',
                    flac96: 'https://motherearth.streamserver24.com/listen/motherearth_klassik/motherearth.klassik.flac-lo',
                    aac: 'https://motherearth.streamserver24.com/listen/motherearth_klassik/motherearth.klassik.aac'
                }
            },
            'instrumental': {
                name: 'Instrumental',
                shortcode: 'motherearth_instrumental',
                streams: {
                    flac192: 'https://motherearth.streamserver24.com/listen/motherearth_instrumental/motherearth.instrumental',
                    flac96: 'https://motherearth.streamserver24.com/listen/motherearth_instrumental/motherearth.instrumental.flac-lo',
                    aac: 'https://motherearth.streamserver24.com/listen/motherearth_instrumental/motherearth.instrumental.aac'
                }
            },
            'jazz': {
                name: 'Jazz',
                shortcode: 'motherearth_jazz',
                streams: {
                    flac192: 'https://motherearth.streamserver24.com/listen/motherearth_jazz/motherearth.jazz',
                    flac96: 'https://motherearth.streamserver24.com/listen/motherearth_jazz/motherearth.jazz.flac-lo',
                    aac: 'https://motherearth.streamserver24.com/listen/motherearth_jazz/motherearth.jazz.aac'
                }
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VOLUMIO LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════════

    onVolumioStart() {
        const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
        this.config = new (require('v-conf'))();
        this.config.loadFile(configFile);
        return libQ.resolve();
    }

    onStart() {
        this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');
        this.addToBrowseSources();
        
        this.metadataDelay = this.config.get('apiDelay') || 0;
        this.highLatencyMode = this.config.get('highLatencyMode') || false;
        
        if (this.highLatencyMode) {
            this.applyHighLatencyBuffer();
        }
        
        this.log('info', 'Plugin started (SSE mode)');
        return libQ.resolve();
    }

    onStop() {
        this.stopSSE();
        this.removeFromBrowseSources();
        return libQ.resolve();
    }

    onRestart() {
        return libQ.resolve();
    }

    getConfigurationFiles() {
        return ['config.json'];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SSE (SERVER-SENT EVENTS)
    // ═══════════════════════════════════════════════════════════════════════════

    startSSE(channelKey) {
        this.stopSSE();
        
        const channel = this.channels[channelKey];
        if (!channel) {
            this.log('error', 'Unknown channel: ' + channelKey);
            return;
        }
        
        const subs = { subs: { ['station:' + channel.shortcode]: {} } };
        const sseUrl = 'https://' + this.apiHost + '/api/live/nowplaying/sse?cf_connect=' + encodeURIComponent(JSON.stringify(subs));
        
        this.log('info', '🔌 Starting SSE for ' + channel.name);
        this.connectSSE(sseUrl, channelKey);
    }

    connectSSE(sseUrl, channelKey) {
        const self = this;
        const url = new URL(sseUrl);
        
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        };

        this.sseRequest = https.request(options, function(response) {
            if (response.statusCode !== 200) {
                self.log('error', 'SSE connection failed: ' + response.statusCode);
                self.scheduleSSEReconnect(sseUrl, channelKey);
                return;
            }

            self.log('info', '✅ SSE connected');
            self.sseReconnectAttempts = 0;

            let buffer = '';

            response.on('data', function(chunk) {
                buffer += chunk.toString();
                
                const messages = buffer.split('\n\n');
                buffer = messages.pop();
                
                for (let i = 0; i < messages.length; i++) {
                    self.handleSSEMessage(messages[i], channelKey);
                }
            });

            response.on('end', function() {
                self.log('warn', 'SSE connection closed');
                self.scheduleSSEReconnect(sseUrl, channelKey);
            });

            response.on('error', function(err) {
                self.log('error', 'SSE error: ' + err.message);
                self.scheduleSSEReconnect(sseUrl, channelKey);
            });
        });

        this.sseRequest.on('error', function(err) {
            self.log('error', 'SSE request error: ' + err.message);
            self.scheduleSSEReconnect(sseUrl, channelKey);
        });

        this.sseRequest.end();
    }

    handleSSEMessage(message, channelKey) {
        const lines = message.split('\n');
        let data = null;
        let rawData = null;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('data: ') === 0) {
                rawData = lines[i].substring(6).trim();
                
                // 🔥 IGNORE EMPTY PINGS (like Android app)
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
        
        // 🔥 IGNORE EMPTY JSON OBJECTS
        if (Object.keys(data).length === 0) {
            return;
        }
        
        if (data.connect) {
            if (data.connect.data && Array.isArray(data.connect.data)) {
                for (let i = 0; i < data.connect.data.length; i++) {
                    this.processNowPlayingData(data.connect.data[i], channelKey);
                }
            }
            return;
        }
        
        this.processNowPlayingData(data, channelKey);
    }

    processNowPlayingData(data, channelKey) {
        if (!this.isPlaying) {
            return;
        }
        
        const np = (data && data.pub && data.pub.data && data.pub.data.np) || (data && data.np);
        
        if (!np || !np.now_playing) return;

        const song = np.now_playing.song;
        const duration = np.now_playing.duration || np.now_playing.remaining || 0;
        const elapsed = np.now_playing.elapsed || 0;
        
        // 🔥 IGNORE EMPTY SSE PINGS - must have valid song with title AND artist
        if (!song || !song.title || !song.artist) {
            return;
        }

        // 🔥 ONLY UPDATE ON SONG CHANGE (like v1.3 timer approach)
        // Check if this is a different song than currently playing
        if (this.state.title === song.title && this.state.artist === song.artist) {
            return; // Same song still playing, don't update
        }

        this.log('info', '🎵 ' + song.artist + ' - ' + song.title);
        
        const delay = this.getEffectiveDelay();
        const self = this;
        
        if (delay > 0) {
            setTimeout(function() {
                self.pushMetadata(song, duration, elapsed);
            }, delay);
        } else {
            this.pushMetadata(song, duration, elapsed);
        }
    }

    pushMetadata(song, duration, elapsed) {
        if (!this.isPlaying) {
            this.log('info', '⏸️ pushMetadata ignored - not playing');
            return;
        }
        
        const self = this;
        const channel = this.channels[this.currentChannel];
        if (!channel) return;

        const samplerate = this.getSampleRate(this.currentQuality);
        const bitdepth = this.getBitDepth(this.currentQuality);
        const albumart = song.art || '/albumart?sourceicon=music_service/motherearthradio/mer-logo-cube-bold-1x 512.png';

        const merState = {
            status: 'play',
            service: SERVICE_NAME,
            type: 'webradio',
            trackType: (this.currentQuality === 'aac') ? 'aac' : 'flac',
            radioType: 'mer',
            albumart: albumart,
            uri: this.currentUri,
            name: song.title || 'Unknown',
            title: song.title || 'Unknown',
            artist: song.artist || 'Mother Earth Radio',
            album: song.album || channel.name,
            streaming: true,
            disableUiControls: true,
            duration: duration,  // Real song duration (like v1.3: remaining)
            seek: 0,  // 🔥 ALWAYS 0 - let Volumio count up (like v1.3)
            samplerate: samplerate,
            bitdepth: bitdepth,
            channels: 2
        };
        
        this.state = merState;
        
        // WORKAROUND: Directly modify queue item to allow state update for webradio
        try {
            const vState = this.commandRouter.stateMachine.getState();
            const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
            
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
                queueItem.channels = 2;
            }
            
            // 🔥 Reset Volumio internal timer (like v1.3)
            // ALWAYS start from 0, let Volumio count up to duration
            this.commandRouter.stateMachine.currentSeek = 0;
            this.commandRouter.stateMachine.playbackStart = Date.now();
            this.commandRouter.stateMachine.currentSongDuration = duration;
            this.commandRouter.stateMachine.askedForPrefetch = false;
            this.commandRouter.stateMachine.prefetchDone = false;
            this.commandRouter.stateMachine.simulateStopStartDone = false;
        } catch (e) {
            this.log('error', 'Queue update failed: ' + e.message);
        }

        this.log('info', '📤 ' + song.artist + ' - ' + song.title);
        
        this.commandRouter.servicePushState(merState, SERVICE_NAME);
    }

    scheduleSSEReconnect(sseUrl, channelKey) {
        const self = this;
        
        if (!this.isPlaying) {
            return;
        }
        
        if (this.sseReconnectAttempts >= SSE_MAX_RECONNECT_ATTEMPTS) {
            this.log('error', 'SSE: Max reconnect attempts reached');
            return;
        }

        this.sseReconnectAttempts++;
        const delay = SSE_RECONNECT_DELAY_MS * this.sseReconnectAttempts;
        
        this.log('info', 'SSE: Reconnecting in ' + delay + 'ms');
        
        this.sseReconnectTimer = setTimeout(function() {
            self.connectSSE(sseUrl, channelKey);
        }, delay);
    }

    stopSSE() {
        if (this.sseReconnectTimer) {
            clearTimeout(this.sseReconnectTimer);
            this.sseReconnectTimer = null;
        }
        
        if (this.sseRequest) {
            this.sseRequest.destroy();
            this.sseRequest = null;
        }
        
        this.sseReconnectAttempts = 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PLAYBACK CONTROL
    // ═══════════════════════════════════════════════════════════════════════════

    clearAddPlayTrack(track) {
        const self = this;
        const defer = libQ.defer();
        
        this.stopSSE();
        
        this.currentChannel = this.getChannelFromUri(track.uri);
        this.currentQuality = this.getQualityFromUri(track.uri);
        this.currentUri = track.uri;
        this.isPlaying = true;
        
        const streamUrl = this.getStreamUrl(this.currentChannel, this.currentQuality);
        
        if (!streamUrl) {
            defer.reject('Unknown channel');
            return defer.promise;
        }
        
        this.log('info', '▶️ Playing: ' + streamUrl);
        
        this.startSSE(this.currentChannel);
        
        this.mpdPlugin.sendMpdCommand('stop', [])
            .then(function() { return self.mpdPlugin.sendMpdCommand('clear', []); })
            .then(function() { return self.mpdPlugin.sendMpdCommand('add "' + streamUrl + '"', []); })
            .then(function() {
                // 🔥 Toast message like v1.3 - hardcoded English
                self.commandRouter.pushToastMessage('info', 'Mother Earth Radio', 'Connecting to stream...');
                return self.mpdPlugin.sendMpdCommand('play', []);
            })
            .then(function() {
                const channel = self.channels[self.currentChannel];
                const qualityLabel = self.getQualityLabel(self.currentQuality);
                
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
                self.log('error', 'Play failed: ' + err);
                self.isPlaying = false;
                defer.reject(err);
            });
        
        return defer.promise;
    }

    stop() {
        this.isPlaying = false;
        this.stopSSE();
        
        // 🔥 Toast message like v1.3 - hardcoded English
        this.commandRouter.pushToastMessage('info', 'Mother Earth Radio', 'Stopped playback');
        
        this.commandRouter.servicePushState({
            status: 'stop',
            service: SERVICE_NAME
        }, SERVICE_NAME);
        
        return this.mpdPlugin.stop();
    }

    pause() {
        return this.stop();
    }

    resume() {
        if (this.currentUri) {
            return this.clearAddPlayTrack({ uri: this.currentUri });
        }
        return libQ.resolve();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BROWSE / NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════

    addToBrowseSources() {
        this.commandRouter.volumioAddToBrowseSources({
            name: 'Mother Earth Radio',
            uri: 'motherearthradio',
            plugin_type: 'music_service',
            plugin_name: SERVICE_NAME,
            albumart: '/albumart?sourceicon=music_service/motherearthradio/motherearthlogo.svg'
        });
    }

    removeFromBrowseSources() {
        this.commandRouter.volumioRemoveToBrowseSources('Mother Earth Radio');
    }

    handleBrowseUri(uri) {
        if (uri.indexOf('motherearthradio') === 0) {
            return this.browseRoot();
        }
        return libQ.resolve({ navigation: { lists: [] } });
    }

    browseRoot() {
        const defer = libQ.defer();
        const items = [];
        const keys = Object.keys(this.channels);
        
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const channel = this.channels[key];
            
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
    }

    explodeUri(uri) {
        const defer = libQ.defer();
        
        const channelKey = this.getChannelFromUri(uri);
        const quality = this.getQualityFromUri(uri);
        const channel = this.channels[channelKey];
        
        if (!channel) {
            defer.reject('Unknown channel');
            return defer.promise;
        }

        const qualityLabel = this.getQualityLabel(quality);
        
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
            samplerate: this.getSampleRate(quality),
            bitdepth: this.getBitDepth(quality)
        }]);
        
        return defer.promise;
    }

    search(query) {
        return libQ.resolve([]);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION UI
    // ═══════════════════════════════════════════════════════════════════════════

    getUIConfig() {
        const self = this;
        const defer = libQ.defer();
        const lang_code = this.commandRouter.sharedVars.get('language_code');
        
        this.commandRouter.i18nJson(
            __dirname + '/i18n/strings_' + lang_code + '.json',
            __dirname + '/i18n/strings_en.json',
            __dirname + '/UIConfig.json'
        )
        .then(function(uiconf) {
            uiconf.sections[0].content[0].value = self.config.get('highLatencyMode') || false;
            uiconf.sections[0].content[1].value = self.config.get('apiDelay') || 0;
            defer.resolve(uiconf);
        })
        .fail(function(err) {
            defer.reject(err);
        });
        
        return defer.promise;
    }

    saveConfig(data) {
        const oldHighLatencyMode = this.config.get('highLatencyMode') || false;
        const newHighLatencyMode = data.highLatencyMode || false;
        
        this.config.set('highLatencyMode', newHighLatencyMode);
        this.config.set('apiDelay', data.apiDelay || 0);
        
        this.highLatencyMode = newHighLatencyMode;
        this.metadataDelay = data.apiDelay || 0;
        
        if (newHighLatencyMode && !oldHighLatencyMode) {
            this.applyHighLatencyBuffer();
            this.commandRouter.pushToastMessage('success', 'Mother Earth Radio', 'High Latency Mode enabled');
        } else if (!newHighLatencyMode && oldHighLatencyMode) {
            this.restoreNormalBuffer();
            this.commandRouter.pushToastMessage('success', 'Mother Earth Radio', 'High Latency Mode disabled');
        } else {
            this.commandRouter.pushToastMessage('success', 'Mother Earth Radio', 'Settings saved');
        }
        
        return libQ.resolve();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HIGH LATENCY MODE
    // ═══════════════════════════════════════════════════════════════════════════

    applyHighLatencyBuffer() {
        if (!this.mpdPlugin || !this.mpdPlugin.config) return false;
        try {
            this.mpdPlugin.config.set('audio_buffer_size', HIGH_LATENCY_BUFFER_KB);
            this.log('info', 'High Latency buffer applied');
            return true;
        } catch (err) {
            return false;
        }
    }

    restoreNormalBuffer() {
        if (!this.mpdPlugin || !this.mpdPlugin.config) return false;
        try {
            this.mpdPlugin.config.set('audio_buffer_size', NORMAL_BUFFER_KB);
            return true;
        } catch (err) {
            return false;
        }
    }

    getEffectiveDelay() {
        let delay = this.metadataDelay || 0;
        if (this.highLatencyMode) {
            delay += HIGH_LATENCY_DELAY_MS;
        }
        return Math.max(0, delay);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    getChannelFromUri(uri) {
        if (!uri) return 'radio';
        const parts = uri.split('/');
        if (parts[0] === 'motherearthradio' && parts.length >= 2) {
            if (this.channels[parts[1]]) return parts[1];
        }
        return 'radio';
    }

    getQualityFromUri(uri) {
        if (!uri) return 'flac192';
        const parts = uri.split('/');
        if (parts[0] === 'motherearthradio' && parts.length >= 3) {
            if (['flac192', 'flac96', 'aac'].indexOf(parts[2]) >= 0) {
                return parts[2];
            }
        }
        return 'flac192';
    }

    getStreamUrl(channelKey, quality) {
        const channel = this.channels[channelKey];
        if (!channel) return null;
        return channel.streams[quality] || channel.streams.flac192;
    }

    getQualityLabel(quality) {
        if (quality === 'flac192') return 'FLAC 192kHz/24bit';
        if (quality === 'flac96') return 'FLAC 96kHz/24bit';
        if (quality === 'aac') return 'AAC 96kHz';
        return quality;
    }

    getSampleRate(quality) {
        if (quality === 'flac192') return '192 kHz';
        if (quality === 'flac96') return '96 kHz';
        if (quality === 'aac') return '96 kHz';
        return '';
    }

    getBitDepth(quality) {
        if (quality === 'flac192') return '24 bit';
        if (quality === 'flac96') return '24 bit';
        return '';
    }

    log(level, message) {
        this.logger.info('[MER] ' + message);
    }
}

module.exports = MotherEarthRadio;
