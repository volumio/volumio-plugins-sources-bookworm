/**
 * Radikoの番組表・配信はJST基準のため、サーバのシステムタイムゾーンによらずJSTで統一する。
 * JSTは夏時間を持たない固定UTC+9のため、IANAタイムゾーンDB(date-fns-tz等)を使わずオフセット加算のみで求められる。
 */
const JST_OFFSET_MSEC = 9 * 3600 * 1000;

/** 日本語の曜日名(`Date#getUTCDay()`の0=日曜始まりに対応)。書式トークン`E`で使う。 */
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 日時の各要素。{@link formatFields}に渡してユーザー設定の書式文字列に整形する。
 */
interface DateFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

/**
 * `Date`のUTCフィールドをそのまま{@link DateFields}として取り出す。
 * このモジュールでは常に「UTCフィールド=JSTの壁時計表記」となるよう`Date`を構築するため、
 * ここでタイムゾーン変換は行わない。
 * @param d 対象の`Date`。
 */
function fieldsFromDate(d: Date): DateFields {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

/**
 * {@link DateFields}を書式文字列に従って整形する。対応トークンは`yyyy`/`MM`/`M`/`dd`/`d`/`HH`/`mm`/`ss`/`E`
 * (`E`は日本語の曜日1文字)のみ。UIConfig上の`timeFormat`選択肢および`'M月d日(E)'`表記をカバーする。
 * @param f 整形対象の日時要素。
 * @param pattern 書式文字列。
 */
function formatFields(f: DateFields, pattern: string): string {
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss|M|d|E/g, (token) => {
    switch (token) {
      case 'yyyy': return String(f.year);
      case 'MM': return pad2(f.month);
      case 'M': return String(f.month);
      case 'dd': return pad2(f.day);
      case 'd': return String(f.day);
      case 'HH': return pad2(f.hour);
      case 'mm': return pad2(f.minute);
      case 'ss': return pad2(f.second);
      case 'E': return WEEKDAY_JA[f.weekday];
      default: return token;
    }
  });
}

/**
 * `'yyyyMMddHHmmss'`形式の文字列を`Date`に変換する。フィールドはUTCとして格納する
 * (実際の意味はJSTの壁時計表記だが、このモジュール内で一貫していれば変換は不要)。
 * @param s 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
function parseYyyyMMddHHmmss(s: string): Date {
  return new Date(Date.UTC(
    Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)),
    Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14)),
  ));
}

/**
 * `'yyyyMMdd'`形式の文字列を`Date`に変換する({@link parseYyyyMMddHHmmss}参照)。
 * @param s 変換対象の`'yyyyMMdd'`形式の文字列。
 */
function parseYyyyMMdd(s: string): Date {
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}

/**
 * Radikoのライブ配信遅延(実測、約20s)。ラジオ時間の算出時にこの分だけ巻き戻す。
 * UI設定(ネットワーク遅延)で上書きできるよう可変値にしている。
 */
let radioDelaySec = 20;

/**
 * ライブ配信遅延補正値(秒)を設定する。UI設定の`networkDelay`から`onStart`時に呼ばれる想定。
 * @param sec 遅延秒数。
 */
export function setRadioDelay(sec: number): void {
  radioDelaySec = sec;
}

/**
 * 現在設定されているライブ配信遅延補正値(秒)を返す。
 */
export function getRadioDelay(): number {
  return radioDelaySec;
}

/** ラジオの一日の開始時刻(05:00)。この時刻を境に「ラジオ日付」が切り替わる。 */
const RADIO_DAY_START_MSEC = 5 * 3600 * 1000;

/**
 * 実時間の今日の日付を`yyyyMMdd`形式で返す。
 */
export function getCurrentDate(): string {
  return formatFields(fieldsFromDate(new Date(Date.now() + JST_OFFSET_MSEC)), 'yyyyMMdd');
}

/**
 * ラジオの一日は「05:00～29:00」として扱われるため、実時間ではなく
 * `cnvRadioTime`で補正した「ラジオ時間」での現在時刻を`yyyyMMddHHmmss`形式で返す。
 * 配信遅延分(`DELAY_SEC`)を差し引いた時刻を基準にする。
 */
export function getCurrentRadioTime(): string {
  const adjustedNow = Date.now() - radioDelaySec * 1000;
  const src = formatFields(fieldsFromDate(new Date(adjustedNow + JST_OFFSET_MSEC)), 'yyyyMMddHHmmss');
  const today = formatFields(fieldsFromDate(new Date(adjustedNow - RADIO_DAY_START_MSEC + JST_OFFSET_MSEC)), 'yyyyMMdd');
  return cnvRadioTime(src, today);
}

