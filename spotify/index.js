'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var superagent = require('superagent');
var os = require('os');
var websocket = require('ws');
var path = require('path');
var SpotifyWebApi = require('spotify-web-api-node');
var io = require('socket.io-client');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var NodeCache = require('node-cache');
var os = require('os');
var { fetchPagedData, rateLimitedCall } = require('./utils/extendedSpotifyApi');

var configFileDestinationPath = '/data/go-librespot/config.yml';
var credentialsPath = '/data/go-librespot/state.json';
var spotifyDaemonPort = '9879';
var spotifyLocalApiEndpointBase = 'http://127.0.0.1:' + spotifyDaemonPort;
var stateSocket = undefined;

var selectedBitrate;
var loggedInUsername;
var loggedInUserId;
var userCountry;
var seekTimer;
var restartTimeout;
var playbackStartWatchdog;
var playbackStartTimeout = 10000;
var playbackStartConfirmed = false;
var deviceAuthInProgress = false;
var deviceAuthModal;
var wsConnectionStatus = 'started';

// State management
var ws;
var currentVolumioState;
var currentSpotifyVolume;
var currentVolumioVolume;
var isInVolatileMode = false;
var ignoreStopEvent = false;

// Volume limiter
var deltaVolumeTreshold = 2;
var volumeDebounce;


// Debug
var isDebugMode = true;

// Define the ControllerSpotify class
module.exports = ControllerSpotify;

function ControllerSpotify(context) {
    // This fixed variable will let us refer to 'this' object at deeper scopes
    var self = this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
    this.resetSpotifyState();
}


ControllerSpotify.prototype.onVolumioStart = function () {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
}

ControllerSpotify.prototype.getConfigurationFiles = function () {
    return ['config.json'];
}

ControllerSpotify.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();

    self.goLibrespotDaemonWsConnection('stop');
    self.stopLibrespotDaemon();
    self.stopSocketStateListener();
    self.removeToBrowseSources();

    defer.resolve();
    return defer.promise;
};

ControllerSpotify.prototype.onStart = function () {
    var self = this;
    var defer = libQ.defer();

    self.loadI18n();
    self.browseCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
    self.initializeLibrespotDaemon();
    self.initializeSpotifyBrowsingFacility();
    self.applySpotifyHostsFix();
    defer.resolve();
    return defer.promise;
};


ControllerSpotify.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;

    var lang_code = self.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function (uiconf) {
            // Keyed off the refresh token, not credentials_type: that key selects how the
            // daemon authenticates for playback and says nothing about the browsing login.
            self.applyAccountSectionState(uiconf);
            var bitrateNumber = self.config.get('bitrate_number', 320);
            uiconf.sections[2].content[0].value.value = bitrateNumber
            uiconf.sections[2].content[0].value.label = self.getLabelForSelect(uiconf.sections[2].content[0].options, bitrateNumber);

            var normalisationPregainValue = self.config.get('normalisation_pregain', '1.0');
            uiconf.sections[2].content[2].value.value = normalisationPregainValue;
            uiconf.sections[2].content[2].value.label = normalisationPregainValue;

            var icon = self.config.get('icon', 'avr');
            uiconf.sections[2].content[3].value.value = icon;
            uiconf.sections[2].content[3].value.label =  self.getLabelForSelect(uiconf.sections[2].content[3].options, icon);

            var enableAutoplayValue = self.config.get('enable_autoplay', false);
            uiconf.sections[2].content[4].value = enableAutoplayValue;

            var audioBufferTime = self.config.get('audio_buffer_time', 500_000);
            uiconf.sections[2].content[5].value = audioBufferTime;

            var audioPeriodCount = self.config.get('audio_period_count', 4);
            uiconf.sections[2].content[6].value = audioPeriodCount;

            defer.resolve(uiconf);
        })
        .fail(function (error) {
            self.logger.error('Cannot populate Spotify configuration: ' + error);
            defer.reject(new Error());
        });

    return defer.promise;
};

ControllerSpotify.prototype.getAdditionalConf = function (type, controller, data, def) {
    var self = this;
    var setting = self.commandRouter.executeOnPlugin(type, controller, 'getConfigParam', data);

    if (setting == undefined) {
        setting = def;
    }
    return setting;
};

// Controls

ControllerSpotify.prototype.goLibrespotDaemonWsConnection = function (action) {
    var self = this;

    if (action === 'start') {
        wsConnectionStatus = 'started';
        self.initializeWsConnection();
    } else if (action === 'stop') {
        if (ws) {
            ws.terminate();
            ws = undefined;
        }
        wsConnectionStatus = 'stopped';
    } else if (action === 'restart'){
        if (wsConnectionStatus === 'started') {
            if (restartTimeout) {
                clearTimeout(restartTimeout);
            }
            restartTimeout = setTimeout(()=>{
                self.initializeWsConnection();
                restartTimeout = undefined;
            }, 3000);
        }
    }
};

ControllerSpotify.prototype.initializeWsConnection = function () {
    var self = this;

    self.logger.info('Initializing connection to go-librespot Websocket');

    ws = new websocket('ws://localhost:' + spotifyDaemonPort + '/events');
    ws.on('error', function(error){
        self.logger.info('Error connecting to go-librespot Websocket: ' + error);
        self.goLibrespotDaemonWsConnection('restart');
    });

    ws.on('message', function message(data) {
        self.debugLog('received: ' + data);
        self.parseEventState(JSON.parse(data));
    });

    ws.on('open', function () {
        self.logger.info('Connection to go-librespot Websocket established');
        setTimeout(()=>{
            self.initializeSpotifyControls();
        }, 3000);
        ws.on('close', function(){
            self.logger.info('Connection to go-librespot Websocket closed');
            self.goLibrespotDaemonWsConnection('restart');
        });
    });
};

ControllerSpotify.prototype.initializeSpotifyControls = function () {
    var self = this;

    self.resetSpotifyState();
    self.startSocketStateListener();
    self.getSpotifyVolume();
};

ControllerSpotify.prototype.resetSpotifyState = function () {
    var self = this;

    this.state = {
        status: 'stop',
        service: 'spop',
        title: '',
        artist: '',
        album: '',
        albumart: '/albumart',
        uri: '',
        // icon: 'fa fa-spotify',
        trackType: 'spotify',
        seek: 0,
        duration: 0,
        samplerate: '44.1 KHz',
        bitdepth: '16 bit',
        bitrate: '',
        codec: 'ogg',
        channels: 2,
        random: null,
        repeat: null,
        repeatSingle: null,
    };
};

ControllerSpotify.prototype.parseEventState = function (event) {
    var self = this;

    var pushStateforEvent = false;

    // create a switch case which handles types of events
    // and updates the state accordingly
    switch (event.type) {
        case 'metadata':
            playbackStartConfirmed = true;
            self.state.title = event.data.name;
            self.state.duration = self.parseDuration(event.data.duration);
            self.state.uri = event.data.uri;
            self.state.artist = self.parseArtists(event.data.artist_names);
            self.state.album = event.data.album_name;
            self.state.albumart = event.data.album_cover_url;
            self.state.seek = event.data.position;
            pushStateforEvent = false;
            break;
        case 'will_play':
            playbackStartConfirmed = true;
            //impro: use this event to free up audio device when starting volatile?
            pushStateforEvent = false;
            break;
        case 'playing':
            playbackStartConfirmed = true;
            self.state.status = 'play';
            self.identifyPlaybackMode(event.data);
            setTimeout(()=>{
                self.pushState();
            }, 300);
            pushStateforEvent = true;
            break;
        case 'paused':
            self.state.status = 'pause';
            self.identifyPlaybackMode(event.data);
            pushStateforEvent = true;
            break;
        case 'stopped':
            self.state.status = 'stop';
            pushStateforEvent = true;
            break;
        case 'seek':
            self.state.seek = event.data.position;
            pushStateforEvent = true;
        break;
        case 'active':
            //self.state.status = 'play';
            pushStateforEvent = false;
            self.alignSpotifyVolumeToVolumioVolume();
        case 'volume':
            try {
                if (event.data && event.data.value !== undefined) {
                    self.onSpotifyVolumeChange(parseInt(event.data.value));
                }
            } catch(e) {
                self.logger.error('Failed to parse Spotify volume event: ' + e);
            }
            pushStateforEvent = false;
            break;
        case 'shuffle_context':
            self.state.random = event.data.value;
            pushStateforEvent = true;
            break;
        case 'repeat_context':
            self.state.repeatSingle = false;
            self.state.repeat = event.data.value;
            pushStateforEvent = true;
            break;
        case 'repeat_track':
            if (!event.data.value) {
                break;
            }
            self.state.repeatSingle = true;
            self.state.repeat = true;
            pushStateforEvent = true;
            break;
        default:
            self.logger.error('Failed to decode event: ' + event.type);
            pushStateforEvent = false;
            break;
    }

    if (pushStateforEvent) {
        self.pushState(self.state);
    }
};

ControllerSpotify.prototype.identifyPlaybackMode = function (data) {
    var self = this;

    // This functions checks if Spotify is playing in volatile mode or in Volumio mode (playback started from Volumio UI)
    // play_origin = 'go-librespot' means that Spotify is playing in Volumio mode
    // play_origin = 'your_library' or 'playlist' means that Spotify is playing in volatile mode
    if (data && data.play_origin && data.play_origin === 'go-librespot') {
        isInVolatileMode = false;
    } else {
        isInVolatileMode = true;
    }

    // Refactor in order to handle the case where current service is spop but not in volatile mode
    if ((isInVolatileMode && currentVolumioState.service !== 'spop') ||
        (isInVolatileMode && currentVolumioState.service === 'spop' && currentVolumioState.volatile !== true)) {
        self.initializeSpotifyPlaybackInVolatileMode();
    }

};

ControllerSpotify.prototype.initializeSpotifyPlaybackInVolatileMode = function () {
    var self = this;

    self.logger.info('Spotify is playing in volatile mode');
    ignoreStopEvent = true;

    self.commandRouter.stateMachine.setConsumeUpdateService(undefined);
    self.context.coreCommand.stateMachine.setVolatile({
        service: 'spop',
        callback: self.libRespotGoUnsetVolatile()
    });

    setTimeout(()=>{
        ignoreStopEvent = false;
    }, 2000);
};

ControllerSpotify.prototype.parseDuration = function (spotifyDuration) {
    var self = this;

    try {
        return parseInt(spotifyDuration/1000);
    } catch(e) {
        return 0;
    }
}

ControllerSpotify.prototype.getCurrentBitrate = function () {
    var self = this;

    return self.selectedBitrate + ' kbps';
}

ControllerSpotify.prototype.parseArtists = function (spotifyArtists) {
    var self = this;

    var artist = '';
    if (spotifyArtists.length > 0) {
        for (var i in spotifyArtists) {
            if (!artist.length) {
                artist = spotifyArtists[i];
            } else {
                artist = artist + ', ' + spotifyArtists[i];
            }
        }
        return artist;
    } else {
        return spotifyArtists;
    }
}


ControllerSpotify.prototype.libRespotGoUnsetVolatile = function () {
    var self = this;
    var defer = libQ.defer();

    self.debugLog('UNSET VOLATILE');
    self.debugLog(JSON.stringify(currentVolumioState))

    if (currentVolumioState && currentVolumioState.status && currentVolumioState.status !== 'stop') {
        self.logger.info('Setting Spotify stop after unset volatile call');
        setTimeout(()=>{
            self.stop();
            defer.resolve('');
        }, 500);
    } else {
        defer.resolve('');
    }
}

ControllerSpotify.prototype.getState = function () {
    var self = this;

    self.debugLog('GET STATE SPOTIFY');
    self.debugLog(JSON.stringify(self.state));
    return self.state;
};

// Announce updated Spop state
ControllerSpotify.prototype.pushState = function (state) {
    var self = this;

    self.state.bitrate = self.getCurrentBitrate();
    self.debugLog('PUSH STATE SPOTIFY');
    self.debugLog(JSON.stringify(self.state));
    self.seekTimerAction();
    return self.commandRouter.servicePushState(self.state, 'spop');
};

ControllerSpotify.prototype.sendSpotifyLocalApiCommand = function (commandPath) {
    this.logger.info('Sending Spotify command to local API: ' + commandPath);

    superagent.post(spotifyLocalApiEndpointBase + commandPath)
        .accept('application/json')
        .then((results) => {})
        .catch((error) => {
            this.logger.error('Failed to send command to Spotify local API: ' + commandPath  + ': ' + error);
        });
};

