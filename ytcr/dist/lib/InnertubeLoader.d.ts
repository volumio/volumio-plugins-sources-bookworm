import type Logger from './Logger.js';
import { type InnertubeWrapper, type PotFnResult } from 'volumio-yt-support';
export default class InnertubeLoader {
    #private;
    static setLogger(logger: Logger): void;
    static getInstance(): Promise<InnertubeWrapper>;
    static generatePoToken(identifier: string): Promise<PotFnResult>;
    static reset(): Promise<void>;
    static applyI18nConfig(): Promise<void>;
}
//# sourceMappingURL=InnertubeLoader.d.ts.map