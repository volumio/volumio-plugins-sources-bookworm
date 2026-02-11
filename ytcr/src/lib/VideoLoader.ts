import * as InnertubeLib from 'volumio-yt-support/dist/innertube.js';
import { DataError, type Video } from 'yt-cast-receiver';
import ytcr from './YTCRContext.js';
import InnertubeLoader from './InnertubeLoader.js';
import type Logger from './Logger.js';

type InnertubeVideoInfo = InnertubeLib.YT.VideoInfo;
type Format = InnertubeLib.Misc.Format;

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
} as Record<string, string>;

const BEST_AUDIO_FORMAT = {
  type: 'audio',
  format: 'any',
  quality: 'best'
} as InnertubeLib.Types.FormatOptions;

interface BasicInfo {
  id: string;
  src?: 'yt' | 'ytmusic';
  title?: string;
  channel?: string;
  artist?: string;
  album?: string;
  isLive?: boolean;
}

export interface VideoInfo extends BasicInfo {
  errMsg?: string;
  thumbnail?: string;
  isLive?: boolean;
  streamUrl?: string | null;
  duration?: number;
  bitrate?: string;
  samplerate?: number;
  channels?: number;
  streamExpires?: Date;
}

interface StreamInfo {
  url: string | null;
  mimeType?: string;
  bitrate?: string | null;
  sampleRate?: number;
  channels?: number;
}

export default class VideoLoader {

