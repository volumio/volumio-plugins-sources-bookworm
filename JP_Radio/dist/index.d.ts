import { BrowseResult } from './lib/models/browse-result-model';
import type { ProgInfoData } from './lib/models/prog-info-model';
export = ControllerJpRadio;
/**
 * Volumio4のmusic_serviceプラグインとして登録されるコントローラ。
 * Volumioのコア(CoreCommandRouter/CorePlayQueue)から各ライフサイクルメソッドを呼び出され、
 * 実際のRadikoストリーミング処理は{@link JpRadio}(Express製の内部HTTPサーバ)に委譲する。
 *
 * Volumioは一部のメソッドの戻り値に対して`.fail()`(kewのAPI)を呼び出すため、
 * それらのメソッドはネイティブPromiseではなくkew(`libQ`)ベースで実装する必要がある。
 */
declare class ControllerJpRadio {
    private context;
    private commandRouter;
    private logger;
    private configManager;
    private config;
    private readonly serviceName;
    private appRadio;
    private mpdPlugin;
    /**
     * @param context Volumioコアから渡されるプラグインコンテキスト(coreCommand/logger/configManagerを含む)。
     */
    constructor(context: any);
    /**
     * UI設定画面の「再起動」操作から呼ばれる。onStop→onStartの順に再実行してプラグインを再起動する。
     */
    restartPlugin(): Promise<void>;
    /**
     * 設定変更後にプラグインの再起動が必要な旨をVolumio UIのモーダルで通知する。
     */
    private showRestartModal;
    /**
     * 再起動不要で即時反映される設定を保存した際に表示する軽量なトースト通知。
     */
    private pushSettingsSavedToast;
    /**
     * UIConfig.jsonのselect要素(`content.value`/`content.options`)に現在値を反映する。
     * `content.options[].label`はこの時点で既に`i18nJson`によって翻訳済みの文字列になっている。
     * @param content UIConfig.jsonのselect要素(`value`/`options`を持つオブジェクト)。
     * @param currentValue 現在の設定値。
     */
    private populateSelectValue;
    /**
     * config.jsonから数値設定を取得する。旧バージョンからのアップグレードで永続化済み設定ファイルに
     * まだキーが存在しない場合、`config.get()`は`undefined`を返し`Number(undefined)`は`NaN`になってしまう
     * (例: node-cronのパターン文字列に混入してクラッシュする)ため、`NaN`ならデフォルト値にフォールバックする。
     * @param key 設定キー。
     * @param defaultValue キーが未設定または不正な場合に使うデフォルト値。
     */
    private getConfigNumber;
    /**
     * 設定画面(`radikoAreas.JP1`~`radikoAreas.JP47`)で選択済みのエリアIDの一覧を返す。
     * 何も選択されていなければ空配列(→全国47エリアを取得するデフォルト動作)。
     */
    private getRadikoAreaIdArray;
    /**
     * エリア選択設定(`radiko_areas`)セクションの内容を、地域ごとにグループ化して動的に構築する。
     * この時点(`i18nJson`実行後)に新規追加する項目は翻訳の対象外になるため、ラベル等は
     * ここで直接最終的な文字列を組み立てる({@link messageCatalog}を使うのはそのため)。
     * @param section UIConfig.jsonの`radiko_areas`セクションオブジェクト。
     */
    private populateRadikoAreasSection;
    /**
     * UI設定画面で入力されたサービスポート番号・ネットワーク遅延補正値を保存する。
     * サービスポートの変更は内部サーバーの再バインドが必要なため再起動を促すが、ネットワーク遅延補正値は
     * {@link setRadioDelay}で即座に反映できるため、それだけの変更なら再起動は不要。
     * @param data 保存ボタンから渡される入力値。
     */
    saveNetworkSetting(data: {
        servicePort: string;
        networkDelay: string;
    }): Promise<void>;
    /**
     * UI設定画面で入力されたRadikoプレミアム会員のアカウント情報を保存し、変更があれば再起動を促す。
     * @param data 保存ボタンから渡される入力値。
     */
    saveRadikoAccount(data: {
        radikoUser: string;
        radikoPass: string;
    }): Promise<void>;
    /**
     * UI設定画面で選択されたブラウズ動作(ライブ/タイムフリー選択時に直接再生するか、
     * 番組情報モーダルを表示するか)を保存する。ブラウズ時に都度参照される設定のため、
     * {@link JpRadio.updateBrowseMode}で即座に反映でき、再起動は不要。
     * @param data 保存ボタンから渡される選択値。
     */
    saveBrowseModeSetting(data: {
        browseMode1: {
            value: string;
        };
        browseMode2: {
            value: string;
        };
    }): Promise<void>;
    /**
     * UI設定画面で選択されたタイムフリー再生速度を保存する。再生開始時に都度参照される設定のため、
     * {@link JpRadio.updateTempo}で即座に反映でき、再起動は不要。
     * @param data 保存ボタンから渡される選択値。
     */
    saveTempoSetting(data: {
        tempo: {
            value: string;
        };
    }): Promise<void>;
    /**
     * UI設定画面で選択されたアルバムアート取得方式を保存する。表示時に都度参照される設定のため、
     * {@link JpRadio.updateAlbumartType}で即座に反映でき、再起動は不要。
     * @param data 保存ボタンから渡される選択値。
     */
    saveAlbumartSetting(data: {
        albumartType: {
            value: string;
        };
    }): Promise<void>;
    /**
     * UI設定画面の「局ロゴキャッシュのクリア」ボタンから呼ばれる。ローカルにキャッシュした局ロゴ画像
     * (`assets/images/*_logo.png`)を削除する。既存の`StationInfo.logoUrl`は既にこのファイルを指した
     * 状態でメモリ上に残るため、再取得させるためプラグインの再起動を促す。
     */
    clearStationLogoCache(): Promise<void>;
    /**
     * UI設定画面で入力/選択された番組表のデフォルト表示期間・日時表示書式を保存する。番組表表示時に
     * 都度参照される設定のため、{@link JpRadio.updateTimetableDisplay}で即座に反映でき、再起動は不要。
     * @param data 保存ボタンから渡される入力値。
     */
    saveTimetableDisplaySetting(data: {
        programPeriodFrom: string;
        programPeriodTo: string;
        timeFormat: {
            value: string;
        };
    }): Promise<void>;
    /**
     * UI設定画面で選択されたエリア選択(`radikoAreas.<areaId>`)を保存し、変更があれば再起動を促す。
     * @param data キーがエリアID(例: 'JP13')、値がそのエリアを取得対象にするかどうかの真偽値。
     */
    saveRadikoAreasSetting(data: Record<string, boolean>): Promise<void>;
    /**
     * Volumio起動時に最初に呼ばれるライフサイクルメソッド。config.jsonを読み込む。
     * また、この時点で初めてVolumioの`language_code`が分かるため、messageCatalogの表示言語も
     * ここで確定させる(ブラウズラベル・トースト通知・ログメッセージがVolumioのUI言語に追従するように)。
     * 以降、設定画面で言語が変更された場合もVolumio再起動なしに追従できるよう、
     * `sharedVars`の`language_code`変更コールバックも登録する(Volumioコア自身が
     * `appearance`プラグインの言語切り替え時に使っているのと同じ仕組み)。
     */
    onVolumioStart(): Promise<void>;
    /**
     * Volumioのシステムシャットダウン時に呼ばれるライフサイクルメソッド。
     * `onStop`はプラグインを無効化した時にしか自動で呼ばれないため、システム終了時にも内部サーバー・
     * cronタスクを確実に停止させ、再生キューの掃除も行うようここから明示的に呼び出す。
     */
    onVolumioShutdown(): Promise<void>;
    /**
     * Volumioのシステム再起動時に呼ばれるライフサイクルメソッド。{@link onVolumioShutdown}と同様の理由で
     * `onStop`を明示的に呼び出す。
     */
    onVolumioReboot(): Promise<void>;
    /**
     * プラグイン有効化時に呼ばれるライフサイクルメソッド。
     * 設定値からアカウント情報とサービスポートを取り出し、{@link JpRadio}を起動してブラウズソースに登録する。
     */
    onStart(): Promise<void>;
    /**
     * プラグイン無効化時に呼ばれるライフサイクルメソッド。JpRadioを停止し、ブラウズソースから除去する。
     * アンインストール時もVolumioは無効化(停止)を経由してから削除するため、ここが両方をカバーする。
     */
    onStop(): Promise<void>;
    /**
     * 再生キューからこのプラグイン(`jp_radio`)が追加した項目を全て取り除く。プラグインを停止・アンインストール
     * すると局を再生できなくなるため、キューに再生不能な項目を残さないようにする({@link onStop}から呼ばれる)。
     */
    private removeOwnQueueItems;
    /**
     * UI設定画面(UIConfig.json)を多言語化しつつ、現在の設定値を埋め込んで返す。
     */
    getUIConfig(): Promise<any>;
    /**
     * このプラグインが使用する設定ファイル名の一覧をVolumioに伝える。
     */
    getConfigurationFiles(): string[];
    /**
     * VolumioのBrowseメニューに「RADIKO」ソースを追加する。選択時はカテゴリ選択のルートメニュー
     * ({@link JpRadio.rootMenu})を表示する。
     */
    addToBrowseSources(): void;
    /**
     * BrowseメニューでURIが選択された際に呼ばれ、対応するブラウズ結果を返す。
     * `radiko` → ルートメニュー(ライブ/タイムフリー)、`radiko/live` → {@link JpRadio.radioStations}、
     * `radiko/timefree` → {@link JpRadio.timeFreeStations}、
     * `radiko/timetable/<stationId>` → {@link JpRadio.stationTimetable}、
     * `radiko/proginfo/<stationId>[?ft=&to=]` → 番組情報モーダルを表示(ブラウズ結果は返さず空を返す)。
     * @param curUri 選択されたURI。
     */
    handleBrowseUri(curUri: string): Promise<BrowseResult | Record<string, never>>;
    /**
     * 番組情報モーダルを表示する。「再生」「キューに追加」ボタンは{@link playFromProgInfoModal}/
     * {@link addQueueFromProgInfoModal}を`callMethod`で呼び出し、`data`(explodeUriと同形式)をそのまま渡す。
     * @param data モーダルに表示する番組情報(再生キューへそのまま渡せる形式)。
     */
    private showProgInfoModal;
    /**
     * お気に入り一覧から個別番組を選択した際に表示する「登録済みお気に入りの管理」モーダル。
     * 「翌日」「翌週」「翌々週」ボタンで同じ時間帯の別の日の番組に表示を切り替えながら、最終的に
     * 「お気に入りを更新」(表示中の番組で置き換え)または「お気に入りから削除」を選べる。
     * `data.oldUri`が実際に登録されているお気に入りのURI、`data.uri`が現在モーダルに表示中の番組のURIで、
     * 両者が一致する間は「更新」を、日付をずらして一致しなくなったら「削除」を隠す({@link showProgInfoModal}とは
     * 独立したモーダルにしているのは、通常のブラウズ再生と競合させないため)。
     * @param data 表示中の番組情報+`oldUri`(実際に登録されているお気に入りのURI)。
     */
    private showProgRegModal;
    /**
     * {@link showProgRegModal}の「翌日」「翌週」「翌々週」ボタンから呼ばれる。表示中の番組の`ft`/`to`を
     * 指定日数分シフトした番組情報を取得し直し、同じモーダルを再表示する(`oldUri`は元の登録URIのまま引き継ぐ)。
     * @param data 表示中の番組情報+`oldUri`+シフトする日数(`days`)。
     */
    changeDateFromProgRegModal(data: ProgInfoData & {
        oldUri: string;
        days: number;
    }): Promise<void>;
    /**
     * {@link showProgRegModal}の「お気に入りを更新」ボタンから呼ばれる。元のお気に入り登録(`oldUri`)を削除し、
     * 現在表示中の番組(`uri`)を新たに登録する。
     * @param data 表示中の番組情報+`oldUri`(削除対象の旧登録URI)。
     */
    updateFavouriteFromProgRegModal(data: ProgInfoData & {
        oldUri: string;
    }): Promise<void>;
    /**
     * {@link showProgRegModal}の「お気に入りから削除」ボタンから呼ばれる。
     * @param data `oldUri`(削除対象の登録URI)を含む番組情報。
     */
    removeFavouriteFromProgRegModal(data: ProgInfoData & {
        oldUri: string;
    }): Promise<void>;
    /**
     * 番組情報モーダルの「再生」ボタンから呼ばれる。対象トラックを再生キューの先頭に追加して即再生する。
     * @param data {@link showProgInfoModal}のボタンから渡されるトラック情報。
     */
    playFromProgInfoModal(data: any): void;
    /**
     * 番組情報モーダルの「キューに追加」ボタンから呼ばれる。対象トラックを再生キューの末尾に追加する。
     * @param data {@link showProgInfoModal}のボタンから渡されるトラック情報。
     */
    addQueueFromProgInfoModal(data: any): void;
    /**
     * キューのトラック選択時に呼ばれ、mpdのキューをクリアして再生対象のURIを追加・再生する。
     * タイムフリーの`?ft=&to=`が不正、または番組が配信前/放送中(追っかけ再生は不安定なため)の場合は、
     * ライブ再生のURIにフォールバックしてトースト通知する。
     * @param track 再生キュー内のトラック情報(`uri`を含む)。
     */
    clearAddPlayTrack(track: any): Promise<any>;
    /**
     * タイムフリー再生中はシーク位置付きの新URIに差し替える(`add`でキュー末尾に追加後、再生中だった項目を
     * `delete 0`で削除すると、mpdは残った項目の再生へ自動的に進む)。
     * ライブ再生中は、過去方向へのシークのみ現在放送中の番組の「追っかけ再生」(タイムフリー相当)に切り替える。
     * 未来方向のシークは不可能なため、{@link JpRadio.forcePushSongState}でタイムバーを元の位置に戻してrejectする。
     * @param timepos シーク先の再生位置(ミリ秒)。
     */
    seek(timepos: number): Promise<any>;
    /**
     * mpdへ再生停止コマンドを送る。
     */
    stop(): Promise<any>;
    /**
     * mpdへ一時停止コマンドを送る。
     */
    pause(): Promise<any>;
    /**
     * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
     */
    getState(): void;
    /**
     * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
     */
    parseState(_sState: any): void;
    /**
     * 再生状態をVolumioコアへプッシュする。
     * @param state プッシュする再生状態。
     */
    pushState(state: any): any;
    /**
     * キュー内のURI(`http://localhost:9000/radiko/play/{stationID}`)を
     * clearAddPlayTrackが要求するトラック情報オブジェクトに展開する。
     * タイトルやアルバムアートなどの表示用メタデータはURIに含めず、{@link JpRadio.getTrackMeta}で都度取得し直す
     * (長い日本語テキストや画像URLをそのままURIに埋め込みたくないため)。
     * タイムフリー再生時は`?ft=&to=`クエリで放送区間を受け取る。
     * @param uri キュー内のURI。
     */
    explodeUri(uri: string): Promise<any>;
    /**
     * ユーザーが曲をプレイリストやお気に入りに追加した際にVolumioから呼ばれる。{@link explodeUri}と同じ
     * 情報源(局名・番組情報)を使い、アーティスト名等を含む完全なメタデータを返す
     * (`explodeUri`は単一オブジェクトを返すが、こちらは配列で返す必要がある)。
     * @param uri キュー内のURI。
     */
    getTrackInfo(uri: string): Promise<any[]>;
    /**
     * Volumioの検索画面から呼ばれる。局名・ローマ字局名にキーワードを含む局を検索結果として返す。
     * @param query `value`に検索キーワードを含むオブジェクト。
     */
    search(query: {
        value?: string;
    }): Promise<any>;
    /**
     * 再生画面の「アーティストへ移動」「アルバムへ移動」から呼ばれる。対象局の番組表(タイムフリー再生中なら
     * その放送日、ライブ再生中なら当日)へブラウズ画面を遷移させる。
     * @param data `uri`(再生中トラックのURI)を含む。
     */
    goto(data: any): Promise<any>;
    /**
     * Volumioのお気に入り機能(`commonAddToPlaylist`)は`title`/`albumart`しか保存できず、アーティスト名を
     * 保存する仕組みが無い。そのため、Volumio標準の「お気に入り」画面から直接再生すると、アーティスト欄が
     * 空になりサービス名の「webradio」がそのまま表示されてしまう。この制約はVolumio側のAPI仕様上直せないため、
     * 代わりに保存する`title`自体に局名・時間帯(`artist`)を含めて、1行で情報が完結するようにする。
     * @param title 番組タイトル。
     * @param artist 局名・時間帯などの補足情報(例: `'東京 / TBSラジオ 21:00-21:30'`)。
     */
    private buildFavouriteTitle;
    /**
     * 番組情報モーダルの「お気に入りに追加」ボタンから呼ばれる。Volumioコアの「radio-favourites」
     * プレイリストへ直接書き込む({@link JpRadio.radioFavouriteStations}が読み出す先と同じ)。
     * @param data {@link showProgInfoModal}のボタンから渡される番組情報。
     */
    addFavouriteFromProgInfoModal(data: ProgInfoData): void;
    /**
     * Browse画面のハートアイコン(お気に入り追加)から、Volumioコアがこのプラグインのサービス名宛てに
     * 呼び出す。{@link addFavouriteFromProgInfoModal}と同じ「radio-favourites」プレイリストへ書き込む。
     * @param data `uri`/`title`/`artist`/`albumart`を含むお気に入り登録対象の情報。
     */
    addToFavourites(data: {
        uri: string;
        title?: string;
        artist?: string;
        albumart?: string;
    }): Promise<any>;
    /**
     * Browse画面のハートアイコン(お気に入り解除)から、Volumioコアがこのプラグインのサービス名宛てに
     * 呼び出す。
     * @param data `uri`を含むお気に入り解除対象の情報。
     */
    removeFromFavourites(data: {
        uri: string;
    }): Promise<any>;
}
//# sourceMappingURL=index.d.ts.map