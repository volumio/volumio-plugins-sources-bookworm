import sc from '../../../SoundCloudContext';
import type AlbumEntity from '../../../entities/AlbumEntity';
import { ModelType } from '../../../model';
import { type AlbumModelGetAlbumParams } from '../../../model/AlbumModel';
import { type LoopFetchResult } from '../../../model/BaseModel';
import SetViewHandler, { type SetView, type SetViewHandlerGetSetsParams } from './SetViewHandler';
import { type TrackOrigin } from './TrackViewHandler';
import { RendererType } from './renderers';
import type BaseRenderer from './renderers/BaseRenderer';

export interface AlbumView extends SetView {
  name: 'albums';
  albumId?: string;
}

export default class AlbumViewHandler extends SetViewHandler<AlbumView, number, AlbumEntity> {

  protected getSetIdFromView(): number | null | undefined {
    return Number(this.currentView.albumId);
  }

  protected getSet(id: number): Promise<{ set: AlbumEntity; tracksOffset?: number; tracksLimit?: number; }> {
    return this.#getAlbum(id);
  }

  protected getSets(modelParams: SetViewHandlerGetSetsParams): Promise<LoopFetchResult<AlbumEntity>> {
    return this.getModel(ModelType.Album).getAlbums(modelParams);
  }

  protected getSetsListTitle(): string {
    return sc.getI18n('SOUNDCLOUD_LIST_TITLE_ALBUMS');
  }

  protected getSetRenderer(): BaseRenderer<AlbumEntity, AlbumEntity> {
    return this.getRenderer(RendererType.Album);
  }

  protected getVisitLinkTitle(): string {
    return sc.getI18n('SOUNDCLOUD_VISIT_LINK_ALBUM');
  }

  protected getTrackOrigin(set: AlbumEntity): TrackOrigin | null {
    if (set.id) {
      return {
        type: 'album',
        albumId: set.id
      };
    }
    return null;
  }

  async #getAlbum(albumId: number) {
    const { pageRef } = this.currentView;
    const pageToken = pageRef?.pageToken;
    const loadAllTracks = sc.getConfigValue('loadFullPlaylistAlbum');

    const modelParams: AlbumModelGetAlbumParams = { loadTracks: true };
    if (Number(pageToken)) {
      modelParams.tracksOffset = Number(pageToken);
    }
    if (!loadAllTracks) {
      modelParams.tracksLimit = sc.getConfigValue('itemsPerPage');
    }

    const album = await this.getModel(ModelType.Album).getAlbum(albumId, modelParams);

    if (!album) {
      throw Error('Failed to fetch album');
    }

    return {
      set: album,
      tracksOffset: modelParams.tracksOffset,
      tracksLimit: modelParams.tracksLimit
    };
  }
}
