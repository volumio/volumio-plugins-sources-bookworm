import bcfetch, {
  type PlaylistAPIGetPlaylistParams,
  type PlaylistListContinuation,
  type Playlist,
  type PlaylistAPIListParams,
  type PlaylistList,
  type PlaylistListItem
} from 'bandcamp-fetch';
import bandcamp from '../BandcampContext';
import BaseModel, { type LoopFetchCallbackParams } from './BaseModel';
import EntityConverter from '../util/EntityConverter';

export interface PlaylistModelGetPlaylistsParams {
  fanId: number;
  pageToken?: string;
  pageOffset?: number;
  limit: number;
}

interface GetPlaylistsLoopFetchCallbackParams extends LoopFetchCallbackParams {
  fanId: number;
}

export default class PlaylistModel extends BaseModel {
  getPlaylistCount(fanId: number) {
    return bandcamp
      .getCache()
      .getOrSet(
        this.getCacheKeyForFetch('playlistCount', { fanId }),
        async () => {
          const list = await bcfetch.limiter.playlist.list({ fanId });
          return list.total;
        }
      );
  }

  getPlaylists(params: PlaylistModelGetPlaylistsParams) {
    return this.loopFetch({
      callbackParams: { ...params },
      getFetchPromise: this.#getPlaylistsFetchPromise.bind(this),
      getItemsFromFetchResult: this.#getPlaylistsFromFetchResult.bind(this),
      getNextPageTokenFromFetchResult:
        this.#getNextPageTokenFromPlaylistsFetchResult.bind(this),
      convertToEntity: this.#convertFetchedPlaylistListItemToEntity.bind(this),
      pageOffset: params.pageOffset,
      pageToken: params.pageToken,
      limit: params.limit
    });
  }

  #getPlaylistsFetchPromise(params: GetPlaylistsLoopFetchCallbackParams) {
    let continuation: PlaylistListContinuation | undefined = undefined;
    if (params.pageToken) {
      const parsedPageToken = JSON.parse(params.pageToken);
      continuation = parsedPageToken?.continuation || undefined;
    }
    const queryParams: PlaylistAPIListParams =
      continuation ?
        {
          continuation,
          imageFormat: this.getAlbumImageFormat()
        }
      : {
          fanId: params.fanId,
          imageFormat: this.getAlbumImageFormat()
        };

    return bandcamp
      .getCache()
      .getOrSet(this.getCacheKeyForFetch('playlists', queryParams), () =>
        bcfetch.limiter.playlist.list(queryParams)
      );
  }

  #getPlaylistsFromFetchResult(result: PlaylistList) {
    return result.items.slice(0);
  }

  #getNextPageTokenFromPlaylistsFetchResult(
    result: PlaylistList,
    params: GetPlaylistsLoopFetchCallbackParams
  ) {
    const continuation = result.continuation;
    let indexRef = 0;
    if (params.pageToken) {
      const parsedPageToken = JSON.parse(params.pageToken);
      indexRef = parsedPageToken?.indexRef || 0;
    }
    if (
      result.items.length > 0 &&
      result.total > indexRef + result.items.length
    ) {
      const nextPageToken = {
        continuation,
        indexRef: indexRef + result.items.length
      };
      return JSON.stringify(nextPageToken);
    }
    return null;
  }

  #convertFetchedPlaylistListItemToEntity(item: PlaylistListItem) {
    return EntityConverter.convertPlaylistListItem(item);
  }

  async getPlaylist(playlistUrl: string) {
    const queryParams: PlaylistAPIGetPlaylistParams = {
      playlistUrl,
      artistImageFormat: this.getArtistImageFormat(),
      trackImageFormat: this.getAlbumImageFormat(),
      playlistImageFormat: this.getAlbumImageFormat(),
      curatorImageFormat: this.getArtistImageFormat()
    };
    const playlist = await bandcamp
      .getCache()
      .getOrSet(this.getCacheKeyForFetch('playlist', queryParams), async () => {
        const pl = await bcfetch.limiter.playlist.getPlaylist(queryParams);
        if (pl.additionalTrackIds.length > 0) {
          const additionalTracks =
            await bcfetch.limiter.playlist.getAdditionalTracks({
              playlist: pl
            });
          return {
            ...pl,
            tracks: [...pl.tracks, ...additionalTracks]
          };
        }
        return pl;
      });

    return this.#convertFetchedPlaylistToEntity(playlist);
  }

  getPlaylistCategories() {
    return bandcamp
      .getCache()
      .getOrSet(this.getCacheKeyForFetch('articleCategories'), () =>
        bcfetch.limiter.article.getCategories()
      );
  }

  #convertFetchedPlaylistToEntity(item: Playlist) {
    return EntityConverter.convertPlaylist(item);
  }
}
