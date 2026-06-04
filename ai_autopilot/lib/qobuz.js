'use strict';

/**
 * Minimal Qobuz API client (personal-use track downloading).
 *
 * Credential source is pluggable — the same getFileUrl/download path works
 * whether the app_id/secret/auth-token come from:
 *   (a) the already-authenticated Volumio Qobuz plugin on the device, or
 *   (b) a direct email/password login here.
 *
 * Signing scheme follows the well-known qobuz-dl / streamrip approach:
 *   request_sig = md5("trackgetFileUrlformat_id" + fmt + "intentstreamtrack_id" + id + ts + secret)
 *
 * NOTE: This talks to Qobuz's private API. It is for the user's own personal
 * subscription and personal use only (same footing as streamrip, which this
 * project's handoff doc references). Not for distribution.
 */

const crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');

const API = 'https://www.qobuz.com/api.json/0.2';
const WEB_BASE = 'https://www.qobuz.com';

// Match streamrip/qobuz-dl's browser-like default User-Agent.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0';

// Qobuz format_id quality codes.
const FORMAT = { MP3_320: 5, FLAC_16_44: 6, FLAC_24_96: 7, FLAC_24_192: 27 };

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }

function looksMd5(s) { return /^[0-9a-f]{32}$/i.test(String(s || '')); }

function redactedErrorMessage(err) {
  return String(err && err.message ? err.message : err)
    .replace(/code=[^&\s]+/g, 'code=[redacted]')
    .replace(/[A-Za-z0-9+/=._~-]{40,}/g, '[redacted-long]');
}

// The exact string that gets md5'd for track/getFileUrl. Exposed for testing.
function fileUrlSigString(trackId, formatId, ts, secret) {
  return 'trackgetFileUrlformat_id' + formatId + 'intentstreamtrack_id' + trackId + ts + secret;
}

const PLAY_BASE = 'https://play.qobuz.com';

function apiHeaders(appId, authToken) {
  const h = {
    'User-Agent': UA,
    'Content-Type': 'application/json;charset=UTF-8'
  };
  if (appId) h['X-App-Id'] = String(appId);
  if (authToken) h['X-User-Auth-Token'] = String(authToken);
  return h;
}

async function apiRequest(endpoint, params, headers) {
  const qs = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null) qs.set(k, String(params[k]));
  });
  const res = await fetch(API + '/' + endpoint + '?' + qs.toString(), {
    headers: headers || apiHeaders()
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    let msg = data && data.message ? data.message : '';
    if (!msg && data) msg = JSON.stringify(data).slice(0, 200);
    throw new Error('Qobuz ' + endpoint + ' ' + res.status + (msg ? ': ' + msg : ''));
  }
  return data;
}

function qobuzOAuthAuthorizeUrl(appId, redirectUri, state) {
  if (!appId) throw new Error('Qobuz browser auth: appId is required');
  if (!redirectUri) throw new Error('Qobuz browser auth: redirectUri is required');
  const params = {
    client_id: String(appId),
    redirect_uri: String(redirectUri),
    response_type: 'code'
  };
  if (state) params.state = String(state);
  return WEB_BASE + '/signin/oauth?' + new URLSearchParams(params).toString();
}

function extractUserId(data) {
  const candidates = [
    data && data.user_id,
    data && data.userId,
    data && data.id,
    data && data.user && data.user.id,
    data && data.user && data.user.user_id,
    data && data.user && data.user.userId,
    data && data.user && data.user.account && data.user.account.id
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
  }
  return '';
}

function findAuthField(obj, keys, depth) {
  if (!obj || depth < 0) return '';
  if (typeof obj !== 'object') return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) {
      return String(obj[key]).trim();
    }
  }
  for (const key of Object.keys(obj)) {
    const found = findAuthField(obj[key], keys, depth - 1);
    if (found) return found;
  }
  return '';
}

function parseJsonLoose(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const attempts = [text];
  try { attempts.push(decodeURIComponent(text)); } catch (e) {}
  for (const attempt of attempts) {
    try {
      let parsed = JSON.parse(attempt);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return parsed;
    } catch (e) {}
  }
  return null;
}

function extractQobuzLocalUserAuth(input) {
  const obj = typeof input === 'string' ? parseJsonLoose(input) : input;
  if (!obj || typeof obj !== 'object') return { authToken: '', userId: '' };
  const authToken = findAuthField(obj, [
    'user_auth_token',
    'userAuthToken',
    'auth_token',
    'authToken',
    'access_token',
    'token'
  ], 5);
  const userId = findAuthField(obj, [
    'user_id',
    'userId',
    'user_id_str',
    'id'
  ], 5);
  return { authToken: authToken, userId: userId };
}