ControllerSpotify.prototype.sendSpotifyLocalApiCommandWithPayload = function (commandPath, payload) {
    this.logger.info('Sending Spotify command with payload to local API: ' + commandPath);

    superagent.post(spotifyLocalApiEndpointBase + commandPath)
        .accept('application/json')
        .send(payload)
        .then((results) => {})
        .catch((error) => {
            this.logger.error('Failed to send command to Spotify local API: ' + commandPath  + ': ' + error);
        });
};


ControllerSpotify.prototype.pause = function () {
    this.logger.info('Spotify Received pause');

    this.debugLog('SPOTIFY PAUSE');
    this.debugLog(JSON.stringify(currentVolumioState))
    this.sendSpotifyLocalApiCommand('/player/pause');
};

ControllerSpotify.prototype.play = function () {
    this.logger.info('Spotify Play');

    if (this.state.status === 'pause') {
        this.sendSpotifyLocalApiCommand('/player/resume');
    } else {
        this.sendSpotifyLocalApiCommand('/player/play');
    }

};

ControllerSpotify.prototype.stop = function () {
    this.logger.info('Spotify Stop');
    var defer = libQ.defer();

    this.debugLog('SPOTIFY STOP');
    this.debugLog(JSON.stringify(currentVolumioState))
    if (!ignoreStopEvent) {
        this.sendSpotifyLocalApiCommand('/player/pause');
    }

    defer.resolve('');
    return defer.promise;
};


ControllerSpotify.prototype.resume = function () {
    this.logger.info('Spotify Resume');

    this.sendSpotifyLocalApiCommand('/player/resume');
};

ControllerSpotify.prototype.next = function () {
    this.logger.info('Spotify next');

    this.sendSpotifyLocalApiCommand('/player/next');
};

ControllerSpotify.prototype.previous = function () {
    this.logger.info('Spotify previous');

    this.sendSpotifyLocalApiCommand('/player/prev');
};

ControllerSpotify.prototype.seek = function (position) {
    this.logger.info('Spotify seek to: ' + position);

    this.sendSpotifyLocalApiCommandWithPayload('/player/seek', { position: position });
};

ControllerSpotify.prototype.random = function (value) {
    this.logger.info('Spotify Random: ' + value);
    this.sendSpotifyLocalApiCommandWithPayload('/player/shuffle_context', { shuffle_context: value });
};

ControllerSpotify.prototype.repeat = function (value, repeatSingle) {
    this.logger.info('Spotify Repeat: ' + value + ' - ' + repeatSingle);
    if (repeatSingle) {
        this.sendSpotifyLocalApiCommandWithPayload('/player/repeat_track', { repeat_track: true });
    } else if (value) {
        this.sendSpotifyLocalApiCommandWithPayload('/player/repeat_context', { repeat_context: true });
    } else {
        this.sendSpotifyLocalApiCommandWithPayload('/player/repeat_context', { repeat_context: false });
        this.sendSpotifyLocalApiCommandWithPayload('/player/repeat_track', { repeat_track: false });
    }
};

// Volume events

ControllerSpotify.prototype.onSpotifyVolumeChange = function (volume) {
    var self = this;

    self.debugLog('RECEIVED SPOTIFY VOLUME ' + volume);
    if (volume !== currentVolumioVolume) {
        self.logger.info('Setting Volumio Volume from Spotify: ' + volume);
        currentSpotifyVolume = volume;
        currentVolumioVolume = currentSpotifyVolume;
        self.commandRouter.volumiosetvolume(currentVolumioVolume);
    }

};

ControllerSpotify.prototype.onVolumioVolumeChange = function (volume) {
    var self = this;

    self.debugLog('RECEIVED VOLUMIO VOLUME ' + volume);
    if (volume !== currentSpotifyVolume && self.checkSpotifyAndVolumioDeltaVolumeIsEnough(currentSpotifyVolume, volume)) {
        self.logger.info('Setting Spotify Volume from Volumio: ' + volume);
        currentVolumioVolume = volume;
        currentSpotifyVolume = currentVolumioVolume;
        self.setSpotifyDaemonVolume(currentSpotifyVolume);
    }
};

ControllerSpotify.prototype.setSpotifyDaemonVolume = function (volume) {
    var self = this;

    // Volume limiter
    if (volumeDebounce) {
        clearTimeout(volumeDebounce);
    }
    volumeDebounce = setTimeout(() => {
        self.debugLog('SETTING SPOTIFY VOLUME ' + volume);
        self.sendSpotifyLocalApiCommandWithPayload('/player/volume', { volume: volume });
    }, 1500);
};


ControllerSpotify.prototype.checkSpotifyAndVolumioDeltaVolumeIsEnough = function (spotifyVolume, volumioVolume) {
    var self = this;

    self.debugLog('SPOTIFY VOLUME ' + spotifyVolume);
    self.debugLog('VOLUMIO VOLUME ' + volumioVolume);
    if (spotifyVolume === undefined) {
        return self.alignSpotifyVolumeToVolumioVolume();
    }
    try {
        var isDeltaVolumeEnough = Math.abs(parseInt(spotifyVolume) - parseInt(volumioVolume)) >= deltaVolumeTreshold;
        self.debugLog('DELTA VOLUME ENOUGH: ' + isDeltaVolumeEnough);
        return isDeltaVolumeEnough;
    } catch(e) {
        return false;
    }
};

ControllerSpotify.prototype.alignSpotifyVolumeToVolumioVolume = function () {
    var self = this;

    self.logger.info('Aligning Spotify Volume to Volumio Volume');

    let state = self.commandRouter.volumioGetState();
    let currentVolumioVolumeValue = state && state.volume ? state.volume : undefined;
    let currentDisableVolumeControl = state && state.disableVolumeControl ? state.disableVolumeControl : undefined;
    let currentMuteValue = state && state.mute ? state.mute : undefined;
    if (currentVolumioVolumeValue !== undefined && currentDisableVolumeControl !== true) {
        if (currentMuteValue === true) {
            currentVolumioVolume = 0;
        } else {
            currentVolumioVolume = currentVolumioVolumeValue;
        }
        self.logger.info('Setting Spotify Volume from Volumio: ' + currentVolumioVolume);
        currentSpotifyVolume = currentVolumioVolume;
        self.setSpotifyDaemonVolume(currentSpotifyVolume);
    }
};


ControllerSpotify.prototype.clearAddPlayTrack = function (track) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerSpotify::clearAddPlayTrack');
    self.resetSpotifyState();

    return self.hasActiveDaemonSession().then((hasSession) => {
        if (!hasSession) {
            // go-librespot answers /player/play with 200 even with no session and then never
            // plays, leaving Volumio to run its queue and progress bar against silence.
            // Refuse the play instead of faking it, and say why.
            self.commandRouter.pushToastMessage('error', self.getI18n('SPOTIFY'), self.getI18n('NO_ACTIVE_SESSION'));
            self.abortPlayback('go-librespot has no active session');
            return;
        }

        // go-librespot takes seconds to resolve and buffer the track: publish what we already
        // know now, or the UI sits on a blank stopped player until the 'playing' event lands.
        // Pushed via servicePushState rather than pushState() to avoid starting our own seek
        // timer on top of the one the state machine already runs for a playing service.
        self.state.status = 'play';
        self.state.title = track.name || track.title || '';
        self.state.artist = track.artist || '';
        self.state.album = track.album || '';
        self.state.albumart = track.albumart || '/albumart';
        self.state.uri = track.uri;
        self.state.duration = track.duration || 0;
        self.commandRouter.servicePushState(self.state, 'spop');
        self.armPlaybackStartWatchdog();

        self.logger.info('Sending Spotify command with payload to local API: /player/play');
        return superagent.post(spotifyLocalApiEndpointBase + '/player/play')
            .accept('application/json')
            .send({ uri: track.uri })
            .then((results) => {})
            .catch((error) => {
                // the optimistic 'play' above must not stick if the daemon never starts playing
                self.logger.error('Failed to send command to Spotify local API: /player/play: ' + error);
                self.state.status = 'stop';
                self.commandRouter.servicePushState(self.state, 'spop');
            });
    });
};

// go-librespot 0.9.1 publishes the in-flight device flow on /auth/code, answering 204
// once the user approves or the code expires. Before that endpoint existed the prompt had
// to be scraped out of the daemon's log.
ControllerSpotify.prototype.getDaemonPairingPrompt = function () {
    var self = this;

    return superagent.get(spotifyLocalApiEndpointBase + '/auth/code')
        .accept('application/json')
        .timeout({ response: 2000, deadline: 3000 })
        .then((results) => {
            if (!results || results.status !== 200 || !results.body || !results.body.url) {
                return undefined;
            }
            return { url: results.body.url, code: results.body.code, expiresAt: results.body.expires_at };
        })
        .catch((error) => {
            self.logger.error('Failed to read Spotify device auth code: ' + error);
            return undefined;
        });
};

// Waiting on /status here would hang: device_auth blocks inside withAppPlayer until the
// user answers, so no session is installed yet and the API forwarder has nothing to hand
// requests to (daemon/app.go). /auth/code keeps answering throughout, so the flow ending
// is what we watch for — it drops to 204 on approval and on expiry alike, and only then
// can /status tell the two apart.
ControllerSpotify.prototype.waitForPairingOutcome = function (timeoutMs) {
    var self = this;
    var defer = libQ.defer();
    var deadline = Date.now() + (timeoutMs || 300000);

    var poll = function () {
        self.getDaemonPairingPrompt().then(function (prompt) {
            if (!prompt) {
                return self.hasActiveDaemonSession().then(function (hasSession) {
                    defer.resolve(hasSession);
                });
            }
            if (Date.now() >= deadline) {
                self.logger.error('Spotify pairing was not completed before the code expired');
                return defer.resolve(false);
            }
            setTimeout(poll, 3000);
        });
    };
    poll();

    return defer.promise;
};

// /status answers 204 "No active session" when go-librespot has nobody logged in and no
// Connect client attached. Commands are accepted and silently dropped in that state, so
// playback has to be gated on it rather than discovered 10 seconds later.
ControllerSpotify.prototype.hasActiveDaemonSession = function () {
    var self = this;

    return superagent.get(spotifyLocalApiEndpointBase + '/status')
        .accept('application/json')
        .timeout({ response: 1500, deadline: 2500 })
        .then((results) => results && results.status === 200)
        .catch((error) => {
            self.logger.error('Failed to read Spotify local API status: ' + error);
            return false;
        });
};


// go-librespot answers /player/play with 200 even when it has no active session and
// never starts playing. Nothing reports that back — no event, no rejected promise — so
// the optimistic 'play' state has to be bounded or it sticks forever with a progress bar
// running against silence. Any playback event from the daemon clears the watchdog.
ControllerSpotify.prototype.armPlaybackStartWatchdog = function () {
    var self = this;

    playbackStartConfirmed = false;
    clearTimeout(playbackStartWatchdog);
    playbackStartWatchdog = setTimeout(() => {
        playbackStartWatchdog = undefined;
        if (self.state.status !== 'play' || playbackStartConfirmed) {
            return;
        }
        self.abortPlayback('playback did not start within ' + playbackStartTimeout + 'ms');
    }, playbackStartTimeout);
};

// Giving up on a track cannot be signalled by pushing a 'stop' state: syncState reads a
// service stop while the machine is playing as "track finished" and advances the queue
// (statemachine.js), which walks the whole playlist a track at a time. volumioStop() is no
// help either — it only stops the timer when currentStatus is already 'play', and it isn't
// yet while clearAddPlayTrack runs. So stop the machine's clock directly, the way this
// plugin already drives setVolatile/setConsumeUpdateService.
ControllerSpotify.prototype.abortPlayback = function (reason) {
    var self = this;

    self.logger.error('Aborting Spotify playback: ' + reason);
    clearTimeout(playbackStartWatchdog);
    playbackStartWatchdog = undefined;

    var stateMachine = self.commandRouter.stateMachine;
    if (stateMachine) {
        stateMachine.stopPlaybackTimer();
        stateMachine.currentSeek = 0;
    }

    self.state.status = 'stop';
    self.state.seek = 0;
    self.commandRouter.servicePushState(self.state, 'spop');
};

