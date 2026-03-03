"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _RP2NowPlayingMetadataProvider_instances, _RP2NowPlayingMetadataProvider_cache, _RP2NowPlayingMetadataProvider_cacheOrGet, _RP2NowPlayingMetadataProvider_rpGetSongInfo, _RP2NowPlayingMetadataProvider_htmlToText;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RP2NowPlayingMetadataProvider = void 0;
const lru_cache_1 = require("lru-cache");
const html_to_text_1 = require("html-to-text");
const RP2Context_1 = __importDefault(require("../RP2Context"));
class RP2NowPlayingMetadataProvider {
    constructor() {
        _RP2NowPlayingMetadataProvider_instances.add(this);
        _RP2NowPlayingMetadataProvider_cache.set(this, void 0);
        this.version = '1.0.0';
        __classPrivateFieldSet(this, _RP2NowPlayingMetadataProvider_cache, new lru_cache_1.LRUCache({
            max: 100,
            ttl: 600000 // 10mins
        }), "f");
    }
    async getSongInfo(songTitle) {
        try {
            const info = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_rpGetSongInfo).call(this);
            if (!info) {
                return null;
            }
            const song = {
                title: info.title || songTitle,
                image: info.cover,
                artist: info.artist?.name ? await this.getArtistInfo(info.artist.name) : null,
                album: info.album?.name ?
                    await this.getAlbumInfo(info.album.name, info.artist?.name)
                    : null,
                description: info.wiki_html ? __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_htmlToText).call(this, info.wiki_html) : null
            };
            if (info.timed_lyrics && info.timed_lyrics.length > 0) {
                song.lyrics = {
                    type: 'synced',
                    lines: info.timed_lyrics.map(({ text, time }) => ({
                        text,
                        start: time
                    }))
                };
            }
            else if (info.lyrics) {
                song.lyrics = {
                    type: 'html',
                    lines: info.lyrics
                };
            }
            return song;
        }
        catch (error) {
            RP2Context_1.default
                .getLogger()
                .error(RP2Context_1.default.getErrorMessage('[rp2] Error fetching song info:', error));
            return null;
        }
    }
    async getAlbumInfo(albumTitle, artistName) {
        try {
            const rp = RP2Context_1.default.getRpjsLib();
            const songInfo = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_rpGetSongInfo).call(this);
            const albumId = songInfo?.album?.id;
            if (!albumId) {
                return null;
            }
            const albumInfo = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_cacheOrGet).call(this, `album-info-${albumId}`, () => rp.getAlbumInfo({ album_id: albumId }));
            if (!albumInfo) {
                return null;
            }
            const album = {
                title: albumInfo.name || albumTitle,
                image: albumInfo.cover,
                artist: artistName ? await this.getArtistInfo(artistName) : null,
                releaseDate: albumInfo.release_date
            };
            return album;
        }
        catch (error) {
            RP2Context_1.default
                .getLogger()
                .error(RP2Context_1.default.getErrorMessage('[rp2] Error fetching album info:', error));
            return null;
        }
    }
    async getArtistInfo(artistName) {
        try {
            const rp = RP2Context_1.default.getRpjsLib();
            const songInfo = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_rpGetSongInfo).call(this);
            const artistId = songInfo?.artist?.id;
            if (!artistId) {
                return null;
            }
            const artistInfo = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_cacheOrGet).call(this, `artist-info-${artistId}`, () => rp.getArtistInfo({ artist_id: artistId }));
            if (!artistInfo) {
                return null;
            }
            const artist = {
                name: artistInfo.name || artistName,
                image: artistInfo.images?.default,
                description: artistInfo.bio ? __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_htmlToText).call(this, artistInfo.bio) : null
            };
            return artist;
        }
        catch (error) {
            RP2Context_1.default
                .getLogger()
                .error(RP2Context_1.default.getErrorMessage('[rp2] Error fetching artist info:', error));
            return null;
        }
    }
    reset() {
        __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_cache, "f").clear();
    }
}
exports.RP2NowPlayingMetadataProvider = RP2NowPlayingMetadataProvider;
_RP2NowPlayingMetadataProvider_cache = new WeakMap(), _RP2NowPlayingMetadataProvider_instances = new WeakSet(), _RP2NowPlayingMetadataProvider_cacheOrGet = function _RP2NowPlayingMetadataProvider_cacheOrGet(key, get) {
    let v = __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_cache, "f").get(key);
    if (v !== undefined) {
        return v;
    }
    v = get();
    __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_cache, "f").set(key, v);
    return v;
}, _RP2NowPlayingMetadataProvider_rpGetSongInfo = async function _RP2NowPlayingMetadataProvider_rpGetSongInfo() {
    const rp = RP2Context_1.default.getRpjsLib();
    const track = rp.getStatus().track;
    const trackId = track?.id;
    // Metadata only available for track type 'M' (music)
    if (!track || !trackId || track.type !== 'M') {
        return null;
    }
    return await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_cacheOrGet).call(this, `song-info-${trackId}`, () => rp.getSongInfo({ song_id: trackId }));
}, _RP2NowPlayingMetadataProvider_htmlToText = function _RP2NowPlayingMetadataProvider_htmlToText(html) {
    const text = (0, html_to_text_1.convert)(html, {
        wordwrap: false,
        selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' }
        ]
    });
    return text
        .replace(/\n\s*\n\s*\n+/g, '\n\n') // Collapses 2+ blank lines into 1
        .trim();
};
