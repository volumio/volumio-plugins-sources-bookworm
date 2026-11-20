'use strict';

var config = new (require('v-conf'))();
var crypto = require('crypto');
var fs = require('fs-extra');
var http = require('http');
var io = require('socket.io-client');
var pTimer = require('./pausableTimer');
var socket = io.connect('http://localhost:3000');
var lastfm = require("./lib/simple-lastfm");
var libQ = require('kew');
var net = require('net');
var os = require('os');

var blacklistedServices; // = ['webradio'];
var scrobbleThresholdSong = 500;  // as fraction of the song duration
var scrobbleThresholdStream = 60000; // in milliseconds, so this default is 60s

var debugEnabled = false;

// Settings for splitting composite titles (as used for many webradio streams)
var compositeTitle =
        {
            separator: " - ",
            indexOfArtist: 0,
            indexOfTitle: 1
        }

var trackStartTime = 0;

// Define the ControllerLastFM class
module.exports = ControllerLastFM;

function ControllerLastFM(context) 
{
	var self = this;
    self.previousState = { title: '| Initialising...' };
	self.updatingNowPlaying = false;
	self.timeToPlay = 0;
    self.apiResponse = null;
    self.lfm = null;
    // Session state: see initLastFMSession / ensureLastFMSession
    self.authenticating = false;
    self.authStartedAt = 0;
    self.sessionGeneration = 0;
    self.sessionRetryTimer = null;
    self.sessionRetryAttempt = 0;
    self.pendingScrobbles = [];
    self.stopped = false;
	self.previousScrobble = 
    {	artist: '',
        title: '',
        scrobbleTime: 0
    };
    self.scrobbleData =
	{
		artist: '',
		title: '',
        album: '',
        duration: 0
    };

    self.scrobblableTrack = false;
	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
	this.memoryTimer;
};

ControllerLastFM.prototype.onVolumioStart = function()
{
	var self = this;
	this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	self.getConf(this.configFile);
	
	return libQ.resolve();	
};

ControllerLastFM.prototype.getConfigurationFiles = function()
{
	return ['config.json'];
};

// Plugin methods -----------------------------------------------------------------------------

ControllerLastFM.prototype.onStop = function() {
	var self = this;
	self.logger.info("Performing onStop action");
	self.stopped = true;
	self.sessionGeneration++;
	self.authenticating = false;
	self.clearSessionRetry();
	
	return libQ.resolve();
};

ControllerLastFM.prototype.stop = function() {
	var self = this;
	self.logger.info("Performing stop action");
	
	return libQ.resolve();
};

ControllerLastFM.prototype.onStart = function() {
    var self = this;
	//self.logger.info("Performing onStart action");
    self.addToBrowseSources();

    debugEnabled = self.config.get('enable_debug_logging');
    self.logger.info('[LastFM] scrobbler initiated!');
    self.logger.info('[LastFM] extended logging: ' + debugEnabled);
    self.logger.info('[LastFM] try scrobble stream/radio plays: ' + self.config.get('scrobbleFromStream'));
    self.currentTimer = new pTimer(self.context, debugEnabled);

    self.initScrobbleSettings();
    self.stopped = false;
    self.sessionRetryAttempt = 0;
    self.initLastFMSession().then(result => self.logger.info('[LastFM] finished init: ' + result), error => self.logger.info('[LastFM] finished init with error: ' + error) );
    self.logger.info('[LastFM] Left init routine');
 
	self.logger.info('[LastFM] Socket already connected: ' + socket.connected);
     // start monitoring the Volumio state to check what song is playing and scrobble it:
    socket.on('pushState', function (state) { self.checkStateUpdate(state); });
	// self.logger.info('[LastFM] Now it should be: ' + socket.connected); // It's not! Takes a while...
	
	// Initialize with the correct settings
	self.updateCompositeTitleSettings(self.config.get('titleSeparator'), self.config.get('artistFirst'));
    
	return libQ.resolve();
};

ControllerLastFM.prototype.onRestart = function() 
{
	var self = this;
	self.logger.info("Performing onRestart action");
};

ControllerLastFM.prototype.onInstall = function() 
{
	var self = this;
	self.logger.info("Performing onInstall action");
};

ControllerLastFM.prototype.onUninstall = function() 
{
	// Perform uninstall tasks here!
	self.logger.info("Performing onUninstall action");
};

