import { messageCatalog } from '@/utils/message-catalog';

describe('messageCatalog', () => {
  it('プレースホルダの無いメッセージをそのまま返す', () => {
    expect(messageCatalog.get('APP_TITLE')).toBe('JP Radio');
  });

  it('push_messages.ja.iniの{0}形式プレースホルダを置換する', () => {
    expect(messageCatalog.get('ERROR_PORT_IN_USE', 3000)).toBe(
      'ポート 3000 はすでに使用中です。JP Radio を開始できません。',
    );
  });

  it('複数箇所のプレースホルダも1つの引数で置換できる', () => {
    expect(messageCatalog.get('PROGRAM_DATA_DONE', 1234)).toBe('番組データ：取得完了！ 1234ms');
  });

  it('browse_texts.ja.iniのキーも読み込める', () => {
    expect(messageCatalog.get('BROWSE_LABEL_LIVE')).toBe('ライブ');
  });

  it('未知のメッセージIDは[Unknown message ID: ...]を返す', () => {
    expect(messageCatalog.get('NO_SUCH_KEY')).toBe('[Unknown message ID: NO_SUCH_KEY]');
  });

  it('プレースホルダに対応する引数が無ければ{n}のまま残す', () => {
    expect(messageCatalog.get('ERROR_PORT_IN_USE')).toBe('ポート {0} はすでに使用中です。JP Radio を開始できません。');
  });
});
