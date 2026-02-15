'use strict';

const libQ = require('kew');

function attach(proto) {

	proto.play = function() {
		this.logger.info('metaroon: play() called');
		if (this.roonTransport && this.zoneId) this.roonTransport.control(this.zoneId, 'play');
	};

	proto.pause = function() {
		this.logger.info('metaroon: pause() called');
		if (this.roonTransport && this.zoneId) this.roonTransport.control(this.zoneId, 'pause');
	};

	proto.stop = function() {
		var defer = libQ.defer();
		if (this.roonTransport && this.zoneId) {
			this.roonTransport.control(this.zoneId, 'stop');
			defer.resolve();
		} else {
			defer.reject('Roon not available');
		}
		return defer.promise;
	};

	proto.next = function() {
		var defer = libQ.defer();
		if (this.roonTransport && this.zoneId) {
			this.roonTransport.control(this.zoneId, 'next');
			defer.resolve();
		} else {
			defer.reject('Roon not available');
		}
		return defer.promise;
	};

	proto.previous = function() {
		var defer = libQ.defer();
		if (this.roonTransport && this.zoneId) {
			this.roonTransport.control(this.zoneId, 'previous');
			defer.resolve();
		} else {
			defer.reject('Roon not available');
		}
		return defer.promise;
	};

	proto.seek = function(position) {
		var defer = libQ.defer();
		if (this.roonTransport && this.zoneId) {
			this.roonTransport.seek(this.zoneId, 'absolute', Math.floor(position / 1000));
			defer.resolve();
		} else {
			defer.reject('Roon not available');
		}
		return defer.promise;
	};

	proto.random = function(enabled) {
		var self = this;
		var defer = libQ.defer();
		if (self.roonTransport && self.zoneId) {
			self.roonTransport.change_settings(self.zoneId, { shuffle: enabled }, function(error) {
				if (error) { defer.reject(error); }
				else { self.state.random = enabled; self.pushState(); defer.resolve(); }
			});
		} else {
			defer.reject('Roon not available');
		}
		return defer.promise;
	};

	proto.repeat = function(enabled, single) {
		var self = this;
		var defer = libQ.defer();
		if (self.roonTransport && self.zoneId) {
			var loopMode = !enabled ? 'disabled' : (single ? 'loop_one' : 'loop');
			self.roonTransport.change_settings(self.zoneId, { loop: loopMode }, function(error) {
				if (error) { defer.reject(error); }
				else {
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

	proto.toggle = function() {
		this.logger.info('metaroon: toggle() called, current status: ' + this.state.status);
		if (this.roonTransport && this.zoneId) this.roonTransport.control(this.zoneId, 'playpause');
	};

	proto.resume = function() { return this.play(); };

	proto.clearAddPlayTrack = function(track) {
		if (this.roonTransport && this.zoneId) this.roonTransport.control(this.zoneId, 'play');
		return libQ.resolve();
	};

	proto.addToQueue = function() { return libQ.resolve(); };
	proto.prefetch = function() { return libQ.resolve(); };
	proto.getState = function() { return this.state; };

	proto.getTrackInfo = function() {
		if (!this.isActive || !this.state.title) return libQ.resolve({});
		return libQ.resolve({
			title: this.state.title,
			artist: this.state.artist,
			album: this.state.album,
			albumart: this.state.albumart,
			duration: this.state.duration,
			samplerate: this.state.samplerate,
			bitdepth: this.state.bitdepth,
			channels: this.state.channels,
			trackType: this.state.trackType
		});
	};

	proto.goto = function(data) {
		var self = this;
		var defer = libQ.defer();

		if (!self.roonBrowse || !self.roonCore) {
			defer.resolve({});
			return defer.promise;
		}

		var type = data.type;
		var value = data.value;
		var sectionTitle = type === 'artist' ? 'Roon Library Artists' : 'Roon Library Albums';

		if ((type === 'artist' || type === 'album') && value) {
			self.lastSearchTerm = value;
			self.searchLibrary(value).then(function(results) {
				if (results && results.length > 0) {
					var section = results.find(function(s) { return s.title === sectionTitle; });
					if (section && section.items && section.items.length > 0) {
						self.commandRouter.pushToastMessage('info', 'MetaRoon', 'Navigating to ' + type + ': ' + value);
						defer.resolve(self.handleBrowseUri(section.items[0].uri));
						return;
					}
				}
				defer.resolve({});
			}).fail(function() { defer.resolve({}); });
		} else {
			defer.resolve({});
		}

		return defer.promise;
	};
}

module.exports = { attach };