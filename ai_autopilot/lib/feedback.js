'use strict';

const fs = require('fs-extra');

/**
 * Persistent store of per-track feedback.
 *
 * Record shape:
 *   {
 *     uri: string,
 *     artist: string,
 *     title: string,
 *     rating: 'like' | 'dislike',
 *     source: 'button' | 'skip',
 *     at: number    // ms timestamp
 *   }
 *
 * We keep at most `cap` records. Older ones drop off first.
 */
class Feedback {
  constructor({ filePath, cap = 500, logger }) {
    this.filePath = filePath;
    this.cap = cap;
    this.items = [];
    this.logger = logger || console;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readJsonSync(this.filePath);
        if (Array.isArray(raw)) this.items = raw;
      }
    } catch (e) {
      this.logger.error && this.logger.error('[ai_autopilot] feedback load failed: ' + e.message);
      this.items = [];
    }
  }

  flush() {
    try {
      fs.writeJsonSync(this.filePath, this.items, { spaces: 0 });
    } catch (e) {
      this.logger.error && this.logger.error('[ai_autopilot] feedback flush failed: ' + e.message);
    }
  }

  record({ uri, artist, title, rating, source }) {
    if (!rating || !title) return;
    // Replace previous record for the same URI (latest wins).
    if (uri) this.items = this.items.filter((it) => it.uri !== uri);
    this.items.push({
      uri: uri || '',
      artist: artist || '',
      title: title,
      rating: rating,
      source: source || 'button',
      at: Date.now()
    });
    if (this.items.length > this.cap) {
      this.items.splice(0, this.items.length - this.cap);
    }
    this.flush();
  }

  /**
   * Return a snapshot usable in LLM prompts.
   *   maxLikes / maxDislikes — how many most-recent of each to include
   * Explicit button feedback is prioritized over skips.
   */
  snapshot({ maxLikes = 15, maxDislikes = 15 } = {}) {
    // newest first
    const all = this.items.slice().sort((a, b) => b.at - a.at);
    const likes = [];
    const dislikes = [];
    const seenLike = new Set();
    const seenDis = new Set();

    // First pass: explicit buttons
    for (const it of all) {
      const key = ((it.artist || '') + '|' + (it.title || '')).toLowerCase();
      if (it.rating === 'like' && it.source === 'button' && !seenLike.has(key) && likes.length < maxLikes) {
        likes.push(it); seenLike.add(key);
      } else if (it.rating === 'dislike' && it.source === 'button' && !seenDis.has(key) && dislikes.length < maxDislikes) {
        dislikes.push(it); seenDis.add(key);
      }
    }
    // Second pass: fill remaining with skip-based dislikes (not likes; skips aren't positive signal)
    for (const it of all) {
      if (dislikes.length >= maxDislikes) break;
      if (it.rating !== 'dislike' || it.source === 'button') continue;
      const key = ((it.artist || '') + '|' + (it.title || '')).toLowerCase();
      if (seenDis.has(key)) continue;
      dislikes.push(it); seenDis.add(key);
    }

    return { likes, dislikes };
  }

  clear() {
    this.items = [];
    this.flush();
  }

  count() {
    return this.items.length;
  }
}

module.exports = Feedback;
