import { type IParsedResponse } from 'volumio-yt-support/dist/innertube';
export declare abstract class BaseModel {
    protected getInnertube(): Promise<{
        innertube: import("volumio-yt-support/dist/innertube").Innertube;
    }>;
    protected expandSectionList(response: IParsedResponse, url: '/browse' | '/search'): Promise<void>;
}
//# sourceMappingURL=BaseModel.d.ts.map