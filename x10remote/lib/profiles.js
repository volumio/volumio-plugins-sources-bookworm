'use strict';

/*
 * Profile store: /data/INTERNAL/X10/<id>/profile.json (+ image1..6.jpg|png|webp)
 *
 * All input from the web interface is checked strictly here (types, lengths, allowed values).
 * Writes run one after another (queue) and atomically (temp file + rename).
 */

var fs = require('fs');
var fsp = fs.promises;
var path = require('path');
var C = require('./constants');

var ID_RE = /^[a-z0-9][a-z0-9-]{0,55}$/;
var KEY_ID_RE = /^k[0-9a-z]{1,16}$/;
var DEVICE_RE = /^([0-9a-f]{4}:[0-9a-f]{4}|name:[^\u0000-\u001f]{1,80})$/;
var KEYNAME_RE = /^(KEY|BTN)_[A-Z0-9_]{1,40}$/;
var IMAGE_TYPES = {
  jpg: { mime: 'image/jpeg', magic: function (b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; } },
  png: { mime: 'image/png', magic: function (b) { return b.length > 8 && b.readUInt32BE(0) === 0x89504e47; } },
  webp: { mime: 'image/webp', magic: function (b) { return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'; } }
};

/** Check the data URL of an image: { buf, ext } (type by file signature). */
function decodeImage(dataUrl, maxBytes) {
  var m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw ValidationError('image_invalid');
  var buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > (maxBytes || C.LIMITS.IMAGE_BYTES)) throw ValidationError('image_too_large');
  var ext = null;
  Object.keys(IMAGE_TYPES).forEach(function (k) { if (!ext && IMAGE_TYPES[k].magic(buf)) ext = k; });
  if (!ext) throw ValidationError('image_invalid');
  return { buf: buf, ext: ext };
}

function ValidationError(code, detail) {
  var e = new Error(code + (detail ? ': ' + detail : ''));
  e.code = code;
  e.detail = detail || '';
  e.status = 400;
  return e;
}

function cleanText(value, max, multiline) {
  var s = (value === undefined || value === null) ? '' : String(value);
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    : s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function slugify(name) {
  var s = String(name || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 40) {
    // do not cut in the middle of a word ("...-usb-empfae") as long as enough of the name remains
    var cut = s.slice(0, 41).lastIndexOf('-');
    s = s.slice(0, cut >= 20 ? cut : 40);
  }
  s = s.replace(/-+$/g, '');
  return s || 'profil';
}

var LOGO_RE = /^logo-[0-9a-f]{12}\.(png|jpg|webp)$/;

/** Web address of a radio station: http(s), no whitespace/control characters; a # fragment is never sent and is dropped. */
function cleanUri(value) {
  var u = String(value === undefined || value === null ? '' : value).trim().split('#')[0];
  if (!u) return '';
  if (u.length > C.LIMITS.RADIO_URI || !/^https?:\/\/[^\s\u0000-\u001f\u007f"<>\\^`{|}]+$/i.test(u)) return null;
  return u;
}

/**
 * Action "radio": { name, uris[1..3] (failover order), logo, quality, format }.
 * logo/quality/format are display data for display plugins (e.g. HD44780/VFD).
 */
function sanitizeRadio(r, idx) {
  r = r && typeof r === 'object' ? r : {};
  var name = cleanText(r.name, C.LIMITS.RADIO_NAME, false);
  if (!name) throw ValidationError('radio_name_required', String(idx + 1));
  var uris = [];
  (Array.isArray(r.uris) ? r.uris : []).slice(0, C.LIMITS.RADIO_URIS).forEach(function (u) {
    var c = cleanUri(u);
    if (c === null) throw ValidationError('radio_uri_invalid', String(idx + 1));
    if (c && uris.indexOf(c) === -1) uris.push(c);
  });
  if (!uris.length) throw ValidationError('radio_uri_required', String(idx + 1));
  return {
    name: name,
    uris: uris,
    logo: typeof r.logo === 'string' && LOGO_RE.test(r.logo) ? r.logo : null,
    quality: cleanText(r.quality, C.LIMITS.RADIO_TEXT, false),
    format: cleanText(r.format, C.LIMITS.RADIO_TEXT, false)
  };
}

/** Triggerhappy keys chosen more than once in the same profile: [{ key, names[] }]. */
function thdDuplicates(p) {
  var by = {};
  ((p && p.keys) || []).forEach(function (k) {
    if (k.type !== 'scan' || !k.thd_key) return;
    (by[k.thd_key] = by[k.thd_key] || []).push(k.remote_label || k.name);
  });
  return Object.keys(by).filter(function (key) { return by[key].length > 1; }).sort()
    .map(function (key) { return { key: key, names: by[key] }; });
}

/**
 * Folder name = stored name (receivers): only remove characters Windows/SMB does not allow.
 * "X10 WTI" -> "X10 WTI", "A/B: Test?" -> "A-B- Test-".
 */
var WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function folderName(name) {
  var s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/^[._]+/, '').slice(0, 80).replace(/[. ]+$/, '');
  if (WIN_RESERVED.test(s)) s += '_';
  return s || 'Receiver';
}
function isFolderName(id) {
  id = String(id || '');
  if (id.length === 0 || id.length > 96 || id === C.RECEIVER_DIR) return false;
  // "receiver-<Name>": the name part follows the folder rules (so do older folders without prefix)
  var rest = id.indexOf(C.RECEIVER_PREFIX) === 0 ? id.slice(C.RECEIVER_PREFIX.length) : id;
  return rest.length > 0 && rest.length <= 80 && rest === folderName(rest);
}

// Linux names that only mark range limits (evdev returns them first): real key name
var KEY_ALIAS = { KEY_MIN_INTERESTING: 'KEY_MUTE' };

function normDeviceId(value) {
  var d = cleanText(value, 90, false);
  return d && d.indexOf('name:') !== 0 ? d.toLowerCase() : d;
}

/** Receivers of a profile (older profiles only know "device"). */
function receiversOf(p) {
  if (p && Array.isArray(p.receivers) && p.receivers.length) return p.receivers.slice();
  return p && p.device && p.device.id ? [p.device.id] : [];
}

/**
 * Receivers: /data/INTERNAL/X10/receiver-<Name>/receiver.json (+ pictures). One entry per USB device.
 * rf433: works with several transmitters (433 MHz radio); otherwise it belongs to exactly one transmitter.
 */
function sanitizeReceiver(input, existing, opts) {
  opts = opts || {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw ValidationError('invalid_receiver');
  var name = cleanText(input.name, C.LIMITS.PROFILE_NAME, false);
  if (!name) throw ValidationError('name_required');
  var device = input.device && typeof input.device === 'object' ? input.device : {};
  var deviceId = existing && existing.device ? existing.device.id : normDeviceId(device.id);
  if (!DEVICE_RE.test(deviceId)) throw ValidationError('device_invalid', deviceId);
  var now = new Date().toISOString();
  return {
    format: 1,
    id: existing ? existing.id : null,
    name: name,
    description: cleanText(input.description, C.LIMITS.DESCRIPTION, true),
    notes: (input.notes === undefined && existing) ? (existing.notes || '') : cleanText(input.notes, C.LIMITS.NOTES, true),
    device: { id: deviceId, name: cleanText(device.name !== undefined ? device.name : (existing && existing.device && existing.device.name), 120, false) },
    rf433: input.rf433 === undefined && existing ? !!existing.rf433 : input.rf433 === true,
    images: existing && Array.isArray(existing.images) ? existing.images.slice(0, C.LIMITS.IMAGE_SLOTS) : new Array(C.LIMITS.IMAGE_SLOTS).fill(null),
    created: existing && existing.created ? existing.created : now,
    updated: now,
    plugin_version: opts.version || ''
  };
}

function toInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\s*(0x[0-9a-f]+|\d+)\s*$/i.test(value)) return parseInt(value.trim(), value.trim().toLowerCase().indexOf('0x') === 0 ? 16 : 10);
  return NaN;
}

/**
 * Checks and normalises a profile coming from the web interface.
 * @param {object} input       raw data
 * @param {object|null} existing  existing profile (for id, pictures, timestamps)
 * @param {object} opts        { allowShell: bool, version: string }
 */
function sanitizeProfile(input, existing, opts) {
  opts = opts || {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw ValidationError('invalid_profile');

  var name = cleanText(input.name, C.LIMITS.PROFILE_NAME, false);
  if (!name) throw ValidationError('name_required');

  var device = input.device && typeof input.device === 'object' ? input.device : {};
  var deviceId = normDeviceId(device.id);
  // receivers (USB devices) this transmitter works with. Without the 433 MHz mark exactly one.
  var rf433 = input.rf433 === true;
  var receivers = [];
  (Array.isArray(input.receivers) ? input.receivers : []).forEach(function (r) {
    var rid = normDeviceId(r && typeof r === 'object' ? r.id : r);
    if (!DEVICE_RE.test(rid)) throw ValidationError('device_invalid', rid);
    if (receivers.indexOf(rid) === -1) receivers.push(rid);
  });
  if (!receivers.length && DEVICE_RE.test(deviceId)) receivers.push(deviceId);
  if (!receivers.length) throw ValidationError('device_invalid', deviceId);
  if (receivers.length > C.LIMITS.RECEIVERS_PER_PROFILE) throw ValidationError('too_many_receivers', String(C.LIMITS.RECEIVERS_PER_PROFILE));
  if (!rf433 && receivers.length > 1) throw ValidationError('receivers_single');
  if (deviceId !== receivers[0]) device = { id: receivers[0], name: '' };
  deviceId = receivers[0];

  if (!Array.isArray(input.keys)) throw ValidationError('keys_invalid');
  if (input.keys.length > C.LIMITS.KEYS_PER_PROFILE) throw ValidationError('too_many_keys', String(C.LIMITS.KEYS_PER_PROFILE));

  var seen = {};
  var usedIds = {};
  var keys = [];
  input.keys.forEach(function (k, idx) {
    if (!k || typeof k !== 'object') throw ValidationError('key_invalid', String(idx + 1));
    var type = k.type === 'key' ? 'key' : (k.type === 'scan' ? 'scan' : null);
    if (!type) throw ValidationError('key_type_invalid', String(idx + 1));
    var code = toInt(k.code);
    if (!(code >= 0 && code <= 0xffffffff)) throw ValidationError('key_code_invalid', String(idx + 1));
    if (type === 'key' && code > 0x2ff) throw ValidationError('key_code_invalid', String(idx + 1));
    var ident = type + ':' + code;
    if (seen[ident]) return;           // duplicate key: the first one wins
    seen[ident] = true;

    var allowed = type === 'key' ? C.ACTIONS_KEY : C.ACTIONS_SCAN;
    var thdKey = '';
    if (type === 'scan') {
      thdKey = typeof k.thd_key === 'string' ? k.thd_key.trim() : '';
      if (thdKey === 'auto') thdKey = '';
      // When reading from disk only the format is checked (the list of "thd --listevents" is not at
      // hand then); when saving from the web interface the name is also checked against the list.
      var keyList = opts.loading ? null : (opts.thdKeys || C.FALLBACK_THD_KEYS.concat(C.VIRTUAL_KEYS));
      if (thdKey && (!KEYNAME_RE.test(thdKey) || (keyList && keyList.indexOf(thdKey) === -1))) {
        throw ValidationError('thd_key_invalid', String(idx + 1));
      }
    }
    var action = typeof k.action === 'string' && allowed.indexOf(k.action) !== -1 ? k.action : (type === 'key' ? 'default' : 'none');
    var command = '';
    if (action === 'custom') {
      command = cleanText(k.command, C.LIMITS.COMMAND, false);
      if (!command) throw ValidationError('command_required', String(idx + 1));
      // Triggerhappy treats everything from '#' on as a comment - the command would be cut off
      if (command.indexOf('#') !== -1) throw ValidationError('command_hash', String(idx + 1));
      if (!opts.allowShell) throw ValidationError('shell_disabled', String(idx + 1));
    }
    var radio = null;
    if (action === 'radio') radio = sanitizeRadio(k.radio, idx);
    var id = typeof k.id === 'string' && KEY_ID_RE.test(k.id) && !usedIds[k.id] ? k.id : null;
    if (!id) {
      var n = keys.length + 1;
      do { id = 'k' + (n++).toString(36); } while (usedIds[id]);
    }
    usedIds[id] = true;
    var scan = toInt(k.scan);
    var keyName = typeof k.key_name === 'string' && KEYNAME_RE.test(k.key_name) ? (KEY_ALIAS[k.key_name] || k.key_name) : null;
    keys.push({
      id: id,
      name: cleanText(k.name, C.LIMITS.KEY_NAME, false) || (String(opts.keyName || 'Key {n}').replace('{n}', keys.length + 1)),
      type: type,
      code: code,
      scan: (scan >= 0 && scan <= 0xffffffff) ? scan : (type === 'scan' ? code : null),
      key_name: type === 'key' ? keyName : null,
      action: action,
      command: command,
      thd_key: type === 'scan' ? thdKey : null,
      repeat: k.repeat === true,
      remote_label: cleanText(k.remote_label, C.LIMITS.REMOTE_LABEL, false),
      description: cleanText(k.description, C.LIMITS.KEY_DESCRIPTION, false)
    });
    if (radio) keys[keys.length - 1].radio = radio;
  });

  var now = new Date().toISOString();
  return {
    format: 1,
    id: existing ? existing.id : null,
    name: name,
    description: cleanText(input.description, C.LIMITS.DESCRIPTION, true),
    notes: (input.notes === undefined && existing) ? (existing.notes || '') : cleanText(input.notes, C.LIMITS.NOTES, true),
    device: { id: deviceId, name: cleanText(device.name, 120, false) },
    receivers: receivers,
    rf433: rf433,
    keys: keys,
    images: existing && Array.isArray(existing.images) ? existing.images.slice(0, C.LIMITS.IMAGE_SLOTS) : new Array(C.LIMITS.IMAGE_SLOTS).fill(null),
    created: existing && existing.created ? existing.created : now,
    updated: now,
    plugin_version: opts.version || ''
  };
}

/**
 * opts.onPermissionError: async function that restores write permissions (e.g. for folders created
 * from Windows over SMB that belong to the guest). The operation is then repeated once.
 */
function ProfileStore(baseDir, logger, opts) {
  this.baseDir = baseDir || C.PROFILE_DIR;
  this.logger = logger;
  this.opts = opts || {};
  this.fileName = this.opts.fileName || 'profile.json';
  this.sanitize = this.opts.sanitize || sanitizeProfile;
  this.isValid = this.opts.isValid || function (raw) { return Array.isArray(raw.keys); };
  this.notFound = this.opts.notFound || 'profile_not_found';
  this.kind = this.opts.kind || 'profile';
  // exactNames: the folder is named like the name (receivers); otherwise a short form (transmitters: "medion-20016398")
  this.exact = !!this.opts.exactNames;
  this.idOk = this.exact ? isFolderName : function (id) { return ID_RE.test(String(id || '')) && id !== C.VANILLA_ID; };
  this._queue = Promise.resolve();
  this.invalid = {};     // id -> reason: files that exist but are ignored because of invalid content
}

function isPermError(e) {
  return !!(e && (e.code === 'EACCES' || e.code === 'EPERM'));
}

/** Set permissions for the SMB share (errors ignored: e.g. the file belongs to the SMB guest). */
function shareMode(file, dir) {
  return fsp.chmod(file, dir ? C.SHARE_DIR_MODE : C.SHARE_FILE_MODE).catch(function () { /* ignore */ });
}

async function mkdirShared(dir) {
  await fsp.mkdir(dir, { recursive: true });
  await shareMode(dir, true);
}

ProfileStore.prototype._serial = function (fn) {
  var self = this;
  var guarded = function () {
    return Promise.resolve().then(fn).catch(function (e) {
      if (!isPermError(e) || !self.opts.onPermissionError) throw e;
      if (self.logger) self.logger.warn(C.LOG_PREFIX + 'no write permission (' + (e.path || e.message) + ') - repairing permissions');
      return Promise.resolve(self.opts.onPermissionError()).then(fn);
    });
  };
  var run = this._queue.then(guarded, guarded);
  this._queue = run.catch(function () { /* errors go to the caller */ });
  if (self.opts.onChange) run.then(function () { self.opts.onChange(); }, function () { /* nothing changed */ });
  return run;
};

ProfileStore.prototype.dirOf = function (id) {
  if (!this.idOk(id)) throw ValidationError(this.exact ? 'receiver_id_invalid' : 'profile_id_invalid');
  return path.join(this.baseDir, id);
};

ProfileStore.prototype.ensureBase = function () {
  return mkdirShared(this.baseDir);
};

ProfileStore.prototype._writeJson = async function (file, data) {
  var tmp = file + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: C.SHARE_FILE_MODE });
  await shareMode(tmp, false);           // the writeFile mode is cut by the umask
  await fsp.rename(tmp, file);
};

var IMAGE_FILE_RE = /^image[1-6]\.(jpg|png|webp)$/;
var ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/**
 * Re-check a file read from disk. /data/INTERNAL/X10 is writable for guests through the SMB share:
 * a profile.json edited there by hand is unchecked and is therefore cleaned on EVERY load with the
 * same checks as on saving (lengths, control characters, allowed actions and key names). Invalid
 * files are skipped (message in the log).
 * Custom commands stay stored; whether they take effect is still decided by expert mode.
 */
function loadClean(sanitize, raw, id) {
  var images = (Array.isArray(raw.images) ? raw.images : []).slice(0, C.LIMITS.IMAGE_SLOTS).map(function (f, i) {
    return typeof f === 'string' && IMAGE_FILE_RE.test(f) && f.charAt(5) === String(i + 1) ? f : null;
  });
  while (images.length < C.LIMITS.IMAGE_SLOTS) images.push(null);
  var created = typeof raw.created === 'string' && ISO_RE.test(raw.created) ? raw.created : null;
  var clean = sanitize(raw, { id: id, images: images, created: created, notes: '' },
    { loading: true, allowShell: true, version: cleanText(raw.plugin_version, 20, false) });
  clean.id = id;
  clean.images = images;
  if (typeof raw.updated === 'string' && ISO_RE.test(raw.updated)) clean.updated = raw.updated;
  return clean;
}

ProfileStore.prototype.get = async function (id) {
  var self = this;
  var dir = this.dirOf(id);
  var raw;
  try {
    raw = JSON.parse(await fsp.readFile(path.join(dir, self.fileName), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      delete self.invalid[id];
    } else {
      self._markInvalid(id, e instanceof SyntaxError ? 'json_invalid' : (e.code || 'unreadable'));
    }
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !self.isValid(raw)) {
    self._markInvalid(id, 'structure_invalid');
    return null;
  }
  try {
    var clean = loadClean(self.sanitize, raw, id);
    delete self.invalid[id];
    return clean;
  } catch (e) {
    var known = self.invalid[id];
    self.invalid[id] = String(e.code || 'invalid') + (e.detail ? ' ' + String(e.detail).replace(/[^\w .:-]/g, '').slice(0, 40) : '');
    if (this.logger && known !== self.invalid[id]) this.logger.warn(C.LOG_PREFIX + self.kind + ' ' + id + ' ignored, invalid content: ' + (e.code || e.message) + (e.detail ? ' (' + e.detail + ')' : ''));
    return null;
  }
};

/** Remember an invalid file; log only when the reason changes (list() runs often). */
ProfileStore.prototype._markInvalid = function (id, reason) {
  if (this.invalid[id] !== reason && this.logger) this.logger.warn(C.LOG_PREFIX + this.kind + ' ' + id + ' ignored: ' + reason);
  this.invalid[id] = reason;
};

/** Ignored files: [{ id, reason }] (current after list()). */
ProfileStore.prototype.invalidList = function () {
  var self = this;
  return Object.keys(self.invalid).sort().map(function (id) { return { id: id, reason: self.invalid[id] }; });
};

ProfileStore.prototype.list = async function () {
  var self = this;
  var entries;
  try {
    entries = await fsp.readdir(self.baseDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  var ids = entries.filter(function (d) { return d.isDirectory() && self.idOk(d.name); })
    .map(function (d) { return d.name; }).sort();
  Object.keys(self.invalid).forEach(function (id) { if (ids.indexOf(id) === -1) delete self.invalid[id]; });
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var p = await self.get(ids[i]);
    if (p) out.push(p);
  }
  return out;
};

ProfileStore.prototype._uniqueId = function (name) {
  return this._idForName(name, null);
};

/** Names taken in the folder (lower case: SMB/Windows do not distinguish case). */
ProfileStore.prototype._taken = async function () {
  try {
    return (await fsp.readdir(this.baseDir)).map(function (n) { return n.toLowerCase(); });
  } catch (e) {
    return [];
  }
};

/** Create a new profile or update an existing one. */
ProfileStore.prototype.save = function (input, opts) {
  var self = this;
  return self._serial(async function () {
    await self.ensureBase();
    var existing = null;
    if (input && input.id) {
      existing = await self.get(input.id);
      if (!existing) throw Object.assign(ValidationError(self.notFound), { status: 404 });
    } else {
      var count = (await self.list()).length;
      if (count >= C.LIMITS.PROFILES) throw ValidationError('too_many_profiles', String(C.LIMITS.PROFILES));
    }
    var profile = self.sanitize(input, existing, opts);
    if (!profile.id && opts && self.idOk(opts.newId)) {
      try {
        await fsp.access(path.join(self.baseDir, opts.newId));
      } catch (e) {
        profile.id = opts.newId;          // the requested id is free
      }
    }
    if (!profile.id) profile.id = await self._uniqueId(profile.name);
    var dir = self.dirOf(profile.id);
    await mkdirShared(dir);
    await self._writeJson(path.join(dir, self.fileName), profile);
    return profile;
  });
};

/** Id (folder name) matching the name; the own id counts as free. */
ProfileStore.prototype._idForName = async function (name, ownId) {
  // Folders in /data/INTERNAL/X10 show their kind in the name: sender-<short name>, receiver-<Name>
  // (templates: template-<short name>, see index.js). An identical beginning of the name is not doubled.
  var base = this.exact
    ? C.RECEIVER_PREFIX + folderName(String(name || '').replace(/^\s*receiver[\s_-]*/i, ''))
    : C.SENDER_PREFIX + slugify(String(name || '').replace(/^\s*sender[\s_-]*/i, ''));
  var taken = await this._taken();
  for (var n = 1; n < 1000; n++) {
    var cand = n === 1 ? base : (this.exact ? base.slice(0, 83) + ' (' + n + ')' : base + '-' + n);
    if (cand === ownId) return cand;
    if (ownId && cand.toLowerCase() === String(ownId).toLowerCase()) return cand;   // only upper/lower case changed
    if (taken.indexOf(cand.toLowerCase()) === -1) return cand;
  }
  throw ValidationError('profile_id_exhausted');
};

/**
 * Rename a profile: name and folder. Afterwards the folder below /data/INTERNAL/X10 is named like the
 * name (e.g. "Küche" -> sender-kueche, taken -> sender-kueche-2). Keys and pictures are kept.
 * Returns the profile with its new id; old_id = previous id.
 */
ProfileStore.prototype.rename = function (id, name) {
  var self = this;
  return self._serial(async function () {
    var dir = self.dirOf(id);
    var profile = await self.get(id);
    if (!profile) throw Object.assign(ValidationError(self.notFound), { status: 404 });
    var clean = cleanText(name, C.LIMITS.PROFILE_NAME, false);
    if (!clean) throw ValidationError('name_required');
    var newId = await self._idForName(clean, id);
    profile.name = clean;
    profile.updated = new Date().toISOString();
    await self._writeJson(path.join(dir, self.fileName), profile);
    if (newId !== id) {
      await fsp.rename(dir, self.dirOf(newId));       // same file system: atomic
      profile.id = newId;
      await self._writeJson(path.join(self.dirOf(newId), self.fileName), profile);
    }
    profile.old_id = id;
    return profile;
  });
};

/**
 * Rename older folders without prefix once (medion-20016398 -> sender-medion-20016398,
 * "X10 WTI" -> "receiver-X10 WTI"). skip: ids that stay (e.g. Mobile Remote).
 * Returns [{ old_id, id }]. A folder that cannot be renamed stays as it is.
 */
ProfileStore.prototype.adoptPrefix = function (skip) {
  var self = this;
  var prefix = self.exact ? C.RECEIVER_PREFIX : C.SENDER_PREFIX;
  return self._serial(async function () {
    var entries;
    try { entries = await fsp.readdir(self.baseDir, { withFileTypes: true }); } catch (e) { return []; }
    var moved = [];
    for (var i = 0; i < entries.length; i++) {
      var old = entries[i].name;
      if (!entries[i].isDirectory() || !self.idOk(old) || old.indexOf(prefix) === 0 || (skip || []).indexOf(old) !== -1) continue;
      if (old.indexOf(C.TEMPLATE_PREFIX) === 0) continue;
      var raw;
      try { raw = JSON.parse(await fsp.readFile(path.join(self.baseDir, old, self.fileName), 'utf8')); } catch (e) { continue; }
      if (!raw || typeof raw !== 'object' || !self.isValid(raw)) continue;
      try {
        var taken = await self._taken();
        var id = null;
        for (var n = 1; n < 1000 && !id; n++) {
          var cand = prefix + old + (n === 1 ? '' : (self.exact ? ' (' + n + ')' : '-' + n));
          if (self.idOk(cand) && taken.indexOf(cand.toLowerCase()) === -1) id = cand;
          else if (!self.idOk(cand)) break;
        }
        if (!id) id = await self._idForName(raw.name || old, null);
        await fsp.rename(path.join(self.baseDir, old), self.dirOf(id));
        raw.id = id;
        await self._writeJson(path.join(self.dirOf(id), self.fileName), raw);
        if (self.invalid[old]) delete self.invalid[old];
        moved.push({ old_id: old, id: id });
      } catch (e) {
        if (self.logger) self.logger.warn(C.LOG_PREFIX + self.kind + ' folder ' + old + ' not renamed: ' + e.message);
      }
    }
    return moved;
  });
};

/** Free name "<name> copy", "<name> copy 2", ... */
ProfileStore.prototype._copyName = async function (name) {
  var names = (await this.list()).map(function (p) { return p.name; });
  var suffix = ' copy';
  var base = String(name).slice(0, C.LIMITS.PROFILE_NAME - suffix.length - 4);
  var candidate = base + suffix;
  for (var n = 2; names.indexOf(candidate) !== -1 && n < 1000; n++) candidate = base + suffix + ' ' + n;
  return candidate;
};

/**
 * Duplicate a profile: new name "<name> copy", new id, keys and pictures are copied.
 * The copy is inactive. The data comes from an already checked profile and is taken over 1:1.
 */
ProfileStore.prototype.duplicate = function (id) {
  var self = this;
  return self._serial(async function () {
    var src = await self.get(id);
    if (!src) throw Object.assign(ValidationError(self.notFound), { status: 404 });
    if ((await self.list()).length >= C.LIMITS.PROFILES) throw ValidationError('too_many_profiles', String(C.LIMITS.PROFILES));
    var copy = JSON.parse(JSON.stringify(src));
    copy.name = await self._copyName(src.name);
    copy.id = await self._idForName(copy.name, null);
    var now = new Date().toISOString();
    copy.created = now;
    copy.updated = now;
    var srcDir = self.dirOf(id);
    var dir = self.dirOf(copy.id);
    await mkdirShared(dir);
    try {
      for (var i = 0; i < copy.images.length; i++) {
        var f = copy.images[i];
        if (!f) continue;
        if (!/^image[1-6]\.(jpg|png|webp)$/.test(f)) { copy.images[i] = null; continue; }
        await fsp.copyFile(path.join(srcDir, f), path.join(dir, f)).then(function () { return shareMode(path.join(dir, f), false); },
          function () { copy.images[i] = null; });
      }
      await self._writeJson(path.join(dir, self.fileName), copy);
    } catch (e) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(function () { /* ignore */ });
      throw e;
    }
    return copy;
  });
};

ProfileStore.prototype.remove = function (id) {
  var self = this;
  return self._serial(async function () {
    var dir = self.dirOf(id);
    await fsp.rm(dir, { recursive: true, force: true });
  });
};

/** Store a picture (data URL) in slot 1..6. Checks the type by file signature. */
ProfileStore.prototype.setImage = function (id, slot, dataUrl) {
  var self = this;
  return self._serial(async function () {
    var dir = self.dirOf(id);
    var profile = await self.get(id);
    if (!profile) throw Object.assign(ValidationError(self.notFound), { status: 404 });
    var s = parseInt(slot, 10);
    if (!(s >= 1 && s <= C.LIMITS.IMAGE_SLOTS)) throw ValidationError('slot_invalid');
    var m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
    if (!m) throw ValidationError('image_invalid');
    var buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > C.LIMITS.IMAGE_BYTES) throw ValidationError('image_too_large');
    var ext = null;
    Object.keys(IMAGE_TYPES).forEach(function (k) { if (!ext && IMAGE_TYPES[k].magic(buf)) ext = k; });
    if (!ext) throw ValidationError('image_invalid');
    var file = 'image' + s + '.' + ext;
    var tmp = path.join(dir, file + '.tmp-' + process.pid);
    await fsp.writeFile(tmp, buf, { mode: C.SHARE_FILE_MODE });
    await shareMode(tmp, false);
    await fsp.rename(tmp, path.join(dir, file));
    await self._removeOtherImageFiles(dir, s, file);
    profile.images[s - 1] = file;
    profile.updated = new Date().toISOString();
    await self._writeJson(path.join(dir, self.fileName), profile);
    return profile;
  });
};

ProfileStore.prototype.deleteImage = function (id, slot) {
  var self = this;
  return self._serial(async function () {
    var dir = self.dirOf(id);
    var profile = await self.get(id);
    if (!profile) throw Object.assign(ValidationError(self.notFound), { status: 404 });
    var s = parseInt(slot, 10);
    if (!(s >= 1 && s <= C.LIMITS.IMAGE_SLOTS)) throw ValidationError('slot_invalid');
    await self._removeOtherImageFiles(dir, s, null);
    profile.images[s - 1] = null;
    profile.updated = new Date().toISOString();
    await self._writeJson(path.join(dir, self.fileName), profile);
    return profile;
  });
};

ProfileStore.prototype._removeOtherImageFiles = async function (dir, slot, keep) {
  var names = Object.keys(IMAGE_TYPES).map(function (ext) { return 'image' + slot + '.' + ext; });
  for (var i = 0; i < names.length; i++) {
    if (names[i] !== keep) await fsp.rm(path.join(dir, names[i]), { force: true });
  }
};

/** Path and MIME type of a picture, or null. */
ProfileStore.prototype.imageFile = async function (id, slot) {
  var profile = await this.get(id);
  var s = parseInt(slot, 10);
  if (!profile || !(s >= 1 && s <= C.LIMITS.IMAGE_SLOTS)) return null;
  var file = profile.images[s - 1];
  if (!file || !/^image[1-6]\.(jpg|png|webp)$/.test(file)) return null;
  var ext = file.split('.').pop();
  return { path: path.join(this.dirOf(id), file), mime: IMAGE_TYPES[ext].mime };
};

/** Take over a picture from a file (templates). Checks like setImage. */
ProfileStore.prototype.setImageFile = async function (id, slot, file) {
  var buf = await fsp.readFile(file);
  var ext = null;
  Object.keys(IMAGE_TYPES).forEach(function (k) { if (!ext && IMAGE_TYPES[k].magic(buf)) ext = k; });
  if (!ext) throw ValidationError('image_invalid');
  return this.setImage(id, slot, 'data:' + IMAGE_TYPES[ext].mime + ';base64,' + buf.toString('base64'));
};

module.exports = {
  ProfileStore: ProfileStore,
  sanitizeProfile: sanitizeProfile,
  sanitizeReceiver: sanitizeReceiver,
  receiversOf: receiversOf,
  normDeviceId: normDeviceId,
  folderName: folderName,
  decodeImage: decodeImage,
  mkdirShared: mkdirShared,
  cleanUri: cleanUri,
  sanitizeRadio: sanitizeRadio,
  thdDuplicates: thdDuplicates,
  LOGO_RE: LOGO_RE,
  isFolderName: isFolderName,
  KEY_ALIAS: KEY_ALIAS,
  DEVICE_RE: DEVICE_RE,
  slugify: slugify,
  ValidationError: ValidationError,
  ID_RE: ID_RE
};
