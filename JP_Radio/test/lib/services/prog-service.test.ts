import RdkProg from '@/services/prog-service';
import { httpClient } from '@/utils/http-client';
import { LoggerEx } from '@/utils/logger';

jest.mock('@/utils/http-client', () => ({
  httpClient: { get: jest.fn() },
}));

const mockGet = httpClient.get as jest.Mock;

/**
 * `PROG_DAILY_STATION_URL`(program/station/date/{date}/{station}.xml)相当のレスポンス。
 */
function dailyStationXml(id: string, ft: string, to: string, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<radiko>
  <stations>
    <station>
      <progs>
        <prog id="${id}" ft="${ft}" to="${to}">
          <title>${title}</title>
          <pfm>パーソナリティ</pfm>
          <img>http://example.com/img.png</img>
        </prog>
      </progs>
    </station>
  </stations>
</radiko>`;
}

describe('RdkProg (30日表示期間で週次APIの範囲外の日付を補う機能)', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('getStationProgramsForDate: 指定日のURLを組み立て(date, station)の順で呼び、番組データを返す', async () => {
    mockGet.mockResolvedValue({
      body: dailyStationXml('1234', '20260601050000', '20260601060000', '朝の番組'),
      headers: {},
      statusCode: 200,
    });

    const logger = new LoggerEx(console as unknown as Console);
    const prog = new RdkProg(logger);

    const result = await prog.getStationProgramsForDate('TBS', '20260601');

    expect(mockGet).toHaveBeenCalledTimes(1);
    const calledUrl = mockGet.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/20260601/TBS.xml');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      station: 'TBS',
      id: 'TBS1234',
      ft: '20260601050000',
      tt: '20260601060000',
      title: '朝の番組',
    });
  });

  it('getStationProgramsForDates: 複数日分を並列取得し、結果を1つの配列にまとめる', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('/20260610/')) {
        return { body: dailyStationXml('1', '20260610050000', '20260610060000', '番組A'), headers: {}, statusCode: 200 };
      }
      if (url.includes('/20260611/')) {
        return { body: dailyStationXml('2', '20260611050000', '20260611060000', '番組B'), headers: {}, statusCode: 200 };
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const logger = new LoggerEx(console as unknown as Console);
    const prog = new RdkProg(logger);

    const result = await prog.getStationProgramsForDates('TBS', ['20260610', '20260611']);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.map((p) => p.title).sort()).toEqual(['番組A', '番組B']);
  });
});
