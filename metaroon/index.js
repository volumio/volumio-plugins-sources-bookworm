'use strict';

const libQ = require('kew');
const fs = require('fs');
const PLUGIN_VERSION = '1.0.0';

let RoonApi = require('node-roon-api');
let RoonApiTransport = require('node-roon-api-transport');
let RoonApiImage = require('node-roon-api-image');
let RoonApiBrowse = require('node-roon-api-browse');

const RECONNECT_CHECK_DELAY_MS = 10000;
const FAST_RECONNECT_DELAY_MS = 2000;
const STATE_DEBOUNCE_MS = 2000;

let globalRoonApi = null;
let globalRoonApiStarting = false;
let globalRoonCore = null;
let currentPluginInstance = null;

const stateMap = new Map([
	['playing', 'play'],
	['paused', 'pause'],
	['loading', 'play'],
	['stopped', 'stop']
]);

module.exports = metaroon;

function metaroon(context) {
	const self = this;
	self.context = context;
	self.commandRouter = self.context.coreCommand;
	self.logger = self.context.logger;
	self.configManager = self.context.configManager;
	self.lastStateChangeTime = 0;
	self.reconnectTimer = null;
	self.connectionLostTime = null;
}

// Helper: Extract IP address from Roon Core connection
metaroon.prototype.extractRoonCoreIP = function(core) {
	if (core.moo && core.moo.transport && core.moo.transport.ws) {
		try {
			const ws = core.moo.transport.ws;
			if (ws._socket && ws._socket.remoteAddress) {
				let addr = ws._socket.remoteAddress;
				if (addr.startsWith('::ffff:')) addr = addr.substring(7);
				return addr;
			}
		} catch (e) {}
	}
	if (core.moo && core.moo.core && core.moo.core.ws && core.moo.core.ws._socket) {
		try {
			let addr = core.moo.core.ws._socket.remoteAddress;
			if (addr.startsWith('::ffff:')) addr = addr.substring(7);
			return addr;
		} catch (e) {}
	}
	return null;
};

// Helper: Set volatile mode for this plugin
metaroon.prototype.setVolatileMode = function(status) {
	const self = this;
	self.commandRouter.stateMachine.setVolatile({
		service: 'metaroon',
		callback: self.unsetVolatileCallback.bind(self)
	});
	self.isVolatile = true;
	self.commandRouter.stateMachine.isVolatile = true;
	self.commandRouter.stateMachine.volatileService = 'metaroon';
	if (status) {
		self.commandRouter.stateMachine.currentStatus = status;
	}
};

metaroon.prototype.onVolumioStart = function() {
	const self = this;
	const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
	self.config = new (require('v-conf'))();
	self.config.loadFile(configFile);
	return libQ.resolve();
};

metaroon.prototype.getConfigurationFiles = function() {
	return ['config.json'];
};

metaroon.prototype.onStart = function() {
	const self = this;
	const defer = libQ.defer();

	self.logger.info('metaroon: Starting plugin v' + PLUGIN_VERSION);

	self.state = {
		status: 'stop',
		service: 'metaroon',
		title: '',
		artist: '',
		album: '',
		albumart: '/albumart',
		uri: '',
		trackType: 'roon',
		seek: 0,
		duration: 0,
		samplerate: '',
		bitdepth: '',
		channels: 2,
		random: false,
		repeat: false,
		repeatSingle: false,
		disableUiControls: false
	};

	self.roonCore = null;
	self.roonCoreHost = null;
	self.roonTransport = null;
	self.roonImage = null;
	self.roonBrowse = null;
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
	self.loadI18nStrings();

	if (self.commandRouter.stateMachine.isVolatile) {
		self.logger.info('metaroon: Clearing stale volatile from previous session');
		try {
			self.commandRouter.stateMachine.unSetVolatile();
		} catch (e) {
			self.logger.warn('metaroon: Error clearing volatile: ' + e.message);
		}
	}

	self.startRoonApi();
	defer.resolve();
	return defer.promise;
};

metaroon.prototype.onStop = function() {
	const self = this;
	const defer = libQ.defer();

	self.logger.info('metaroon: Stopping plugin');

	if (self.reconnectTimer) {
		clearTimeout(self.reconnectTimer);
		self.reconnectTimer = null;
	}
	if (self.fastReconnectTimer) {
		clearTimeout(self.fastReconnectTimer);
		self.fastReconnectTimer = null;
	}

	if (self.isActive) {
		self.stopPlayback();
	}

	if (currentPluginInstance === self) {
		currentPluginInstance = null;
	}

	self.roonApi = null;
	self.roonCore = null;
	self.roonTransport = null;
	self.roonImage = null;
	self.roonBrowse = null;

	defer.resolve();
	return defer.promise;
};

