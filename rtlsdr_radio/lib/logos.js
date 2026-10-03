'use strict';

// The station logos kept on the player.
//
// Logos come from the broadcasters (lib/radiodns.js) and are fetched when they are wanted:
// when a station is played or listed, and for the whole station list after a start and
// after a scan. The work is done one station at a time, in this order: the station asked
// for now, the stations without a logo, and, only when the user asks for it, a check of
// the logos already kept for newer versions.
//
// Without a network nothing is fetched and nothing is concluded: the work waits, looks
// again from time to time, and carries on when the network is back. A station is noted
// as having no logo only on the broadcasters' own word.
//
// A station without a logo of its own is shown with the logo of its broadcaster, when
// the broadcaster publishes one.
//
// The pictures are kept outside the plugin's folder, which an update of the plugin
// empties, and are reached through a link in that folder, because Volumio's artwork
// endpoint serves pictures to every screen from there.

var fs = require('fs-extra');
var path = require('path');
var radiodns = require('./radiodns');

var STORE = '/data/rtlsdr_radio_logos';
var LINK = path.join(__dirname, '..', 'logos');
var ICON_PREFIX = 'music_service/rtlsdr_radio/logos/';

// A station whose broadcaster lists no logo is asked about again after a week
var RETRY_AFTER = 7 * 24 * 3600 * 1000;

// A fetch that failed although the network is there (the broadcaster's server is in
// trouble) is not tried again for a while. Kept in memory only.
var FAILED_WAIT = 15 * 60 * 1000;

// How long a passed check of the network is taken for granted
var ONLINE_FOR = 60 * 1000;

// Without a network: how long to wait before looking again, each time a little longer
var OFFLINE_WAITS = [30000, 60000, 120000, 300000, 600000];

// The order of the work
var NOW = 0;
var MISSING = 1;
var FOLLOW_UP = 2;
var REFRESH = 3;

// options.stations(): the DAB stations as they are now
// options.region(): the listener's region setting
// options.onLogo(): a picture has arrived
function Logos(options) {
  options = options || {};
  this.dir = options.dir || STORE;
  this.link = options.link === undefined ? LINK : options.link;
  this.lookup = options.lookup || new radiodns.Lookup();
  this.logger = options.logger || { info: function() {}, error: function() {} };
  this.stations = options.stations || function() { return []; };
  this.region = options.region || function() { return 'europe'; };
  this.onLogo = options.onLogo || function() {};
  this.waits = options.waits || OFFLINE_WAITS;

  this.queue = [];
  this.queued = {};
  this.failed = {};
  this.working = false;
  this.timer = null;
  this.attempt = 0;
  this.onlineAt = 0;
  this.review = false;
  this.fetched = 0;
  this.leads = null;

  this.index = { logos: {}, misses: {}, gcc: {}, member: {}, groups: {}, directory: {} };
  try {
    var stored = fs.readJsonSync(path.join(this.dir, 'index.json'));
    Object.keys(this.index).forEach(function(part) {
      this.index[part] = stored[part] || {};
    }, this);
  } catch (e) {
    // nothing kept yet
  }

  var self = this;
  this.lookup.onList = function(url, xml) {
    self._absorb(url, xml);
  };
  this.prepare();
}

// The folder of the pictures, and the link to it that Volumio serves them through.
// Done again at every start of the plugin: an update takes the link away with the folder.
Logos.prototype.prepare = function() {
  try {
    fs.ensureDirSync(this.dir);
    if (!this.link) {
      return;
    }
    var found = null;
    try {
      found = fs.lstatSync(this.link);
    } catch (e) {
      // not there yet
    }
    if (found && found.isSymbolicLink() && fs.readlinkSync(this.link) === this.dir) {
      return;
    }
    if (found) {
      fs.removeSync(this.link);
    }
    fs.symlinkSync(this.dir, this.link);
  } catch (e) {
    this.logger.info('[RTL-SDR Radio] Logos: cannot prepare ' + this.dir + ': ' + e.message);
  }
};

function clean(value) {
  var text = String(value || '').toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{4,8}$/.test(text) ? text : null;
}

// The name a DAB station's logo is kept under, or null when the station lacks the
// identifiers (a station typed in by hand, for one).
Logos.prototype.dabKey = function(station) {
  var eid = station && clean(station.ensembleId);
  var sid = station && clean(station.serviceId);
  return eid && sid && sid !== '0000' ? 'dab-' + eid + '-' + sid : null;
};

Logos.prototype._file = function(entry) {
  return entry && entry.file && fs.existsSync(path.join(this.dir, entry.file)) ? entry.file : null;
};

