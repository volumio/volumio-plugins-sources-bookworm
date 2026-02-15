'use strict';

const libQ = require('kew');
const dns = require('dns');
const exec = require('child_process').exec;

const RoonApi = require('node-roon-api');
const RoonApiTransport = require('node-roon-api-transport');
const RoonApiImage = require('node-roon-api-image');
const RoonApiBrowse = require('node-roon-api-browse');
const RoonApiVolumeControl = require('node-roon-api-volume-control');

const { PLUGIN_VERSION, STATE_DEBOUNCE_MS, FAST_RECONNECT_DELAY_MS, RECONNECT_CHECK_DELAY_MS,
	SEEK_PUSH_THRESHOLD_MS, TRACK_CHANGE_GUARD_MS, STATE_MAP } = require('./lib/constants');
const helpers = require('./lib/helpers');

let globalRoonApi = null;
let globalRoonApiStarting = false;
let globalRoonCore = null;
let currentPluginInstance = null;

function getCurrentInstance() { return currentPluginInstance; }

module.exports = metaroon;

function metaroon(context) {
	this.context = context;
	this.commandRouter = context.coreCommand;
	this.logger = context.logger;
	this.configManager = context.configManager;
	this.lastStateChangeTime = 0;
	this.reconnectTimer = null;
	this.connectionLostTime = null;
}

require('./lib/browse').attach(metaroon.prototype);
require('./lib/search').attach(metaroon.prototype);
require('./lib/transport').attach(metaroon.prototype);
require('./lib/volume').attach(metaroon.prototype, getCurrentInstance);

metaroon.prototype.onVolumioStart = function() {
	try {
		var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
		this.config = new (require('v-conf'))();
		this.config.loadFile(configFile);
	} catch (e) {
		this.logger.error('metaroon: Error loading config: ' + e.message);
	}
	return libQ.resolve();
};

metaroon.prototype.getConfigurationFiles = function() { return ['config.json']; };

metaroon.prototype.onStart = function() {
	var self = this;
	var defer = libQ.defer();

	self.logger.info('metaroon: Starting plugin v' + PLUGIN_VERSION);

	self.state = {
		status: 'stop', service: 'metaroon', title: '', artist: '', album: '',
		albumart: '/albumart', uri: '', trackType: 'roon', seek: 0, duration: 0,
		samplerate: '', bitdepth: '', channels: 2, random: false, repeat: false,
		repeatSingle: false, disableUiControls: false
	};

	self.roonCore = null;
	self.roonCoreHost = null;
	self.roonTransport = null;
	self.roonImage = null;
	self.roonBrowse = null;
	self.roonVolumeControl = null;
	self.volumeControlInstance = null;
	self.zoneId = null;
	self.zoneName = null;
	self.outputId = null;
	self.isActive = false;
	self.isVolatile = false;
	self.availableZones = [];
	self.queueItems = [];
	self.browseHierarchy = 'browse';
	self.browseLevel = 0;
	self.browseSourceAdded = false;
	self.currentBrowseListImage = null;

	self.selectedZoneId = self.config.get('selectedZoneId');
	self._loadI18nStrings();

	if (self.commandRouter.stateMachine.isVolatile) {
		self.logger.info('metaroon: Clearing stale volatile from previous session');
		try { self.commandRouter.stateMachine.unSetVolatile(); } catch (e) { /* ignore */ }
	}

	self._startRoonBridgeService().then(function() {
		try { self._startRoonApi(); } catch (e) { self.logger.error('metaroon: Error starting Roon API: ' + e.message); }
		defer.resolve();
	}).fail(function(err) {
		self.logger.warn('metaroon: RoonBridge service start issue: ' + err);
		try { self._startRoonApi(); } catch (e) { self.logger.error('metaroon: Error starting Roon API: ' + e.message); }
		defer.resolve();
	});

	return defer.promise;
};

