'use strict';

const libQ = require('kew');
const { SEARCH_PAGE_SIZE } = require('./constants');
const { cleanRoonText, getRoonImageUrl } = require('./helpers');

function attach(proto) {

	proto.search = function(query) {
		var self = this;
		var defer = libQ.defer();

		var searchString = query.value || query;
		if (!searchString || !self.roonBrowse || !self.roonCore) { defer.resolve([]); return defer.promise; }

		self.logger.info('metaroon: Searching Library for: ' + searchString);
		self.currentSearchTerm = searchString.toLowerCase();
		self.lastSearchTerm = searchString;

		self.searchLibrary(searchString).then(function(results) {
			defer.resolve(results);
		}).fail(function(err) {
			self.logger.warn('metaroon: Library search error: ' + err);
			defer.resolve([]);
		});

		return defer.promise;
	};

	proto.searchLibrary = function(searchString) {
		var self = this;
		var defer = libQ.defer();

		_doLibrarySearch(self, searchString).then(function(results) {
			defer.resolve(results);
		}).fail(function(err) {
			self.logger.warn('metaroon: searchLibrary error: ' + err);
			defer.resolve([]);
		});

		return defer.promise;
	};

	proto._processLibrarySearchResults = function(topLevelItems, artists, albums, tracks, searchString) {
		var self = this;
		var defer = libQ.defer();

		var categoryLinks = [];
		var searchTerm = searchString.toLowerCase();

		for (var t = 0; t < topLevelItems.length; t++) {
			var item = topLevelItems[t];
			if (!item.item_key || item.hint === 'header') continue;

			var titleLower = (item.title || '').toLowerCase();
			var subtitle = item.subtitle || '';
			var isResultsLink = /^\d+\s+(results?|albums?|tracks?)$/i.test(subtitle);
			var isCategoryTitle = ['artists', 'albums', 'tracks', 'composers', 'works'].indexOf(titleLower) !== -1;

			if (isResultsLink || isCategoryTitle) {
				categoryLinks.push({ title: item.title, item_key: item.item_key });
			}
		}

		if (categoryLinks.length === 0) { defer.resolve(); return defer.promise; }

		var index = 0;

		var processNext = function() {
			if (index >= categoryLinks.length) { defer.resolve(); return; }

			var category = categoryLinks[index];
			var catTitleLower = (category.title || '').toLowerCase();

			if (['artists', 'albums', 'tracks'].indexOf(catTitleLower) === -1) { index++; processNext(); return; }

			var opts = { hierarchy: 'browse', item_key: category.item_key };
			if (self.zoneId) opts.zone_or_output_id = self.zoneId;

			self._roonBrowseAsync('browse', opts)
			.then(function() { return self._roonLoadAsync('browse', 0, SEARCH_PAGE_SIZE); })
			.then(function(loadResult) {
				if (loadResult && loadResult.items) {
					for (var j = 0; j < loadResult.items.length; j++) {
						var itm = loadResult.items[j];
						if (!itm.item_key || itm.hint === 'header' || itm.hint === 'action') continue;

						var itmTitle = (itm.title || '').toLowerCase();
						if (!itmTitle.includes(searchTerm)) continue;

						if (catTitleLower === 'artists') artists.push(_createLibraryItem(self, itm, 'artists'));
						else if (catTitleLower === 'albums') albums.push(_createLibraryItem(self, itm, 'albums'));
						else if (catTitleLower === 'tracks') tracks.push(_createLibraryItem(self, itm, 'tracks'));
					}
				}
				return self._roonBrowseAsync('browse', { hierarchy: 'browse', pop_levels: 1 });
			})
			.then(function() {
				index++;
				processNext();
			})
			.fail(function() {
				index++;
				processNext();
			});
		};

		processNext();
		return defer.promise;
	};
}

function _doLibrarySearch(self, searchString) {
	var defer = libQ.defer();
	var artists = [];
	var albums = [];
	var tracks = [];

	self._roonBrowseAsync('browse', { hierarchy: 'browse', pop_all: true })
	.then(function() {
		return self._roonLoadAsync('browse', 0, SEARCH_PAGE_SIZE);
	})
	.then(function(topResult) {
		var libraryItem = (topResult.items || []).find(function(i) { return i.title && i.title.toLowerCase() === 'library'; });
		if (!libraryItem) { defer.resolve([]); return; }

		var libOpts = { hierarchy: 'browse', item_key: libraryItem.item_key };
		if (self.zoneId) libOpts.zone_or_output_id = self.zoneId;

		self._roonBrowseAsync('browse', libOpts)
		.then(function() {
			return self._roonLoadAsync('browse', 0, SEARCH_PAGE_SIZE);
		})
		.then(function(libResult) {
			var searchItem = (libResult.items || []).find(function(i) { return i.title && i.title.toLowerCase() === 'search'; });
			if (!searchItem) { defer.resolve([]); return; }

			var searchOpts = { hierarchy: 'browse', item_key: searchItem.item_key, input: searchString };
			if (self.zoneId) searchOpts.zone_or_output_id = self.zoneId;

			self._roonBrowseAsync('browse', searchOpts)
			.then(function() {
				return self._roonLoadAsync('browse', 0, SEARCH_PAGE_SIZE);
			})
			.then(function(resultsData) {
				return self._processLibrarySearchResults(resultsData.items || [], artists, albums, tracks, searchString);
			})
			.then(function() {
				defer.resolve(_buildSearchSections(artists, albums, tracks));
			})
			.fail(function(err) { defer.reject(err); });
		})
		.fail(function(err) { defer.reject(err); });
	})
	.fail(function(err) { defer.reject(err); });

	return defer.promise;
}

function _createLibraryItem(self, item, category) {
	var encodedTitle = encodeURIComponent(item.title || 'Unknown');
	var type = category === 'tracks' ? 'song' : 'folder';

	return {
		service: 'metaroon',
		type: type,
		title: item.title || 'Unknown',
		artist: category !== 'artists' ? cleanRoonText(item.subtitle || '') : '',
		album: '',
		uri: 'roon/library:' + category + ':' + encodedTitle,
		albumart: item.image_key ? getRoonImageUrl(self.roonCoreHost, item.image_key, 200, 200) : '/albumart'
	};
}

function _buildSearchSections(artists, albums, tracks) {
	var results = [];
	if (artists.length > 0) results.push({ title: 'Roon Library Artists', icon: 'fa fa-user', availableListViews: ['list', 'grid'], items: artists.slice(0, 15) });
	if (albums.length > 0) results.push({ title: 'Roon Library Albums', icon: 'fa fa-compact-disc', availableListViews: ['list', 'grid'], items: albums.slice(0, 15) });
	if (tracks.length > 0) results.push({ title: 'Roon Library Tracks', icon: 'fa fa-music', availableListViews: ['list'], items: tracks.slice(0, 20) });
	return results;
}

module.exports = { attach };