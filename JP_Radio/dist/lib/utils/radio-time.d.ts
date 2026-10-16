/**
 * ライブ配信遅延補正値(秒)を設定する。UI設定の`networkDelay`から`onStart`時に呼ばれる想定。
 * @param sec 遅延秒数。
 */
export declare function setRadioDelay(sec: number): void;
/**
 * 現在設定されているライブ配信遅延補正値(秒)を返す。
 */
export declare function getRadioDelay(): number;
/**
 * 実時間の今日の日付を`yyyyMMdd`形式で返す。
 */
export declare function getCurrentDate(): string;
/**
 * ラジオの一日は「05:00～29:00」として扱われるため、実時間ではなく
 * `cnvRadioTime`で補正した「ラジオ時間」での現在時刻を`yyyyMMddHHmmss`形式で返す。
 * 配信遅延分(`DELAY_SEC`)を差し引いた時刻を基準にする。
 */
export declare function getCurrentRadioTime(): string;
/**
 * 深夜0:00～5:00は前日として扱う「ラジオ日付」を`yyyyMMdd`形式で返す。
 */
export declare function getCurrentRadioDate(): string;
/**
 * `'yyyyMMddHHmmss'`形式の文字列を意味のある要素に分解したもの。
 */
export interface RadioTimeParts {
    /**
     * yyyyMMdd
     */
    date: string;
    /**
     * HH（深夜番組は24～29になりうる）
     */
    hour: string;
    /**
     * mm
     */
    minute: string;
    /**
     * ss
     */
    second: string;
}
/**
 * `'yyyyMMddHHmmss'`形式の文字列を{@link RadioTimeParts}に分解する。
 * @param t 分解対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export declare function parseRadioTime(t: string): RadioTimeParts;
/**
 * 実時間の日時文字列をラジオ時間に変換する。深夜0:00～5:00の番組は日付を変えず`24:00～29:00`表記にする。
 * @param src 変換対象の`'yyyyMMddHHmmss'`形式の日時文字列。
 * @param today 基準となる「ラジオ日付」(`yyyyMMdd`)。srcの日付がこれと異なる場合、深夜番組とみなす。
 */
export declare function cnvRadioTime(src: string, today: string): string;
/**
 * {@link cnvRadioTime}の逆変換。`24:00`～`29:00`表記を翌日の`00:00`～`05:00`の実時刻表記に戻す。
 * Radiko APIのタイムフリー再生パラメータ(`start_at`/`ft`/`end_at`/`to`)は実時刻表記を要求するため使う。
 * @param src 変換対象の`'yyyyMMddHHmmss'`形式の文字列(ラジオ時間表記)。
 */
export declare function revCnvRadioTime(src: string): string;
/**
 * `'yyyyMMddHHmmss'`形式の実時刻文字列にN秒を加算する。タイムフリー再生の途中再開位置
 * (`revCnvRadioTime`で実時刻に戻した`ft` + 経過秒)を計算するために使う。
 * @param src 加算対象の`'yyyyMMddHHmmss'`形式の実時刻文字列。
 * @param seconds 加算する秒数。
 */
export declare function addSecondsToTimeString(src: string, seconds: number): string;
/**
 * `'yyyyMMddHHmmss'` => `'HH:mm:ss'`
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export declare function formatTimeString(t: string): string;
/**
 * `'yyyyMMddHHmmss'` => `'HH:mm'`（表示用に秒を省略）
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export declare function formatHourMinute(t: string): string;
/**
 * `'yyyyMMddHHmmss'` => `'yyyyMMddHHmm'`（分単位、DBの範囲検索に使う）
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export declare function toMinutePrecision(t: string): string;
/**
 * `'HH:mm:ss'`(または`'HH:mm'`)形式の2つの時刻の差を秒単位で返す(`end - begin`)。
 * @param begin 開始時刻。
 * @param end 終了時刻。
 */
