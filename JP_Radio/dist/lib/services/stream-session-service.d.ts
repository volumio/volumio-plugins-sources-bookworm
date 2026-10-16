import type { Response } from 'express';
import Radiko from './radiko-service';
import type { TimeFreeQuery } from '../models/time-free-query-model';
import type { LoggerEx } from '../utils/logger';
/**
 * 1回分の再生リクエストに対するffmpegプロセスのライフサイクルを管理する。
 * ライブ配信は、Radiko側のライブHLSプレイリスト更新の都合でffmpegが数十秒おきに正常終了(code=0)
 * してしまうことがあるため、クライアント(MPD)が接続を切っていない限り同じ局へ自動的に繋ぎ直す。
 * タイムフリー(`timeFreeQuery`指定時)は有限のクリップなので、ffmpegが終了したらそこで再生終了とし、
 * ライブのような自動再接続は行わない。
 */
export default class StreamSession {
    #private;
    private readonly rdk;
    private readonly station;
    private readonly logger;
    private readonly onFirstStreamStarted;
    private readonly onStopped;
    private readonly timeFreeQuery?;
    private readonly tempo?;
    private readonly resumeSeek?;
    private stopped;
    private currentFfmpeg;
    private firstAttempt;
    /**
     * @param rdk ストリーム起動に使うModel層。
     * @param station 局ID。
     * @param logger ログ出力先。
     * @param onFirstStreamStarted 最初のffmpegプロセスが起動できた直後に1回だけ呼ばれる。
     * @param onStopped セッションが終了した(クライアント切断/タイムフリー再生終了)時に呼ばれる。
     * @param timeFreeQuery 指定するとタイムフリー再生を、指定しなければライブ再生を行う。
     * @param tempo タイムフリー再生の速度倍率。
     * @param resumeSeek 指定すると、タイムフリー再生をこの実時刻(`'yyyyMMddHHmmss'`)から開始する(途中再開用)。
     */
    constructor(rdk: Radiko, station: string, logger: LoggerEx, onFirstStreamStarted: () => void, onStopped: () => void, timeFreeQuery?: TimeFreeQuery | undefined, tempo?: number | undefined, resumeSeek?: string | undefined);
    /**
     * レスポンスの切断監視を仕込み、最初のffmpegプロセスを起動する。
     * @param res ストリームをパイプする先のレスポンス。
     */
    start(res: Response): void;
}
//# sourceMappingURL=stream-session-service.d.ts.map