ControllerLastFM.prototype.getUIConfig = function() {
    var self = this;
	var defer = libQ.defer();    
    var lang_code = this.commandRouter.sharedVars.get('language_code');
	self.getConf(this.configFile);
	self.logger.info("Loaded the previous config.");
	
	//var thresholds = fs.readJsonSync((__dirname + '/options/thresholds.json'),  'utf8', {throws: false});
	
	self.commandRouter.i18nJson(__dirname+'/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
    .then(function(uiconf)
    {
		self.logger.info("## populating UI...");
		
		// Credentials settings
		uiconf.sections[0].content[0].value = self.config.get('API_KEY');
		uiconf.sections[0].content[1].value = self.config.get('API_SECRET');		
		uiconf.sections[0].content[2].value = self.config.get('username');
		if(self.config.get('password') != undefined && self.config.get('password') != '')
			uiconf.sections[0].content[3].value = self.config.get('password');
		else
			uiconf.sections[0].content[3].value = '******';
		self.logger.info("1/3 settings loaded");
		
		// Scrobble settings
		uiconf.sections[1].content[0].value = self.config.get('blacklistedServices');

		for (var n = 0; n < uiconf.sections[1].content[1].options.length; n++){			
			if(uiconf.sections[1].content[1].options[n].value == parseInt(self.config.get('scrobbleThreshold')))
			{
				uiconf.sections[1].content[1].value.value = uiconf.sections[1].content[1].options[n].value;
				uiconf.sections[1].content[1].value.label = uiconf.sections[1].content[1].options[n].label;
			}
		}
        //uiconf.sections[1].content[1].value.value = parseInt(self.config.get('scrobbleThreshold'));
		uiconf.sections[1].content[2].value = self.config.get('pushToastOnScrobble');
		uiconf.sections[1].content[3].value = self.config.get('scrobbleFromStream');
		uiconf.sections[1].content[4].value = self.config.get('streamScrobbleThreshold');
		uiconf.sections[1].content[5].value = self.config.get('titleSeparator');
		uiconf.sections[1].content[6].value = self.config.get('artistFirst');
		self.logger.info("2/3 settings loaded");
		
		uiconf.sections[2].content[0].value = debugEnabled;
		self.logger.info("3/3 settings loaded");
		
		self.logger.info("Populated config screen.");
		
		self.logger.info("LFM object: " + self.lfm);
		
		defer.resolve(uiconf);
	})
	.fail(function()
	{
		defer.reject(new Error());
	});

	return defer.promise;
};

ControllerLastFM.prototype.setUIConfig = function(data) {
	var self = this;
	
	self.logger.info("Updating UI config");
	var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
	
	return libQ.resolve();
};

ControllerLastFM.prototype.getConf = function(configFile) {
	var self = this;
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);
	
	return libQ.resolve();
};

ControllerLastFM.prototype.setConf = function(conf) {
	var self = this;
	return libQ.resolve();
};

//-------------------------------------------------------------------------
// 'Music service' related functions
//
// required to add to add lastFM to browser
ControllerLastFM.prototype.addToBrowseSources = function () {
    var data = { 
		name: 'LastFM', 
		uri: 'lastfm', 
		plugin_type: 'miscellanea', 
		plugin_name: 'lastfm',
		icon: 'fa fa-lastfm',
		albumart: '/albumart?sourceicon=miscellanea/lastfm/lastfm_fill.svg'
		};
    this.commandRouter.volumioAddToBrowseSources(data);
};

// required to handle lastFM browser events
ControllerLastFM.prototype.handleBrowseUri = function (curUri) {
    var self = this;
    var response;
    if (curUri == 'lastfm') {
        response = self.browseRoot('lastfm');
    }
	else if (curUri.startsWith('lastfm')) {
        self.logger.info('[LastFM] browsing to: ' + curUri);
		
		if(curUri == 'lastfm/similar_artist')
			response = self.getSimilarArtists('similar_artist');
		else if (curUri == 'lastfm/similar_tracks')
			response = self.getSimilarTracks('similar_tracks');
    }
    return response
        .fail(function (e) {
            self.logger.info('[' + Date.now() + '] ' + '[LastFM] handleBrowseUri failed');
            libQ.reject(new Error());
        });
};

// used to handle lastFM browser events
ControllerLastFM.prototype.browseRoot = function(uri) {
  var self = this;
  self.fTree = [ 
		{ label: 'Similar Artists', uri: 'similar_artist', icon: 'fa fa-users'},
		{ label: 'Similar Tracks', uri: 'similar_tracks', icon: 'fa fa-music'}
	];
  var defer = libQ.defer();

  var rootTree = {
    navigation: {
      lists: [
        {
          availableListViews: [
            'grid', 'list',
          ],
          items: [
          ],
        },
      ],
      prev: {
        uri: '/',
      },
    },
  };

  for (var f in self.fTree) {
    
    rootTree.navigation.lists[0].items.push({
      service: 'lastfm',
      type: 'category',
      title: self.fTree[f].label,
      artist: '',
      album: '',
      icon: self.fTree[f].icon,
	  albumart: '',
      uri: 'lastfm/' + self.fTree[f].uri,
    });
  }
  defer.resolve(rootTree);
    
  return defer.promise;
};

ControllerLastFM.prototype.getAlbumArt = function (data, path, icon) {
  if (this.albumArtPlugin == undefined) {
    // initialization, skipped from second call
    this.albumArtPlugin = this.commandRouter.pluginManager.getPlugin('miscellanea', 'albumart');
  }

  if (this.albumArtPlugin) { return this.albumArtPlugin.getAlbumArt(data, path, icon); } else {
    return '/albumart';
  }
};