  #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
    InnertubeLoader.setLogger(logger);
  }

  async #getInnertube() {
    return await (await InnertubeLoader.getInstance()).getInnertube();
  }

  async refreshI18nConfig() {
    await InnertubeLoader.applyI18nConfig();
  }

  async getInfo(video: Video, abortSignal: AbortSignal): Promise<VideoInfo> {
    const innertube = await this.#getInnertube();;
    
    const checkAbortSignal = () => {
      if (abortSignal.aborted) {
        const msg = `VideoLoader.getInfo() aborted for video Id: ${video.id}`;
        this.#logger.debug(`[ytcr] ${msg}.`);
        const abortError = Error(msg);
        abortError.name = 'AbortError';
        throw abortError;
      }
    };

    this.#logger.debug(`[ytcr] VideoLoader.getInfo: ${video.id}`);

    const contentPoToken = (await InnertubeLoader.generatePoToken(video.id)).poToken;

    checkAbortSignal();

    const payload = {
      videoId: video.id,
      racyCheckOk: true,
      contentCheckOk: true,
      serviceIntegrityDimensions: {
        poToken: contentPoToken
      },
      enableMdxAutoplay: true,
      isMdxPlayback: true,
      playbackContext: {
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: '-1',
          signatureTimestamp: innertube.session.player?.signature_timestamp || 0
        }
      }
    } as any;
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
      } as any;
    }
    else {
      delete (innertube.session.context.user as any)?.credentialTransferTokens;
    }

    const cpn = InnertubeLib.Utils.generateRandomString(16);

    try {
      // There are two endpoints we need to fetch data from:
      // 1. '/next': for metadata (title, channel for video, artist / album for music...)
      // 2. '/player': for streaming data
      const nextResponse = await innertube.actions.execute('/next', {
        ...payload,
        client: 'TV'
      }) as any;
      checkAbortSignal();

      let basicInfo: BasicInfo | null = null;

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
        throw new DataError('Metadata not found in response');
      }

      // Fetch response from '/player' endpoint. But first, decide on the Innertube client to use.
      // Setting payload.client will cause Innertube to modify 'context.client' before submitting request.
      if (basicInfo.src === 'ytmusic') {
        payload.client = 'YTMUSIC';
      }
      else if (basicInfo.isLive) {
        // Do not use TV client for live streams, because it will only return DASH manifest URL.
        // Use default WEB client instead, which will return HLS manifest URL.
        payload.client = 'WEB';
      }
      else {
        // Use TV client for regular videos. TV_EMBEDDED should also work.
        // Anything else will likely give stream URLs that return 403 Forbidden.
        payload.client = 'TV';
      }
      
      let innertubeVideoInfo = await this.#fetchInnertubeVideoInfo(payload, cpn);
      checkAbortSignal();

      const thumbnail = this.#getThumbnail(innertubeVideoInfo.basic_info.thumbnail);

      // Retrieve stream info
      let { info: streamInfo, validated, errMsg } = await this.#getAndValidateStreamInfo(innertubeVideoInfo, basicInfo, contentPoToken, abortSignal, checkAbortSignal);
      checkAbortSignal();

      if (streamInfo?.url && !validated && basicInfo.src === 'ytmusic') {
        // YTMUSIC client didn't work out; retry with TV client
        this.#logger.info(`[ytcr] (${basicInfo.title || video.id}) failed to validate stream URL obtained with YTMUSIC client; retrying with TV client...`);
        payload.client = 'TV';
        innertubeVideoInfo = await this.#fetchInnertubeVideoInfo(payload, cpn);
        checkAbortSignal();
        ({ info: streamInfo, validated, errMsg } = await this.#getAndValidateStreamInfo(innertubeVideoInfo, basicInfo, contentPoToken, abortSignal, checkAbortSignal));
        checkAbortSignal();
      }

      return {
        ...basicInfo,
        errMsg: errMsg || undefined,
        thumbnail,
        isLive: !!basicInfo.isLive,
        streamUrl: streamInfo?.url,
        duration: innertubeVideoInfo.basic_info.duration || 0,
        bitrate: streamInfo?.bitrate || undefined,
        samplerate: streamInfo?.sampleRate,
        channels: streamInfo?.channels,
        streamExpires: innertubeVideoInfo.streaming_data?.expires
      };
    }
    catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      this.#logger.error(`[ytcr] Error in VideoLoader.getInfo(${video.id}):`, error);
      return {
        id: video.id,
        errMsg: error instanceof Error ? error.message : '(Check logs for errors)'
      };
    }
  }

  async #fetchInnertubeVideoInfo(payload: any, cpn: string) {
    const innertube = await this.#getInnertube();
    this.#logger.info(`[ytcr] (${payload.videoId}) fetching player data using ${payload.client || innertube.session.context.client.clientName} client...`);
    const playerResponse = await innertube.actions.execute('/player', payload) as any;
    return new InnertubeLib.YT.VideoInfo([ playerResponse ], innertube.actions, cpn);
  }

  async #getAndValidateStreamInfo(videoInfo: InnertubeVideoInfo, basicInfo: BasicInfo, contentPoToken: string, abortSignal: AbortSignal, checkAbort: () => void, validationRetries = 3) {
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
          streamInfo = await this.#chooseFormat(trailerInfo);
        }
      }
      else {
        errMsg = videoInfo.playability_status.reason;
      }
    }
    else if (!isLive) {
      streamInfo = await this.#chooseFormat(videoInfo);
    }
    else if (videoInfo.streaming_data?.hls_manifest_url) {
      const targetQuality = ytcr.getConfigValue('liveStreamQuality');
      streamInfo = {
        url: await this.#getStreamUrlFromHLS(videoInfo.streaming_data.hls_manifest_url, targetQuality)
      };
    }

    playable = !!streamInfo?.url;

    if (!playable && !errMsg) {
      errMsg = ytcr.getI18n('YTCR_STREAM_NOT_FOUND');
    }

    checkAbort();
    
    // Validate
    if (streamInfo?.url) {
      if (!isLive) {
        // Innertube sets `pot` searchParam of URL to session-bound PO token.
        // Seems YT now requires `pot` to be the *content-bound* token, otherwise we'll get 403.
        // See: https://github.com/TeamNewPipe/NewPipeExtractor/issues/1392
        
        const urlObj = new URL(streamInfo.url);
        urlObj.searchParams.set('pot', contentPoToken);
        streamInfo.url = urlObj.toString();
      }
      const title = basicInfo.title || basicInfo.id;
      const startTime = new Date().getTime();
      this.#logger.info(`[ytcr] (${title}) validating stream URL "${streamInfo.url}"...`);
      let tries = 0;
      let testStreamResult = await this.#head(streamInfo.url, abortSignal);
      while (!testStreamResult.ok && tries < validationRetries) {
        checkAbort();
        this.#logger.warn(`[ytcr] (${title}) stream validation failed (${testStreamResult.status} - ${testStreamResult.statusText}); retrying after 2s...`);
        await this.#sleep(2000);
        tries++;
        testStreamResult = await this.#head(streamInfo.url, abortSignal);
      }
      const endTime = new Date().getTime();
      const timeTaken = (endTime - startTime) / 1000;
      if (tries === validationRetries) {
        this.#logger.warn(`[ytcr] (${title}) failed to validate stream URL "${streamInfo.url}" (retried ${tries} times in ${timeTaken}s).`);
      }
      else {
        validated = true;
        this.#logger.info(`[ytcr] (${title}) stream validated in ${timeTaken}s.`);
      }
    }

    return {
      info: streamInfo,
      validated,
      errMsg: errMsg
    }
  }

  #getThumbnail(data: any): string {
    const url = data?.[0]?.url;
    if (url?.startsWith('//')) {
      return `https:${url}`;
    }
    return url;
  }

  async #chooseFormat(videoInfo: InnertubeVideoInfo): Promise<StreamInfo | null> {  
    const innertube = await this.#getInnertube();
    const preferredFormat = {
      ...BEST_AUDIO_FORMAT
    };
    const prefetch = ytcr.getConfigValue('prefetch');
    const preferOpus = prefetch && ytcr.getConfigValue('preferOpus');
    if (preferOpus) {
      this.#logger.debug('[ytcr] Preferred format is Opus');
      preferredFormat.format = 'opus';
    }
    let format;
    try {
      format = videoInfo?.chooseFormat(preferredFormat);
    }
    catch (error) {
      if (preferOpus && videoInfo) {
        this.#logger.debug('[ytcr] No matching format for Opus. Falling back to any audio format ...');
        try {
          format = videoInfo.chooseFormat(BEST_AUDIO_FORMAT);
        }
        catch (error) {
          this.#logger.debug('[ytcr] Failed to obtain audio format:', error);
          format = null;
        }
      }
      else {
        throw error;
      }
    }

    const streamUrl = format ? await format.decipher(innertube.session.player) : null;
    const streamData = format ? { ...format, url: streamUrl } as Format : null;
    if (streamData) {
      return this.#parseStreamData(streamData);
    }
    return null;
  }

  #parseStreamData(data: Format): StreamInfo {
    const audioBitrate = ITAG_TO_BITRATE[`${data.itag}`];

    return {
      url: data.url || null,
      mimeType: data.mime_type,
      bitrate: audioBitrate ? `${audioBitrate} kbps` : null,
      sampleRate: data.audio_sample_rate,
      channels: data.audio_channels
    };
  }

  async #getStreamUrlFromHLS(manifestUrl: string, targetQuality?: string): Promise<string | null> {
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

      const variant: any = {};
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
  }

  #sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async #head(url: string, signal?: AbortSignal) {
    const res = await fetch(url, { method: 'HEAD', signal });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText
    };
  }
}
