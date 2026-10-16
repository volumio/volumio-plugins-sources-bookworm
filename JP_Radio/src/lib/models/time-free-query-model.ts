/**
 * タイムフリー再生に必要な放送区間(ラジオ時間表記、`'yyyyMMddHHmmss'`)。
 */
export interface TimeFreeQuery {
  // 放送開始時刻
  ft: string;
  // 放送終了時刻
  to: string;
}
