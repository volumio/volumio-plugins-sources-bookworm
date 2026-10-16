import { toArray } from '@/utils/xml';

describe('toArray', () => {
  it('配列はそのまま返す', () => {
    const input = [{ id: '1' }, { id: '2' }];
    expect(toArray(input)).toEqual(input);
  });

  it('単一オブジェクトは配列に包む', () => {
    const input = { id: '1' };
    expect(toArray(input)).toEqual([input]);
  });

  it('undefinedは空配列にする', () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it('空配列はそのまま空配列', () => {
    expect(toArray([])).toEqual([]);
  });
});
