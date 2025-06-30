import BaseRenderer, { type RenderedListItem } from './BaseRenderer';
import { type SlugEntity } from '../../../../entities/SlugEntity';
export default class SlugRenderer extends BaseRenderer<SlugEntity> {
    #private;
    renderToListItem(slug: SlugEntity): RenderedListItem | null;
}
//# sourceMappingURL=SlugRenderer.d.ts.map