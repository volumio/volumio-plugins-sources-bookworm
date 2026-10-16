import type { LoginAccount } from '../models/auth-model';
/**
 * UI設定画面のRadikoアカウント情報からログインアカウントを構築する。
 * どちらか一方でも未設定/空文字の場合はプレミアム未使用としてnullを返す。
 * @param radikoUser 設定画面で入力されたRadikoアカウントのメールアドレス。
 * @param radikoPass 設定画面で入力されたRadikoアカウントのパスワード。
 * @returns 両方とも有効な値であれば{@link LoginAccount}、そうでなければnull。
 */
export declare function createLoginAccount(radikoUser: string | undefined, radikoPass: string | undefined): LoginAccount | null;
//# sourceMappingURL=auth.d.ts.map