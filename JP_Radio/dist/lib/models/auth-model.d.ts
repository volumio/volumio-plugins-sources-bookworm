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
    member_type: {
        type: string;
    };
    [key: string]: any;
}
//# sourceMappingURL=auth-model.d.ts.map