metaroon.prototype.onRestart = function() {
	const self = this;
	return self.onStop().then(() => self.onStart());
};

metaroon.prototype.startRoonApi = function() {
	const self = this;

	currentPluginInstance = self;

	if (globalRoonApiStarting) {
		self.logger.info('metaroon: Roon API already starting, skipping');
		return;
	}

	if (globalRoonApi) {
		self.logger.info('metaroon: Reusing existing Roon API instance');
		self.roonApi = globalRoonApi;

		if (globalRoonCore) {
			self.logger.info('metaroon: Re-attaching to existing Roon Core');
			self.roonCore = globalRoonCore;
			self.roonTransport = globalRoonCore.services.RoonApiTransport;
			self.roonImage = globalRoonCore.services.RoonApiImage;
			self.roonBrowse = globalRoonCore.services.RoonApiBrowse;
			self.roonCoreHost = self.extractRoonCoreIP(globalRoonCore) || globalRoonCore.display_name;

			if (self.roonTransport) {
				self.roonTransport.subscribe_zones(function(response, msg) {
					self.handleZoneUpdate(response, msg);
				});
			}

			if (self.roonBrowse && !self.browseSourceAdded) {
				self.addToBrowseSources();
			}
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

		moo_onerror: function(moo) {
			const instance = currentPluginInstance || self;
			instance.logger.warn('metaroon: Websocket error occurred');
			instance.connectionErrors = (instance.connectionErrors || 0) + 1;
			if (instance.connectionErrors > 3) {
				instance.logger.error('metaroon: Multiple connection errors (' + instance.connectionErrors + ')');
			}
		},

		core_paired: function(core) {
			const instance = currentPluginInstance || self;
			instance.logger.info('metaroon: Roon Core paired: ' + core.display_name);

			globalRoonCore = core;

			if (instance.reconnectTimer) {
				clearTimeout(instance.reconnectTimer);
				instance.reconnectTimer = null;
			}
			if (instance.fastReconnectTimer) {
				clearTimeout(instance.fastReconnectTimer);
				instance.fastReconnectTimer = null;
			}
			instance.connectionLostTime = null;
			instance.connectionErrors = 0;

			instance.roonCore = core;
			instance.roonTransport = core.services.RoonApiTransport;
			instance.roonImage = core.services.RoonApiImage;
			instance.roonBrowse = core.services.RoonApiBrowse;

			if (instance.isActive && !instance.commandRouter.stateMachine.isVolatile) {
				instance.logger.info('metaroon: Re-establishing volatile after reconnect');
				instance.setVolatileMode(instance.state.status);
			}

			const roonCoreIP = instance.extractRoonCoreIP(core);
			if (!roonCoreIP) {
				const hostname = core.display_name;
				const dns = require('dns');
				dns.lookup(hostname, (err, address) => {
					const inst = currentPluginInstance || instance;
					if (!err && address) {
						inst.roonCoreHost = address;
					}
				});
				instance.roonCoreHost = hostname;
			} else {
				instance.roonCoreHost = roonCoreIP;
			}

			if (instance.roonBrowse && !instance.browseSourceAdded) {
				instance.addToBrowseSources();
			}

			instance.roonTransport.subscribe_zones(function(response, msg) {
				const inst = currentPluginInstance || instance;
				inst.handleZoneUpdate(response, msg);
			});
		},

		core_unpaired: function() {
			const instance = currentPluginInstance || self;
			instance.logger.info('metaroon: Roon Core unpaired');

			globalRoonCore = null;
			instance.roonCore = null;
			instance.roonTransport = null;
			instance.roonImage = null;
			instance.roonBrowse = null;

			if (!instance.connectionLostTime) {
				instance.connectionLostTime = Date.now();
			}

			if (!instance.fastReconnectTimer && instance.roonApi && instance.roonApi._sood) {
				instance.logger.info('metaroon: Triggering immediate reconnect');
				instance.fastReconnectTimer = setTimeout(() => {
					const inst = currentPluginInstance || instance;
					inst.fastReconnectTimer = null;
					if (!inst.roonCore && inst.roonApi && inst.roonApi._sood) {
						try {
							inst.roonApi._sood.query({ query_service_id: "00720724-5143-4a9b-abac-0e50cba674bb" });
						} catch (e) {}
					}
				}, FAST_RECONNECT_DELAY_MS);
			}

			if (!instance.reconnectTimer && instance.isActive) {
				instance.reconnectTimer = setTimeout(() => {
					const inst = currentPluginInstance || instance;
					inst.reconnectTimer = null;
					if (!inst.roonCore && inst.isActive) {
						inst.stopPlayback();
					}
				}, RECONNECT_CHECK_DELAY_MS);
			}
		}
	});

	globalRoonApi = self.roonApi;
	globalRoonApiStarting = false;

	self.roonApi.init_services({
		required_services: [RoonApiTransport, RoonApiImage],
		optional_services: [RoonApiBrowse]
	});

	self.logger.info('metaroon: Starting Roon discovery');
	self.roonApi.start_discovery();
};

