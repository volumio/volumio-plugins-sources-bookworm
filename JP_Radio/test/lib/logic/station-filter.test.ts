import type { StationInfo } from '@/models/station-model';
import { isStationRelevantForArea, isDuplicateAreaFreeStation } from '@/logic/station-filter';

function makeStation(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    regionName: '関東',
    bannerUrl: '',
    areaId: 'JP13',
    areaName: 'TOKYO',
    areaKanji: '東京',
    name: 'TBSラジオ',
    asciiName: 'TBS RADIO',
    areaFree: '0',
    logoUrl: '',
    ...overrides,
  };
}

describe('isStationRelevantForArea', () => {
  it('所属エリアと一致する一般局はtrue', () => {
    const station = makeStation({ areaId: 'JP13', areaFree: '0', regionName: '関東' });
    expect(isStationRelevantForArea(station, 'JP13')).toBe(true);
  });

  it('所属エリアと異なりareaFreeでない一般局はfalse', () => {
    const station = makeStation({ areaId: 'JP13', areaFree: '1', regionName: '関東' });
    expect(isStationRelevantForArea(station, 'JP14')).toBe(false);
  });

  it('所属エリアと異なってもNHK地方局(areaFree===0)はtrue', () => {
    const station = makeStation({ areaId: 'JP13', areaFree: '0', regionName: '関東' });
    expect(isStationRelevantForArea(station, 'JP14')).toBe(true);
  });

  it('全国広域局はJP13取得時のみtrue', () => {
    const station = makeStation({ areaId: 'JP13', areaFree: '1', regionName: '全国' });
    expect(isStationRelevantForArea(station, 'JP13')).toBe(true);
    expect(isStationRelevantForArea(station, 'JP14')).toBe(false);
  });
});

describe('isDuplicateAreaFreeStation', () => {
  it('NHK地方局(areaFree===0)で処理済みならtrue', () => {
    const station = makeStation({ areaFree: '0' });
    const doneAreaFree = new Set(['JOAK']);
    expect(isDuplicateAreaFreeStation(station, 'JOAK', doneAreaFree)).toBe(true);
  });

  it('NHK地方局でも未処理ならfalse', () => {
    const station = makeStation({ areaFree: '0' });
    const doneAreaFree = new Set<string>();
    expect(isDuplicateAreaFreeStation(station, 'JOAK', doneAreaFree)).toBe(false);
  });

  it('areaFreeでない局は処理済みリストにあってもfalse', () => {
    const station = makeStation({ areaFree: '1' });
    const doneAreaFree = new Set(['TBS']);
    expect(isDuplicateAreaFreeStation(station, 'TBS', doneAreaFree)).toBe(false);
  });
});
