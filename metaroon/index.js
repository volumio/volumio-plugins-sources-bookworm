'use strict';

const libQ = require('kew');
const PLUGIN_VERSION = '1.0.0';

let RoonApi, RoonApiTransport, RoonApiImage, RoonApiBrowse;
try {
	RoonApi = require('node-roon-api');
	RoonApiTransport = require('node-roon-api-transport');
	RoonApiImage = require('node-roon-api-image');
	RoonApiBrowse = require('node-roon-api-browse');
} catch (e) {
	console.error('metaroon::FATAL - Failed to load Roon modules:', e.message);
}

const RECONNECT_CHECK_DELAY_MS = 10000;
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

	self.logger.info(`metaroon::Starting plugin v${PLUGIN_VERSION}`);

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
	self.startRoonApi();

	defer.resolve();
	return defer.promise;
};

metaroon.prototype.onStop = function() {
	const self = this;
	const defer = libQ.defer();

	self.logger.info('metaroon::Stopping plugin');

	if (self.reconnectTimer) {
		clearTimeout(self.reconnectTimer);
		self.reconnectTimer = null;
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
		self.logger.info('metaroon::Roon API already starting, skipping');
		return;
	}

	if (globalRoonApi) {
		self.logger.info('metaroon::Reusing existing Roon API instance');
		self.roonApi = globalRoonApi;

		if (globalRoonCore) {
			self.logger.info('metaroon::Re-attaching to existing Roon Core');
			self.roonCore = globalRoonCore;
			self.roonTransport = globalRoonCore.services.RoonApiTransport;
			self.roonImage = globalRoonCore.services.RoonApiImage;
			self.roonBrowse = globalRoonCore.services.RoonApiBrowse;

			if (globalRoonCore.moo && globalRoonCore.moo.transport && globalRoonCore.moo.transport.ws) {
				try {
					const ws = globalRoonCore.moo.transport.ws;
					if (ws._socket && ws._socket.remoteAddress) {
						let addr = ws._socket.remoteAddress;
						if (addr.startsWith('::ffff:')) addr = addr.substring(7);
						self.roonCoreHost = addr;
					}
				} catch (e) {
					self.roonCoreHost = globalRoonCore.display_name;
				}
			} else {
				self.roonCoreHost = globalRoonCore.display_name;
			}

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
	self.logger.info('metaroon::Creating new Roon API instance');

	self.roonApi = new RoonApi({
		extension_id: 'com.volumio.metaroon',
		display_name: 'Volumio Roon Bridge',
		display_version: PLUGIN_VERSION,
		publisher: 'Volumio Community',
		email: 'plugins@volumio.com',

		core_paired: function(core) {
			const instance = currentPluginInstance || self;
			instance.logger.info(`metaroon::Roon Core paired: ${core.display_name}`);

			globalRoonCore = core;

			if (instance.reconnectTimer) {
				clearTimeout(instance.reconnectTimer);
				instance.reconnectTimer = null;
			}
			instance.connectionLostTime = null;

			instance.roonCore = core;
			instance.roonTransport = core.services.RoonApiTransport;
			instance.roonImage = core.services.RoonApiImage;
			instance.roonBrowse = core.services.RoonApiBrowse;

			let roonCoreIP = null;

			if (core.moo && core.moo.transport && core.moo.transport.ws) {
				try {
					const ws = core.moo.transport.ws;
					if (ws._socket && ws._socket.remoteAddress) {
						let addr = ws._socket.remoteAddress;
						if (addr.startsWith('::ffff:')) addr = addr.substring(7);
						roonCoreIP = addr;
					}
				} catch (e) {}
			}

			if (!roonCoreIP && core.moo && core.moo.core) {
				try {
					if (core.moo.core.ws && core.moo.core.ws._socket) {
						let addr = core.moo.core.ws._socket.remoteAddress;
						if (addr.startsWith('::ffff:')) addr = addr.substring(7);
						roonCoreIP = addr;
					}
				} catch (e) {}
			}

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
			instance.logger.info('metaroon::Roon Core unpaired');

			globalRoonCore = null;

			instance.roonCore = null;
			instance.roonTransport = null;
			instance.roonImage = null;
			instance.roonBrowse = null;

			if (!instance.connectionLostTime) {
				instance.connectionLostTime = Date.now();
			}

			// Delay stop to handle brief disconnections
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

	self.logger.info('metaroon::Starting Roon discovery');
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
	self.logger.info('metaroon::Added Roon to browse sources');
};

metaroon.prototype.handleBrowseUri = function(uri) {
	const self = this;
	const defer = libQ.defer();

	self.logger.info(`metaroon::Browse URI: ${uri}`);

	if (!self.roonBrowse) {
		defer.reject('Browse not available');
		return defer.promise;
	}

	if (!self.roonCore) {
		defer.reject('Roon Core not connected');
		return defer.promise;
	}

	if (!self.zoneId && uri === 'roon') {
		self.commandRouter.pushToastMessage('warning', 'MetaRoon',
			'No Roon zone selected. Select a zone in plugin settings.');
	}

	if (uri === 'roon') {
		self.browseRoonTopLevel()
			.then(result => defer.resolve(result))
			.fail(err => defer.reject(err));
	} else if (uri === 'roon/back') {
		self.browseRoonBack()
			.then(result => defer.resolve(result))
			.fail(err => defer.reject(err));
	} else if (uri.startsWith('roon/')) {
		const itemKey = uri.substring(5);
		self.browseRoonItem(itemKey)
			.then(result => defer.resolve(result))
			.fail(err => defer.reject(err));
	} else {
		defer.reject('Invalid URI');
	}

	return defer.promise;
};

metaroon.prototype.browseRoonTopLevel = function() {
	const self = this;
	const defer = libQ.defer();

	self.currentBrowseListImage = null;

	const opts = {
		hierarchy: self.browseHierarchy,
		pop_all: true
	};

	self.roonBrowse.browse(opts, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}

		self.browseLevel = result.list ? result.list.level : 0;

		self.loadRoonBrowseItems(0, 100)
			.then(items => defer.resolve(items))
			.fail(err => defer.reject(err));
	});

	return defer.promise;
};

metaroon.prototype.browseRoonItem = function(itemKey) {
	const self = this;
	const defer = libQ.defer();

	const opts = {
		hierarchy: self.browseHierarchy,
		item_key: itemKey
	};
	
	if (self.zoneId) {
		opts.zone_or_output_id = self.zoneId;
	}

	self.roonBrowse.browse(opts, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}

		if (result.action === 'message') {
			self.commandRouter.pushToastMessage('success', 'Roon', result.message || 'Action completed');
			self.loadRoonBrowseItems(0, 100)
				.then(items => defer.resolve(items))
				.fail(err => defer.reject(err));
		} else {
			self.browseLevel = result.list ? result.list.level : self.browseLevel + 1;
			self.loadRoonBrowseItems(0, 100)
				.then(items => defer.resolve(items))
				.fail(err => defer.reject(err));
		}
	});

	return defer.promise;
};

metaroon.prototype.browseRoonBack = function() {
	const self = this;
	const defer = libQ.defer();

	const opts = {
		hierarchy: self.browseHierarchy,
		pop_levels: 1
	};

	self.roonBrowse.browse(opts, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}

		self.browseLevel = result.list ? result.list.level : Math.max(0, self.browseLevel - 1);

		self.loadRoonBrowseItems(0, 100)
			.then(items => defer.resolve(items))
			.fail(err => defer.reject(err));
	});

	return defer.promise;
};