metaroon.prototype.onStop = function() {
	var self = this;
	var defer = libQ.defer();

	self.logger.info('metaroon: Stopping plugin');

	if (self.reconnectTimer) { clearTimeout(self.reconnectTimer); self.reconnectTimer = null; }
	if (self.fastReconnectTimer) { clearTimeout(self.fastReconnectTimer); self.fastReconnectTimer = null; }

	if (self.isActive) self._stopPlayback();

	try { self.commandRouter.volumioRemoveToBrowseSources('Roon'); } catch (e) { /* ignore */ }
	self.browseSourceAdded = false;

	if (currentPluginInstance === self) currentPluginInstance = null;

	self.unregisterVolumeControl();
	helpers.invalidateHwParamsCache();

	self.roonApi = null;
	self.roonCore = null;
	self.roonTransport = null;
	self.roonImage = null;
	self.roonBrowse = null;
	self.roonVolumeControl = null;

	self._stopRoonBridgeService().then(function() { defer.resolve(); }).fail(function() { defer.resolve(); });
	return defer.promise;
};

metaroon.prototype.onRestart = function() {
	var self = this;
	return self.onStop().then(function() { return self.onStart(); });
};

metaroon.prototype._startRoonBridgeService = function() {
	var self = this;
	var defer = libQ.defer();
	exec('/usr/bin/sudo /bin/systemctl start roonbridge.service', { uid: 1000, gid: 1000 }, function(error) {
		if (error) { self.logger.warn('metaroon: Could not start RoonBridge: ' + error.message); defer.reject(error); }
		else { self.logger.info('metaroon: RoonBridge service started'); defer.resolve(); }
	});
	return defer.promise;
};

metaroon.prototype._stopRoonBridgeService = function() {
	var self = this;
	var defer = libQ.defer();
	exec('/usr/bin/sudo /bin/systemctl stop roonbridge.service', { uid: 1000, gid: 1000 }, function(error) {
		if (error) { self.logger.warn('metaroon: Could not stop RoonBridge: ' + error.message); defer.reject(error); }
		else { self.logger.info('metaroon: RoonBridge service stopped'); defer.resolve(); }
	});
	return defer.promise;
};