/**
 * 深夜0:00～5:00は前日として扱う「ラジオ日付」を`yyyyMMdd`形式で返す。
 */
export function getCurrentRadioDate(): string {
  const adjustedNow = Date.now() - radioDelaySec * 1000 - RADIO_DAY_START_MSEC + JST_OFFSET_MSEC;
  return formatFields(fieldsFromDate(new Date(adjustedNow)), 'yyyyMMdd');
}

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
export function parseRadioTime(t: string): RadioTimeParts {
  return {
    date: t.slice(0, 8),
    hour: t.slice(8, 10),
    minute: t.slice(10, 12),
    second: t.slice(12, 14),
  };
}

/**
 * 実時間の日時文字列をラジオ時間に変換する。深夜0:00～5:00の番組は日付を変えず`24:00～29:00`表記にする。
 * @param src 変換対象の`'yyyyMMddHHmmss'`形式の日時文字列。
 * @param today 基準となる「ラジオ日付」(`yyyyMMdd`)。srcの日付がこれと異なる場合、深夜番組とみなす。
 */
export function cnvRadioTime(src: string, today: string): string {
  const parts = parseRadioTime(src);
  const todayDate = today.slice(0, 8);
  let hour = parts.hour;
  let date = parts.date;
  if (date !== todayDate) {
    hour = String(parseInt(hour) + 24);
    date = todayDate;
  }
  return date + hour + parts.minute + parts.second;
}

/**
 * {@link cnvRadioTime}の逆変換。`24:00`～`29:00`表記を翌日の`00:00`～`05:00`の実時刻表記に戻す。
 * Radiko APIのタイムフリー再生パラメータ(`start_at`/`ft`/`end_at`/`to`)は実時刻表記を要求するため使う。
 * @param src 変換対象の`'yyyyMMddHHmmss'`形式の文字列(ラジオ時間表記)。
 */
export function revCnvRadioTime(src: string): string {
  const parts = parseRadioTime(src);
  const hourNum = Number(parts.hour);
  if (hourNum < 24) {
    return src;
  }
  const nextDay = new Date(parseYyyyMMdd(parts.date).getTime() + 24 * 3600 * 1000);
  const nextDate = formatFields(fieldsFromDate(nextDay), 'yyyyMMdd');
  const hour = String(hourNum - 24).padStart(2, '0');
  return nextDate + hour + parts.minute + parts.second;
}

/**
 * `'yyyyMMddHHmmss'`形式の実時刻文字列にN秒を加算する。タイムフリー再生の途中再開位置
 * (`revCnvRadioTime`で実時刻に戻した`ft` + 経過秒)を計算するために使う。
 * @param src 加算対象の`'yyyyMMddHHmmss'`形式の実時刻文字列。
 * @param seconds 加算する秒数。
 */
export function addSecondsToTimeString(src: string, seconds: number): string {
  const date = new Date(parseYyyyMMddHHmmss(src).getTime() + seconds * 1000);
  return formatFields(fieldsFromDate(date), 'yyyyMMddHHmmss');
}

/**
 * `'yyyyMMddHHmmss'` => `'HH:mm:ss'`
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export function formatTimeString(t: string): string {
  const { hour, minute, second } = parseRadioTime(t);
  return `${hour}:${minute}:${second}`;
}

/**
 * `'yyyyMMddHHmmss'` => `'HH:mm'`（表示用に秒を省略）
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export function formatHourMinute(t: string): string {
  const { hour, minute } = parseRadioTime(t);
  return `${hour}:${minute}`;
}

/**
 * `'yyyyMMddHHmmss'` => `'yyyyMMddHHmm'`（分単位、DBの範囲検索に使う）
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export function toMinutePrecision(t: string): string {
  const { date, hour, minute } = parseRadioTime(t);
  return date + hour + minute;
}

/**
 * `'HH:mm:ss'`(または`'HH:mm'`)形式の時刻を秒単位に変換する。
 * @param t 変換対象の時刻文字列。
 */
