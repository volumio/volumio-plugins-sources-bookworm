'use strict'; 
const http = require('http'); 
const crypto = require('crypto'); 
const axios = require('axios'); 
const spotifyConfig = require('./spotify-config');
const TokenStore = require('./token-store');  
const REDIRECT_URI = 'http://127.0.0.1:8888/callback'; 
const CALLBACK_HOST = '127.0.0.1'; 
const CALLBACK_PORT = 8888; 

class SpotifyOAuth {
    constructor() { this.codeVerifier = null; this.tokenStore = new 
        TokenStore(); this.server = null;
    }
    createAuthorizationUrl() { this.codeVerifier = crypto 
            .randomBytes(64) .toString('base64') .replace(/\+/g, '-') 
            .replace(/\//g, '_') .replace(/=/g, '');
        const codeChallenge = crypto .createHash('sha256') 
            .update(this.codeVerifier) .digest() .toString('base64') 
            .replace(/\+/g, '-') .replace(/\//g, '_') .replace(/=/g, 
            '');
        const params = new URLSearchParams(); 
        params.append('response_type', 'code'); 
        params.append('client_id', spotifyConfig.clientId); 
        params.append('redirect_uri', REDIRECT_URI); params.append(
            'scope', 'user-modify-playback-state user-read-playback-state'
        ); params.append( 'code_challenge_method', 'S256' ); 
        params.append(
            'code_challenge', codeChallenge ); return ( 
            'https://accounts.spotify.com/authorize?' + 
            params.toString()
        );
    }
    async exchangeCode(code) { if (!this.codeVerifier) { throw new 
            Error(
                'Geen PKCE code verifier beschikbaar' );
        }
        const body = new URLSearchParams(); body.append( 
            'grant_type', 'authorization_code'
        ); body.append( 'code', code ); body.append( 'redirect_uri', 
            REDIRECT_URI
        ); body.append( 'client_id', spotifyConfig.clientId ); body.append( 
            'code_verifier', this.codeVerifier
        ); const response = await axios.post( 
            'https://accounts.spotify.com/api/token', 
            body.toString(), {
                headers: { 'Content-Type': 
                        'application/x-www-form-urlencoded'
                }
            }
        ); const tokens = { accessToken: response.data.access_token, 
            refreshToken:
                response.data.refresh_token, expiresAt: Date.now() + 
                (response.data.expires_in * 1000)
        };
        this.tokenStore.save(tokens); return tokens;
    }
    start() { return new Promise((resolve, reject) => { this.server = 
            http.createServer(
                async (req, res) => { try { const url = new URL( 
                            req.url, REDIRECT_URI
                        ); if ( url.pathname !== '/callback' ) { 
                            res.writeHead(404); res.end(); return;
                        }
                        const error = url.searchParams.get( 'error' 
                        );
                        if (error) { throw new Error( 'Spotify OAuth error: ' + error
                            );
                        }
                        const code = url.searchParams.get( 'code' ); 
                        if (!code) {
                            throw new Error( 'Geen authorization code ontvangen'
                            );
                        }
                        const tokens = await this.exchangeCode( code 
                            );
                        res.writeHead(200, { 'Content-Type': 
                                'text/html'
                        });
                        res.end(` <html> <body> <h1>Spotify 
                                gekoppeld</h1> <p>
                                    Je kunt dit venster sluiten. </p> 
                            </body> </html>
                        `); this.server.close(); resolve(tokens);
                    } catch (error) {
                        console.error( 'OAuth callback fout:', 
                            error.message
                        ); res.writeHead(500); res.end( 'Spotify  autorisatie mislukt'
                        ); reject(error);
                    }
                }
            ); this.server.listen( CALLBACK_PORT, CALLBACK_HOST, 
                   () => {
                    console.log( 'OAuth callback server actief op ' + 
                        REDIRECT_URI
                    ); console.log(''); console.log( 'Open de OAuth  URL die ' + 
                        'door createAuthorizationUrl() ' + 
                        'wordt gegenereerd.'
                    );
                }
            );
        });
    }
}
module.exports = SpotifyOAuth;