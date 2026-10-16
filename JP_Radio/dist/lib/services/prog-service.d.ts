import type { RadikoProgramData } from '../models/radiko-program-model';
import type { StationInfo } from '../models/station-model';
import type { LoggerEx } from '../utils/logger';
/**
 * 番組表データを管理するModel層。取得したXMLをパースし、nedbのインメモリDBに保存・検索する。
 * 現在放送中の番組を高速に引けるよう、直近の検索結果を`cachedProgram`にキャッシュする。
 */
export default class RdkProg {
    private readonly logger;
    private readonly db;
    private readonly xmlParser;
    private lastStation;
    private lastTime;
    private cachedProgram;
    /**
     * @param logger ログ出力先。
     */
    constructor(logger: LoggerEx);
    /**
     * 指定局の現在放送中の番組を返す。直前と同じ局・同じ分であればキャッシュを返す。
     * @param station 局ID。
     */
    getCurProgram(station: string): Promise<RadikoProgramData | undefined>;
    /**
     * 指定局・指定放送開始時刻(`ft`)に一致する番組をDBから検索する。
     * タイムフリー再生時に、URIで指定された`ft`から番組のタイトル等を引くために使う。
     * @param station 局ID。
     * @param ft 放送開始時刻(ラジオ時間、`'yyyyMMddHHmmss'`)。
     */
    findProgram(station: string, ft: string): Promise<RadikoProgramData | undefined>;
    /**
     * 番組データを1件DBへ挿入する。重複挿入(`uniqueViolated`)はエラーログを出さず無視する。
     * @param prog 挿入する番組データ。
     */
    putProgram(prog: RadikoProgramData): Promise<void>;
    /**
     * 終了時刻が現在時刻より前の古い番組データをDBから削除する。
     */
    clearOldProgram(): Promise<void>;
    /**
     * 指定エリア群の番組表XML(`PROG_DATE_AREA_URL`)を並列(最大5並列)で取得し、DBへ格納する。
     * 全国広域局(RN1/RN2/JOAK-FM)は`JP13`のみで処理し、NHK地方局(JO**)はエリアフリー局と
     * 重複しないよう1度だけ処理することで、同一番組の多重登録を防いでいる。
     * @param areaIdArray 取得対象のエリアID一覧(例: `['JP13', 'JP14']`)。
     * @param stationsMap 局IDから{@link StationInfo}を引くためのマップ(所属エリア判定に使用)。
     * @param whenBoot trueの場合は起動時取得としてラジオ時間(`getCurrentRadioDate`)基準の日付を使う。
     */
    updatePrograms(areaIdArray: Array<string>, stationsMap: Map<string, StationInfo>, whenBoot: boolean): Promise<void>;
    /**
     * 指定局の前後1週間分(`PROG_WEEKLY_STATION_URL`)の番組表を取得し、DBへ保存した上で配列として返す。
     * タイムフリーのブラウズ一覧を組み立てるために使う。
     * 週次レスポンスは日ごとに`progs`ブロックが分かれているため、`updatePrograms`と同様に
     * 各ブロックの先頭番組の日付をその日の基準日として個別に`cnvRadioTime`で正規化する。
     * @param stationId 局ID。
     */
    getStationPrograms(stationId: string): Promise<RadikoProgramData[]>;
    /**
     * 指定局・指定日の番組表XML(`PROG_DAILY_STATION_URL`)を取得し、DBへ保存した上で配列として返す。
     * `getStationPrograms`(前後1週間分)ではカバーできない、7日より前/後の日付を個別に補うために使う。
     * @param stationId 局ID。
     * @param date 対象日(`'yyyyMMdd'`)。
     */
    getStationProgramsForDate(stationId: string, date: string): Promise<RadikoProgramData[]>;
    /**
     * 指定局について、複数日分の番組表(`getStationProgramsForDate`)を並列(最大5並列)で取得する。
     * @param stationId 局ID。
     * @param dates 対象日(`'yyyyMMdd'`)の配列。
     */
    getStationProgramsForDates(stationId: string, dates: string[]): Promise<RadikoProgramData[]>;
    /**
     * DBファイルをコンパクションして終了する(プラグイン停止時に呼ばれる)。
     */
    dbClose(): Promise<void>;
    /**
     * DB内の全番組データを返す(デバッグ/確認用エンドポイント`/radiko/all/stations`向け)。
     */
    allData(): Promise<any[]>;
    /**
     * 検索頻度の高いフィールド(id/station/ft/tt)にインデックスを張る。idはユニーク制約。
     */
    private initDBIndexes;
}
//# sourceMappingURL=prog-service.d.ts.map