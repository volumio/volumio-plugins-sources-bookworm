import BaseRenderer, {
  type RenderedHeader,
  type RenderedListItem
} from './BaseRenderer';
import UIHelper from '../../../../util/UIHelper';
import type TrackEntity from '../../../../entities/TrackEntity';
import { type TrackView } from '../TrackViewHandler';
import ViewHelper from '../ViewHelper';

export interface TrackRenderOptions {
  addType?: boolean;
  fakeAlbum?: boolean;
  addNonPlayableText?: boolean;
}

export default class TrackRenderer extends BaseRenderer<TrackEntity> {
  renderToListItem(
    data: TrackEntity,
    opts?: TrackRenderOptions
  ): RenderedListItem | null {
    const {
      addType = false,
      fakeAlbum = false,
      addNonPlayableText = true
    } = opts || {};
    if (!data.url) {
      return null;
    }

    const common = {
      title: addType ? this.addType('track', data.name) : data.name,
      artist: data.artist?.name,
      album: data.album?.name,
      albumart: data.thumbnail
    };

    const trackView: TrackView = {
      name: 'track',
      trackUrl: data.url,
      explode: {
        ...common,
        uri: ViewHelper.constructUriFromViews([
          {
            name: 'root'
          },
          {
            name: 'track',
            trackUrl: data.url,
            albumUrl: data.album?.url,
            artistUrl: data.artist?.url
          } satisfies TrackView
        ])
      }
    };

    const result: RenderedListItem = {
      service: 'bandcamp',
      type: fakeAlbum ? 'folder' : 'song',
      ...common,
      uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(trackView)}`
    };

    if (!fakeAlbum) {
      result.duration = data.duration;
    }
    if (!data.streamUrl && addNonPlayableText) {
      result.title = UIHelper.addNonPlayableText(result.title);
    }

    return result;
  }

  renderToHeader(data: TrackEntity): RenderedHeader | null {
    return {
      service: 'bandcamp',
      uri: this.uri,
      type: 'song',
      album: data.name,
      artist: data.artist?.name,
      albumart: data.thumbnail
    };
  }
}
