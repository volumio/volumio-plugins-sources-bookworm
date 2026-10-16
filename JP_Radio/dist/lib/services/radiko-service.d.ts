/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { ChildProcess } from 'child_process';
import type { StationInfo, RegionData } from '../models/station-model';
import type { LoginAccount } from '../models/auth-model';
import type { TimeFreeQuery } from '../models/time-free-query-model';
import type { LoggerEx } from '../utils/logger';
/**
 * Radiko APIとのやり取りを担うModel層。
 * 認証(auth1/auth2)・局一覧取得・ライブ配信プレイリスト解決・ffmpegによるストリーム起動を提供する。
 */
export default class Radiko {
    #private;
    private logger;
    private port;
    private token;
    private areaId;
    private cookieJar;
    private loginState;
    stations: Map<string, StationInfo>;
    stationData: RegionData[];
    areaData: Map<string, {
        areaName: string;
        stations: string[];
    }>;
    /**
     * @param logger ログ出力先。
     * @param port medialist-proxyへの中継URL生成に使う自身のリッスンポート番号。
     */
    constructor(logger: LoggerEx, port: number);
    /**
     * プレミアム会員としてのログイン(指定時)と、エリア判定トークンの取得・局一覧の取得を行う。
     * @param acct 指定するとRadikoプレミアム会員としてログインを試みる。
     * @param forceGetStations trueの場合、エリアIDが既に取得済みでも局一覧を再取得する。
     */
    init(acct?: LoginAccount | null, forceGetStations?: boolean): Promise<void>;
    /**
     * 自身のエリアID(例: `JP13`)と会員種別(`AreaFree`など)を`/`区切りで返す。
     */
    getMyAreaId(): Promise<string>;
    /**
     * メールアドレス/パスワードでRadikoにログインし、認証済みCookieJarを返す。
     * @param acct ログインに使うアカウント情報。
     */
    private login;
    /**
     * 現在のCookieJarでログイン状態(会員種別)を確認する。未ログイン/失敗時はnullを返す。
     */
    private checkLogin;
    /**
     * auth1/auth2の一連の認証フローを実行し、`[token, areaId]`を返す。
     */
    private getToken;
    /**
     * 認証第1段階。レスポンスヘッダーにトークンとパーシャルキー算出用のオフセット/長さが含まれる。
     */
    private auth1;
    /**
     * auth1のレスポンスヘッダーから、auth2に必要なパーシャルキー(base64)とトークンを算出する。
     * @param headers auth1のレスポンスヘッダー。
     * @returns `[partialKey, token]`。
     */
    private getPartialKey;
    /**
     * 認証第2段階。成功するとレスポンスボディに`areaId,areaName,...`形式の文字列が返る。
     * @param token auth1で取得したトークン。
     * @param partialKey {@link getPartialKey}で算出したパーシャルキー。
     */
    private auth2;
    /**
     * 全国局データ(`STATION_FULL_URL`)と全47エリアの局リスト(`STATION_AREA_URL`)を取得・突合し、
     * ログイン中またはエリア内から視聴可能な局のみを{@link Radiko.stations}へ格納する。
     */
    private getStations;
    /**
     * 局IDから表示用の局名(日本語)を取得する。
     * @param stationId 局ID。
     */
    getStationName(stationId: string): Promise<string>;
    /**
     * 局IDからアスキー名(英語表記)を取得する。
     * @param stationId 局ID。
     */
    getStationAsciiName(stationId: string): Promise<string>;
    /**
     * 指定局のライブストリームURLを解決し、ffmpegでAAC(ADTS)に変換しながらstdoutへ流すプロセスを起動する。
     * トークン取得・プレイリスト解決に失敗した場合は`MAX_RETRY_COUNT`回までトークンを取り直して再試行する。
     * @param station 局ID。
     * @returns 起動したffmpegの{@link ChildProcess}。局が存在しない/解決失敗の場合はnull。
     * @param timeFreeQuery 指定するとタイムフリー再生(過去の番組)を、指定しなければライブ再生を行う。
     * @param tempo タイムフリー再生の速度倍率(`1`以外を指定すると`atempo`フィルタを適用する)。ライブ再生には適用しない。
     * @param resumeSeek 指定すると、タイムフリー再生をこの実時刻(`'yyyyMMddHHmmss'`)から開始する(途中再開用)。
     */
    play(station: string, timeFreeQuery?: TimeFreeQuery, tempo?: number, resumeSeek?: string): Promise<ChildProcess | null>;
    /**
     * ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がないため、
     * ローカルプロキシ経由でこのメソッドを都度呼び出し、正しいRadikoヘッダーを付けて中継する。
     * @param upstreamUrl 中継先のRadiko側プレイリストURL。
     * @param token 付与する`X-Radiko-AuthToken`。
     */
    fetchMedialist(upstreamUrl: string, token: string): Promise<{
        contentType: string;
        body: Buffer;
    }>;
    /**
     * 局ごとのstream XML(`STATION_STREAM_XML_URL`)からライブ配信用`playlist_create_url`を選び、lsidを付与したURLを組み立てる。
     * @param station 局ID。
     */
    private getLivePlaylistUrl;
    /**
     * 局ごとのstream XML(`STATION_STREAM_XML_URL`)からタイムフリー配信用`playlist_create_url`を選び、
     * lsidと再生区間(`start_at`/`ft`/`end_at`/`to`)を付与したURLを組み立てる。
     * Radiko APIには実時刻表記が必要なため、ラジオ時間(24-29時表記)は{@link revCnvRadioTime}で実時刻に戻す。
     * @param station 局ID。
     * @param query 番組の放送区間。
     * @param resumeSeek 指定すると、Radiko側のタイムフリー再生をこの実時刻(`'yyyyMMddHHmmss'`)から開始する`seek`パラメータを付与する。
     */
    private getTimeFreePlaylistUrl;
    /**
     * マスタープレイリスト(m3u8)を取得し、ffmpegに渡すメディアプレイリストURIを1行目から抽出する。
     * @param url マスタープレイリストのURL。
     * @param token 付与する`X-Radiko-AuthToken`。
     */
    private genTempChunkM3u8URL;
}
//# sourceMappingURL=radiko-service.d.ts.map