// The prompt only appears once the daemon has restarted into device_auth mode and reached
// Spotify, so poll for it rather than guess a delay.
ControllerSpotify.prototype.awaitPairingPrompt = function (timeoutMs) {
    var self = this;
    var defer = libQ.defer();
    var deadline = Date.now() + (timeoutMs || 60000);

    var poll = function () {
        self.getDaemonPairingPrompt().then(function (prompt) {
            if (prompt) {
                return defer.resolve(prompt);
            }
            if (Date.now() >= deadline) {
                self.logger.error('go-librespot did not emit a pairing prompt');
                return defer.resolve(undefined);
            }
            setTimeout(poll, 2000);
        });
    };
    poll();

    return defer.promise;
};

// One authorization, two credentials. Browsing runs on the Web API refresh token the
// OAuth performer mints; playback runs on the session go-librespot gets from the device
// flow. Neither implies the other, but the user asked for one thing, so both are walked
// here in order behind a single button and a single modal.
//
// Step one is normally the core `oauth` UIConfig button, which navigates the whole page
// to the performer and back (plugin.component.js redirectToOauth) — that would destroy
// the modal. The performer's redirect_uri points at this device's /api/v1/oauth, which
// stores the token and merely bounces whoever opened it (rest_api/system.js), so the
// link works from any browser and the token still lands here. That is what lets step one
// live in the modal as a link, next to step two's.
ControllerSpotify.prototype.startAuthorization = function (data) {
    var self = this;
    var defer = libQ.defer();

    if (deviceAuthInProgress) {
        self.logger.info('Spotify authorization already running, re-opening its modal');
        self.reopenAuthModal();
        defer.resolve('');
        return defer.promise;
    }

    deviceAuthInProgress = true;
    self.pushAuthModal('openModal', self.getI18n('PAIRING_CONTACTING'), 10);

    var release = function (message) {
        deviceAuthInProgress = false;
        self.pushAuthModal('modalDone', message, 100);
        defer.resolve('');
    };

    self.authorizeBrowsing(data)
        .then(function (signedIn) {
            if (!signedIn) {
                return release(self.getI18n('PAIRING_FAILED'));
            }

            return self.authorizePlayback().then(function (authorized) {
                return self.refreshUiConfig().then(function () {
                    release(authorized ? self.getI18n('PAIRING_SUCCESSFUL') : self.getI18n('PAIRING_FAILED'));
                });
            });
        })
        .fail(function (e) {
            self.logger.error('Failed authorizing Spotify: ' + e);
            release(self.getI18n('PAIRING_FAILED'));
        });

    return defer.promise;
};

// Step one. Already signed in is the common case on a re-run — say so and move on rather
// than make the user log in again to reach step two.
ControllerSpotify.prototype.authorizeBrowsing = function (data) {
    var self = this;

    if (self.config.get('refresh_token', '') !== '') {
        self.logger.info('Spotify browsing login already done');
        return libQ.resolve(true);
    }

    var performerUrl = self.buildPerformerUrl(data);
    if (!performerUrl) {
        return libQ.resolve(false);
    }

    self.pushAuthModal('modalProgress', self.buildAuthMessage(performerUrl, undefined), 25);

    return self.waitForBrowsingLogin(300000);
};

// Step two, the daemon's own session. Restarting the daemon is what mints a pairing code,
// so doing it unconditionally invalidates a code the user may already be approving — and
// wipes a working session if playback is authorized. Check both before touching anything.
ControllerSpotify.prototype.authorizePlayback = function () {
    var self = this;

    self.pushAuthModal('modalProgress', self.buildAuthMessage(undefined, undefined), 50);

    return self.getDaemonPairingPrompt()
        .then(function (pending) {
            if (pending) {
                self.logger.info('Reusing the Spotify pairing code already awaiting approval');
                return pending;
            }

            return self.hasActiveDaemonSession().then(function (hasSession) {
                if (hasSession) {
                    self.logger.info('Spotify playback is already authorized');
                    return { alreadyAuthorized: true };
                }

                self.config.set('credentials_type', 'device_auth');
                self.deleteCredentialsFile();

                return self.initializeLibrespotDaemon().then(function () {
                    return self.awaitPairingPrompt(60000);
                });
            });
        })
        .then(function (prompt) {
            if (prompt && prompt.alreadyAuthorized) {
                return true;
            }

            if (!prompt) {
                return false;
            }

            self.logger.info('Spotify pairing code issued, awaiting approval');
            self.pushAuthModal('modalProgress', self.buildAuthMessage(undefined, prompt), 75);

            return self.waitForPairingOutcome(300000);
        });
};

// The performer needs a redirect_uri this device answers on, which is the same URL the UI
// would have built client-side. plugin_url is only where the opening browser is sent
// afterwards — the token reaches us either way — so it points at the device's own UI.
ControllerSpotify.prototype.buildPerformerUrl = function (data) {
    var self = this;

    if (!data || !data.performerUrl || !data.plugin) {
        self.logger.error('Cannot build the Spotify OAuth url: the button carries no performer data');
        return undefined;
    }

    var device = self.commandRouter.executeOnPlugin('system_controller', 'volumiodiscovery', 'getThisDevice');
    if (!device || !device.host) {
        self.logger.error('Cannot build the Spotify OAuth url: this device has no reachable host');
        return undefined;
    }

    var redirectUri = new URL(device.host + '/api/v1/oauth');
    redirectUri.searchParams.set('plugin', data.plugin);
    redirectUri.searchParams.set('plugin_url', device.host);

    var performerUrl = new URL(data.performerUrl);
    performerUrl.searchParams.set('redirect_uri', redirectUri.href);
    (data.scopes || []).forEach(function (scope) {
        performerUrl.searchParams.append('scope', scope);
    });

    return performerUrl.href;
};

// The performer's callback lands on /api/v1/oauth and ends up in oauthLogin, which writes
// the refresh token. Nothing signals that back into this flow, so the token itself is the
// signal.
ControllerSpotify.prototype.waitForBrowsingLogin = function (timeoutMs) {
    var self = this;
    var defer = libQ.defer();
    var deadline = Date.now() + (timeoutMs || 300000);

    var poll = function () {
        if (self.config.get('refresh_token', '') !== '') {
            return defer.resolve(true);
        }
        if (Date.now() >= deadline) {
            self.logger.error('Spotify browsing login was not completed in time');
            return defer.resolve(false);
        }
        setTimeout(poll, 2000);
    };
    poll();

    return defer.promise;
};

// Nova renders the message as plain text with whitespace-pre-line, so newlines are the
// only formatting available: its modal contract is {title, message, buttons, progress,
// advancedLog} and markup is flattened. An embedded QR image cannot survive that, which is
// why each step is a bare link and the pairing code is repeated only as a fallback.
// Whichever step is not running shows its outcome instead, so the modal always says where
// in the pair the user is.
ControllerSpotify.prototype.buildAuthMessage = function (performerUrl, prompt) {
    var self = this;
    var lines = [];

    if (performerUrl) {
        lines.push(self.getI18n('STEP_ONE_TODO'), '', performerUrl);
    } else {
        lines.push(self.getI18n('STEP_ONE_DONE') + ' ' + self.config.get('logged_user_id', ''));
    }

    lines.push('');

    if (!prompt) {
        // No code to show yet: either the daemon already has a session, or we are still
        // waiting on it. Naming step two without a link to act on would just read as a
        // dead instruction, so it stays off the modal until there is one.
        lines.push(self.getPlaybackAuthorization().authorized ?
            self.getI18n('STEP_TWO_DONE') : self.getI18n('PAIRING_CONTACTING'));
        return lines.join('\n');
    }

    lines.push(self.getI18n('STEP_TWO_TODO'), '', prompt.url, '',
        self.getI18n('PAIRING_CODE_IF_ASKED') + ' ' + prompt.code);

    // Only when it reads as a time still ahead of us: expires_at has been seen absent, and
    // a seconds-epoch value would render as a 1970 clock time rather than fail visibly.
    var expiry = new Date(prompt.expiresAt);
    if (expiry.getTime() > Date.now()) {
        lines.push(self.getI18n('PAIRING_EXPIRES') + ' ' +
            ('0' + expiry.getHours()).slice(-2) + ':' + ('0' + expiry.getMinutes()).slice(-2));
    }

    return lines.join('\n');
};

// A UIConfig button has no in-flight state — it renders once, and only a pushUiConfig
// round trip can change it — so the busy state is the modal itself: a progress modal
// cannot be dismissed in either UI while it runs (concept-ui's modal-progress.html grows
// a footer only on modalDone, Nova's BackendModal refuses dismissal while progress is set
// and done is not), which is what keeps the button underneath out of reach until the work
// ends. Authorizing and revoking share it, so neither can be started over the other. Same
// record shape as the install-to-disk modal in system_controller/system, and like that one
// it carries the whole record on every emit: concept-ui renders the body from the
// modalProgress payload, not from the openModal one.
ControllerSpotify.prototype.pushAuthModal = function (emit, message, progressNumber) {
    var self = this;

    deviceAuthModal = {
        progress: true,
        progressNumber: progressNumber,
        title: self.getI18n('PAIRING_TITLE'),
        message: message,
        size: 'lg',
        buttons: [{ name: self.getI18n('CLOSE'), class: 'btn btn-info', emit: '', payload: '' }]
    };

    self.commandRouter.broadcastMessage(emit, deviceAuthModal);

    if (emit === 'openModal') {
        // concept-ui opens the progress modal empty and fills it from the first
        // modalProgress that follows, so the opening record has to be sent twice.
        self.commandRouter.broadcastMessage('modalProgress', deviceAuthModal);
    }

    if (emit === 'modalDone') {
        deviceAuthModal = undefined;
    }
};

// A reloaded browser loses the modal but not the work behind it, and the button comes
// back clickable: show what is already running rather than start a second one.
ControllerSpotify.prototype.reopenAuthModal = function () {
    var self = this;

    if (!deviceAuthModal) {
        return;
    }

    self.commandRouter.broadcastMessage('openModal', deviceAuthModal);
    self.commandRouter.broadcastMessage('modalProgress', deviceAuthModal);
};

// The account section is rendered from getUIConfig, so a change the user did not navigate
// to — just authorized, or just revoked — has to push a fresh one, or the button keeps
// offering the step that is already done.
ControllerSpotify.prototype.refreshUiConfig = function () {
    var self = this;

    return self.getUIConfig()
        .then(function (conf) {
            self.commandRouter.broadcastMessage('pushUiConfig', conf);
        })
        .fail(function (e) {
            self.logger.error('Failed to refresh the Spotify UI config: ' + e);
        });
};

ControllerSpotify.prototype.startSocketStateListener = function () {
    var self = this;

    if (self.stateSocket) {
        self.stateSocket.off();
        self.stateSocket.disconnect();
    }

    self.stateSocket= io.connect('http://localhost:3000');
    self.stateSocket.on('connect', function() {
        self.stateSocket.emit('getState', '');
    });

    self.stateSocket.on('pushState', function (data) {
       currentVolumioState = data;
       if (data && data.volume && !data.disableVolumeControl) {
           var currentVolume = data.volume;
           if (data.mute === true) {
               currentVolume = 0;
           }
           self.onVolumioVolumeChange(currentVolume);
       }
    });
};

ControllerSpotify.prototype.stopSocketStateListener = function () {
    var self = this;

    if (self.stateSocket) {
        self.stateSocket.off();
        self.stateSocket.disconnect();
    }
};


// DAEMON MANAGEMENT

ControllerSpotify.prototype.initializeLibrespotDaemon = function () {
    var self = this;
    var defer = libQ.defer();

    this.selectedBitrate = self.config.get('bitrate_number', '320').toString();

    self.createConfigFile()
        .then(function() {
            return self.startLibrespotDaemon();
        })
        .then(function() {
            self.logger.info('go-librespot daemon successfully initialized');
            setTimeout(()=>{
                self.goLibrespotDaemonWsConnection('start');
                defer.resolve('');
            }, 3000);
        })
        .fail(function (e) {
            defer.reject(e);
            self.logger.error('Error initializing go-librespot daemon: ' + e);
        });

    return defer.promise;
};

