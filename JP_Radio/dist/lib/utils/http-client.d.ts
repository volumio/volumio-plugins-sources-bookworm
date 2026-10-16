import { CookieJar } from 'tough-cookie';
/**
 * `got`から移行した最小限のHTTPクライアント。Node標準の`fetch`を使い、`tough-cookie`の`CookieJar`との
 * 連携(Cookie送信・リダイレクト時を含むSet-Cookie捕捉)のみ自前で行う。Radiko APIとのやり取りに
 * 必要な範囲(GET/POST・form送信・json/buffer/text応答・cookieJar)に限定した実装で、汎用のHTTPクライアント
 * 機能(リトライ・キャッシュ等)は持たない。
 */
export interface HttpResponse<T = string> {
    body: T;
    headers: Record<string, string>;
    statusCode: number;
}
export interface HttpRequestOptions {
    headers?: Record<string, string>;
    cookieJar?: CookieJar;
    form?: Record<string, string>;
    responseType?: 'json' | 'buffer';
}
/**
 * `got`のHTTPErrorに相当するエラー。`error.statusCode`/`error.response.statusCode`/`error.response.body`
 * を参照している既存の呼び出し側コードと互換の形にしている。
 */
export declare class HttpError extends Error {
    statusCode?: number;
    response?: {
        statusCode: number;
        body: unknown;
    };
    constructor(message: string, statusCode?: number, body?: unknown);
}
export declare const httpClient: {
    get: (url: string, options?: HttpRequestOptions) => Promise<HttpResponse<any>>;
    post: (url: string, options?: HttpRequestOptions) => Promise<HttpResponse<any>>;
};
//# sourceMappingURL=http-client.d.ts.map