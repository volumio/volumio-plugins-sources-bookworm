var http = require('http');
var crypto = require('crypto');
var xml2js = require('xml2js');
var querystring = require('querystring');

// --- PATCH (added) -----------------------------------------------------
// Normalizes whatever comes out of xml2js's parseString callback so that
// every downstream consumer can keep doing `result['@'].status` without
// blowing up when Last.fm sends back something unexpected: an empty body,
// a network hiccup that truncates the response, a non-XML error page, etc.
// Before this patch, `result` could be `undefined` in those cases (xml2js
// calls back with `err` set and `result` undefined), and every method in
// this file read `result['@']` unconditionally -> uncaught TypeError ->
// whole Volumio process crashes ("Cannot read properties of undefined
// (reading '@')").
function safeXmlResult(err, result) {
	if (err || !result || typeof result !== 'object' || result['@'] === undefined) {
		return {
			'@': { status: 'failed' },
			error: { '#': err ? ('XML parse error: ' + err.message) : 'Empty or unexpected response from Last.fm' }
		};
	}
	return result;
}
// -------------------------------------------------------------------------

var Lastfm = function(options) {
	options = options || {};
	var api_key;
	var api_secret;
	var username;
	var password;
	var authToken;
	var session_key;
	this.endpoint_url = 'ws.audioscrobbler.com';

	var self = this;
	var _isTheMethodCaller = false;

	this.debug = options.debug || false;

	this.api_key = options.api_key;
	if(options.api_secret != undefined && options.api_secret != '')
		this.api_secret = options.api_secret;
	if(options.username != undefined && options.username != '')
		this.username = options.username;
	if(options.password != undefined && options.password != '')
		this.password = options.password;
	if(options.authToken != undefined && options.authToken != '')
        this.authToken = options.authToken;
	if(options.session_key != undefined && options.session_key != '')
		this.session_key = options.session_key;
	if(options.endpoint_url != undefined && options.endpoint_url != '')
		this.endpoint_url = options.endpoint_url;

	// console.log('Loading URL, which may of may not be provided. Static: ' + this.endpoint_url + ' provided: ' + options.endpoint_url);

	// Privileged methods - available to public methods but not to the instance itself.
	self._getInfo = function(opt) {
		if(!self._isTheMethodCaller) throw new Error('Security exception.');
		try {
			if(opt.artist == undefined || opt.artist == '' && typeof opt.callback == 'function') {
				opt.callback({
					'@': {status: 'error'},
					error: {'#': 'Artist not specified.'}
				});
			} else {
				http.get({
					host: this.endpoint_url,
					port: 80,
					path: '/2.0/?method=' + (opt.track != undefined && opt.track != '' ? 'track' : 'artist') + '.getinfo&api_key=' + this.api_key + '&autocorrect=1&username=' + this.username + '&artist=' + encodeURIComponent(opt.artist) + (opt.track == undefined || opt.track == '' ? '' : '&track=' + encodeURIComponent(opt.track))
				}, function(res) {
					var body = '';
					res.on('data', function(chunk) {
						body += chunk;
					});
					res.on('end', function() {
						var parser = new xml2js.Parser(xml2js.defaults["0.1"]);
						parser.parseString(body, function(err, result) {
							result = safeXmlResult(err, result); // PATCH
							if (typeof opt.callback == 'function') {
								opt.callback(result);
							}
						});
					});
					res.on('error', function(err) { // PATCH: guard against a broken response stream
						if (typeof opt.callback == 'function') {
							opt.callback(safeXmlResult(err, undefined));
						}
					});
				}).on('error', function(err) { // PATCH: guard against connection-level failures (DNS, timeout, etc.)
					if (typeof opt.callback == 'function') {
						opt.callback(safeXmlResult(err, undefined));
					}
				});
			}
		} catch(e) {
			if(this.debug)
				console.log("Exception getting track info: ", e);
			if (typeof opt.callback == 'function') { // PATCH: don't leave the caller hanging
				opt.callback(safeXmlResult(e, undefined));
			}
		}
	};

	self._getCorrection = function(opt) {
		if(!self._isTheMethodCaller) throw new Error('Security exception.');
		try {
			if(opt.artist == undefined || opt.artist == '' && typeof opt.callback == 'function') {
				opt.callback({
					'@': {status: 'error'},
					error: {'#': 'Artist not specified.'}
				});
			} else {
				http.get({
					host: this.endpoint_url,
					port: 80,
					path: '/2.0/?method=track.getcorrection&api_key=' + this.api_key + '&artist=' + encodeURIComponent(opt.artist) + '&track=' + encodeURIComponent(opt.track)
				}, function(res) {
					var body = '';
					res.on('data', function(chunk) {
						body += chunk;
					});
					res.on('end', function() {
						var parser = new xml2js.Parser(xml2js.defaults["0.1"]);
						parser.parseString(body, function(err, result) {
							result = safeXmlResult(err, result); // PATCH
							if (typeof opt.callback == 'function') {
								opt.callback(result);
							}
						});
					});
					res.on('error', function(err) { // PATCH
						if (typeof opt.callback == 'function') {
							opt.callback(safeXmlResult(err, undefined));
						}
					});
				}).on('error', function(err) { // PATCH
					if (typeof opt.callback == 'function') {
						opt.callback(safeXmlResult(err, undefined));
					}
				});
			}
		} catch(e) {
			if(this.debug)
				console.log("Exception getting track info: ", e);
			if (typeof opt.callback == 'function') { // PATCH
				opt.callback(safeXmlResult(e, undefined));
			}
		}
	};
};

