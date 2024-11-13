import type TrackEntity from '../../../../entities/TrackEntity';
import { type TrackOrigin } from '../TrackViewHandler';
import BaseRenderer, { type RenderedListItem } from './BaseRenderer';
export default class TrackRenderer extends BaseRenderer<TrackEntity> {
    renderToListItem(data: TrackEntity, origin?: TrackOrigin | null): RenderedListItem | null;
}
//# sourceMappingURL=TrackRenderer.d.ts.map