function toSeconds(t: string): number {
  const [hour, minute, second = '0'] = t.split(':');
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

/**
 * `'HH:mm:ss'`(または`'HH:mm'`)形式の2つの時刻の差を秒単位で返す(`end - begin`)。
 * @param begin 開始時刻。
 * @param end 終了時刻。
 */
export function getTimeSpan(begin: string, end: string): number {
  return toSeconds(end) - toSeconds(begin);
}

/**
 * 番組がタイムフリーで再生可能(=既に放送開始済み)かどうかを判定する。
 * `ft`/`currentRadioTime`はどちらも{@link cnvRadioTime}で正規化された`'yyyyMMddHHmmss'`文字列
 * (日付+時刻が矛盾なく連動している)なので、単純な文字列比較で時系列の前後関係を判定できる。
 * 「タイムフリーとして古すぎないか(7日以内か)」は、番組データの取得元である
 * `PROG_WEEKLY_STATION_URL`自体が前後1週間分しか返さないため、ここでは判定しない。
 * @param ft 判定対象の番組の放送開始時刻。
 * @param currentRadioTime 現在時刻(`getCurrentRadioTime`の戻り値)。
 */
export function isWithinTimeFreeWindow(ft: string, currentRadioTime: string): boolean {
  return ft <= currentRadioTime;
}

/** 番組の放送状態。`'future'`=配信開始前、`'live'`=放送中(追っかけ再生になる)、`'past'`=放送終了済み(タイムフリー再生可能)。 */
export type ProgramTimeStatus = 'future' | 'live' | 'past';

/**
 * 番組の放送状態を判定する。`ft`/`tt`/`currentRadioTime`はいずれも{@link cnvRadioTime}で
 * 正規化された`'yyyyMMddHHmmss'`文字列前提で、単純な文字列比較で時系列の前後関係を判定する。
 * @param ft 番組の放送開始時刻。
 * @param tt 番組の放送終了時刻。
 * @param currentRadioTime 現在時刻(`getCurrentRadioTime`の戻り値)。
 */
export function getProgramTimeStatus(ft: string, tt: string, currentRadioTime: string): ProgramTimeStatus {
  if (currentRadioTime < ft) {
    return 'future';
  }
  if (currentRadioTime < tt) {
    return 'live';
  }
  return 'past';
}

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
export function formatRadioTimeRange(ft: string, tt: string, pattern: string): string {
  const [datePattern, timePattern = 'HH:mm-HH:mm'] = pattern.split(' ');
  const [startTimePattern, endTimePattern = 'HH:mm'] = timePattern.split('-');

  const ftFields = fieldsFromDate(parseYyyyMMddHHmmss(revCnvRadioTime(ft)));
  const ttFields = fieldsFromDate(parseYyyyMMddHHmmss(revCnvRadioTime(tt)));

  const datePart = formatFields(ftFields, datePattern);
  const startTimePart = formatFields(ftFields, startTimePattern);
  const endTimePart = formatFields(ttFields, endTimePattern);

  return `${datePart} ${startTimePart}-${endTimePart}`;
}

/**
 * `'yyyyMMdd'`形式の日付文字列を任意の書式(曜日を含む書式も可)に整形する。
 * @param dateOnly `'yyyyMMdd'`形式の日付文字列。
 * @param pattern 書式文字列(例: `'M月d日(E)'`)。対応トークンは{@link formatFields}参照。
 */
export function formatDateOnly(dateOnly: string, pattern: string): string {
  return formatFields(fieldsFromDate(parseYyyyMMdd(dateOnly)), pattern);
}

/**
 * `'yyyyMMdd'`形式の日付文字列にN日加算する(負数で減算)。
 * @param dateOnly `'yyyyMMdd'`形式の日付文字列。
 * @param days 加算する日数。
 */
export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const shifted = new Date(parseYyyyMMdd(dateOnly).getTime() + days * 24 * 3600 * 1000);
  return formatFields(fieldsFromDate(shifted), 'yyyyMMdd');
}

/**
 * ラジオ時間表記(`'yyyyMMddHHmmss'`、`24:00`~`29:00`表記を含みうる)の日付部分だけをN日シフトする。
 * 時・分・秒はそのまま維持するため、「同じ時間帯の翌日/翌週の番組」を求める用途(お気に入りの日付ずらし)に使う。
 * @param t シフト元のラジオ時間表記(`'yyyyMMddHHmmss'`)。
 * @param days シフトする日数(負数で過去方向)。
 */
export function addDaysToRadioTime(t: string, days: number): string {
  const parts = parseRadioTime(t);
  const newDate = addDaysToDateOnly(parts.date, days);
  return `${newDate}${parts.hour}${parts.minute}${parts.second}`;
}
