import ytmusic from '../YTMusicContext';
import {type Innertube, type Types} from 'volumio-yt-support/dist/innertube';
import { YTNodes, Utils as YTUtils, YTMusic, Parser } from 'volumio-yt-support/dist/innertube';
import { BaseModel } from './BaseModel';
import InnertubeResultParser from './InnertubeResultParser';
import type Endpoint from '../types/Endpoint';
import { EndpointType } from '../types/Endpoint';
import type MusicItemPlaybackInfo from '../types/MusicItemPlaybackInfo';
import { type ContentItem } from '../types';
import EndpointHelper from '../util/EndpointHelper';
import InnertubeLoader from './InnertubeLoader';

// https://gist.github.com/sidneys/7095afe4da4ae58694d128b1034e01e2
// https://gist.github.com/MartinEesmaa/2f4b261cb90a47e9c41ba115a011a4aa
const ITAG_TO_BITRATE: Record<string, string> = {
  '139': '48',
  '140': '128',
  '141': '256',
  '171': '128',
  '249': 'VBR 50',
  '250': 'VBR 70',
  '251': 'VBR 160',
  '774': 'VBR 256'
};

const BEST_AUDIO_FORMAT: Types.FormatOptions = {
  type: 'audio',
  format: 'any',
  quality: 'best'
};

export default class MusicItemModel extends BaseModel {

