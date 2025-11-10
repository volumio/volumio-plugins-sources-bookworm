"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseModel = void 0;
const innertube_1 = require("volumio-yt-support/dist/innertube");
const InnertubeLoader_1 = __importDefault(require("./InnertubeLoader"));
const MAX_APPEND_SECTIONS_COUNT = 10;
class BaseModel {
    async getInnertube() {
        return {
            innertube: await (await InnertubeLoader_1.default.getInstance()).getInnertube()
        };
    }
    async expandSectionList(response, url) {
        const { innertube } = await this.getInnertube();
        const sectionLists = response.contents_memo?.getType(innertube_1.YTNodes.SectionList) || [];
        for (const sectionList of sectionLists) {
            let sectionListContinuation = sectionList.continuation;
            if (sectionList.continuation_type !== 'next') {
                sectionListContinuation = undefined;
            }
            let appendCount = 0;
            while (sectionListContinuation && appendCount < MAX_APPEND_SECTIONS_COUNT) {
                const response = await innertube.actions.execute(url, { token: sectionListContinuation, client: 'YTMUSIC' });
                const page = innertube_1.Parser.parseResponse(response.data);
                const cc = page.continuation_contents?.firstOfType(innertube_1.SectionListContinuation);
                if (cc && cc.contents) {
                    sectionList.contents.push(...cc.contents);
                    sectionListContinuation = cc.continuation;
                    appendCount++;
                }
                else {
                    break;
                }
            }
            delete sectionList.continuation;
        }
    }
}
exports.BaseModel = BaseModel;
//# sourceMappingURL=BaseModel.js.map