metaroon.prototype.addToBrowseSources = function() {
	const self = this;

	const data = {
		name: 'Roon',
		uri: 'roon',
		plugin_type: 'music_service',
		plugin_name: 'metaroon',
		icon: 'fa fa-music',
		albumart: '/albumart?sourceicon=music_service/metaroon/roon-icon-transparent.png'
	};

	self.commandRouter.volumioAddToBrowseSources(data);
	self.browseSourceAdded = true;
	self.logger.info('metaroon: Added Roon to browse sources');
};

metaroon.prototype.handleBrowseUri = function(uri) {
	const self = this;
	const defer = libQ.defer();

	if (!self.roonBrowse) {
		defer.reject('Browse not available');
		return defer.promise;
	}

	if (!self.roonCore) {
		defer.reject('Roon Core not connected');
		return defer.promise;
	}

	if (!self.zoneId && uri === 'roon') {
		self.commandRouter.pushToastMessage('warning', 'MetaRoon', 'No Roon zone selected');
	}

	if (uri === 'roon') {
		self.browseRoonTopLevel().then(result => defer.resolve(result)).fail(err => defer.reject(err));
	} else if (uri === 'roon/back') {
		self.browseRoonBack().then(result => defer.resolve(result)).fail(err => defer.reject(err));
	} else if (uri.startsWith('roon/')) {
		const itemKey = uri.substring(5);
		self.browseRoonItem(itemKey).then(result => defer.resolve(result)).fail(err => defer.reject(err));
	} else {
		defer.reject('Invalid URI');
	}

	return defer.promise;
};

metaroon.prototype.browseRoonTopLevel = function() {
	const self = this;
	const defer = libQ.defer();

	self.currentBrowseListImage = null;
	self.roonBrowse.browse({ hierarchy: self.browseHierarchy, pop_all: true }, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}
		self.browseLevel = result.list ? result.list.level : 0;
		self.loadRoonBrowseItems(0, 100).then(items => defer.resolve(items)).fail(err => defer.reject(err));
	});

	return defer.promise;
};

metaroon.prototype.browseRoonItem = function(itemKey) {
	const self = this;
	const defer = libQ.defer();

	const opts = { hierarchy: self.browseHierarchy, item_key: itemKey };
	if (self.zoneId) opts.zone_or_output_id = self.zoneId;

	self.roonBrowse.browse(opts, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}

		if (result.action === 'message') {
			self.commandRouter.pushToastMessage('success', 'Roon', result.message || 'Action completed');
		}
		self.browseLevel = result.list ? result.list.level : self.browseLevel + 1;
		self.loadRoonBrowseItems(0, 100).then(items => defer.resolve(items)).fail(err => defer.reject(err));
	});

	return defer.promise;
};

metaroon.prototype.browseRoonBack = function() {
	const self = this;
	const defer = libQ.defer();

	self.roonBrowse.browse({ hierarchy: self.browseHierarchy, pop_levels: 1 }, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}
		self.browseLevel = result.list ? result.list.level : Math.max(0, self.browseLevel - 1);
		self.loadRoonBrowseItems(0, 100).then(items => defer.resolve(items)).fail(err => defer.reject(err));
	});

	return defer.promise;
};

metaroon.prototype.loadRoonBrowseItems = function(offset, count) {
	const self = this;
	const defer = libQ.defer();

	self.roonBrowse.load({ hierarchy: self.browseHierarchy, offset: offset, count: count }, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}
		if (result.list && result.list.image_key) {
			self.currentBrowseListImage = result.list.image_key;
		}
		defer.resolve(self.convertRoonListToVolumio(result));
	});

	return defer.promise;
};

metaroon.prototype.convertRoonListToVolumio = function(roonResult) {
	const self = this;
	const items = roonResult.items || [];
	const volumioItems = items.map(item => self.convertRoonItemToVolumio(item)).filter(item => item !== null);

	return {
		navigation: {
			prev: { uri: self.browseLevel > 0 ? 'roon/back' : '' },
			lists: [{ availableListViews: ['list', 'grid'], items: volumioItems }]
		}
	};
};

