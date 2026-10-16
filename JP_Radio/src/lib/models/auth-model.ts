/**
 * UI設定画面で保存するRadikoプレミアム会員のログイン情報。
 */
export interface LoginAccount {
  mail: string;
  pass: string;
}

/**
 * `CHECK_URL`(ログイン状態確認API)のレスポンスボディ。
 */
export interface LoginState {
  // 会員種別(例: 'premium', 'fp'など)
  member_type: {
    type: string;
  };
  // 他のプロパティがある場合の保険
  [key: string]: any;
}
