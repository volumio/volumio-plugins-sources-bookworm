'use strict';

// Updating the plugin from the Station Manager.
//
// A version comes from one of two places. The Volumio plugin store carries the stable
// versions and, for players in Volumio's plugin test mode, the beta ones. The project's
// releases on GitHub come in two kinds: a pre-release is a preview, a version to be
// tried before it goes to the store; a release that is not a pre-release is the version
// that is stable in the store, so it stands in for the store where the store does not
// answer. The channel says which of them are offered:
//
//   stable    the newest stable version: the store's, or the one released on GitHub
//   beta      the newest version of the store, beta or stable
//   preview   the newest of all, the pre-releases on GitHub among them
//
// The player's own switch decides whether a test channel applies at all: Volumio's
// plugin test mode (Plugins Test Mode on the player's /dev page, the file
// /data/testplugins). With it off the player is on the stable channel, whatever was
// chosen; with it on, the channel chosen in the Station Manager applies. Switching it
// off again puts the player back on stable without anything else being touched.
//
// Whatever the source, the player's own plugin manager installs the version, the way
// it installs any update, and the backend is then restarted so that the new code loads.
// Before that the settings and lists are backed up and the installed version is kept as
// a zip, which goes back the same way if the user asks for it. A release from GitHub is
// downloaded here first and checked against the size and the SHA-256 digest GitHub
// states for it; nothing that fails the check is handed on.

var fs = require('fs-extra');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var execFile = require('child_process').execFile;

var RELEASES_URL = 'https://api.github.com/repos/foonerd/rtlsdr-radio/releases?per_page=10';
var ASSET = /^rtlsdr_radio-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\.zip$/;
var STAGING_DIR = '/tmp/plugins';
var SERVED_FROM = 'http://127.0.0.1:3000/plugin-serve/';
var CHANNELS = ['stable', 'beta', 'preview'];

var CHECK_TTL = 24 * 3600 * 1000;
// The shape of what a look found, as kept between starts; raised when it changes
var FOUND_FORM = 2;
var MAX_JSON_BYTES = 1024 * 1024;
var MAX_ZIP_BYTES = 128 * 1024 * 1024;
var REQUEST_TIMEOUT = 20000;
var DOWNLOAD_WAITS = [2000, 5000];

// What went wrong, as a word the page can put into the user's language
function UpdateError(code, message) {
  var error = new Error(message || code);
  error.code = code;
  error.update = true;
  return error;
}

// Dotted versions compared by their numbers; one with a suffix after a hyphen ranks
// below the same version without. Returns -1, 0 or 1; 0 as well when either is no version.
function compareVersions(a, b) {
  function split(version) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(String(version || '').trim());
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] || null] : null;
  }
  var pa = split(a);
  var pb = split(b);
  if (!pa || !pb) {
    return 0;
  }
  for (var i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  if (pa[3] === pb[3]) {
    return 0;
  }
  if (pa[3] === null) {
    return 1;
  }
  if (pb[3] === null) {
    return -1;
  }
  return pa[3] < pb[3] ? -1 : 1;
}

// What a release on GitHub offers, or null when it carries no zip of the plugin
function parseRelease(body) {
  if (!body || typeof body !== 'object' || body.draft || !Array.isArray(body.assets)) {
    return null;
  }
  for (var i = 0; i < body.assets.length; i++) {
    var asset = body.assets[i];
    var name = ASSET.exec(String(asset.name || ''));
    if (!name) {
      continue;
    }
    var digest = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest || ''));
    return {
      source: 'github',
      channel: 'preview',
      version: name[1],
      url: String(asset.browser_download_url || ''),
      bytes: Number(asset.size) || 0,
      sha256: digest ? digest[1] : null,
      prerelease: !!body.prerelease,
      notes: String(body.body || '').slice(0, 20000),
      page: String(body.html_url || ''),
      publishedAt: body.published_at || null
    };
  }
  return null;
}

