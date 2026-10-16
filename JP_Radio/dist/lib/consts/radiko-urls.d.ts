/**
 * アプリ識別ヘッダー(認証系・再生系のリクエストで共通して必要)
 */
export declare const RADIKO_APP_HEADERS: {
    readonly 'X-Radiko-App': "pc_html5";
    readonly 'X-Radiko-App-Version': "0.0.1";
    readonly 'X-Radiko-User': "dummy_user";
    readonly 'X-Radiko-Device': "pc";
};
/**
 * ログインAPI(POST、mail/passをフォーム送信)
 */
export declare const LOGIN_URL = "https://radiko.jp/ap/member/webapi/member/login";
/**
 * ログイン状態確認API
 */
export declare const CHECK_URL = "https://radiko.jp/ap/member/webapi/v2/member/login/check";
/**
 * ログアウトAPI
 */
export declare const LOGOUT_URL = "https://radiko.jp/ap/member/webapi/member/logout";
/**
 * 認証第1段階(auth1)API
 */
export declare const AUTH1_URL = "https://radiko.jp/v2/api/auth1";
/**
 * 認証第2段階(auth2)API
 */
export declare const AUTH2_URL = "https://radiko.jp/v2/api/auth2";
/**
 * パーシャルキー算出に使う固定キー文字列
 */
export declare const AUTH_KEY = "bcd151073c03b352e1ef2fd66c32209da9ca0afa";
/**
 * ストリーム取得失敗時の最大リトライ回数
 */
export declare const MAX_RETRY_COUNT = 2;
/**
 * 局ごとのライブ配信XML。`playlist_create_url`を含む。例: `TBS.xml`
 */
export declare const STATION_STREAM_XML_URL = "https://radiko.jp/v3/station/stream/pc_html5/%s.xml";
/**
 * `playlist_create_url`に付与するライブ配信用クエリ(`station_id`, `lsid`など)
 */
export declare const PLAY_LIVE_QUERY = "?station_id=%s&l=15&lsid=%s&type=c";
/**
 * `playlist_create_url`に付与するタイムフリー再生用クエリ
 */
export declare const PLAY_TIME_FREE_QUERY = "?station_id=%s&start_at=%s&ft=%s&end_at=%s&to=%s&preroll=0&l=15&lsid=%s&type=c";
/**
 * 指定エリアの局リストXML。例: `JP13.xml`
 */
export declare const STATION_AREA_URL = "http://radiko.jp/v3/station/list/%s.xml";
/**
 * 全国の全局・全地域データXML
 */
export declare const STATION_FULL_URL = "http://radiko.jp/v3/station/region/full.xml";
/**
 * 指定日・指定エリアの番組表XML。例: `20250831/JP13.xml`
 */
export declare const PROG_DATE_AREA_URL = "http://radiko.jp/v3/program/date/%s/%s.xml";
/**
 * 指定エリアの直近番組表XML。例: `JP13.xml`（直近）
 */
export declare const PROG_NOW_AREA_URL = "http://radiko.jp/v3/program/now/%s.xml";
/**
 * 指定エリアの今日の番組表XML(AM5:00に切り替わる)。例: `JP13.xml`
 */
export declare const PROG_TODAY_AREA_URL = "http://radiko.jp/v3/program/today/%s.xml";
/**
 * 指定局・指定日の番組表XML。例: `20250831/TBS.xml`
 */
export declare const PROG_DAILY_STATION_URL = "http://radiko.jp/v3/program/station/date/%s/%s.xml";
/**
 * 指定局の前後1週間(-7~+6)分の番組表XML。例: `TBS.xml`
 */
export declare const PROG_WEEKLY_STATION_URL = "http://radiko.jp/v3/program/station/weekly/%s.xml";
//# sourceMappingURL=radiko-urls.d.ts.map