// Handle browse events----------------------------------------------------------------------------------
// 
// Handle getting similar artist
ControllerLastFM.prototype.getSimilarArtists = function(uri) {
	var self = this;
	var defer = libQ.defer();

    var artworkSearchedArtist = self.getAlbumArt({artist: self.scrobbleData.artist}, undefined, 'users');

    var rootTree = 
    {
        navigation: {
            lists: [
            {
                availableListViews: [
                    'grid', 'list'
                ],
                items: []
            }],
            prev: {
                uri: 'lastfm'
            },                 
            info: { 
                uri: "search/artist/" + self.scrobbleData.artist, 
                title: 'Similar artists to ' + self.scrobbleData.artist, 
                service: 'lastfm', 
                type: 'artist', 
                albumart: artworkSearchedArtist 
            } 
        }
    };

    // This is on the git repository, but does not seem to be in the latest version that I can fetch by "npm update" right now
// 
//    self.lfm.getSimilarArtists({
//        artist: self.scrobbleData.artist,
//        limit: 10,
//        callback: function (result) {
//            if (result.success) {
//                // Display results to start with
//                self.logger.info('[LastFM] track info: ' + JSON.stringify(result));
//            }
//            else
//                self.logger.error('[LastFM] track info request failed with error: ' + result.error);
//        }
//    });

	var call = self.apiCall('artist.getsimilar', self.scrobbleData);
	call.then(function(response){
		
		var jsonResp = JSON.parse(response);
        for (var art in jsonResp.similarartists.artist)
        {            
            rootTree.navigation.lists[0].items.push({
                service: 'lastfm',
                type: 'item-no-menu',
                title: jsonResp.similarartists.artist[art].name,
                artist: '',
                mbid: jsonResp.similarartists.artist[art].mbid,
                albumart: self.getAlbumArt({artist: jsonResp.similarartists.artist[art].name}, undefined, 'users'),
                uri: "search/artist/" + jsonResp.similarartists.artist[art].name,
            });            
        }		
        //self.logger.info('[LastFM] items: ' + JSON.stringify(rootTree.navigation.lists[0].items));
        defer.resolve(rootTree);
    })
	.fail(function()
	{
		defer.reject(new Error('An error occurred while listing similar artists'));
	});	
	return defer.promise;
};

// Handle getting similar track info
ControllerLastFM.prototype.getSimilarTracks = function(uri) {
	var self = this;
	var defer = libQ.defer();
  
	if(self.lfm != null)
	{
		var call = self.apiCall('track.getsimilar', self.scrobbleData);
		call.then(function(response){
			
			var jsonResp = JSON.parse(response);

			//self.logger.info('[LastFM] items: ' + response);

			var artworkSearchedTrack = self.getAlbumArt(self.scrobbleData, undefined, 'fa fa-music');

			var rootTree = 
			{
				navigation: {
					lists: [
					{
						availableListViews: [
							'grid', 'list'
						],
						items: []
					}],
					prev: {
						uri: 'lastfm'
					},
					info: { 
						uri: "search/any/" + self.scrobbleData.title, 
						title: 'Similar tracks to ' + self.scrobbleData.title + ' by ' + self.scrobbleData.artist, 
						service: 'lastfm', 
						type: 'album', 
						albumart: artworkSearchedTrack 
					} 
				}
			};
			
			if(jsonResp.similartracks.track.length < 1)
				self.commandRouter.pushToastMessage('info', "No results", "The query yielded no results, no similar track could be found for " + self.scrobbleData.artist + ' - ' + self.scrobbleData.title);
			
			var artwork = '';
			
			for (var trk in jsonResp.similartracks.track)
			{	
				//  Hmm, similarTracks does NOT return an album field; so this does not work so well:
				artwork = self.getAlbumArt({artist: jsonResp.similartracks.track[trk].artist.name, album: jsonResp.similartracks.track[trk].album}, undefined, 'fa fa-music');
				rootTree.navigation.lists[0].items.push({
					service: 'lastfm',
					type: 'track',
					title: jsonResp.similartracks.track[trk].name,
					artist: jsonResp.similartracks.track[trk].artist.name,
					mbid: jsonResp.similartracks.track[trk].artist.mbid,
					albumart: artwork,
					uri: "search/any/" + jsonResp.similartracks.track[trk].name
				});
			}
			
			self.logger.info('[LastFM] items: ' + JSON.stringify(rootTree.navigation.lists[0].items));
			defer.resolve(rootTree);
		})
		.fail(function()
		{
			defer.reject(new Error('An error occurred while listing playlists'));
		});
	}
	else
	{
		defer.reject(new Error('No LastFM session key available to use'));
		self.logger.error("[LastFM] plugin is not authenticated, please retry");
	}
	
	return defer.promise;
};

ControllerLastFM.prototype.apiCall = function (method, predicate)
{
	var self = this;
	var defer = libQ.defer();
	var url = 'ws.audioscrobbler.com';
	
	self.checkURL(url)
	.then(function (APIStatus)
	{
		if(APIStatus)
		{
			self.commandRouter.pushToastMessage('info', "Calling LastFM API", "Please standby for results (method: " + method + "), this might take a few seconds.");			
			if(predicate != undefined && predicate.artist != undefined && predicate.title != undefined)
			{
				var query = '';
				switch(method)
				{
					case 'artist.getsimilar':
						query = '/2.0/?method=artist.getsimilar&artist=' + encodeURIComponent(predicate.artist).trim();
						break;
					case 'track.getsimilar':
						query = '/2.0/?method=track.getsimilar&artist=' + encodeURIComponent(predicate.artist).trim() + '&track=' + encodeURIComponent(predicate.title).trim();
						break;
					default:
						query = 'method = ' + method;
						break;
				}
				
				self.logger.info('Method: ' + method + ' | query: ' + query);
				
				if(debugEnabled)
					self.logger.info('[LastFM] Trying to call api with method ' + method + ' and predicate: ' + JSON.stringify(predicate));
				
				http.get({
						host: url,
						port: 80,
						path: query + '&api_key=' + self.config.get('API_KEY') + '&format=json&limit=54'
					}, function(res) {
						var body = '';
						res.on('data', function(chunk) {
							body += chunk;
						});
						res.on('end', function() {
							defer.resolve(body);
						});
					});
			}
			else
				self.logger.info('[LastFM] Predicate not set, could not populate menu for ' + method);
		}
		else
		{
			self.commandRouter.pushToastMessage('error', "Calling LastFM API failed", "Could not reach API, please check your connection and/or log files.");	
			defer.reject(new Error('Unable to test API availability, please check the log file for more context'));
		}
	});
	
	return defer.promise;
};

