import BaseViewHandler from './BaseViewHandler';
import type View from './View';
import UIHelper from '../../../util/UIHelper';
import type TrackEntity from '../../../entities/TrackEntity';
import ViewHelper from './ViewHelper';
import { RendererType } from './renderers';

export interface QueueItem {
  service: 'bandcamp';
  uri: string;
  albumart?: string;
  artist?: string;
  album?: string;
  name: string;
  title: string;
  duration?: number;
  samplerate?: string;
}

export interface UriEmbeddedQueueItem {
  uri: string;
  title: string;
  artist?: string;
  album?: string;
  albumart?: string;
}

export default abstract class ExplodableViewHandler<
  V extends View,
  E extends TrackEntity = TrackEntity
> extends BaseViewHandler<V> {
  async explode(): Promise<QueueItem[]> {
    const view = this.currentView;
    if (view.noExplode) {
      return [];
    }

    if (view.explode) {
      const qi = view.explode;
      return [
        {
          service: 'bandcamp',
          uri: ViewHelper.setUriEmbeddedQueueItem(qi.uri, qi),
          albumart: qi.albumart,
          artist: qi.artist,
          album: qi.album,
          name: qi.title,
          title: qi.title
        }
      ];
    }

    const tracks = await this.getTracksOnExplode();
    if (!Array.isArray(tracks)) {
      const trackInfo = await this.parseTrackForExplode(tracks);
      return trackInfo ? [trackInfo] : [];
    }

    const trackInfoPromises = tracks.map((track) =>
      this.parseTrackForExplode(track)
    );
    return (await Promise.all(trackInfoPromises)).filter(
      (song) => song
    ) as QueueItem[];
  }

  protected parseTrackForExplode(track: E): Promise<QueueItem | null> {
    const trackUri = this.getTrackUri(track);
    if (!trackUri) {
      return Promise.resolve(null);
    }
    const trackName =
      track.streamUrl ? track.name : UIHelper.addNonPlayableText(track.name);
    return Promise.resolve({
      service: 'bandcamp',
      uri: trackUri,
      albumart: track.thumbnail,
      artist: track.artist?.name,
      album: track.album?.name,
      name: trackName,
      title: trackName,
      duration: track.duration
    });
  }

  protected abstract getTracksOnExplode(): Promise<E | E[]>;

  /**
   * Track uri:
   * bandcamp/track@trackUrl={trackUrl}@artistUrl={...}@albumUrl={...}@explode={...}
   */
  protected getTrackUri(track: E): string | null {
    const trackRenderer = this.getRenderer(RendererType.Track);
    const listItemUri = trackRenderer.renderToListItem(track)?.uri ?? null;
    if (!listItemUri) {
      return null;
    }
    // We expect an 'explode' param in listItemUri. That would be the
    // URI of the queue item.
    const trackView = ViewHelper.getViewsFromUri(listItemUri).pop();
    if (trackView?.name !== 'track' || !trackView.explode) {
      return null;
    }
    const qi = trackView.explode;
    return ViewHelper.setUriEmbeddedQueueItem(qi.uri, qi);
  }
}
