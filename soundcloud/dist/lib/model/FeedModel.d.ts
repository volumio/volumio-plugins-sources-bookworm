import BaseModel, { type LoopFetchResult } from './BaseModel';
import type PlaylistEntity from '../entities/PlaylistEntity';
import type AlbumEntity from '../entities/AlbumEntity';
import type TrackEntity from '../entities/TrackEntity';
export interface FeedModelGetFeedItemsParams {
    pageToken?: string;
    pageOffset?: number;
    limit?: number;
    activityTypes: ['TrackPost', 'TrackRepost'];
}
export default class FeedModel extends BaseModel {
    #private;
    getFeedItems(params: FeedModelGetFeedItemsParams): Promise<LoopFetchResult<TrackEntity | PlaylistEntity | AlbumEntity>>;
}
//# sourceMappingURL=FeedModel.d.ts.map