  async getPlaybackInfo(endpoint: Endpoint, signal?: AbortSignal): Promise<MusicItemPlaybackInfo | null> {
    if (!EndpointHelper.isType(endpoint, EndpointType.Watch) || !endpoint.payload.videoId) {
      throw Error('Invalid endpoint');
    }
    const { innertube } = await this.getInnertube();
    const { trackInfo, contentPoToken } = await this.#getTrackInfo(innertube, endpoint);
    const streamData = await this.#extractStreamData(innertube, trackInfo, contentPoToken );

    // `trackInfo` does not contain album info - need to obtain from item in Up Next tab.
    const infoFromUpNextTab = this.#getInfoFromUpNextTab(trackInfo, endpoint);
    let musicItem: ContentItem.MusicItem | null = null;
    let album: ContentItem.MusicItem['album'] | null = null;
    if (infoFromUpNextTab && (infoFromUpNextTab.type === 'video' || infoFromUpNextTab.type === 'song')) {
      musicItem = infoFromUpNextTab;
      album = musicItem.album;
    }

    // `trackInfo` sometimes ignores hl / gl (lang / region), so titles and such could be in wrong language.
    // Furthermore, the artist's channelId is possibly wrong for private uploads.
    // We return info from item in Up Next tab, while using trackInfo as fallback.
    let channelId: string | undefined;
    if (musicItem?.artists && musicItem.artists[0]?.channelId) {
      channelId = musicItem.artists[0].channelId;
    }
    else {
      channelId = trackInfo.basic_info.channel_id;
    }

    const title = musicItem?.title || trackInfo.basic_info.title;

    if (streamData?.url) {
      const startTime = new Date().getTime();
      ytmusic.getLogger().info(`[ytmusic] (${title}) validating stream URL "${streamData.url}"...`);
      let tries = 0;
      let testStreamResult = await this.#head(streamData.url, signal);
      while (!testStreamResult.ok && tries < 3) {
        if (signal?.aborted) {
          throw Error('Aborted');
        }
        ytmusic.getLogger().warn(`[ytmusic] (${title}) stream validation failed (${testStreamResult.status} - ${testStreamResult.statusText}); retrying after 2s...`);
        await this.#sleep(2000);
        tries++;
        testStreamResult = await this.#head(streamData.url, signal);
      }
      const endTime = new Date().getTime();
      const timeTaken = (endTime - startTime) / 1000;
      if (tries === 3) {
        ytmusic.getLogger().warn(`[ytmusic] (${title}) failed to validate stream URL "${streamData.url}" (retried ${tries} times in ${timeTaken}s).`);
      }
      else {
        ytmusic.getLogger().info(`[ytmusic] (${title}) stream validated in ${timeTaken}s.`);
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
      thumbnail: InnertubeResultParser.parseThumbnail(trackInfo.basic_info.thumbnail) || undefined,
      stream: streamData,
      duration: trackInfo.basic_info.duration,
      addToHistory: () => {
        return trackInfo.addToWatchHistory();
      },
      radioEndpoint: musicItem?.radioEndpoint
    };
  }

  // Based on Innertube.Music.#fetchInfoFromEndpoint()
  async #getTrackInfo(innertube: Innertube, endpoint: Endpoint) {
    const videoId = endpoint.payload.videoId;
    const watchEndpoint = new YTNodes.NavigationEndpoint({ watchEndpoint: {
      videoId,
      playlistId: endpoint.payload.playlistId,
      params: endpoint.payload.params,
      racyCheckOk: true,
      contentCheckOk: true
    } });

    const nextEndpoint = new YTNodes.NavigationEndpoint({ watchNextEndpoint: { videoId: endpoint.payload.videoId }});

    const contentPoToken = (await InnertubeLoader.generatePoToken(videoId)).poToken;
    ytmusic.getLogger().info(`[ytmusic] Obtained PO token for video #${videoId}: ${contentPoToken}`);

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
        poToken: contentPoToken
      }
    });

    const next_response = nextEndpoint.call(innertube.actions, {
      client: 'YTMUSIC',
      enablePersistentPlaylistPanel: true
    });

    const cpn = YTUtils.generateRandomString(16);

    const response = await Promise.all([ player_response, next_response ]);

    return {
      trackInfo: new YTMusic.TrackInfo(response, innertube.actions, cpn),
      contentPoToken
    };
  }

  async #extractStreamData(innertube: Innertube, info: YTMusic.TrackInfo, contentPoToken: string): Promise<MusicItemPlaybackInfo['stream'] | null> {
    const preferredFormat = {
      ...BEST_AUDIO_FORMAT
    };
    const prefetch = ytmusic.getConfigValue('prefetch');
    const preferOpus = prefetch && ytmusic.getConfigValue('preferOpus');
    if (preferOpus) {
      ytmusic.getLogger().info('[ytmusic] Preferred format is Opus');
      preferredFormat.format = 'opus';
    }
    let format;
    try {
      format = info.chooseFormat(preferredFormat);
    }
    catch (error) {
      if (preferOpus && info) {
        ytmusic.getLogger().warn('[ytmusic] No matching format for Opus. Falling back to any audio format ...');
        try {
          format = info.chooseFormat(BEST_AUDIO_FORMAT);
        }
        catch (error) {
          ytmusic.getLogger().error('[ytmusic] Failed to obtain audio format:', error);
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
      urlObj.searchParams.set('pot', contentPoToken);
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
  }

  #getInfoFromUpNextTab(info: YTMusic.TrackInfo, endpoint: Endpoint) {
    const playlistPanel = info.page[1]?.contents_memo?.getType(YTNodes.PlaylistPanel).first();
    if (!playlistPanel) {
      return null;
    }
    const videoId = endpoint.payload.videoId;
    const match = playlistPanel.contents.find((data) => {
      if (data.is(YTNodes.PlaylistPanelVideoWrapper)) {
        if (data.primary?.video_id === videoId) {
          return true;
        }
        return data.counterpart?.find((item) => item.video_id === videoId);
      }
      else if (data.is(YTNodes.PlaylistPanelVideo)) {
        return data.video_id === videoId;
      }
    });
    return InnertubeResultParser.parseContentItem(match);
  }

  async #getLyricsId(videoId: string) {
    const { innertube } = await this.getInnertube();
    const response = await innertube.actions.execute('/next', {
      videoId,
      client: 'YTMUSIC_ANDROID'
    });
    const parsed = Parser.parseResponse(response.data);
    const tabs = parsed.contents_memo?.getType(YTNodes.Tab);
    const tab = tabs?.matchCondition((tab) => tab.endpoint.payload.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS');
    if (!tab) {
      throw Error('Could not find lyrics tab.');
    }
    const lyricsId = tab.endpoint.payload.browseId;
    if (!lyricsId) {
      throw Error('No lyrics ID found in endpoint');
    }
    return lyricsId;
  }

  async getLyrics(videoId: string) {
    const { innertube } = await this.getInnertube();
    const lyricsId = await this.#getLyricsId(videoId);
    const payload = {
      browseId: lyricsId,
      client: 'YTMUSIC_ANDROID'
    };
    const response = await innertube.actions.execute('/browse', payload);
    const parsed = Parser.parseResponse(response.data);
    return InnertubeResultParser.parseLyrics(parsed);
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
