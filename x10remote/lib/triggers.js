'use strict';

/*
 * Triggerhappy helpers
 *  - readOtherTriggers(): reads (read-only!) all other *.conf in triggers.d, e.g. Volumio's audio.conf
 *  - buildMappings():     active profiles -> assignments for the mapper (with virtual keys)
 *  - buildThdConf():      content of x10remote.conf
 *
 * Replacing without changing audio.conf: if an already recognised key (type "key") has an own action,
 * the mapper grabs it exclusively and emits it as a virtual key. audio.conf then no longer sees the
 * original key of this remote; for all other devices it applies unchanged.
 */

var fs = require('fs');
var fsp = fs.promises;
var path = require('path');
var C = require('./constants');
var receiversOf = require('./profiles').receiversOf;

var EVENT_RE = /^(KEY|BTN)_[A-Z0-9_]+$/;

/** { KEY_VOLUMEUP: [{file, value, command}], ... } from all foreign Triggerhappy files. */
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
      if (!m || !EVENT_RE.test(m[1])) return;     // combinations (KEY_A+KEY_B) are not considered
      (result[m[1]] = result[m[1]] || []).push({ file: files[i], value: parseInt(m[2], 10), command: m[3].trim() });
    });
  }
  return result;
}

/**
 * All lines of the foreign Triggerhappy files unchanged (without comments/empty lines) - for exclusive
 * mode, in which Triggerhappy does not read these files itself. Read-only.
 * Returns [{ file, lines: [{ event, raw }] }]
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

/** Text for one line of a Triggerhappy file: remove all control characters (in comments too!). */
function oneLine(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ');
}

/** Valid key name for Triggerhappy (whitelist format). */
function validKey(k) {
  return typeof k === 'string' && /^(KEY|BTN)_[A-Z0-9_]{1,40}$/.test(k);
}

function hex(n) {
  var h = Number(n).toString(16);
  return '0x' + (h.length < 2 ? '0' + h : h);
}

function sourceText(k) {
  var code = Number(k.code);
  if (!(code >= 0)) code = 0;
  return k.type === 'scan' ? 'Scan ' + hex(code) : (validKey(k.key_name) ? k.key_name : ('Key ' + code));
}

/** Two assignments of the same code have the same effect (then it is not a conflict). */
function sameEffect(a, b) {
  if (a.action !== b.action) return false;
  if (a.type === 'scan' && (a.thd_key || '') !== (b.thd_key || '')) return false;
  if (a.action === 'custom') return String(a.command || '').trim() === String(b.command || '').trim();
  if (a.action === 'radio') return JSON.stringify((a.radio || {}).uris || []) === JSON.stringify((b.radio || {}).uris || []);
  return true;
}

/** Command line for Triggerhappy, or null. */
function commandFor(k, allowShell, profileId) {
  if (!k.action || k.action === 'none' || k.action === 'default') return null;
  if (k.action === 'radio') {
    // x10remote-action reads the station data from the catalogue (no URI in the command line: '#', quotes)
    var pid = k.profile || profileId;
    var kid = k.key_id || k.id;
    if (!k.radio || !/^[a-z0-9-]+$/.test(String(pid || '')) || !/^k[0-9a-z]+$/.test(String(kid || ''))) return null;
    return C.ACTION_BIN + ' radio ' + pid + '/' + kid;
  }
  if (k.action === 'custom') {
    if (!allowShell) return null;
    // Triggerhappy reads line by line and treats everything from '#' on as a comment
    var c = oneLine(k.command).trim();
    if (!c || c.indexOf('#') !== -1) return null;
    return c;
  }
  if (C.BUILTIN_ACTIONS.indexOf(k.action) === -1) return null;
  return C.ACTION_BIN + ' ' + k.action;
}