metaroon.prototype.convertRoonItemToVolumio = function(item) {
	const self = this;

	if (item.hint === 'header') return null;

	let icon = 'fa fa-folder-open-o';
	let showAlbumart = true;

	if (item.hint === 'action') {
		icon = 'fa fa-play';
		showAlbumart = false;
	} else if (item.hint === 'action_list') {
		icon = 'fa fa-music';
	}

	let albumart = '';
	if (showAlbumart) {
		if (item.image_key) {
			albumart = self.getRoonImageUrl(item.image_key, 200, 200);
		} else if (self.currentBrowseListImage) {
			albumart = self.getRoonImageUrl(self.currentBrowseListImage, 200, 200);
		}
	}

	return {
		service: 'metaroon',
		type: 'folder',
		title: item.title || 'Unknown',
		artist: item.subtitle || '',
		album: item.subtitle || '',
		icon: icon,
		uri: item.item_key ? 'roon/' + item.item_key : 'roon',
		albumart: albumart
	};
};

metaroon.prototype.getRoonImageUrl = function(imageKey, width, height) {
	const self = this;
	if (!self.roonCoreHost || !imageKey) return '/albumart';
	return 'http://' + self.roonCoreHost + ':9330/api/image/' + imageKey + '?scale=fit&width=' + (width || 200) + '&height=' + (height || 200);
};

metaroon.prototype.explodeUri = function(uri) {
	const self = this;
	const defer = libQ.defer();

	if (!uri.startsWith('roon/')) {
		defer.resolve([]);
		return defer.promise;
	}

	if (self.roonBrowse && self.zoneId) {
		const itemKey = uri.substring(5);
		const opts = { hierarchy: self.browseHierarchy, item_key: itemKey, zone_or_output_id: self.zoneId };

		self.roonBrowse.browse(opts, (error, result) => {
			if (error) {
				defer.resolve([]);
				return;
			}
			if (result.action === 'message' && result.message) {
				self.commandRouter.pushToastMessage('success', 'Roon', result.message);
			} else if (result.action === 'list') {
				self.roonBrowse.load({ hierarchy: self.browseHierarchy, offset: 0, count: 20 }, (loadErr, loadResult) => {
					if (!loadErr && loadResult.items) {
						const playAction = self.findBestPlayAction(loadResult.items);
						if (playAction) {
							self.roonBrowse.browse({ hierarchy: self.browseHierarchy, item_key: playAction.item_key, zone_or_output_id: self.zoneId }, () => {});
						}
					}
				});
			}
			defer.resolve([]);
		});
	} else {
		if (!self.zoneId) {
			self.commandRouter.pushToastMessage('warning', 'MetaRoon', 'No Roon zone selected');
		}
		defer.resolve([]);
	}

	return defer.promise;
};

metaroon.prototype.findBestPlayAction = function(items) {
	if (!items || items.length === 0) return null;

	const actionItems = items.filter(item => item.hint === 'action' || item.hint === 'action_list');

	const priority = ['play from here', 'play now', 'play', 'play album', 'play artist', 'play playlist', 'start', 'shuffle'];
	for (const name of priority) {
		const found = actionItems.find(item => item.title && item.title.toLowerCase() === name);
		if (found) return found;
	}

	const playAction = actionItems.find(item => item.title && item.title.toLowerCase().includes('play'));
	return playAction || (actionItems.length > 0 ? actionItems[0] : null);
};

metaroon.prototype.search = function(query) {
	const self = this;
	const defer = libQ.defer();

	// Extract search string from query object
	const searchString = query.value || query;
	
	if (!searchString || !self.roonBrowse || !self.roonCore) {
		defer.resolve([]);
		return defer.promise;
	}

	self.logger.info('metaroon: Searching for: ' + searchString);

	// Use Roon's search hierarchy
	const searchOpts = {
		hierarchy: 'search',
		input: searchString,
		pop_all: true
	};
	if (self.zoneId) {
		searchOpts.zone_or_output_id = self.zoneId;
	}

	self.roonBrowse.browse(searchOpts, (error, result) => {
		if (error) {
			self.logger.warn('metaroon: Search error: ' + error);
			defer.resolve([]);
			return;
		}

		// Load search results
		self.roonBrowse.load({ hierarchy: 'search', offset: 0, count: 50 }, (loadErr, loadResult) => {
			if (loadErr || !loadResult.items || loadResult.items.length === 0) {
				defer.resolve([]);
				return;
			}

			// Convert Roon results to Volumio search format
			const searchResults = self.convertRoonSearchResults(loadResult.items, searchString);
			defer.resolve(searchResults);
		});
	});

	return defer.promise;
};