ControllerSpotify.prototype.startLibrespotDaemon = function () {
    var self = this;
    var defer = libQ.defer();

    exec("/usr/bin/sudo systemctl restart go-librespot-daemon.service", function (error, stdout, stderr) {
        if (error) {
            self.logger.error('Cannot start Go-librespot Daemon: ' + error);
            defer.reject(error);
        } else {
            setTimeout(()=>{
                defer.resolve();
            }, 3000);
        }
    });

    return defer.promise;

};

ControllerSpotify.prototype.stopLibrespotDaemon = function () {
    var self = this;
    var defer = libQ.defer();

    exec("/usr/bin/sudo systemctl stop go-librespot-daemon.service", function (error, stdout, stderr) {
        if (error) {
            self.logger.error('Cannot stop Go-librespot Daemon: ' + error);
            defer.reject(error);
        } else {
            setTimeout(() => {
                defer.resolve();
            }, 2000);
        }
    });

    return defer.promise;
};


ControllerSpotify.prototype.createConfigFile = function () {
    var self = this;
    var defer = libQ.defer();

    this.logger.info('Creating Spotify config file');

    try {
        var template = fs.readFileSync(path.join(__dirname, 'config.yml.tmpl'), {encoding: 'utf8'});
    } catch (e) {
        this.logger.error('Failed to read template file: ' + e);
    }

    var devicename = this.commandRouter.sharedVars.get('system.name');
    var selectedBitrate = self.config.get('bitrate_number', '320').toString();
    var icon = self.config.get('icon', 'avr');
    var externalVolume = true;
    var mixerType = self.getAdditionalConf('audio_interface', 'alsa_controller', 'mixer_type', 'None');
    if (mixerType === 'None') {
        externalVolume = false;
    }
    var normalisationPregain = self.config.get('normalisation_pregain', '1.0');
    var enableAutoplay = self.config.get('enable_autoplay', false);
    var audioBufferTime = self.config.get('audio_buffer_time', 500_000);
    var audioPeriodCount = self.config.get('audio_period_count', 4);

    var conf = template.replace('${device_name}', devicename)
        .replace('${bitrate_number}', selectedBitrate)
        .replace('${device_type}', icon)
        .replace('${external_volume}', externalVolume)
        .replace('${normalisation_pregain}', normalisationPregain)
        .replace('${disable_autoplay}', !enableAutoplay)
        .replace('${audio_buffer_time}', audioBufferTime)
        .replace('${audio_period_count}', audioPeriodCount);

    // Never hand the daemon our OAuth access token: Spotify's login5 rejects credentials
    // derived from a token minted under a non-desktop client id, so `type: spotify_token`
    // now fails authentication and the daemon exits on a loop
    // (github.com/devgianlu/go-librespot issues/364). The account login is still what
    // browsing runs on, it just no longer feeds the playback session.
    //
    // device_auth is the replacement: the daemon runs the OAuth device flow under the
    // desktop client id, which login5 does accept, and the user pairs with a short code
    // instead of having to reach for the Spotify app. It needs a daemon that supports it,
    // so it stays opt-in until the plugin ships a build that does.
    //
    // Otherwise zeroconf, persisting the blob from the first Connect handshake so the
    // session survives restarts with no client attached, which is what /player/play needs
    // for playback started from the Volumio UI.
    if (self.config.get('credentials_type', 'zeroconf') === 'device_auth') {
        conf += 'credentials: ' + os.EOL;
        conf += '  type: device_auth' + os.EOL;
    } else {
        conf += 'credentials: ' + os.EOL;
        conf += '  type: zeroconf' + os.EOL;
        conf += '  zeroconf:' + os.EOL;
        conf += '    persist_credentials: true' + os.EOL;
    }




    fs.writeFile(configFileDestinationPath, conf, (err) => {
        if (err) {
            defer.reject(err);
            this.logger.error('Failed to write spotify config file: ' + err);
        } else {
            defer.resolve('');
            this.logger.info('Spotify config file written');
        }
    });
    return defer.promise;
};

// Browsing and playback are two credentials but one decision, so the section carries one
// button: Authorize until both are in place, Remove authorization after. A half-done state
// still offers Authorize — startAuthorization skips whichever step is already done.
ControllerSpotify.prototype.applyAccountSectionState = function (uiconf) {
    var self = this;

    var signedIn = self.loggedInUserId !== undefined && self.config.get('refresh_token', '') !== '';
    var playback = self.getPlaybackAuthorization();
    var authorized = signedIn && playback.authorized;

    self.findUiElement(uiconf, 1, 'authorize').hidden = authorized;
    var revokeButton = self.findUiElement(uiconf, 1, 'deauthorize');
    revokeButton.hidden = !authorized;
    if (authorized) {
        revokeButton.description = self.getI18n('AUTHORIZE_DONE') + ' ' + playback.username;
    }

    return uiconf;
};

// Looked up by id rather than by position: content indexes shift whenever a control is
// added, and a wrong index quietly hides the wrong button.
ControllerSpotify.prototype.findUiElement = function (uiconf, section, id) {
    var content = uiconf.sections[section].content;

    for (var i = 0; i < content.length; i++) {
        if (content[i].id === id) {
            return content[i];
        }
    }

    this.logger.error('No UI element with id ' + id + ' in section ' + section);

    return {};
};

// Playback authorization lives in the daemon's state file, which is the same thing the
// daemon itself reads on startup, so it survives reboots and does not need the daemon to
// be up to answer. Checking the file merely exists is not enough: go-librespot writes it
// with an empty credentials block as soon as it runs once.
ControllerSpotify.prototype.getPlaybackAuthorization = function () {
    var self = this;

    try {
        var state = JSON.parse(fs.readFileSync(credentialsPath, { encoding: 'utf8' }).toString());
        var credentials = state && state.credentials;
        if (credentials && credentials.username && credentials.data) {
            return { authorized: true, username: credentials.username };
        }
    } catch (e) {
        self.logger.info('No usable go-librespot credentials yet: ' + e);
    }

    return { authorized: false };
};

// The mirror of startAuthorization: one button undid one button, so both credentials go.
// Back to zeroconf rather than leaving device_auth armed, otherwise the restart below
// immediately mints a pairing code nobody asked for. The daemon restart takes seconds, so
// this gets the same busy modal — the button is unreachable until the new state is on
// screen.
ControllerSpotify.prototype.revokeAuthorization = function () {
    var self = this;
    var defer = libQ.defer();

    if (deviceAuthInProgress) {
        self.logger.info('Spotify authorization change already running, re-opening its modal');
        self.reopenAuthModal();
        defer.resolve('');
        return defer.promise;
    }

    deviceAuthInProgress = true;
    self.logger.info('Revoking Spotify authorization');
    self.pushAuthModal('openModal', self.getI18n('PLAYBACK_REVOKING'), 25);

    var release = function (message) {
        deviceAuthInProgress = false;
        self.pushAuthModal('modalDone', message, 100);
        defer.resolve('');
    };

    self.resetSpotifyCredentials();
    self.removeToBrowseSources();
    self.config.set('credentials_type', 'zeroconf');
    self.deleteCredentialsFile();

    self.initializeLibrespotDaemon()
        .then(function () {
            return self.refreshUiConfig();
        })
        .then(function () {
            release(self.getI18n('PLAYBACK_REVOKED'));
        })
        .fail(function (e) {
            self.logger.error('Failed revoking Spotify authorization: ' + e);
            release(self.getI18n('PLAYBACK_REVOKE_FAILED'));
        });

    return defer.promise;
};

ControllerSpotify.prototype.saveGoLibrespotSettings = function (data, avoidBroadcastUiConfig) {
    var self = this;
    var defer = libQ.defer();

    var broadcastUiConfig = true;
    if (avoidBroadcastUiConfig === true){
        broadcastUiConfig = false;
    }

    if (data.bitrate !== undefined && data.bitrate.value !== undefined) {
        self.config.set('bitrate_number', data.bitrate.value);
    }

    if (data.debug !== undefined) {
        self.config.set('debug', data.debug);
    }
    if (data.icon && data.icon.value !== undefined) {
        self.config.set('icon', data.icon.value);
    }
    if (data.normalisation_pregain && data.normalisation_pregain.value !== undefined) {
        self.config.set('normalisation_pregain', data.normalisation_pregain.value);
    }

    var audioBufferTime = parseInt(data.audio_buffer_time);
    if (audioBufferTime) {
        self.config.set('audio_buffer_time', audioBufferTime.toString());
    }

    var audioPeriodCount = parseInt(data.audio_period_count);
    if (audioPeriodCount) {
        self.config.set('audio_period_count', audioPeriodCount.toString());
    }

    self.config.set('enable_autoplay', data.enable_autoplay);

    self.selectedBitrate = self.config.get('bitrate_number', '320').toString();
    self.initializeLibrespotDaemon();

    return defer.promise;
};

// OAUTH

ControllerSpotify.prototype.refreshAccessToken = function () {
    var self = this;
    var defer = libQ.defer();

    var refreshToken = self.config.get('refresh_token', 'none');
    if (refreshToken !== 'none' && refreshToken !== null && refreshToken !== undefined) {
        superagent.post('https://oauth-performer.prod.vlmapi.io/spotify/accessToken')
            .send({refreshToken: refreshToken})
            .then(function (results) {
                if (results && results.body && results.body.accessToken) {
                    defer.resolve(results)
                } else {
                    defer.resject('No access token received');
                }
            })
            .catch(function (err) {
                self.logger.info('An error occurred while refreshing Spotify Token ' + err);
            });
    }

    return defer.promise;
};

ControllerSpotify.prototype.spotifyClientCredentialsGrant = function () {
    var self = this;
    var defer = libQ.defer();
    var d = new Date();
    var now = d.getTime();

    var refreshToken = self.config.get('refresh_token', 'none');
    if (refreshToken !== 'none' && refreshToken !== null && refreshToken !== undefined) {
        self.spotifyApi.setRefreshToken(refreshToken);
        self.refreshAccessToken()
            .then(function (data) {
                self.spotifyAccessToken = data.body['accessToken'];
                self.config.set('access_token', self.spotifyAccessToken);
                self.spotifyApi.setAccessToken(self.spotifyAccessToken);
                self.spotifyAccessTokenExpiration = data.body['expiresInSeconds'] * 1000 + now;
		self.logger.info('New Spotify access token' + self.spotifyAccessToken.substring(0, 10) + '...');
                defer.resolve();
            }, function (err) {
                self.logger.info('Spotify credentials grant failed with ' + err);
            });
    }

    return defer.promise;
}

ControllerSpotify.prototype.oauthLogin = function (data) {
    var self=this;
    var defer = libQ.defer();

    self.logger.info('Executing Spotify Oauth Login');

    if (data && data.refresh_token) {
        self.logger.info('Saving Spotify Refresh Token');
        self.config.set('refresh_token', data.refresh_token);

        // Browsing only needs the Web API client and the browse sources. It must not set
        // credentials_type or restart the daemon: playback authorization is a separate
        // credential (see createConfigFile), and bouncing the daemon here would drop a live
        // session or invalidate a pairing code the user is in the middle of approving.
        self.spotifyApiConnect().then(function () {
            self.initializeSpotifyBrowsingFacility();
            var config = self.getUIConfig();
            config.then(function(conf) {
                self.commandRouter.broadcastMessage('pushUiConfig', conf);
                defer.resolve(conf)
            }).fail(function (e) {
                self.logger.error('Failed to build Spotify UI config after OAUTH Login: ' + e);
                defer.reject(e);
            });
        }).fail(function (e) {
            self.logger.error('Failed to perform Spotify API connection after OAUTH Login: ' + e);
            defer.reject(e);
        });
    } else {
        self.logger.error('Could not receive oauth data');
        defer.reject(new Error('Could not receive oauth data'));
    }

    return defer.promise;
};

ControllerSpotify.prototype.externalOauthLogin = function (data) {
    var self=this;
    var defer = libQ.defer();

    if (data && data.refresh_token) {
        self.logger.info('Saving Spotify Refresh Token');
        self.config.set('refresh_token', data.refresh_token);
        // Same work as oauthLogin minus the UI broadcasts: streaming-services pushes those
        // itself. Resolves even on failure because that caller attaches no .fail and would
        // otherwise leave its modal hanging.
        self.spotifyApiConnect().then(function () {
            self.initializeSpotifyBrowsingFacility();
            defer.resolve('');
        }).fail(function (e) {
            self.logger.error('Failed to perform Spotify API connection after external OAUTH Login: ' + e);
            defer.resolve('');
        });
    } else {
        self.logger.error('Could not receive oauth data');
        defer.resolve('');
    }
    return defer.promise
};

