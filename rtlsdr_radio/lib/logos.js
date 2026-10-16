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
// A DAB station names itself by the identifiers it transmits. An FM station does so only
// when RDS has been received from it (its PI code); until then, and where RDS never
// comes, it is found by its name: among the user's own DAB stations that have a logo,
// then among the services the broadcasters' lists name. A logo found by name gives way
// to the one found by the PI code once that is known.
//
// Above all of that stands a logo the user chose for a station in the Station Manager:
// a picture of their own, one of the broadcasters' lists, or one kept here for another
// station. It is shown in place of whatever was or will be found, and no refresh
// touches it.
//
// The pictures are kept outside the plugin's folder, which an update of the plugin
// empties, and are reached through a link in that folder, because Volumio's artwork
// endpoint serves pictures to every screen from there.
//
// That endpoint tells a screen to keep what it was given for a month, and gives the
// player's default picture, under the same terms, for a file it cannot find: which is
// every picture of the plugin while an update has the plugin's folder away. So a
// picture's address carries a mark that changes whenever what is behind the address may
// have changed: with every installation (the link is made anew), and when the picture
// itself is replaced. A screen then never reuses what it was given under an address of
// before.

var fs = require('fs-extra');
var path = require('path');
var crypto = require('crypto');
var radiodns = require('./radiodns');
var names = require('./names');

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

// What is taken from a broadcaster's list. A list fetched before the plugin took as much
// is fetched once more.
var LISTS_READ = 3;

// The order of the work
var NOW = 0;
var MISSING = 1;
var FOLLOW_UP = 2;
var REFRESH = 3;

// options.stations(): the DAB stations as they are now
// options.fmStations(): the FM stations as they are now
// options.region(): the listener's region setting
// options.onLogo(): a picture has arrived
// options.onName(station, name): the broadcaster's list says what an FM station is called
function Logos(options) {
  options = options || {};
  this.dir = options.dir || STORE;
  this.link = options.link === undefined ? LINK : options.link;
  this.lookup = options.lookup || new radiodns.Lookup();
  this.logger = options.logger || { info: function() {}, error: function() {} };
  this.stations = options.stations || function() { return []; };
  this.fmStations = options.fmStations || function() { return []; };
  this.onName = options.onName || function() {};
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
  this.changedAt = 0;

  this.index = { logos: {}, misses: {}, gcc: {}, member: {}, groups: {}, directory: {},
    tried: {}, fmDirectory: {}, named: {}, user: {} };
  try {
    var stored = fs.readJsonSync(path.join(this.dir, 'index.json'));
    Object.keys(this.index).forEach(function(part) {
      this.index[part] = stored[part] || {};
    }, this);
    this.index.stamp = stored.stamp || 0;
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
      this._stamp(0);
      return;
    }
    var found = null;
    try {
      found = fs.lstatSync(this.link);
    } catch (e) {
      // not there yet
    }
    if (!(found && found.isSymbolicLink() && fs.readlinkSync(this.link) === this.dir)) {
      if (found) {
        fs.removeSync(this.link);
      }
      fs.symlinkSync(this.dir, this.link);
    }
    // The link is as old as the installation: made by the installer, or just now
    this._stamp(fs.lstatSync(this.link).ctimeMs);
  } catch (e) {
    this.logger.info('[RTL-SDR Radio] Logos: cannot prepare ' + this.dir + ': ' + e.message);
    this._stamp(0);
  }
};

// Note the time of the installation, for the mark the addresses carry
Logos.prototype._stamp = function(time) {
  var known = this.index.stamp || 0;
  var stamp = Math.max(known, Math.floor(time) || 0) || Date.now();
  if (stamp !== known) {
    this.index.stamp = stamp;
    this._save();
  }
};

