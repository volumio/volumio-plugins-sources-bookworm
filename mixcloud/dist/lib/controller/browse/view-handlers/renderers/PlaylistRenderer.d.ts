import BaseRenderer, { type RenderedHeader, type RenderedListItem } from './BaseRenderer';
import { type PlaylistEntity } from '../../../../entities/PlaylistEntity';
export default class PlaylistRenderer extends BaseRenderer<PlaylistEntity> {
    renderToListItem(playlist: PlaylistEntity): RenderedListItem | null;
    renderToHeader(playlist: PlaylistEntity): RenderedHeader | null;
}
//# sourceMappingURL=PlaylistRenderer.d.ts.map