// The picture to hand to Volumio's artwork endpoint (sourceicon) for a station: its own
// logo, failing that its broadcaster's, or null when neither is kept.
Logos.prototype.icon = function(station) {
  var key = this.dabKey(station);
  var file = key && this._file(this.index.logos[key]);
  if (!file) {
    var group = this._groupOf(key, station);
    file = group && this._file(this.index.groups[group]);
  }
  return file ? ICON_PREFIX + file : null;
};

Logos.prototype._save = function() {
  this.leads = null;
  try {
    fs.ensureDirSync(this.dir);
    var file = path.join(this.dir, 'index.json');
    fs.writeJsonSync(file + '.tmp', this.index);
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    this.logger.info('[RTL-SDR Radio] Logos: cannot write the index: ' + e.message);
  }
};

Logos.prototype._failedLately = function(id) {
  return !!this.failed[id] && Date.now() - this.failed[id] < FAILED_WAIT;
};

// Whether a lookup is due for a station: no logo of its own is kept, and it was not
// asked about in vain lately
Logos.prototype._due = function(key) {
  if (!key || this._file(this.index.logos[key])) {
    return false;
  }
  var missed = this.index.misses[key];
  if (missed && Date.now() - missed < RETRY_AFTER) {
    return false;
  }
  return !this._failedLately('station:' + key);
};

// --- what is asked of the store ---------------------------------------------------------

// A station is being shown or played: fetch its logo if that is due.
// options.now: it is on the screen now, so it goes before everything else.
Logos.prototype.want = function(station, options) {
  var key = this.dabKey(station);
  if (!this._due(key)) {
    return false;
  }
  var now = !!(options && options.now);
  this._enqueue({ kind: 'station', key: key, station: station, rank: now ? NOW : MISSING });
  if (now && this.timer) {
    // Worth a look at the network right away
    clearTimeout(this.timer);
    this.timer = null;
  }
  this._kick();
  return true;
};

// Fetch whatever is due for the whole station list
Logos.prototype.sweep = function() {
  var self = this;
  self.stations().forEach(function(station) {
    if (station && !station.deleted && self._due(self.dabKey(station))) {
      self._enqueue({ kind: 'station', key: self.dabKey(station), station: station, rank: MISSING });
    }
  });
  self.leads = null;
  self.review = true;
  self._kick();
};

// The user asks for the logos to be brought up to date: every station without one is
// asked about again, whatever was found before, and then the logos kept are checked
// for newer versions.
Logos.prototype.refresh = function() {
  var self = this;
  self.failed = {};
  self.stations().forEach(function(station) {
    var key = self.dabKey(station);
    if (!station || station.deleted || !key) {
      return;
    }
    if (self._file(self.index.logos[key])) {
      self._enqueue({ kind: 'station', key: key, station: station, rank: REFRESH, refresh: true });
    } else {
      delete self.index.misses[key];
      self._enqueue({ kind: 'station', key: key, station: station, rank: MISSING });
    }
  });
  Object.keys(self.index.groups).forEach(function(id) {
    if (self._file(self.index.groups[id])) {
      self._enqueue({ kind: 'group', key: id, rank: REFRESH, refresh: true });
    }
  });
  self.leads = null;
  self.review = true;
  self.attempt = 0;
  if (self.timer) {
    clearTimeout(self.timer);
    self.timer = null;
  }
  self._kick();
  return self.status();
};

// How things stand: { state: 'idle' | 'fetching' | 'waiting', queued, stations, own, group, none }
Logos.prototype.status = function() {
  var self = this;
  var status = {
    state: self.timer ? 'waiting' : (self.working ? 'fetching' : 'idle'),
    queued: self.queue.length,
    stations: 0,
    own: 0,
    group: 0,
    none: 0
  };
  self.stations().forEach(function(station) {
    if (!station || station.deleted) {
      return;
    }
    var key = self.dabKey(station);
    status.stations++;
    if (key && self._file(self.index.logos[key])) {
      status.own++;
    } else if (self.icon(station)) {
      status.group++;
    } else {
      status.none++;
    }
  });
  return status;
};

// The plugin is stopping: leave what is not done yet
Logos.prototype.stop = function() {
  if (this.timer) {
    clearTimeout(this.timer);
    this.timer = null;
  }
  this.queue = [];
  this.queued = {};
  this.review = false;
  this.attempt = 0;
};

// --- the work ---------------------------------------------------------------------------