// The newest of the releases GitHub lists, by version: { released, preview }.
// released: the newest that is not a pre-release, the version stable in the store.
// preview: the newest pre-release, if it is newer than that.
function newestReleases(list) {
  if (!Array.isArray(list)) {
    throw UpdateError('bad-answer', 'the releases answer is not a list');
  }
  var newest = { released: null, preview: null };
  list.forEach(function(body) {
    var release = parseRelease(body);
    if (!release) {
      return;
    }
    var kind = release.prerelease ? 'preview' : 'released';
    release.channel = release.prerelease ? 'preview' : 'stable';
    if (!newest[kind] || compareVersions(release.version, newest[kind].version) > 0) {
      newest[kind] = release;
    }
  });
  if (newest.preview && newest.released && compareVersions(newest.preview.version, newest.released.version) <= 0) {
    newest.preview = null;
  }
  return newest;
}

// The version offered on a channel. store: [{ version, channel, url }]; github:
// { released, preview }. The store's copy is taken when both carry the same version.
function offerFor(channel, store, github) {
  var best = null;
  function consider(candidate) {
    if (candidate && (!best || compareVersions(candidate.version, best.version) > 0)) {
      best = candidate;
    }
  }
  (store || []).forEach(function(version) {
    if (version.channel === 'stable' || channel !== 'stable') {
      consider({ source: 'store', channel: version.channel, version: version.version, url: version.url });
    }
  });
  consider(github && github.released);
  if (channel === 'preview') {
    consider(github && github.preview);
  }
  return best;
}

// The newest version each channel carries by itself, for the page to show
function newestPerChannel(store, github) {
  var newest = {
    stable: github && github.released ? github.released.version : null,
    beta: null,
    preview: github && github.preview ? github.preview.version : null
  };
  (store || []).forEach(function(version) {
    var channel = version.channel === 'stable' ? 'stable' : 'beta';
    if (!newest[channel] || compareVersions(version.version, newest[channel]) > 0) {
      newest[channel] = version.version;
    }
  });
  return newest;
}

// --- the network, replaceable for tests -------------------------------------------------

