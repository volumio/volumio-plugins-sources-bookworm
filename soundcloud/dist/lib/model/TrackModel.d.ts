import BaseModel, { type LoopFetchResult } from './BaseModel';
import type TrackEntity from '../entities/TrackEntity';
export interface TrackModelGetTracksParams {
    search?: string;
    userId?: number;
    topFeatured?: boolean;
    pageToken?: string;
    pageOffset?: number;
    limit?: number;
}
export default class TrackModel extends BaseModel {
    #private;
    getTracks(params: TrackModelGetTracksParams): Promise<LoopFetchResult<TrackEntity>>;
    getTrack(trackId: number): Promise<TrackEntity | null>;
    getStreamingUrl(transcodingUrl: string, trackAuthorization?: string): Promise<string | undefined>;
}
//# sourceMappingURL=TrackModel.d.ts.map