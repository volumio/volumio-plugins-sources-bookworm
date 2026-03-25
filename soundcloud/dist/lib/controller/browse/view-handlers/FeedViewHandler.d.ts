import BaseViewHandler from './BaseViewHandler';
import type View from './View';
export interface FeedView extends View {
    name: 'feed';
}
export default class FeedViewHandler extends BaseViewHandler<FeedView> {
    #private;
    browse(): Promise<import("./ViewHandler").RenderedPage>;
}
//# sourceMappingURL=FeedViewHandler.d.ts.map