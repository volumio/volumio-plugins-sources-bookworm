import Innertube, { ClientType } from 'volumio-youtubei.js';
import { type Logger } from 'yt-cast-receiver';
export interface InnertubeLoaderGetInstanceResult {
    innertube: Innertube;
}
export default class InnertubeLoader {
    #private;
    constructor(logger: Logger, clientType?: ClientType);
    getInstance(): Promise<InnertubeLoaderGetInstanceResult>;
    reset(): void;
    hasInstance(): boolean;
    applyI18nConfig(): void;
}
//# sourceMappingURL=InnertubeLoader.d.ts.map