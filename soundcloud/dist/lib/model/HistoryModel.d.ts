import BaseModel, { type LoopFetchResult } from './BaseModel';
import type TrackEntity from '../entities/TrackEntity';
import type PlaylistEntity from '../entities/PlaylistEntity';
import type AlbumEntity from '../entities/AlbumEntity';
export interface HistoryModelGetPlayHistoryItemsParams {
    pageToken?: string;
    pageOffset?: number;
    limit?: number;
    type: 'set' | 'track';
}
export default class HistoryModel extends BaseModel {
    #private;
    getPlayHistory(params: HistoryModelGetPlayHistoryItemsParams): Promise<LoopFetchResult<TrackEntity | PlaylistEntity | AlbumEntity>>;
}
//# sourceMappingURL=HistoryModel.d.ts.map