metaroon.prototype._startRoonApi = function() {
	var self = this;
	currentPluginInstance = self;

	if (globalRoonApiStarting) { self.logger.info('metaroon: Roon API already starting'); return; }

	if (globalRoonApi) {
		self.logger.info('metaroon: Reusing existing Roon API');
		self.roonApi = globalRoonApi;
		if (globalRoonCore) {
			self.roonCore = globalRoonCore;
			self.roonTransport = globalRoonCore.services.RoonApiTransport;
			self.roonImage = globalRoonCore.services.RoonApiImage;
			self.roonBrowse = globalRoonCore.services.RoonApiBrowse;
			self.roonCoreHost = helpers.extractRoonCoreIP(globalRoonCore) || globalRoonCore.display_name;
			if (self.roonTransport) self.roonTransport.subscribe_zones(function(r, m) { self._handleZoneUpdate(r, m); });
			if (self.roonBrowse && !self.browseSourceAdded) self.addToBrowseSources();
		}
		return;
	}

	globalRoonApiStarting = true;
	self.logger.info('metaroon: Creating new Roon API instance');

	self.roonApi = new RoonApi({
		extension_id: 'com.volumio.metaroon',
		display_name: 'Volumio Roon Bridge',
		display_version: PLUGIN_VERSION,
		publisher: 'Volumio Community',
		email: 'plugins@volumio.com',

		moo_onerror: function() {
			var inst = currentPluginInstance || self;
			inst.logger.warn('metaroon: Websocket error');
			inst.connectionErrors = (inst.connectionErrors || 0) + 1;
		},

		core_paired: function(core) {
			var inst = currentPluginInstance || self;
			inst.logger.info('metaroon: Roon Core paired: ' + core.display_name);

			globalRoonCore = core;
			if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
			if (inst.fastReconnectTimer) { clearTimeout(inst.fastReconnectTimer); inst.fastReconnectTimer = null; }
			inst.connectionLostTime = null;
			inst.connectionErrors = 0;

			inst.roonCore = core;
			inst.roonTransport = core.services.RoonApiTransport;
			inst.roonImage = core.services.RoonApiImage;
			inst.roonBrowse = core.services.RoonApiBrowse;

			if (inst.isActive && !inst.commandRouter.stateMachine.isVolatile) inst._setVolatileMode(inst.state.status);

			var ip = helpers.extractRoonCoreIP(core);
			if (!ip) {
				dns.lookup(core.display_name, function(err, addr) { if (!err && addr) (currentPluginInstance || inst).roonCoreHost = addr; });
				inst.roonCoreHost = core.display_name;
			} else {
				inst.roonCoreHost = ip;
			}

			if (inst.roonBrowse && !inst.browseSourceAdded) inst.addToBrowseSources();
			inst.roonTransport.subscribe_zones(function(r, m) { (currentPluginInstance || inst)._handleZoneUpdate(r, m); });
			inst.registerVolumeControl();
		},

		core_unpaired: function() {
			var inst = currentPluginInstance || self;
			inst.logger.info('metaroon: Roon Core unpaired');

			globalRoonCore = null;
			inst.roonCore = null;
			inst.roonTransport = null;
			inst.roonImage = null;
			inst.roonBrowse = null;
			inst.unregisterVolumeControl();

			if (!inst.connectionLostTime) inst.connectionLostTime = Date.now();

			if (!inst.fastReconnectTimer && inst.roonApi && inst.roonApi._sood) {
				inst.fastReconnectTimer = setTimeout(function() {
					var i = currentPluginInstance || inst;
					i.fastReconnectTimer = null;
					if (!i.roonCore && i.roonApi && i.roonApi._sood) {
						try { i.roonApi._sood.query({ query_service_id: "00720724-5143-4a9b-abac-0e50cba674bb" }); } catch (e) { /* ignore */ }
					}
				}, FAST_RECONNECT_DELAY_MS);
			}

			if (!inst.reconnectTimer && inst.isActive) {
				inst.reconnectTimer = setTimeout(function() {
					var i = currentPluginInstance || inst;
					i.reconnectTimer = null;
					if (!i.roonCore && i.isActive) i._stopPlayback();
				}, RECONNECT_CHECK_DELAY_MS);
			}
		}
	});

	globalRoonApi = self.roonApi;
	self.roonVolumeControl = new RoonApiVolumeControl(self.roonApi);
	globalRoonApiStarting = false;

	self.roonApi.init_services({
		required_services: [RoonApiTransport, RoonApiImage],
		optional_services: [RoonApiBrowse],
		provided_services: [self.roonVolumeControl]
	});

	self.logger.info('metaroon: Starting Roon discovery');
	self.roonApi.start_discovery();
};

metaroon.prototype._handleZoneUpdate = function(response, msg) {
	var self = this;
	if (!response || (response !== 'Subscribed' && response !== 'Changed')) return;

	var zones = (msg && msg.zones) || (msg && msg.zones_changed) || (msg && msg.zones_added);
	if (zones && zones.length > 0) {
		self._updateAvailableZones(zones);
		if (!self.zoneId) self._identifyZone(zones);
		if (self.zoneId) {
			var zone = zones.find(function(z) { return z.zone_id === self.zoneId; });
			if (zone) self._updateFromZone(zone);
		}
	}

	if (msg && msg.zones_seek_changed && self.isActive) {
		var seekZone = msg.zones_seek_changed.find(function(z) { return z.zone_id === self.zoneId; });
		if (seekZone) self._updateSeek(seekZone.seek_position);
	}
};

