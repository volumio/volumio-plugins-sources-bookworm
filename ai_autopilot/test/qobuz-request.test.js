'use strict';

const assert = require('assert');
const Module = require('module');

function installFetchMock(fetchImpl) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'node-fetch') return fetchImpl;
    return originalLoad.call(this, request, parent, isMain);
  };
  return function restore() {
    Module._load = originalLoad;
  };
}

function loadQobuzWithFetch(fetchImpl) {
  const restore = installFetchMock(fetchImpl);
  const qobuzPath = require.resolve('../lib/qobuz');
  delete require.cache[qobuzPath];
  const mod = require('../lib/qobuz');
  restore();
  return mod;
}

function headers(overrides) {
  const values = Object.assign({}, overrides || {});
  return {
    get: (name) => values[String(name).toLowerCase()] || values[String(name)] || null,
    raw: () => {
      const cookie = values['set-cookie'] || values['Set-Cookie'];
      return cookie ? { 'set-cookie': Array.isArray(cookie) ? cookie : [cookie] } : {};
    }
  };
}

function response({ ok = true, status = 200, json, text, headers: headerValues, url }) {
  return {
    ok,
    status,
    url: url || '',
    headers: headers(headerValues),
    json: async () => json,
    text: async () => text || ''
  };
}

function b64Secret(secret) {
  return Buffer.from(secret, 'utf8').toString('base64') + 'x'.repeat(44);
}

function split3(s) {
  const a = Math.ceil(s.length / 3);
  const b = Math.ceil((s.length - a) / 2);
  return [s.slice(0, a), s.slice(a, a + b), s.slice(a + b)];
}

