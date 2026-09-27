import BaseRenderer, {
  type RenderedHeader,
  type RenderedListItem
} from './BaseRenderer';
import type {
  PlaylistEntity,
  PlaylistListItemEntity
} from '../../../../entities/PlaylistEntity';
import ViewHelper from '../ViewHelper';
import bandcamp from '../../../../BandcampContext';
import { type PlaylistView } from '../PlaylistViewHandler';

const DEFAULT_ICON = '/albumart?sourceicon=music_service/mpd/playlisticon.png';

export default class PlaylistRenderer extends BaseRenderer<
  PlaylistListItemEntity | PlaylistEntity
> {
  renderToListItem(data: PlaylistListItemEntity): RenderedListItem | null {
    if (!data.url) {
      return null;
    }
    const playlistView: PlaylistView = {
      name: 'playlist',
      playlistUrl: data.url
    };
    return {
      service: 'bandcamp',
      type: 'folder',
      title: data.title,
      artist: data.modifiedDate,
      album: this.#getSummary(data),
      albumart: data.imageUrl || DEFAULT_ICON,
      uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(playlistView)}`
    };
  }

  renderToHeader(data: PlaylistEntity): RenderedHeader | null {
    return {
      uri: this.uri,
      service: 'bandcamp',
      type: 'song',
      title: data.title,
      genre: bandcamp.getI18n('BANDCAMP_N_TRACKS', data.numTracks),
      artist: data.description,
      albumart: data.imageUrl || DEFAULT_ICON,
      year: data.modifiedDate,
      duration: this.#durationFormat(data.duration)
    };
  }

  #getSummary(data: { numTracks: number; duration: number }) {
    const duration = this.#durationFormat(data.duration);
    return duration ?
        bandcamp.getI18n('BANDCAMP_N_TRACKS_DURATION', data.numTracks, duration)
      : bandcamp.getI18n('BANDCAMP_N_TRACKS', data.numTracks);
  }

  #durationFormat(duration: number | null): string | null {
    if (duration) {
      // Hours, minutes and seconds
      const hrs = ~~(duration / 3600);
      const mins = ~~((duration % 3600) / 60);
      const secs = ~~duration % 60;
      if (hrs === 0 && mins === 0 && secs === 0) {
        return null;
      }
      if (hrs === 0 && mins === 0 && secs > 0) {
        return bandcamp.getI18n('BANDCAMP_N_SECONDS', secs);
      }
      if (hrs === 0 && mins > 0) {
        return bandcamp.getI18n('BANDCAMP_N_MINUTES', mins);
      }
      if (hrs > 0 && mins === 0) {
        return bandcamp.getI18n('BANDCAMP_N_HOURS', hrs);
      }
      return bandcamp.getI18n('BANDCAMP_N_HOURS_MINS', hrs, mins);
    }
    return null;
  }
}