metaroon.prototype.convertRoonSearchResults = function(items, searchQuery) {
	const self = this;
	const results = [];

	// Group items by type (Artists, Albums, Tracks, etc.)
	const artists = [];
	const albums = [];
	const tracks = [];
	const playlists = [];
	const other = [];

	for (const item of items) {
		if (item.hint === 'header') continue;

		const volumioItem = {
			service: 'metaroon',
			type: 'folder',
			title: item.title || 'Unknown',
			artist: item.subtitle || '',
			album: '',
			uri: item.item_key ? 'roon/' + item.item_key : 'roon',
			albumart: item.image_key ? self.getRoonImageUrl(item.image_key, 200, 200) : '/albumart'
		};

		// Categorize based on title/subtitle patterns
		const titleLower = (item.title || '').toLowerCase();
		const subtitleLower = (item.subtitle || '').toLowerCase();

		if (titleLower === 'artists' || subtitleLower.includes('artist')) {
			// This is an artist category or artist item
			volumioItem.type = 'folder';
			artists.push(volumioItem);
		} else if (titleLower === 'albums' || subtitleLower.includes('album')) {
			volumioItem.type = 'folder';
			albums.push(volumioItem);
		} else if (titleLower === 'tracks' || item.hint === 'action_list') {
			volumioItem.type = 'song';
			tracks.push(volumioItem);
		} else if (titleLower === 'playlists' || subtitleLower.includes('playlist')) {
			volumioItem.type = 'folder';
			playlists.push(volumioItem);
		} else {
			other.push(volumioItem);
		}
	}

	// Build search result sections
	if (artists.length > 0) {
		results.push({
			title: 'Roon Artists',
			icon: 'fa fa-user',
			availableListViews: ['list', 'grid'],
			items: artists.slice(0, 10)
		});
	}

	if (albums.length > 0) {
		results.push({
			title: 'Roon Albums',
			icon: 'fa fa-album',
			availableListViews: ['list', 'grid'],
			items: albums.slice(0, 10)
		});
	}

	if (tracks.length > 0) {
		results.push({
			title: 'Roon Tracks',
			icon: 'fa fa-music',
			availableListViews: ['list'],
			items: tracks.slice(0, 20)
		});
	}

	if (playlists.length > 0) {
		results.push({
			title: 'Roon Playlists',
			icon: 'fa fa-list',
			availableListViews: ['list'],
			items: playlists.slice(0, 10)
		});
	}

	// Add all other items as a general "Roon" section if we have them
	if (other.length > 0 && results.length === 0) {
		results.push({
			title: 'Roon',
			icon: 'fa fa-music',
			availableListViews: ['list', 'grid'],
			items: other.slice(0, 20)
		});
	}

	return results;
};

metaroon.prototype.clearAddPlayTrack = function(track) {
	const self = this;
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'play');
	}
	return libQ.resolve();
};

metaroon.prototype.addToQueue = function(track) {
	return libQ.resolve();
};

metaroon.prototype.handleZoneUpdate = function(response, msg) {
	const self = this;

	if (!response || (response !== 'Subscribed' && response !== 'Changed')) return;

	const zones = msg?.zones || msg?.zones_changed || msg?.zones_added;

	if (zones && zones.length > 0) {
		self.updateAvailableZones(zones);
		if (!self.zoneId) self.identifyZone(zones);
		if (self.zoneId) {
			const zone = zones.find(z => z.zone_id === self.zoneId);
			if (zone) self.updateFromZone(zone);
		}
	}

	if (msg?.zones_seek_changed && self.isActive) {
		const seekZone = msg.zones_seek_changed.find(z => z.zone_id === self.zoneId);
		if (seekZone) self.updateSeek(seekZone.seek_position);
	}
};

metaroon.prototype.updateAvailableZones = function(zones) {
	const self = this;
	self.availableZones = zones.map(zone => ({
		zone_id: zone.zone_id,
		display_name: zone.display_name,
		outputs: zone.outputs?.map(o => ({
			output_id: o.output_id,
			display_name: o.display_name,
			source_control: o.source_controls?.[0]?.display_name
		})) || []
	}));
};