metaroon.prototype._updateAvailableZones = function(zones) {
	this.availableZones = zones.map(function(z) {
		return {
			zone_id: z.zone_id, display_name: z.display_name,
			outputs: (z.outputs || []).map(function(o) {
				return { output_id: o.output_id, display_name: o.display_name };
			})
		};
	});
};

metaroon.prototype._identifyZone = function(zones) {
	var target = null;
	if (this.selectedZoneId) target = zones.find(function(z) { return z.zone_id === this.selectedZoneId; }.bind(this));
	if (!target && zones.length > 0) target = zones[0];
	if (target) this._setZone(target);
};

metaroon.prototype._setZone = function(zone) {
	this.zoneId = zone.zone_id;
	this.zoneName = zone.display_name;
	this.outputId = zone.outputs && zone.outputs[0] ? zone.outputs[0].output_id : null;
	this.logger.info('metaroon: Zone set: ' + this.zoneName);
	if (this.roonTransport && this.roonTransport.subscribe_queue) this._subscribeToQueue();
	if (this.outputId && !this.volumeControlInstance) this.registerVolumeControl();
};

metaroon.prototype._subscribeToQueue = function() {
	var self = this;
	if (!self.zoneId) return;
	try {
		self.roonTransport.subscribe_queue(self.zoneId, 50, function(response, msg) {
			if ((response === 'Subscribed' || response === 'Changed') && msg.changes && msg.changes.tracks) {
				self.queueItems = msg.changes.tracks;
				self._pushQueueToVolumio();
			}
		});
	} catch (e) { /* ignore */ }
};

metaroon.prototype._pushQueueToVolumio = function() {
	var self = this;
	if (!self.isActive || !self.queueItems || self.queueItems.length === 0) return;
	try {
		var queue = self.queueItems.map(function(track) {
			return {
				service: 'metaroon', type: 'song',
				title: (track.three_line && track.three_line.line1) || 'Unknown',
				artist: (track.three_line && track.three_line.line2) || '',
				album: (track.three_line && track.three_line.line3) || '',
				albumart: track.image_key ? helpers.getRoonImageUrl(self.roonCoreHost, track.image_key, 200, 200) : '/albumart',
				uri: 'roon/queue/' + (track.queue_item_id || ''),
				duration: track.length || 0, trackType: 'roon'
			};
		});
		self.commandRouter.addQueueItems(queue);
	} catch (e) {
		self.logger.warn('metaroon: Error pushing queue: ' + e.message);
	}
};

metaroon.prototype._updateFromZone = function(zone) {
	var self = this;
	var isPlaying = zone.state === 'playing';
	var isPaused = zone.state === 'paused';
	var isStopped = zone.state === 'stopped';
	var hasNP = zone.now_playing && zone.now_playing.three_line;

	if (zone.state === 'loading') return;

	var now = Date.now();
	if (now - self.lastStateChangeTime < STATE_DEBOUNCE_MS) {
		if (self.isActive && hasNP) self._updateMetadata(zone);
		return;
	}

	if (isPlaying && !self.isActive) {
		self.lastStateChangeTime = now;
		if (hasNP) self._populateMetadata(zone);
		self._startPlayback();
	} else if (isPaused && hasNP && !self.isActive) {
		self.lastStateChangeTime = now;
		self._populateMetadata(zone);
		self._startPlaybackPaused();
	} else if (isStopped && self.isActive) {
		if (self.trackChangeInProgress) { self.logger.info('metaroon: Ignoring stopped during track change'); return; }
		self.lastStateChangeTime = now;
		self._stopPlayback();
	} else if (self.isActive && !self.commandRouter.stateMachine.isVolatile && (isPlaying || isPaused)) {
		self._setVolatileMode();
	}

	if (self.isActive && hasNP) self._updateMetadata(zone);
};