// Public Methods ---------------------------------------------------------------------------------------

ControllerLastFM.prototype.checkURL = function(url)
{
	var self = this;
	var defer = libQ.defer();
	try
	{
		var options = {method: 'HEAD', host: url, port: 80, path: '/'};
		var req = http.request(options, function(r) {
			if(debugEnabled)
				self.logger.info('[LastFM] URL check (' + url + ') returned code ' + r.statusCode);
			defer.resolve(true);
		});
		req.on('error', function(err) {
			self.logger.error('[LastFM] Webresource (' + url + ') not available. ' + err);
			defer.resolve(false);
		});		
		req.end();
	}
	catch (ex)
	{
		self.logger.error('[LastFM] URL availability check finished with error. ' + ex);
		defer.reject();
	}
	
	return defer.promise;
};

ControllerLastFM.prototype.fetchArtwork = function(mbid)
{
	var self = this;
	var defer = libQ.defer();
	var url = 'webservice.fanart.tv';
	var apikey = '';
	var options = {host: url, port: 80, path: '/v3/music/' + mbid + '&?api_key=' + apikey + '&format=json'};
	
	try
	{
		http.get(options, function(res) {
			var body = '';
			res.on('data', function(chunk) {
				body += chunk;
			});
			res.on('error', function(err) {
				self.logger.error('[LastFM] Artwork lookup failed. ' + err);
			});
			res.on('end', function() {
				self.logger.info(body);
				defer.resolve(body);
			});
		});
	}
	catch (ex)
	{
		self.logger.error('[LastFM] Could not complete artwork lookup. ' + ex);
		defer.reject();
	}
	return defer.promise;
};

ControllerLastFM.prototype.startScrobbleTimer = function(timerLength, state)
{
	var self = this;
	var defer = libQ.defer();
	
	try
    {
        trackStartTime = Math.floor(Date.now() / 1000); // time stamp is seconds
        self.currentTimer.stop();
		self.currentTimer.start(timerLength, function(scrobbler){
			if(debugEnabled)
				self.logger.info('[LastFM] scrobbling from restarted timer.');
            self.scrobble();
			self.currentTimer.stop();
			self.timeToPlay = 0;
		});		
        if (debugEnabled)
            self.logger.info('[LastFM] Timer started with time stamp '+ trackStartTime);
		defer.resolve();
	}
	catch (ex)
	{
		self.logger.error('[LastFM] An error occurred during timer reset; ' + ex);
		self.logger.info('[LastFM] STATE; ' + JSON.stringify(state));
		defer.reject();
	}
		
	return defer.promise;
};



ControllerLastFM.prototype.updateCredentials = function (data)
{
	var self = this;
	var defer = libQ.defer();

	self.config.set('API_KEY', data['API_KEY']);
	self.config.set('API_SECRET', data['API_SECRET']);
	self.config.set('username', data['username']);
	if(data['storePassword'] && data['password'] != undefined && data['password'] != '' && data['password'] != '******')
		self.config.set('password', data['password']);
	self.config.set('authToken', md5(data['username'] + md5(data['password'])));
	
    // Should init new LastFM session after credentials were updated.
    self.sessionRetryAttempt = 0;
    self.initLastFMSession().fail(function () {});
    // To-Do: check that session has started properly...
    defer.resolve();
		
	return defer.promise;
};

ControllerLastFM.prototype.updateScrobbleSettings = function (data)
{
	var self = this;
	var defer=libQ.defer();

	self.config.set('blacklistedServices', data['blacklistedServices']);
	self.config.set('scrobbleThreshold', data['scrobbleThreshold'].value);
	self.config.set('pushToastOnScrobble', data['pushToastOnScrobble']);
	self.config.set('scrobbleFromStream', data['scrobbleFromStream']);
	self.config.set('streamScrobbleThreshold', data['streamScrobbleThreshold']);
	self.config.set('titleSeparator', data['titleSeparator']);
	self.config.set('artistFirst', data['artistFirst']);
	defer.resolve();
	
    self.updateServicesSettings(data);
    self.updateCompositeTitleSettings(data['titleSeparator'], data['artistFirst']);
	self.commandRouter.pushToastMessage('info', "Updated configuration", "Scrobble settings have been updated successfully.");

	return defer.promise;
};

ControllerLastFM.prototype.updateDebugSettings = function (data)
{
	var self = this;
	var defer=libQ.defer();

    debugEnabled = data['enable_debug_logging'];
	self.config.set('enable_debug_logging', debugEnabled);
	defer.resolve();
	// for debugging
    self.logger.info('[LastFM] Socket connected? ' + socket.connected);
	self.commandRouter.pushToastMessage('success', "Saved settings", "Successfully saved debug settings.");

	return defer.promise;
};

ControllerLastFM.prototype.updateCompositeTitleSettings = function (titleSeparator, artistFirst)
{
	var self = this;

    if (artistFirst) {
        compositeTitle = {
            separator: titleSeparator,
            indexOfArtist: 0,
            indexOfTitle: 1
        }
    } else {
        compositeTitle = {
            separator: titleSeparator,
            indexOfArtist: 1,
            indexOfTitle: 0
        }
    }
	if (debugEnabled)
            self.logger.info('[LastFM] Updated composite title settings to: ' + JSON.stringify(compositeTitle));

	return libQ.resolve();
};

