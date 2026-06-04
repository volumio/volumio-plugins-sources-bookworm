'use strict';

const fs = require('fs');

function cleanString(v, max) {
  const s = String(v || '').replace(/\x00/g, '').trim();
  return s.slice(0, max || 500);
}

function normalizeTrackMeta(trackId, meta) {
  meta = meta || {};
  const id = cleanString(trackId || meta.qobuzTrackId || meta.id, 40);
  if (!/^\d+$/.test(id)) return null;
  const out = {
    trackId: id,
    title: cleanString(meta.title || meta.name, 300),
    artist: cleanString(meta.artist, 300),
    album: cleanString(meta.album, 300),
    albumart: cleanString(meta.albumart, 1000),
    uri: cleanString(meta.uri, 1000),
    updatedAt: Date.now()
  };
  return out.title || out.artist || out.album || out.albumart ? out : null;
}

class QobuzMetadataCache {
  constructor({ filePath, logger } = {}) {
    this.filePath = filePath;
    this.logger = logger || console;
    this.items = {};
  }

  load() {
    if (!this.filePath) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.items = data && typeof data === 'object' ? data : {};
    } catch (e) {
      this.items = {};
    }
  }

  save() {
    if (!this.filePath) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2) + '\n');
    } catch (e) {
      try { this.logger.warn('[ai_autopilot] qobuz metadata save failed: ' + e.message); } catch (e2) {}
    }
  }

  remember(trackId, meta) {
    const normalized = normalizeTrackMeta(trackId, meta);
    if (!normalized) return null;
    const prev = this.items[normalized.trackId] || {};
    if (prev.title === normalized.title &&
        prev.artist === normalized.artist &&
        prev.album === normalized.album &&
        prev.albumart === normalized.albumart &&
        prev.uri === normalized.uri) {
      return prev;
    }
    this.items[normalized.trackId] = Object.assign({}, prev, normalized);
    this.save();
    return this.items[normalized.trackId];
  }

  get(trackId) {
    const id = cleanString(trackId, 40);
    return id ? (this.items[id] || null) : null;
  }
}

module.exports = { QobuzMetadataCache, normalizeTrackMeta };