metaroon.prototype._populateMetadata = function(zone) {
	var np = zone.now_playing;
	this.state.title = (np && np.three_line && np.three_line.line1) || '';
	this.state.artist = (np && np.three_line && np.three_line.line2) || '';
	this.state.album = (np && np.three_line && np.three_line.line3) || '';
	this.state.seek = ((np && np.seek_position) || 0) * 1000;
	this.state.duration = (np && np.length) || 0;
	if (np && np.image_key) this.state.albumart = helpers.getRoonImageUrl(this.roonCoreHost, np.image_key, 500, 500);
};

metaroon.prototype._startPlayback = function() {
	this.logger.info('metaroon: Starting playback');
	this.isActive = true;
	if (!this.isVolatile) {
		this.state.status = 'play';
		this._setVolatileMode();
		this.commandRouter.stateMachine.currentStatus = 'play';
		this.pushState();
	}
};

metaroon.prototype._startPlaybackPaused = function() {
	this.logger.info('metaroon: Starting playback (paused)');
	this.isActive = true;
	this.state.status = 'pause';
	this._setVolatileMode();
	this.commandRouter.stateMachine.currentStatus = 'pause';
	this.pushState();
};

metaroon.prototype._stopPlayback = function() {
	this.logger.info('metaroon: Stopping playback');
	this.isActive = false;
	this.state.status = 'stop';
	this.state.title = '';
	this.state.artist = '';
	this.state.album = '';
	this.state.albumart = '/albumart';
	this.state.seek = 0;
	this.state.duration = 0;
	helpers.invalidateHwParamsCache();
	this.pushState();
	if (this.isVolatile) {
		try { this.commandRouter.stateMachine.unSetVolatile(); } catch (e) { /* ignore */ }
		this.isVolatile = false;
	}
};

metaroon.prototype._setVolatileMode = function(status) {
	try {
		this.commandRouter.stateMachine.setConsumeUpdateService(undefined);
		this.commandRouter.stateMachine.setVolatile({ service: 'metaroon', callback: this.unsetVolatileCallback.bind(this) });
		this.isVolatile = true;
		this.commandRouter.stateMachine.isVolatile = true;
		this.commandRouter.stateMachine.volatileService = 'metaroon';
		if (status) this.commandRouter.stateMachine.currentStatus = status;
	} catch (e) {
		this.logger.error('metaroon: Error setting volatile: ' + e.message);
	}
};

metaroon.prototype.unsetVolatileCallback = function() {
	try {
		var state = this.commandRouter.stateMachine.getState();
		if (state && state.service !== 'metaroon') {
			this.logger.info('metaroon: unsetVolatile - switching away');
			if (this.roonTransport && this.zoneId) this.roonTransport.control(this.zoneId, 'stop');
			this.isActive = false;
			this.isVolatile = false;
		} else {
			this.isVolatile = false;
			if (this.isActive) {
				var self = this;
				process.nextTick(function() { if (self.isActive && !self.commandRouter.stateMachine.isVolatile) self._setVolatileMode(); });
			}
		}
	} catch (e) { this.logger.warn('metaroon: unsetVolatile error: ' + e.message); }
	return libQ.resolve();
};

metaroon.prototype._updateMetadata = function(zone) {
	if (zone.state === 'loading') return;

	var newStatus = STATE_MAP.get(zone.state) || 'stop';
	var statusChanged = this.state.status !== newStatus;
	var titleChanged = zone.now_playing && zone.now_playing.three_line && zone.now_playing.three_line.line1 !== this.state.title;

	this.state.status = newStatus;
	if (statusChanged && this.isActive) this.commandRouter.stateMachine.currentStatus = newStatus;
	this._populateMetadata(zone);

	if (zone.settings) {
		this.state.random = zone.settings.shuffle || false;
		if (zone.settings.loop === 'loop') { this.state.repeat = true; this.state.repeatSingle = false; }
		else if (zone.settings.loop === 'loop_one') { this.state.repeat = true; this.state.repeatSingle = true; }
		else { this.state.repeat = false; this.state.repeatSingle = false; }
	}

	if (statusChanged || titleChanged) this.pushState();
};

