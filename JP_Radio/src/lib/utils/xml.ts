/**
 * fast-xml-parserは要素が1件のときは単一オブジェクト、複数件のときは配列を返すため、
 * どちらの場合でも配列として扱えるように正規化する。要素が存在しない場合は空配列を返す。
 * @param value fast-xml-parserがパースした値(単一オブジェクト/配列/未定義のいずれか)。
 * @returns 常に配列化された値。
 */
export function toArray(value: any): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value !== undefined) {
    return [value];
  }
  return [];
}