export declare function getTimeSpan(begin: string, end: string): number;
/**
 * 番組がタイムフリーで再生可能(=既に放送開始済み)かどうかを判定する。
 * `ft`/`currentRadioTime`はどちらも{@link cnvRadioTime}で正規化された`'yyyyMMddHHmmss'`文字列
 * (日付+時刻が矛盾なく連動している)なので、単純な文字列比較で時系列の前後関係を判定できる。
 * 「タイムフリーとして古すぎないか(7日以内か)」は、番組データの取得元である
 * `PROG_WEEKLY_STATION_URL`自体が前後1週間分しか返さないため、ここでは判定しない。
 * @param ft 判定対象の番組の放送開始時刻。
 * @param currentRadioTime 現在時刻(`getCurrentRadioTime`の戻り値)。
 */
export declare function isWithinTimeFreeWindow(ft: string, currentRadioTime: string): boolean;
/** 番組の放送状態。`'future'`=配信開始前、`'live'`=放送中(追っかけ再生になる)、`'past'`=放送終了済み(タイムフリー再生可能)。 */
export type ProgramTimeStatus = 'future' | 'live' | 'past';
/**
 * 番組の放送状態を判定する。`ft`/`tt`/`currentRadioTime`はいずれも{@link cnvRadioTime}で
 * 正規化された`'yyyyMMddHHmmss'`文字列前提で、単純な文字列比較で時系列の前後関係を判定する。
 * @param ft 番組の放送開始時刻。
 * @param tt 番組の放送終了時刻。
 * @param currentRadioTime 現在時刻(`getCurrentRadioTime`の戻り値)。
 */
export declare function getProgramTimeStatus(ft: string, tt: string, currentRadioTime: string): ProgramTimeStatus;
/**
 * `ft`~`tt`の番組放送区間を、ユーザー設定の書式で整形する。書式は空白区切りで
 * `'<日付書式> <開始時刻書式>-<終了時刻書式>'`の3ブロックとして解釈する
 * (例: `'yyyy/MM/dd HH:mm-HH:mm'` => `'2026/07/25 12:00-13:00'`)。
 * `ft`/`tt`はラジオ時間表記(`24:00`~`29:00`表記を含みうる)のため、{@link revCnvRadioTime}で
 * 実時刻に戻してからフォーマットする。
 * @param ft 番組の放送開始時刻(ラジオ時間表記)。
 * @param tt 番組の放送終了時刻(ラジオ時間表記)。
 * @param pattern 表示書式。
 */
export declare function formatRadioTimeRange(ft: string, tt: string, pattern: string): string;
/**
 * `'yyyyMMdd'`形式の日付文字列を任意の書式(曜日を含む書式も可)に整形する。
 * @param dateOnly `'yyyyMMdd'`形式の日付文字列。
 * @param pattern 書式文字列(例: `'M月d日(E)'`)。対応トークンは{@link formatFields}参照。
 */
export declare function formatDateOnly(dateOnly: string, pattern: string): string;
/**
 * `'yyyyMMdd'`形式の日付文字列にN日加算する(負数で減算)。
 * @param dateOnly `'yyyyMMdd'`形式の日付文字列。
 * @param days 加算する日数。
 */
export declare function addDaysToDateOnly(dateOnly: string, days: number): string;
/**
 * ラジオ時間表記(`'yyyyMMddHHmmss'`、`24:00`~`29:00`表記を含みうる)の日付部分だけをN日シフトする。
 * 時・分・秒はそのまま維持するため、「同じ時間帯の翌日/翌週の番組」を求める用途(お気に入りの日付ずらし)に使う。
 * @param t シフト元のラジオ時間表記(`'yyyyMMddHHmmss'`)。
 * @param days シフトする日数(負数で過去方向)。
 */
export declare function addDaysToRadioTime(t: string, days: number): string;
//# sourceMappingURL=radio-time.d.ts.map