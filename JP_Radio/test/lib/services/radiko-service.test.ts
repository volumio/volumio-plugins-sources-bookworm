import Radiko from '@/services/radiko-service';
import { httpClient } from '@/utils/http-client';
import { LoggerEx } from '@/utils/logger';

jest.mock('@/utils/http-client', () => ({
  httpClient: { get: jest.fn() },
}));

const mockGet = httpClient.get as jest.Mock;

/**
 * `STATION_FULL_URL`(region/full.xml)相当のレスポンス。
 * FM802は`<id>FM802</id>`という英数字表記のため、fast-xml-parserは文字列のまま解釈する。
 */
const FULL_STATIONS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<region>
  <stations region_name="関東" region_id="1" ascii_name="TOKYO">
    <station>
      <id>TBS</id>
      <name>TBSラジオ</name>
      <ascii_name>TBS RADIO</ascii_name>
      <areafree>0</areafree>
      <timefree>1</timefree>
      <area_id>JP13</area_id>
    </station>
    <station>
      <id>QRR</id>
      <name>文化放送</name>
      <ascii_name>bunka housou</ascii_name>
      <areafree>0</areafree>
      <timefree>1</timefree>
      <area_id>JP13</area_id>
    </station>
  </stations>
  <stations region_name="近畿" region_id="5" ascii_name="OSAKA">
    <station>
      <id>FM802</id>
      <name>FM802</name>
      <ascii_name>FM802</ascii_name>
      <areafree>0</areafree>
      <timefree>0</timefree>
      <area_id>JP27</area_id>
    </station>
    <station>
      <id>MBS</id>
      <name>MBSラジオ</name>
      <ascii_name>MBS RADIO</ascii_name>
      <areafree>0</areafree>
      <timefree>1</timefree>
      <area_id>JP27</area_id>
    </station>
  </stations>
</region>`;

/**
 * `STATION_AREA_URL`(station/list/{area}.xml)相当のレスポンスを組み立てる。
 * @param areaName エリア名(`@area_name`属性)。
 * @param ids 局IDの一覧。数字のみの値(例: `802`)はfast-xml-parserにより数値として解釈される
 *   ため、実際のRadikoのエリア別フィードでFM802が`802`という数値表記で返ってくる状況を再現できる。
 */
function areaStationsXml(areaName: string, ids: Array<string | number>): string {
  const stations = ids.map((id) => `<station><id>${id}</id></station>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><stations area_name="${areaName}">${stations}</stations>`;
}

describe('Radiko.getStations (GitHub issue #21: FM802が表示されない)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('region/full.xml')) {
        return { body: FULL_STATIONS_XML, headers: {}, statusCode: 200 };
      }
      if (url.includes('/list/JP27.xml')) {
        // 大阪エリアのエリア別フィードでは、FM802は`802`という数値表記で返ってくる
        return { body: areaStationsXml('OSAKA', [802, 'MBS']), headers: {}, statusCode: 200 };
      }
      // 他のエリアはダミー局2件(fast-xml-parserは要素が1件だと配列でなくオブジェクトにするため2件にする)
      return { body: areaStationsXml('DUMMY', ['DUMMY1', 'DUMMY2']), headers: {}, statusCode: 200 };
    });
  });

  it('非プレミアム(エリアのみ)ユーザーでも、大阪エリア(JP27)でFM802が局一覧に含まれる', async () => {
    const logger = new LoggerEx(console as unknown as Console);
    const radiko = new Radiko(logger, 9000);
    // getToken()/auth1/auth2(実際のRadiko認証)を経由せず、エリア判定だけを直接検証する
    (radiko as any).areaId = 'JP27';

    await (radiko as any).getStations();

    // フル局データ側の'FM802'表記は、エリア別フィード側の'802'表記に合わせて正規化される
    expect(radiko.stations.has('802')).toBe(true);
    expect(radiko.stations.has('FM802')).toBe(false);
  });
});