ControllerSpotify.prototype.logout = function (avoidBroadcastUiConfig) {
    var self=this;

    var broadcastUiConfig = true;
    if (avoidBroadcastUiConfig === true){
        broadcastUiConfig = false;
    }

    self.deleteCredentialsFile();
    self.resetSpotifyCredentials();
    setTimeout(()=>{
        self.initializeLibrespotDaemon();
    }, 1000);


    self.commandRouter.pushToastMessage('success', self.getI18n('LOGOUT'), self.getI18n('LOGOUT_SUCCESSFUL'));

    self.pushUiConfig(broadcastUiConfig);
    self.removeToBrowseSources();
};

ControllerSpotify.prototype.pushUiConfig = function (broadcastUiConfig) {
    var self=this;

    setTimeout(()=>{
        var config = self.getUIConfig();
        config.then((conf)=> {
            if (broadcastUiConfig) {
                self.commandRouter.broadcastMessage('pushUiConfig', conf);
            }
        });
    }, 3000);
};

ControllerSpotify.prototype.resetSpotifyCredentials = function () {
    var self=this;

    self.config.set('logged_user_id', '');
    self.config.set('access_token', '');
    self.config.set('refresh_token', '');

    if (self.spotifyApi) {
        self.spotifyApi.resetCredentials();
    }

    self.accessToken = undefined;
    self.spotifyAccessTokenExpiration = undefined;
    self.loggedInUserId = undefined;
};

ControllerSpotify.prototype.deleteCredentialsFile = function () {
    var self=this;

    self.logger.info('Deleting Spotify credentials File');
    try {
        fs.unlinkSync(credentialsPath)
    } catch(err) {
        self.logger.error('Failed to delete credentials file ' + e);
    }
};

ControllerSpotify.prototype.spotifyApiConnect = function () {
    var self = this;
    var defer = libQ.defer();
    var d = new Date();

    self.spotifyApi = new SpotifyWebApi();

    // Retrieve an access token
    self.spotifyClientCredentialsGrant()
        .then(function (data) {
                self.logger.info('Spotify credentials grant success - running version from March 24, 2019');
                self.getUserInformations().then(function (data) {
                    defer.resolve();
                }).fail(function (err) {
                    defer.reject(err);
                    self.logger.error('Spotify credentials failed to read user data: ' + err);
                });
            }, function (err) {
                self.logger.info('Spotify credentials grant failed with ' + err);
                defer.reject(err);
            }
        );

    return defer.promise;
}

ControllerSpotify.prototype.spotifyCheckAccessToken = function () {
    var self = this;
    var defer = libQ.defer();
    var d = new Date();
    var now = d.getTime();

    if (self.spotifyAccessTokenExpiration < now) {
        self.refreshAccessToken()
            .then(function (data) {
                self.spotifyAccessToken = data.body.accessToken;
                self.spotifyApi.setAccessToken(data.body.accessToken);
                self.spotifyAccessTokenExpiration = data.body.expiresInSeconds * 1000 + now;
                self.logger.info('New access token = ' + self.spotifyAccessToken);
                defer.resolve();
            });
    } else {
        defer.resolve();
    }

    return defer.promise;

};

ControllerSpotify.prototype.initializeSpotifyBrowsingFacility = function () {
    var self = this;

    var refreshToken = self.config.get('refresh_token', 'none');
    if (refreshToken !== 'none' && refreshToken !== null && refreshToken !== undefined) {
        self.spotifyApiConnect().then(function() {
                self.logger.info('Spotify Successfully logged in');
                self.getRoot();
                self.addToBrowseSources();
            }).fail(function (err) {
                self.logger.info('An error occurred while initializing Spotify Browsing facility: ' + err);
            });
    }
}

ControllerSpotify.prototype.getUserInformations = function () {
    var self = this;
    var defer = libQ.defer();

    self.spotifyApi.getMe()
        .then(function(data) {
            if (data && data.body) {
                self.debugLog('User informations: ' + JSON.stringify(data.body));
                self.loggedInUserId = data.body.id;
                self.userCountry = data.body.country || 'US';
                self.config.set('logged_user_id', self.loggedInUserId);
                self.isLoggedIn = true;
                defer.resolve('');
            }
        }, function(err) {
            defer.reject('');
            self.logger.error('Failed to retrieve user informations: ' + err);
        });

    return defer.promise;
};

// CACHE

ControllerSpotify.prototype.flushCache = function() {
    var self=this

    self.browseCache.flushAll();
}

// ALBUMART

ControllerSpotify.prototype._getAlbumArt = function (item) {

    var albumart = '';
    if (item && item.images && item.images.length && item.images.length > 0) {
        albumart = item.images[0].url;
    }
    return albumart;
};

ControllerSpotify.prototype.getAlbumArt = function (data, path) {

    var artist, album;

    if (data != undefined && data.path != undefined) {
        path = data.path;
    }

    var web;

    if (data != undefined && data.artist != undefined) {
        artist = data.artist;
        if (data.album != undefined)
            album = data.album;
        else album = data.artist;

        web = '?web=' + encodeURIComponent(artist) + '/' + encodeURIComponent(album) + '/large'
    }

    var url = '/albumart';

    if (web != undefined)
        url = url + web;

    if (web != undefined && path != undefined)
        url = url + '&';
    else if (path != undefined)
        url = url + '?';

    if (path != undefined)
        url = url + 'path=' + encodeURIComponent(path);

    return url;
};

// TRANSLATIONS

ControllerSpotify.prototype.loadI18n = function () {
    var self=this;

    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        self.i18n=fs.readJsonSync(__dirname+'/i18n/strings_'+language_code+".json");
    } catch(e) {
        self.i18n=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
    }

    self.i18nDefaults=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
};

ControllerSpotify.prototype.getI18n = function (key) {
    var self=this;

    if (key.indexOf('.') > 0) {
        var mainKey = key.split('.')[0];
        var secKey = key.split('.')[1];
        if (self.i18n[mainKey][secKey] !== undefined) {
            return self.i18n[mainKey][secKey];
        } else {
            return self.i18nDefaults[mainKey][secKey];
        }

    } else {
        if (self.i18n[key] !== undefined) {
            return self.i18n[key];
        } else {
            return self.i18nDefaults[key];
        }

    }
};


// BROWSING

ControllerSpotify.prototype.addToBrowseSources = function () {
    var data = {
        name: 'Spotify',
        uri: 'spotify',
        plugin_type: 'music_service',
        plugin_name: 'spop',
        albumart: '/albumart?sourceicon=music_service/spop/spotify.png'
    };
    this.commandRouter.volumioAddToBrowseSources(data);
};

ControllerSpotify.prototype.removeToBrowseSources = function () {

    this.commandRouter.volumioRemoveToBrowseSources('Spotify');
};


ControllerSpotify.prototype.handleBrowseUri = function (curUri) {
    var self = this;

    self.commandRouter.logger.info('In handleBrowseUri, curUri=' + curUri);
    var response;

    if (curUri.startsWith('spotify')) {
        if (curUri == 'spotify') {
            response = self.getRoot();
        } else if (curUri.startsWith('spotify/playlists')) {
            if (curUri == 'spotify/playlists')
                response = self.getMyPlaylists(curUri); // use the Spotify Web API instead of the spop service
            else {
                response = self.listWebPlaylist(curUri); // use the function to list playlists returned from the Spotify Web API
            }
        } else if (curUri.startsWith('spotify/myalbums')) {
            response = self.getMyAlbums(curUri);
        } else if (curUri.startsWith('spotify/mytracks')) {
            response = self.getMyTracks(curUri);
        } else if (curUri.startsWith('spotify/myartists')) {
            response = self.getMyArtists(curUri);
        } else if (curUri.startsWith('spotify/mytopartists')) {
            response = self.getTopArtists(curUri);
        } else if (curUri.startsWith('spotify/mytoptracks')) {
            response = self.getTopTracks(curUri);
        } else if (curUri.startsWith('spotify/myrecentlyplayedtracks')) {
            response = self.getRecentTracks(curUri);
        } else if (curUri.startsWith('spotify/featuredplaylists')) {
            response = self.featuredPlaylists(curUri);
        } else if (curUri.startsWith('spotify:user:')) {
            response = self.listWebPlaylist(curUri);
        } else if (curUri.startsWith('spotify:playlist:')) {
            var uriSplitted = curUri.split(':');
            response = self.listWebPlaylist('spotify:user:spotify:playlist:' + uriSplitted[2]);
        } else if (curUri.startsWith('spotify/new')) {
            response = self.listWebNew(curUri);
        } else if (curUri.startsWith('spotify/categories')) {
            response = self.listWebCategories(curUri);
        } else if (curUri.startsWith('spotify:album')) {
            response = self.listWebAlbum(curUri);
        } else if (curUri.startsWith('spotify/category')) {
            response = self.listWebCategory(curUri);
        } else if (curUri.startsWith('spotify:artist:')) {
            response = self.listWebArtist(curUri);
        }
        else {
            self.logger.info('************* Bad browse Uri:' + curUri);
        }
    }

    return response;
};

ControllerSpotify.prototype.getRoot = function () {
    var self = this;
    var defer = libQ.defer();

    self.browseCache.get('root',function( err, value ){
        if( !err ){
            // Root has not been cached yet
            if(value == undefined){
                self.listRoot().then((data)=>{
                    // Set root cache
                    self.browseCache.set('root',data)
                    defer.resolve(data)
                });
            } else {
                // Cached Root
                defer.resolve(value)
            }
        } else {
            self.logger.error('Could not fetch root spotify folder cached data: ' + err);
        }
    });

    return defer.promise
};

ControllerSpotify.prototype.listRoot = function (curUri) {
    var self = this;
    var defer = libQ.defer();

    var response = {
        navigation: {
            lists: [
                {
                    "availableListViews": [
                        "grid","list"
                    ],
                    "type": "title",
                    "title": self.getI18n('MY_MUSIC'),
                    "items": [
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_PLAYLISTS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/playlist.png',
                            uri: 'spotify/playlists'
                        },
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_ALBUMS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/album.png',
                            uri: 'spotify/myalbums'
                        },
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_TRACKS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/track.png',
                            uri: 'spotify/mytracks'
                        },
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_ARTISTS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/artist.png',
                            uri: 'spotify/myartists',
                        },
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_TOP_TRACKS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/track.png',
                            uri: 'spotify/mytoptracks'
                        },
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_TOP_ARTISTS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/artist.png',
                            uri: 'spotify/mytopartists'
                        },
                        {
                            service: 'spop',
                            type: 'streaming-category',
                            title: self.getI18n('MY_RECENTLY_PLAYED_TRACKS'),
                            artist: '',
                            album: '',
                            albumart: '/albumart?sourceicon=music_service/spop/icons/track.png',
                            uri: 'spotify/myrecentlyplayedtracks'
                        }
                    ]
                }
            ]
        }
    }

    var spotifyRootArray = [self.featuredPlaylists('spotify/featuredplaylists'),self.listWebNew('spotify/new'),self.listWebCategories('spotify/categories')];
    libQ.all(spotifyRootArray)
        .then(function (results) {

            var discoveryArray = [
                {
                    "availableListViews": [
                        "grid","list"
                    ],
                    "type": "title",
                    "title": self.getI18n('FEATURED_PLAYLISTS'),
                    "items": results[0].navigation.lists[0].items
                },
                {
                    "availableListViews": [
                        "grid","list"
                    ],
                    "type": "title",
                    "title": self.getI18n('WHATS_NEW'),
                    "items": results[1].navigation.lists[0].items
                },
                {
                    "availableListViews": [
                        "grid","list"
                    ],
                    "type": "title",
                    "title": self.getI18n('GENRES_AND_MOODS'),
                    "items": results[2].navigation.lists[0].items
                }
            ];
            response.navigation.lists = response.navigation.lists.concat(discoveryArray);
            defer.resolve(response);
        })
        .fail(function (err) {
            self.logger.info('An error occurred while getting Spotify ROOT Discover Folders: ' + err);
            defer.resolve(response);
        });

    return defer.promise;
}


