'use strict';

const fetch = require('node-fetch');
const Base = require('./base');

/**
 * Spotify Recommendations API back-end.
 * Requires: client_id, client_secret, refresh_token (obtained once via OAuth).
 *
 * Strategy:
 *   1. Refresh the access token.
 *   2. Search Spotify for up to 5 of the most recent history tracks -> collect their IDs as seeds.
 *   3. Call /v1/recommendations?seed_tracks=... -> pick first not in recent history.
 */
class SpotifyRecommender extends Base {
  async recommend(history) {
    const { spotify_client_id, spotify_client_secret, spotify_refresh_token } = this.config;
    if (!spotify_client_id || !spotify_client_secret || !spotify_refresh_token) {
      throw new Error('Spotify credentials are incomplete.');
    }

    const token = await this._refreshAccessToken(
      spotify_client_id, spotify_client_secret, spotify_refresh_token
    );

    const recent = (history || []).slice(-20);
    const recentSet = new Set(
      recent.map((t) => ((t.artist || '') + '|' + (t.title || '')).toLowerCase())
    );

    const seeds = [];
    for (const t of recent.slice(-5)) {
      if (!t.title) continue;
      const id = await this._searchTrackId(token, t.artist, t.title);
      if (id) seeds.push(id);
      if (seeds.length >= 5) break;
    }

    if (seeds.length === 0) {
      // try top tracks from the current user as fallback
      const top = await this._getUserTop(token).catch(() => []);
      const pick = this._pickFresh(top, recentSet);
      if (pick) return pick;
      return null;
    }

    const recs = await this._recommendations(token, seeds);
    return this._pickFresh(recs, recentSet);
  }

  async _refreshAccessToken(clientId, clientSecret, refreshToken) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + basic,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    if (!res.ok) throw new Error('Spotify token ' + res.status + ': ' + (await res.text()));
    const data = await res.json();
    return data.access_token;
  }

  async _searchTrackId(token, artist, title) {
    const q = encodeURIComponent([artist ? 'artist:' + artist : '', 'track:' + title].filter(Boolean).join(' '));
    const res = await fetch('https://api.spotify.com/v1/search?type=track&limit=1&q=' + q, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.tracks && data.tracks.items && data.tracks.items[0];
    return item ? item.id : null;
  }

  async _recommendations(token, seedIds) {
    const url = 'https://api.spotify.com/v1/recommendations?limit=20&seed_tracks=' +
      seedIds.slice(0, 5).join(',');
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Spotify recs ' + res.status);
    const data = await res.json();
    return (data.tracks || []).map((t) => ({
      artist: (t.artists && t.artists[0] && t.artists[0].name) || '',
      title: t.name
    }));
  }

  async _getUserTop(token) {
    const res = await fetch('https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=20', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((t) => ({
      artist: (t.artists && t.artists[0] && t.artists[0].name) || '',
      title: t.name
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

module.exports = SpotifyRecommender;
