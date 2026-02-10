import sc from '../../../SoundCloudContext';
import type AlbumEntity from '../../../entities/AlbumEntity';
import type PlaylistEntity from '../../../entities/PlaylistEntity';
import type TrackEntity from '../../../entities/TrackEntity';
import { ModelType } from '../../../model';
import { type FeedModelGetFeedItemsParams } from '../../../model/FeedModel';
import BaseViewHandler from './BaseViewHandler';
import type View from './View';
import { RendererType } from './renderers';

export interface FeedView extends View {
  name: 'feed';
}

export default class FeedViewHandler extends BaseViewHandler<FeedView> {

  async browse() {
    const { pageRef } = this.currentView;
    const pageToken = pageRef?.pageToken;
    const pageOffset = pageRef?.pageOffset;
    const modelParams: FeedModelGetFeedItemsParams = { activityTypes: ['TrackPost', 'TrackRepost'] };

    if (pageToken) {
      modelParams.pageToken = pageRef.pageToken;
    }
    if (pageOffset) {
      modelParams.pageOffset = pageRef.pageOffset;
    }
    modelParams.limit = sc.getConfigValue('itemsPerPage');

    const items = await this.getModel(ModelType.Feed).getFeedItems(modelParams);
    const page = this.buildPageFromLoopFetchResult(items, {
      getRenderer: this.#getRenderer.bind(this),
      title: sc.getI18n('SOUNDCLOUD_LIST_TITLE_FEED')
    });

    return page;
  }

  #getRenderer(item: AlbumEntity | PlaylistEntity | TrackEntity) {
    if (item.type === 'album') {
      return this.getRenderer(RendererType.Album);
    }
    else if (item.type === 'playlist' || item.type === 'system-playlist') {
      return this.getRenderer(RendererType.Playlist);
    }
    else if (item.type === 'track') {
      return this.getRenderer(RendererType.Track);
    }
    return null;
  }
}
