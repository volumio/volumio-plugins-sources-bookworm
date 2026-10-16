"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpClient = exports.HttpError = void 0;
/**
 * `got`のHTTPErrorに相当するエラー。`error.statusCode`/`error.response.statusCode`/`error.response.body`
 * を参照している既存の呼び出し側コードと互換の形にしている。
 */
class HttpError extends Error {
    statusCode;
    response;
    constructor(message, statusCode, body) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        if (statusCode !== undefined) {
            this.response = { statusCode, body };
        }
    }
}
exports.HttpError = HttpError;
async function collectSetCookies(res, cookieJar, url) {
    const setCookies = res.headers.getSetCookie?.();
    if (setCookies === undefined) {
        return;
    }
    for (const cookie of setCookies) {
        try {
            await cookieJar.setCookie(cookie, url);
        }
        catch {
            // Radiko側のCookie属性がtough-cookieの検証に引っかかっても致命的ではないため無視する
        }
    }
}
async function request(method, url, options = {}) {
    const headers = { ...options.headers };
    let body;
    let currentMethod = method;
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
            }
            else {
                delete headers['cookie'];
            }
        }
        const res = await fetch(currentUrl, { method: currentMethod, headers, body, redirect: 'manual' });
        if (options.cookieJar !== undefined) {
            await collectSetCookies(res, options.cookieJar, currentUrl);
        }
        if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
            currentUrl = new URL(res.headers.get('location'), currentUrl).toString();
            // 302/303はPOSTをGETに変換して追従する(got/ブラウザのデフォルト挙動に合わせる)
            if (currentMethod === 'POST' && (res.status === 302 || res.status === 303)) {
                currentMethod = 'GET';
                body = undefined;
            }
            continue;
        }
        const responseHeaders = Object.fromEntries(res.headers.entries());
        let responseBody;
        if (options.responseType === 'json') {
            responseBody = await res.json();
        }
        else if (options.responseType === 'buffer') {
            responseBody = Buffer.from(await res.arrayBuffer());
        }
        else {
            responseBody = await res.text();
        }
        if (res.status >= 400) {
            throw new HttpError(`Response code ${res.status} (${res.statusText})`, res.status, responseBody);
        }
        return { body: responseBody, headers: responseHeaders, statusCode: res.status };
    }
    throw new HttpError('Too many redirects');
}
exports.httpClient = {
    get: (url, options = {}) => request('GET', url, options),
    post: (url, options = {}) => request('POST', url, options),
};
//# sourceMappingURL=http-client.js.map