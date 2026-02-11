import { type Video } from 'yt-cast-receiver';
import type Logger from './Logger.js';
interface BasicInfo {
    id: string;
    src?: 'yt' | 'ytmusic';
    title?: string;
    channel?: string;
    artist?: string;
    album?: string;
    isLive?: boolean;
}
export interface VideoInfo extends BasicInfo {
    errMsg?: string;
    thumbnail?: string;
    isLive?: boolean;
    streamUrl?: string | null;
    duration?: number;
    bitrate?: string;
    samplerate?: number;
    channels?: number;
    streamExpires?: Date;
}
export default class VideoLoader {
    #private;
    constructor(logger: Logger);
    refreshI18nConfig(): Promise<void>;
    getInfo(video: Video, abortSignal: AbortSignal): Promise<VideoInfo>;
}
export {};
//# sourceMappingURL=VideoLoader.d.ts.map