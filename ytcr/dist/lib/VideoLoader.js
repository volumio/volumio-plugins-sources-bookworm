"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var _VideoLoader_instances, _VideoLoader_logger, _VideoLoader_defaultInnertubeLoader, _VideoLoader_tvInnertubeLoader, _VideoLoader_senderSupportsYTMusicClient, _VideoLoader_getInnertubeInstances, _VideoLoader_fetchInnertubeVideoInfo, _VideoLoader_getAndValidateStreamInfo, _VideoLoader_getThumbnail, _VideoLoader_chooseFormat, _VideoLoader_parseStreamData, _VideoLoader_getStreamUrlFromHLS, _VideoLoader_sleep, _VideoLoader_head;
Object.defineProperty(exports, "__esModule", { value: true });
const InnertubeLib = __importStar(require("volumio-youtubei.js"));
const yt_cast_receiver_1 = require("yt-cast-receiver");
const YTCRContext_js_1 = __importDefault(require("./YTCRContext.js"));
const InnertubeLoader_js_1 = __importDefault(require("./InnertubeLoader.js"));
// https://gist.github.com/sidneys/7095afe4da4ae58694d128b1034e01e2
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
class VideoLoader {
    constructor(logger) {
        _VideoLoader_instances.add(this);
        _VideoLoader_logger.set(this, void 0);
        _VideoLoader_defaultInnertubeLoader.set(this, void 0);
        _VideoLoader_tvInnertubeLoader.set(this, void 0);
        // Whether YT Music client is supported (i.e. stream URLs do not return 403 Forbidden)
        _VideoLoader_senderSupportsYTMusicClient.set(this, void 0);
        __classPrivateFieldSet(this, _VideoLoader_logger, logger, "f");
        __classPrivateFieldSet(this, _VideoLoader_defaultInnertubeLoader, new InnertubeLoader_js_1.default(__classPrivateFieldGet(this, _VideoLoader_logger, "f")), "f");
        __classPrivateFieldSet(this, _VideoLoader_tvInnertubeLoader, new InnertubeLoader_js_1.default(__classPrivateFieldGet(this, _VideoLoader_logger, "f"), InnertubeLib.ClientType.TV), "f");
        __classPrivateFieldSet(this, _VideoLoader_senderSupportsYTMusicClient, true, "f"); // Initially assume true
    }
    notifySendersChanged(senders) {
        if (senders.length === 0) {
            __classPrivateFieldSet(this, _VideoLoader_senderSupportsYTMusicClient, true, "f");
        }
    }
    refreshI18nConfig() {
        __classPrivateFieldGet(this, _VideoLoader_defaultInnertubeLoader, "f").applyI18nConfig();
        __classPrivateFieldGet(this, _VideoLoader_tvInnertubeLoader, "f").applyI18nConfig();
    }
    async getInfo(video, abortSignal) {
        const { defaultInnertube, tvInnertube } = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_getInnertubeInstances).call(this);
        const checkAbortSignal = () => {
            if (abortSignal.aborted) {
                const msg = `VideoLoader.getInfo() aborted for video Id: ${video.id}`;
                __classPrivateFieldGet(this, _VideoLoader_logger, "f").debug(`[ytcr] ${msg}.`);
                const abortError = Error(msg);
                abortError.name = 'AbortError';
                throw abortError;
            }
        };
        __classPrivateFieldGet(this, _VideoLoader_logger, "f").debug(`[ytcr] VideoLoader.getInfo: ${video.id}`);
        checkAbortSignal();
        // Configure Innertube instances
        const __prepInnertubeAndPayload = (innertube) => {
            // Prepare request payload
            const payload = {
                videoId: video.id,
                racyCheckOk: true,
                contentCheckOk: true,
                serviceIntegrityDimensions: {
                    poToken: innertube.session.po_token
                },
                enableMdxAutoplay: true,
                isMdxPlayback: true,
                playbackContext: {
                    contentPlaybackContext: {
                        signatureTimestamp: innertube.session.player?.sts || 0
                    }
                }
            };
            if (video.context?.playlistId) {
                payload.playlistId = video.context.playlistId;
            }
            if (video.context?.params) {
                payload.params = video.context.params;
            }
            if (video.context?.index !== undefined) {
                payload.index = video.context.index;
            }
            // Modify innertube's session context to include `ctt` param
            if (video.context?.ctt) {
                innertube.session.context.user = {
                    enableSafetyMode: false,
                    lockedSafetyMode: false,
                    credentialTransferTokens: [
                        {
                            'scope': 'VIDEO',
                            'token': video.context?.ctt
                        }
                    ]
                };
            }
            else {
                delete innertube.session.context.user?.credentialTransferTokens;
            }
            return payload;
        };
        const cpn = InnertubeLib.Utils.generateRandomString(16);
        const defaultPayload = __prepInnertubeAndPayload(defaultInnertube);
        const tvPayload = __prepInnertubeAndPayload(tvInnertube);
        try {
            // There are two endpoints we need to fetch data from:
            // 1. '/next': for metadata (title, channel for video, artist / album for music...)
            // 2. '/player': for streaming data
            const nextResponse = await tvInnertube.actions.execute('/next', tvPayload);
            checkAbortSignal();
            let basicInfo = null;
            // We cannot use innertube to parse `nextResponse`, because it doesn't
            // Have `SingleColumnWatchNextResults` parser class. We would have to do it ourselves.
            const singleColumnContents = nextResponse.data?.contents?.singleColumnWatchNextResults?.
                results?.results?.contents?.[0]?.itemSectionRenderer?.contents?.[0];
            const videoMetadata = singleColumnContents?.videoMetadataRenderer;
            const songMetadata = singleColumnContents?.musicWatchMetadataRenderer;
            if (videoMetadata) {
                basicInfo = {
                    id: video.id,
                    src: 'yt',
                    title: new InnertubeLib.Misc.Text(videoMetadata.title).toString(),
                    channel: new InnertubeLib.Misc.Text(videoMetadata.owner?.videoOwnerRenderer?.title).toString(),
                    isLive: videoMetadata.viewCount.videoViewCountRenderer.isLive
                };
            }
            else if (songMetadata) {
                basicInfo = {
                    id: video.id,
                    src: 'ytmusic',
                    title: new InnertubeLib.Misc.Text(songMetadata.title).toString(),
                    artist: new InnertubeLib.Misc.Text(songMetadata.byline).toString(),
                    album: songMetadata.albumName ? new InnertubeLib.Misc.Text(songMetadata.albumName).toString() : ''
                };
            }
            if (!basicInfo) {
                throw new yt_cast_receiver_1.DataError('Metadata not found in response');
            }
            // Fetch response from '/player' endpoint. But first, choose which Innertube instance and client to use.
            // Setting payload.client will cause Innertube to modify 'context.client' before submitting request.
            let it, payload;
            if (basicInfo.src === 'ytmusic' && __classPrivateFieldGet(this, _VideoLoader_senderSupportsYTMusicClient, "f")) {
                it = defaultInnertube;
                payload = defaultPayload;
                payload.client = 'YTMUSIC';
            }
            else if (basicInfo.isLive) {
                // Do not use TV client for live streams, because it will only return DASH manifest URL.
                // Use default WEB client instead, which will return HLS manifest URL.
                it = defaultInnertube;
                payload = defaultPayload;
            }
            else {
                // Use TV client for regular videos. TV_EMBEDDED should also work.
                // Anything else will likely give stream URLs that return 403 Forbidden.
                it = tvInnertube;
                payload = tvPayload;
            }
            let innertubeVideoInfo = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_fetchInnertubeVideoInfo).call(this, it, payload, cpn);
            checkAbortSignal();
            const thumbnail = __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_getThumbnail).call(this, innertubeVideoInfo.basic_info.thumbnail);
            const isLive = !!innertubeVideoInfo.basic_info.is_live;
            // Retrieve stream info
            let { info: streamInfo, validated, errMsg } = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_getAndValidateStreamInfo).call(this, innertubeVideoInfo, basicInfo, abortSignal, checkAbortSignal);
            checkAbortSignal();
            if (streamInfo?.url && !validated && basicInfo.src === 'ytmusic') {
                // We tried to fetch stream URL with YTMUSIC client, but it failed validation. This happens 
                // when you're not subscribed to YT Premium. In this case, retry with TV client.
                // We try YTMusic client first because it returns 256kbps streams for Premium accounts.
                // First, mark that sender does not support YT Music client, so we don't try it again for subsequent requests.
                // This will be reset to true when all senders disconnect.
                __classPrivateFieldSet(this, _VideoLoader_senderSupportsYTMusicClient, false, "f");
                __classPrivateFieldGet(this, _VideoLoader_logger, "f").info(`[ytcr] (${basicInfo.title || video.id}) failed to validate stream URL obtained with YT Music client; retrying with TV client...`);
                it = tvInnertube;
                payload = tvPayload;
                innertubeVideoInfo = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_fetchInnertubeVideoInfo).call(this, it, payload, cpn);
                checkAbortSignal();
                ({ info: streamInfo, validated, errMsg } = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_getAndValidateStreamInfo).call(this, innertubeVideoInfo, basicInfo, abortSignal, checkAbortSignal));
                checkAbortSignal();
            }
            return {
                ...basicInfo,
                errMsg: errMsg || undefined,
                thumbnail,
                isLive,
                streamUrl: streamInfo?.url,
                duration: innertubeVideoInfo.basic_info.duration || 0,
                bitrate: streamInfo?.bitrate || undefined,
                samplerate: streamInfo?.sampleRate,
                channels: streamInfo?.channels,
                streamExpires: innertubeVideoInfo.streaming_data?.expires
            };
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw error;
            }
            __classPrivateFieldGet(this, _VideoLoader_logger, "f").error(`[ytcr] Error in VideoLoader.getInfo(${video.id}):`, error);
            return {
                id: video.id,
                errMsg: error instanceof Error ? error.message : '(Check logs for errors)'
            };
        }
    }
}
_VideoLoader_logger = new WeakMap(), _VideoLoader_defaultInnertubeLoader = new WeakMap(), _VideoLoader_tvInnertubeLoader = new WeakMap(), _VideoLoader_senderSupportsYTMusicClient = new WeakMap(), _VideoLoader_instances = new WeakSet(), _VideoLoader_getInnertubeInstances = async function _VideoLoader_getInnertubeInstances() {
    return {
        defaultInnertube: (await __classPrivateFieldGet(this, _VideoLoader_defaultInnertubeLoader, "f").getInstance()).innertube,
        tvInnertube: (await __classPrivateFieldGet(this, _VideoLoader_tvInnertubeLoader, "f").getInstance()).innertube
    };
}, _VideoLoader_fetchInnertubeVideoInfo = async function _VideoLoader_fetchInnertubeVideoInfo(it, payload, cpn) {
    __classPrivateFieldGet(this, _VideoLoader_logger, "f").info(`[ytcr] (${payload.videoId}) fetching player data using ${payload.client || it.session.context.client.clientName} client...`);
    const playerResponse = await it.actions.execute('/player', payload);
    return new InnertubeLib.YT.VideoInfo([playerResponse], it.actions, cpn);
}, _VideoLoader_getAndValidateStreamInfo = async function _VideoLoader_getAndValidateStreamInfo(videoInfo, basicInfo, abortSignal, checkAbort, validationRetries = 3) {
    // Retrieve stream info
    const isLive = !!videoInfo.basic_info.is_live;
    let playable = false;
    let errMsg = null;
    let streamInfo = null;
    let validated = false;
    if (videoInfo.playability_status?.status === 'UNPLAYABLE') {
        if (videoInfo.has_trailer) {
            const trailerInfo = videoInfo.getTrailerInfo();
            if (trailerInfo) {
                streamInfo = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_chooseFormat).call(this, trailerInfo);
            }
        }
        else {
            errMsg = videoInfo.playability_status.reason;
        }
    }
    else if (!isLive) {
        streamInfo = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_chooseFormat).call(this, videoInfo);
    }
    else if (videoInfo.streaming_data?.hls_manifest_url) {
        const targetQuality = YTCRContext_js_1.default.getConfigValue('liveStreamQuality');
        streamInfo = {
            url: await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_getStreamUrlFromHLS).call(this, videoInfo.streaming_data.hls_manifest_url, targetQuality)
        };
    }
    playable = !!streamInfo?.url;
    if (!playable && !errMsg) {
        errMsg = YTCRContext_js_1.default.getI18n('YTCR_STREAM_NOT_FOUND');
    }
    checkAbort();
    // Validate
    if (streamInfo?.url) {
        const title = basicInfo.title || basicInfo.id;
        const startTime = new Date().getTime();
        __classPrivateFieldGet(this, _VideoLoader_logger, "f").info(`[ytcr] (${title}) validating stream URL "${streamInfo.url}"...`);
        let tries = 0;
        let testStreamResult = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_head).call(this, streamInfo.url, abortSignal);
        while (!testStreamResult.ok && tries < validationRetries) {
            checkAbort();
            __classPrivateFieldGet(this, _VideoLoader_logger, "f").warn(`[ytcr] (${title}) stream validation failed (${testStreamResult.status} - ${testStreamResult.statusText}); retrying after 2s...`);
            await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_sleep).call(this, 2000);
            tries++;
            testStreamResult = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_head).call(this, streamInfo.url, abortSignal);
        }
        const endTime = new Date().getTime();
        const timeTaken = (endTime - startTime) / 1000;
        if (tries === validationRetries) {
            __classPrivateFieldGet(this, _VideoLoader_logger, "f").warn(`[ytcr] (${title}) failed to validate stream URL "${streamInfo.url}" (retried ${tries} times in ${timeTaken}s).`);
        }
        else {
            validated = true;
            __classPrivateFieldGet(this, _VideoLoader_logger, "f").info(`[ytcr] (${title}) stream validated in ${timeTaken}s.`);
        }
    }
    return {
        info: streamInfo,
        validated,
        errMsg: errMsg
    };
}, _VideoLoader_getThumbnail = function _VideoLoader_getThumbnail(data) {
    const url = data?.[0]?.url;
    if (url?.startsWith('//')) {
        return `https:${url}`;
    }
    return url;
}, _VideoLoader_chooseFormat = async function _VideoLoader_chooseFormat(videoInfo) {
    const { defaultInnertube: innertube } = await __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_getInnertubeInstances).call(this);
    const preferredFormat = {
        ...BEST_AUDIO_FORMAT
    };
    const prefetch = YTCRContext_js_1.default.getConfigValue('prefetch');
    const preferOpus = prefetch && YTCRContext_js_1.default.getConfigValue('preferOpus');
    if (preferOpus) {
        __classPrivateFieldGet(this, _VideoLoader_logger, "f").debug('[ytcr] Preferred format is Opus');
        preferredFormat.format = 'opus';
    }
    let format;
    try {
        format = videoInfo?.chooseFormat(preferredFormat);
    }
    catch (error) {
        if (preferOpus && videoInfo) {
            __classPrivateFieldGet(this, _VideoLoader_logger, "f").debug('[ytcr] No matching format for Opus. Falling back to any audio format ...');
            try {
                format = videoInfo.chooseFormat(BEST_AUDIO_FORMAT);
            }
            catch (error) {
                __classPrivateFieldGet(this, _VideoLoader_logger, "f").debug('[ytcr] Failed to obtain audio format:', error);
                format = null;
            }
        }
        else {
            throw error;
        }
    }
    const streamUrl = format ? format.decipher(innertube.session.player) : null;
    const streamData = format ? { ...format, url: streamUrl } : null;
    if (streamData) {
        return __classPrivateFieldGet(this, _VideoLoader_instances, "m", _VideoLoader_parseStreamData).call(this, streamData);
    }
    return null;
}, _VideoLoader_parseStreamData = function _VideoLoader_parseStreamData(data) {
    const audioBitrate = ITAG_TO_BITRATE[`${data.itag}`];
    return {
        url: data.url || null,
        mimeType: data.mime_type,
        bitrate: audioBitrate ? `${audioBitrate} kbps` : null,
        sampleRate: data.audio_sample_rate,
        channels: data.audio_channels
    };
}, _VideoLoader_getStreamUrlFromHLS = async function _VideoLoader_getStreamUrlFromHLS(manifestUrl, targetQuality) {
    if (!targetQuality || targetQuality === 'auto') {
        return manifestUrl;
    }
    const res = await fetch(manifestUrl);
    const manifestContents = await res.text();
    // Match Resolution and Url
    const regex = /#EXT-X-STREAM-INF.*RESOLUTION=(\d+x\d+).*[\r\n](.+)/gm;
    const playlistVariants = [];
    // Modified from regex101's code generator :)
    let m;
    while ((m = regex.exec(manifestContents)) !== null) {
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        const variant = {};
        playlistVariants.push(variant);
        m.forEach((match, groupIndex) => {
            if (groupIndex === 1) { // Resolution
                variant.quality = `${match.split('x')[1]}p`;
            }
            if (groupIndex === 2) {
                variant.url = match;
            }
        });
    }
    // Find matching variant or closest one that is lower than targetQuality
    const targetQualityInt = parseInt(targetQuality);
    const diffs = playlistVariants.map((variant) => ({
        variant,
        qualityDelta: targetQualityInt - parseInt(variant.quality)
    }));
    const closest = diffs.filter((v) => v.qualityDelta >= 0).sort((v1, v2) => v1.qualityDelta - v2.qualityDelta)[0];
    return closest?.variant.url || playlistVariants[0]?.url || null;
}, _VideoLoader_sleep = function _VideoLoader_sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}, _VideoLoader_head = async function _VideoLoader_head(url, signal) {
    const res = await fetch(url, { method: 'HEAD', signal });
    return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText
    };
};
exports.default = VideoLoader;
//# sourceMappingURL=VideoLoader.js.map