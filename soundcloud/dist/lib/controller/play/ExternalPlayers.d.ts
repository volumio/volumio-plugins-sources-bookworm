import { MPVService, VLCService } from 'volumio-ext-players';
export type ExternalPlayer = 'vlc' | 'mpv';
export declare class ExternalPlayers {
    #private;
    static get(player: ExternalPlayer): Promise<MPVService | VLCService | null>;
    static stop(player: ExternalPlayer): Promise<void> | undefined;
    static getActive(): MPVService | VLCService | null;
    static quit(player: ExternalPlayer): Promise<void>;
    static quitAll(): Promise<void[]>;
}
//# sourceMappingURL=ExternalPlayers.d.ts.map