import BaseModel, { type LoopFetchCallbackParams, type LoopFetchResult } from './BaseModel';
import { Album, Constants, type FeedItem, Playlist, Track } from 'soundcloud-fetch';
import Mapper from './Mapper';
import type PlaylistEntity from '../entities/PlaylistEntity';
import type AlbumEntity from '../entities/AlbumEntity';
import type TrackEntity from '../entities/TrackEntity';
import TrackHelper from '../util/TrackHelper';

export interface FeedModelGetFeedItemsParams {
  pageToken?: string;
  pageOffset?: number;
  limit?: number;
  activityTypes: ['TrackPost', 'TrackRepost'];
}

interface GetFeedItemsLoopFetchCallbackParams extends LoopFetchCallbackParams {
  activityTypes: ['TrackPost', 'TrackRepost'];
}

export default class FeedModel extends BaseModel {

  getFeedItems(params: FeedModelGetFeedItemsParams) {
    const getItems = this.commonGetCollectionItemsFromLoopFetchResult<FeedItem>;
    const getNextPageToken = this.commonGetNextPageTokenFromLoopFetchResult<FeedItem>;

    return this.loopFetch({
      callbackParams: { ...params },
      getFetchPromise: this.#getFeedItemsFetchPromise.bind(this),
      getItemsFromFetchResult: getItems.bind(this),
      getNextPageTokenFromFetchResult: getNextPageToken.bind(this),
      convertToEntity: this.#convertFetchedFeedItemToEntity.bind(this),
      onEnd: this.#onGetFeedItemsLoopFetchEnd.bind(this),
      pageToken: params.pageToken,
      pageOffset: params.pageOffset,
      limit: params.limit
    });
  }

  async #getFeedItemsFetchPromise(params: GetFeedItemsLoopFetchCallbackParams) {
    const api = this.getSoundCloudAPI();

    const continuationContents = await this.commonGetLoopFetchResultByPageToken<FeedItem>(params);
    if (continuationContents) {
      return continuationContents;
    }

    const queryParams = {
      activityTypes: params.activityTypes,
      limit: Constants.QUERY_MAX_LIMIT
    };
    return api.me.getFeed(queryParams);
  }

  async #convertFetchedFeedItemToEntity(item: FeedItem): Promise<AlbumEntity | PlaylistEntity | TrackEntity | null> {
    const wrappedItem = item.item;
    if (wrappedItem instanceof Album) {
      return Mapper.mapAlbum(wrappedItem);
    }
    else if (wrappedItem instanceof Playlist) {
      return Mapper.mapPlaylist(wrappedItem);
    }
    else if (wrappedItem instanceof Track) {
      return Mapper.mapTrack(wrappedItem);
    }
    return null;
  }

  #onGetFeedItemsLoopFetchEnd(result: LoopFetchResult<AlbumEntity | PlaylistEntity | TrackEntity>) {
    const tracks = result.items.filter((item) => item.type === 'track');
    TrackHelper.cacheTracks(tracks, this.getCacheKeyForFetch.bind(this, 'track'));
    return result;
  }
}