// The mark an address carries: that of the installation, or of the picture if it is newer
Logos.prototype.mark = function(entry) {
  var fetched = entry && entry.fetched ? Date.parse(entry.fetched) : 0;
  return Math.max(this.index.stamp || 0, fetched || 0).toString(36);
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

// A station of the FM list: it has a frequency and none of what names a DAB service
function isFm(station) {
  return !!station && station.frequency !== undefined && station.frequency !== null &&
    !station.channel && !station.serviceId;
}

// The name an FM station's logo is kept under: its frequency, which is what the user's
// list knows it by
Logos.prototype.fmKey = function(station) {
  if (!isFm(station)) {
    return null;
  }
  var units = Math.round(parseFloat(station.frequency) * 100);
  return units >= 6500 && units <= 10800 ? 'fm-' + ('00000' + units).slice(-5) : null;
};

Logos.prototype.keyOf = function(station) {
  return isFm(station) ? this.fmKey(station) : this.dabKey(station);
};

// The names an FM station goes by: the user's, the one learnt for it, the one RDS
// sends. "FM 98.5" is no name.
function fmNames(station) {
  var list = [];
  [station.customName, station.name, station.ps].forEach(function(name) {
    var text = String(name || '').trim();
    if (text && !/^FM \d/i.test(text) && list.indexOf(text) === -1) {
      list.push(text);
    }
  });
  return list;
}

function fmCode(station) {
  var code = clean(station && station.pi);
  return code && code.length === 4 ? code : null;
}

// What a logo for an FM station is looked for by. When it changes (RDS has told the PI
// code, the user has renamed the station) the station is looked up again.
function fmSignature(station) {
  return (fmCode(station) || '') + '|' + fmNames(station).join('|').toLowerCase();
}

Logos.prototype._file = function(entry) {
  return entry && entry.file && fs.existsSync(path.join(this.dir, entry.file)) ? entry.file : null;
};

// The name a logo the user chose for a station is kept under: the station's own, or,
// for a DAB station typed in by hand, one made of its channel and name
Logos.prototype.userKey = function(station) {
  var key = this.keyOf(station);
  if (key || !station || isFm(station)) {
    return key;
  }
  var name = String(station.exactName || station.name || '').trim().toLowerCase();
  if (!name) {
    return null;
  }
  return 'dab-x-' + crypto.createHash('sha1').update(String(station.channel || '') + '|' + name).digest('hex').slice(0, 12);
};

// The picture to hand to Volumio's artwork endpoint (sourceicon) for a station: the
// logo the user chose, failing that its own, failing that its broadcaster's, or null
// when none is kept.
Logos.prototype.icon = function(station) {
  var chosen = this.index.user[this.userKey(station)];
  if (this._file(chosen)) {
    return ICON_PREFIX + chosen.file + '&v=' + this.mark(chosen);
  }
  var key = this.keyOf(station);
  var entry = key && this.index.logos[key];
  var file = this._file(entry);
  if (!file) {
    var group = this._groupOf(key, station);
    entry = group && this.index.groups[group];
    file = this._file(entry);
  }
  return file ? ICON_PREFIX + file + '&v=' + this.mark(entry) : null;
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
Logos.prototype._due = function(key, station) {
  if (key && key.indexOf('fm-') === 0) {
    return this._dueFm(key, station);
  }
  if (!key || this._file(this.index.logos[key])) {
    return false;
  }
  var missed = this.index.misses[key];
  if (missed && Date.now() - missed < RETRY_AFTER) {
    return false;
  }
  return !this._failedLately('station:' + key);
};

// An FM station is looked up when there is something to find it by that has not been
// tried: with a logo kept, only when that has changed; without one, again after a week.
Logos.prototype._dueFm = function(key, station) {
  var signature = fmSignature(station);
  if (signature === '|') {
    return false;
  }
  var tried = this.index.tried[key];
  if (tried && tried.signature === signature) {
    if (this._file(this.index.logos[key]) || Date.now() - tried.at < RETRY_AFTER) {
      return false;
    }
  }
  return !this._failedLately('station:' + key);
};

// --- the user's own choice --------------------------------------------------------------

// What is shown for a station and where it comes from, for the Station Manager:
// { key, file, mark, from, ref }. from: 'user' (chosen by the user), 'broadcaster' (the
// station's own, by its identifiers), 'pi' or 'name' (an FM station's, found by its PI
// code or by its name), 'group' (its broadcaster's), or null when nothing is kept.
Logos.prototype.describe = function(station) {
  var key = this.userKey(station);
  var chosen = key && this.index.user[key];
  if (this._file(chosen)) {
    return { key: key, file: chosen.file, mark: this.mark(chosen), from: 'user', ref: chosen.ref || null };
  }
  var own = this.index.logos[this.keyOf(station)];
  if (this._file(own)) {
    return { key: key, file: own.file, mark: this.mark(own), from: own.by || 'broadcaster', ref: own.ref || null };
  }
  var group = this._groupOf(this.keyOf(station), station);
  var entry = group && this.index.groups[group];
  if (this._file(entry)) {
    return { key: key, file: entry.file, mark: this.mark(entry), from: 'group', ref: (entry.names || [])[0] || null };
  }
  return { key: key, file: null, mark: null, from: null, ref: null };
};

function refused(message) {
  return Object.assign(new Error(message), { refused: true });
}

// Give a station the logo the user chose. picture: { body, extension }, already checked
// (lib/pictures.js); how: { from: 'upload' | 'list' | 'kept', ref }.
Logos.prototype.setUser = function(station, picture, how) {
  var key = this.userKey(station);
  if (!key) {
    throw refused('the station has nothing a logo can be kept by');
  }
  var file = 'user-' + key + '.' + picture.extension;
  var held = this.index.user[key];
  fs.ensureDirSync(this.dir);
  fs.writeFileSync(path.join(this.dir, file + '.tmp'), picture.body);
  fs.renameSync(path.join(this.dir, file + '.tmp'), path.join(this.dir, file));
  if (held && held.file && held.file !== file) {
    fs.removeSync(path.join(this.dir, held.file));
  }
  this.index.user[key] = { file: file, from: how.from, ref: how.ref || null, fetched: new Date().toISOString() };
  this._save();
  this.onLogo();
  return this.describe(station);
};

// The name a broadcaster's list gives the service whose logo an address is, or null:
// nothing is fetched on a client's word that a list did not name
Logos.prototype._listedAs = function(url) {
  var named = this.index.named;
  var found = null;
  Object.keys(named).some(function(name) {
    var entry = named[name];
    if (entry === url || (entry && (entry.url === url || entry.small === url))) {
      found = { name: name, url: entry.url || entry };
    }
    return !!found;
  });
  return found;
};

// The user chose one of the logos the broadcasters' lists name
Logos.prototype.setUserFromList = function(station, url) {
  var self = this;
  var listed = self._listedAs(url);
  if (!listed) {
    return Promise.reject(refused('not a logo the broadcasters\' lists name'));
  }
  return self.lookup.fetchImage(listed.url).then(function(image) {
    return self.setUser(station, { body: image.body, extension: image.extension }, { from: 'list', ref: listed.name });
  });
};

// The user chose a logo kept here for another station
Logos.prototype.setUserFromKept = function(station, file, name) {
  if (!/^[a-z0-9][a-z0-9._-]*\.(png|jpg|svg)$/i.test(String(file)) || !fs.existsSync(path.join(this.dir, file))) {
    throw refused('not a logo kept on the player');
  }
  return this.setUser(station, {
    body: fs.readFileSync(path.join(this.dir, file)),
    extension: path.extname(file).slice(1).toLowerCase()
  }, { from: 'kept', ref: name || null });
};

// Back to what is found for the station by itself
Logos.prototype.clearUser = function(station) {
  var key = this.userKey(station);
  var held = key && this.index.user[key];
  if (held) {
    if (held.file) {
      fs.removeSync(path.join(this.dir, held.file));
    }
    delete this.index.user[key];
    this._save();
    this.onLogo();
  }
  return this.describe(station);
};

// A station of the list has been given another frequency: its logos go with it, the one
// the user chose and the one found for it. What the new frequency held gives way to
// them, and stays where the station brings none.
Logos.prototype.retuned = function(from, to) {
  var self = this;
  var was = self.keyOf(from);
  var is = self.keyOf(to);
  if (!was || !is || was === is) {
    return;
  }
  var moved = false;
  [['user', 'user-'], ['logos', '']].forEach(function(kind) {
    var held = self.index[kind[0]][was];
    if (!held) {
      return;
    }
    delete self.index[kind[0]][was];
    var file = self._file(held);
    if (file) {
      var named = kind[1] + is + path.extname(file);
      var taken = self.index[kind[0]][is];
      if (taken && taken.file && taken.file !== named) {
        fs.removeSync(path.join(self.dir, taken.file));
      }
      fs.moveSync(path.join(self.dir, file), path.join(self.dir, named), { overwrite: true });
      held.file = named;
      self.index[kind[0]][is] = held;
    }
    moved = true;
  });
  if (moved) {
    self._save();
    self.onLogo();
  }
};

// The user's own logos as a backup carries them: { '<key>': { extension, from, ref,
// data } }, data being the picture in base64. Only what the user chose: everything else
// the store keeps can be fetched again.
Logos.prototype.exportUser = function() {
  var self = this;
  var out = {};
  Object.keys(self.index.user).forEach(function(key) {
    var entry = self.index.user[key];
    var file = self._file(entry);
    if (!file) {
      return;
    }
    out[key] = {
      extension: path.extname(file).slice(1).toLowerCase(),
      from: entry.from || 'upload',
      ref: entry.ref || null,
      data: fs.readFileSync(path.join(self.dir, file)).toString('base64')
    };
  });
  return out;
};

// Put back the user's logos a backup carries. Each takes the place of the user's logo
// for the same station, if there is one; the others are left as they are. check(body)
// says whether a picture can be a logo (lib/pictures.js): a backup is a file like any
// other and is taken on no more trust than an upload. Returns how many were put back.
Logos.prototype.importUser = function(logos, check) {
  var self = this;
  var count = 0;
  if (!logos || typeof logos !== 'object') {
    return 0;
  }
  Object.keys(logos).forEach(function(key) {
    var entry = logos[key];
    if (!/^(fm-\d{5}|dab-[0-9a-f]{4}-[0-9a-f]{4,8}|dab-x-[0-9a-f]{12})$/.test(key) ||
        !entry || typeof entry.data !== 'string') {
      return;
    }
    var body = Buffer.from(entry.data, 'base64');
    var checked = check(body);
    if (!checked.ok) {
      self.logger.info('[RTL-SDR Radio] Logos: the logo of ' + key + ' in the backup is not taken: ' + checked.reason);
      return;
    }
    var file = 'user-' + key + '.' + checked.extension;
    var held = self.index.user[key];
    fs.ensureDirSync(self.dir);
    fs.writeFileSync(path.join(self.dir, file + '.tmp'), body);
    fs.renameSync(path.join(self.dir, file + '.tmp'), path.join(self.dir, file));
    if (held && held.file && held.file !== file) {
      fs.removeSync(path.join(self.dir, held.file));
    }
    self.index.user[key] = {
      file: file,
      from: String(entry.from || 'upload').slice(0, 20),
      ref: entry.ref ? String(entry.ref).slice(0, 80) : null,
      fetched: new Date().toISOString()
    };
    count++;
  });
  if (count > 0) {
    self._save();
    self.onLogo();
  }
  return count;
};

function sought(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

// How well a name answers what is sought: 0 the same words, 1 begins with them, 2 holds
// them all somewhere, null not at all
function answers(name, query, words) {
  var text = String(name).toLowerCase();
  if (words.length === 0) {
    return 2;
  }
  if (!words.every(function(word) { return text.indexOf(word) !== -1; })) {
    return null;
  }
  var same = names.words(name).join(' ') === names.words(query).join(' ');
  return same ? 0 : (text.indexOf(words.join(' ')) === 0 ? 1 : 2);
}

// What the user can choose from: { listed: [{ name, url, small }], kept: [{ name, file,
// mark }] }. listed: the services the broadcasters' lists name with a logo; kept: the
// logos on the player, each under the name of a station it is shown for. Both narrowed
// to what answers the query, the nearest first.
Logos.prototype.library = function(query, limit) {
  var self = this;
  var words = sought(query);
  var most = Math.max(1, Math.min(200, limit || 60));

  function ranked(list) {
    return list.map(function(item) {
      return { item: item, rank: answers(item.name, query, words) };
    }).filter(function(entry) { return entry.rank !== null; }).sort(function(a, b) {
      return a.rank - b.rank || String(a.item.name).localeCompare(String(b.item.name));
    }).slice(0, most).map(function(entry) { return entry.item; });
  }

  var listed = Object.keys(self.index.named).map(function(name) {
    var entry = self.index.named[name];
    return { name: name, url: entry.url || entry, small: entry.small || entry.url || entry };
  });

  var seen = {};
  var kept = [];
  self.stations().concat(self.fmStations()).forEach(function(station) {
    if (!station || station.deleted) {
      return;
    }
    var shown = self.describe(station);
    if (shown.file && !seen[shown.file]) {
      seen[shown.file] = true;
      kept.push({ name: String(station.customName || station.name || '').trim(), file: shown.file, mark: shown.mark });
    }
  });

  return { listed: ranked(listed), kept: ranked(kept) };
};

// --- what is asked of the store ---------------------------------------------------------

// A station is being shown or played: fetch its logo if that is due.
// options.now: it is on the screen now, so it goes before everything else.
Logos.prototype.want = function(station, options) {
  var key = this.keyOf(station);
  if (!this._due(key, station)) {
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
  // FM stations, and the user's choice of a logo, draw on what the lists say; lists
  // read before as much was taken from them are read again
  Object.keys(self.index.groups).forEach(function(url) {
    if ((self.index.groups[url].read || 0) < LISTS_READ && !self._failedLately('list:' + url)) {
      self._enqueue({ kind: 'list', key: url, rank: MISSING });
    }
  });
  self.fmStations().filter(function(station) {
    return station && !station.deleted && self._due(self.fmKey(station), station);
  }).forEach(function(station) {
    self._enqueue({ kind: 'station', key: self.fmKey(station), station: station, rank: MISSING });
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
  self.fmStations().forEach(function(station) {
    var key = self.fmKey(station);
    if (!station || station.deleted || !key || fmSignature(station) === '|') {
      return;
    }
    if (self._file(self.index.logos[key])) {
      self._enqueue({ kind: 'station', key: key, station: station, rank: REFRESH, refresh: true });
    } else {
      delete self.index.tried[key];
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
  self.stations().concat(self.fmStations()).forEach(function(station) {
    if (!station || station.deleted) {
      return;
    }
    var key = self.keyOf(station);
    status.stations++;
    if (self._file(self.index.user[self.userKey(station)]) || (key && self._file(self.index.logos[key]))) {
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
      work = job.key.indexOf('fm-') === 0 ? self._fetchFm(job) : self._fetchStation(job);
    } else if (job.kind === 'list') {
      work = self.lookup.listAt(job.key).then(function() {});
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
  } else if (job.kind === 'list') {
    // The broadcaster's list is gone: not asked for again
    self.index.groups[job.key].read = LISTS_READ;
  } else if (job.key.indexOf('fm-') === 0) {
    self.index.tried[job.key] = { at: Date.now(), signature: fmSignature(job.station) };
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

// An FM station: by its PI code where RDS has told it (the broadcasters' lists already
// read, then RadioDNS), otherwise and failing that by its name.
Logos.prototype._fetchFm = function(job) {
  var self = this;
  var key = job.key;
  var station = job.station;
  var signature = fmSignature(station);
  var pi = fmCode(station);

  function tried() {
    self.index.tried[key] = { at: Date.now(), signature: signature };
    self._save();
  }

  function byName() {
    var found = self._byName(station);
    if (!found) {
      tried();
      return Promise.resolve();
    }
    self.logger.info('[RTL-SDR Radio] Logos: FM ' + station.frequency + ' goes by the name "' + found.wanted +
      '": the logo of "' + found.name + '" (' + found.how + ')');
    var how = { by: 'name', ref: found.name };
    var kept = found.file ? Promise.resolve(self._borrow(key, found, how)) : self._keep(key, [found.url], job.refresh, how);
    return kept.then(tried);
  }

  if (!pi) {
    return byName();
  }

  var known = self._country('', pi);
  var listed = known ? self.index.fmDirectory[known + '.' + pi] : null;
  if (listed && listed.name) {
    self.onName(station, listed.name);
  }
  var candidates = radiodns.fmCandidates(pi, station.frequency, self.region(), known);
  if (known) {
    candidates = candidates.filter(function(candidate) { return candidate.gcc === known; });
  }

  return (listed ? Promise.resolve(null) : self.lookup.find(candidates)).then(function(found) {
    var urls = listed ? [listed.url] : [];
    if (found) {
      self.index.gcc['pi-' + pi] = found.gcc;
      self.index.member[key] = found.list;
      urls = found.logos.map(function(logo) { return logo.url; });
      if (urls.length === 0 && self.index.fmDirectory[found.gcc + '.' + pi]) {
        urls = [self.index.fmDirectory[found.gcc + '.' + pi].url];
      }
      if (found.called) {
        self.onName(station, found.called);
      }
    }
    if (urls.length > 0) {
      return self._keep(key, urls, job.refresh, { by: 'pi', ref: pi }).then(tried);
    }
    if (found || listed) {
      return byName();
    }
    // Nobody answers for the code. That is the broadcasters' word only if the network
    // was there to be asked.
    return self.lookup.reachable().then(function(online) {
      if (!online) {
        throw new Error('no network');
      }
      self.onlineAt = Date.now();
      return byName();
    });
  });
};

// The logo an FM station's name leads to: { wanted, name, how, file | url }, or null.
// The user's own DAB stations first: they are what is on the air where the player
// stands, and their logos are kept already. Then the broadcasters' lists, where only a
// name that means one station counts.
Logos.prototype._byName = function(station) {
  var self = this;
  var wanted = fmNames(station);
  var mine = [];
  self.stations().forEach(function(dab) {
    var entry = dab && !dab.deleted && self.index.logos[self.dabKey(dab)];
    var file = self._file(entry);
    if (file && broadcastName(dab)) {
      mine.push({ name: broadcastName(dab), file: file, url: entry.url });
    }
  });
  var listed = Object.keys(self.index.named).map(function(name) {
    var entry = self.index.named[name];
    return { name: name, url: entry.url || entry };
  });

  var found = null;
  wanted.some(function(name) {
    var hit = names.match(name, mine) || names.match(name, listed, { sure: true });
    if (hit) {
      found = { wanted: name, name: hit.found.name, how: hit.how, file: hit.found.file || null, url: hit.found.url };
    }
    return !!hit;
  });
  return found;
};

// Give an FM station the logo kept for one of the DAB stations: a copy, so that each
// has its own to be refreshed or replaced
Logos.prototype._borrow = function(key, found, how) {
  var extension = path.extname(found.file) || '.png';
  var file = key + extension;
  var held = this.index.logos[key];
  var picture = fs.readFileSync(path.join(this.dir, found.file));
  if (held && held.file === file && this._file(held) && picture.equals(fs.readFileSync(path.join(this.dir, file)))) {
    return;   // the same picture again is left alone
  }
  fs.writeFileSync(path.join(this.dir, file), picture);
  if (held && held.file && held.file !== file) {
    fs.removeSync(path.join(this.dir, held.file));
  }
  this.index.logos[key] = { file: file, url: found.url, fetched: new Date().toISOString(), by: how.by, ref: how.ref };
  this.fetched++;
  this.changedAt = Date.now();
  this._save();
  this.onLogo();
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

// Keep a station's logo: the first of the pictures listed that is to be had.
// how: { by, ref }, what the logo was found by, noted with it.
Logos.prototype._keep = function(key, urls, refresh, how) {
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
      if (how) {
        kept.by = how.by;
        kept.ref = how.ref;
      }
      self.index.logos[key] = kept;
      self.fetched++;
      self.changedAt = Date.now();
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

  group.read = LISTS_READ;

  var services = radiodns.dabServicesOf(xml);
  Object.keys(services).forEach(function(name) {
    this.index.directory[name] = services[name];
  }, this);
  var programmes = radiodns.fmServicesOf(xml);
  Object.keys(programmes).forEach(function(name) {
    this.index.fmDirectory[name] = programmes[name];
  }, this);
  var named = radiodns.namedServicesOf(xml);
  Object.keys(named).forEach(function(name) {
    this.index.named[name] = named[name];
  }, this);
  this.changedAt = Date.now();

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

  self.fmStations().forEach(function(station) {
    var key = station && !station.deleted && self.fmKey(station);
    if (!key || self._file(self.index.logos[key])) {
      return;
    }
    // Tried before the logos and lists of this round were there: once more, with them
    var tried = self.index.tried[key];
    if (tried && tried.at < self.changedAt && fmSignature(station) !== '|' && !self._failedLately('station:' + key)) {
      delete self.index.tried[key];
      self._enqueue({ kind: 'station', key: key, station: station, rank: FOLLOW_UP });
      return;
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
  // An FM station goes by the names it has; a DAB station by the one it is broadcast under
  var known = isFm(station) ? fmNames(station) : [broadcastName(station)].filter(Boolean);
  if (known.length === 0) {
    return null;
  }
  var leads = this._leads();
  var best = null;
  Object.keys(leads).forEach(function(lead) {
    var carried = known.some(function(name) { return radiodns.startsWith(name, lead); });
    if (leads[lead] && carried && (!best || lead.length > best.length)) {
      best = lead;
    }
  });
  return best ? leads[best] : null;
};

module.exports = Logos;
module.exports.ICON_PREFIX = ICON_PREFIX;
module.exports.STORE = STORE;