metaroon.prototype.identifyZone = function(zones) {
	const self = this;
	let targetZone = null;

	if (self.selectedZoneId) {
		targetZone = zones.find(z => z.zone_id === self.selectedZoneId);
	}
	if (!targetZone && zones.length > 0) {
		targetZone = zones[0];
	}
	if (targetZone) self.setZone(targetZone);
};

metaroon.prototype.setZone = function(zone) {
	const self = this;
	self.zoneId = zone.zone_id;
	self.zoneName = zone.display_name;
	self.outputId = zone.outputs?.[0]?.output_id;
	self.logger.info('metaroon: Zone set: ' + self.zoneName);
	if (self.roonTransport && self.roonTransport.subscribe_queue) {
		self.subscribeToQueue();
	}
};

metaroon.prototype.subscribeToQueue = function() {
	const self = this;
	if (!self.zoneId) return;
	try {
		self.roonTransport.subscribe_queue(self.zoneId, 50, (response, msg) => {
			if ((response === 'Subscribed' || response === 'Changed') && msg.changes?.tracks) {
				self.queueItems = msg.changes.tracks;
			}
		});
	} catch (e) {}
};

metaroon.prototype.updateFromZone = function(zone) {
	const self = this;

	const isPlaying = zone.state === 'playing';
	const isPaused = zone.state === 'paused';
	const isStopped = zone.state === 'stopped';
	const hasNowPlaying = zone.now_playing && zone.now_playing.three_line;

	if (zone.state === 'loading') return;

	const now = Date.now();
	if (now - self.lastStateChangeTime < STATE_DEBOUNCE_MS) {
		if (self.isActive && hasNowPlaying) self.updateMetadata(zone);
		return;
	}

	if (isPlaying && !self.isActive) {
		self.lastStateChangeTime = now;
		if (hasNowPlaying) self.populateMetadataFromZone(zone);
		self.startPlayback();
	} else if (isPaused && hasNowPlaying && !self.isActive) {
		self.lastStateChangeTime = now;
		self.populateMetadataFromZone(zone);
		self.startPlaybackPaused();
	} else if (isStopped && self.isActive) {
		self.lastStateChangeTime = now;
		self.stopPlayback();
	} else if (self.isActive && !self.commandRouter.stateMachine.isVolatile && (isPlaying || isPaused)) {
		self.setVolatileMode();
	}

	if (self.isActive && hasNowPlaying) self.updateMetadata(zone);
};

metaroon.prototype.populateMetadataFromZone = function(zone) {
	const self = this;
	self.state.title = zone.now_playing?.three_line?.line1 || '';
	self.state.artist = zone.now_playing?.three_line?.line2 || '';
	self.state.album = zone.now_playing?.three_line?.line3 || '';
	self.state.seek = (zone.now_playing?.seek_position || 0) * 1000;
	self.state.duration = zone.now_playing?.length || 0;
	if (zone.now_playing?.image_key) {
		self.state.albumart = self.getRoonImageUrl(zone.now_playing.image_key, 500, 500);
	}
};

metaroon.prototype.startPlayback = function() {
	const self = this;
	self.logger.info('metaroon: Starting playback');
	self.isActive = true;

	if (!self.isVolatile) {
		self.state.status = 'play';
		self.setVolatileMode();
		self.commandRouter.stateMachine.currentStatus = 'play';
		self.pushState();
	}
};

metaroon.prototype.startPlaybackPaused = function() {
	const self = this;
	self.logger.info('metaroon: Starting playback (paused)');
	self.isActive = true;
	self.state.status = 'pause';
	self.setVolatileMode();
	self.commandRouter.stateMachine.currentStatus = 'pause';
	self.pushState();
};

metaroon.prototype.unsetVolatileCallback = function() {
	const self = this;
	const state = self.commandRouter.stateMachine.getState();

	if (state && state.service !== 'metaroon') {
		if (self.roonTransport && self.zoneId) {
			self.roonTransport.control(self.zoneId, 'stop');
		}
		self.isActive = false;
		self.isVolatile = false;
	} else {
		if (self.isActive) {
			process.nextTick(() => {
				if (self.isActive && !self.commandRouter.stateMachine.isVolatile) {
					self.setVolatileMode();
				}
			});
		}
	}

	return libQ.resolve();
};

metaroon.prototype.stopPlayback = function() {
	const self = this;
	self.logger.info('metaroon: Stopping playback');
	self.isActive = false;
	self.state.status = 'stop';
	self.state.title = '';
	self.state.artist = '';
	self.state.album = '';
	self.state.albumart = '/albumart';
	self.state.seek = 0;
	self.state.duration = 0;
	self.pushState();

	if (self.isVolatile) {
		self.commandRouter.stateMachine.unSetVolatile();
		self.isVolatile = false;
	}
};

