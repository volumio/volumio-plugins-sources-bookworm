'use strict';

/*
 * Triggerhappy-Hilfen
 *  - readOtherTriggers(): liest (nur lesend!) alle anderen *.conf in triggers.d, z. B. Volumios audio.conf
 *  - buildMappings():     aktive Profile -> Belegungen fuer den Mapper (mit virtuellen Tasten)
 *  - buildThdConf():      Inhalt von x10remote.conf
 *
 * Ersetzen ohne audio.conf zu aendern: Hat eine bereits erkannte Taste (Typ "key") eine eigene Aktion,
 * wird sie vom Mapper exklusiv abgefangen und als virtuelle Taste ausgegeben. audio.conf sieht die
 * Originaltaste dieser Fernbedienung dann nicht mehr; fuer alle anderen Geraete gilt sie unveraendert.
 */

var fs = require('fs');
var fsp = fs.promises;
var path = require('path');
var C = require('./constants');
var receiversOf = require('./profiles').receiversOf;

var EVENT_RE = /^(KEY|BTN)_[A-Z0-9_]+$/;

/** { KEY_VOLUMEUP: [{file, value, command}], ... } aus allen fremden Triggerhappy-Dateien. */
async function readOtherTriggers(dir) {
  dir = dir || C.THD_DIR;
  var result = {};
  var files;
  try {
    files = (await fsp.readdir(dir)).filter(function (f) { return /\.conf$/.test(f) && f !== C.THD_CONF_NAME; }).sort();
  } catch (e) {
    return result;
  }
  for (var i = 0; i < files.length; i++) {
    var text;
    try {
      text = await fsp.readFile(path.join(dir, files[i]), 'utf8');
    } catch (e) {
      continue;
    }
    text.split(/\r?\n/).forEach(function (line) {
      var l = line.replace(/#.*$/, '').trim();
      if (!l) return;
      var m = /^(\S+)\s+(\d+)\s+(.+)$/.exec(l);
      if (!m || !EVENT_RE.test(m[1])) return;     // Kombinationen (KEY_A+KEY_B) werden nicht betrachtet
      (result[m[1]] = result[m[1]] || []).push({ file: files[i], value: parseInt(m[2], 10), command: m[3].trim() });
    });
  }
  return result;
}

/**
 * Alle Zeilen der fremden Triggerhappy-Dateien unveraendert (ohne Kommentare/Leerzeilen) - fuer den
 * Exklusivbetrieb, in dem Triggerhappy diese Dateien nicht selbst liest. Nur lesend.
 * Rueckgabe: [{ file, lines: [{ event, raw }] }]
 */
async function readOtherRaw(dir) {
  dir = dir || C.THD_DIR;
  var files;
  try {
    files = (await fsp.readdir(dir)).filter(function (f) { return /\.conf$/.test(f) && f !== C.THD_CONF_NAME; }).sort();
  } catch (e) {
    return [];
  }
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var text;
    try {
      text = await fsp.readFile(path.join(dir, files[i]), 'utf8');
    } catch (e) {
      continue;
    }
    var lines = [];
    text.split(/\r?\n/).forEach(function (line) {
      var l = line.replace(/#.*$/, '').trim();
      if (!l || /[\u0000-\u0008\u000b-\u001f]/.test(l)) return;
      lines.push({ event: l.split(/\s+/)[0], raw: l });
    });
    out.push({ file: files[i], lines: lines });
  }
  return out;
}

function hex(n) {
  var h = Number(n).toString(16);
  return '0x' + (h.length < 2 ? '0' + h : h);
}

function sourceText(k) {
  return k.type === 'scan' ? 'Scan ' + hex(k.code) : (k.key_name || ('Key ' + k.code));
}

/** Zwei Belegungen desselben Codes bewirken dasselbe (dann ist es kein Konflikt). */
function sameEffect(a, b) {
  if (a.action !== b.action) return false;
  if (a.type === 'scan' && (a.thd_key || '') !== (b.thd_key || '')) return false;
  if (a.action === 'custom') return String(a.command || '').trim() === String(b.command || '').trim();
  if (a.action === 'radio') return JSON.stringify((a.radio || {}).uris || []) === JSON.stringify((b.radio || {}).uris || []);
  return true;
}

/** Befehlszeile fuer Triggerhappy oder null. */
function commandFor(k, allowShell, profileId) {
  if (!k.action || k.action === 'none' || k.action === 'default' || k.action === 'tkey') return null;
  if (k.action === 'radio') {
    // Senderdaten liest x10remote-action aus dem Katalog (keine URI in der Befehlszeile: '#', Anfuehrungszeichen)
    var pid = k.profile || profileId;
    var kid = k.key_id || k.id;
    if (!k.radio || !/^[a-z0-9-]+$/.test(String(pid || '')) || !/^k[0-9a-z]+$/.test(String(kid || ''))) return null;
    return C.ACTION_BIN + ' radio ' + pid + '/' + kid;
  }
  if (k.action === 'custom') {
    if (!allowShell) return null;
    var c = String(k.command || '').replace(/[\r\n]+/g, ' ').trim();
    return c || null;
  }
  if (C.BUILTIN_ACTIONS.indexOf(k.action) === -1) return null;
  return C.ACTION_BIN + ' ' + k.action;
}

/**
 * Aktive Profile -> Belegungen. Reihenfolge der Profile = Reihenfolge der Aktivierung.
 * other = readOtherTriggers() (audio.conf usw., nur gelesen).
 *
 * Grundsatz: Eine Taste mit eigener Aktion loest NIE zusaetzlich einen Befehl aus audio.conf oder einer
 * anderen Triggerhappy-Datei aus. Deshalb erhaelt jede Belegung mit eigener Aktion eine Ausgabetaste,
 * auf die nur x10remote.conf reagiert:
 *  - erkannte Tasten (type key): exklusiv abgefangen, Ausgabe als freie virtuelle Taste
 *  - Scan-Code-Tasten mit gewaehlter Triggerhappy-Taste (z. B. KEY_PLAYPAUSE): ist diese Taste bereits
 *    anderweitig belegt (audio.conf, andere Datei, Treiber einer aktiven Fernbedienung, andere Scan-Taste),
 *    gibt der Wrapper intern eine freie virtuelle Taste aus ("geschuetzt"); angezeigt wird weiter die
 *    gewaehlte Taste.
 * Der Pool der virtuellen Tasten enthaelt nur Tasten, die keine andere Triggerhappy-Datei verwendet.
 * Rueckgabe: { mappings: [...], problems: [...] }
 */
function buildMappings(profiles, allowShell, other) {
  other = other || {};
  var chosenCount = {};
  var driverKeys = {};
  // Mehrere Sender an einem (433-MHz-)Empfaenger koennen gleiche Codes liefern - der Empfaenger kann sie
  // nicht unterscheiden. Dann gilt die Belegung des zuletzt aktivierten Profils; gleich belegte Tasten
  // sind kein Konflikt. Deshalb werden die Profile in umgekehrter Aktivierungsreihenfolge verarbeitet.
  var ordered = profiles.slice().reverse();
  var claimed = {};
  ordered.forEach(function (p) {
    var devs = receiversOf(p);
    (p.keys || []).forEach(function (k) {
      if (k.type === 'key' && k.action === 'default') {
        if (k.key_name) driverKeys[k.key_name] = true;
        return;
      }
      var wins = false;
      devs.forEach(function (d) {
        var ident = d + '|' + k.type + '|' + k.code;
        if (!claimed[ident]) { claimed[ident] = true; wins = true; }
      });
      if (!wins) return;                                   // ueberall von einem neueren Profil belegt
      var name = scanThdKey(k);
      if (name) chosenCount[name] = (chosenCount[name] || 0) + 1;
      // erkannte Tasten, die unveraendert bei Triggerhappy ankommen
      if (k.type === 'key' && k.key_name && (k.action === 'default' || !k.action)) driverKeys[k.key_name] = true;
    });
  });
  var pool = C.VIRTUAL_KEYS.filter(function (k) {
    return !chosenCount[k] && !(other[k] && other[k].length) && !driverKeys[k];
  });
  var mappings = [];
  var problems = [];
  var taken = {};
  ordered.forEach(function (p) {
    var devices = receiversOf(p);
    if (!devices.length) {
      problems.push({ code: 'no_device', profile: p.id });
      return;
    }
    // Ein Sender kann (433 MHz) mit mehreren Empfaengern arbeiten: Belegung je Empfaenger.
    // Die Ausgabetaste ist fuer alle Empfaenger dieselbe (erster Durchlauf vergibt sie).
    var outFor = {};
    devices.forEach(function (device) {
    (p.keys || []).forEach(function (k) {
      var ident = device + '|' + k.type + '|' + k.code;
      var base = {
        id: p.id + '/' + k.id, profile: p.id, profile_name: p.name, key_id: k.id,
        label: k.name, device: device, type: k.type, code: k.code, key_name: k.key_name || null,
        action: k.action, command: k.command || '', repeat: !!k.repeat,
        remote_label: k.remote_label || '', description: k.description || '',
        radio: k.action === 'radio' && k.radio ? { name: k.radio.name } : null
      };
      if (k.type === 'key' && k.action === 'default') return;          // unveraendert durchreichen
      if (taken[ident]) {
        // gleicher Code schon von einem zuletzt aktivierten Profil belegt: gleiche Wirkung -> kein Hinweis
        if (!sameEffect(taken[ident].k, k)) {
          problems.push({ code: 'overridden', profile: p.id, key: k.remote_label || k.name, other: taken[ident].name });
        }
        return;
      }
      if (k.type === 'key' && k.action === 'none') {
        taken[ident] = { name: p.name, k: k };
        mappings.push(Object.assign(base, { mode: 'swallow', key: null }));
        return;
      }
      if (k.action === 'custom' && !allowShell) {
        problems.push({ code: 'shell_disabled', profile: p.id, key: k.name });
        if (k.type === 'key') return;                                   // Original bleibt aktiv
      }
      // Scan-Code-Tasten werden immer umgesetzt: gewaehlte Triggerhappy-Taste oder freie virtuelle Taste
      var chosenKey = k.type === 'scan' ? scanThdKey(k) : '';
      var hasCmd = !!commandFor(base, allowShell);
      var shielded = false;
      var shieldBy = [];
      if (chosenKey && hasCmd) {
        if (other[chosenKey] && other[chosenKey].length) {
          other[chosenKey].forEach(function (a) { if (shieldBy.indexOf(a.file) === -1) shieldBy.push(a.file); });
        }
        if (driverKeys[chosenKey]) shieldBy.push('driver');
        if (chosenCount[chosenKey] > 1) shieldBy.push('profile');
        shielded = shieldBy.length > 0;
      }
      var outKey = outFor[k.id] || ((chosenKey && !shielded) ? chosenKey : pool.shift());
      outFor[k.id] = outKey;
      if (!outKey) {
        problems.push({ code: 'pool_exhausted', profile: p.id, key: k.name });
        return;
      }
      taken[ident] = { name: p.name, k: k };
      mappings.push(Object.assign(base, {
        mode: 'emit',
        key: outKey,                         // Taste, die der Mapper tatsaechlich ausgibt
        thd_key: chosenKey || outKey,        // Taste, als die die Taste angezeigt wird
        chosen: !!chosenKey,
        shielded: shielded,                  // audio.conf & Co. werden fuer diese Taste nicht ausgefuehrt
        shield_by: shieldBy,
        virtual: !chosenKey
      }));
    });
    });
  });
  var seenProblem = {};
  problems = problems.filter(function (x) {
    var key = JSON.stringify(x);
    if (seenProblem[key]) return false;
    seenProblem[key] = true;
    return true;
  });
  return { mappings: mappings, problems: problems };
}

/** Fest gewaehlte Triggerhappy-Taste einer Scan-Code-Taste ('' = automatisch). */
function scanThdKey(k) {
  if (k.type !== 'scan') return '';
  if (k.thd_key) return k.thd_key;
  if (k.action === 'tkey' && k.target) return k.target;                 // Profile aus Version 1.3.3
  return '';
}

function buildThdConf(mappings, allowShell) {
  var lines = [
    '# Generated by the Volumio plugin "X10 RF Remote" - do not edit by hand.',
    '# Make changes in the plugin\'s web interface (profiles).',
    '# Virtual keys come from the device "X10Remote virtual keyboard" (x10mapper.service).',
    '# Other files in this directory (e.g. audio.conf) are never modified by the plugin.',
    ''
  ];
  var written = {};
  mappings.forEach(function (m) {
    // Sender an mehreren Empfaengern: gleiche Ausgabetaste - die Befehlszeile nur einmal schreiben,
    // sonst fuehrte Triggerhappy den Befehl doppelt aus.
    if (written[m.id]) {
      lines.push('#   ' + m.id + ' also via receiver ' + m.device + ' (same key ' + (m.key || '-') + ')');
      return;
    }
    written[m.id] = true;
    lines.push('# ' + String(m.profile_name || m.profile).replace(/[\r\n]+/g, ' ') + ' | ' +
      String(m.label || '').replace(/[\r\n]+/g, ' ') + (m.remote_label ? ' [' + m.remote_label + ']' : '') +
      ' | ' + m.device + ' | ' + sourceText(m) + (m.shielded ? ' | as ' + m.thd_key + ' (internally ' + m.key +
      ', so that ' + m.shield_by.join('/') + ' does not run as well)' : ''));
    if (m.description) lines.push('#   ' + String(m.description).replace(/[\r\n]+/g, ' '));
    if (m.mode === 'emit' && !commandFor(m, allowShell)) {
      lines.push('#   ' + m.key + (m.virtual ? '\t(virtual key, no own action)'
        : '\t(no own action - other Triggerhappy files such as audio.conf apply)'));
      return;
    }
    if (m.mode === 'swallow') {
      lines.push('#   locked (swallowed by the mapper)');
      return;
    }
    lines.push(m.key + '\t1\t' + commandFor(m, allowShell));
  });
  return lines.join('\n') + '\n';
}

/**
 * Datei fuer den Exklusivbetrieb (Triggerhappy liest nur diesen Ordner):
 *  1. die eigenen Belegungen (wie buildThdConf)
 *  2. je Profil: Tasten ohne eigene Aktion, fuer die audio.conf (o. a.) einen Befehl hat - uebernommen
 *  3. alle uebrigen Zeilen der fremden Dateien fuer Geraete ohne Profil - uebernommen
 * Jede Zeile der fremden Dateien erscheint hoechstens einmal; Ausgabetasten des Plugins kollidieren nicht
 * mit uebernommenen Zeilen (siehe buildMappings: geschuetzte Tasten, Pool ohne fremde Tasten).
 */
function buildExclusiveConf(mappings, profiles, allowShell, raw) {
  var one = function (s) { return String(s || '').replace(/[\r\n]+/g, ' '); };
  var lines = [
    '# Generated by the Volumio plugin "X10 RF Remote" - exclusive mode.',
    '# Triggerhappy currently reads ONLY this file. audio.conf and the other files in ' + C.THD_DIR,
    '# stay unchanged; their commands are copied below unless a profile assigns the key differently.',
    ''
  ];
  lines = lines.concat(buildThdConf(mappings, allowShell).split('\n').slice(5).filter(function (l, i, a) {
    return !(l === '' && i === a.length - 1);
  }));
  var byEvent = {};
  raw.forEach(function (f) {
    f.lines.forEach(function (l) { (byEvent[l.event] = byEvent[l.event] || []).push({ file: f.file, raw: l.raw }); });
  });
  var done = {};
  var byId = {};
  mappings.forEach(function (m) { byId[m.id] = m; });

  var section = [];
  profiles.forEach(function (p) {
    (p.keys || []).forEach(function (k) {
      var m = byId[p.id + '/' + k.id];
      var ev = null;
      if (k.type === 'key' && !m) ev = k.key_name;                                  // Volumio-Standard
      else if (k.type === 'scan' && m && m.mode === 'emit' && !commandFor(m, allowShell)) ev = m.key;
      if (!ev || done[ev] || !byEvent[ev]) return;
      done[ev] = true;
      section.push('# ' + one(p.name) + ' | ' + one(k.name) + (k.remote_label ? ' [' + one(k.remote_label) + ']' : '') +
        ' | ' + sourceText(k) + ' | Volumio default, copied from ' +
        byEvent[ev].map(function (x) { return x.file; }).filter(function (f, i, a) { return a.indexOf(f) === i; }).join(', '));
      byEvent[ev].forEach(function (x) { section.push(x.raw); });
    });
  });
  if (section.length) {
    lines.push('', '# ---- Volumio defaults of the profiles (copied) ----');
    lines = lines.concat(section);
  }
  raw.forEach(function (f) {
    var rest = f.lines.filter(function (l) { return !done[l.event]; });
    if (!rest.length) return;
    lines.push('', '# ---- Other devices: copied from ' + f.file + ' ----');
    rest.forEach(function (l) { lines.push(l.raw); });
  });
  return lines.join('\n') + '\n';
}

/** Alle Tastennamen, die Triggerhappy kennt (`thd --listevents`), sonst die eingebaute Liste. */
var thdKeyCache = null;
function listThdKeys(execFile) {
  if (thdKeyCache) return Promise.resolve(thdKeyCache);
  var tryBin = function (i) {
    if (i >= C.THD_BIN_CANDIDATES.length) return Promise.resolve(null);
    return execFile(C.THD_BIN_CANDIDATES[i], ['--listevents']).then(function (out) {
      var names = {};
      String(out).split(/\s+/).forEach(function (w) {
        if (/^(KEY|BTN)_[A-Z0-9_]+$/.test(w) && !/_(MAX|CNT)$/.test(w) && w !== 'KEY_RESERVED') names[w] = true;
      });
      var list = Object.keys(names);
      return list.length > 50 ? list : tryBin(i + 1);
    }, function () { return tryBin(i + 1); });
  };
  return tryBin(0).then(function (list) {
    var source = list ? 'thd' : 'fallback';
    list = (list || C.FALLBACK_THD_KEYS.slice());
    C.VIRTUAL_KEYS.forEach(function (k) { if (list.indexOf(k) === -1) list.push(k); });
    list.sort(keyOrder);
    var result = { keys: list, source: source };
    if (source === 'thd') thdKeyCache = result;      // Ersatzliste nicht dauerhaft merken
    return result;
  });
}

/** KEY_ vor BTN_, dann alphabetisch mit Zahlen in natuerlicher Reihenfolge. */
function keyOrder(a, b) {
  var pa = a.indexOf('BTN_') === 0 ? 1 : 0;
  var pb = b.indexOf('BTN_') === 0 ? 1 : 0;
  if (pa !== pb) return pa - pb;
  return a.localeCompare(b, 'en', { numeric: true });
}

module.exports = {
  listThdKeys: listThdKeys,
  readOtherTriggers: readOtherTriggers,
  readOtherRaw: readOtherRaw,
  buildExclusiveConf: buildExclusiveConf,
  buildMappings: buildMappings,
  buildThdConf: buildThdConf,
  commandFor: commandFor,
  sourceText: sourceText,
  hex: hex
};
