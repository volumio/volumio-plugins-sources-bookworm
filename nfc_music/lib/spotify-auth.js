'use strict'; const axios = require('axios'); const TokenStore = 
require('./token-store'); class SpotifyAuth {
    constructor(options) { this.clientId = options.clientId; 
        this.tokenStore = new TokenStore(); const tokens = 
        this.tokenStore.load(); if (tokens) {
            this.accessToken = tokens.accessToken || null; 
            this.refreshToken = tokens.refreshToken || null; 
            this.expiresAt = tokens.expiresAt || 0;
        } else {
            this.accessToken = null; this.refreshToken = null; 
            this.expiresAt = 0;
        }
    }
    async getAccessToken() {
        // Access token is nog minstens één minuut geldig.
        if ( this.accessToken && Date.now() < this.expiresAt - 60000 
        ) {
            return this.accessToken;
        }
        // Geen geldig access token → vernieuwen.
        return this.refreshAccessToken();
    }
    async refreshAccessToken() { if (!this.refreshToken) { throw new 
            Error(
                'Spotify refresh token ontbreekt. ' + 
                'Koppel eerst  een Spotify-account.'
            );
        }
        const body = new URLSearchParams(); body.append( 
            'grant_type', 'refresh_token'
        ); body.append( 'refresh_token', this.refreshToken ); 
        body.append(
            'client_id', this.clientId ); const response = await 
        axios.post(
            'https://accounts.spotify.com/api/token', 
            body.toString(), {
                headers: { 'Content-Type': 
                        'application/x-www-form-urlencoded'
                }
            }
        ); this.accessToken = response.data.access_token; if 
        (response.data.expires_in) {
            this.expiresAt = Date.now() + response.data.expires_in * 
                1000;
        }
        // Spotify kan een nieuwe refresh token teruggeven. Bewaar 
        // die dan ook.
        if (response.data.refresh_token) { this.refreshToken = 
                response.data.refresh_token;
        }
        this.saveTokens(); return this.accessToken;
    }
    saveTokens() { this.tokenStore.save({ accessToken: 
            this.accessToken, refreshToken: this.refreshToken, 
            expiresAt: this.expiresAt
        });
    }
    isAuthenticated() { return !!this.refreshToken;
    }
}
module.exports = SpotifyAuth;