// Left for backwards compatibility
Lastfm.prototype.init = function(options) {
	this.api_key = options.api_key;
	if(options.api_secret != undefined && options.api_secret != '')
		this.api_secret = options.api_secret;
	if(options.username != undefined && options.username != '')
		this.username = options.username;
	if(options.password != undefined && options.password != '')
		this.password = options.password;
	if(options.authToken != undefined && options.authToken != '')
        this.authToken = options.authToken;
	if(options.session_key != undefined && options.session_key != '')
		this.session_key = options.session_key;
	if(options.endpoint_url != undefined && options.endpoint_url != '')
		this.endpoint_url = options.endpoint_url;
};

// Patch for Volumio -> that version of Node JS doesn't support jQuery
Lastfm.prototype.extend = function(target) {
    var sources = [].slice.call(arguments, 1);
    sources.forEach(function (source) {
        for (var prop in source) {
            target[prop] = source[prop];
        }
    });
    return target;
};

Lastfm.prototype.getSessionKey = function(callback) {
	var sig = 'api_key' + this.api_key + 'authToken' + this.authToken + 'methodauth.getMobileSessionusername' + this.username + this.api_secret;
	var api_sig = md5(sig);
	var lastfmObj = this;
	var req = http.get({
		host: this.endpoint_url,
		port: 80,
		path: '/2.0/?method=auth.getMobileSession&' +
		'username=' + this.username + '&' +
		'authToken=' + this.authToken + '&' +
		'api_key=' + this.api_key + '&' +
		'api_sig=' + api_sig
	}, function(res) {
		var body = '';
		res.on('data', function(chunk) {
			body += chunk;
		});
		res.on('end', function() {
			try {
				var parser = new xml2js.Parser(xml2js.defaults["0.1"]);
				parser.parseString(body, function(err, result) {
					result = safeXmlResult(err, result); // PATCH
					var ret = {
						success: result['@'].status == 'ok'
					};
					if(ret.success) {
						ret.session_key = result.session.key;
						lastfmObj.session_key = result.session.key;
					} else
						ret.error = result.error['#'];
					if(typeof callback == 'function') {
						callback(ret);
					}
				});
			} catch(e) {
				if(lastfmObj.debug)
					console.log("Exception: ", e);
				if(typeof callback == 'function') { // PATCH: report the failure instead of just swallowing it
					callback({success: false, error: e.message});
				}
			}
		});
	});
	req.on('error', function(err) { // PATCH: connection-level failure (DNS, timeout, offline, ...)
		if(lastfmObj.debug)
			console.log("Exception: ", err);
		if(typeof callback == 'function') {
			callback({success: false, error: err.message});
		}
	});
};