metaroon.prototype.loadRoonBrowseItems = function(offset, count) {
	const self = this;
	const defer = libQ.defer();

	const opts = {
		hierarchy: self.browseHierarchy,
		offset: offset,
		count: count
	};

	self.roonBrowse.load(opts, (error, result) => {
		if (error) {
			defer.reject(error);
			return;
		}

		if (result.list && result.list.image_key) {
			self.currentBrowseListImage = result.list.image_key;
		}

		const volumioList = self.convertRoonListToVolumio(result);
		defer.resolve(volumioList);
	});

	return defer.promise;
};

metaroon.prototype.convertRoonListToVolumio = function(roonResult) {
	const self = this;

	const items = roonResult.items || [];

	const volumioItems = items.map(item => {
		return self.convertRoonItemToVolumio(item);
	}).filter(item => item !== null);

	return {
		navigation: {
			prev: {
				uri: self.browseLevel > 0 ? 'roon/back' : ''
			},
			lists: [
				{
					availableListViews: ['list', 'grid'],
					items: volumioItems
				}
			]
		}
	};
};

metaroon.prototype.convertRoonItemToVolumio = function(item) {
	const self = this;

	if (item.hint === 'header') return null;

	let type = 'folder';
	let icon = 'fa fa-folder-open-o';
	let showAlbumart = true;

	if (item.hint === 'action') {
		icon = 'fa fa-play';
		showAlbumart = false;
	} else if (item.hint === 'action_list') {
		icon = 'fa fa-music';
	}

	const uri = item.item_key ? `roon/${item.item_key}` : 'roon';

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
		type: type,
		title: item.title || 'Unknown',
		artist: item.subtitle || '',
		album: item.subtitle || '',
		icon: icon,
		uri: uri,
		albumart: albumart
	};
};

