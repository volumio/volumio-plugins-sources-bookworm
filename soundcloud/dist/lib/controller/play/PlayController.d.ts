import { type QueueItem } from '../browse/view-handlers/ExplodableViewHandler';
export default class PlayController {
    #private;
    constructor();
    /**
     * Track uri:
     * soundcloud/track@trackId=...
     */
    clearAddPlayTrack(track: QueueItem): Promise<void>;
    stop(): any;
    pause(): any;
    resume(): any;
    play(): any;
    seek(position: number): any;
    next(): any;
    previous(): any;
    setRandom(value: boolean): void;
    setRepeat(value: boolean, repeatSingle: boolean): any;
    getGotoUri(type: 'album' | 'artist', uri: QueueItem['uri']): Promise<string | null>;
    reset(): Promise<void>;
}
//# sourceMappingURL=PlayController.d.ts.map