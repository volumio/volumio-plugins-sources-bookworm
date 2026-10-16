/**
 * 型定義が存在しない`kew`(Promise/Aライブラリ)用のアンビエント宣言。Volumioコアが`.fail()`呼び出しに依存するため使用している。
 */
declare module 'kew' {
  const kew: any;
  export = kew;
}