metaroon.prototype.getRoonImageUrl = function(imageKey, width, height) {
	const self = this;

	if (!self.roonCoreHost || !imageKey) return '/albumart';

	width = width || 200;
	height = height || 200;

	return `http://${self.roonCoreHost}:9330/api/image/${imageKey}?scale=fit&width=${width}&height=${height}`;
};

metaroon.prototype.explodeUri = function(uri) {
	const self = this;
	const defer = libQ.defer();

	if (!uri.startsWith('roon/')) {
		defer.resolve([]);
		return defer.promise;
	}

	// Return empty - playback handled by Roon via zone subscriptions
	if (self.roonBrowse && self.zoneId) {
		const itemKey = uri.substring(5);
		
		const opts = {
			hierarchy: self.browseHierarchy,
			item_key: itemKey,
			zone_or_output_id: self.zoneId
		};

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
							const playOpts = {
								hierarchy: self.browseHierarchy,
								item_key: playAction.item_key,
								zone_or_output_id: self.zoneId
							};
							self.roonBrowse.browse(playOpts, (playErr, playResult) => {
								if (!playErr && playResult.action === 'message' && playResult.message) {
									self.commandRouter.pushToastMessage('success', 'Roon', playResult.message);
								} else if (!playErr && playResult.action === 'list') {
									self.roonBrowse.load({ hierarchy: self.browseHierarchy, offset: 0, count: 20 }, (subErr, subResult) => {
										if (!subErr && subResult.items) {
											const directAction = subResult.items.find(item => 
												item.hint === 'action' && 
												item.title && 
												item.title.toLowerCase().includes('play')
											);
											if (directAction) {
												const directOpts = {
													hierarchy: self.browseHierarchy,
													item_key: directAction.item_key,
													zone_or_output_id: self.zoneId
												};
												self.roonBrowse.browse(directOpts, (dErr, dResult) => {
													if (!dErr && dResult.message) {
														self.commandRouter.pushToastMessage('success', 'Roon', dResult.message);
													}
												});
											}
										}
									});
								}
							});
						}
					}
				});
			}

			defer.resolve([]);
		});
	} else {
		if (!self.zoneId) {
			self.commandRouter.pushToastMessage('warning', 'MetaRoon',
				'No Roon zone selected. Please select a zone in settings.');
		}
		defer.resolve([]);
	}

	return defer.promise;
};

// Find best play action from browse items
metaroon.prototype.findBestPlayAction = function(items) {
	if (!items || items.length === 0) return null;

	const playActionPriority = [
		'play from here', 'play now', 'play', 'play album',
		'play artist', 'play playlist', 'start', 'shuffle'
	];

	const actionItems = items.filter(item => 
		item.hint === 'action' || item.hint === 'action_list'
	);

	for (const actionName of playActionPriority) {
		const found = actionItems.find(item =>
			item.title && item.title.toLowerCase() === actionName
		);
		if (found) return found;
	}

	const playAction = actionItems.find(item =>
		item.title && item.title.toLowerCase().includes('play')
	);
	if (playAction) return playAction;

	return actionItems.length > 0 ? actionItems[0] : null;
};