Lastfm.prototype.scrobbleTrack = function(opt) {
	var options = this.extend(opt || {}, {method: 'track.scrobble'});
	this.doScrobble(options);
};

Lastfm.prototype.loveTrack = function(opt) {
	var options = this.extend(opt || {}, {method: 'track.love'});
	this.doScrobble(options);
};

Lastfm.prototype.unloveTrack = function(opt) {
	var options = this.extend(opt || {}, {method: 'track.unlove'});
	this.doScrobble(options);
};

Lastfm.prototype.scrobbleNowPlayingTrack = function(opt) {
	var options = this.extend(opt || {}, {method: 'track.updateNowPlaying'});
	this.doScrobble(options);
};

Lastfm.prototype.doScrobble = function(options) {
	var lastfmObj = this; // PATCH: needed so nested callbacks below can reliably reach `this.debug`
	if(this.debug)
		console.log("Starting scrobbleTrack: ", options);
	options = options || {};
	if((this.api_secret == undefined || this.api_secret == '') && typeof options.callback == 'function') {
		options.callback({
			success: false,
			error: 'API Secret not specified.'
		});
	}
	if((this.username == undefined || this.username == '') && typeof options.callback == 'function') {
		options.callback({
			success: false,
			error: 'Username not specified.'
		});
	}
	if(((this.password == undefined || this.password == '') && (this.authToken == undefined || this.authToken == '')) && typeof options.callback == 'function') {
		options.callback({
			success: false,
			error: 'Password and authentication token not specified.'
		});
	}

//	session.scrobbled = true;
	options.timestamp = options.timestamp != undefined ? Math.floor(options.timestamp) :  Math.floor(now() / 1000);

	//var timestamp =

	if(this.debug)
		console.log("Using session key: " + this.session_key + "\n\n");
	//var authToken = md5(this.username + md5(this.password));
//	console.log("authToken = " + authToken);
	var sig = 'album' + options.album + 'api_key' + this.api_key + 'artist' + options.artist + 'method' + options.method + 'sk' + this.session_key + 'timestamp' + options.timestamp + 'track' + options.track + this.api_secret;
//	console.log("sig = " + sig);
	var api_sig = md5(sig);
//	console.log("api sig = " + api_sig);

	var post_data = querystring.stringify({
		api_key: this.api_key,
		method: options.method,
		sk: this.session_key,
		api_sig: api_sig,
		timestamp: options.timestamp,
		artist: options.artist,
		track: options.track,
		album: options.album
	});

//	console.log("post_data: ", post_data);

	var post_options = {
		host: this.endpoint_url,
	      port: '80',
	      path: '/2.0/',
	      method: 'POST',
	      headers: {
	          'Content-Type': 'application/x-www-form-urlencoded',
	          'Content-Length': post_data.length
	      }
	};

	var post_req = http.request(post_options, function(res) {
		res.setEncoding('utf8');
		res.on('data', function(chunk) {
//			console.log('Response: ' + chunk);
			var parser = new xml2js.Parser(xml2js.defaults["0.1"]);
			parser.parseString(chunk, function(err, result) {
				try {
					result = safeXmlResult(err, result); // PATCH
					if (result['@'].status == 'ok') {
//						console.log("Track scrobbled (" + options.method + " )");
						if(typeof options.callback == 'function') {
							options.callback({
								success: true
							});
						}
					} else {
						if(typeof options.callback == 'function') {
							options.callback({
								success: false,
								error: result.error['#']
							});
						}
					}
				} catch(e) {
					if(lastfmObj.debug) // PATCH: was `this.debug`, `this` is not the Lastfm instance here
						console.log("Exception parsing scrobble result: ", e);
					if(typeof options.callback == 'function') { // PATCH: report the failure instead of just swallowing it
						options.callback({
							success: false,
							error: e.message
						});
					}
				}
			});
		});
	});
	post_req.on('error', function(err) { // PATCH: connection-level failure (DNS, timeout, offline, ...)
		if(lastfmObj.debug)
			console.log("Exception scrobbling: ", err);
		if(typeof options.callback == 'function') {
			options.callback({
				success: false,
				error: err.message
			});
		}
	});
	post_req.write(post_data);
	post_req.end();
};