async function exchangeQobuzOAuthCode({ appId, authKey, code }) {
  if (!appId) throw new Error('Qobuz browser auth: appId is required');
  if (!authKey) throw new Error('Qobuz browser auth: OAuth private key is required');
  if (!code) throw new Error('Qobuz browser auth: OAuth code is required');
  const tokenData = await apiRequest('oauth/callback', {
    code: code,
    private_key: authKey
  }, apiHeaders(appId));
  const authToken = tokenData && (
    tokenData.user_auth_token ||
    tokenData.userAuthToken ||
    tokenData.token ||
    tokenData.access_token
  );
  if (!authToken) throw new Error('Qobuz browser auth: no user_auth_token in OAuth callback');
  return {
    authToken: String(authToken).trim(),
    userId: extractUserId(tokenData),
    data: tokenData
  };
}

function parseCookies(res) {
  const raw = res && res.headers && typeof res.headers.raw === 'function' ? res.headers.raw()['set-cookie'] : null;
  if (!raw) return [];
  return raw.map((c) => String(c).split(';')[0]).filter(Boolean);
}

function mergeCookieJar(jar, res) {
  parseCookies(res).forEach((cookie) => {
    const name = cookie.split('=')[0];
    jar[name] = cookie;
  });
}

function cookieHeader(jar) {
  return Object.keys(jar).map((k) => jar[k]).join('; ');
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractLoginFormToken(html) {
  const m = String(html || '').match(/id="_token"\s+name="_token"\s+value="([^"]+)"/);
  return m ? htmlDecode(m[1]) : '';
}

async function webFetch(url, options, jar) {
  const opts = Object.assign({}, options || {});
  opts.headers = Object.assign({}, opts.headers || {});
  if (jar && Object.keys(jar).length) opts.headers.Cookie = cookieHeader(jar);
  const res = await fetch(url, opts);
  if (jar) mergeCookieJar(jar, res);
  return res;
}

async function loginWithWebOAuth({ appId, authKey, email, password }) {
  if (!appId) throw new Error('Qobuz web login: appId is required');
  if (!authKey) throw new Error('Qobuz web login: OAuth private key is required');
  const redirectUri = 'http://127.0.0.1:53682/callback';
  const authUrl = qobuzOAuthAuthorizeUrl(appId, redirectUri);
  const jar = {};
  const webHeaders = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  const pageRes = await webFetch(authUrl, {
    redirect: 'follow',
    headers: webHeaders
  }, jar);
  const page = await pageRes.text();
  if (!pageRes.ok) throw new Error('Qobuz web login page ' + pageRes.status);
  const formToken = extractLoginFormToken(page);
  if (!formToken) throw new Error('Qobuz web login: form token not found');

  const body = new URLSearchParams({
    _username: String(email || ''),
    _password: String(password || ''),
    _remember_me: '1',
    _token: formToken
  }).toString();
  const loginRes = await webFetch(WEB_BASE + '/signin/login/check', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': WEB_BASE,
      'Referer': pageRes.url || authUrl,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: body
  }, jar);
  let loginJson = {};
  try { loginJson = await loginRes.json(); } catch (e) {}
  if (loginJson && loginJson.success === false) {
    const msg = loginJson.errorMsg || loginJson.message || loginJson.error || 'authentication failed';
    throw new Error('Qobuz web login failed: ' + msg);
  }
  if (!loginRes.ok && loginRes.status !== 302) {
    throw new Error('Qobuz web login ' + loginRes.status);
  }

  const revisit = await webFetch(authUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: webHeaders
  }, jar);
  const location = revisit.headers.get('location') || '';
  const callbackUrl = new URL(location, WEB_BASE);
  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    throw new Error('Qobuz web login: OAuth code not returned');
  }

  const exchanged = await exchangeQobuzOAuthCode({ appId: appId, authKey: authKey, code: code });
  return { token: exchanged.authToken, data: exchanged.data, userId: exchanged.userId };
}