ControllerSpotify.prototype.getMyPlaylists = function (curUri) {
    var self = this;
    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {


                var response = {
                    navigation: {
                        prev: {
                            uri: 'spotify'
                        },
                        "lists": [
                            {
                                "availableListViews": [
                                    "list",
                                    "grid"
                                ],
                                "items": []
                            }
                        ]
                    }
                };
            self.spotifyApi.getUserPlaylists(self.loggedInUserId, { limit: 50 })
                .then(function(results) {
                    for (var i in results.body.items) {
                        var playlist = results.body.items[i];
                        response.navigation.lists[0].items.push({
                            service: 'spop',
                            type: 'playlist',
                            title: playlist.name,
                            albumart: self._getAlbumArt(playlist),
                            uri: 'spotify:user:spotify:playlist:' + playlist.id
                        });
                    }

                    defer.resolve(response);
                },function(err) {
                    defer.reject('An error listing Spotify Playlists ' + err.message)
                    self.logger.info('An error occurred while listing Spotify getMyPlaylists ' + err.message);
                });
            }
        );

    return defer.promise;
};

ControllerSpotify.prototype.getMyAlbums = function () {
    const defer = libQ.defer();
    const albums = [];

    this.spotifyCheckAccessToken().then(() => {
        fetchPagedData(
            this.spotifyApi,
            'getMySavedAlbums',
            {},
            {
                onData: (items) => {
                    for (var i in items) {
                        var album = items[i].album;
                        albums.push({
                            service: 'spop',
                            type: 'folder',
                            title: album.name,
                            albumart: this._getAlbumArt(album),
                            uri: album.uri
                        });
                    }
                },
                onEnd: () => {
                    albums.sort((a, b) => {
                        if (a.artist !== b.artist) {
                            return a.artist > b.artist ? 1 : -1;
                        }
                        return a.year > b.year ? 1 : a.year === b.year ? 0 : -1;
                    });
                    defer.resolve({
                        navigation: {
                            prev: {
                                uri: 'spotify',
                            },
                            lists: [
                                {
                                    availableListViews: ['list', 'grid'],
                                    items: albums,
                                },
                            ],
                        },
                    });
                },
            }
        ).catch((err) => {
            this.logger.error('An error occurred while listing Spotify my albums ' + err);
            defer.reject('');
        });
    });

    return defer.promise;
};

ControllerSpotify.prototype.getMyTracks = function () {
    const defer = libQ.defer();
    const tracks = [];

    this.spotifyCheckAccessToken().then(() => {
        fetchPagedData(
            this.spotifyApi,
            'getMySavedTracks',
            {},
            {
                onData: (items) => {
                    for (var i in items) {
                        var track = items[i].track;
                        if (this.isTrackAvailableInCountry(track)) {
                            tracks.push({
                                service: 'spop',
                                type: 'song',
                                title: track.name,
                                artist: track.artists[0] ? track.artists[0].name : null,
                                album: track.album.name || null,
                                albumart: this._getAlbumArt(track.album),
                                uri: track.uri
                            });
                        }
                    }
                },
                onEnd: () => {
                    defer.resolve({
                        navigation: {
                            prev: {
                                uri: 'spotify',
                            },
                            lists: [
                                {
                                    availableListViews: ['list'],
                                    items: tracks,
                                },
                            ],
                        },
                    });
                },
            }
        ).catch((err) => {
            this.logger.error('An error occurred while listing Spotify my tracks ' + err);
            defer.reject('');
        });
    });
    return defer.promise;
};

ControllerSpotify.prototype.getMyArtists = function () {
    const defer = libQ.defer();
    const artists = [];

    this.spotifyCheckAccessToken().then(() => {
        fetchPagedData(
            this.spotifyApi,
            'getFollowedArtists',
            { paginationType: 'after' },
            {
                getItems: (data) => data.body?.artists?.items || [],
                onData: (items) => {
                    for (var i in items) {
                        const artist = items[i];
                        artists.push({
                            service: 'spop',
                            type: 'folder',
                            title: artist.name,
                            albumart: this._getAlbumArt(artist),
                            uri: artist.uri,
                        });
                    }
                },
                onEnd: () => {
                    artists.sort((a, b) => (a.title > b.title ? 1 : a.title === b.title ? 0 : -1));
                    defer.resolve({
                        navigation: {
                            prev: {
                                uri: 'spotify',
                            },
                            lists: [
                                {
                                    availableListViews: ['list', 'grid'],
                                    items: artists,
                                },
                            ],
                        },
                    });
                },
            }
        ).catch((err) => {
            this.logger.error('An error occurred while listing Spotify my artists ' + err);
            defer.reject('');
        });
    });

    return defer.promise;
};

ControllerSpotify.prototype.getTopArtists = function (curUri) {
    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
                var spotifyDefer = self.spotifyApi.getMyTopArtists({limit: 50});
                spotifyDefer.then(function (results) {
                    var response = {
                        navigation: {
                            prev: {
                                uri: 'spotify'
                            },
                            "lists": [
                                {
                                    "availableListViews": [
                                        "list",
                                        "grid"
                                    ],
                                    "items": []
                                }
                            ]
                        }
                    };

                    for (var i in results.body.items) {
                        var artist = results.body.items[i];
                        response.navigation.lists[0].items.push({
                            service: 'spop',
                            type: 'folder',
                            title: artist.name,
                            albumart: self._getAlbumArt(artist),
                            uri: artist.uri
                        });
                    }
                    defer.resolve(response);
                }, function (err) {
                    self.logger.error('An error occurred while listing Spotify my artists ' + err);
                    defer.reject('');
                });
            }
        );

    return defer.promise;
};

ControllerSpotify.prototype.getTopTracks = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
                var spotifyDefer = self.spotifyApi.getMyTopTracks({limit: 50});
                spotifyDefer.then(function (results) {
                    var response = {
                        navigation: {
                            prev: {
                                uri: 'spotify'
                            },
                            "lists": [
                                {
                                    "availableListViews": [
                                        "list"
                                    ],
                                    "items": []
                                }
                            ]
                        }
                    };

                    for (var i in results.body.items) {
                        var track = results.body.items[i];
                        if (self.isTrackAvailableInCountry(track)) {
                            response.navigation.lists[0].items.push({
                                service: 'spop',
                                type: 'song',
                                title: track.name,
                                artist: track.artists[0].name || null,
                                album: track.album.name || null,
                                albumart: self._getAlbumArt(track.album),
                                uri: track.uri
                            });
                        }
                    }
                    defer.resolve(response);
                }, function (err) {
                    self.logger.error('An error occurred while listing Spotify top tracks ' + err);
                    defer.reject('');
                });
            }
        );

    return defer.promise;
};

ControllerSpotify.prototype.getRecentTracks = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
                var spotifyDefer = self.spotifyApi.getMyRecentlyPlayedTracks({limit: 50});
                spotifyDefer.then(function (results) {
                    var response = {
                        navigation: {
                            prev: {
                                uri: 'spotify'
                            },
                            "lists": [
                                {
                                    "availableListViews": [
                                        "list"
                                    ],
                                    "items": []
                                }
                            ]
                        }
                    };

                    for (var i in results.body.items) {
                        var track = results.body.items[i].track;
                        if (self.isTrackAvailableInCountry(track)) {
                            response.navigation.lists[0].items.push({
                                service: 'spop',
                                type: 'song',
                                title: track.name,
                                artist: track.artists[0].name || null,
                                album: track.album.name || null,
                                albumart: self._getAlbumArt(track.album),
                                uri: track.uri
                            });
                        }
                    }
                    defer.resolve(response);
                }, function (err) {
                    self.logger.error('An error occurred while listing Spotify recent tracks ' + err);
                    defer.reject('');
                });
            }
        );

    return defer.promise;
};

ControllerSpotify.prototype.featuredPlaylists = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
                var spotifyDefer = self.spotifyApi.getFeaturedPlaylists();
                spotifyDefer.then(function (results) {
                    var response = {
                        navigation: {
                            prev: {
                                uri: 'spotify'
                            },
                            "lists": [
                                {
                                    "availableListViews": [
                                        "list",
                                        "grid"
                                    ],
                                    "items": []
                                }
                            ]
                        }
                    };

                    for (var i in results.body.playlists.items) {
                        var playlist = results.body.playlists.items[i];
                        response.navigation.lists[0].items.push({
                            service: 'spop',
                            type: 'playlist',
                            title: playlist.name,
                            albumart: self._getAlbumArt(playlist),
                            uri: playlist.uri
                        });
                    }
                    defer.resolve(response);
                }, function (err) {
                    self.logger.error('An error occurred while listing Spotify featured playlists ' + err);
                    defer.reject('');
                });
            }
        );

    return defer.promise;
};

ControllerSpotify.prototype.listWebPlaylist = function (curUri) {
    var self = this;

    var defer = libQ.defer();

    var uriSplitted = curUri.split(':');

    var spotifyDefer = self.getPlaylistTracks(uriSplitted[2], uriSplitted[4]);
    spotifyDefer.then(function (results) {
        var response = {
            navigation: {
                prev: {
                    uri: 'spotify'
                },
                "lists": [
                    {
                        "availableListViews": [
                            "list"
                        ],
                        "items": []
                    }
                ]
            }
        };
        for (var i in results) {
            response.navigation.lists[0].items.push(results[i]);
        }
        var playlistInfo = self.getPlaylistInfo(uriSplitted[2], uriSplitted[4]);
        playlistInfo.then(function (results) {
            response.navigation.info = results;
            response.navigation.info.uri = curUri;
            response.navigation.info.service = 'spop';
            defer.resolve(response);
        })
    });

    return defer.promise;
};

ControllerSpotify.prototype.listWebNew = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getNewReleases({limit: 50});
            spotifyDefer.then(function (results) {

                var response = {
                    navigation: {
                        prev: {
                            uri: 'spotify'
                        },
                        "lists": [
                            {
                                "availableListViews": [
                                    "list",
                                    "grid"
                                ],
                                "items": []
                            }
                        ]
                    }
                };

                for (var i in results.body.albums.items) {
                    var album = results.body.albums.items[i];
                    response.navigation.lists[0].items.push({
                        service: 'spop',
                        type: 'folder',
                        title: album.name,
                        albumart: self._getAlbumArt(album),
                        uri: album.uri
                    });
                }
                defer.resolve(response);
            }, function (err) {
                self.logger.error('An error occurred while listing Spotify new albums ' + err);
                defer.reject('');
            });
        });

    return defer.promise;
};

ControllerSpotify.prototype.listWebAlbum = function (curUri) {
    var self = this;
    var defer = libQ.defer();
    var uriSplitted = curUri.split(':');

    var spotifyDefer = self.getAlbumTracks(uriSplitted[2], {limit: 50});
    spotifyDefer.then(function (results) {
        var response = {
            navigation: {
                "prev": {
                    "uri": 'spotify'
                },
                "lists": [
                    {
                        "availableListViews": [
                            "list"
                        ],
                        "items": []
                    }
                ]
            }
        };

        for (var i in results) {
            response.navigation.lists[0].items.push(results[i]);
        }
        var albumInfo = self.getAlbumInfo(uriSplitted[2]);
        albumInfo.then(function (results) {
            response.navigation.info = results;
            response.navigation.info.uri = curUri;
            response.navigation.info.service = 'spop';
            defer.resolve(response);
        })
    });

    return defer.promise;
};


ControllerSpotify.prototype.listWebCategories = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getCategories({limit: 50});
            spotifyDefer.then(function (results) {

                var response = {
                    navigation: {
                        prev: {
                            uri: 'spotify'
                        },
                        "lists": [
                            {
                                "availableListViews": [
                                    "list",
                                    "grid"
                                ],
                                "items": []
                            }
                        ]
                    }
                };

                for (var i in results.body.categories.items) {
                    response.navigation.lists[0].items.push({
                        service: 'spop',
                        type: 'spotify-category',
                        title: results.body.categories.items[i].name,
                        albumart: results.body.categories.items[i].icons[0].url,
                        uri: 'spotify/category/' + results.body.categories.items[i].id
                    });
                }
                defer.resolve(response);
            }, function (err) {
                self.logger.error('An error occurred while listing Spotify categories ' + err);
                defer.reject('');
            });
        });

    return defer.promise;
};