Lastfm.prototype.getCorrection = function(opt) {
	opt = opt || {};
	if(opt.artist == undefined || opt.artist == '' && typeof opt.callback == 'function') {
		opt.callback({
			success: false,
			error: 'Artist not specified.'
		});
	} else if(opt.track == undefined || opt.track == '' && typeof opt.callback == 'function') {
		opt.callback({
			success: false,
			error: 'Track not specified.'
		});
	} else if(typeof opt.callback == 'function') {
		var the_callback = opt.callback;
		this._isTheMethodCaller = true;
		this._getCorrection(this.extend(opt, {
			callback: function(result) {
				this._isTheMethodCaller = false;
				try { // PATCH: keep an unexpected response shape from crashing the process
					if(result['@'].status == 'ok') {
						the_callback({
							success: true,
							correction: result.corrections.correction.track
						});
					} else {
						the_callback({
							success: false,
							error: result.error['#']
						});
					}
				} catch(e) {
					the_callback({success: false, error: e.message});
				}
			}
		}));
	}
};

Lastfm.prototype.getTrackInfo = function(opt) {
	opt = opt || {};
	if(opt.artist == undefined || opt.artist == '' && typeof opt.callback == 'function') {
		opt.callback({
			success: false,
			error: 'Artist not specified.'
		});
	} else if(opt.track == undefined || opt.track == '' && typeof opt.callback == 'function') {
		opt.callback({
			success: false,
			error: 'Track not specified.'
		});
	} else if(typeof opt.callback == 'function') {
		var the_callback = opt.callback;
		this._isTheMethodCaller = true;
		this._getInfo(this.extend(opt, {
			callback: function(result) {
				this._isTheMethodCaller = false;
				try { // PATCH: this is where the original crash happened (line 342): guard it
					if(result['@'].status == 'ok') {
						the_callback({
							success: true,
							trackInfo: result.track
						});
					} else {
						the_callback({
							success: false,
							error: result.error['#']
						});
					}
				} catch(e) {
					the_callback({success: false, error: e.message});
				}
			}
		}));
	}
};


Lastfm.prototype.getArtistInfo = function(opt) {
	opt = opt || {};
	opt.track = '';
	if(opt.artist == undefined || opt.artist == '' && typeof opt.callback == 'function') {
		opt.callback({
			success: false,
			error: 'Artist not specified.'
		});
	} else if(typeof opt.callback == 'function') {
		var the_callback = opt.callback;
		this._isTheMethodCaller = true;
		this._getInfo(this.extend(opt, {
			callback: function(result) {
				this._isTheMethodCaller = false;
				try { // PATCH
					if(result['@'].status == 'ok') {
						the_callback({
							success: true,
							artistInfo: result.artist
						});
					} else {
						the_callback({
							success: false,
							error: result.error['#']
						});
					}
				} catch(e) {
					the_callback({success: false, error: e.message});
				}
			}
		}));
	}
};

Lastfm.prototype.getTags = function(opt) {
	var the_callback = opt.callback;
	this._isTheMethodCaller = true;
	this._getInfo(this.extend(opt, {
		callback: function(result) {
			this._isTheMethodCaller = false;
//			console.log("result: ", result);
			if(typeof the_callback == 'function') {
				try { // PATCH
					if(result['@'].status == 'ok') {
						var tags = opt.track != undefined && opt.track != '' ? result.track.toptags.tag : result.artist.tags.tag;
						if(typeof tags == 'object' && !tags.length)
							tags = [tags];
						var args = {
								success: true,
								tags: tags || [],
								artist: opt.track != undefined && opt.track != '' ? result.track.artist.name : result.artist.name
							};
						if(opt.track != undefined && opt.track != '')
							args.track = result.track.name;
						the_callback(args);
					} else {
						the_callback({
							success: false,
							error: result.error['#']
						});
					}
				} catch(e) {
					the_callback({success: false, error: e.message});
				}
			}
		}
	}));
};

