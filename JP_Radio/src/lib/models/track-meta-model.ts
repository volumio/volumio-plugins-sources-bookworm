/** 局の現在のトラック情報。Browse一覧表示(radioStations)とexplodeUriの両方で共通して使う。 */
export interface TrackMeta {
  // 番組タイトル
  title: string;
  // パーソナリティ名
  album: string;
  // 表示用アーティスト文字列(地域名/局名 + 放送時間)
  artist: string;
  // アルバムアート画像URL
  albumart: string;
}
