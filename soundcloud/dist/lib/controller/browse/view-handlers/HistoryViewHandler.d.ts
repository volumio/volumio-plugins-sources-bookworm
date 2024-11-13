import BaseViewHandler from './BaseViewHandler';
import type View from './View';
import { type RenderedPage } from './ViewHandler';
export interface HistoryView extends View {
    name: 'history';
    type?: 'set' | 'track';
}
export default class HistoryViewHandler extends BaseViewHandler<HistoryView> {
    #private;
    browse(): Promise<RenderedPage>;
}
//# sourceMappingURL=HistoryViewHandler.d.ts.map