"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _MusicItemModel_instances, _MusicItemModel_innertubeForLyrics, _MusicItemModel_doGetPlaybackInfo, _MusicItemModel_getTrackInfo, _MusicItemModel_extractStreamData, _MusicItemModel_getInfoFromUpNextTab, _MusicItemModel_sleep, _MusicItemModel_head;
Object.defineProperty(exports, "__esModule", { value: true });
const YTMusicContext_1 = __importDefault(require("../YTMusicContext"));
const innertube_1 = require("volumio-yt-support/dist/innertube");
const innertube_2 = require("volumio-yt-support/dist/innertube");
const BaseModel_1 = require("./BaseModel");
const InnertubeResultParser_1 = __importDefault(require("./InnertubeResultParser"));
const Endpoint_1 = require("../types/Endpoint");
const EndpointHelper_1 = __importDefault(require("../util/EndpointHelper"));
const InnertubeLoader_1 = __importDefault(require("./InnertubeLoader"));
const YtDlp_1 = require("../util/YtDlp");
// https://gist.github.com/sidneys/7095afe4da4ae58694d128b1034e01e2
// https://gist.github.com/MartinEesmaa/2f4b261cb90a47e9c41ba115a011a4aa
const ITAG_TO_BITRATE = {
    '139': '48',
    '140': '128',
    '141': '256',
    '171': '128',
    '249': 'VBR 50',
    '250': 'VBR 70',
    '251': 'VBR 160',
    '774': 'VBR 256'
};
const BEST_AUDIO_FORMAT = {
    type: 'audio',
    format: 'any',
    quality: 'best'
};
class MusicItemModel extends BaseModel_1.BaseModel {
    constructor() {
        super(...arguments);
        _MusicItemModel_instances.add(this);
        /**
         * We use YTMUSIC_ANDROID client for retrieving lyrics because it
         * provides synced versions where available. This client does
         * not support account cookies and will return 400 ("invalid argument")
         * error if we pass account cookies in requests. We can ensure this won't
         * happen by using a separate Innertube instance.
         */
        _MusicItemModel_innertubeForLyrics.set(this, null);
    }
    async getPlaybackInfo(endpoint, isPrefetch = false, skipStream = false, signal) {
        if (!EndpointHelper_1.default.isType(endpoint, Endpoint_1.EndpointType.Watch) || !endpoint.payload.videoId) {
            throw Error('Invalid endpoint');
        }
        const useYtDlp = YTMusicContext_1.default.getConfigValue('useYtDlp');
        if (useYtDlp && isPrefetch) {
            throw Error(`Cannot prefetch with yt-dlp as time taken will exceed Volumio's limit`);
        }
        if (!skipStream && useYtDlp) {
            const [info, url] = await Promise.all([
                __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_doGetPlaybackInfo).call(this, endpoint, true, signal),
                YtDlp_1.YtDlpWrapper.getInstance().getStreamingUrl(`https://music.youtube.com/watch?v=${encodeURIComponent(endpoint.payload.videoId)}`, YTMusicContext_1.default.getConfigValue('ytDlpVersion') ?? undefined).catch((error) => {
                    YTMusicContext_1.default.getLogger().error(YTMusicContext_1.default.getErrorMessage('Failed to get streaming URL with yt-dlp:', error, false));
                    return null;
                })
            ]);
            if (info && url) {
                const itag = new URL(url).searchParams.get('itag');
                const bitrate = itag ? ITAG_TO_BITRATE[itag] : null;
                info.stream = {
                    url,
                    bitrate: bitrate ? `${bitrate} kbps` : undefined
                };
            }
            return info;
        }
        return __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_doGetPlaybackInfo).call(this, endpoint, skipStream, signal);
    }
    async getLyrics(videoId) {
        if (!__classPrivateFieldGet(this, _MusicItemModel_innertubeForLyrics, "f")) {
            __classPrivateFieldSet(this, _MusicItemModel_innertubeForLyrics, await innertube_1.Innertube.create(), "f");
        }
        const innertube = __classPrivateFieldGet(this, _MusicItemModel_innertubeForLyrics, "f");
        const watchNextEndpoint = new innertube_2.YTNodes.NavigationEndpoint({ watchNextEndpoint: { videoId } });
        const watchNextResponse = await watchNextEndpoint.call(innertube.actions, { client: 'YTMUSIC_ANDROID', parse: true });
        const tabs = watchNextResponse.contents_memo?.getType(innertube_2.YTNodes.Tab);
        const tab = tabs?.find((tab) => tab.endpoint.payload.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS');
        if (!tab) {
            throw Error('Lyrics tab not found');
        }
        const page = await tab.endpoint.call(innertube.actions, { client: 'YTMUSIC_ANDROID', parse: true });
        if (!page.contents)
            throw new Error('Unexpected response from lyrics tab endpoint');
        const lyrics = InnertubeResultParser_1.default.parseLyrics(page);
        if (!lyrics) {
            YTMusicContext_1.default.getLogger().verbose(`No lyrics found. Page content is: ${JSON.stringify(page.contents.item())}`);
        }
        return lyrics;
    }
}
_MusicItemModel_innertubeForLyrics = new WeakMap(), _MusicItemModel_instances = new WeakSet(), _MusicItemModel_doGetPlaybackInfo = async function _MusicItemModel_doGetPlaybackInfo(endpoint, skipStream = false, signal) {
    const { innertube } = await this.getInnertube();
    const trackInfo = await __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_getTrackInfo).call(this, innertube, endpoint);
    const videoId = endpoint.payload.videoId;
    let contentPoToken = undefined;
    try {
        contentPoToken = (await InnertubeLoader_1.default.generatePoToken(videoId)).poToken;
        YTMusicContext_1.default.getLogger().info(`[ytmusic] Obtained PO token for video #${videoId}: ${contentPoToken}`);
    }
    catch (error) {
        YTMusicContext_1.default.getLogger().error(YTMusicContext_1.default.getErrorMessage(`[ytmusic] Error obtaining PO token for video #${videoId}:`, error, false));
    }
    const streamData = skipStream ? null : await __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_extractStreamData).call(this, innertube, trackInfo, contentPoToken);
    // `trackInfo` does not contain album info - need to obtain from item in Up Next tab.
    const infoFromUpNextTab = __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_getInfoFromUpNextTab).call(this, trackInfo, endpoint);
    let musicItem = null;
    let album = null;
    if (infoFromUpNextTab && (infoFromUpNextTab.type === 'video' || infoFromUpNextTab.type === 'song')) {
        musicItem = infoFromUpNextTab;
        album = musicItem.album;
    }
    // `trackInfo` sometimes ignores hl / gl (lang / region), so titles and such could be in wrong language.
    // Furthermore, the artist's channelId is possibly wrong for private uploads.
    // We return info from item in Up Next tab, while using trackInfo as fallback.
    let channelId;
    if (musicItem?.artists && musicItem.artists[0]?.channelId) {
        channelId = musicItem.artists[0].channelId;
    }
    else {
        channelId = trackInfo.basic_info.channel_id;
    }
    const title = musicItem?.title || trackInfo.basic_info.title;
    if (streamData?.url) {
        const startTime = new Date().getTime();
        YTMusicContext_1.default.getLogger().info(`[ytmusic] (${title}) validating stream URL "${streamData.url}"...`);
        let tries = 0;
        let testStreamResult = await __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_head).call(this, streamData.url, signal);
        while (!testStreamResult.ok && tries < 3) {
            if (signal?.aborted) {
                throw Error('Aborted');
            }
            YTMusicContext_1.default.getLogger().warn(`[ytmusic] (${title}) stream validation failed (${testStreamResult.status} - ${testStreamResult.statusText}); retrying after 2s...`);
            await __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_sleep).call(this, 2000);
            tries++;
            testStreamResult = await __classPrivateFieldGet(this, _MusicItemModel_instances, "m", _MusicItemModel_head).call(this, streamData.url, signal);
        }
        const endTime = new Date().getTime();
        const timeTaken = (endTime - startTime) / 1000;
        if (tries === 3) {
            YTMusicContext_1.default.getLogger().warn(`[ytmusic] (${title}) failed to validate stream URL "${streamData.url}" (retried ${tries} times in ${timeTaken}s).`);
        }
        else {
            YTMusicContext_1.default.getLogger().info(`[ytmusic] (${title}) stream validated in ${timeTaken}s.`);
        }
    }
    if (signal?.aborted) {
        throw Error('Aborted');
    }
    return {
        title,
        artist: {
            channelId,
            name: musicItem?.artistText || trackInfo.basic_info.author
        },
        album: {
            albumId: album?.albumId,
            title: musicItem?.album?.title || album?.title
        },
        thumbnail: InnertubeResultParser_1.default.parseThumbnail(trackInfo.basic_info.thumbnail) || undefined,
        stream: streamData,
        duration: trackInfo.basic_info.duration,
        addToHistory: () => {
            return trackInfo.addToWatchHistory();
        },
        radioEndpoint: musicItem?.radioEndpoint
    };
}, _MusicItemModel_getTrackInfo = 
// Based on Innertube.Music.#fetchInfoFromEndpoint()
async function _MusicItemModel_getTrackInfo(innertube, endpoint) {
    const videoId = endpoint.payload.videoId;
    const watchEndpoint = new innertube_2.YTNodes.NavigationEndpoint({ watchEndpoint: {
            videoId,
            playlistId: endpoint.payload.playlistId,
            params: endpoint.payload.params,
            racyCheckOk: true,
            contentCheckOk: true
        } });
    const nextEndpoint = new innertube_2.YTNodes.NavigationEndpoint({ watchNextEndpoint: { videoId: endpoint.payload.videoId } });
    let sessionPoToken;
    try {
        sessionPoToken = (await (await InnertubeLoader_1.default.getInstance()).getSessionPoToken())?.poToken;
    }
    catch (error) {
        YTMusicContext_1.default.getLogger().error(YTMusicContext_1.default.getErrorMessage(`[ytmusic] Error obtaining PO token for session:`, error, false));
        sessionPoToken = undefined;
    }
    const player_response = watchEndpoint.call(innertube.actions, {
        client: 'YTMUSIC',
        playbackContext: {
            contentPlaybackContext: {
                vis: 0,
                splay: false,
                lactMilliseconds: '-1',
                signatureTimestamp: innertube.session.player?.signature_timestamp
            }
        },
        serviceIntegrityDimensions: {
            poToken: sessionPoToken
        }
    });
    const next_response = nextEndpoint.call(innertube.actions, {
        client: 'YTMUSIC',
        enablePersistentPlaylistPanel: true
    });
    const cpn = innertube_2.Utils.generateRandomString(16);
    const response = await Promise.all([player_response, next_response]);
    return new innertube_2.YTMusic.TrackInfo(response, innertube.actions, cpn);
}, _MusicItemModel_extractStreamData = async function _MusicItemModel_extractStreamData(innertube, info, contentPoToken) {
    const preferredFormat = {
        ...BEST_AUDIO_FORMAT
    };
    const prefetch = YTMusicContext_1.default.getConfigValue('prefetch');
    const preferOpus = prefetch && YTMusicContext_1.default.getConfigValue('preferOpus');
    if (preferOpus) {
        YTMusicContext_1.default.getLogger().info('[ytmusic] Preferred format is Opus');
        preferredFormat.format = 'opus';
    }
    let format;
    try {
        format = info.chooseFormat(preferredFormat);
    }
    catch (error) {
        if (preferOpus && info) {
            YTMusicContext_1.default.getLogger().warn('[ytmusic] No matching format for Opus. Falling back to any audio format ...');
            try {
                format = info.chooseFormat(BEST_AUDIO_FORMAT);
            }
            catch (error) {
                YTMusicContext_1.default.getLogger().error('[ytmusic] Failed to obtain audio format:', error);
                format = null;
            }
        }
        else {
            throw error;
        }
    }
    if (format) {
        let decipheredURL = await format.decipher(innertube.session.player);
        const audioBitrate = ITAG_TO_BITRATE[format.itag];
        // Innertube sets `pot` searchParam of URL to session-bound PO token.
        // Seems YT now requires `pot` to be the *content-bound* token, otherwise we'll get 403.
        // See: https://github.com/TeamNewPipe/NewPipeExtractor/issues/1392
        const urlObj = new URL(decipheredURL);
        if (contentPoToken) {
            urlObj.searchParams.set('pot', contentPoToken);
        }
        decipheredURL = urlObj.toString();
        return {
            url: decipheredURL,
            mimeType: format.mime_type,
            bitrate: audioBitrate ? `${audioBitrate} kbps` : null,
            sampleRate: format.audio_sample_rate ? `${format.audio_sample_rate} kHz` : undefined,
            channels: format.audio_channels
        };
    }
    return null;
}, _MusicItemModel_getInfoFromUpNextTab = function _MusicItemModel_getInfoFromUpNextTab(info, endpoint) {
    const playlistPanel = info.page[1]?.contents_memo?.getType(innertube_2.YTNodes.PlaylistPanel).first();
    if (!playlistPanel) {
        return null;
    }
    const videoId = endpoint.payload.videoId;
    const match = playlistPanel.contents.find((data) => {
        if (data.is(innertube_2.YTNodes.PlaylistPanelVideoWrapper)) {
            if (data.primary?.video_id === videoId) {
                return true;
            }
            return data.counterpart?.find((item) => item.video_id === videoId);
        }
        else if (data.is(innertube_2.YTNodes.PlaylistPanelVideo)) {
            return data.video_id === videoId;
        }
    });
    return InnertubeResultParser_1.default.parseContentItem(match);
}, _MusicItemModel_sleep = function _MusicItemModel_sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}, _MusicItemModel_head = async function _MusicItemModel_head(url, signal) {
    const res = await fetch(url, { method: 'HEAD', signal });
    return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText
    };
};
exports.default = MusicItemModel;