metaroon.prototype.updateMetadata = function(zone) {
	const self = this;
	if (zone.state === 'loading') return;

	const newStatus = stateMap.get(zone.state) || 'stop';
	const statusChanged = self.state.status !== newStatus;
	const titleChanged = zone.now_playing?.three_line?.line1 !== self.state.title;

	self.state.status = newStatus;
	if (statusChanged && self.isActive) {
		self.commandRouter.stateMachine.currentStatus = newStatus;
	}
	self.populateMetadataFromZone(zone);

	if (zone.settings) {
		self.state.random = zone.settings.shuffle || false;
		if (zone.settings.loop === 'loop') {
			self.state.repeat = true;
			self.state.repeatSingle = false;
		} else if (zone.settings.loop === 'loop_one') {
			self.state.repeat = true;
			self.state.repeatSingle = true;
		} else {
			self.state.repeat = false;
			self.state.repeatSingle = false;
		}
	}

	if (statusChanged || titleChanged) {
		self.pushState();
	}
};

metaroon.prototype.updateSeek = function(seekPosition) {
	const self = this;
	const newSeek = seekPosition * 1000;
	if (Math.abs(newSeek - self.state.seek) > 1500) {
		self.state.seek = newSeek;
		self.pushState();
	} else {
		self.state.seek = newSeek;
	}
};

metaroon.prototype.pushState = function() {
	const self = this;

	if (self.state.status === 'play') {
		self.updateQualityInfo();
	}

	if (self.isActive && (self.state.status === 'play' || self.state.status === 'pause')) {
		if (!self.commandRouter.stateMachine.isVolatile || self.commandRouter.stateMachine.volatileService !== 'metaroon') {
			self.setVolatileMode(self.state.status);
		} else {
			self.commandRouter.stateMachine.currentStatus = self.state.status;
		}
	}

	return self.commandRouter.servicePushState(self.state, 'metaroon');
};

metaroon.prototype.play = function() {
	const self = this;
	self.logger.info('metaroon: play() called');
	self.commandRouter.stateMachine.currentStatus = 'play';

	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'play');
		self.state.status = 'play';
		self.pushState();
	}
};

metaroon.prototype.pause = function() {
	const self = this;
	const defer = libQ.defer();
	self.logger.info('metaroon: pause() called');
	self.commandRouter.stateMachine.currentStatus = 'pause';

	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'pause');
		self.state.status = 'pause';
		self.pushState();
		defer.resolve();
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.stop = function() {
	const self = this;
	const defer = libQ.defer();
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'stop');
		defer.resolve();
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.next = function() {
	const self = this;
	const defer = libQ.defer();
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'next');
		defer.resolve();
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.previous = function() {
	const self = this;
	const defer = libQ.defer();
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'previous');
		defer.resolve();
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.seek = function(position) {
	const self = this;
	const defer = libQ.defer();
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.seek(self.zoneId, 'absolute', Math.floor(position / 1000));
		defer.resolve();
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.random = function(enabled) {
	const self = this;
	const defer = libQ.defer();
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.change_settings(self.zoneId, { shuffle: enabled }, (error) => {
			if (error) {
				defer.reject(error);
			} else {
				self.state.random = enabled;
				self.pushState();
				defer.resolve();
			}
		});
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.repeat = function(enabled, single) {
	const self = this;
	const defer = libQ.defer();
	if (self.roonTransport && self.zoneId) {
		const loopMode = !enabled ? 'disabled' : (single ? 'loop_one' : 'loop');
		self.roonTransport.change_settings(self.zoneId, { loop: loopMode }, (error) => {
			if (error) {
				defer.reject(error);
			} else {
				self.state.repeat = enabled;
				self.state.repeatSingle = single;
				self.pushState();
				defer.resolve();
			}
		});
	} else {
		defer.reject('Roon not available');
	}
	return defer.promise;
};

metaroon.prototype.selectZone = function(zoneId) {
	const self = this;
	const zone = self.availableZones.find(z => z.zone_id === zoneId);
	if (zone) {
		self.selectedZoneId = zoneId;
		self.config.set('selectedZoneId', zoneId);
		self.setZone({ zone_id: zone.zone_id, display_name: zone.display_name, outputs: zone.outputs });
		self.commandRouter.pushToastMessage('success', 'Roon Zone', 'Selected: ' + zone.display_name);
	}
};

metaroon.prototype.getUIConfig = function() {
	const self = this;
	const defer = libQ.defer();
	const lang_code = self.commandRouter.sharedVars.get('language_code');

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(uiconf => {
			const coreName = self.roonCore?.display_name || 'Not detected';
			const coreAddress = self.roonCore ? self.roonCore.display_name + ':9330' : 'Not detected';

			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value', coreName);
			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', coreAddress);
			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].value', self.zoneName || 'No zone selected');
			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[3].value', self.roonBrowse ? 'Available' : 'Not available');

			if (self.availableZones.length > 0) {
				const zoneOptions = self.availableZones.map(z => ({ value: z.zone_id, label: z.display_name }));
				self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].options', zoneOptions);
				self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].value', {
					value: self.selectedZoneId || self.availableZones[0].zone_id,
					label: self.zoneName || self.availableZones[0].display_name
				});
			}
			defer.resolve(uiconf);
		})
		.fail(err => defer.reject(err));

	return defer.promise;
};

