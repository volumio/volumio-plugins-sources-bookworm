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
export class HttpError extends Error {
  statusCode?: number;
  response?: { statusCode: number; body: unknown };

  constructor(message: string, statusCode?: number, body?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    if (statusCode !== undefined) {
      this.response = { statusCode, body };
    }
  }
}

async function collectSetCookies(res: Response, cookieJar: CookieJar, url: string): Promise<void> {
  const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (setCookies === undefined) {
    return;
  }
  for (const cookie of setCookies) {
    try {
      await cookieJar.setCookie(cookie, url);
    } catch {
      // Radiko側のCookie属性がtough-cookieの検証に引っかかっても致命的ではないため無視する
    }
  }
}

async function request(method: 'GET' | 'POST', url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<any>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined;
  let currentMethod: 'GET' | 'POST' = method;

  if (options.form !== undefined) {
    body = new URLSearchParams(options.form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }

  let currentUrl = url;
  for (let redirectCount = 0; redirectCount < 10; redirectCount++) {
    if (options.cookieJar !== undefined) {
      const cookie = await options.cookieJar.getCookieString(currentUrl);
      if (cookie !== '') {
        headers['cookie'] = cookie;
      } else {
        delete headers['cookie'];
      }
    }

    const res = await fetch(currentUrl, { method: currentMethod, headers, body, redirect: 'manual' });

    if (options.cookieJar !== undefined) {
      await collectSetCookies(res, options.cookieJar, currentUrl);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      currentUrl = new URL(res.headers.get('location')!, currentUrl).toString();
      // 302/303はPOSTをGETに変換して追従する(got/ブラウザのデフォルト挙動に合わせる)
      if (currentMethod === 'POST' && (res.status === 302 || res.status === 303)) {
        currentMethod = 'GET';
        body = undefined;
      }
      continue;
    }

    const responseHeaders = Object.fromEntries(res.headers.entries());
    let responseBody: any;
    if (options.responseType === 'json') {
      responseBody = await res.json();
    } else if (options.responseType === 'buffer') {
      responseBody = Buffer.from(await res.arrayBuffer());
    } else {
      responseBody = await res.text();
    }

    if (res.status >= 400) {
      throw new HttpError(`Response code ${res.status} (${res.statusText})`, res.status, responseBody);
    }

    return { body: responseBody, headers: responseHeaders, statusCode: res.status };
  }

  throw new HttpError('Too many redirects');
}

export const httpClient = {
  get: (url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<any>> => request('GET', url, options),
  post: (url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<any>> => request('POST', url, options),
};