ControllerLastFM.prototype.updateServicesSettings = function (data)
{
	var self = this;
    blacklistedServices = data['blacklistedServices'].split(',').map(b => b.trim()); // trim white spaces
    scrobbleThresholdSong = data['scrobbleThreshold'].value*10;  // Multiplier for song duration that also performs conversion from s to ms
    scrobbleThresholdStream = data['streamScrobbleThreshold'] * 1000;  // Convert from s to ms
    
    if (debugEnabled)
	{
        self.logger.info('[LastFM] blacklisted services: ' + JSON.stringify(blacklistedServices));
        self.logger.info('[LastFM] Threshold values. Song: ' + scrobbleThresholdSong + ', stream: ' + scrobbleThresholdStream);
	}
	return libQ.resolve();
};

ControllerLastFM.prototype.initScrobbleSettings = function ()
{
	var self = this;

    // Get the config settings in a suitable format:
    const data = {
        'blacklistedServices' : self.config.get('blacklistedServices'),
        'scrobbleThreshold' : { 'value' : self.config.get('scrobbleThreshold') },
        'pushToastOnScrobble' : self.config.get('pushToastOnScrobble'),
        'scrobbleFromStream' :	self.config.get('scrobbleFromStream'),
        'streamScrobbleThreshold' : self.config.get('streamScrobbleThreshold')
    };
    return self.updateServicesSettings(data);
};

// Scrobble Methods -------------------------------------------------------------------------------------

ControllerLastFM.prototype.checkStateUpdate = function (state) {
    var self = this;
    var defer = libQ.defer(); 

    // Create the timer object if it does not exist yet
	if (blacklistedServices.indexOf(state.service) != -1) {
		if (debugEnabled)
			self.logger.info(`[LastFM] not processing song, because ${state.service} is blacklisted.`);
	}
	else {
		if (!self.currentTimer) {
			self.currentTimer = new pTimer(self.context, debugEnabled);
			if (debugEnabled)
				self.logger.info('[LastFM] created new timer object');
		}
		else {
			if (debugEnabled)
				self.logger.info('[LastFM] using existing timer');
		}

		var scrobbleThresholdInMilliseconds = 0;
		// The state object contains enough information to determine if a service is a 'neverending stream'
		if (state.stream === true)
			scrobbleThresholdInMilliseconds = scrobbleThresholdStream;
		else {
			if ((state.duration != null) && (state.duration > 30)){ // Just to make sure it is always defined!
				scrobbleThresholdInMilliseconds = state.duration * scrobbleThresholdSong;
			}
			else
			{
				if (debugEnabled)
					self.logger.info('[LastFM] Undefined track duration or too short for scrobbling: ' + state.duration + ', ' + scrobbleThresholdInMilliseconds);
			}
		}    

		if (debugEnabled) {
			self.logger.info('--------------------------------------------------------------------// [LastFM] new state has been pushed; status: ' + state.status + ' | service: ' + state.service + ' | duration: ' + state.duration + ' | title: ' + state.title + ' | previous title: ' + self.previousState.title);
			if (self.currentTimer)
				self.logger.info('=================> [timer] is active: ' + self.currentTimer.isActive + ' | can continue: ' + self.currentTimer.canContinue + ' | timer started at: ' + self.currentTimer.timerStarted);
		}
	}
	
    // Scrobble from all services, or at least try to -> improves forward compatibility | I did add blacklist functionality, however ;)
	if (state.status == 'play' && blacklistedServices.indexOf(state.service) == -1)
	{
        if (debugEnabled)
            self.logger.info('[LastFM] Playback detected, evaluating parameters for scrobbling...');

        if (self.previousState.artist == state.artist && self.previousState.title == state.title)
		{
            // Same track as in previous state;
            // only need updating srobble settings if
            // 1. restarted song a paused song
            // 2. updated duration
            if(self.currentTimer.canContinue && self.timeToPlay > 0)
            {
                if(debugEnabled)
                    self.logger.info('[LastFM] Continuing scrobbling of paused song, starting new timer for the remainder of ' + self.timeToPlay + ' milliseconds [' + state.artist + ' - ' + state.title + '].');
                self.startScrobbleTimer(self.timeToPlay, state);
            }					
            else if (state.duration != self.previousState.duration)
            {   // Duration has changed, for the same song. Needed for example for airplay:
                // Airplay fix, the duration is propagated at a later point in time
                if (self.currentTimer.isActive)
				{
                    var addition = (state.duration - self.previousState.duration) * scrobbleThresholdSong;
                    self.logger.info('[LastFM] updating timer, previous duration is obsolete; adding ' + addition + ' milliseconds.');
                    self.currentTimer.addMilliseconds(addition, function(scrobbler){							
                            self.scrobble();
                            self.currentTimer.stop();
                            self.timeToPlay = 0;
                        });	
                }
				else
				{
                    if (scrobbleThresholdInMilliseconds > 0)
					{
                        // Should be the case if scrobbling from the active service has been enabled
                        if (self.formatScrobbleData(state)) // enough metadata to be able to scrobble the track
						{
                            self.updateNowPlaying();
                            if (debugEnabled)
                                self.logger.info('[LastFM] starting new timer for ' + scrobbleThresholdInMilliseconds + ' milliseconds [' + state.artist + ' - ' + state.title + '].');
                            self.startScrobbleTimer(scrobbleThresholdInMilliseconds, state);
                        }
                    }	
                } 
            }
            else 
			{
                if (debugEnabled)
                    self.logger.info('[LastFM] Same state as the one previously pushed. No need to do anything...');                                    
            }
       }
       else
	   {
            // Track has changed, so definitely need to do something!
            if (scrobbleThresholdInMilliseconds > 0) {
                // Should be the case if scrobbling from the active service has been enabled
                if (self.formatScrobbleData(state)) { // Enough metadata to be able to scrobble the track
                    self.updateNowPlaying();
                    if (debugEnabled)
                        self.logger.info('[LastFM] starting new timer for ' + scrobbleThresholdInMilliseconds + ' milliseconds [' + state.artist + ' - ' + state.title + '].');
                    self.startScrobbleTimer(scrobbleThresholdInMilliseconds, state);
                }
            }
        }
        // set state as the new previous state
        self.previousState = state;
    }
    else if (state.status == 'pause')
	{
        if (debugEnabled)
            self.logger.info('[LastFM] Song has been paused, so also pausing timer.');
        if (self.currentTimer.isActive)
            self.timeToPlay = self.currentTimer.pause();
    }
    else if (state.status == 'stop')
	{
        if (self.currentTimer.isActive)
		{
            if (debugEnabled)
                self.logger.info('[LastFM] stopping timer, playback has ended.');
            self.currentTimer.stop();
        }
        self.timeToPlay = 0;
    }

    // Set state as the new previous state
    // DON'T do this here any more: only update when song is actually playing (because sometimes songs first appear as stopped before starting...
    //self.previousState = state;
    return defer.promise;
};

