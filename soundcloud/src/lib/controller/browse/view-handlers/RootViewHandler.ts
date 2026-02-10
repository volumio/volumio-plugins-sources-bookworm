import sc from '../../../SoundCloudContext';
import type SelectionEntity from '../../../entities/SelectionEntity';
import { ModelType } from '../../../model';
import BaseViewHandler from './BaseViewHandler';
import { type FeedView } from './FeedViewHandler';
import { type HistoryView } from './HistoryViewHandler';
import { type LibraryView } from './LibraryViewHandler';
import { type SelectionView } from './SelectionViewHandler';
import { type TrackView } from './TrackViewHandler';
import { type UserView } from './UserViewHandler';
import type View from './View';
import { type RenderedList, type RenderedPage } from './ViewHandler';
import ViewHandlerFactory from './ViewHandlerFactory';
import ViewHelper from './ViewHelper';
import { RendererType } from './renderers';
import { type RenderedListItem } from './renderers/BaseRenderer';

export type RootView = View;

export default class RootViewHandler extends BaseViewHandler<RootView> {

  async browse(): Promise<RenderedPage> {
    const fetches = [
      this.#getMe(),
      this.#getTopFeaturedTracks(),
      this.#getSelections('mixed'),
      this.#getSelections('charts')
    ];

    const fetchResults = await Promise.all(fetches);
    const lists = fetchResults.reduce<RenderedList[]>((result, list) => {
      result.push(...list);
      return result;
    }, []);

    return {
      navigation: {
        prev: { uri: '/' },
        lists
      }
    };
  }

  async #getMe(): Promise<RenderedList[]> {
    let myProfile;
    try {
      myProfile = await this.getModel(ModelType.Me).getMyProfile();
    }
    catch (error: any) {
      sc.toast('error', sc.getErrorMessage('', error, false));
      return [];
    }
    if (myProfile?.id) {
      const historyView: HistoryView = {
        name: 'history'
      };
      const historyItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_HISTORY'),
        icon: 'fa fa-history',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(historyView)}`
      };

      const trackView: TrackView = {
        name: 'track',
        myLikes: '1'
      };
      const likesItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_LIKES'),
        icon: 'fa fa-heart',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(trackView)}`
      };

      const libraryView: LibraryView = {
        name: 'library',
        type: 'playlist'
      };
      const libraryPlaylistsItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_PLAYLISTS'),
        icon: 'fa fa-list',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(libraryView)}`
      };
      libraryView.type = 'album';
      const libraryAlbumsItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_ALBUMS'),
        icon: 'fa fa-music',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(libraryView)}`
      };
      libraryView.type = 'station';
      const libraryStationsItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_STATIONS'),
        icon: 'fa fa-microphone',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(libraryView)}`
      };

      const userView: UserView = {
        name: 'users',
        myFollowing: '1'
      };
      const followingItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_FOLLOWING'),
        icon: 'fa fa-users',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(userView)}`
      };

      const feedView: FeedView = {
        name: 'feed'
      };
      const feedItem: RenderedListItem = {
        service: 'soundcloud',
        type: 'item-no-menu',
        title: sc.getI18n('SOUNDCLOUD_FEED'),
        icon: 'fa fa-feed',
        uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(feedView)}`
      };

      const meName = myProfile.firstName || myProfile.lastName || myProfile.username;
      const list: RenderedList = {
        title: sc.getI18n('SOUNDCLOUD_LIST_TITLE_WELCOME', meName),
        items: [ historyItem, likesItem, libraryPlaylistsItem, libraryAlbumsItem, libraryStationsItem, followingItem, feedItem ],
        availableListViews: [ 'grid', 'list' ]
      };

      if (ViewHelper.supportsEnhancedTitles()) {
        list.title = `
          <div style="display: flex; flex-direction: column; height: 48px; padding: 1px 0;">
            <div style="flex-grow: 1;">${list.title}</div>
            <div><a target="_blank" style="color: #50b37d; font-size: 14px;" href="https://soundcloud.com/${myProfile.username}">${sc.getI18n('SOUNDCLOUD_VIEW_MY_PAGE')}</a></div>
          </div>`;

        if (myProfile.thumbnail) {
          list.title = `<img src="${myProfile.thumbnail}" style="border-radius: 50%; width: 48px; height: 48px; margin-right: 12px;" /> ${list.title}`;
        }

        list.title = `
          <div style="width: 100%; padding-bottom: 12px; border-bottom: 1px solid; display: flex; align-items: center;">
              ${list.title}
          </div>
        `;
      }

      return [ list ];
    }
    return [];
  }

  async #getTopFeaturedTracks(): Promise<RenderedList[]> {
    try {
      const trackView: TrackView = {
        name: 'tracks',
        topFeatured: '1',
        inSection: '1',
        title: sc.getI18n('SOUNDCLOUD_LIST_TITLE_TOP_FEATURED_TRACKS')
      };
      const tracksUri = `${this.uri}/${ViewHelper.constructUriSegmentFromView(trackView, true)}`;
      const page = await ViewHandlerFactory.getHandler(tracksUri).browse();
      const list = page.navigation?.lists?.[0];
      if (list && list.items.length > 0) {
        if (ViewHelper.supportsEnhancedTitles()) {
          list.title = `
          <div style="width: 100%;">
              <div style="padding-bottom: 8px; border-bottom: 1px solid;">
                  ${list.title}
              </div>
          </div>`;
        }
        return [ list ];
      }
      return [];
    }
    catch (error: any) {
      sc.getLogger().error(sc.getErrorMessage('[soundcloud] Failed to get top featured tracks in root view:', error, true));
      return [];
    }
  }

  async #getSelections(type: 'mixed' | 'charts'): Promise<RenderedList[]> {
    try {
      const selections = await this.getModel(ModelType.Selection).getSelections({ type });
      const lists = selections.reduce<RenderedList[]>((result, selection) => {
        if (selection.items.length > 0) {
          result.push(this.#getListFromSelection(type, selection));
        }
        return result;
      }, []);
      return lists;
    }
    catch (error: any) {
      sc.getLogger().error(sc.getErrorMessage('[soundcloud] Failed to get selections in root view:', error, true));
      return [];
    }
  }

  #getListFromSelection(type: 'mixed' | 'charts', selection: SelectionEntity): RenderedList {
    const limit = sc.getConfigValue('itemsPerSection');
    const slice = selection.items.slice(0, limit);
    const renderer = this.getRenderer(RendererType.Playlist);
    const listItems = slice.reduce<RenderedListItem[]>((result, item) => {
      const rendered = renderer.renderToListItem(item);
      if (rendered) {
        result.push(rendered);
      }
      return result;
    }, []);
    if (selection.id && limit < selection.items.length) {
      const nextPageRef = this.constructPageRef(limit.toString(), 0);
      if (nextPageRef) {
        const selectionView: SelectionView = {
          name: 'selections',
          type,
          selectionId: selection.id,
          pageRef: nextPageRef
        };
        const nextUri = `${this.uri}/${ViewHelper.constructUriSegmentFromView(selectionView)}`;
        listItems.push(this.constructNextPageItem(nextUri));
      }
    }
    let listTitle;
    if (selection.title) {
      if (!ViewHelper.supportsEnhancedTitles()) {
        listTitle = selection.title;
      }
      else {
        listTitle = `<span style="font-size: 16px; color: #bdbdbd;">${selection.title}</span>`;
      }
    }
    return {
      title: listTitle,
      availableListViews: [ 'list', 'grid' ],
      items: listItems
    };
  }
}