function request(url, headers, redirects) {
  return new Promise(function(resolve, reject) {
    var client = /^https:/i.test(url) ? https : http;
    var options = { timeout: REQUEST_TIMEOUT, headers: Object.assign({ 'User-Agent': 'rtlsdr_radio (Volumio plugin)' }, headers) };
    var req = client.get(url, options, function(response) {
      var status = response.statusCode;
      if (status >= 300 && status < 400 && response.headers.location && (redirects || 0) < 5) {
        response.resume();
        resolve(request(new URL(response.headers.location, url).toString(), headers, (redirects || 0) + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(Object.assign(new Error('HTTP ' + status + ' for ' + url), { status: status }));
        return;
      }
      resolve(response);
    });
    req.on('timeout', function() { req.destroy(new Error('timeout for ' + url)); });
    req.on('error', reject);
  });
}

function json(url) {
  return request(url, { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }).then(function(response) {
    return new Promise(function(resolve, reject) {
      var chunks = [];
      var size = 0;
      response.on('data', function(chunk) {
        size += chunk.length;
        if (size > MAX_JSON_BYTES) {
          response.destroy(new Error('answer larger than ' + MAX_JSON_BYTES + ' bytes'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', function() {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(UpdateError('bad-answer', 'the answer is not JSON'));
        }
      });
    });
  });
}

// Fetch a file. Resolves with { bytes, sha256 } of what was written; never more than
// limit bytes are taken.
function download(url, file, limit, onProgress) {
  return request(url, { accept: 'application/octet-stream' }).then(function(response) {
    return new Promise(function(resolve, reject) {
      var hash = crypto.createHash('sha256');
      var out = fs.createWriteStream(file);
      var bytes = 0;
      function failed(error) {
        response.destroy();
        out.destroy();
        reject(error);
      }
      out.on('error', failed);
      response.on('error', failed);
      response.on('data', function(chunk) {
        bytes += chunk.length;
        if (bytes > limit) {
          failed(new Error('more than the ' + limit + ' bytes expected'));
          return;
        }
        hash.update(chunk);
        if (onProgress) {
          onProgress(bytes);
        }
      });
      response.pipe(out);
      out.on('finish', function() {
        resolve({ bytes: bytes, sha256: hash.digest('hex') });
      });
    });
  });
}

// The installed plugin as a zip, without what is not the plugin's own (the links to
// the station logos and to the stations' pictures)
function zipFolder(folder, file) {
  return new Promise(function(resolve, reject) {
    execFile('zip', ['-q', '-r', '-y', file, '.', '-x', 'logos', 'logos/*', 'slides', 'slides/*'], { cwd: folder, maxBuffer: 1024 * 1024 }, function(error) {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// --- the updater ------------------------------------------------------------------------

// options.dir: where the kept zip and the state live
// options.version: the version running
// options.pluginPath: the installed plugin's folder
// options.channel(): the channel chosen for when the player is in plugin test mode
// options.plugin: what the plugin does for the updater:
//   storeVersions(): Promise of [{ version, channel, url }]   the store's versions for this player
//   testMode(): whether the player is in Volumio's plugin test mode
//   backup(label): back up settings and lists
//   apply(url): Promise; the player's plugin manager installs the zip at the url
//   restart(): restart the backend
function Updater(options) {
  this.dir = options.dir;
  this.version = options.version;
  this.pluginPath = options.pluginPath;
  this.plugin = options.plugin;
  this.channel = options.channel || function() { return 'stable'; };
  this.logger = options.logger || { info: function() {}, error: function() {} };
  this.network = options.network || { json: json, download: download };
  this.releasesUrl = options.releasesUrl || RELEASES_URL;
  this.zip = options.zip || zipFolder;
  this.stagingDir = options.stagingDir || STAGING_DIR;
  this.waits = options.waits || DOWNLOAD_WAITS;

  this.found = null;       // { checkedAt, store, github, problems }
  this.state = {};         // { previous, last }
  this.job = null;         // { kind, state, progress, error }

  try {
    fs.ensureDirSync(this.dir);
    var found = fs.readJsonSync(path.join(this.dir, 'found.json'));
    if (found && found.checkedAt && found.form === FOUND_FORM) {
      this.found = found;
    }
  } catch (e) {
    // not looked yet
  }
  try {
    var state = fs.readJsonSync(path.join(this.dir, 'state.json'));
    if (state && typeof state === 'object') {
      this.state = state;
    }
  } catch (e) {
    // nothing kept yet
  }

  // An update that was restarting the backend when this code loaded: did it take?
  var last = this.state.last;
  if (last && last.phase === 'restarting') {
    last.phase = 'done';
    last.ok = last.to === this.version;
    last.endedAt = new Date().toISOString();
    this._saveState();
    this.logger.info('[RTL-SDR Radio] Update from ' + last.from + ' to ' + last.to +
      (last.ok ? ' took' : ' did not take; running ' + this.version));
  }
}

Updater.prototype._write = function(name, data) {
  try {
    fs.ensureDirSync(this.dir);
    var file = path.join(this.dir, name);
    fs.writeJsonSync(file + '.tmp', data);
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    this.logger.info('[RTL-SDR Radio] Update: cannot write ' + name + ': ' + e.message);
  }
};

Updater.prototype._saveState = function() {
  this._write('state.json', this.state);
};

// The channel chosen in the Station Manager
Updater.prototype.chosenChannel = function() {
  var channel = this.channel();
  return CHANNELS.indexOf(channel) === -1 ? 'stable' : channel;
};

// The channel in force: the one chosen on a player in plugin test mode, stable on any other
Updater.prototype.currentChannel = function() {
  return this.plugin.testMode() ? this.chosenChannel() : 'stable';
};

// Look at the store and at GitHub: when the last look is older than a day, or when
// asked to. A source that does not answer is noted and leaves what the other one says
// standing. Resolves with the view.
Updater.prototype.check = function(force) {
  var self = this;
  var fresh = self.found && Date.now() - new Date(self.found.checkedAt).getTime() < CHECK_TTL &&
    self.found.channel === self.currentChannel();
  if (!force && fresh) {
    return Promise.resolve(self.view());
  }
  if (self.checking) {
    return self.checking;
  }

  var channel = self.currentChannel();
  var found = { form: FOUND_FORM, checkedAt: new Date().toISOString(), channel: channel, store: [], github: { released: null, preview: null }, problems: {} };

  var store = Promise.resolve().then(function() {
    return self.plugin.storeVersions();
  }).then(function(versions) {
    found.store = versions || [];
  }, function(error) {
    found.problems.store = error && error.code || 'network';
    self.logger.info('[RTL-SDR Radio] Update: the store did not answer: ' + (error && error.message || error));
  });

  var github = self.network.json(self.releasesUrl).then(function(list) {
    found.github = newestReleases(list);
  }).catch(function(error) {
    found.problems.github = error && error.code || 'network';
    self.logger.info('[RTL-SDR Radio] Update: GitHub did not answer: ' + (error && error.message || error));
  });

  self.checking = Promise.all([store, github]).then(function() {
    self.checking = null;
    self.found = found;
    self._write('found.json', found);
    return self.view();
  });
  return self.checking;
};

Updater.prototype.offer = function() {
  if (!this.found) {
    return null;
  }
  return offerFor(this.currentChannel(), this.found.store, this.found.github);
};

Updater.prototype.previous = function() {
  var previous = this.state.previous;
  if (!previous || !previous.zip || !fs.existsSync(previous.zip)) {
    return null;
  }
  return { version: previous.version, at: previous.at };
};

// What the page shows
Updater.prototype.view = function() {
  var offer = this.offer();
  var found = this.found || {};
  return {
    current: this.version,
    channel: this.currentChannel(),
    chosen: this.chosenChannel(),
    testMode: !!this.plugin.testMode(),
    checkedAt: found.checkedAt || null,
    offer: offer ? {
      version: offer.version,
      channel: offer.channel,
      source: offer.source,
      notes: offer.notes || '',
      page: offer.page || '',
      bytes: offer.bytes || 0,
      publishedAt: offer.publishedAt || null
    } : null,
    available: !!(offer && compareVersions(offer.version, this.version) > 0),
    newest: newestPerChannel(found.store, found.github),
    problems: found.problems || {},
    previous: this.previous(),
    last: this.state.last || null,
    job: this.job ? { kind: this.job.kind, state: this.job.state, progress: this.job.progress || null, error: this.job.error || null } : null
  };
};

Updater.prototype.busy = function() {
  return !!this.job && ['failed', 'restarting'].indexOf(this.job.state) === -1;
};

// Install the version offered. The work goes on after this returns; the view tells
// how far it is. Rejects at once when there is nothing to install.
Updater.prototype.install = function() {
  var self = this;
  if (self.busy()) {
    return Promise.reject(UpdateError('busy', 'an update is under way'));
  }
  var offer = self.offer();
  if (!offer) {
    return Promise.reject(UpdateError('no-offer', 'no version is known; check first'));
  }
  if (compareVersions(offer.version, self.version) <= 0) {
    return Promise.reject(UpdateError('up-to-date', self.version + ' is the newest on this channel'));
  }
  if (offer.source === 'github') {
    if (!offer.sha256) {
      return Promise.reject(UpdateError('no-digest', 'the release states no checksum for its zip'));
    }
    if (!offer.bytes || offer.bytes > MAX_ZIP_BYTES) {
      return Promise.reject(UpdateError('bad-answer', 'the release zip has an unusable size'));
    }
  }

  var job = self.job = { kind: 'install', state: 'starting', progress: null };
  var staged = offer.source === 'github' ? self._fetch(offer, job) : Promise.resolve(offer.url);
  self._run(job, staged, offer.version, offer.source);
  return Promise.resolve(self.view());
};

// Put back the version that was installed before the last update
Updater.prototype.rollback = function() {
  var self = this;
  if (self.busy()) {
    return Promise.reject(UpdateError('busy', 'an update is under way'));
  }
  var previous = self.state.previous;
  if (!self.previous()) {
    return Promise.reject(UpdateError('no-previous', 'no previous version is kept'));
  }
  var job = self.job = { kind: 'rollback', state: 'starting', progress: null };
  var name = 'rtlsdr_radio-' + previous.version + '.zip';
  var staged = Promise.resolve().then(function() {
    fs.ensureDirSync(self.stagingDir);
    fs.copySync(previous.zip, path.join(self.stagingDir, name));
    return SERVED_FROM + name;
  });
  self._run(job, staged, previous.version, 'kept');
  return Promise.resolve(self.view());
};

// A release's zip fetched into the staging folder and checked against what the release
// states: its size and its digest. A connection that breaks has the download made
// again from its first byte. Resolves with the address the plugin manager takes it from.
Updater.prototype._fetch = function(release, job) {
  var self = this;
  var name = 'rtlsdr_radio-' + release.version + '.zip';
  var file = path.join(self.stagingDir, name);
  var attempt = 0;

  function once() {
    job.state = 'downloading';
    job.progress = { done: 0, total: release.bytes };
    return self.network.download(release.url, file + '.part', release.bytes, function(done) {
      job.progress = { done: done, total: release.bytes };
    }).then(function(got) {
      job.state = 'verifying';
      if (got.bytes !== release.bytes) {
        throw UpdateError('size', 'downloaded ' + got.bytes + ' bytes, the release states ' + release.bytes);
      }
      if (got.sha256 !== release.sha256) {
        throw UpdateError('checksum', 'the download does not match the checksum the release states');
      }
    }, function(error) {
      // The connection, not the content: worth another go
      if (attempt >= self.waits.length) {
        throw UpdateError('network', error.message);
      }
      var wait = self.waits[attempt++];
      self.logger.info('[RTL-SDR Radio] Update: the download broke (' + error.message + '); made again in ' + (wait / 1000) + ' s');
      return sleep(wait).then(once);
    });
  }

  fs.ensureDirSync(self.stagingDir);
  return once().then(function() {
    fs.renameSync(file + '.part', file);
    return SERVED_FROM + name;
  }).catch(function(error) {
    fs.removeSync(file + '.part');
    fs.removeSync(file);
    throw error;
  });
};

// From a staged zip to the restart: settings and lists backed up, the installed
// version kept as a zip, the plugin manager's update, the restart.
Updater.prototype._run = function(job, staged, version, source) {
  var self = this;

  staged.then(function(url) {
    job.state = 'backing-up';
    job.progress = null;
    try {
      self.plugin.backup('before-' + version);
    } catch (e) {
      // Said, and no reason to stop: the lists are not in the folder that is replaced
      self.logger.info('[RTL-SDR Radio] Update: backup: ' + e.message);
    }

    job.state = 'keeping';
    var kept = path.join(self.dir, 'previous-' + self.version + '.zip');
    return self.zip(self.pluginPath, kept + '.tmp').then(function() {
      fs.renameSync(kept + '.tmp', kept);
      var before = self.state.previous && self.state.previous.zip;
      if (before && before !== kept) {
        fs.removeSync(before);
      }
      self.state.previous = { version: self.version, zip: kept, at: new Date().toISOString() };
    }, function(error) {
      // Without the kept zip there is no way back, and the user was promised one
      fs.removeSync(kept + '.tmp');
      throw UpdateError('keep', 'the installed version could not be kept: ' + error.message);
    }).then(function() {
      self.state.last = { from: self.version, to: version, source: source, at: new Date().toISOString(), phase: 'applying' };
      self._saveState();
      job.state = 'applying';
      self.logger.info('[RTL-SDR Radio] Update: ' + self.version + ' to ' + version + ' (' + source + '), handed to the plugin manager');
      return self.plugin.apply(url).catch(function(error) {
        throw UpdateError('apply', error && error.message || String(error));
      });
    }).then(function() {
      self.state.last.phase = 'restarting';
      self._saveState();
      job.state = 'restarting';
      job.target = version;
      self.plugin.restart();
    });
  }).catch(function(error) {
    job.state = 'failed';
    job.error = { code: error && error.code && error.update ? error.code : 'failed', message: error && error.message || String(error) };
    if (self.state.last && self.state.last.phase === 'applying') {
      self.state.last.phase = 'failed';
      self.state.last.error = job.error.message;
      self._saveState();
    }
    self.logger.error('[RTL-SDR Radio] Update failed: ' + job.error.message);
  });
};

module.exports = Updater;
module.exports.CHANNELS = CHANNELS;
module.exports.compareVersions = compareVersions;
module.exports.parseRelease = parseRelease;
module.exports.newestReleases = newestReleases;
module.exports.offerFor = offerFor;
module.exports.newestPerChannel = newestPerChannel;
module.exports.UpdateError = UpdateError;
module.exports.SERVED_FROM = SERVED_FROM;
module.exports.network = { json: json, download: download };
