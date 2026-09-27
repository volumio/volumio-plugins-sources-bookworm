import bandcamp from '../../../BandcampContext';
import { ModelType } from '../../../model';
import type View from './View';
import { type RenderedList, type RenderedPage } from './ViewHandler';
import { RendererType } from './renderers';
import { type RenderedListItem } from './renderers/BaseRenderer';
import ExplodableViewHandler from './ExplodableViewHandler';
import { type PlaylistModelGetPlaylistsParams } from '../../../model/PlaylistModel';

export interface PlaylistView extends View {
  name: 'playlist';
  username?: string;
  playlistUrl?: string;
}

export default class PlaylistViewHandler extends ExplodableViewHandler<PlaylistView> {
  browse(): Promise<RenderedPage> {
    const view = this.currentView;
    if (view.playlistUrl) {
      return this.#browsePlaylist(view.playlistUrl);
    }

    return this.#browseList();
  }

  async #browseList(): Promise<RenderedPage> {
    const lists: RenderedList[] = [];
    const playlistList = await this.#getPlaylistList();
    lists.push(playlistList);

    return {
      navigation: {
        prev: { uri: this.constructPrevUri() },
        lists
      }
    };
  }

  async #getPlaylistList(): Promise<RenderedList> {
    const view = this.currentView;
    const fanModel = this.getModel(ModelType.Fan);
    let me;
    try {
      const meType = bandcamp.getConfigValue<'cookie' | 'username'>(
        'myBandcampType',
        'cookie'
      );
      const myCookie = bandcamp.getConfigValue('myCookie', '');
      const myUsername = bandcamp.getConfigValue('myUsername', '');
      if (meType === 'cookie' && myCookie) {
        me = await fanModel.getInfo();
      } else if (meType === 'username' && myUsername) {
        me = await fanModel.getInfo(myUsername);
      } else {
        me = null;
      }
    } catch (_) {
      me = null;
    }
    const username = view.username;
    const fanInfo = username ? await fanModel.getInfo(username) : null;
    const fanId = fanInfo?.fanId ?? me?.fanId;
    if (!fanId) {
      throw Error('Invalid request: no user specified or found');
    }
    let title;
    if (me && me.fanId === fanId) {
      title = bandcamp.getI18n('BANDCAMP_MY_PLAYLISTS');
    } else if (fanInfo?.name || fanInfo?.username) {
      title = bandcamp.getI18n(
        'BANDCAMP_USER_PLAYLISTS',
        fanInfo.name || fanInfo.username
      );
    } else {
      title = undefined;
    }
    const modelParams: PlaylistModelGetPlaylistsParams = {
      fanId,
      limit:
        view.inSection ?
          bandcamp.getConfigValue('itemsPerSection', 5)
        : bandcamp.getConfigValue('itemsPerPage', 47)
    };

    if (view.pageRef) {
      modelParams.pageToken = view.pageRef.pageToken;
      modelParams.pageOffset = view.pageRef.pageOffset;
    }

    const playlistList = await this.getModel(ModelType.Playlist).getPlaylists(
      modelParams
    );
    const playlistRenderer = this.getRenderer(RendererType.Playlist);
    const listItems = playlistList.items.reduce<RenderedListItem[]>(
      (result, playlist) => {
        const rendered = playlistRenderer.renderToListItem(playlist);
        if (rendered) {
          result.push(rendered);
        }
        return result;
      },
      []
    );
    const nextPageRef = this.constructPageRef(
      playlistList.nextPageToken,
      playlistList.nextPageOffset
    );
    if (nextPageRef) {
      const nextUri = this.constructNextUri(nextPageRef);
      listItems.push(this.constructNextPageItem(nextUri));
    }

    return {
      title,
      availableListViews: ['list', 'grid'],
      items: listItems
    };
  }

  async #browsePlaylist(playlistUrl: string) {
    const playlist = await this.getModel(ModelType.Playlist).getPlaylist(
      playlistUrl
    );
    const playlistRenderer = this.getRenderer(RendererType.Playlist);
    const trackRenderer = this.getRenderer(RendererType.Track);
    const trackItems = playlist.tracks?.reduce<RenderedListItem[]>(
      (result, track) => {
        const parsed = trackRenderer.renderToListItem(track);
        if (parsed) {
          result.push(parsed);
        }
        return result;
      },
      []
    );

    const header = playlistRenderer.renderToHeader(playlist);

    const page: RenderedPage = {
      navigation: {
        prev: { uri: this.constructPrevUri() },
        info: header,
        lists: [
          {
            availableListViews: ['list'],
            items: trackItems || []
          }
        ]
      }
    };

    return page;
  }

  async getTracksOnExplode() {
    const playlistUrl = this.currentView.playlistUrl;

    if (!playlistUrl) {
      throw Error('No playlistUrl specified');
    }

    const model = this.getModel(ModelType.Playlist);
    const playlistInfo = await model.getPlaylist(playlistUrl);
    const playlistTracks = playlistInfo.tracks;
    return playlistTracks || [];
  }
}