/**
 * Active profiles -> assignments. Order of the profiles = order of activation.
 * other = readOtherTriggers() (audio.conf etc., read only).
 *
 * Principle: a key with an own action NEVER additionally triggers a command from audio.conf or another
 * Triggerhappy file. Therefore every assignment with an own action gets an output key that only
 * x10remote.conf reacts to:
 *  - recognised keys (type key): grabbed exclusively, emitted as a free virtual key
 *  - scan-code keys with a chosen Triggerhappy key (e.g. KEY_PLAYPAUSE): if that key is already used
 *    elsewhere (audio.conf, another file, driver of an active remote, scan key without own action),
 *    the wrapper internally emits a free virtual key ("shielded"); the chosen key is still what is
 *    displayed.
 *  - The same Triggerhappy key may be chosen several times (in the same or in different profiles):
 *    keys with the SAME command share the key (one command line, nothing taken from the pool);
 *    the first key with a DIFFERENT command keeps the chosen key, every further one internally gets
 *    a free virtual key ("shielded") - so one press never runs two commands.
 * The pool of virtual keys only contains keys no other Triggerhappy file uses.
 * Returns { mappings: [...], problems: [...] }
 */
function buildMappings(profiles, allowShell, other, poolKeys) {
  other = other || {};
  // poolKeys: usable virtual keys (see listThdKeys); without it only the ones known everywhere
  poolKeys = poolKeys || C.VIRTUAL_KEYS.slice(0, C.VIRTUAL_KEYS_BASE);
  var chosenCount = {};
  var driverKeys = {};
  // Several transmitters on one (433 MHz) receiver can deliver the same codes - the receiver cannot
  // tell them apart. Then the assignment of the profile activated last applies; keys with the same
  // assignment are no conflict. Therefore the profiles are processed in reverse order of activation.
  var ordered = profiles.slice().reverse();
  var claimed = {};
  var rawChosen = {};        // chosen keys that are (also) emitted without an own command
  var direct = {};           // chosen key -> command that uses it directly
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
      if (!wins) return;                                   // taken everywhere by a newer profile
      var name = scanThdKey(k);
      if (name) {
        chosenCount[name] = (chosenCount[name] || 0) + 1;
        // scan key that emits the chosen key without an own command (for audio.conf or similar)
        var cmd0 = commandFor({ profile: p.id, key_id: k.id, action: k.action, command: k.command || '', radio: k.radio }, allowShell);
        if (!cmd0) rawChosen[name] = true;
      }
      // recognised keys that reach Triggerhappy unchanged
      if (k.type === 'key' && k.key_name && (k.action === 'default' || !k.action)) driverKeys[k.key_name] = true;
    });
  });
  var pool = poolKeys.filter(function (k) {
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
    // A transmitter can (433 MHz) work with several receivers: one assignment per receiver.
    // The output key is the same for all receivers (the first pass assigns it).
    var outFor = {};
    var shieldFor = {};
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
      if (k.type === 'key' && k.action === 'default') return;          // pass through unchanged
      if (taken[ident]) {
        // same code already taken by a profile activated later: same effect -> no notice
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
        if (k.type === 'key') return;                                   // the original stays active
      }
      // scan-code keys are always translated: chosen Triggerhappy key or a free virtual key
      var chosenKey = k.type === 'scan' ? scanThdKey(k) : '';
      var cmd = commandFor(base, allowShell);
      var hasCmd = !!cmd;
      var shielded = false;
      var shieldBy = [];
      if (chosenKey && hasCmd) {
        if (other[chosenKey] && other[chosenKey].length) {
          other[chosenKey].forEach(function (a) { if (shieldBy.indexOf(a.file) === -1) shieldBy.push(a.file); });
        }
        if (driverKeys[chosenKey]) shieldBy.push('driver');
        // another scan key emits the same key without an own command -> its press must not trigger
        // this command
        if (rawChosen[chosenKey]) shieldBy.push('profile');
        // chosen several times: the same command shares the key, a different command is shielded
        if (!shieldBy.length && !outFor[k.id]) {
          if (direct[chosenKey] === undefined) direct[chosenKey] = cmd;
          else if (direct[chosenKey] !== cmd) shieldBy.push('profile');
        }
        shielded = shieldBy.length > 0;
      }
      // further receiver of the same transmitter: the same decision as for the first
      if (shieldFor[k.id]) { shielded = shieldFor[k.id].shielded; shieldBy = shieldFor[k.id].by; }
      else shieldFor[k.id] = { shielded: shielded, by: shieldBy };
      var outKey = outFor[k.id] || ((chosenKey && !shielded) ? chosenKey : pool.shift());
      outFor[k.id] = outKey;
      if (!outKey) {
        problems.push({ code: 'pool_exhausted', profile: p.id, key: k.name, max: poolKeys.length });
        return;
      }
      taken[ident] = { name: p.name, k: k };
      mappings.push(Object.assign(base, {
        mode: 'emit',
        key: outKey,                         // key the mapper really emits
        thd_key: chosenKey || outKey,        // key the key is displayed as
        chosen: !!chosenKey,
        shielded: shielded,                  // audio.conf & co. are not executed for this key
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

/** Fixed Triggerhappy key of a scan-code key ('' = automatic). */
function scanThdKey(k) {
  if (k.type !== 'scan') return '';
  if (k.thd_key) return k.thd_key;
  return '';
}

/** Empty lines become '#': Triggerhappy reports every empty line as "Unable to parse trigger line". */
function confText(lines) {
  return lines.map(function (l) { return l === '' ? '#' : l; }).join('\n') + '\n';
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
  var writtenLine = {};
  mappings.forEach(function (m) {
    // transmitter on several receivers: same output key - write the command line only once,
    // otherwise Triggerhappy would run the command twice.
    if (written[m.id]) {
      lines.push('#   ' + oneLine(m.id) + ' also via receiver ' + oneLine(m.device) + ' (same key ' + oneLine(m.key || '-') + ')');
      return;
    }
    written[m.id] = true;
    lines.push('# ' + oneLine(m.profile_name || m.profile) + ' | ' +
      oneLine(m.label) + (m.remote_label ? ' [' + oneLine(m.remote_label) + ']' : '') +
      ' | ' + oneLine(m.device) + ' | ' + sourceText(m) + (m.shielded ? ' | as ' + oneLine(m.thd_key) + ' (internally ' + oneLine(m.key) +
      ', so that ' + oneLine((m.shield_by || []).join('/')) + ' does not run as well)' : ''));
    if (m.description) lines.push('#   ' + oneLine(m.description));
    if (m.mode === 'swallow') {
      lines.push('#   locked (swallowed by the mapper)');
      return;
    }
    if (!validKey(m.key)) {
      lines.push('#   skipped: invalid key name');
      return;
    }
    var cmd = commandFor(m, allowShell);
    if (m.mode === 'emit' && !cmd) {
      lines.push('#   ' + m.key + (m.virtual ? '\t(virtual key, no own action)'
        : '\t(no own action - other Triggerhappy files such as audio.conf apply)'));
      return;
    }
    // Several keys share the same Triggerhappy key with the same command: write the line only once -
    // Triggerhappy runs every matching line.
    var line = m.key + '\t1\t' + oneLine(cmd);
    if (writtenLine[line]) {
      lines.push('#   shares ' + m.key + ' with the same command (line above) - written once');
      return;
    }
    writtenLine[line] = true;
    lines.push(line);
  });
  return confText(lines);
}

/**
 * File for exclusive mode (Triggerhappy reads only this folder):
 *  1. the own assignments (as buildThdConf)
 *  2. per profile: keys without own action for which audio.conf (or another file) has a command - taken over
 *  3. all remaining lines of the foreign files for devices without a profile - taken over
 * Every line of the foreign files appears at most once; output keys of the plugin do not collide with
 * lines taken over (see buildMappings: shielded keys, pool without foreign keys).
 */
function buildExclusiveConf(mappings, profiles, allowShell, raw) {
  var one = oneLine;
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
      if (k.type === 'key' && !m) ev = k.key_name;                                  // Volumio default
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
  return confText(lines);
}

/** All key names Triggerhappy knows (`thd --listevents`), otherwise the built-in list. */
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
    // stock for "automatic": the 36 base keys always, KEY_MACRO1-30 only if thd lists them itself
    var pool = C.VIRTUAL_KEYS.filter(function (k, i) {
      return i < C.VIRTUAL_KEYS_BASE || (source === 'thd' && list.indexOf(k) !== -1);
    });
    pool.forEach(function (k) { if (list.indexOf(k) === -1) list.push(k); });
    list.sort(keyOrder);
    var result = { keys: list, source: source, pool: pool };
    if (source === 'thd') thdKeyCache = result;      // do not keep the fallback list permanently
    return result;
  });
}

/** KEY_ before BTN_, then alphabetically with numbers in natural order. */
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
  hex: hex,
  oneLine: oneLine
};
