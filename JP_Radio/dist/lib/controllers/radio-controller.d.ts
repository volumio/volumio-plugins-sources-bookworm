import type { BrowseList, BrowseResult } from '../models/browse-result-model';
import type { LoginAccount } from '../models/auth-model';
import type { TrackMeta } from '../models/track-meta-model';
import type { TimeFreeQuery } from '../models/time-free-query-model';
import type { ProgInfoData } from '../models/prog-info-model';
import type { LoggerEx } from '../utils/logger';
/**
 * RadikoストリーミングのためのExpress HTTPサーバ兼コントローラ。
 * {@link Radiko}(Model)から局一覧・番組データを取得してVolumioのBrowse/再生用データに変換し、
 * `/radiko/play/:stationID`へのリクエストごとに{@link StreamSession}でffmpegストリームを開始する。
 */
export default class JpRadio {
    #private;
    private readonly app;
    private server;
    private readonly task1;
    private readonly task2;
    private readonly port;
    private readonly logger;
    private readonly acct;
    private readonly commandRouter;
    private prg;
    private rdk;
    private station;
    private task2Cnt;
    private readonly serviceName;
    private browseMode1;
    private browseMode2;
    private readonly radikoAreaIdArray;
    private tempo;
    /** タイムフリー番組表のページングのデフォルト範囲(過去方向、日数)。 */
    private programPeriodFrom;
    /** タイムフリー番組表のページングのデフォルト範囲(未来方向、日数)。 */
    private programPeriodTo;
    /** 番組表示用の日時フォーマット(`'<日付書式> <開始時刻書式>-<終了時刻書式>'`)。 */
    private timeFormat;
    /** アルバムアート取得方式('type1'=バナー, 'type2'=局ロゴ, 'type3'=番組画像)。 */
    private albumartType;
    /** タイムフリー再生の途中再開用の進捗(局・番組・再生位置)。同じ番組を選び直した時だけ使う。 */
    private timeFreeProgress;
    private timeFreeProgressTimer;
    /**
     * @param port `/radiko/play/...`等のURI生成に使う自身のリッスンポート番号。
     * @param logger ログ出力先。
     * @param acct Radikoプレミアム会員としてログインする場合のアカウント情報。未指定ならログインしない。
     * @param commandRouter Volumioコアのコマンドルータ。
     * @param serviceName BrowseItemの`service`に設定するサービス名。
     * @param browseMode1 ライブ局選択時の動作('type1'=直接再生、'type2'=番組情報モーダル)。
     * @param browseMode2 タイムフリー番組選択時の動作('type1'=直接再生、'type2'=番組情報モーダル)。
     * @param radikoAreaIdArray エリアフリー会員が設定画面で選択した、番組表取得対象のエリアID一覧。
     * @param tempo タイムフリー再生の速度倍率。
     * @param programPeriodFrom タイムフリー番組表のページングのデフォルト範囲(過去方向、日数)。
     * @param programPeriodTo タイムフリー番組表のページングのデフォルト範囲(未来方向、日数)。
     * @param timeFormat 番組表示用の日時フォーマット。
     * @param albumartType アルバムアート取得方式。
     */
    constructor(port: number | undefined, logger: LoggerEx, acct: LoginAccount | null | undefined, commandRouter: any, serviceName: string, browseMode1?: string, browseMode2?: string, radikoAreaIdArray?: string[], tempo?: number, programPeriodFrom?: number, programPeriodTo?: number, timeFormat?: string, albumartType?: string);
    /**
     * ブラウズ動作(ライブ/タイムフリー選択時の挙動)を再起動無しで更新する。
     * @param browseMode1 ライブ局選択時の動作('type1'=直接再生、'type2'=番組情報モーダル)。
     * @param browseMode2 タイムフリー番組選択時の動作。
     */
    updateBrowseMode(browseMode1: string, browseMode2: string): void;
    /**
     * タイムフリー再生速度を再起動無しで更新する。
     * @param tempo タイムフリー再生の速度倍率。
     */
    updateTempo(tempo: number): void;
    /**
     * アルバムアート取得方式を再起動無しで更新する。
     * @param albumartType アルバムアート取得方式。
     */
    updateAlbumartType(albumartType: string): void;
    /**
     * タイムフリー番組表のデフォルト表示期間・日時表示書式を再起動無しで更新する。
     * @param programPeriodFrom 表示期間(過去方向、日数)。
     * @param programPeriodTo 表示期間(未来方向、日数)。
     * @param timeFormat 番組表示用の日時フォーマット。
     */
    updateTimetableDisplay(programPeriodFrom: number, programPeriodTo: number, timeFormat: string): void;
    /**
     * ライブ再生中にシーク操作(非対応)された場合に、Volumio側のタイムバーを正しい位置へ戻すため、
     * 通常の更新条件を無視して強制的に再生状態を再送信する。
     */
    forcePushSongState(): Promise<void>;
    /**
     * ルートメニュー(ライブ/タイムフリー/タイムフリー(今日)/お気に入り2種)を返す。各項目は`radio-category`型
     * (お気に入りのみ`radio-favourites`型)で、選択すると{@link radioStations}/{@link timeFreeStations}/
     * {@link radioFavouriteStations}へ遷移する。
     */
    rootMenu(): Promise<BrowseResult>;
    /**
     * 局一覧をVolumioのBrowse画面用データ(地域名ごとにグループ化したリスト)に変換して返す。
     */
    radioStations(): Promise<BrowseResult>;
    /**
     * 局名・ローマ字局名にキーワードを含む局を検索し、Volumioの検索結果画面用データを返す。
     * ライブの局一覧と同じ`song`型の項目(直接再生)を返す。
     * @param keyword 検索キーワード(前後の空白を除いたもの)。
     */
    searchStations(keyword: string): Promise<BrowseList[]>;
    /**
     * お気に入り登録済みの局・番組をBrowse画面用データに変換して返す。
     * @param mode `'live'`ならお気に入りのライブ局一覧、`'timefree'`ならお気に入りの局(番組表への入口)+
     *   お気に入り登録済みの個別番組の一覧。
     */
    radioFavouriteStations(mode: 'live' | 'timefree'): Promise<BrowseResult>;
    /**
     * タイムフリー用の局一覧をVolumioのBrowse画面用データに変換して返す。
     * 各アイテムは`radio-category`型(直接再生ではなく再度ブラウズを呼び出す)にし、
     * 選択すると{@link stationTimetable}で番組一覧に遷移する。
     * @param mode `'today'`指定時は各局の遷移先URIを`radiko/timetable_today/<stationId>`にする(当日分のみ表示)。
     */
    timeFreeStations(mode?: 'normal' | 'today'): Promise<BrowseResult>;
    /**
     * 指定局のタイムフリー番組表を日付ごとにグループ化したBrowse画面用データに変換して返す。
     * 前週/前日/次週/翌日への日送りナビゲーションを先頭・末尾に付与し、各番組のタイトルには
     * 放送状態アイコン(★放送中/⬜︎配信前/▷タイムフリー再生可能)を付与する。
     * @param stationId 局ID。
     * @param opts `isToday`指定時は当日分のみ、`ft`/`to`(`'yyyyMMdd'`)指定時はその範囲、
     *   いずれも未指定なら`programPeriodFrom`/`programPeriodTo`設定から算出した範囲を表示する。
     */
    stationTimetable(stationId: string, opts?: {
        isToday?: boolean;
        ft?: string;
        to?: string;
    }): Promise<BrowseResult>;
    /**
     * 指定局IDの現在のトラック情報を返す(explodeUriから呼ばれる)。
     * URIには局IDのみを載せ、タイトルやアルバムアートなどの表示用メタデータは
     * 再生選択のたびにここで最新の状態を取得し直す(長い日本語テキストをURIに含めないため)。
     * @param stationId 局ID。
     * @param timeFreeQuery 指定するとタイムフリー再生時の番組情報を、指定しなければ現在放送中の情報を返す。
     * @returns 局が存在しない場合はnull。
     */
    getTrackMeta(stationId: string, timeFreeQuery?: TimeFreeQuery): Promise<TrackMeta | null>;
    /**
     * 番組情報モーダル表示用のデータを組み立てる(`handleBrowseUri`の`radiko/proginfo/<stationId>`から呼ばれる)。
     * `explodeUri`の返却値と同じ形にして返すことで、モーダルの「再生」「キューに追加」ボタンから
     * このデータをそのままVolumioの再生キューへ渡せるようにする。
     * @param stationId 局ID。
     * @param timeFreeQuery 指定するとタイムフリー番組の情報を、指定しなければ現在放送中の情報を組み立てる。
     * @returns 局が存在しない場合はnull。
     */
    progInfo(stationId: string, timeFreeQuery?: TimeFreeQuery): Promise<ProgInfoData | null>;
    /**
     * 指定局の現在放送中の番組の放送区間(ft/tt)を返す。ライブ再生中に過去方向へシークされた際、
     * 「追っかけ再生」(現在放送中の番組をタイムフリー相当でその時点から再生)に切り替えるためのURIを
     * 組み立てるのに使う(`index.ts`の`seek()`から呼ばれる)。
     * @param stationId 局ID。
     * @returns 番組情報が取得できない場合はnull。
     */
    getCurrentProgramWindow(stationId: string): Promise<{
        ft: string;
        tt: string;
    } | null>;
    /**
     * 自身のエリアID・会員種別を`'JP13/premium'`形式で返す(`Radiko.getMyAreaId()`のパススルー)。
     * エリア選択設定画面で「自分のエリア」を示すために使う。
     */
    getMyAreaId(): Promise<string>;
    /**
     * 指定エリアIDに属する局のID一覧を返す(エリア選択設定画面の説明表示に使う)。
     * @param areaId エリアID(例: 'JP13')。
     */
    getAreaStations(areaId: string): string[];
    /**
     * 設定(`albumartType`)に応じてアルバムアートのURLを選択する。いずれも空の場合はデフォルトアイコンを返す。
     * @param banner 局バナー画像URL。
     * @param logo 局ロゴ画像URL(ローカルキャッシュ済みのURLを想定)。
     * @param progImg 番組画像URL。
     */
    private selectAlbumart;
    /**
     * HTTPサーバを起動し、局データ・番組表の初期取得と番組表定期更新タスクを開始する。
     */
    start(): Promise<void>;
    /**
     * 定期更新タスクとHTTPサーバを停止し、Model層(Radiko/RdkProg)の参照を破棄する。
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=radio-controller.d.ts.map