metaroon.prototype.saveZoneSelection = function(data) {
	const self = this;
	if (data.zone_select && data.zone_select.value) {
		self.selectZone(data.zone_select.value);
	}
	return libQ.resolve();
};

metaroon.prototype.setUIConfig = function(data) {};
metaroon.prototype.getConf = function(varName) { return this.config.get(varName); };
metaroon.prototype.setConf = function(varName, varValue) { this.config.set(varName, varValue); };

metaroon.prototype.loadI18nStrings = function() {
	const self = this;
	try {
		const language_code = self.commandRouter.sharedVars.get('language_code');
		self.i18nStrings = require(__dirname + '/i18n/strings_' + language_code + '.json');
	} catch (e) {
		self.i18nStrings = require(__dirname + '/i18n/strings_en.json');
	}
	self.i18nStringsDefaults = require(__dirname + '/i18n/strings_en.json');
};

metaroon.prototype.getI18nString = function(key) {
	const self = this;
	return (self.i18nStrings && self.i18nStrings[key]) || (self.i18nStringsDefaults && self.i18nStringsDefaults[key]) || key;
};

metaroon.prototype.prefetch = function(track) { return libQ.resolve(); };
metaroon.prototype.getState = function() { return this.state; };
metaroon.prototype.resume = function() { return this.play(); };

metaroon.prototype.readAlsaHwParams = function() {
	const self = this;
	const hwParamsPaths = [
		'/proc/asound/card2/pcm0p/sub0/hw_params',
		'/proc/asound/sndrpihifiberry/pcm0p/sub0/hw_params',
		'/proc/asound/card1/pcm0p/sub0/hw_params',
		'/proc/asound/card0/pcm0p/sub0/hw_params'
	];

	for (const hwPath of hwParamsPaths) {
		try {
			const data = fs.readFileSync(hwPath, 'utf8');
			if (data && data.trim() !== 'closed') {
				return self.parseHwParams(data);
			}
		} catch (e) {}
	}
	return null;
};

metaroon.prototype.parseHwParams = function(data) {
	const self = this;
	const result = { samplerate: '', bitdepth: '', channels: 2 };
	const lines = data.split('\n');

	for (const line of lines) {
		const [key, value] = line.split(':').map(s => s.trim());
		if (key === 'format') {
			if (value.includes('S16') || value.includes('U16')) result.bitdepth = '16 bit';
			else if (value.includes('S24') || value.includes('U24')) result.bitdepth = '24 bit';
			else if (value.includes('S32') || value.includes('U32')) result.bitdepth = '32 bit';
			else if (value.includes('DSD')) result.bitdepth = 'DSD';
			else if (value.includes('FLOAT')) result.bitdepth = '32 bit float';
			else result.bitdepth = value;
		} else if (key === 'rate') {
			const rateMatch = value.match(/^(\d+)/);
			if (rateMatch) result.samplerate = self.formatSampleRate(parseInt(rateMatch[1], 10));
		} else if (key === 'channels') {
			result.channels = parseInt(value, 10) || 2;
		}
	}
	return result;
};

metaroon.prototype.formatSampleRate = function(rate) {
	if (rate >= 1000) {
		const khz = rate / 1000;
		return khz === Math.floor(khz) ? khz + ' kHz' : khz.toFixed(1) + ' kHz';
	}
	return rate + ' Hz';
};

metaroon.prototype.updateQualityInfo = function() {
	const self = this;
	if (self.state.status !== 'play') return;

	const hwInfo = self.readAlsaHwParams();
	if (hwInfo) {
		self.state.samplerate = hwInfo.samplerate;
		self.state.bitdepth = hwInfo.bitdepth;
		self.state.channels = hwInfo.channels;
	}
};
