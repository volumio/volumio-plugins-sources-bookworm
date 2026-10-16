import type { StationInfo } from '@/models/station-model';

/**
 * 指定エリアの番組表取得において、この局を処理対象とすべきかを判定する。
 * 一般局は所属エリアと一致する場合のみ、全国広域局(RN1/RN2/JOAK-FM等、regionName==='全国')は
 * JP13の取得時のみを対象とする。
 * @param station 判定対象の局情報。
 * @param areaId 現在取得中の番組表のエリアID(例: `'JP13'`)。
 * @returns この局をこのエリアの番組表取得対象に含めるべきならtrue。
 */
export function isStationRelevantForArea(station: StationInfo, areaId: string): boolean {
  if (station.areaId !== areaId && station.areaFree !== '0') {
    return false;
  }
  if (station.regionName === '全国' && areaId !== 'JP13') {
    return false;
  }
  return true;
}

/**
 * NHK地方局(areaFree==='0')は複数エリアの番組表に重複して登場するため、
 * 既に処理済みのstationIdかどうかを判定する(処理済みの記録自体は呼び出し側が行う)。
 * @param station 判定対象の局情報。
 * @param stationId 判定対象の局ID。
 * @param doneAreaFree これまでに処理済みのstationIdの集合。
 * @returns 既に処理済みのNHK地方局であればtrue(呼び出し側はスキップすべき)。
 */
export function isDuplicateAreaFreeStation(
  station: StationInfo,
  stationId: string,
  doneAreaFree: ReadonlySet<string>,
): boolean {
  if (station.areaFree === '0' && doneAreaFree.has(stationId)) {
    return true;
  }
  return false;
}