metaroon.prototype.executeRoonPlayAction = function() {
	const self = this;

	if (!self.roonBrowse || !self.zoneId) return;

	self.roonBrowse.load({ hierarchy: 'browse', offset: 0, count: 50 }, (loadErr, loadResult) => {
		if (loadErr || !loadResult.items || loadResult.items.length === 0) return;

		const playAction = self.findBestPlayAction(loadResult.items);
		if (playAction) {
			const playOpts = {
				hierarchy: 'browse',
				zone_or_output_id: self.zoneId,
				item_key: playAction.item_key
			};
			self.roonBrowse.browse(playOpts, () => {});
		}
	});
};

metaroon.prototype.search = function(query) {
	const defer = libQ.defer();
	defer.resolve([]);
	return defer.promise;
};

metaroon.prototype.clearAddPlayTrack = function(track) {
	const self = this;
	const defer = libQ.defer();
	
	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'play');
	}
	
	defer.resolve();
	return defer.promise;
};

metaroon.prototype.addToQueue = function(track) {
	const defer = libQ.defer();
	defer.resolve();
	return defer.promise;
};

metaroon.prototype.handleZoneUpdate = function(response, msg) {
	const self = this;

	if (!response || (response !== 'Subscribed' && response !== 'Changed')) return;

	const zones = msg?.zones || msg?.zones_changed || msg?.zones_added;
	
	if (zones && zones.length > 0) {
		self.updateAvailableZones(zones);
		
		if (!self.zoneId) {
			self.identifyZone(zones);
		}
		
		if (self.zoneId) {
			const zone = zones.find(z => z.zone_id === self.zoneId);
			if (zone) {
				self.updateFromZone(zone);
			}
		}
	}

	if (msg?.zones_seek_changed && self.isActive) {
		const seekZone = msg.zones_seek_changed.find(z => z.zone_id === self.zoneId);
		if (seekZone) {
			self.updateSeek(seekZone.seek_position);
		}
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

	if (targetZone) {
		self.setZone(targetZone);
	}
};

metaroon.prototype.setZone = function(zone) {
	const self = this;
	
	self.zoneId = zone.zone_id;
	self.zoneName = zone.display_name;
	self.outputId = zone.outputs?.[0]?.output_id;
	
	self.logger.info(`metaroon::Zone set: ${self.zoneName}`);
	
	if (self.roonTransport && self.roonTransport.subscribe_queue) {
		self.subscribeToQueue();
	}
};

metaroon.prototype.subscribeToQueue = function() {
	const self = this;
	
	if (!self.zoneId) return;
	
	try {
		self.roonTransport.subscribe_queue(self.zoneId, 50, (response, msg) => {
			if (response === 'Subscribed' || response === 'Changed') {
				if (msg.changes?.tracks) {
					self.queueItems = msg.changes.tracks;
				}
			}
		});
	} catch (e) {}
};

metaroon.prototype.updateFromZone = function(zone) {
	const self = this;

	const isActuallyPlaying = zone.state === 'playing';
	const isLoading = zone.state === 'loading';
	const isPaused = zone.state === 'paused';
	const isStopped = zone.state === 'stopped';
	const hasNowPlaying = zone.now_playing && zone.now_playing.three_line;

	// Skip loading state to avoid race conditions
	if (isLoading) return;

	const now = Date.now();
	const timeSinceLastChange = now - self.lastStateChangeTime;
	
	if (timeSinceLastChange < STATE_DEBOUNCE_MS) {
		if (self.isActive && hasNowPlaying) {
			self.updateMetadata(zone);
		}
		return;
	}

	if (isActuallyPlaying && !self.isActive) {
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
	}

	if (self.isActive && hasNowPlaying) {
		self.updateMetadata(zone);
	}
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

	self.logger.info('metaroon::Starting playback');
	self.isActive = true;

	if (!self.isVolatile) {
		self.state.status = 'play';
		
		// Set volatile before pushing state
		self.commandRouter.stateMachine.setVolatile({
			service: 'metaroon',
			callback: self.handleVolatileCallback.bind(self)
		});
		self.isVolatile = true;
		
		self.pushState();
	}
};

metaroon.prototype.startPlaybackPaused = function() {
	const self = this;

	self.logger.info('metaroon::Starting playback (paused)');
	self.isActive = true;

	if (!self.isVolatile) {
		self.state.status = 'pause';
		
		self.commandRouter.stateMachine.setVolatile({
			service: 'metaroon',
			callback: self.handleVolatileCallback.bind(self)
		});
		self.isVolatile = true;
		
		self.pushState();
	}
};

metaroon.prototype.stopPlayback = function() {
	const self = this;

	self.logger.info('metaroon::Stopping playback');
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

metaroon.prototype.handleVolatileCallback = function() {
	const self = this;
	self.isVolatile = false;
	self.isActive = false;
	return libQ.resolve();
};

metaroon.prototype.updateMetadata = function(zone) {
	const self = this;

	if (zone.state === 'loading') return;

	const newStatus = stateMap.get(zone.state) || 'stop';
	const statusChanged = self.state.status !== newStatus;
	const titleChanged = zone.now_playing?.three_line?.line1 !== self.state.title;
	const shouldPush = statusChanged || titleChanged;

	self.state.status = newStatus;
	self.state.title = zone.now_playing?.three_line?.line1 || '';
	self.state.artist = zone.now_playing?.three_line?.line2 || '';
	self.state.album = zone.now_playing?.three_line?.line3 || '';
	self.state.seek = (zone.now_playing?.seek_position || 0) * 1000;
	self.state.duration = zone.now_playing?.length || 0;

	if (zone.now_playing?.image_key) {
		self.state.albumart = self.getRoonImageUrl(zone.now_playing.image_key, 500, 500);
	}

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

	if (shouldPush) self.pushState();
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
	return self.commandRouter.servicePushState(self.state, 'metaroon');
};

metaroon.prototype.play = function() {
	const self = this;
	const defer = libQ.defer();

	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'playpause');
		defer.resolve();
	} else {
		defer.reject('Roon not available');
	}

	return defer.promise;
};