Lastfm.prototype.getPlays = function(opt) {
	var the_callback = opt.callback;
	this._isTheMethodCaller = true;
	this._getInfo(this.extend(opt, {
		callback: function(result) {
			this._isTheMethodCaller = false;
//			console.log("result: ", result);
			if(typeof the_callback == 'function') {
				try { // PATCH
					if(result['@'].status == 'ok') {
						var ret = {
							success: true,
							plays: opt.track != undefined && opt.track != '' ? result.track.userplaycount : result.artist.stats.userplaycount,
							artist: opt.track != undefined && opt.track != '' ? result.track.artist.name : result.artist.name
						};
						if(ret.plays == undefined)
							ret.plays = 0;
						if(opt.track != undefined && opt.track != '')
							ret.track = result.track.name;
						the_callback(ret);
					} else {
						the_callback({
							success: false,
							error: result.error['#']
						});
					}
				} catch(e) {
					the_callback({success: false, error: e.message});
				}
			}
		}
	}));
};

Lastfm.prototype.getTracks = function(opt) {
//	var the_callback = opt.callback;
	var page = opt.page ? opt.page : 1;
	var req = http.get({
		host: this.endpoint_url,
		port: 80,
		path: '/2.0/?method=user.getartisttracks&page=' + page + '&api_key=' + this.api_key + '&autocorrect=1&user=' + this.username + '&artist=' + encodeURIComponent(opt.artist)
	}, function(res) {
		var body = '';
		res.on('data', function(chunk) {
			body += chunk;
		});
		res.on('end', function() {
			var parser = new xml2js.Parser(xml2js.defaults["0.1"]);
			parser.parseString(body, function(err, result) {
				result = safeXmlResult(err, result); // PATCH
				if (typeof opt.callback == 'function') {
					opt.callback(result);
				}
			});
		});
		res.on('error', function(err) { // PATCH
			if (typeof opt.callback == 'function') {
				opt.callback(safeXmlResult(err, undefined));
			}
		});
	});
	req.on('error', function(err) { // PATCH
		if (typeof opt.callback == 'function') {
			opt.callback(safeXmlResult(err, undefined));
		}
	});
};

Lastfm.prototype.getAllTracks = function(opt) {
	var lastfm = this;
	var the_callback = opt.callback;
	var tracks = [];
	opt.callback = function(result) {
		try { // PATCH: result['@'] is now always defined thanks to safeXmlResult, but the nested
		      // artisttracks/track access further down can still be missing on a genuinely malformed
		      // 'ok' response, so keep this belt-and-braces.
			if(result['@'].status == 'failed' || result['@'].status !== 'ok') {
				the_callback({
					success: false,
					reason: result.error ? result.error['#'] : 'Unknown error'
				});
			} else {
				var numPages = result.artisttracks['@'].totalPages;
				for(var i=0;i<result.artisttracks.track.length;i++) {
					if(tracks.indexOf(result.artisttracks.track[i].name) < 0)
						tracks.push(result.artisttracks.track[i].name);
				}
				if(result.artisttracks['@'].page < numPages) {
					opt.page++;
					lastfm.getTracks(opt);
				} else {
					the_callback({success: true, artist: result.artisttracks['@'].artist, tracks: tracks});
				}
			}
		} catch(e) {
			the_callback({success: false, reason: e.message});
		}
	};
	opt.page = 1;
	this.getTracks(opt);
};

function now() {
	return new Date().getTime();
}

function md5(string) {
	return crypto.createHash('md5').update(string, 'utf8').digest("hex");
}

module.exports = Lastfm;
