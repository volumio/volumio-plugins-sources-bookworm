import type AlbumEntity from '../../../entities/AlbumEntity';
import { type LoopFetchResult } from '../../../model/BaseModel';
import SetViewHandler, { type SetView, type SetViewHandlerGetSetsParams } from './SetViewHandler';
import { type TrackOrigin } from './TrackViewHandler';
import type BaseRenderer from './renderers/BaseRenderer';
export interface AlbumView extends SetView {
    name: 'albums';
    albumId?: string;
}
export default class AlbumViewHandler extends SetViewHandler<AlbumView, number, AlbumEntity> {
    #private;
    protected getSetIdFromView(): number | null | undefined;
    protected getSet(id: number): Promise<{
        set: AlbumEntity;
        tracksOffset?: number;
        tracksLimit?: number;
    }>;
    protected getSets(modelParams: SetViewHandlerGetSetsParams): Promise<LoopFetchResult<AlbumEntity>>;
    protected getSetsListTitle(): string;
    protected getSetRenderer(): BaseRenderer<AlbumEntity, AlbumEntity>;
    protected getVisitLinkTitle(): string;
    protected getTrackOrigin(set: AlbumEntity): TrackOrigin | null;
}
//# sourceMappingURL=AlbumViewHandler.d.ts.map