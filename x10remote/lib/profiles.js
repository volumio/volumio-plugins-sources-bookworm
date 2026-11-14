'use strict';

/*
 * Profilverwaltung: /data/INTERNAL/X10/<id>/profile.json (+ image1..3.jpg|png|webp)
 *
 * Alle Eingaben aus der Weboberflaeche werden hier streng geprueft (Typen, Laengen, erlaubte Werte).
 * Schreibzugriffe laufen nacheinander (Warteschlange) und atomar (tmp-Datei + rename).
 */

var fs = require('fs');
var fsp = fs.promises;
var path = require('path');
var C = require('./constants');

var ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
var KEY_ID_RE = /^k[0-9a-z]{1,16}$/;
var DEVICE_RE = /^([0-9a-f]{4}:[0-9a-f]{4}|name:[^\u0000-\u001f]{1,80})$/;
var KEYNAME_RE = /^(KEY|BTN)_[A-Z0-9_]{1,40}$/;
var IMAGE_TYPES = {
  jpg: { mime: 'image/jpeg', magic: function (b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; } },
  png: { mime: 'image/png', magic: function (b) { return b.length > 8 && b.readUInt32BE(0) === 0x89504e47; } },
  webp: { mime: 'image/webp', magic: function (b) { return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'; } }
};

/** data-URL eines Bildes pruefen: { buf, ext } (Typ per Dateisignatur). */
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
  s = s.slice(0, 32).replace(/-+$/g, '');
  return s || 'profil';
}

var LOGO_RE = /^logo-[0-9a-f]{12}\.(png|jpg|webp)$/;

/** Web-Adresse eines Radiosenders: http(s), ohne Leer-/Steuerzeichen; ein #-Anker wird nie gesendet und entfaellt. */
function cleanUri(value) {
  var u = String(value === undefined || value === null ? '' : value).trim().split('#')[0];
  if (!u) return '';
  if (u.length > C.LIMITS.RADIO_URI || !/^https?:\/\/[^\s\u0000-\u001f\u007f"<>\\^`{|}]+$/i.test(u)) return null;
  return u;
}

/**
 * Aktion "radio": { name, uris[1..3] (Failover-Reihenfolge), logo, quality, format }.
 * logo/quality/format sind Anzeigedaten fuer Display-Plugins (z. B. HD44780/VFD).
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

/** Im selben Profil mehrfach gewaehlte Triggerhappy-Tasten: [{ key, names[] }]. */
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
 * Ordnername = gespeicherter Name (Empfaenger): nur Zeichen entfernen, die Windows/SMB nicht erlaubt.
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
  return id.length > 0 && id.length <= 80 && id === folderName(id) && id !== C.RECEIVER_DIR;
}

// Linux-Namen, die nur Bereichsgrenzen markieren (evdev liefert sie zuerst): echter Tastenname
var KEY_ALIAS = { KEY_MIN_INTERESTING: 'KEY_MUTE' };

function normDeviceId(value) {
  var d = cleanText(value, 90, false);
  return d && d.indexOf('name:') !== 0 ? d.toLowerCase() : d;
}

/** Empfaenger eines Profils (aeltere Profile kennen nur "device"). */
function receiversOf(p) {
  if (p && Array.isArray(p.receivers) && p.receivers.length) return p.receivers.slice();
  return p && p.device && p.device.id ? [p.device.id] : [];
}

/**
 * Empfaenger: /data/INTERNAL/X10/_receivers/<id>/receiver.json (+ Bilder). Ein Eintrag je USB-Geraet.
 * rf433: arbeitet mit mehreren Sendern (433-MHz-Funk); sonst gehoert er genau einem Sender.
 */
function sanitizeReceiver(input, existing, opts) {
  opts = opts || {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw ValidationError('invalid_receiver');
  var name = cleanText(input.name, C.LIMITS.PROFILE_NAME, false);
  if (!name) throw ValidationError('name_required');
  var device = input.device && typeof input.device === 'object' ? input.device : {};
  var deviceId = existing ? existing.device.id : normDeviceId(device.id);
  if (!DEVICE_RE.test(deviceId)) throw ValidationError('device_invalid', deviceId);
  var now = new Date().toISOString();
  return {
    format: 1,
    id: existing ? existing.id : null,
    name: name,
    description: cleanText(input.description, C.LIMITS.DESCRIPTION, true),
    notes: (input.notes === undefined && existing) ? (existing.notes || '') : cleanText(input.notes, C.LIMITS.NOTES, true),
    device: { id: deviceId, name: cleanText(device.name !== undefined ? device.name : (existing && existing.device.name), 120, false) },
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
 * Prueft und normalisiert ein Profil aus der Weboberflaeche.
 * @param {object} input       Rohdaten
 * @param {object|null} existing  vorhandenes Profil (fuer id, Bilder, Zeitstempel)
 * @param {object} opts        { allowShell: bool, version: string }
 */
function sanitizeProfile(input, existing, opts) {
  opts = opts || {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw ValidationError('invalid_profile');

  var name = cleanText(input.name, C.LIMITS.PROFILE_NAME, false);
  if (!name) throw ValidationError('name_required');

  var device = input.device && typeof input.device === 'object' ? input.device : {};
  var deviceId = normDeviceId(device.id);
  // Empfaenger (USB-Geraete), mit denen dieser Sender arbeitet. Ohne 433-MHz-Haken genau einer.
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
    if (seen[ident]) return;           // doppelte Taste: erste gewinnt
    seen[ident] = true;

    var allowed = type === 'key' ? C.ACTIONS_KEY : C.ACTIONS_SCAN;
    var thdKey = '';
    if (type === 'scan') {
      // Version 1.3.3 hatte "tkey" als eigene Aktion - jetzt ein eigenes Feld
      thdKey = k.action === 'tkey' ? k.target : k.thd_key;
      thdKey = typeof thdKey === 'string' ? thdKey.trim() : '';
      if (thdKey === 'auto') thdKey = '';
      var keyList = opts.thdKeys || C.FALLBACK_THD_KEYS.concat(C.VIRTUAL_KEYS);
      if (thdKey && (!KEYNAME_RE.test(thdKey) || keyList.indexOf(thdKey) === -1)) {
        throw ValidationError('thd_key_invalid', String(idx + 1));
      }
    }
    var action = typeof k.action === 'string' && allowed.indexOf(k.action) !== -1 ? k.action : (type === 'key' ? 'default' : 'none');
    var command = '';
    if (action === 'custom') {
      command = cleanText(k.command, C.LIMITS.COMMAND, false);
      if (!command) throw ValidationError('command_required', String(idx + 1));
      // Triggerhappy behandelt alles ab '#' als Kommentar - der Befehl waere abgeschnitten
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
 * opts.onPermissionError: async Funktion, die Schreibrechte wiederherstellt (z. B. fuer Ordner, die per
 * SMB von Windows angelegt wurden und dem Gast gehoeren). Danach wird der Vorgang einmal wiederholt.
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
  // exactNames: Ordner heisst wie der Name (Empfaenger); sonst Kurzform (Sender: "medion-20016398")
  this.exact = !!this.opts.exactNames;
  this.idOk = this.exact ? isFolderName : function (id) { return ID_RE.test(String(id || '')) && id !== C.VANILLA_ID; };
  this._queue = Promise.resolve();
}

function isPermError(e) {
  return !!(e && (e.code === 'EACCES' || e.code === 'EPERM'));
}

/** Rechte fuer die SMB-Freigabe setzen (Fehler ignorieren: z. B. Datei gehoert dem SMB-Gast). */
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
  this._queue = run.catch(function () { /* Fehler gehen an den Aufrufer */ });
  if (self.opts.onChange) run.then(function () { self.opts.onChange(); }, function () { /* nichts geaendert */ });
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
  await shareMode(tmp, false);           // writeFile-Modus wird von der umask beschnitten
  await fsp.rename(tmp, file);
};

ProfileStore.prototype.get = async function (id) {
  var self = this;
  var dir = this.dirOf(id);
  try {
    var raw = JSON.parse(await fsp.readFile(path.join(dir, self.fileName), 'utf8'));
    if (!raw || typeof raw !== 'object' || !self.isValid(raw)) return null;
    raw.id = id;
    if (!Array.isArray(raw.images)) raw.images = [];
    while (raw.images.length < C.LIMITS.IMAGE_SLOTS) raw.images.push(null);
    return raw;
  } catch (e) {
    if (e.code !== 'ENOENT' && this.logger) this.logger.warn(C.LOG_PREFIX + self.kind + ' ' + id + ' unreadable: ' + e.message);
    return null;
  }
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

/** Belegte Namen im Ordner (Kleinschreibung: SMB/Windows unterscheiden Gross/Klein nicht). */
ProfileStore.prototype._taken = async function () {
  try {
    return (await fsp.readdir(this.baseDir)).map(function (n) { return n.toLowerCase(); });
  } catch (e) {
    return [];
  }
};

/** Neues Profil anlegen oder vorhandenes aktualisieren. */
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
        profile.id = opts.newId;          // gewuenschte Kennung ist frei
      }
    }
    if (!profile.id) profile.id = await self._uniqueId(profile.name);
    var dir = self.dirOf(profile.id);
    await mkdirShared(dir);
    await self._writeJson(path.join(dir, self.fileName), profile);
    return profile;
  });
};

/** Kennung (Ordnername) passend zum Namen; die eigene Kennung gilt als frei. */
ProfileStore.prototype._idForName = async function (name, ownId) {
  var base = this.exact ? folderName(name) : slugify(name);
  if (!this.exact && base === C.VANILLA_ID) base = 'profil-' + base;   // reserviert fuer das Vanilla-Profil
  var taken = await this._taken();
  for (var n = 1; n < 1000; n++) {
    var cand = n === 1 ? base : (this.exact ? base.slice(0, 74) + ' (' + n + ')' : base + '-' + n);
    if (cand === ownId) return cand;
    if (ownId && cand.toLowerCase() === String(ownId).toLowerCase()) return cand;   // nur Gross/Klein geaendert
    if (taken.indexOf(cand.toLowerCase()) === -1) return cand;
  }
  throw ValidationError('profile_id_exhausted');
};

/**
 * Profil umbenennen: Name und Ordner. Der Ordner unter /data/INTERNAL/X10 heisst danach wie der Name
 * (z. B. "Küche" -> kueche, belegt -> kueche-2). Tasten und Bilder bleiben erhalten.
 * Rueckgabe: Profil mit neuer Kennung; old_id = bisherige Kennung.
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
      await fsp.rename(dir, self.dirOf(newId));       // gleiches Dateisystem: atomar
      profile.id = newId;
      await self._writeJson(path.join(self.dirOf(newId), self.fileName), profile);
    }
    profile.old_id = id;
    return profile;
  });
};

/** Freier Name "<name> copy", "<name> copy 2", ... */
ProfileStore.prototype._copyName = async function (name) {
  var names = (await this.list()).map(function (p) { return p.name; });
  var suffix = ' copy';
  var base = String(name).slice(0, C.LIMITS.PROFILE_NAME - suffix.length - 4);
  var candidate = base + suffix;
  for (var n = 2; names.indexOf(candidate) !== -1 && n < 1000; n++) candidate = base + suffix + ' ' + n;
  return candidate;
};

/**
 * Profil duplizieren: neuer Name "<name> copy", neue Kennung, Tasten und Bilder werden kopiert.
 * Die Kopie ist inaktiv. Die Daten stammen aus einem bereits geprueften Profil und werden 1:1 uebernommen.
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

/** Bild (data-URL) in Platz 1..3 speichern. Prueft Typ anhand der Dateisignatur. */
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

/** Pfad und MIME-Typ eines Bildes, oder null. */
ProfileStore.prototype.imageFile = async function (id, slot) {
  var profile = await this.get(id);
  var s = parseInt(slot, 10);
  if (!profile || !(s >= 1 && s <= C.LIMITS.IMAGE_SLOTS)) return null;
  var file = profile.images[s - 1];
  if (!file || !/^image[1-6]\.(jpg|png|webp)$/.test(file)) return null;
  var ext = file.split('.').pop();
  return { path: path.join(this.dirOf(id), file), mime: IMAGE_TYPES[ext].mime };
};

/** Bild aus einer Datei uebernehmen (Vorlagen). Prueft wie setImage. */
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
