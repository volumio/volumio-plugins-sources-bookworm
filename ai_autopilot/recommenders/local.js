'use strict';

const Base = require('./base');

/**
 * Offline recommender that uses only the local history.
 *
 * Very simple heuristic:
 *   - Count plays per artist over history.
 *   - Pick the most-played artist that wasn't the *last* artist played.
 *   - Suggest a different title from that artist's past plays, oldest-first
 *     (so we rotate through their catalog in the user's history).
 *   - If that artist has only one known title, still suggest it (search may
 *     find a different pressing / remaster) but flag artist-only search.
 *
 * This is a crude starter; better models can be dropped in later.
 */
class LocalRecommender extends Base {
  async recommend(history) {
    const recent = (history || []).slice();
    if (recent.length === 0) return null;

    const last = recent[recent.length - 1];
    const lastArtist = (last.artist || '').toLowerCase();

    // Artist play counts.
    const counts = new Map();
    for (const t of recent) {
      const a = (t.artist || '').toLowerCase();
      if (!a) continue;
      counts.set(a, (counts.get(a) || 0) + 1);
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0])
      .filter((a) => a !== lastArtist);

    const recentTitles = new Set(
      recent.slice(-5).map((t) => ((t.artist || '') + '|' + (t.title || '')).toLowerCase())
    );

    for (const artistKey of sorted) {
      const tracks = recent.filter((t) => (t.artist || '').toLowerCase() === artistKey);
      if (tracks.length === 0) continue;

      // oldest-first rotation
      for (let i = 0; i < tracks.length; i++) {
        const candidate = tracks[i];
        const k = ((candidate.artist || '') + '|' + (candidate.title || '')).toLowerCase();
        if (!recentTitles.has(k)) {
          return { artist: candidate.artist, title: candidate.title };
        }
      }
    }

    // Fallback: pick the artist of `last` but a different title from their
    // history if any; else just re-use last (search may find a remaster).
    const sameArtistTracks = recent.filter(
      (t) => (t.artist || '').toLowerCase() === lastArtist && t.title !== last.title
    );
    if (sameArtistTracks.length > 0) {
      const pick = sameArtistTracks[0];
      return { artist: pick.artist, title: pick.title };
    }

    return { artist: last.artist, title: last.title };
  }
}

module.exports = LocalRecommender;