Logos.prototype._enqueue = function(job) {
  job.id = job.kind + ':' + job.key;
  var waiting = this.queued[job.id];
  if (waiting) {
    if (waiting.rank <= job.rank) {
      return;
    }
    this.queue.splice(this.queue.indexOf(waiting), 1);
  }
  var at = 0;
  while (at < this.queue.length && this.queue[at].rank <= job.rank) {
    at++;
  }
  this.queue.splice(at, 0, job);
  this.queued[job.id] = job;
};

Logos.prototype._kick = function() {
  if (this.working || this.timer) {
    return;
  }
  this.working = true;
  this._step();
};

Logos.prototype._step = function() {
  var self = this;

  if (self.queue.length === 0 && self.review) {
    self.review = false;
    self._followUp();
  }
  if (self.queue.length === 0) {
    self.working = false;
    self.lookup.forget();
    if (self.fetched > 0) {
      self.logger.info('[RTL-SDR Radio] Logos: ' + self.fetched + ' fetched');
      self.fetched = 0;
    }
    return;
  }

  self._online().then(function(online) {
    if (!online) {
      self._wait();
      return;
    }
    var job = self.queue.shift();
    if (!job) {
      // Dropped in the meantime: the plugin is stopping
      return self._step();
    }
    delete self.queued[job.id];
    return self._work(job).then(function() {
      self._step();
    });
  }).catch(function(error) {
    self.working = false;
    self.logger.info('[RTL-SDR Radio] Logos: stopped: ' + (error && error.message || error));
  });
};

Logos.prototype._online = function() {
  var self = this;
  if (Date.now() - self.onlineAt < ONLINE_FOR) {
    return Promise.resolve(true);
  }
  return self.lookup.reachable().then(function(online) {
    if (online) {
      if (self.attempt > 0) {
        self.logger.info('[RTL-SDR Radio] Logos: the network is back, carrying on');
        self.attempt = 0;
      }
      self.onlineAt = Date.now();
    }
    return online;
  });
};

// No network: look again later. Said once, not at every look.
Logos.prototype._wait = function() {
  var self = this;
  if (self.attempt === 0) {
    self.logger.info('[RTL-SDR Radio] Logos: no network, ' + self.queue.length + ' to fetch when it is back');
  }
  var wait = self.waits[Math.min(self.attempt, self.waits.length - 1)];
  self.attempt++;
  self.working = false;
  self.timer = setTimeout(function() {
    self.timer = null;
    self._kick();
  }, wait);
  if (self.timer.unref) {
    self.timer.unref();
  }
};

Logos.prototype._work = function(job) {
  var self = this;
  var work;
  try {
    if (job.kind === 'station') {
      work = self._fetchStation(job);
    } else if (job.kind === 'listed') {
      work = self._keep(job.key, [job.url], false);
    } else {
      work = self._keepGroup(job.key, job.refresh);
    }
  } catch (error) {
    work = Promise.reject(error);
  }

  return work.catch(function(error) {
    if (gone(error)) {
      self._unavailable(job, error);
      return;
    }
    // The network, or this one server? Only the network is worth waiting for.
    self.onlineAt = 0;
    return self.lookup.reachable().then(function(online) {
      if (!online) {
        self._enqueue(job);
        return;
      }
      self.onlineAt = Date.now();
      self.failed[job.id] = Date.now();
      self.logger.info('[RTL-SDR Radio] Logos: ' + job.key + ' not fetched: ' + (error && error.message || error));
    });
  });
};

// A picture that is listed but is not to be had: the server says so (not found, gone,
// refused), or what it sends is not a picture that can be shown
function gone(error) {
  if (!error) {
    return false;
  }
  return !!error.unusable || (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429);
}

// The broadcaster lists pictures it does not have. That is its answer for now, and is
// asked about again when the others are: after a week, at a refresh, or when its list
// is next fetched.
Logos.prototype._unavailable = function(job, error) {
  var self = this;
  self.logger.info('[RTL-SDR Radio] Logos: ' + job.key + ': the logo listed is not to be had: ' + (error && error.message || error));
  if (job.kind === 'group') {
    self.index.groups[job.key].url = null;
  } else if (!job.refresh) {
    self.index.misses[job.key] = Date.now();
  }
  if (job.kind === 'listed') {
    Object.keys(self.index.directory).forEach(function(name) {
      if (self.index.directory[name] === job.url) {
        delete self.index.directory[name];
      }
    });
  }
  self._save();
};

