'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;


module.exports = maloja;
function maloja(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}


maloja.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

    return libQ.resolve();
}

maloja.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();

    self.active = true;
    self.currentTrack = null;  // { artist, title, duration }
    self.scrobbled = false;    // whether the current track has been scrobbled
    self.playStart = null;     // timestamp (ms) when playback last started/resumed
    self.playedMs = 0;         // accumulated playback time in ms for the current track

    self.stateCallback = function(state) {
        self.onStateChange(state);
    };
    self.commandRouter.addCallback('volumioPushState', self.stateCallback);

    // Check every minute whether the current track qualifies for scrobbling
    self.scrobbleInterval = setInterval(function() {
        self.checkScrobble();
    }, 60000);

    defer.resolve();
    return defer.promise;
};

maloja.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.active = false;

    if (self.scrobbleInterval) {
        clearInterval(self.scrobbleInterval);
        self.scrobbleInterval = null;
    }

    defer.resolve();
    return libQ.resolve();
};

maloja.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

maloja.prototype.onStateChange = function(state) {
    var self = this;
    if (!self.active) return;

    var artist = state.artist || '';
    var title = state.title || '';
    var isSameTrack = self.currentTrack &&
        self.currentTrack.artist === artist &&
        self.currentTrack.title === title;

    if (!isSameTrack) {
        // A different track has started (or playback stopped) — scrobble the previous
        // track if it hasn't been scrobbled yet and played long enough (at least 30 s,
        // consistent with standard scrobbling conventions).
        if (self.currentTrack && !self.scrobbled) {
            var totalPlayed = self.playedMs + (self.playStart ? Date.now() - self.playStart : 0);
            if (totalPlayed >= 30000) {
                self.sendScrobble(self.currentTrack, Math.floor(totalPlayed / 1000));
            }
        }

        if (artist || title) {
            self.currentTrack = { artist: artist, title: title, duration: state.duration || 0 };
            self.scrobbled = false;
            self.playedMs = 0;
            self.playStart = (state.status === 'play') ? Date.now() : null;
        } else {
            self.currentTrack = null;
            self.scrobbled = false;
            self.playedMs = 0;
            self.playStart = null;
        }
    } else {
        // Same track — update accumulated play time based on play/pause transitions
        if (state.status === 'play' && !self.playStart) {
            self.playStart = Date.now();
        } else if (state.status !== 'play' && self.playStart) {
            self.playedMs += Date.now() - self.playStart;
            self.playStart = null;
        }
    }
};

// Called every minute; scrobbles if the track has been playing for 4+ minutes total.
maloja.prototype.checkScrobble = function() {
    var self = this;
    if (!self.active || !self.currentTrack || self.scrobbled || !self.playStart) return;

    var totalPlayed = self.playedMs + (Date.now() - self.playStart);
    if (totalPlayed >= 240000) {
        self.sendScrobble(self.currentTrack, Math.floor(totalPlayed / 1000));
    }
};

maloja.prototype.sendScrobble = function(track, playedSeconds) {
    var self = this;
    var url = self.config.get('url');
    var apiKey = self.config.get('api_key');

    if (!url || !apiKey) {
        //self.logger.warn('Maloja Scrobbler: URL or API key not configured, skipping scrobble');
        return;
    }

    self.scrobbled = true;

    var endpoint = url.replace(/\/$/, '') + '/apis/mlj_1/newscrobble?key=' + encodeURIComponent(apiKey);
    var body = JSON.stringify({
        artist: track.artist,
        title: track.title,
        duration: playedSeconds,
        length: track.duration
    });

    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
    })
    .then(function(response) {
        if (!response.ok) {
            //self.logger.error('Maloja Scrobbler: Scrobble failed with HTTP ' + response.status);
            self.scrobbled = false;
        } else {
            //self.logger.info('Maloja Scrobbler: Scrobbled "' + track.title + '" by ' + track.artist);
            self.commandRouter.pushToastMessage('success', "Maloja Plugin", 'Maloja Scrobbler: Scrobbled "' + track.title + '" by ' + track.artist);
        }
    })
    .catch(function(err) {
        //self.logger.error('Maloja Scrobbler: Error sending scrobble: ' + err.message);
        self.scrobbled = false;
    });
};


// Configuration Methods -----------------------------------------------------------------------------

maloja.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            uiconf.sections[0].content[0].value = self.config.get('url');
		    uiconf.sections[0].content[1].value = self.config.get('api_key');		

            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

maloja.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

maloja.prototype.setUIConfig = function(data) {
	var self = this;
	
	//self.logger.info("Updating UI config");
	var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
	
	return libQ.resolve();
};

maloja.prototype.saveConfig = function(data) {
	var self = this;
	var defer=libQ.defer();
	self.config.set('url', data['url']);
	self.config.set('api_key', data['api_key']);
    defer.resolve();
    self.commandRouter.pushToastMessage('success', "Maloja Plugin", "Settings Saved");
};

maloja.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

maloja.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};


