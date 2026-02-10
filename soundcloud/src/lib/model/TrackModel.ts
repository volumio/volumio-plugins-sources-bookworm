'use strict';

import { Constants, type Track } from 'soundcloud-fetch';
import BaseModel, { type LoopFetchCallbackParams, type LoopFetchResult } from './BaseModel';
import sc from '../SoundCloudContext';
import type TrackEntity from '../entities/TrackEntity';
import Mapper from './Mapper';
import TrackHelper from '../util/TrackHelper';

export interface TrackModelGetTracksParams {
  search?: string;
  userId?: number;
  topFeatured?: boolean;
  pageToken?: string;
  pageOffset?: number;
  limit?: number;
}

interface GetTracksLoopFetchCallbackParams extends LoopFetchCallbackParams {
  search?: string;
  userId?: number;
  topFeatured?: boolean;
}

export default class TrackModel extends BaseModel {

  getTracks(params: TrackModelGetTracksParams) {
    const getItems = this.commonGetCollectionItemsFromLoopFetchResult<Track>;
    const getNextPageToken = this.commonGetNextPageTokenFromLoopFetchResult<Track>;

    return this.loopFetch({
      callbackParams: { ...params },
      getFetchPromise: this.#getTracksFetchPromise.bind(this),
      getItemsFromFetchResult: getItems.bind(this),
      getNextPageTokenFromFetchResult: getNextPageToken.bind(this),
      convertToEntity: this.#convertFetchedTrackToEntity.bind(this),
      onEnd: this.#onGetTracksLoopFetchEnd.bind(this),
      pageToken: params.pageToken,
      pageOffset: params.pageOffset,
      limit: params.limit
    });
  }

  async #getTracksFetchPromise(params: GetTracksLoopFetchCallbackParams) {
    const api = this.getSoundCloudAPI();

    const continuationContents = await this.commonGetLoopFetchResultByPageToken<Track>(params);
    if (continuationContents) {
      return continuationContents;
    }

    const queryParams: Record<string, any> = {
      limit: Constants.QUERY_MAX_LIMIT
    };
    if (params.search) {
      const q = params.search;
      queryParams.type = 'track';
      const cacheKeyParams = {
        search: q,
        ...queryParams
      };
      return sc.getCache().getOrSet(
        this.getCacheKeyForFetch('tracks', cacheKeyParams),
        () => api.search(q, {...queryParams, type: 'track'})
      );
    }
    else if (params.userId !== undefined) {
      const userId = params.userId;
      const cacheKeyParams = {
        userId,
        ...queryParams
      };
      return sc.getCache().getOrSet(
        this.getCacheKeyForFetch('tracks', cacheKeyParams),
        () => api.getTracksByUser(userId, queryParams)
      );
    }
    else if (params.topFeatured) {
      const cacheKeyParams = {
        topFeatured: true,
        ...queryParams
      };
      return sc.getCache().getOrSet(
        this.getCacheKeyForFetch('tracks', cacheKeyParams),
        async () => {
          const collection = await api.getTopFeaturedTracks(queryParams)
          // This doesn't contain playlist / artist info now.
          // Fetch them again using getTracks().
          const trackIds = collection.items.map((track) => track.id).filter((id) => id !== undefined);
          const fullTracks = await api.getTracks(trackIds);
          collection.items = fullTracks;
          return collection;
        }
      );
    }
    throw Error('Missing or invalid criteria for tracks');
  }

  #convertFetchedTrackToEntity(data: Track) {
    return Mapper.mapTrack(data);
  }

  #onGetTracksLoopFetchEnd(result: LoopFetchResult<TrackEntity>) {
    TrackHelper.cacheTracks(result.items, this.getCacheKeyForFetch.bind(this, 'track'));
    return result;
  }

  getTrack(trackId: number) {
    // Unlike other resources, tracks are mapped to TrackEntity objects before being cached.
    return sc.getCache().getOrSet(
      this.getCacheKeyForFetch('track', { trackId }),
      () => this.#doGetTrack(trackId)
    );
  }

  async #doGetTrack(trackId: number) {
    const trackData = await this.getSoundCloudAPI().getTrack(trackId);
    if (trackData) {
      return Mapper.mapTrack(trackData);
    }
    return null;
  }

  async getStreamingUrl(transcodingUrl: string, trackAuthorization?: string) {
    return (await this.getSoundCloudAPI().getStreamingData({transcodingUrl, trackAuthorization}))?.url;
  }
}
