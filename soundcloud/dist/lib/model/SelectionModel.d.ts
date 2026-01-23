import BaseModel, { type LoopFetchResult } from './BaseModel';
import type SelectionEntity from '../entities/SelectionEntity';
export interface SelectionModelGetSelectionsParams {
    mixed?: boolean;
}
export default class SelectionModel extends BaseModel {
    #private;
    getSelections(options: SelectionModelGetSelectionsParams): LoopFetchResult<SelectionEntity> | Promise<LoopFetchResult<SelectionEntity>>;
}
//# sourceMappingURL=SelectionModel.d.ts.map