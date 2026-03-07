'use strict';

const libQ = require('kew');
const { BROWSE_PAGE_SIZE } = require('./constants');
const { convertRoonItemToVolumio, findBestPlayAction, getRoonImageUrl } = require('./helpers');

function attach(proto) {

	proto.addToBrowseSources = function() {
		this.commandRouter.volumioAddToBrowseSources({
			name: 'Roon',
			uri: 'roon',
			plugin_type: 'music_service',
			plugin_name: 'metaroon',
			icon: 'fa fa-music',
			albumart: '/albumart?sourceicon=music_service/metaroon/roon-icon-transparent.png'
		});
		this.browseSourceAdded = true;
		this.logger.info('metaroon: Added Roon to browse sources');
	};

	proto.handleBrowseUri = function(uri) {
		var self = this;
		var defer = libQ.defer();

		if (!self.roonBrowse) { defer.reject('Browse not available'); return defer.promise; }
		if (!self.roonCore) { defer.reject('Roon Core not connected'); return defer.promise; }
		if (!self.zoneId && uri === 'roon') {
			self.commandRouter.pushToastMessage('warning', 'MetaRoon', 'No Roon zone selected');
		}

		var handler;
		if (uri === 'roon') handler = self.browseRoonTopLevel();
		else if (uri === 'roon/back') handler = self.browseRoonBack();
		else if (uri.startsWith('roon/search:')) handler = self.browseSearchItem(uri.substring(12));
		else if (uri.startsWith('roon/library:')) handler = self.browseLibraryItem(uri.substring(13));
		else if (uri.startsWith('roon/')) handler = self.browseRoonItem(uri.substring(5));
		else { defer.reject('Invalid URI'); return defer.promise; }

		handler.then(function(r) { defer.resolve(r); }).fail(function(e) { defer.reject(e); });
		return defer.promise;
	};

	proto.browseRoonTopLevel = function() {
		var self = this;
		var defer = libQ.defer();
		self.currentBrowseListImage = null;
		self.roonBrowse.browse({ hierarchy: self.browseHierarchy, pop_all: true }, function(err, result) {
			if (err) { defer.reject(err); return; }
			self.browseLevel = result.list ? result.list.level : 0;
			self._loadAndConvertBrowseItems(defer);
		});
		return defer.promise;
	};

	proto.browseRoonItem = function(itemKey) {
		var self = this;
		var defer = libQ.defer();
		self.lastBrowseSource = 'browse';
		var opts = { hierarchy: self.browseHierarchy, item_key: itemKey };
		if (self.zoneId) opts.zone_or_output_id = self.zoneId;

		self.roonBrowse.browse(opts, function(err, result) {
			if (err) { defer.reject(err); return; }
			if (result.action === 'message') {
				self.commandRouter.pushToastMessage('success', 'Roon', result.message || 'Action completed');
			}
			self.browseLevel = result.list ? result.list.level : self.browseLevel + 1;
			self._loadAndConvertBrowseItems(defer);
		});
		return defer.promise;
	};

	proto.browseRoonBack = function() {
		var self = this;
		var defer = libQ.defer();
		self.roonBrowse.browse({ hierarchy: self.browseHierarchy, pop_levels: 1 }, function(err, result) {
			if (err) { defer.reject(err); return; }
			self.browseLevel = result.list ? result.list.level : Math.max(0, self.browseLevel - 1);
			self._loadAndConvertBrowseItems(defer);
		});
		return defer.promise;
	};

	proto._loadAndConvertBrowseItems = function(defer) {
		var self = this;
		self.roonBrowse.load({ hierarchy: self.browseHierarchy, offset: 0, count: BROWSE_PAGE_SIZE }, function(err, result) {
			if (err) { defer.reject(err); return; }
			if (result.list && result.list.image_key) {
				self.currentBrowseListImage = result.list.image_key;
			}
			var items = (result.items || []).map(function(i) {
				return convertRoonItemToVolumio(i, self.roonCoreHost, self.currentBrowseListImage, false);
			}).filter(function(i) { return i !== null; });

			defer.resolve({
				navigation: {
					prev: { uri: self.browseLevel > 0 ? 'roon/back' : '' },
					lists: [{ availableListViews: ['list', 'grid'], items: items }]
				}
			});
		});
	};

	proto.browseSearchItem = function(itemInfo) {
		var self = this;
		var defer = libQ.defer();

		var colonIdx = itemInfo.indexOf(':');
		if (colonIdx === -1) { defer.reject('Invalid search item'); return defer.promise; }

		var category = itemInfo.substring(0, colonIdx);
		var targetTitle = decodeURIComponent(itemInfo.substring(colonIdx + 1));

		self.logger.info('metaroon: browseSearchItem - category: ' + category + ', title: ' + targetTitle);
		if (!self.lastSearchTerm) { defer.reject('No search context'); return defer.promise; }

		var searchOpts = { hierarchy: 'search', input: self.lastSearchTerm, pop_all: true };
		if (self.zoneId) searchOpts.zone_or_output_id = self.zoneId;

		self._roonBrowseAsync('search', searchOpts)
		.then(function() { return self._roonLoadAsync('search', 0, 50); })
		.then(function(loadResult) {
			var categoryItem = (loadResult.items || []).find(function(i) {
				return i.title && i.title.toLowerCase() === category.toLowerCase();
			});
			if (!categoryItem) throw new Error('Category not found: ' + category);

			var catOpts = { hierarchy: 'search', item_key: categoryItem.item_key };
			if (self.zoneId) catOpts.zone_or_output_id = self.zoneId;
			return self._roonBrowseAsync('search', catOpts);
		})
		.then(function() { return self._roonLoadAsync('search', 0, BROWSE_PAGE_SIZE); })
		.then(function(itemsResult) {
			var targetItem = (itemsResult.items || []).find(function(i) { return i.title === targetTitle; });

			if (!targetItem) {
				var items = (itemsResult.items || []).map(function(i) {
					return convertRoonItemToVolumio(i, self.roonCoreHost, null, true);
				}).filter(function(i) { return i !== null; });
				return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list', 'grid'], items: items }] } };
			}

			var targetOpts = { hierarchy: 'search', item_key: targetItem.item_key };
			if (self.zoneId) targetOpts.zone_or_output_id = self.zoneId;

			return self._roonBrowseAsync('search', targetOpts).then(function(browseResult) {
				if (browseResult.action === 'message') {
					self.commandRouter.pushToastMessage('success', 'Roon', browseResult.message || 'Action completed');
					return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
				}
				return self._roonLoadAsync('search', 0, BROWSE_PAGE_SIZE).then(function(finalResult) {
					var fItems = finalResult.items || [];

					if (category === 'tracks' || category === 'albums') {
						var playAction = findBestPlayAction(fItems);
						if (playAction) {
							self.logger.info('metaroon: Auto-playing: ' + playAction.title);
							self.roonBrowse.browse({ hierarchy: 'search', item_key: playAction.item_key, zone_or_output_id: self.zoneId }, function() {});
							return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
						}
					}

					var vItems = fItems.map(function(i) { return convertRoonItemToVolumio(i, self.roonCoreHost, null, true); }).filter(function(i) { return i !== null; });
					return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list', 'grid'], items: vItems }] } };
				});
			});
		})
		.then(function(result) { defer.resolve(result); })
		.fail(function(err) { defer.reject(err); });

		return defer.promise;
	};

	proto.browseLibraryItem = function(itemInfo) {
		var self = this;
		var defer = libQ.defer();

		var colonIdx = itemInfo.indexOf(':');
		if (colonIdx === -1) { defer.reject('Invalid library item'); return defer.promise; }

		var category = itemInfo.substring(0, colonIdx);
		var targetTitle = decodeURIComponent(itemInfo.substring(colonIdx + 1));

		self.logger.info('metaroon: browseLibraryItem - category: ' + category + ', title: ' + targetTitle);
		if (!self.lastSearchTerm) { defer.reject('No search context'); return defer.promise; }
		self.lastBrowseSource = 'library';

		self._roonBrowseAsync('browse', { hierarchy: 'browse', pop_all: true })
		.then(function() { return self._roonLoadAsync('browse', 0, 50); })
		.then(function(topResult) {
			var libraryItem = (topResult.items || []).find(function(i) { return i.title && i.title.toLowerCase() === 'library'; });
			if (!libraryItem) throw new Error('Library not found');
			return self._roonBrowseAsync('browse', { hierarchy: 'browse', item_key: libraryItem.item_key });
		})
		.then(function() { return self._roonLoadAsync('browse', 0, 50); })
		.then(function(libResult) {
			var searchItem = (libResult.items || []).find(function(i) { return i.title && i.title.toLowerCase() === 'search'; });
			if (!searchItem) throw new Error('Search not found');
			return self._roonBrowseAsync('browse', { hierarchy: 'browse', item_key: searchItem.item_key, input: self.lastSearchTerm });
		})
		.then(function() { return self._roonLoadAsync('browse', 0, 50); })
		.then(function(resultsData) {
			var catItem = (resultsData.items || []).find(function(i) { return i.title && i.title.toLowerCase() === category.toLowerCase(); });
			if (!catItem) throw new Error('Category not found: ' + category);
			return self._roonBrowseAsync('browse', { hierarchy: 'browse', item_key: catItem.item_key });
		})
		.then(function() { return self._roonLoadAsync('browse', 0, BROWSE_PAGE_SIZE); })
		.then(function(itemsResult) {
			var items = itemsResult.items || [];
			var targetItem = items.find(function(i) { return i.title === targetTitle; });
			if (!targetItem) targetItem = items.find(function(i) { return i.title && (i.title.startsWith(targetTitle) || targetTitle.startsWith(i.title)); });
			if (!targetItem) {
				var tl = targetTitle.toLowerCase();
				targetItem = items.find(function(i) { return i.title && i.title.toLowerCase().includes(tl); });
			}
			if (!targetItem && items.length > 0 && items[0].hint !== 'action') targetItem = items[0];

			if (!targetItem) {
				var vi = items.map(function(i) { return convertRoonItemToVolumio(i, self.roonCoreHost, null, false); }).filter(function(i) { return i; });
				return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list', 'grid'], items: vi }] } };
			}

			return self._roonBrowseAsync('browse', { hierarchy: 'browse', item_key: targetItem.item_key, zone_or_output_id: self.zoneId })
			.then(function(targetResult) {
				if (targetResult.action === 'message') {
					self.commandRouter.pushToastMessage('success', 'Roon', targetResult.message || 'Action completed');
					return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
				}
				return self._roonLoadAsync('browse', 0, BROWSE_PAGE_SIZE).then(function(finalResult) {
					return self._handleLibraryFinalItems(category, finalResult.items || []);
				});
			});
		})
		.then(function(result) { defer.resolve(result); })
		.fail(function(err) { defer.reject(err); });

		return defer.promise;
	};

	proto._handleLibraryFinalItems = function(category, finalItems) {
		var self = this;

		if (category === 'tracks') {
			var playAction = findBestPlayAction(finalItems);
			if (playAction) {
				return self._executePlayActionAsync('browse', playAction.item_key);
			}
		}

		if (category === 'albums' && finalItems.length === 1 && finalItems[0].hint === 'list' && finalItems[0].item_key) {
			return self._roonBrowseAsync('browse', { hierarchy: 'browse', item_key: finalItems[0].item_key, zone_or_output_id: self.zoneId })
			.then(function() { return self._roonLoadAsync('browse', 0, BROWSE_PAGE_SIZE); })
			.then(function(drillResult) {
				var di = (drillResult.items || []).map(function(i) { return convertRoonItemToVolumio(i, self.roonCoreHost, null, false); }).filter(function(i) { return i; });
				return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list', 'grid'], items: di }] } };
			});
		}

		var vi = finalItems.map(function(i) { return convertRoonItemToVolumio(i, self.roonCoreHost, null, false); }).filter(function(i) { return i; });
		return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list', 'grid'], items: vi }] } };
	};

	proto.executePlayAction = function(hierarchy, itemKey, defer) {
		var self = this;
		self._executePlayActionAsync(hierarchy, itemKey)
		.then(function(result) { defer.resolve(result); })
		.fail(function() {
			defer.resolve({ navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } });
		});
	};

	proto._executePlayActionAsync = function(hierarchy, itemKey) {
		var self = this;
		return self._roonBrowseAsync(hierarchy, { hierarchy: hierarchy, item_key: itemKey, zone_or_output_id: self.zoneId })
		.then(function(result) {
			if (result.action === 'message') {
				self.commandRouter.pushToastMessage('success', 'Roon', result.message || 'Action completed');
				return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
			}
			if (result.action === 'list') {
				return self._roonLoadAsync(hierarchy, 0, 20).then(function(loadResult) {
					var subItems = loadResult.items || [];
					var directAction = subItems.find(function(i) {
						return i.hint === 'action' && i.title && (i.title.toLowerCase() === 'play now' || i.title.toLowerCase() === 'play');
					});
					var actionToUse = directAction || subItems.find(function(i) { return i.hint === 'action'; });

					if (actionToUse) {
						return self._roonBrowseAsync(hierarchy, { hierarchy: hierarchy, item_key: actionToUse.item_key, zone_or_output_id: self.zoneId })
						.then(function(playResult) {
							if (playResult.message) self.commandRouter.pushToastMessage('success', 'Roon', playResult.message);
							return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
						});
					}
					return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
				});
			}
			return { navigation: { prev: { uri: 'roon' }, lists: [{ availableListViews: ['list'], items: [] }] } };
		});
	};

	proto._roonBrowseAsync = function(hierarchy, opts) {
		var self = this;
		var defer = libQ.defer();
		self.roonBrowse.browse(opts, function(err, result) {
			if (err) defer.reject(err);
			else defer.resolve(result);
		});
		return defer.promise;
	};

	proto._roonLoadAsync = function(hierarchy, offset, count) {
		var self = this;
		var defer = libQ.defer();
		self.roonBrowse.load({ hierarchy: hierarchy, offset: offset, count: count }, function(err, result) {
			if (err) defer.reject(err);
			else defer.resolve(result);
		});
		return defer.promise;
	};

	proto.explodeUri = function(uri) {
		var self = this;
		var defer = libQ.defer();

		if (!uri.startsWith('roon/')) { defer.resolve([]); return defer.promise; }
		if (!self.roonBrowse || !self.zoneId) {
			if (!self.zoneId) self.commandRouter.pushToastMessage('warning', 'MetaRoon', 'No Roon zone selected');
			defer.resolve([]);
			return defer.promise;
		}

		self.trackChangeInProgress = true;
		setTimeout(function() { self.trackChangeInProgress = false; }, 3000);

		var itemPart = uri.substring(5);
		var isSearch = itemPart.startsWith('search:');
		var theItemKey = isSearch ? itemPart.substring(7) : itemPart;
		var hierarchy = isSearch ? 'search' : self.browseHierarchy;

		self.logger.info('metaroon: explodeUri - hierarchy: ' + hierarchy + ', itemKey: ' + theItemKey);

		self._roonBrowseAsync(hierarchy, { hierarchy: hierarchy, item_key: theItemKey, zone_or_output_id: self.zoneId })
		.then(function(result) {
			if (result.action === 'message' && result.message) {
				self.commandRouter.pushToastMessage('success', 'Roon', result.message);
			} else if (result.action === 'list') {
				return self._roonLoadAsync(hierarchy, 0, 20).then(function(loadResult) {
					if (loadResult.items) {
						var playAction = findBestPlayAction(loadResult.items);
						if (playAction) {
							self.roonBrowse.browse({ hierarchy: hierarchy, item_key: playAction.item_key, zone_or_output_id: self.zoneId }, function(e, r) {
								if (r && r.message) self.commandRouter.pushToastMessage('success', 'Roon', r.message);
							});
						}
					}
				});
			}
		})
		.then(function() { defer.resolve([]); })
		.fail(function(err) {
			self.logger.warn('metaroon: explodeUri error: ' + err);
			defer.resolve([]);
		});

		return defer.promise;
	};
}

module.exports = { attach };