async function testLoginMatchesStreamripGetRequest() {
  const calls = [];
  const fetchMock = async (requestUrl, options) => {
    calls.push({ requestUrl, options: options || {} });
    return response({
      json: {
        user_auth_token: 'token-123',
        user: { credential: { parameters: { short_label: 'Studio' } } }
      }
    });
  };

  const { QobuzClient, md5 } = loadQobuzWithFetch(fetchMock);
  const client = new QobuzClient({ appId: '123456789' });
  await client.login('person@example.com', 'plain-password');

  assert.strictEqual(calls.length, 1);
  const first = calls[0];
  assert.strictEqual(first.options.method, undefined, 'streamrip sends user/login as GET');
  assert.strictEqual(first.options.body, undefined, 'streamrip sends login fields as query params');
  assert.ok(first.requestUrl.startsWith('https://www.qobuz.com/api.json/0.2/user/login?'));

  const parsed = new URL(first.requestUrl);
  assert.strictEqual(parsed.searchParams.get('email'), 'person@example.com');
  assert.strictEqual(parsed.searchParams.get('password'), md5('plain-password'));
  assert.strictEqual(parsed.searchParams.get('app_id'), '123456789');
  assert.strictEqual(first.options.headers['X-App-Id'], '123456789');
  assert.strictEqual(first.options.headers['User-Agent'], 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0');
  assert.strictEqual(first.options.headers['Content-Type'], 'application/json;charset=UTF-8');
}

async function testSpooferPrioritizesSecondTimezoneSecret() {
  const secretA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const secretB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const [a1, a2, a3] = split3(b64Secret(secretA));
  const [b1, b2, b3] = split3(b64Secret(secretB));
  const loginPage = '<script src="/resources/1.2.3-a123/bundle.js"></script>';
  const bundle = [
    'production:{api:{appId:"123456789",appSecret:"0123456789abcdef0123456789abcdef"',
    'privateKey:"oauth-private-key"',
    'a.initialSeed("' + a1 + '",window.utimezone.europe)',
    'b.initialSeed("' + b1 + '",window.utimezone.america)',
    'name:"x/Europe",info:"' + a2 + '",extras:"' + a3 + '"',
    'name:"x/America",info:"' + b2 + '",extras:"' + b3 + '"'
  ].join(';');

  const fetchMock = async (requestUrl) => ({
    ok: true,
    status: 200,
    headers: headers(),
    text: async () => String(requestUrl).endsWith('/login') ? loginPage : bundle
  });

  const { fetchAppConfig } = loadQobuzWithFetch(fetchMock);
  const cfg = await fetchAppConfig();

  assert.deepStrictEqual(cfg, {
    appId: '123456789',
    authKey: 'oauth-private-key',
    secrets: [secretB, secretA]
  });
}

async function testLoginFallsBackToWebOAuth() {
  const calls = [];
  const fetchMock = async (requestUrl, options) => {
    const url = String(requestUrl);
    calls.push({ requestUrl: url, options: options || {} });

    if (url.startsWith('https://www.qobuz.com/api.json/0.2/user/login?')) {
      return response({
        ok: false,
        status: 401,
        json: { message: 'User authentication is required. (Root=abcdefghijklmnopqrstuvwxyz0123456789abcdefgh)' }
      });
    }
    if (url.startsWith('https://www.qobuz.com/signin/oauth?')) {
      if ((options || {}).redirect === 'manual') {
        return response({
          ok: false,
          status: 302,
          headers: { location: 'http://127.0.0.1:53682/callback?code=oauth-code-123' }
        });
      }
      return response({
        url: url,
        headers: { 'set-cookie': 'qobuz-session=session-cookie; Path=/; HttpOnly' },
        text: '<form><input type="hidden" id="_token" name="_token" value="form-token-123" /></form>'
      });
    }
    if (url === 'https://www.qobuz.com/signin/login/check') {
      assert.strictEqual((options || {}).method, 'POST');
      assert.ok(String((options || {}).body).includes('_username=person%40example.com'));
      assert.ok(String((options || {}).body).includes('_password=plain-password'));
      assert.ok((options || {}).headers.Cookie.includes('qobuz-session=session-cookie'));
      return response({
        json: { success: true },
        headers: { 'set-cookie': 'qobuz-auth=auth-cookie; Path=/; HttpOnly' }
      });
    }
    if (url.startsWith('https://www.qobuz.com/api.json/0.2/oauth/callback?')) {
      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('code'), 'oauth-code-123');
      assert.strictEqual(parsed.searchParams.get('private_key'), 'oauth-private-key');
      return response({
        json: {
          token: 'oauth-token-456',
          user: { credential: { parameters: { short_label: 'Studio' } } }
        }
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const { QobuzClient } = loadQobuzWithFetch(fetchMock);
  const client = new QobuzClient({ appId: '123456789', authKey: 'oauth-private-key' });
  const token = await client.login('person@example.com', 'plain-password');

  assert.strictEqual(token, 'oauth-token-456');
  assert.strictEqual(client.authToken, 'oauth-token-456');
  assert.strictEqual(calls.length, 5);
}

async function testWebOAuthInvalidCredentialsAreRedacted() {
  const fetchMock = async (requestUrl, options) => {
    const url = String(requestUrl);
    if (url.startsWith('https://www.qobuz.com/api.json/0.2/user/login?')) {
      return response({
        ok: false,
        status: 401,
        json: { message: 'User authentication is required. (Root=abcdefghijklmnopqrstuvwxyz0123456789abcdefgh)' }
      });
    }
    if (url.startsWith('https://www.qobuz.com/signin/oauth?')) {
      return response({
        url: url,
        text: '<input type="hidden" id="_token" name="_token" value="form-token-123" />'
      });
    }
    if (url === 'https://www.qobuz.com/signin/login/check') {
      return response({ json: { success: false, errorMsg: 'Email or password invalid' } });
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const { QobuzClient } = loadQobuzWithFetch(fetchMock);
  const client = new QobuzClient({ appId: '123456789', authKey: 'oauth-private-key' });
  await assert.rejects(
    () => client.login('person@example.com', 'wrong-password'),
    (err) => {
      assert.ok(/Email or password invalid/.test(err.message));
      assert.ok(!/abcdefghijklmnopqrstuvwxyz0123456789abcdefgh/.test(err.message));
      return true;
    }
  );
}

async function testInitCanUsePersistedAuthToken() {
  const calls = [];
  const secret = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const [s1, s2, s3] = split3(b64Secret(secret));
  const loginPage = '<script src="/resources/1.2.3-a123/bundle.js"></script>';
  const bundle = [
    'production:{api:{appId:"123456789",appSecret:"0123456789abcdef0123456789abcdef"',
    'privateKey:"oauth-private-key"',
    'a.initialSeed("' + s1 + '",window.utimezone.europe)',
    'name:"x/Europe",info:"' + s2 + '",extras:"' + s3 + '"'
  ].join(';');

  const fetchMock = async (requestUrl, options) => {
    const url = String(requestUrl);
    calls.push({ requestUrl: url, options: options || {} });
    if (url === 'https://play.qobuz.com/login') {
      return response({ text: loginPage });
    }
    if (url === 'https://play.qobuz.com/resources/1.2.3-a123/bundle.js') {
      return response({ text: bundle });
    }
    if (url.startsWith('https://www.qobuz.com/api.json/0.2/track/getFileUrl?')) {
      assert.strictEqual((options || {}).headers['X-User-Auth-Token'], 'saved-token-123');
      return response({ json: { url: 'https://cdn.example/track.flac' } });
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const { QobuzClient } = loadQobuzWithFetch(fetchMock);
  const client = new QobuzClient();
  await client.init({ authToken: 'saved-token-123', testTrackId: '762667' });

  assert.strictEqual(client.authToken, 'saved-token-123');
  assert.ok(client.secret);
  assert.strictEqual(calls.some((c) => c.requestUrl.includes('/user/login?')), false);
}

async function testInitCanUseStreamripAuthTokenLogin() {
  const calls = [];
  const secret = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const [s1, s2, s3] = split3(b64Secret(secret));
  const loginPage = '<script src="/resources/1.2.3-a123/bundle.js"></script>';
  const bundle = [
    'production:{api:{appId:"123456789",appSecret:"0123456789abcdef0123456789abcdef"',
    'privateKey:"oauth-private-key"',
    'a.initialSeed("' + s1 + '",window.utimezone.europe)',
    'name:"x/Europe",info:"' + s2 + '",extras:"' + s3 + '"'
  ].join(';');

  const fetchMock = async (requestUrl, options) => {
    const url = String(requestUrl);
    calls.push({ requestUrl: url, options: options || {} });
    if (url === 'https://play.qobuz.com/login') {
      return response({ text: loginPage });
    }
    if (url === 'https://play.qobuz.com/resources/1.2.3-a123/bundle.js') {
      return response({ text: bundle });
    }
    if (url.startsWith('https://www.qobuz.com/api.json/0.2/user/login?')) {
      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('user_id'), 'saved-user-id');
      assert.strictEqual(parsed.searchParams.get('user_auth_token'), 'saved-token-123');
      assert.strictEqual(parsed.searchParams.get('app_id'), '123456789');
      assert.strictEqual((options || {}).headers['X-App-Id'], '123456789');
      assert.strictEqual((options || {}).headers['X-User-Auth-Token'], undefined);
      return response({
        json: {
          user_auth_token: 'refreshed-token-456',
          user: { credential: { parameters: { short_label: 'Studio' } } }
        }
      });
    }
    if (url.startsWith('https://www.qobuz.com/api.json/0.2/track/getFileUrl?')) {
      assert.strictEqual((options || {}).headers['X-User-Auth-Token'], 'refreshed-token-456');
      return response({ json: { url: 'https://cdn.example/track.flac' } });
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const { QobuzClient } = loadQobuzWithFetch(fetchMock);
  const client = new QobuzClient();
  await client.init({ userId: ' saved-user-id ', authToken: ' saved-token-123 ', testTrackId: '762667' });

  assert.strictEqual(client.authToken, 'refreshed-token-456');
  assert.ok(client.secret);
  assert.strictEqual(calls.filter((c) => c.requestUrl.includes('/user/login?')).length, 1);
}

async function testOAuthAuthorizeUrlIncludesRedirectAndState() {
  const { qobuzOAuthAuthorizeUrl } = loadQobuzWithFetch(async () => response({ json: {} }));
  const authUrl = qobuzOAuthAuthorizeUrl('123456789', 'http://volumio.local:8488/qobuz-auth/callback', 'state-123');
  const parsed = new URL(authUrl);

  assert.strictEqual(parsed.origin + parsed.pathname, 'https://www.qobuz.com/signin/oauth');
  assert.strictEqual(parsed.searchParams.get('client_id'), '123456789');
  assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'http://volumio.local:8488/qobuz-auth/callback');
  assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
  assert.strictEqual(parsed.searchParams.get('state'), 'state-123');
}

async function testOAuthExchangeExtractsTokenAndUserId() {
  const calls = [];
  const fetchMock = async (requestUrl, options) => {
    const url = String(requestUrl);
    calls.push({ requestUrl: url, options: options || {} });
    if (url.startsWith('https://www.qobuz.com/api.json/0.2/oauth/callback?')) {
      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('code'), 'oauth-code-123');
      assert.strictEqual(parsed.searchParams.get('private_key'), 'private-key-abc');
      assert.strictEqual((options || {}).headers['X-App-Id'], '123456789');
      assert.strictEqual((options || {}).headers['X-User-Auth-Token'], undefined);
      return response({
        json: {
          user_auth_token: 'oauth-token-456',
          user: { id: 987654321, credential: { parameters: { short_label: 'Studio' } } }
        }
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const { exchangeQobuzOAuthCode } = loadQobuzWithFetch(fetchMock);
  const result = await exchangeQobuzOAuthCode({
    appId: '123456789',
    authKey: 'private-key-abc',
    code: 'oauth-code-123'
  });

  assert.deepStrictEqual(result, {
    authToken: 'oauth-token-456',
    userId: '987654321',
    data: {
      user_auth_token: 'oauth-token-456',
      user: { id: 987654321, credential: { parameters: { short_label: 'Studio' } } }
    }
  });
  assert.strictEqual(calls.length, 1);
}

async function testExtractQobuzLocalUserAuth() {
  const { extractQobuzLocalUserAuth } = loadQobuzWithFetch(async () => response({ json: {} }));

  assert.deepStrictEqual(
    extractQobuzLocalUserAuth(JSON.stringify({
      token: 'local-user-token-123',
      user: { id: 7654321, email: 'person@example.com' }
    })),
    { authToken: 'local-user-token-123', userId: '7654321' }
  );

  const encoded = encodeURIComponent(JSON.stringify({
    account: { user_id: 'user-abc' },
    credentials: { user_auth_token: 'token-def' }
  }));
  assert.deepStrictEqual(
    extractQobuzLocalUserAuth(encoded),
    { authToken: 'token-def', userId: 'user-abc' }
  );

  assert.deepStrictEqual(
    extractQobuzLocalUserAuth('{bad json'),
    { authToken: '', userId: '' }
  );
}

(async () => {
  await testLoginMatchesStreamripGetRequest();
  await testSpooferPrioritizesSecondTimezoneSecret();
  await testLoginFallsBackToWebOAuth();
  await testWebOAuthInvalidCredentialsAreRedacted();
  await testInitCanUsePersistedAuthToken();
  await testInitCanUseStreamripAuthTokenLogin();
  await testOAuthAuthorizeUrlIncludesRedirectAndState();
  await testOAuthExchangeExtractsTokenAndUserId();
  await testExtractQobuzLocalUserAuth();
  console.log('qobuz request tests passed');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
