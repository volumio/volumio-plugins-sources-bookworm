import BaseModel from './BaseModel';
export interface SelectionModelGetSelectionsParams {
    type: 'mixed' | 'charts';
}
export default class SelectionModel extends BaseModel {
    getSelections(params: SelectionModelGetSelectionsParams): Promise<import("../entities/SelectionEntity").default[]>;
}
//# sourceMappingURL=SelectionModel.d.ts.map