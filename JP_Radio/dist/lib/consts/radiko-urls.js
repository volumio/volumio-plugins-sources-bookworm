"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROG_WEEKLY_STATION_URL = exports.PROG_DAILY_STATION_URL = exports.PROG_TODAY_AREA_URL = exports.PROG_NOW_AREA_URL = exports.PROG_DATE_AREA_URL = exports.STATION_FULL_URL = exports.STATION_AREA_URL = exports.PLAY_TIME_FREE_QUERY = exports.PLAY_LIVE_QUERY = exports.STATION_STREAM_XML_URL = exports.MAX_RETRY_COUNT = exports.AUTH_KEY = exports.AUTH2_URL = exports.AUTH1_URL = exports.LOGOUT_URL = exports.CHECK_URL = exports.LOGIN_URL = exports.RADIKO_APP_HEADERS = void 0;
/**
 * アプリ識別ヘッダー(認証系・再生系のリクエストで共通して必要)
 */
exports.RADIKO_APP_HEADERS = {
    'X-Radiko-App': 'pc_html5',
    'X-Radiko-App-Version': '0.0.1',
    'X-Radiko-User': 'dummy_user',
    'X-Radiko-Device': 'pc',
};
// 認証系
/**
 * ログインAPI(POST、mail/passをフォーム送信)
 */
exports.LOGIN_URL = 'https://radiko.jp/ap/member/webapi/member/login';
/**
 * ログイン状態確認API
 */
exports.CHECK_URL = 'https://radiko.jp/ap/member/webapi/v2/member/login/check';
/**
 * ログアウトAPI
 */
exports.LOGOUT_URL = 'https://radiko.jp/ap/member/webapi/member/logout';
/**
 * 認証第1段階(auth1)API
 */
exports.AUTH1_URL = 'https://radiko.jp/v2/api/auth1';
/**
 * 認証第2段階(auth2)API
 */
exports.AUTH2_URL = 'https://radiko.jp/v2/api/auth2';
/**
 * パーシャルキー算出に使う固定キー文字列
 */
exports.AUTH_KEY = 'bcd151073c03b352e1ef2fd66c32209da9ca0afa';
/**
 * ストリーム取得失敗時の最大リトライ回数
 */
exports.MAX_RETRY_COUNT = 2;
// 再生系
//export const PLAY_LIVE_URL = 'https://f-radiko.smartstream.ne.jp/%s/_definst_/simul-stream.stream/playlist.m3u8'; // Radiko仕様変更(2026/06)で廃止
//export const PLAY_TIME_FREE_URL = 'https://radiko.jp/v2/api/ts/playlist.m3u8?station_id=%s&l=15&ft=%s&to=%s';  // Radiko仕様変更(2026/01)で廃止
/**
 * 局ごとのライブ配信XML。`playlist_create_url`を含む。例: `TBS.xml`
 */
exports.STATION_STREAM_XML_URL = 'https://radiko.jp/v3/station/stream/pc_html5/%s.xml';
/**
 * `playlist_create_url`に付与するライブ配信用クエリ(`station_id`, `lsid`など)
 */
exports.PLAY_LIVE_QUERY = '?station_id=%s&l=15&lsid=%s&type=c';
/**
 * `playlist_create_url`に付与するタイムフリー再生用クエリ
 */
exports.PLAY_TIME_FREE_QUERY = '?station_id=%s&start_at=%s&ft=%s&end_at=%s&to=%s&preroll=0&l=15&lsid=%s&type=c';
// ステーションリスト
/**
 * 指定エリアの局リストXML。例: `JP13.xml`
 */
exports.STATION_AREA_URL = 'http://radiko.jp/v3/station/list/%s.xml';
/**
 * 全国の全局・全地域データXML
 */
exports.STATION_FULL_URL = 'http://radiko.jp/v3/station/region/full.xml';
// 番組表（エリア別）
/**
 * 指定日・指定エリアの番組表XML。例: `20250831/JP13.xml`
 */
exports.PROG_DATE_AREA_URL = 'http://radiko.jp/v3/program/date/%s/%s.xml';
/**
 * 指定エリアの直近番組表XML。例: `JP13.xml`（直近）
 */
exports.PROG_NOW_AREA_URL = 'http://radiko.jp/v3/program/now/%s.xml';
/**
 * 指定エリアの今日の番組表XML(AM5:00に切り替わる)。例: `JP13.xml`
 */
exports.PROG_TODAY_AREA_URL = 'http://radiko.jp/v3/program/today/%s.xml';
// 番組表（日付別）
/**
 * 指定局・指定日の番組表XML。例: `20250831/TBS.xml`
 */
exports.PROG_DAILY_STATION_URL = 'http://radiko.jp/v3/program/station/date/%s/%s.xml';
/**
 * 指定局の前後1週間(-7~+6)分の番組表XML。例: `TBS.xml`
 */
exports.PROG_WEEKLY_STATION_URL = 'http://radiko.jp/v3/program/station/weekly/%s.xml';
//# sourceMappingURL=radiko-urls.js.map