ControllerSpotify.prototype.listWebCategory = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    var uriSplitted = curUri.split('/');

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getPlaylistsForCategory(uriSplitted[2], {limit: 50});
            spotifyDefer.then(function (results) {

                var response = {
                    navigation: {
                        prev: {
                            uri: 'spotify/categories'
                        },
                        "lists": [
                            {
                                "availableListViews": [
                                    "list",
                                    "grid"
                                ],
                                "items": []
                            }
                        ]
                    }
                };

                for (var i in results.body.playlists.items) {
                    var playlist = results.body.playlists.items[i];
                    response.navigation.lists[0].items.push({
                        service: 'spop',
                        type: 'folder',
                        title: playlist.name,
                        albumart: self._getAlbumArt(playlist),
                        uri: playlist.uri
                    });
                }
                defer.resolve(response);
            }, function (err) {
                self.logger.error('An error occurred while listing Spotify playlist category ' + err);
                defer.reject('');
            });
        });

    return defer.promise;
};

ControllerSpotify.prototype.listWebArtist = function (curUri) {

    var self = this;

    var defer = libQ.defer();

    var uriSplitted = curUri.split(':');

    var artistId = uriSplitted[2];

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var response = {
                navigation: {
                    prev: {
                        uri: 'spotify'
                    },
                    "lists": [
                        {
                            "availableListViews": [
                                "list"
                            ],
                            "items": [],
                            "title": "Top tracks"
                        },
                        {
                            "availableListViews": [
                                "list",
                                "grid"
                            ],
                            "items": [],
                            "title": "Albums"
                        },
                        {
                            "availableListViews": [
                                "list"
                            ],
                            "items": [],
                            "title": "Related Artists"
                        }
                    ]
                }
            };
            var spotifyDefer = self.listArtistTracks(artistId);
            spotifyDefer.then(function (results) {
                for (var i in results) {
                    response.navigation.lists[0].items.push(results[i]);
                }
                return response;
            })
                .then(function (results) {
                    return self.listArtistAlbums(artistId);
                })
                .then(function (results) {
                    for (var i in results) {
                        response.navigation.lists[1].items.push(results[i]);
                    }
                    return response;
                })
                .then(function (results) {
                    return self.getArtistInfo(artistId);
                })
                .then(function (results) {
                    response.navigation.info = results;
                    response.navigation.info.uri = curUri;
                    response.navigation.info.service = 'spop';


                    return response;
                })
                .then(function (results) {
                    return self.getArtistRelatedArtists(artistId);
                })
                .then(function (results) {
                    for (var i in results) {
                        response.navigation.lists[2].items.push(results[i]);
                    }
                    defer.resolve(response);
                    return response;
                })
                .catch(function (error) {
                    defer.resolve(response);
                });
        });

    return defer.promise;
};

ControllerSpotify.prototype.listArtistTracks = function (id) {

    var self = this;

    var defer = libQ.defer();

    var list = [];

    var spotifyDefer = self.getArtistTopTracks(id);
    spotifyDefer.then(function (data) {
        for (var i in data) {
            list.push(data[i]);
        }
        defer.resolve(list);
    });

    return defer.promise;
};

ControllerSpotify.prototype.listArtistAlbums = function (id) {

    var self = this;

    var defer = libQ.defer();

    var spotifyDefer = self.spotifyApi.getArtistAlbums(id);
    spotifyDefer.then(function (results) {
        var response = [];
        for (var i in results.body.items) {
            var album = results.body.items[i];
            response.push({
                service: 'spop',
                type: 'folder',
                title: album.name,
                albumart: self._getAlbumArt(album),
                uri: album.uri,
            });
        }
        defer.resolve(response);
    })


    return defer.promise;
};

ControllerSpotify.prototype.getArtistTracks = function (id) {

    var self = this;

    var defer = libQ.defer();

    var list = [];

    var spotifyDefer = self.getArtistTopTracks(id);
    spotifyDefer.then(function (data) {
        for (var i in data) {
            list.push(data[i]);
        }
        return list;
    })
        .then(function (data) {
            var spotifyDefer = self.getArtistAlbumTracks(id);
            spotifyDefer.then(function (results) {
                var response = data;
                for (var i in results) {
                    response.push(results[i]);
                }
                defer.resolve(response);
            });
        });

    return defer.promise;
};

ControllerSpotify.prototype.getArtistAlbumTracks = function (id) {

    var self = this;

    var defer = libQ.defer();

    var list = [];

    var spotifyDefer = self.spotifyApi.getArtistAlbums(id);
    spotifyDefer.then(function (results) {
        //	var response = data;
        var response = [];
        return results.body.items.map(function (a) {
            return a.id
        });
    })
        .then(function (albums) {
            var spotifyDefer = self.spotifyApi.getAlbums(albums);
            spotifyDefer.then(function (data) {
                var results = data;
                var response = [];
                for (var i in results.body.albums) {
                    var album = results.body.albums[i];
                    for (var j in album.tracks.items) {
                        var track = album.tracks.items[j];
                        if (self.isTrackAvailableInCountry(track)) {
                            response.push({
                                service: 'spop',
                                type: 'song',
                                name: track.name,
                                title: track.name,
                                artist: track.artists[0].name,
                                album: album.name,
                                albumart: self._getAlbumArt(album),
                                uri: track.uri
                            });
                        }
                    }
                }
                defer.resolve(response);
            });
        });


    return defer.promise;
};

ControllerSpotify.prototype.getArtistAlbums = function (artistId) {

    var self = this;

    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getArtistAlbums(artistId);
            spotifyDefer.then(function (results) {
                var response = [];
                for (var i in results.body.items) {
                    var album = results.body.items[i];
                    response.push({
                        service: 'spop',
                        type: 'folder',
                        title: album.name,
                        albumart: self._getAlbumArt(album),
                        uri: album.uri
                    });
                }
                defer.resolve(response);
            });
        });
    return defer.promise;
};

ControllerSpotify.prototype.getArtistRelatedArtists = function (artistId) {

    var self = this;

    var defer = libQ.defer();

    var list = [];

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getArtistRelatedArtists(artistId);
            spotifyDefer.then(function (results) {
                for (var i in results.body.artists) {
                    var albumart = '';
                    var artist = results.body.artists[i];
                    var albumart = self._getAlbumArt(artist);
                    var item = {
                        service: 'spop',
                        type: 'folder',
                        title: artist.name,
                        albumart: albumart,
                        uri: artist.uri
                    };
                    if (albumart == '') {
                        item.icon = 'fa fa-user';
                    }
                    list.push(item);
                }
                defer.resolve(list);
            })
        });

    return defer.promise;
};

ControllerSpotify.prototype.getAlbumTracks = function (id) {
    var self = this;
    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
                var spotifyDefer = self.spotifyApi.getAlbum(id);
                spotifyDefer.then(function (results) {
                    var response = [];
                    var album = results.body.name;
                    var albumart = results.body.images[0].url;
                    for (var i in results.body.tracks.items) {
                        var track = results.body.tracks.items[i];
                        if (self.isTrackAvailableInCountry(track)) {
                            response.push({
                                service: 'spop',
                                type: 'song',
                                title: track.name,
                                name: track.name,
                                artist: track.artists[0].name,
                                album: album,
                                albumart: albumart,
                                uri: track.uri,
                                samplerate: self.getCurrentBitrate(),
                                bitdepth: '16 bit',
                                bitrate: '',
                                codec: 'ogg',
                                trackType: 'spotify',
                                duration: Math.trunc(track.duration_ms / 1000)
                            });
                        }
                    }
                    defer.resolve(response);
                }, function (err) {
                    self.logger.error('An error occurred while listing Spotify album tracks ' + err);
                    defer.reject('');
                });
            }
        );

    return defer.promise;
};


ControllerSpotify.prototype.getPlaylistTracks = function (userId, playlistId) {
    var defer = libQ.defer();
    var response = [];

    this.spotifyCheckAccessToken().then(() => {
        fetchPagedData(
            this.spotifyApi,
            'getPlaylistTracks',
            { requiredArgs: [playlistId] },
            {
                onData: (items) => {
                    for (var i in items) {
                        var track = items[i].track;
                        if (this.isTrackAvailableInCountry(track)) {
                            var item = {
                                service: 'spop',
                                type: 'song',
                                name: track.name,
                                title: track.name,
                                artist: track.artists[0].name,
                                album: track.album.name,
                                uri: track.uri,
                                samplerate: this.getCurrentBitrate(),
                                bitdepth: '16 bit',
                                bitrate: '',
                                codec: 'ogg',
                                trackType: 'spotify',
                                albumart: (track.album.hasOwnProperty('images') && track.album.images.length > 0 ? track.album.images[0].url : ''),
                                duration: Math.trunc(track.duration_ms / 1000)
                            };
                            response.push(item);
                        }
                    }
                },
                onEnd: () => {
                    defer.resolve(response);
                },
            }
        ).catch((err) => {
            this.logger.error('An error occurred while exploding listing Spotify playlist tracks ' + err);
            defer.reject(err);
        });
    });

    return defer.promise;
};

ControllerSpotify.prototype.getArtistTopTracks = function (id) {
    var self = this;
    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getArtistTopTracks(id, 'GB');
            spotifyDefer.then(function (results) {
                var response = [];
                for (var i in results.body.tracks) {
                    var albumart = '';
                    var track = results.body.tracks[i];
                    if (track.album.hasOwnProperty('images') && track.album.images.length > 0) {
                        albumart = track.album.images[0].url;
                    }
                    if (self.isTrackAvailableInCountry(track)) {
                        response.push({
                            service: 'spop',
                            type: 'song',
                            name: track.name,
                            title: track.name,
                            artist: track.artists[0].name,
                            album: track.album.name,
                            albumart: albumart,
                            duration: parseInt(track.duration_ms / 1000),
                            samplerate: self.getCurrentBitrate(),
                            bitdepth: '16 bit',
                            bitrate: '',
                            codec: 'ogg',
                            trackType: 'spotify',
                            uri: track.uri
                        });
                    }
                }
                defer.resolve(response);
            }), function (err) {
                self.logger.error('An error occurred while listing Spotify artist tracks ' + err);
                defer.reject('');
            }
        });

    return defer.promise;
};

ControllerSpotify.prototype.getArtistInfo = function (id) {
    var self = this;
    var defer = libQ.defer();

    var info = {};
    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getArtist(id);
            spotifyDefer.then(function (results) {
                if (results && results.body && results.body.name) {
                    info.title = results.body.name;
                    info.albumart = results.body.images[0].url;
                    info.type = 'artist';
                }
                defer.resolve(info);
            }), function (err) {
                self.logger.info('An error occurred while listing Spotify artist informations ' + err);
                defer.resolve(info);
            }
        });

    return defer.promise;
}

ControllerSpotify.prototype.getAlbumInfo = function (id) {
    var self = this;
    var defer = libQ.defer();

    var info = {};
    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getAlbum(id);
            spotifyDefer.then(function (results) {
                if (results && results.body && results.body.name) {
                    info.album = results.body.name;
                    info.artist = results.body.artists[0].name;

                    info.albumart = results.body.images[0].url;
                    info.type = 'album';
                }
                return results.body.artists[0].id;
            }).then(function (artist) {
                return self.spotifyApi.getArtist(artist);
            }).then(function (artistResults) {
                if (artistResults && artistResults.body && artistResults.body.name) {
                    info.artistImage = artistResults.body.images[0].url;
                    info.artistUri = artistResults.body.uri;
                }
                defer.resolve(info);
            }), function (err) {
                self.logger.error('An error occurred while listing Spotify album informations ' + err);
                defer.resolve(info);
            }
        });

    return defer.promise;
}

ControllerSpotify.prototype.getPlaylistInfo = function (userId, playlistId) {
    var self = this;
    var defer = libQ.defer();

    var info = {};
    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.getPlaylist(playlistId);
            spotifyDefer.then(function (results) {
                if (results && results.body && results.body.name) {
                    info.title = results.body.name;
                    info.albumart = results.body.images[0].url;
                    info.type = 'album';
                    info.service = 'spop';
                }
                defer.resolve(info);
            }, function (err) {
                defer.resolve(info);
                self.logger.error('An error occurred while getting Playlist info: ' + err);
            });
        });

    return defer.promise;
}

