/**
 * getStations()などで使う、XMLパース後の地域データ
 */
export interface RegionData {
    region_name: string;
    region_id: string;
    ascii_name: string;
    stations: Array<{
        id: string;
        name: string;
        ascii_name: string;
        areafree: string;
        timefree: string;
        banner: string;
        area_id: string;
        logo_url: string;
    }>;
}
/**
 * stations Map に格納する局データ
 */
export interface StationInfo {
    regionName: string;
    bannerUrl: string;
    areaId: string;
    areaName: string;
    areaKanji: string;
    name: string;
    asciiName: string;
    areaFree: string;
    logoUrl: string;
}
//# sourceMappingURL=station-model.d.ts.map