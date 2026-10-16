import { resolveAreaIdArray, resolveAreaFilter } from '@/logic/area-resolver';

describe('resolveAreaIdArray', () => {
  it('AreaFree会員なら全国47エリアを返す', () => {
    const result = resolveAreaIdArray('JP13/AreaFree', []);
    expect(result).toHaveLength(47);
    expect(result[0]).toBe('JP1');
    expect(result[46]).toBe('JP47');
  });

  it('AreaFreeでなければ局一覧に実在するエリアIDを返す', () => {
    expect(resolveAreaIdArray('JP13/premium', ['JP13', 'JP14'])).toEqual(['JP13', 'JP14']);
  });

  it('局一覧のエリアIDが空なら自エリア+JP13にフォールバックする', () => {
    expect(resolveAreaIdArray('JP27/premium', [])).toEqual(['JP27', 'JP13']);
  });

  it('myAreaIdが未指定でも局一覧のエリアIDがあればそれを使う', () => {
    expect(resolveAreaIdArray(undefined, ['JP5'])).toEqual(['JP5']);
  });

  it('myAreaIdも局一覧のエリアIDもない場合(既知のエッジケース)', () => {
    // myAreaId未指定 かつ 局一覧が空の場合、自エリアIDにあたる要素がundefinedになる
    // (現状の実装通りの挙動を確認するテスト。実運用では起こりにくい組み合わせ)
    expect(resolveAreaIdArray(undefined, [])).toEqual([undefined, 'JP13']);
  });

  it('AreaFree会員が設定画面でエリアを選択していれば、そのエリアのみを返す', () => {
    expect(resolveAreaIdArray('JP13/AreaFree', [], ['JP13', 'JP27'])).toEqual(['JP13', 'JP27']);
  });

  it('AreaFree会員でも選択エリアが空なら全国47エリアを返す', () => {
    const result = resolveAreaIdArray('JP13/AreaFree', [], []);
    expect(result).toHaveLength(47);
  });
});

describe('resolveAreaFilter', () => {
  it('AreaFree会員がエリアを選択していれば、そのエリアID集合を返す(局一覧を絞り込む)', () => {
    const result = resolveAreaFilter('JP13/AreaFree', ['JP27']);
    expect(result).toEqual(new Set(['JP27']));
  });

  it('AreaFree会員でも選択エリアが空なら絞り込みなし(null)を返す', () => {
    expect(resolveAreaFilter('JP13/AreaFree', [])).toBeNull();
  });

  it('AreaFree会員でなければ、選択エリアがあっても絞り込みなし(null)を返す', () => {
    expect(resolveAreaFilter('JP13/premium', ['JP27'])).toBeNull();
  });

  it('myAreaIdが未指定でも選択エリアがあれば無視して絞り込みなし(null)を返す', () => {
    expect(resolveAreaFilter(undefined, ['JP27'])).toBeNull();
  });
});