/**
 * Scrape the Qobuz web player to obtain the public app_id and candidate
 * app secrets (the qobuz-dl / streamrip "spoofer" technique). Returns
 * { appId, authKey, secrets: [...] }. The correct secret is later picked by
 * QobuzClient.pickSecret() via a signed test request.
 *
 * This is the fragile bit — Qobuz occasionally changes the web bundle. If it
 * breaks, app_id/secret can be supplied manually instead.
 */
async function fetchAppConfig() {
  const loginPage = await (await fetch(PLAY_BASE + '/login', { headers: apiHeaders() })).text();
  const bundleMatch = loginPage.match(/<script src="(\/resources\/[^"]+\/bundle\.js)"/);
  if (!bundleMatch) throw new Error('Qobuz spoofer: bundle.js URL not found');
  const bundle = await (await fetch(PLAY_BASE + bundleMatch[1], { headers: apiHeaders() })).text();

  const appIdMatch = bundle.match(/production:\{api:\{appId:"(\d+)"/);
  if (!appIdMatch) throw new Error('Qobuz spoofer: app_id not found');
  const appId = appIdMatch[1];
  const authKeyMatch = bundle.match(/production:\{api:\{appId:"\d+",appSecret:[\s\S]*?privateKey:"([^"]+)"/) ||
    bundle.match(/privateKey:"([^"]+)"/);
  const authKey = authKeyMatch ? authKeyMatch[1] : null;

  // seed per timezone
  const seedRe = /[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g;
  const parts = {}; // timezone -> [seed]
  let m;
  while ((m = seedRe.exec(bundle))) parts[m[2]] = [m[1]];
  const tzs = Object.keys(parts);
  if (!tzs.length) throw new Error('Qobuz spoofer: no seeds found');
  if (tzs.length > 1) {
    // streamrip prioritizes the second seed/timezone pair because Qobuz's
    // bundled ternaries resolve to that branch in practice.
    const second = tzs.splice(1, 1)[0];
    tzs.unshift(second);
  }

  // info + extras per (capitalized) timezone
  const capTzs = tzs.map((tz) => tz.charAt(0).toUpperCase() + tz.slice(1));
  const infoRe = new RegExp('name:"\\w+/(' + capTzs.join('|') + ')",info:"([\\w=]+)",extras:"([\\w=]+)"', 'g');
  while ((m = infoRe.exec(bundle))) {
    const tz = m[1].toLowerCase();
    if (parts[tz]) parts[tz].push(m[2], m[3]);
  }

  const secrets = [];
  for (const tz of tzs) {
    const joined = parts[tz].join('');
    if (joined.length <= 44) continue;
    try {
      const dec = Buffer.from(joined.slice(0, -44), 'base64').toString('utf-8');
      if (dec) secrets.push(dec);
    } catch (e) {}
  }
  if (!secrets.length) throw new Error('Qobuz spoofer: no secret candidates decoded');
  return { appId: appId, authKey: authKey, secrets: secrets };
}


class QobuzClient {
  constructor({ appId, secret, authToken, authKey } = {}) {
    this.appId = appId || null;
    this.secret = secret || null;
    this.authToken = authToken || null;
    this.authKey = authKey || null;
  }

  /** Direct login with email + password. Returns the user_auth_token. */
  async login(email, password) {
    if (!this.appId) throw new Error('Qobuz: appId is required to log in');
    const passwordHash = looksMd5(password) ? String(password) : md5(password);
    let data;
    let legacyErr = null;
    try {
      data = await apiRequest('user/login', {
        email: email,
        password: passwordHash,
        app_id: this.appId
      }, apiHeaders(this.appId));
    } catch (e) {
      legacyErr = e;
      try {
        const oauth = await loginWithWebOAuth({
          appId: this.appId,
          authKey: this.authKey,
          email: email,
          password: password
        });
        data = Object.assign({}, oauth.data || {}, { user_auth_token: oauth.token });
      } catch (oauthErr) {
        throw new Error('Qobuz login failed; legacy=' + redactedErrorMessage(legacyErr) + '; oauth=' + redactedErrorMessage(oauthErr));
      }
    }
    if (!data || !data.user_auth_token) throw new Error('Qobuz login: no user_auth_token in response');
    if (data.user && data.user.credential && !data.user.credential.parameters) {
      throw new Error('Qobuz login: this account is not eligible for track downloads');
    }
    this.authToken = data.user_auth_token;
    return this.authToken;
  }

  /** Log in with a persisted Qobuz user id + auth token pair. */
  async loginWithAuthToken(userId, authToken) {
    if (!this.appId) throw new Error('Qobuz: appId is required to log in');
    const data = await apiRequest('user/login', {
      user_id: userId,
      user_auth_token: authToken,
      app_id: this.appId
    }, apiHeaders(this.appId));
    if (!data || !data.user_auth_token) throw new Error('Qobuz login: no user_auth_token in response');
    this.authToken = data.user_auth_token;
    return this.authToken;
  }

  async _apiRequest(endpoint, params) {
    return apiRequest(endpoint, params, apiHeaders(this.appId, this.authToken));
  }

  /**
   * Resolve a temporary, signed download URL + metadata for one track.
   * Returns { url, format_id, mime_type, sampling_rate, bit_depth, ... }.
   */
  async getFileUrl(trackId, formatId) {
    if (!this.appId || !this.secret) throw new Error('Qobuz: appId and secret are required');
    if (!this.authToken) throw new Error('Qobuz: not authenticated (login or supply authToken)');
    const ts = Date.now() / 1000;
    const sig = md5(fileUrlSigString(trackId, formatId, ts, this.secret));
    return this._apiRequest('track/getFileUrl', {
      request_ts: String(ts),
      request_sig: sig,
      track_id: String(trackId),
      format_id: String(formatId),
      intent: 'stream'
    });
  }

  /**
   * Download one track to destPath. onProgress(fraction 0..1) is called when a
   * content-length is known. Returns { path, info }.
   */
  async downloadTrack(trackId, formatId, destPath, onProgress) {
    const info = await this.getFileUrl(trackId, formatId);
    if (!info || !info.url) {
      throw new Error('Qobuz: no download URL (track not streamable at this quality / sub level?)');
    }
    const res = await fetch(info.url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('Qobuz file download ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      res.body.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(received / total);
      });
      res.body.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.body.pipe(out);
    });
    return { path: destPath, info: info, bytes: received };
  }

  /**
   * Given candidate secrets and a known track id, find the one whose signature
   * Qobuz accepts (wrong secrets return "Invalid Request Signature"). Requires
   * being logged in. Sets and returns the working secret.
   */
  async pickSecret(candidates, testTrackId, formatId) {
    formatId = formatId || FORMAT.FLAC_24_96;
    testTrackId = testTrackId || '19512574';
    let lastErr = null;
    for (const sec of candidates) {
      this.secret = sec;
      try {
        const r = await this.getFileUrl(testTrackId, formatId);
        if (r) return sec; // signature accepted + got a response
      } catch (e) {
        lastErr = e;
        // Wrong secret -> bad signature; anything else means the signature was
        // accepted (e.g. track-specific issue) so this secret is the right one.
        if (!/Invalid Request Signature/i.test(e.message)) return sec;
      }
    }
    this.secret = null;
    throw new Error('Qobuz: no valid app secret found' + (lastErr ? ' (' + lastErr.message + ')' : ''));
  }

  /**
   * One-shot setup: obtain app_id/secret (auto-scrape unless supplied), log in,
   * and validate the secret against testTrackId. After this, getFileUrl/
   * downloadTrack are ready.
   *
   * @param {object} o { email, password, userId, authToken, testTrackId, appId?, secret? }
   */
  async init(o) {
    o = o || {};
    let candidates;
    if (o.appId && o.secret) {
      this.appId = o.appId;
      this.authKey = o.authKey || this.authKey;
      candidates = [o.secret];
      if (!this.authKey) {
        try {
          const cfg = await fetchAppConfig();
          this.authKey = cfg.authKey;
        } catch (e) {}
      }
    } else {
      const cfg = await fetchAppConfig();
      this.appId = o.appId || cfg.appId;
      this.authKey = o.authKey || cfg.authKey;
      candidates = o.secret ? [o.secret] : cfg.secrets;
    }
    if (o.authToken && o.userId) {
      await this.loginWithAuthToken(String(o.userId).trim(), String(o.authToken).trim());
    } else if (o.authToken) {
      this.authToken = String(o.authToken).trim();
    } else {
      await this.login(o.email, o.password);
    }
    this.secret = null;
    await this.pickSecret(candidates, o.testTrackId);
    return { appId: this.appId, secretFound: !!this.secret };
  }
}

module.exports = {
  QobuzClient,
  FORMAT,
  fetchAppConfig,
  qobuzOAuthAuthorizeUrl,
  exchangeQobuzOAuthCode,
  extractQobuzLocalUserAuth,
  fileUrlSigString,
  md5
};
