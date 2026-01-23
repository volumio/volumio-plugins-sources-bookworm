import BaseModel, { type LoopFetchResult } from './BaseModel';
import type PlaylistEntity from '../entities/PlaylistEntity';
import type AlbumEntity from '../entities/AlbumEntity';
import type TrackEntity from '../entities/TrackEntity';
import { type TrackOrigin } from '../controller/browse/view-handlers/TrackViewHandler';
export interface MeModelGetLikesParams {
    pageToken?: string;
    pageOffset?: number;
    limit?: number;
    type: 'track' | 'playlistAndAlbum';
}
export interface MeModelGetLibraryItemsParams {
    pageToken?: string;
    pageOffset?: number;
    limit?: number;
    type: 'album' | 'playlist' | 'station';
    filter: 'liked' | 'created' | 'all';
}
export default class MeModel extends BaseModel {
    #private;
    getLikes(params: MeModelGetLikesParams & {
        type: 'playlistAndAlbum';
    }): Promise<LoopFetchResult<AlbumEntity | PlaylistEntity>>;
    getLikes(params: MeModelGetLikesParams & {
        type: 'track';
    }): Promise<LoopFetchResult<TrackEntity>>;
    getLibraryItems(params: MeModelGetLibraryItemsParams): Promise<LoopFetchResult<import("../entities/PlaylistEntity").RegularPlaylistEntity | import("../entities/PlaylistEntity").SystemPlaylistEntity | AlbumEntity>>;
    getMyProfile(): Promise<import("../entities/UserEntity").default | null>;
    addToPlayHistory(track: TrackEntity, origin?: TrackOrigin): Promise<void>;
}
//# sourceMappingURL=MeModel.d.ts.map