ControllerLastFM.prototype.formatScrobbleData = function (state)
{
	var self = this;
    var defer = libQ.defer();
    var success = true;
	
    var artist = state.artist;
    var title = state.title;
    var album = state.album == null ? '' : state.album

    // Assumes that title is always defined! This is _probably_ true
    if (!state.artist || (state.stream === true && state.title.includes(compositeTitle.separator)))  // Artist field empty (often the case for streams) or service is a stream and title contains separator (surrounded by spaces)
	{
        if (state.title.indexOf(compositeTitle.separator) > -1) // Check if the title can be split into artist and actual title:
		{
            try
			{
                var info = state.title.split(compositeTitle.separator);
                artist = info[compositeTitle.indexOfArtist].trim();
                title = info[compositeTitle.indexOfTitle].trim();
                self.logger.info('[LastFM] Split composite title into artist: ' + artist + ' and title: ' + title);
                if (!artist)
				{
                    success = false;
                    self.logger.info('[LastFM] Current track does not have sufficient metadata: Missing artist. Failed to split composite title ' + state.title);
                }
            }
            catch (ex)
			{
                success = false;
                self.logger.info('[LastFM] Current track does not have sufficient metadata: Missing artist. Failed to split composite title ' + state.title);
                self.logger.error('[LastFM] An error occurred during parse; ' + ex);
                self.logger.info('[LastFM] STATE; ' + JSON.stringify(state));
            }
        }
        else
		{
            success = false;
            self.logger.info('[LastFM] Current track does not have sufficient metadata: Missing artist. Not a composite title! ' + state.title);
        }
    }
    else
	{
        self.logger.info('[LastFM] Current track has sufficient metadata: title (' + title + ') and artist (' + artist + ') passed on explicitly');
    }
    if (success) // Update scrobbleData variable (otherwise leave it unchanged)
	{
        self.scrobbleData.artist = artist;
        self.scrobbleData.title = title;
        self.scrobbleData.album = album;
        self.scrobbleData.duration = state.duration;
    }
    self.scrobblableTrack = success;
	return success;
};

// Delays between automatic re-authentication attempts after a failure (ms).
// The last value is repeated for every further attempt.
ControllerLastFM.SESSION_RETRY_DELAYS_MS = [30000, 60000, 120000, 300000, 900000, 1800000];
// An attempt that has not answered after this long is considered lost.
ControllerLastFM.SESSION_ATTEMPT_TIMEOUT_MS = 60000;
// Minimum time between two attempts triggered by playback.
ControllerLastFM.SESSION_MIN_INTERVAL_MS = 30000;
// Scrobbles kept while there is no session (Last.fm accepts them up to 14 days late).
ControllerLastFM.MAX_PENDING_SCROBBLES = 50;

