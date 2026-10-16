/**
 * 局ごとのstream XMLから得られる配信エントリ一覧(単一オブジェクト/配列/未定義のいずれか)から、
 * 指定した種別(ライブ/タイムフリー)かつログイン状態に応じたareafreeを優先して1件選択する。
 * 該当がなければその種別の対象の先頭を返す。
 * @param rawEntries stream XMLをパースして得た配信エントリ(単一オブジェクト/配列/未定義のいずれか)。
 * @param isLoggedIn Radikoプレミアム会員としてログイン済みかどうか。
 * @param timeFree 選びたいエントリの種別。`'0'`はライブ配信、`'1'`はタイムフリー配信。
 * @returns 選択された配信エントリ。対象が1件もなければundefined。
 */
export declare function selectLiveEntry(rawEntries: any, isLoggedIn: boolean, timeFree?: '0' | '1'): any | undefined;
//# sourceMappingURL=live-entry-selector.d.ts.map