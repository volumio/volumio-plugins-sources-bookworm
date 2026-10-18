'use strict';

const axios = require('axios');
// const SpotifyPlayer = require('./spotify-player');

class Player {

    constructor(options = {}) {
        this.logger = options.logger || console;
        this.commandRouter = options.commandRouter;
    }

    // -----------------------------
    // TRACK
    // -----------------------------
    async playTrack(track) {

        this.logger.info(
            `NFC Music: track starten: ${track.title}`
        );

        const searchResponse = await axios.get(
            'http://127.0.0.1:3000/api/v1/search',
            {
                params: {
                    query: track.title
                }
            }
        );

        const lists = searchResponse.data?.navigation?.lists || [];

        let trackItem = null;

        for (const list of lists) {

            const items = list.items || [];

            trackItem = items.find(item =>
                item.type === 'song' &&
                item.artist?.toLowerCase() === track.artist.toLowerCase() &&
                item.title?.toLowerCase() === track.title.toLowerCase()
            );

            if (trackItem) break;
        }

        if (!trackItem) {
            throw new Error(`Track niet gevonden: ${track.title}`);
        }

        this.logger.info(
            `NFC Music: track gevonden: ${trackItem.uri}`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: track.service || 'mpd',
                type: 'track',
                uri: trackItem.uri,
                title: track.title,
                artist: track.artist,
                album: track.album,
                trackType: track.trackType
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: track gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

    // fallback alias (oude compat)
    async playLocal(track) {
        return this.playTrack(track);
    }

    // -----------------------------
    // ALBUM
    // -----------------------------
    async playAlbum(data) {

        this.logger.info(
            `NFC Music: album zoeken: ${data.artist} - ${data.album}`
        );

        const searchResponse = await axios.get(
            'http://127.0.0.1:3000/api/v1/search',
            {
                params: {
                    query: data.album
                }
            }
        );

        const lists = searchResponse.data?.navigation?.lists || [];

        let albumItem = null;

        for (const list of lists) {

            const items = list.items || [];

            albumItem = items.find(item =>
                item.type === 'folder' &&
                item.title?.toLowerCase().includes(data.album.toLowerCase())
            );

            if (albumItem) break;
        }

        if (!albumItem) {
            throw new Error(
                `Album niet gevonden: ${data.artist} - ${data.album}`
            );
        }

        this.logger.info(
            `NFC Music: album gevonden: ${albumItem.uri}`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: 'mpd',
                type: 'folder',
                uri: albumItem.uri
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: album gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

    // -----------------------------
    // PLAYLIST (fix v3: browse + replaceAndPlay, i.p.v. het kapotte
    // interne playlistManager-mechanisme achter cmd=playplaylist)
    // -----------------------------
    async playPlaylist(data) {

        this.logger.info(
            `NFC Music: playlist ophalen: ${data.name}`
        );

        const browseResponse = await axios.get(
            'http://127.0.0.1:3000/api/v1/browse',
            {
                params: { uri: `playlists/${data.name}` }
            }
        );

        const lists = browseResponse.data && browseResponse.data.navigation
            ? browseResponse.data.navigation.lists
            : [];

        const items = (lists && lists.length > 0) ? (lists[0].items || []) : [];

        if (items.length === 0) {
            throw new Error(`Playlist '${data.name}' is leeg of niet gevonden`);
        }

        this.logger.info(
            `NFC Music: ${items.length} nummer(s) gevonden in playlist '${data.name}', starten...`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                item: items[0],
                list: items,
                index: 0
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: playlist gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

    // -----------------------------
    // SPOTIFY
    // -----------------------------
    async playSpotify(data) {

        this.logger.info(
            `NFC Music: Spotify starten -> type=${data.type} uri=${data.uri}`
        );

        if (!data.uri) {
            throw new Error('playSpotify: geen uri opgegeven');
        }

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: 'spop',
                uri: data.uri
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: Spotify gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

}

module.exports = Player;