Logos.prototype._fetchStation = function(job) {
  var self = this;
  var key = job.key;
  var eid = clean(job.station.ensembleId);
  var sid = clean(job.station.serviceId);

  var known = self._country(eid, sid);
  var candidates = radiodns.dabCandidates(eid, sid, self.region(), known);
  // Once the country is known, that is the only name worth asking for
  if (known) {
    candidates = candidates.filter(function(candidate) { return candidate.gcc === known; });
  }

  return self.lookup.find(candidates).then(function(found) {
    if (found) {
      self.index.gcc[eid] = found.gcc;
      self.index.member[key] = found.list;
    }
    var urls = found ? found.logos.map(function(logo) { return logo.url; }) : [];
    if (urls.length === 0 && self._listed(eid, sid)) {
      urls = [self._listed(eid, sid)];
    }
    if (urls.length > 0) {
      return self._keep(key, urls, job.refresh);
    }
    if (job.refresh) {
      // The logo kept stays, whatever the broadcaster lists today
      self._save();
      return;
    }
    if (found) {
      // The broadcaster's own list has no logo for it
      self.index.misses[key] = Date.now();
      self._save();
      return;
    }
    // Nobody answers for the station. That is the broadcasters' word only if the
    // network was still there when the last name was asked for: a network that has
    // just gone, or a hotspot that took its place, is silent in the same way.
    return self.lookup.reachable().then(function(online) {
      if (!online) {
        throw new Error('no network');
      }
      self.onlineAt = Date.now();
      self.index.misses[key] = Date.now();
      self._save();
    });
  });
};

// The country code of a service, as far as it is known: from another service of its
// ensemble, failing that from any service that shares its country digit. Countries
// within reach of one another never share a digit, so one station found settles the
// code for all that start with the same digit, and spares each of them a search
// through every code there is.
Logos.prototype._country = function(eid, sid) {
  var codes = this.index.gcc;
  if (codes[eid]) {
    return codes[eid];
  }
  if (sid.length === 8) {
    return null;   // the service id itself carries the code
  }
  var count = {};
  var best = null;
  Object.keys(codes).forEach(function(ensemble) {
    var code = codes[ensemble];
    if (code[0] === sid[0]) {
      count[code] = (count[code] || 0) + 1;
      if (!best || count[code] > count[best]) {
        best = code;
      }
    }
  });
  return best;
};

// The logo a broadcaster lists for a service on whatever ensemble: a service id names
// the same station everywhere in its country.
Logos.prototype._listed = function(eid, sid) {
  var directory = this.index.directory;
  var gcc = sid.length === 8 ? sid[2] + sid.slice(0, 2) : this._country(eid, sid);
  if (gcc) {
    return directory[gcc + '.' + sid] || null;
  }
  // The ensemble's country is not known: the service id's first digit narrows it down,
  // and the logo is taken only when that leaves one answer
  var matches = Object.keys(directory).filter(function(name) {
    return name[0] === sid[0] && name.slice(4) === sid;
  });
  return matches.length === 1 ? directory[matches[0]] : null;
};

// Fetch a picture and keep it under the given name. refresh: a copy is kept already and
// is replaced only by a newer one.
Logos.prototype._store = function(name, url, held, refresh) {
  var self = this;
  var known = null;
  if (refresh && held && held.url === url && self._file(held) && (held.etag || held.modified)) {
    known = { etag: held.etag, modified: held.modified };
  }
  return self.lookup.fetchImage(url, known).then(function(image) {
    if (image.unchanged) {
      return null;
    }
    fs.ensureDirSync(self.dir);
    var file = name + '.' + image.extension;
    // Not every server says when it has nothing newer: the same picture again is left alone
    if (held && held.file === file && self._file(held) && image.body.equals(fs.readFileSync(path.join(self.dir, file)))) {
      return null;
    }
    fs.writeFileSync(path.join(self.dir, file + '.tmp'), image.body);
    fs.renameSync(path.join(self.dir, file + '.tmp'), path.join(self.dir, file));
    if (held && held.file && held.file !== file) {
      fs.removeSync(path.join(self.dir, held.file));
    }
    return { file: file, url: url, fetched: new Date().toISOString(), etag: image.etag, modified: image.modified };
  });
};

// Keep a station's logo: the first of the pictures listed that is to be had
Logos.prototype._keep = function(key, urls, refresh) {
  var self = this;

  function from(at) {
    return self._store(key, urls[at], self.index.logos[key], refresh).catch(function(error) {
      if (gone(error) && at + 1 < urls.length) {
        return from(at + 1);
      }
      throw error;
    });
  }

  return from(0).then(function(kept) {
    if (kept) {
      self.index.logos[key] = kept;
      self.fetched++;
    }
    if (kept || self.index.misses[key]) {
      delete self.index.misses[key];
      self._save();
    }
    if (kept) {
      self.onLogo();
    }
  });
};

