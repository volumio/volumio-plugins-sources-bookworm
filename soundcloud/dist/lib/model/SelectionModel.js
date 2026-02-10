"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SoundCloudContext_1 = __importDefault(require("../SoundCloudContext"));
const BaseModel_1 = __importDefault(require("./BaseModel"));
const Mapper_1 = __importDefault(require("./Mapper"));
class SelectionModel extends BaseModel_1.default {
    async getSelections(params) {
        const api = this.getSoundCloudAPI();
        const collection = await SoundCloudContext_1.default.getCache().getOrSet(this.getCacheKeyForFetch('selections', { ...params }), () => {
            switch (params.type) {
                case 'mixed':
                    return api.getMixedSelections();
                case 'charts':
                    return api.getCharts();
            }
        });
        const mapPromises = collection.items.map((item) => Mapper_1.default.mapSelection(item).catch(() => null));
        const mapped = await Promise.all(mapPromises);
        return mapped.filter((item) => item !== null);
    }
}
exports.default = SelectionModel;
//# sourceMappingURL=SelectionModel.js.map