metaroon.prototype.pause = function() {
	const self = this;
	const defer = libQ.defer();

	if (self.roonTransport && self.zoneId) {
		self.roonTransport.control(self.zoneId, 'pause');
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
		const seconds = Math.floor(position / 1000);
		self.roonTransport.seek(self.zoneId, 'absolute', seconds);
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
		let loopMode = !enabled ? 'disabled' : (single ? 'loop_one' : 'loop');

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

metaroon.prototype.toggleRoonRadio = function(enabled) {
	const self = this;
	const defer = libQ.defer();

	if (self.roonTransport && self.zoneId) {
		self.roonTransport.change_settings(self.zoneId, { auto_radio: enabled }, (error) => {
			if (error) {
				defer.reject(error);
			} else {
				self.config.set('autoRadio', enabled);
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
		
		self.setZone({
			zone_id: zone.zone_id,
			display_name: zone.display_name,
			outputs: zone.outputs
		});
		
		self.commandRouter.pushToastMessage('success', 'Roon Zone', `Selected: ${zone.display_name}`);
	}
};

metaroon.prototype.transferZone = function(toZoneId) {
	const self = this;
	const defer = libQ.defer();

	if (self.roonTransport && self.zoneId) {
		self.roonTransport.transfer_zone(self.zoneId, toZoneId, (error) => {
			if (error) {
				defer.reject(error);
			} else {
				self.selectZone(toZoneId);
				defer.resolve();
			}
		});
	} else {
		defer.reject('Roon not available');
	}

	return defer.promise;
};

metaroon.prototype.groupZones = function(zoneIds) {
	const self = this;
	const defer = libQ.defer();

	if (self.roonTransport && zoneIds && zoneIds.length > 1) {
		const outputIds = zoneIds.map(zid => {
			const zone = self.availableZones.find(z => z.zone_id === zid);
			return zone?.outputs?.[0]?.output_id;
		}).filter(Boolean);

		if (outputIds.length > 1) {
			self.roonTransport.group_outputs(outputIds, (error) => {
				if (error) {
					defer.reject(error);
				} else {
					defer.resolve();
				}
			});
		} else {
			defer.reject('Not enough outputs to group');
		}
	} else {
		defer.reject('Invalid zone IDs');
	}

	return defer.promise;
};

metaroon.prototype.ungroupZones = function(zoneIds) {
	const self = this;
	const defer = libQ.defer();

	if (self.roonTransport && zoneIds && zoneIds.length > 0) {
		const outputIds = zoneIds.map(zid => {
			const zone = self.availableZones.find(z => z.zone_id === zid);
			return zone?.outputs?.[0]?.output_id;
		}).filter(Boolean);

		if (outputIds.length > 0) {
			self.roonTransport.ungroup_outputs(outputIds, (error) => {
				if (error) {
					defer.reject(error);
				} else {
					defer.resolve();
				}
			});
		} else {
			defer.reject('No valid outputs');
		}
	} else {
		defer.reject('Invalid zone IDs');
	}

	return defer.promise;
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
			const coreAddress = self.roonCore ? `${self.roonCore.display_name}:9330` : 'Not detected';

			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value', coreName);
			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', coreAddress);
			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].value', self.zoneName || 'No zone selected');
			self.configManager.setUIConfigParam(uiconf, 'sections[0].content[3].value', self.roonBrowse ? 'Available ✓' : 'Not available');

			if (self.availableZones.length > 0) {
				const zoneOptions = self.availableZones.map(z => ({
					value: z.zone_id,
					label: z.display_name
				}));
				
				self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].options', zoneOptions);
				self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].value', {
					value: self.selectedZoneId || self.availableZones[0].zone_id,
					label: self.zoneName || self.availableZones[0].display_name
				});
			}

			const autoRadio = self.config.get('autoRadio') || false;
			self.configManager.setUIConfigParam(uiconf, 'sections[2].content[0].value', autoRadio);

			defer.resolve(uiconf);
		})
		.fail(err => {
			defer.reject(new Error());
		});

	return defer.promise;
};