metaroon.prototype._updateSeek = function(seekPosition) {
	var newSeek = seekPosition * 1000;
	if (Math.abs(newSeek - this.state.seek) > SEEK_PUSH_THRESHOLD_MS) {
		this.state.seek = newSeek;
		this.commandRouter.servicePushState(this.state, 'metaroon');
	} else {
		this.state.seek = newSeek;
	}
};

metaroon.prototype.pushState = function() {
	if (this.state.status === 'play') {
		var hwInfo = helpers.readAlsaHwParams(this.state.title);
		if (hwInfo) {
			this.state.samplerate = hwInfo.samplerate;
			this.state.bitdepth = hwInfo.bitdepth;
			this.state.channels = hwInfo.channels;
		}
	}

	if (this.isActive && (this.state.status === 'play' || this.state.status === 'pause')) {
		if (!this.commandRouter.stateMachine.isVolatile || this.commandRouter.stateMachine.volatileService !== 'metaroon') {
			this._setVolatileMode(this.state.status);
		} else {
			this.commandRouter.stateMachine.currentStatus = this.state.status;
		}
	}

	return this.commandRouter.servicePushState(this.state, 'metaroon');
};

metaroon.prototype.selectZone = function(zoneId) {
	var zone = this.availableZones.find(function(z) { return z.zone_id === zoneId; });
	if (zone) {
		this.selectedZoneId = zoneId;
		this.config.set('selectedZoneId', zoneId);
		this._setZone({ zone_id: zone.zone_id, display_name: zone.display_name, outputs: zone.outputs });
		this.commandRouter.pushToastMessage('success', 'Roon Zone', 'Selected: ' + zone.display_name);
	}
};

metaroon.prototype.getUIConfig = function() {
	var self = this;
	var defer = libQ.defer();
	var lang = self.commandRouter.sharedVars.get('language_code');

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang + '.json', __dirname + '/i18n/strings_en.json', __dirname + '/UIConfig.json')
	.then(function(uiconf) {
		var coreName = (self.roonCore && self.roonCore.display_name) || 'Not detected';
		self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value', coreName);
		self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', self.roonCore ? coreName + ':9330' : 'Not detected');
		self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].value', self.zoneName || 'No zone selected');
		self.configManager.setUIConfigParam(uiconf, 'sections[0].content[3].value', self.roonBrowse ? 'Available' : 'Not available');

		if (self.availableZones.length > 0) {
			var opts = self.availableZones.map(function(z) { return { value: z.zone_id, label: z.display_name }; });
			self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].options', opts);
			self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].value', {
				value: self.selectedZoneId || self.availableZones[0].zone_id,
				label: self.zoneName || self.availableZones[0].display_name
			});
		}
		defer.resolve(uiconf);
	}).fail(function(err) { defer.reject(err); });

	return defer.promise;
};

metaroon.prototype.saveZoneSelection = function(data) {
	if (data.zone_select && data.zone_select.value) this.selectZone(data.zone_select.value);
	return libQ.resolve();
};

metaroon.prototype.setUIConfig = function() {};
metaroon.prototype.getConf = function(k) { return this.config.get(k); };
metaroon.prototype.setConf = function(k, v) { this.config.set(k, v); };

metaroon.prototype._loadI18nStrings = function() {
	try {
		var lang = this.commandRouter.sharedVars.get('language_code');
		this.i18nStrings = require(__dirname + '/i18n/strings_' + lang + '.json');
	} catch (e) {
		this.i18nStrings = require(__dirname + '/i18n/strings_en.json');
	}
	this.i18nStringsDefaults = require(__dirname + '/i18n/strings_en.json');
};

metaroon.prototype.getI18nString = function(key) {
	return (this.i18nStrings && this.i18nStrings[key]) || (this.i18nStringsDefaults && this.i18nStringsDefaults[key]) || key;
};