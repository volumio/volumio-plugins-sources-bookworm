'use strict';

const fs = require('fs-extra');

/**
 * Persistent ring-buffer of played tracks. Stored as JSON.
 * Track shape: { title, artist, album, service, uri, at }
 */
class History {
  constructor({ filePath, windowSize = 20, logger }) {
    this.filePath = filePath;
    this.windowSize = Math.max(1, Number(windowSize) || 20);
    this.items = [];
    this.logger = logger || console;
    this._dirty = false;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readJsonSync(this.filePath);
        if (Array.isArray(raw)) this.items = raw;
      }
    } catch (e) {
      this.logger.error && this.logger.error('[ai_autopilot] history load failed: ' + e.message);
      this.items = [];
    }
  }

  flush() {
    if (!this._dirty) return;
    try {
      fs.writeJsonSync(this.filePath, this.items, { spaces: 0 });
      this._dirty = false;
    } catch (e) {
      this.logger.error && this.logger.error('[ai_autopilot] history flush failed: ' + e.message);
    }
  }

  push(track) {
    if (!track || !track.title) return;
    const last = this.items[this.items.length - 1];
    if (last && last.title === track.title && last.artist === track.artist) return; // de-dup repeats
    this.items.push(track);
    // Keep at most 10x windowSize so we never grow unbounded.
    const cap = this.windowSize * 10;
    if (this.items.length > cap) this.items.splice(0, this.items.length - cap);
    this._dirty = true;
    this.flush();
  }

  recent() {
    const n = this.windowSize;
    return this.items.slice(-n);
  }

  all() {
    return this.items.slice();
  }

  setWindowSize(n) {
    this.windowSize = Math.max(1, Number(n) || 20);
  }

  clear() {
    this.items = [];
    this._dirty = true;
    this.flush();
  }
}

module.exports = History;