Logos.prototype._keepGroup = function(id, refresh) {
  var self = this;
  var group = self.index.groups[id];
  if (!group || !group.url) {
    return Promise.resolve();
  }
  var name = 'group-' + id.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/[^a-z0-9.-]/gi, '_');
  return self._store(name, group.url, group, refresh).then(function(kept) {
    if (kept) {
      group.file = kept.file;
      group.fetched = kept.fetched;
      group.etag = kept.etag;
      group.modified = kept.modified;
      self.fetched++;
      self._save();
      self.onLogo();
    }
  });
};

// A broadcaster's list has been fetched: note what it says of the broadcaster and which
// services it lists with a logo
Logos.prototype._absorb = function(url, xml) {
  var provider = radiodns.providerOf(xml);
  var group = this.index.groups[url] || {};
  if (group.url !== provider.logo) {
    // Another picture than the one kept: the next refresh fetches it whole
    delete group.etag;
    delete group.modified;
  }
  group.names = provider.names;
  group.leads = provider.leads;
  group.url = provider.logo;
  this.index.groups[url] = group;

  var services = radiodns.dabServicesOf(xml);
  Object.keys(services).forEach(function(name) {
    this.index.directory[name] = services[name];
  }, this);

  this.review = true;
  this._save();
};

// When the lookups are done: stations still without a logo may be listed by their
// broadcaster under another ensemble, or may be shown with their broadcaster's logo,
// which is fetched when a station first needs it.
Logos.prototype._followUp = function() {
  var self = this;
  self.stations().forEach(function(station) {
    if (!station || station.deleted) {
      return;
    }
    var key = self.dabKey(station);
    if (key) {
      if (self._file(self.index.logos[key])) {
        return;
      }
      // A station registered under its own ensemble has had its broadcaster's answer
      var url = !self.index.member[key] && self._listed(clean(station.ensembleId), clean(station.serviceId));
      if (url && !self._failedLately('listed:' + key)) {
        self._enqueue({ kind: 'listed', key: key, url: url, rank: FOLLOW_UP });
        return;
      }
    }
    var group = self._groupOf(key, station);
    if (group && self.index.groups[group].url && !self._file(self.index.groups[group]) &&
        !self._failedLately('group:' + group)) {
      self._enqueue({ kind: 'group', key: group, rank: FOLLOW_UP });
    }
  });
};

// --- the broadcaster a station belongs to -----------------------------------------------

// The name a station is broadcast under, not what the user may have renamed it to
function broadcastName(station) {
  return String((station && (station.name || station.exactName)) || '').trim();
}

// The names that mark a station as a broadcaster's: { '<name, lower case>': group }.
// A broadcaster's name counts when its own stations carry it in front (the list says so),
// and when no station here that is known to be another broadcaster's carries it too.
Logos.prototype._leads = function() {
  var self = this;
  if (self.leads) {
    return self.leads;
  }
  var leads = {};
  Object.keys(self.index.groups).forEach(function(id) {
    (self.index.groups[id].leads || []).forEach(function(lead) {
      var name = lead.toLowerCase();
      leads[name] = name in leads ? null : id;
    });
  });
  self.stations().forEach(function(station) {
    var owner = self.index.member[self.dabKey(station)];
    if (!owner) {
      return;
    }
    Object.keys(leads).forEach(function(name) {
      if (leads[name] && leads[name] !== owner && radiodns.startsWith(broadcastName(station), name)) {
        leads[name] = null;
      }
    });
  });
  self.leads = leads;
  return leads;
};

// The broadcaster of a station: the one its lookup led to, failing that the one whose
// name the station carries in front. Returns the group's name in the index, or null.
Logos.prototype._groupOf = function(key, station) {
  var groups = this.index.groups;
  var member = key && this.index.member[key];
  if (member && groups[member]) {
    return member;
  }
  var name = broadcastName(station);
  if (!name) {
    return null;
  }
  var leads = this._leads();
  var best = null;
  Object.keys(leads).forEach(function(lead) {
    if (leads[lead] && radiodns.startsWith(name, lead) && (!best || lead.length > best.length)) {
      best = lead;
    }
  });
  return best ? leads[best] : null;
};

module.exports = Logos;
module.exports.ICON_PREFIX = ICON_PREFIX;
module.exports.STORE = STORE;
