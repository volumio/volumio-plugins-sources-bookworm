import BaseRenderer, { type RenderedHeader, type RenderedListItem } from './BaseRenderer';
import { type CloudcastEntity } from '../../../../entities/CloudcastEntity';
export default class CloudcastRenderer extends BaseRenderer<CloudcastEntity> {
    renderToListItem(cloudcast: CloudcastEntity, asType?: 'folder' | 'playShowItem', showMoreFromUser?: boolean): RenderedListItem | null;
    renderToHeader(cloudcast: CloudcastEntity): RenderedHeader | null;
}
//# sourceMappingURL=CloudcastRenderer.d.ts.map