ControllerSpotify.prototype.getTrack = function (id) {
    var defer = libQ.defer();

    this.spotifyCheckAccessToken().then(() => {
        rateLimitedCall(this.spotifyApi, 'getTrack', { args: [id], logger: this.logger })
            .then((results) => {
                const track = results.body;
                var response = [];
                var artist = '';
                var album = '';
                var albumart = '';

                if (track.artists.length > 0) {
                    artist = track.artists[0].name;
                }

                if (track.hasOwnProperty('album') && track.album.hasOwnProperty('name')) {
                    album = track.album.name;
                }

                if (track.album.hasOwnProperty('images') && track.album.images.length > 0) {
                    albumart = track.album.images[0].url;
                } else {
                    albumart = '';
                }

                var item = {
                    uri: track.uri,
                    service: 'spop',
                    name: track.name,
                    artist: artist,
                    album: album,
                    type: 'song',
                    duration: parseInt(track.duration_ms / 1000),
                    albumart: albumart,
                    samplerate: this.getCurrentBitrate(),
                    bitdepth: '16 bit',
                    bitrate: '',
                    codec: 'ogg',
                    trackType: 'spotify'
                };
                response.push(item);
                this.debugLog('GET TRACK: ' + JSON.stringify(response));
                defer.resolve(response);
            })
            .catch((e) => {
                defer.reject(e);
            });
    });
    return defer.promise;
};

// SEARCH FUNCTIONS
ControllerSpotify.prototype.search = function (query) {
    var self = this;
    var defer = libQ.defer();

    self.spotifyCheckAccessToken()
        .then(function (data) {
            var spotifyDefer = self.spotifyApi.search(query.value, ['artist', 'album', 'playlist', 'track']);
            spotifyDefer.then(function (results) {
                var list = [];
                // Show artists, albums, playlists then tracks
                if (results.body.hasOwnProperty('artists') && results.body.artists.items.length > 0) {
                    var artistlist = [];
                    var artists = self._searchArtists(results);
                    for (var i in artists) {
                        artistlist.push(artists[i]);
                    }
                    list.push({
                        type: 'title',
                        title: 'Spotify ' + self.commandRouter.getI18nString('COMMON.SEARCH_ARTIST_SECTION'),
                        availableListViews: ["list", "grid"],
                        items: artistlist
                    });
                }
                if (results.body.hasOwnProperty('albums') && results.body.albums.items.length > 0) {
                    var albumlist = [];
                    var albums = self._searchAlbums(results);
                    for (var i in albums) {
                        albumlist.push(albums[i]);
                    }
                    list.push({
                        type: 'title',
                        title: 'Spotify ' + self.commandRouter.getI18nString('COMMON.SEARCH_ALBUM_SECTION'),
                        availableListViews: ["list", "grid"],
                        items: albumlist
                    });
                }
                if (results.body.hasOwnProperty('playlists') && results.body.playlists.items.length > 0) {
                    var playlistlist = [];
                    var playlists = self._searchPlaylists(results);
                    for (var i in playlists) {
                        playlistlist.push(playlists[i]);
                    }
                    list.push({
                        type: 'title',
                        title: 'Spotify ' + self.commandRouter.getI18nString('COMMON.PLAYLISTS'),
                        availableListViews: ["list", "grid"],
                        items: playlistlist
                    });
                }
                if (results.body.hasOwnProperty('tracks') && results.body.tracks.items.length > 0) {
                    var songlist = [];
                    var tracks = self._searchTracks(results);
                    for (var i in tracks) {
                        songlist.push(tracks[i]);
                    }
                    list.push({type: 'title', title: 'Spotify ' + self.commandRouter.getI18nString('COMMON.TRACKS'), availableListViews: ["list"], items: songlist});
                }
                defer.resolve(list);
            }, function (err) {
                self.logger.error('An error occurred while searching ' + err);
                defer.reject('');
            });
        });

    return defer.promise;
};

ControllerSpotify.prototype._searchArtists = function (results) {

    var list = [];

    for (var i in results.body.artists.items) {
        var albumart = '';
        var artist = results.body.artists.items[i];
        if (artist.hasOwnProperty('images') && artist.images.length > 0) {
            albumart = artist.images[0].url;
        }
        ;
        var item = {
            service: 'spop',
            type: 'folder',
            title: artist.name,
            albumart: albumart,
            uri: artist.uri
        };
        if (albumart == '') {
            item.icon = 'fa fa-user';
        }
        list.push(item);
    }

    return list;

};

ControllerSpotify.prototype._searchAlbums = function (results) {
    var list = [];

    for (var i in results.body.albums.items) {
        var albumart = '';
        var album = results.body.albums.items[i];
        if (album.hasOwnProperty('images') && album.images.length > 0) {
            albumart = album.images[0].url;
        }
        var artist = '';
        if (album.artists && album.artists[0] && album.artists[0].name) {
            artist = album.artists[0].name;
        }

        list.push({
            service: 'spop',
            type: 'folder',
            title: album.name,
            artist: artist,
            albumart: albumart,
            uri: album.uri,
        });
    }

    return list;
};

ControllerSpotify.prototype._searchPlaylists = function (results) {

    var list = [];

    for (var i in results.body.playlists.items) {
        var albumart = '';
        var playlist = results.body.playlists.items[i];
        if (playlist.hasOwnProperty('images') && playlist.images.length > 0) {
            albumart = playlist.images[0].url;
        }
        ;
        list.push({
            service: 'spop',
            type: 'folder',
            title: playlist.name,
            albumart: albumart,
            uri: playlist.uri
        });
    }

    return list;
};

ControllerSpotify.prototype._searchTracks = function (results) {

    var list = [];

    for (var i in results.body.tracks.items) {
        var albumart = '';
        var track = results.body.tracks.items[i];
        if (track.album.hasOwnProperty('images') && track.album.images.length > 0) {
            albumart = track.album.images[0].url;
        }
        ;
        list.push({
            service: 'spop',
            type: 'song',
            title: track.name,
            artist: track.artists[0].name,
            album: track.album.name,
            albumart: albumart,
            uri: track.uri
        });
    }

    return list;
};

ControllerSpotify.prototype._searchTracks = function (results) {

    var list = [];

    for (var i in results.body.tracks.items) {
        var albumart = '';
        var track = results.body.tracks.items[i];
        if (track.album.hasOwnProperty('images') && track.album.images.length > 0) {
            albumart = track.album.images[0].url;
        }
        ;
        list.push({
            service: 'spop',
            type: 'song',
            title: track.name,
            artist: track.artists[0].name,
            album: track.album.name,
            albumart: albumart,
            uri: track.uri
        });
    }

    return list;
};


ControllerSpotify.prototype.searchArtistByName = function (artistName) {
    var self = this;
    var defer = libQ.defer();

    self.spotifyApi.search(artistName, ['artist']).then((results)=> {
        if (results.body.hasOwnProperty('artists') && results.body.artists.items.length > 0) {
            var artistResult = results.body.artists.items[0];
            self.listWebArtist('spotify:artist:' + artistResult.id).then((result)=> {
                defer.resolve(result);
            }).fail((error)=> {
                defer.reject(error);
            });
        } else {
            defer.reject('No artist found');
        }
    });
    return defer.promise;
};

ControllerSpotify.prototype.searchAlbumByName = function (albumName) {
    var self = this;
    var defer = libQ.defer();

    var spotifyDefer = self.spotifyApi.search(albumName, ['album']);
    spotifyDefer.then((results)=> {
        if (results.body.hasOwnProperty('albums') && results.body.albums.items.length > 0) {
            var albumResult = results.body.albums.items[0];
            self.listWebAlbum('spotify:album:' + albumResult.id).then((result)=> {
                defer.resolve(result);
            }).fail((error)=> {
                defer.reject(error);
            });
        } else {
            defer.reject('No album found');
        }
    });
    return defer.promise;
};


ControllerSpotify.prototype.goto = function (data) {
    var self = this;

    if (data.type == 'artist') {
        return self.searchArtistByName(data.value);
    } else if (data.type == 'album') {
        return this.searchAlbumByName(data.value);
    }
};

// PLUGIN FUNCTIONS

ControllerSpotify.prototype.debugLog = function (stringToLog) {
    var self = this;

    if (isDebugMode) {
        console.log('SPOTIFY: ' + stringToLog);
    }
};

ControllerSpotify.prototype.isTrackAvailableInCountry = function (currentTrackObj) {
    var self = this;

    if (self.userCountry && self.userCountry.length && currentTrackObj && currentTrackObj.available_markets && currentTrackObj.available_markets.length) {
        if (currentTrackObj.available_markets.includes(self.userCountry)) {
            return true;
        } else {
            return false;
        }
    } else {
        return true;
    }
};

ControllerSpotify.prototype.explodeUri = function (uri) {
    var self = this;

    self.debugLog('EXPLODING URI:' + uri);

    var defer = libQ.defer();

    var uriSplitted;

    var response;

    if (uri.startsWith('spotify/playlists')) {
        response = self.getMyPlaylists();
        defer.resolve(response);
    } else if (uri.startsWith('spotify:playlist:')) {
        uriSplitted = uri.split(':');
        response = self.getPlaylistTracks(uriSplitted[0], uriSplitted[2]);
        defer.resolve(response);
    } else if (uri.startsWith('spotify:artist:')) {
        uriSplitted = uri.split(':');
        response = self.getArtistTracks(uriSplitted[2]);
        defer.resolve(response);
    } else if (uri.startsWith('spotify:album:')) {
        uriSplitted = uri.split(':');
        response = self.getAlbumTracks(uriSplitted[2]);
        defer.resolve(response);
    } else if (uri.startsWith('spotify:user:')) {
        uriSplitted = uri.split(':');
        response = self.getPlaylistTracks(uriSplitted[2], uriSplitted[4]);
        defer.resolve(response);
    } else if (uri.startsWith('spotify:track:')) {
        uriSplitted = uri.split(':');
        response = self.getTrack(uriSplitted[2]);
        defer.resolve(response);
    } else {
        self.logger.info('Bad URI while exploding Spotify URI: ' + uri);
    }

    return defer.promise;
};

ControllerSpotify.prototype.seekTimerAction = function () {
    var self = this;

    if (this.state.status === 'play') {
        if (seekTimer === undefined) {
            seekTimer = setInterval(() => {
                this.state.seek = this.state.seek + 1000;
            }, 1000);
        }
    } else {
        clearInterval(seekTimer);
        seekTimer = undefined;
    }
};

ControllerSpotify.prototype.getLabelForSelect = function (options, key) {
    var n = options.length;
    for (var i = 0; i < n; i++) {
        if (options[i].value === key) { return options[i].label; }
    }

    return 'VALUE NOT FOUND BETWEEN SELECT OPTIONS!';
};

ControllerSpotify.prototype.getSpotifyVolume = function () {
    var self = this;

    self.logger.info('Getting Spotify volume');
    superagent.get(spotifyLocalApiEndpointBase + '/player/volume')
        .accept('application/json')
        .then((results) => {
            if (results && results.body && results.body.value) {
                self.logger.info('Spotify volume: ' + results.body.value);
                currentSpotifyVolume = results.body.value;
            }
        })
        .catch((error) => {
            self.logger.error('Failed to get Spotify volume from local API: ' + error);
        });
};

ControllerSpotify.prototype.prefetch = function (track) {
    var self=this;

    // TODO: To finish this we need consume API or queue edititing ability from Spotify

    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerSpotify::prefetch');

    return self.sendSpotifyLocalApiCommandWithPayload('/player/add_to_queue', { uri: track.uri });
};

ControllerSpotify.prototype.applySpotifyHostsFix = function () {
    var self = this;

    fs.readFile('/etc/hosts', 'utf8', (err, data) => {
        if (err) {
            self.logger.error('Failed to Read hosts file:' + err);
        } else {
            if (data.includes('#SPOTIFY HOSTS FIX')) {
                exec('/usr/bin/sudo /bin/chmod 777 /etc/hosts', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
                    if (error !== null) {
                        self.logger.error('Spotify Cannot set permissions for /etc/hosts: ' + error);
                    } else {
                        data = data.split('#SPOTIFY HOSTS FIX')[0];
                        fs.writeFile('/etc/hosts', data, (err) => {
                            if (err) {
                                self.logger.error('Failed to fix hosts file for Spotify: ' + err);
                            } else {
                                self.logger.info('Successfully fixed Spotify hosts');
                            }
                        });
                    }
                });
            } else {
                self.logger.info('No need to fix Spotify hosts');
            }
        }
    });
};
