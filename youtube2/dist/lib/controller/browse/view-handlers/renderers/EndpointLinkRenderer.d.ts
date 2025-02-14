import { type ContentItem } from '../../../../types';
import BaseRenderer, { type RenderedListItem } from './BaseRenderer';
export default class EndpointLinkRenderer extends BaseRenderer<ContentItem.EndpointLink | ContentItem.GuideEntry> {
    #private;
    renderToListItem(data: ContentItem.EndpointLink | ContentItem.GuideEntry): RenderedListItem | null;
}
//# sourceMappingURL=EndpointLinkRenderer.d.ts.map