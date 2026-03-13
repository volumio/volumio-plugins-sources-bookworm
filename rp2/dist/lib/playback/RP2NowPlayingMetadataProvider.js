"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _RP2NowPlayingMetadataProvider_instances, _RP2NowPlayingMetadataProvider_rpGetSongInfo, _RP2NowPlayingMetadataProvider_htmlToText;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RP2NowPlayingMetadataProvider = void 0;
const html_to_text_1 = require("html-to-text");
const RP2Context_1 = __importDefault(require("../RP2Context"));
class RP2NowPlayingMetadataProvider {
    constructor() {
        _RP2NowPlayingMetadataProvider_instances.add(this);
        this.version = '1.0.0';
    }
    async getSongInfo(songTitle) {
        try {
            const { type: infoType, info } = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_rpGetSongInfo).call(this) || {};
            if (!info) {
                return null;
            }
            switch (infoType) {
                case 'song': {
                    const song = {
                        title: info.title || songTitle,
                        image: info.cover,
                        artist: info.artist?.name ? await this.getArtistInfo(info.artist.name) : null,
                        album: info.album?.name ?
                            await this.getAlbumInfo(info.album.name, info.artist?.name)
                            : null,
                        description: info.wikiHtml ? __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_htmlToText).call(this, info.wikiHtml) : null
                    };
                    if (info.timedLyrics && info.timedLyrics.length > 0) {
                        song.lyrics = {
                            type: 'synced',
                            lines: info.timedLyrics.map(({ text, time }) => ({
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
                case 'episode': {
                    const episode = {
                        title: info.title,
                        image: info.episodeImage.large,
                        artist: {
                            name: info.guests.map((guest) => guest.name).join(', '),
                            image: info.bioImage.large,
                            description: info.guestBio ? __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_htmlToText).call(this, info.guestBio) : null
                        },
                        description: info.overview ? __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_htmlToText).call(this, info.overview) : null
                    };
                    return episode;
                }
                default:
                    return null;
            }
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
            const { type: infoType, info } = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_rpGetSongInfo).call(this) || {};
            switch (infoType) {
                case 'song': {
                    const albumId = info?.album?.id;
                    if (!albumId) {
                        return null;
                    }
                    const albumInfo = await RP2Context_1.default.cacheOrGet(`album-info-${albumId}`, () => rp.getAlbumInfo({ albumId: albumId }));
                    if (!albumInfo) {
                        return null;
                    }
                    const album = {
                        title: albumInfo.name || albumTitle,
                        image: albumInfo.cover,
                        artist: artistName ? await this.getArtistInfo(artistName) : null,
                        releaseDate: albumInfo.releaseDate
                    };
                    return album;
                }
                default:
                    return null;
            }
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
            const { type: infoType, info } = await __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_rpGetSongInfo).call(this) || {};
            switch (infoType) {
                case 'song': {
                    const artistId = info?.artist?.id;
                    if (!artistId) {
                        return null;
                    }
                    const artistInfo = await RP2Context_1.default.cacheOrGet(`artist-info-${artistId}`, () => rp.getArtistInfo({ artistId }));
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
                case 'episode': {
                    if (!info) {
                        return null;
                    }
                    return {
                        name: info.guests.map((guest) => guest.name).join(', '),
                        image: info.bioImage.large,
                        description: info.guestBio ? __classPrivateFieldGet(this, _RP2NowPlayingMetadataProvider_instances, "m", _RP2NowPlayingMetadataProvider_htmlToText).call(this, info.guestBio) : null
                    };
                }
                default:
                    return null;
            }
        }
        catch (error) {
            RP2Context_1.default
                .getLogger()
                .error(RP2Context_1.default.getErrorMessage('[rp2] Error fetching artist info:', error));
            return null;
        }
    }
}
exports.RP2NowPlayingMetadataProvider = RP2NowPlayingMetadataProvider;
_RP2NowPlayingMetadataProvider_instances = new WeakSet(), _RP2NowPlayingMetadataProvider_rpGetSongInfo = async function _RP2NowPlayingMetadataProvider_rpGetSongInfo() {
    const rp = RP2Context_1.default.getRpjsLib();
    const track = rp.getStatus().track;
    if (track && track.type === 'M' && track.id) {
        const trackId = track.id;
        return {
            type: 'song',
            info: await RP2Context_1.default.cacheOrGet(`song-info-${trackId}`, () => rp.getSongInfo({ songId: trackId }))
        };
    }
    if (track && track.type === 'T' && track.episodeId) {
        const episodeId = track.episodeId;
        return {
            type: 'episode',
            info: await RP2Context_1.default.cacheOrGet(`episode-${episodeId}`, () => rp.getEpisode({ episodeId: episodeId }))
        };
    }
    return null;
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
