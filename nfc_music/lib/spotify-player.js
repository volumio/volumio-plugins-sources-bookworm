'use strict';

class SpotifyPlayer {

    constructor(options) {
        this.logger = options.logger;
    }

    async playTrack(uri) {
        return this._play(uri);
    }

    async playAlbum(uri) {
        return this._play(uri);
    }

    async playPlaylist(uri) {
        return this._play(uri);
    }

    async _play(uri) {

        this.logger.info(
            `Spotify playing: ${uri}`
        );

        // hier gebruik je jouw bestaande auth/token flow
        // voorbeeld:
        const token = await this.getToken();

        const response = await fetch(
            'https://api.spotify.com/v1/me/player/play',
            {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    context_uri: uri.startsWith('spotify:track')
                        ? undefined
                        : uri,
                    uris: uri.startsWith('spotify:track')
                        ? [uri]
                        : undefined
                })
            }
        );

        this.logger.info(
            `Spotify response: ${response.status}`
        );

        return response.status === 204;
    }

    async getToken() {
        // plug hier je bestaande spotify-auth / token-store in
        throw new Error('Implement getToken() using your auth flow');
    }
}

module.exports = SpotifyPlayer;