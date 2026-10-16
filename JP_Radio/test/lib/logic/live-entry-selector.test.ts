import { selectLiveEntry } from '@/logic/live-entry-selector';

describe('selectLiveEntry', () => {
  it('ログイン済みならareafree=1のライブ配信を優先する', () => {
    const entries = [
      { '@timefree': '0', '@areafree': '0', url: 'free' },
      { '@timefree': '0', '@areafree': '1', url: 'premium' },
    ];
    expect(selectLiveEntry(entries, true).url).toBe('premium');
  });

  it('未ログインならareafree=0のライブ配信を優先する', () => {
    const entries = [
      { '@timefree': '0', '@areafree': '0', url: 'free' },
      { '@timefree': '0', '@areafree': '1', url: 'premium' },
    ];
    expect(selectLiveEntry(entries, false).url).toBe('free');
  });

  it('希望するareafreeが無ければライブ配信の先頭にフォールバックする', () => {
    const entries = [{ '@timefree': '0', '@areafree': '0', url: 'free' }];
    expect(selectLiveEntry(entries, true).url).toBe('free');
  });

  it('timefree!==0(タイムフリー)のエントリは除外する', () => {
    const entries = [
      { '@timefree': '1', '@areafree': '1', url: 'timefree' },
      { '@timefree': '0', '@areafree': '0', url: 'live' },
    ];
    expect(selectLiveEntry(entries, true).url).toBe('live');
  });

  it('rawEntriesが単一オブジェクトでも扱える', () => {
    const entry = { '@timefree': '0', '@areafree': '0', url: 'only' };
    expect(selectLiveEntry(entry, false).url).toBe('only');
  });

  it('ライブ配信が1件もなければundefinedを返す', () => {
    expect(selectLiveEntry(undefined, true)).toBeUndefined();
  });

  it('エントリはあってもすべてタイムフリーならundefinedを返す', () => {
    const entries = [{ '@timefree': '1', '@areafree': '1', url: 'timefree' }];
    expect(selectLiveEntry(entries, true)).toBeUndefined();
  });

  it('timefree=1を指定するとタイムフリー配信を選ぶ', () => {
    const entries = [
      { '@timefree': '0', '@areafree': '0', url: 'live' },
      { '@timefree': '1', '@areafree': '0', url: 'timefree-free' },
      { '@timefree': '1', '@areafree': '1', url: 'timefree-premium' },
    ];
    expect(selectLiveEntry(entries, true, '1').url).toBe('timefree-premium');
  });

  it('timefree=1でライブ配信しかなければundefinedを返す', () => {
    const entries = [{ '@timefree': '0', '@areafree': '0', url: 'live' }];
    expect(selectLiveEntry(entries, true, '1')).toBeUndefined();
  });
});
