import sc from '../SoundCloudContext';
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
const STREAM_FORMATS = [
  'aac_160k+hls',
  'mp3_0_0+http',
  'opus_0_0+hls',
  'mp3_0_0+hls',
  'mp3_1_0+http',
  'mp3_1_0+hls'
] as const;

type StreamFormat = typeof STREAM_FORMATS[number];

const PREFERRED_STANDARD_STREAM_FORMATS: StreamFormat[] = [
  'aac_160k+hls',
  'mp3_0_0+http',
  'opus_0_0+hls',
  'mp3_0_0+hls',
  'mp3_1_0+http',
  'mp3_1_0+hls'
];

// Long streams are those >= 30 mins
const PREFERRED_LONG_STREAM_FORMAT: StreamFormat[] = [
  'aac_160k+hls',
  'opus_0_0+hls',
  'mp3_0_0+hls',
  'mp3_1_0+hls',
  // http streams have ridiculously short expiry
  // time (~30 mins), so last resort only.
  'mp3_0_0+http',
  'mp3_1_0+http',
];

const STREAM_FORMAT_DETAILS: Record<
  StreamFormat,
  Pick<GetPreferredStreamResult, "codec" | "protocol" | "bitrate">
> = {
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
} as const;

export interface GetPreferredStreamResult {
  transcodingUrl: string;
  format: StreamFormat;
  codec: 'aac' | 'mp3' | 'opus';
  protocol: 'hls' | 'http';
  bitrate: string;
}

type StreamFormatMap = Partial<Record<StreamFormat, TrackEntity['transcodings'][number]>>;

export default class TrackHelper {

  static cacheTracks(tracks: TrackEntity[], cacheKeyGen: (keyData: Record<string, any>) => string) {
    const cache = sc.getCache();
    tracks.forEach((track) => {
      const keyData = { trackId: track.id };
      const key = cacheKeyGen(keyData);
      cache.put(key, track);
    });
  }

  static getPreferredStream(track: TrackEntity): GetPreferredStreamResult | null {
    const isLongStream = track.playableState === 'allowed' && track.duration && (track.duration / 1000) > 1800;

    if (sc.getConfigValue('logTranscodings')) {
      sc.getLogger().info(`[soundcloud-testing] Available transcodings: ${JSON.stringify(track.transcodings)}`);
    }

    const availableFormats = track.transcodings.reduce<StreamFormatMap>((result, t) => {
      const protocol = t.protocol === 'progressive' ? 'http' : t.protocol;
      const sf = `${t.preset}+${protocol}`;
      if (STREAM_FORMATS.includes(sf as any)) {
        result[sf as StreamFormat] = t;
      }
      return result;
    }, {});

    let selectedStream: {
      format: StreamFormat,
      transcoding: TrackEntity['transcodings'][number]
    } | null = null;
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

    let result: GetPreferredStreamResult | null = null;

    if (selectedStream && selectedStream.transcoding.url) {
      result = {
        format: selectedStream.format,
        ...STREAM_FORMAT_DETAILS[selectedStream.format],
        transcodingUrl: selectedStream.transcoding.url
      };
    }

    if (sc.getConfigValue('logTranscodings')) {
      sc.getLogger().info(`[soundcloud-testing] Chosen transcoding: ${JSON.stringify(result)}`);
    }

    return result;
  }
}