metaroon.prototype.saveZoneSelection = function(data) {
	const self = this;
	const defer = libQ.defer();

	if (data.zone_select && data.zone_select.value) {
		self.selectZone(data.zone_select.value);
		self.commandRouter.pushToastMessage('success', 'Zone Selected', `Now using: ${data.zone_select.label}`);
	}

	defer.resolve();
	return defer.promise;
};

metaroon.prototype.saveRoonRadio = function(data) {
	const self = this;
	const defer = libQ.defer();

	const enabled = data.auto_radio || false;
	
	self.toggleRoonRadio(enabled)
		.then(() => {
			self.commandRouter.pushToastMessage('success', 'Roon Radio', `Roon Radio ${enabled ? 'enabled' : 'disabled'}`);
			defer.resolve();
		})
		.fail(err => {
			self.commandRouter.pushToastMessage('error', 'Roon Radio', 'Failed to change setting');
			defer.reject(err);
		});

	return defer.promise;
};

metaroon.prototype.setUIConfig = function(data) {};

metaroon.prototype.doNothing = function(data) {
	return libQ.resolve();
};

metaroon.prototype.getConf = function(varName) {
	return this.config.get(varName);
};

metaroon.prototype.setConf = function(varName, varValue) {
	this.config.set(varName, varValue);
};

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
	if (self.i18nStrings && self.i18nStrings[key]) return self.i18nStrings[key];
	if (self.i18nStringsDefaults && self.i18nStringsDefaults[key]) return self.i18nStringsDefaults[key];
	return key;
};

metaroon.prototype.prefetch = function(track) {
	return libQ.resolve();
};

metaroon.prototype.getState = function() {
	return this.state;
};

metaroon.prototype.resume = function() {
	return this.play();
};