ControllerLastFM.prototype.initLastFMSession = function () {
    var self = this;
	var defer = libQ.defer();

    var msg = '';

    // A new attempt replaces any retry that was still scheduled.
    self.clearSessionRetry();

    if (
        (self.config.get('API_KEY') != '') &&
        (self.config.get('API_SECRET') != '') &&
        (self.config.get('username') != '') &&
        (self.config.get('authToken') != '')
    )
	{
        if (debugEnabled)
            self.logger.info('[LastFM] trying to authenticate...');

        var generation = ++self.sessionGeneration;
        self.authenticating = true;
        self.authStartedAt = Date.now();

        var client = new lastfm({
            api_key: self.config.get('API_KEY'),
            api_secret: self.config.get('API_SECRET'),
            username: self.config.get('username'),
            authToken: self.config.get('authToken')
        });
        self.lfm = client;

        client.getSessionKey(function (result)
		{
            // Answer from an attempt that was replaced in the meantime
            // (credentials saved again, plugin stopped, timed-out attempt): ignore it.
            if (generation !== self.sessionGeneration || self.stopped)
                return;
            self.authenticating = false;

            if (result.success && client.session_key)
			{
                if (self.sessionRetryAttempt > 0)
                    self.logger.info('[LastFM] authenticated after ' + self.sessionRetryAttempt + ' retry(s)');
                self.sessionRetryAttempt = 0;
                self.commandRouter.pushToastMessage('success', 'LastFM connection', 'Authenticated successfully with LastFM.');
                if (debugEnabled)
                    self.logger.info('[LastFM] authenticated successfully!');
                self.flushPendingScrobbles();
                defer.resolve('Authenticated successfully!');
            }
            else
			{
                msg = 'Error: ' + (result.error || 'no session key returned');
                // Only the first failure of a series is shown in the UI, retries are only logged.
                if (self.sessionRetryAttempt == 0)
                    self.commandRouter.pushToastMessage('error', 'LastFM connection failed', msg);
                self.logger.error('[LastFM] ' + msg);
                self.scheduleSessionRetry();
                defer.reject(msg);
            }
        });
    }
    else
	{
        // Configuration errors: nothing to retry until the user saves the settings.
        self.authenticating = false;
        msg = 'Configuration parameters missing:';
        if (self.config.get('API_KEY') == '')
            msg += '  "API_KEY"';
        if (self.config.get('API_SECRET') == '')
            msg += '  "API_SECRET"';
        if (self.config.get('username') == '')
            msg += '  "username"';
        if (self.config.get('authToken') == '')
            msg += '  "authToken"';
        self.commandRouter.pushToastMessage('error', 'LastFM connection failed', msg);
        self.logger.info('[LastFM] ' + msg);
        defer.reject(msg);
    }
    return defer.promise;
};

ControllerLastFM.prototype.hasLastFMSession = function ()
{
    var self = this;
    return self.lfm != null && !self.authenticating && !!self.lfm.session_key;
};

ControllerLastFM.prototype.clearSessionRetry = function ()
{
    var self = this;
    if (self.sessionRetryTimer)
    {
        clearTimeout(self.sessionRetryTimer);
        self.sessionRetryTimer = null;
    }
};

ControllerLastFM.prototype.scheduleSessionRetry = function ()
{
    var self = this;
    if (self.stopped)
        return;
    self.clearSessionRetry();
    var delays = ControllerLastFM.SESSION_RETRY_DELAYS_MS;
    var delay = delays[Math.min(self.sessionRetryAttempt, delays.length - 1)];
    self.sessionRetryAttempt++;
    self.logger.info('[LastFM] will retry authentication in ' + Math.round(delay / 1000) + 's (attempt ' + self.sessionRetryAttempt + ')');
    self.sessionRetryTimer = setTimeout(function ()
    {
        self.sessionRetryTimer = null;
        self.initLastFMSession().fail(function () {});
    }, delay);
};

// Called when playback needs a session: authenticate now unless an attempt is
// already running or one was made very recently (the scheduled retry covers that).
// forceReauth: Last.fm rejected the current session key, get a new one.
ControllerLastFM.prototype.ensureLastFMSession = function (forceReauth)
{
    var self = this;
    if (self.stopped || self.lfm == null)
        return;
    if (!forceReauth && self.hasLastFMSession())
        return;
    var sinceLastAttempt = Date.now() - self.authStartedAt;
    if (self.authenticating && sinceLastAttempt < ControllerLastFM.SESSION_ATTEMPT_TIMEOUT_MS)
        return;
    if (!self.authenticating && sinceLastAttempt < ControllerLastFM.SESSION_MIN_INTERVAL_MS)
    {
        // Too soon for a new attempt: make sure one is at least scheduled.
        if (!self.sessionRetryTimer)
            self.scheduleSessionRetry();
        return;
    }
    self.logger.info('[LastFM] no valid session, re-authenticating');
    self.initLastFMSession().fail(function () {});
};

ControllerLastFM.prototype.isInvalidSessionError = function (error)
{
    return typeof error == 'string' && /invalid session key/i.test(error);
};

ControllerLastFM.prototype.queueScrobble = function (data)
{
    var self = this;
    self.pendingScrobbles.push(data);
    if (self.pendingScrobbles.length > ControllerLastFM.MAX_PENDING_SCROBBLES)
    {
        var dropped = self.pendingScrobbles.shift();
        self.logger.error('[LastFM] too many pending scrobbles, dropped: ' + dropped.artist + ' - ' + dropped.title);
    }
    self.logger.info('[LastFM] scrobble queued until LastFM session is available: ' + data.artist + ' - ' + data.title + ' (' + self.pendingScrobbles.length + ' pending)');
};

ControllerLastFM.prototype.flushPendingScrobbles = function ()
{
    var self = this;
    if (self.pendingScrobbles.length == 0)
        return;
    var queue = self.pendingScrobbles;
    self.pendingScrobbles = [];
    self.logger.info('[LastFM] sending ' + queue.length + ' pending scrobble(s)');
    queue.forEach(function (data) { self.sendScrobble(data); });
};

