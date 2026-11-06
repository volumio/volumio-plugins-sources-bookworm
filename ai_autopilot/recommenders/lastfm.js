'use strict';

const fetch = require('node-fetch');
const Base = require('./base');

/**
 * Last.fm-based recommender.
 * Strategy:
 *   1. Take the most recent played track (or a random one from history).
 *   2. Call track.getSimilar -> pick a top candidate not in recent history.
 *   3. Fallback: user.getTopTracks if getSimilar yields nothing.
 */
class LastfmRecommender extends Base {
  async recommend(history) {
    const key = this.config.lastfm_api_key;
    const user = this.config.lastfm_user;
    if (!key) throw new Error('Last.fm API key is not set.');

    const recent = (history || []).slice(-20);
    const recentSet = new Set(
      recent.map((t) => ((t.artist || '') + '|' + (t.title || '')).toLowerCase())
    );

    // 1) try similar to last played
    const last = recent.length ? recent[recent.length - 1] : null;
    if (last && last.artist && last.title) {
      const similar = await this._getSimilar(key, last.artist, last.title);
      const pick = this._pickFresh(similar, recentSet);
      if (pick) return pick;
    }

    // 2) fallback: user's top tracks
    if (user) {
      const top = await this._getUserTop(key, user);
      const pick = this._pickFresh(top, recentSet);
      if (pick) return pick;
    }

    // 3) last-ditch: any similar from any history track
    for (let i = recent.length - 2; i >= 0; i--) {
      const t = recent[i];
      if (!t.artist || !t.title) continue;
      const s = await this._getSimilar(key, t.artist, t.title).catch(() => []);
      const pick = this._pickFresh(s, recentSet);
      if (pick) return pick;
    }
    return null;
  }

  async _getSimilar(apiKey, artist, track) {
    const url =
      'https://ws.audioscrobbler.com/2.0/?method=track.getSimilar' +
      '&api_key=' + encodeURIComponent(apiKey) +
      '&artist=' + encodeURIComponent(artist) +
      '&track=' + encodeURIComponent(track) +
      '&autocorrect=1&limit=30&format=json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Last.fm ' + res.status);
    const data = await res.json();
    const items = (data.similartracks && data.similartracks.track) || [];
    return items.map((it) => ({
      artist: it.artist && it.artist.name ? it.artist.name : (it.artist || ''),
      title: it.name
    }));
  }

  async _getUserTop(apiKey, user) {
    const url =
      'https://ws.audioscrobbler.com/2.0/?method=user.getTopTracks' +
      '&user=' + encodeURIComponent(user) +
      '&api_key=' + encodeURIComponent(apiKey) +
      '&period=3month&limit=50&format=json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Last.fm ' + res.status);
    const data = await res.json();
    const items = (data.toptracks && data.toptracks.track) || [];
    return items.map((it) => ({
      artist: it.artist && it.artist.name ? it.artist.name : (it.artist || ''),
      title: it.name
    }));
  }

  _pickFresh(candidates, recentSet) {
    for (const c of (candidates || [])) {
      const key = ((c.artist || '') + '|' + (c.title || '')).toLowerCase();
      if (!c.title) continue;
      if (recentSet.has(key)) continue;
      return { artist: c.artist, title: c.title };
    }
    return null;
  }
}

module.exports = LastfmRecommender;
