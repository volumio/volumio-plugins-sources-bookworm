'use strict';

const fs = require('fs');
const path = require('path');

// ---------- small helpers ----------

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  const fd = fs.openSync(tmp, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

const isStr = s => typeof s === 'string' && s.length > 0;
const plain = o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

// Stable identity of a station address.
// TuneIn and Shoutcast list addresses carry a station id; the rest is compared as
// a plain address without scheme, fragment and trailing slash.
function keyOf(uri) {
  const u = String(uri || '').trim();
  const id = /[?&]id=([A-Za-z0-9_-]+)/.exec(u);
  if (id && /Tune\.ashx/i.test(u)) return 'tunein:' + id[1];
  if (id && /tunein-station\.(m3u|pls)/i.test(u)) return 'shoutcast:' + id[1];
  return u.replace(/#.*$/, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// ---------- the store ----------

class Store {
  /**
   * @param {string} dir   plugin data directory (inside the Volumio configuration tree)
   * @param {object} opts  { maxSeen, maxStreamMap, flushMs }
   */
  constructor(dir, opts) {
    const o = opts || {};
    this.dir = dir;
    this.blockFile = path.join(dir, 'blocklist.json');
    this.stateFile = path.join(dir, 'state.json');
    this.maxSeen = o.maxSeen || 3000;
    this.maxStreamMap = o.maxStreamMap || 500;
    this.flushMs = o.flushMs === undefined ? 5000 : o.flushMs;
    this.timer = null;
    this.blockDirty = false;
    this.stateDirty = false;
    this.load();
  }

  load() {
    const b = readJson(this.blockFile, {});
    this.manual = (Array.isArray(b.manual) ? b.manual : []).filter(isStr);
    this.dead = plain(b.dead);
    const s = readJson(this.stateFile, {});
    this.seen = plain(s.seen);
    this.streamMap = plain(s.streamMap);
    this.checks = plain(s.checks);
    this.legacyImported = !!s.legacyImported;
    this.rebuild();
  }

  rebuild() {
    this.keys = new Set();
    this.manual.forEach(u => this.keys.add(keyOf(u)));
    Object.keys(this.dead).forEach(u => this.keys.add(keyOf(u)));
  }

  // ----- blocking -----

  isBlocked(uri) {
    return isStr(uri) && this.keys.has(keyOf(uri));
  }

  blockManual(uris) {
    let added = 0;
    (uris || []).filter(isStr).forEach(u => {
      if (!this.keys.has(keyOf(u))) {
        this.manual.push(u);
        this.keys.add(keyOf(u));
        added++;
      }
    });
    if (added) { this.blockDirty = true; this.schedule(); }
    return added;
  }

  unblockManual() {
    const n = this.manual.length;
    this.manual = [];
    this.rebuild();
    if (n) { this.blockDirty = true; this.schedule(); }
    return n;
  }

  unblockDead() {
    const n = Object.keys(this.dead).length;
    this.dead = {};
    Object.keys(this.checks).forEach(u => { this.checks[u].fails = 0; });
    this.rebuild();
    if (n) { this.blockDirty = true; this.stateDirty = true; this.schedule(); }
    return n;
  }

  // one-time import of the rules written by the earlier Remove Track 1.1.0
  importLegacy(file) {
    if (this.legacyImported) return 0;
    this.legacyImported = true;
    this.stateDirty = true;
    const old = readJson(file, {});
    const urls = old.blacklist && Array.isArray(old.blacklist.urls) ? old.blacklist.urls : [];
    const n = this.blockManual(urls);
    this.schedule();
    return n;
  }

  // ----- registry of stations the user has been shown -----

  noteSeen(uri, title) {
    if (!isStr(uri)) return;
    const k = keyOf(uri);
    const e = this.seen[k];
    if (e) {
      e.last = Date.now();
      if (title && !e.title) e.title = String(title).slice(0, 120);
    } else {
      this.seen[k] = { uri: uri, title: String(title || '').slice(0, 120), last: Date.now() };
      const keys = Object.keys(this.seen);
      if (keys.length > this.maxSeen) {
        keys.sort((a, b) => this.seen[a].last - this.seen[b].last)
          .slice(0, keys.length - this.maxSeen)
          .forEach(x => { delete this.seen[x]; delete this.checks[x]; });
      }
    }
    this.stateDirty = true;
    this.schedule();
  }

  // ----- stream address -> list address (TuneIn replaces the list address when playing) -----

  mapStream(streamUri, listUri) {
    if (!isStr(streamUri) || !isStr(listUri)) return;
    const k = keyOf(streamUri);
    delete this.streamMap[k];
    this.streamMap[k] = listUri;
    const keys = Object.keys(this.streamMap);
    if (keys.length > this.maxStreamMap) {
      keys.slice(0, keys.length - this.maxStreamMap).forEach(x => { delete this.streamMap[x]; });
    }
    this.stateDirty = true;
    this.schedule();
  }

  listUriFor(streamUri) {
    return this.streamMap[keyOf(streamUri)] || null;
  }

  // ----- liveness results -----

  /**
   * @returns {'dead'|'revived'|null} 'dead' when the station has just been blocked, 'revived' when un-blocked
   */
  recordCheck(uri, alive, reason, threshold) {
    if (alive === null) return null; // unknown (e.g. the directory itself was down): change nothing
    const k = keyOf(uri);
    const c = this.checks[k] || (this.checks[k] = { fails: 0 });
    c.last = Date.now();
    c.reason = alive ? '' : String(reason || '');
    this.stateDirty = true;
    let outcome = null;
    if (alive) {
      c.fails = 0;
      const deadKey = Object.keys(this.dead).find(u => keyOf(u) === k);
      if (deadKey) {
        delete this.dead[deadKey];
        this.rebuild();
        this.blockDirty = true;
        outcome = 'revived';
      }
    } else {
      c.fails = (c.fails || 0) + 1;
      const already = Object.keys(this.dead).some(u => keyOf(u) === k);
      if (!already && c.fails >= threshold && !this.manual.some(u => keyOf(u) === k)) {
        const seen = this.seen[k];
        this.dead[uri] = {
          title: (seen && seen.title) || '',
          since: new Date().toISOString(),
          reason: String(reason || '')
        };
        this.keys.add(k);
        this.blockDirty = true;
        outcome = 'dead';
      }
    }
    this.schedule();
    return outcome;
  }

  // oldest-checked first; dead stations are always included so they can come back
  checkList(limit) {
    const items = Object.keys(this.seen).map(k => ({
      uri: this.seen[k].uri,
      last: (this.checks[k] && this.checks[k].last) || 0
    }));
    Object.keys(this.dead).forEach(u => {
      if (!items.some(i => keyOf(i.uri) === keyOf(u))) {
        items.push({ uri: u, last: (this.checks[keyOf(u)] && this.checks[keyOf(u)].last) || 0 });
      }
    });
    items.sort((a, b) => a.last - b.last);
    return items.slice(0, limit || items.length).map(i => i.uri);
  }

  counts() {
    return {
      manual: this.manual.length,
      dead: Object.keys(this.dead).length,
      known: Object.keys(this.seen).length
    };
  }

  // ----- persistence -----

  schedule() {
    if (this.timer || this.flushMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.flush();
      } catch (e) {
        // Keep the dirty flags: the next write or onStop will retry.
      }
    }, this.flushMs);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.blockDirty) {
      atomicWrite(this.blockFile, JSON.stringify({ manual: this.manual, dead: this.dead }, null, 2));
      this.blockDirty = false;
    }
    if (this.stateDirty) {
      atomicWrite(this.stateFile, JSON.stringify({
        legacyImported: this.legacyImported,
        seen: this.seen,
        streamMap: this.streamMap,
        checks: this.checks
      }));
      this.stateDirty = false;
    }
  }
}

module.exports = { Store, keyOf, atomicWrite, readJson };
