import type TrackEntity from '../entities/TrackEntity';
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
declare const STREAM_FORMATS: readonly ["aac_160k+hls", "mp3_0_0+http", "opus_0_0+hls", "mp3_0_0+hls", "mp3_1_0+http", "mp3_1_0+hls"];
type StreamFormat = typeof STREAM_FORMATS[number];
export interface GetPreferredStreamResult {
    transcodingUrl: string;
    format: StreamFormat;
    codec: 'aac' | 'mp3' | 'opus';
    protocol: 'hls' | 'http';
    bitrate: string;
}
export default class TrackHelper {
    static cacheTracks(tracks: TrackEntity[], cacheKeyGen: (keyData: Record<string, any>) => string): void;
    static getPreferredStream(track: TrackEntity): GetPreferredStreamResult | null;
}
export {};
//# sourceMappingURL=TrackHelper.d.ts.map