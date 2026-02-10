"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SoundCloudContext_1 = __importDefault(require("../SoundCloudContext"));
/**
 * Known formats:
 *    preset + protocol | mime type | bitrate
 * 1. aac_160k + hls | audio/mp4 | 160kbps
 * 2. mp3_0_0 + hls | audio/mpeg | 128kbps (URL: https://.../playlist/<uuid>.128.mp3/playlist.m3u8...)
 * 3. mp3_0_0 + progressive (http) | audio/mpeg | 128kbps (URL: https://.../<uuid>.128.mp3?...)
 * 4. opus_0_0 + hls | audio/ogg | 64kbps (URL: https://.../playlist/<uuid>.64.opus//playlist.m3u8...)
 *
 * Preview stream formats:
 * 1. mp3_1_0 + hls | audio/mpeg | 128kbps
 * 2. mp3_1_0 + progressive (http) | audio/mpeg | 128kbps
 *
 * There is also supposedly aac+hls/96kbps and aac+hls/256kbps (Go+), but would need
 * to see how they're actually presented in the API response.
 *
 * According to https://developers.soundcloud.com/blog/api-streaming-urls,
 * the AAC HLS streams will replace all others. Preview (30s) tracks will
 * remain the same (mp3 128kbps progressive).
 */
const STREAM_FORMATS = [
    'aac_160k+hls',
    'mp3_0_0+http',
    'opus_0_0+hls',
    'mp3_0_0+hls',
    'mp3_1_0+http',
    'mp3_1_0+hls'
];
const PREFERRED_STANDARD_STREAM_FORMATS = [
    'aac_160k+hls',
    'mp3_0_0+http',
    'opus_0_0+hls',
    'mp3_0_0+hls',
    'mp3_1_0+http',
    'mp3_1_0+hls'
];
// Long streams are those >= 30 mins
const PREFERRED_LONG_STREAM_FORMAT = [
    'aac_160k+hls',
    'opus_0_0+hls',
    'mp3_0_0+hls',
    'mp3_1_0+hls',
    // http streams have ridiculously short expiry
    // time (~30 mins), so last resort only.
    'mp3_0_0+http',
    'mp3_1_0+http',
];
const STREAM_FORMAT_DETAILS = {
    'aac_160k+hls': {
        codec: 'aac',
        protocol: 'hls',
        bitrate: '160 kbps'
    },
    'mp3_0_0+http': {
        codec: 'mp3',
        protocol: 'http',
        bitrate: '128 kbps'
    },
    'opus_0_0+hls': {
        codec: 'opus',
        protocol: 'hls',
        bitrate: '64 kbps'
    },
    'mp3_0_0+hls': {
        codec: 'mp3',
        protocol: 'hls',
        bitrate: '128 kbps'
    },
    'mp3_1_0+http': {
        codec: 'mp3',
        protocol: 'http',
        bitrate: '128 kbps'
    },
    'mp3_1_0+hls': {
        codec: 'mp3',
        protocol: 'hls',
        bitrate: '128 kbps'
    }
};
class TrackHelper {
    static cacheTracks(tracks, cacheKeyGen) {
        const cache = SoundCloudContext_1.default.getCache();
        tracks.forEach((track) => {
            const keyData = { trackId: track.id };
            const key = cacheKeyGen(keyData);
            cache.put(key, track);
        });
    }
    static getPreferredStream(track) {
        const isLongStream = track.playableState === 'allowed' && track.duration && (track.duration / 1000) > 1800;
        if (SoundCloudContext_1.default.getConfigValue('logTranscodings')) {
            SoundCloudContext_1.default.getLogger().info(`[soundcloud-testing] Available transcodings: ${JSON.stringify(track.transcodings)}`);
        }
        const availableFormats = track.transcodings.reduce((result, t) => {
            const protocol = t.protocol === 'progressive' ? 'http' : t.protocol;
            const sf = `${t.preset}+${protocol}`;
            if (STREAM_FORMATS.includes(sf)) {
                result[sf] = t;
            }
            return result;
        }, {});
        let selectedStream = null;
        const targetFormats = isLongStream ? PREFERRED_LONG_STREAM_FORMAT : PREFERRED_STANDARD_STREAM_FORMATS;
        for (const pf of targetFormats) {
            if (availableFormats[pf]) {
                selectedStream = {
                    format: pf,
                    transcoding: availableFormats[pf]
                };
                break;
            }
        }
        let result = null;
        if (selectedStream && selectedStream.transcoding.url) {
            result = {
                format: selectedStream.format,
                ...STREAM_FORMAT_DETAILS[selectedStream.format],
                transcodingUrl: selectedStream.transcoding.url
            };
        }
        if (SoundCloudContext_1.default.getConfigValue('logTranscodings')) {
            SoundCloudContext_1.default.getLogger().info(`[soundcloud-testing] Chosen transcoding: ${JSON.stringify(result)}`);
        }
        return result;
    }
}
exports.default = TrackHelper;
//# sourceMappingURL=TrackHelper.js.map