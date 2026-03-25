import BaseViewHandler from './BaseViewHandler';
import type View from './View';
import { type RenderedPage } from './ViewHandler';
export interface SelectionView extends View {
    name: 'selections';
    type: 'mixed' | 'charts';
    selectionId?: string;
}
export default class SelectionViewHandler extends BaseViewHandler<SelectionView> {
    browse(): Promise<RenderedPage>;
}
//# sourceMappingURL=SelectionViewHandler.d.ts.map