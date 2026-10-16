/**
 * getStations()などで使う、XMLパース後の地域データ
 */
export interface RegionData {
  // 地域名（例: '関東'）
  region_name: string;
  region_id: string;
  ascii_name: string;
  stations: Array<{
    // 局ID（例: 'TBS'）
    id: string;
    // 局名（例: 'TBSラジオ'）
    name: string;
    // アスキー名（例: 'TBS RADIO'）
    ascii_name: string;
    // エリアフリー対応可否（例: '1'）
    areafree: string;
    timefree: string;
    // バナー画像URL
    banner: string;
    // 所属エリアID（例: 'JP13'）
    area_id: string;
    // ロゴ画像URL（XMLの`<logo>`要素のうち最大幅のもの。取得できない場合は空文字列）
    logo_url: string;
  }>;
}

/**
 * stations Map に格納する局データ
 */
export interface StationInfo {
  // 地域名（例: '関東'）
  regionName: string;
  // バナー画像URL
  bannerUrl: string;
  // 所属エリアID（例: 'JP13'）
  areaId: string;
  // エリア名（英語、例: 'TOKYO'）
  areaName: string;
  // エリア名（漢字、例: '東京'）
  areaKanji: string;
  // 局名（例: 'TBSラジオ'）
  name: string;
  // アスキー名（例: 'TBS RADIO'）
  asciiName: string;
  // エリアフリー対応可否（例: '1'）
  areaFree: string;
  // 局ロゴ画像URL（ローカルキャッシュ成功時はキャッシュ先の`/albumart?sourceicon=...`URL、失敗時はRadikoのリモートURL）
  logoUrl: string;
}