ControllerLastFM.prototype.sendScrobble = function (data)
{
    var self = this;
    self.lfm.scrobbleTrack({
        artist: data.artist,
        track: data.title,
        album: data.album,
        timestamp: data.timestamp,
        callback: function(result)
        {
            var album = (data.album == undefined || data.album == '') ? '[unknown album]' : data.album;
            if (result.success)
            {
                if (self.config.get('pushToastOnScrobble'))
                    self.commandRouter.pushToastMessage('success', 'Scrobble succesful', 'Scrobbled: ' + data.artist + ' - ' + data.title + ' (' + album + ').');
                if (debugEnabled)
                    self.logger.info('[LastFM] Scrobble successful for: ' + data.artist + ' - ' + data.title + ' (' + album + ').');
            }
            else
            {
                console.log("in callback, finished: ", result);
                // Session rejected by Last.fm: keep the scrobble, get a new session, send it again.
                if (self.isInvalidSessionError(result.error) && (data.attempts || 0) < 2)
                {
                    data.attempts = (data.attempts || 0) + 1;
                    self.logger.info('[LastFM] session rejected by LastFM, re-authenticating before retrying the scrobble');
                    self.queueScrobble(data);
                    self.ensureLastFMSession(true);
                    return;
                }
                if (self.config.get('pushToastOnScrobble'))
                    self.commandRouter.pushToastMessage('error', 'Scrobble failed', 'Tried to scrobbled: ' + data.artist + ' - ' + data.title + ' (' + album + ').');
                if (debugEnabled)
                    self.logger.info('[LastFM] Scrobble failed for: ' + data.artist + ' - ' + data.title + ' (' + album + ').');
            }
        }
    });
};


ControllerLastFM.prototype.updateNowPlaying = function ()
{
	var self = this;
	var defer = libQ.defer();
	if(debugEnabled)
		self.logger.info('[LastFM] Updating now playing');

    if (self.scrobblableTrack && self.lfm != null) {
        self.updatingNowPlaying = true;

        // Try to fetch track info
        self.lfm.getTrackInfo({
            artist: self.scrobbleData.artist,
            track: self.scrobbleData.title,
            autocorrect: 1,
            callback: function (result)
			{
                if (result.success)
				{
                    // Display results to start with
                    self.logger.info('[LastFM] track info: ' + JSON.stringify(result));
                    if (result.trackInfo.duration != undefined)
					{
                        if (self.scrobbleData.duration == 0)
						{
                            self.scrobbleData.duration = result.trackInfo.duration;
                            self.logger.info('[LastFM] Updated missing track duration: ' + result.trackInfo.duration);
                        }
                    }
                    if (!self.scrobbleData.album && (result.trackInfo.album != undefined) && (result.trackInfo.album.title != undefined))
					{
                        self.scrobbleData.album = result.trackInfo.album.title;
                        self.logger.info('[LastFM] Updated missing track album: ' + self.scrobbleData.album);
                    }
                }
                else
                    self.logger.error('[LastFM] track info request failed with error: ' + result.error);
            }
        });

        // Used to notify Last.fm that a user has started listening to a track. Parameter names are case sensitive.
        // It needs a session key: without one Last.fm answers "missing a required parameter".
        if (!self.hasLastFMSession())
        {
            self.logger.info('[LastFM] no valid session, "now playing" update skipped');
            self.updatingNowPlaying = false;
            self.ensureLastFMSession();
            return defer.promise;
        }
        self.lfm.scrobbleNowPlayingTrack({
            artist: self.scrobbleData.artist,
            track: self.scrobbleData.title,
            album: self.scrobbleData.album,
            duration: self.scrobbleData.duration,
            callback: function (result)
			{
                if (!result.success)
                {
                    console.log('[LastFM] updated "now playing" failed: ', result);
                    if (self.isInvalidSessionError(result.error))
                        self.ensureLastFMSession(true);
                }
                else
				{
                    if (debugEnabled)
                        self.logger.info('[LastFM] updated "now playing" | artist: ' + self.scrobbleData.artist + ' | title: ' + self.scrobbleData.title);
                }
                self.updatingNowPlaying = false;
            }
        });
    }
	else
	{
		defer.reject(new Error('No LastFM session key available to use, or track info could not be determined'));
		self.logger.error("[LastFM] plugin is not authenticated, please retry, or track info could not be determined (very rare)");
	}
	return defer.promise;
};

ControllerLastFM.prototype.scrobble = function ()
{
	var self = this;
	var defer = libQ.defer();
	
	if(debugEnabled)
	{
		self.logger.info('[LastFM] checking previously scrobbled song...');
		self.logger.info('[LastFM] previous scrobble: ' + JSON.stringify(self.previousScrobble));
	}
		
	if (self.scrobblableTrack && self.lfm != null)
	{					
		if(debugEnabled)
			self.logger.info('[LastFM] preparing to scrobble...');

		var data = {
			artist: self.scrobbleData.artist,
			title: self.scrobbleData.title,
			album: self.scrobbleData.album,
			timestamp: trackStartTime,
			attempts: 0
		};
		if (self.hasLastFMSession())
			self.sendScrobble(data);
		else
		{
			// No session (e.g. authentication failed at boot): keep the scrobble and send it once authenticated.
			self.queueScrobble(data);
			self.ensureLastFMSession();
		}
		self.previousScrobble.artist = self.scrobbleData.artist;
        self.previousScrobble.title = self.scrobbleData.title;
        self.previousScrobble.scrobbleTime = trackStartTime;
	}
	else
	{
		defer.reject(new Error('LastFM is not initialized, please retry authenticating'));
		self.logger.error("[LastFM] plugin is not authenticated, please retry");
	}
	return defer.promise;
};

function md5(string) {
	return crypto.createHash('md5').update(string, 'utf8').digest("hex");
}

ControllerLastFM.prototype.clearScrobbleMemory = function (remainingtimeToPlay)
{
	var self = this;
	self.memoryTimer = setInterval(function(clear)
	{
		self.previousScrobble.artist = '';
		self.previousScrobble.title = '';
	}
	, remainingtimeToPlay);
}
