'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (compatible; VolumioTrackCleaner/1.0)';
const MAX_REDIRECTS = 5;
const MAX_BODY = 65536;

const ALIVE = { alive: true, reason: '' };
const dead = reason => ({ alive: false, reason: reason });
const unknown = reason => ({ alive: null, reason: reason });

function codeErr(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// ---------- error classification ----------
// final: there is no point in retrying with another method

function classifyErr(e) {
  const code = (e && (e.code || e.message)) || 'ERROR';
  if (code === 'ENOTFOUND') return { final: true, result: dead('dns') };
  if (code === 'ECONNREFUSED') return { final: true, result: dead('refused') };
  if (code === 'EHOSTUNREACH') return { final: true, result: dead('unreachable') };
  if (code === 'EAI_AGAIN' || code === 'ENETUNREACH' || code === 'ENETDOWN') {
    return { final: true, result: unknown('network') }; // our own network problem
  }
  if (/^(CERT_|DEPTH_ZERO|UNABLE_TO_|ERR_TLS|SELF_SIGNED|ERR_SSL|EPROTO)/.test(code)) {
    return { final: true, result: dead('tls') };
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return { final: false, result: dead('timeout') };
  return { final: false, result: dead(String(code).toLowerCase()) };
}

// ---------- one HTTP request (headers, optionally a limited body) ----------

function once(method, urlStr, o) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(codeErr('EBADURL')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(codeErr('EBADPROTO'));
    const lib = u.protocol === 'https:' ? https : http;
    let finished = false;
    let timer = null;
    const finish = (fn, v) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn(v);
    };
    const req = lib.request(u, {
      method: method,
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Icy-MetaData': '0', 'Connection': 'close' }
    }, res => {
      const status = res.statusCode;
      const headers = res.headers;
      if (!o.wantBody) {
        res.destroy();
        req.destroy();
        return finish(resolve, { status: status, headers: headers, body: '' });
      }
      const chunks = [];
      let n = 0;
      const done = () => finish(resolve, {
        status: status, headers: headers, body: Buffer.concat(chunks).toString('utf8', 0, MAX_BODY)
      });
      res.on('data', c => {
        chunks.push(c);
        n += c.length;
        if (n >= MAX_BODY) { res.destroy(); done(); }
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', e => (chunks.length ? done() : finish(reject, e)));
    });
    req.on('error', e => finish(reject, e));
    timer = setTimeout(() => { req.destroy(); finish(reject, codeErr('ETIMEDOUT')); }, o.timeoutMs);
    req.end();
  });
}

// Shoutcast v1 servers answer "ICY 200 OK", which Node's HTTP parser can reject.
// Read the status line and the headers from a plain socket instead.
function rawProbe(urlStr, o) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(codeErr('EBADURL')); }
    const secure = u.protocol === 'https:';
    const port = Number(u.port) || (secure ? 443 : 80);
    let finished = false;
    const finish = (fn, v) => {
      if (finished) return;
      finished = true;
      fn(v);
    };
    const sock = (secure ? tls : net).connect({ host: u.hostname, port: port, servername: u.hostname }, () => {
      sock.write('GET ' + (u.pathname || '/') + (u.search || '') + ' HTTP/1.0\r\nHost: ' + u.host +
        '\r\nUser-Agent: ' + UA + '\r\nIcy-MetaData: 0\r\nAccept: */*\r\nConnection: close\r\n\r\n');
    });
    let buf = '';
    const parse = () => {
      const end = buf.indexOf('\r\n\r\n');
      const head = end >= 0 ? buf.slice(0, end) : buf;
      const lines = head.split(/\r?\n/);
      const m = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/.exec(lines[0] || '');
      if (!m) return finish(reject, codeErr('EBADRESP'));
      const headers = {};
      lines.slice(1).forEach(l => {
        const i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      });
      finish(resolve, { status: Number(m[1]), headers: headers, body: '' });
    };
    sock.on('data', d => {
      buf += d.toString('latin1');
      if (buf.indexOf('\r\n\r\n') >= 0 || buf.length > 8192) { sock.destroy(); parse(); }
    });
    sock.on('close', () => { if (!finished) (buf ? parse() : finish(reject, codeErr('ECONNRESET'))); });
    sock.on('error', e => finish(reject, e));
    sock.setTimeout(o.timeoutMs, () => { sock.destroy(); finish(reject, codeErr('ETIMEDOUT')); });
  });
}

async function request(method, urlStr, o) {
  try {
    return await once(method, urlStr, o);
  } catch (e) {
    if (e && /^HPE_/.test(e.code || '') && !o.wantBody) return rawProbe(urlStr, o);
    throw e;
  }
}

async function fetchFollow(method, urlStr, o) {
  let u = urlStr;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await request(method, u, o);
    if ([301, 302, 303, 307, 308].indexOf(r.status) !== -1 && r.headers.location) {
      u = new URL(r.headers.location, u).toString();
      continue;
    }
    r.url = u;
    return r;
  }
  throw codeErr('EREDIRECT');
}

// ---------- the three kinds of address ----------

const is2xx = s => s >= 200 && s < 300;
const isHtml = r => /text\/html/i.test(String(r.headers['content-type'] || ''));
const streamOk = r => is2xx(r.status) && !isHtml(r);

async function checkStream(url, o) {
  try {
    const h = await fetchFollow('HEAD', url, o);
    if (streamOk(h)) return ALIVE;
  } catch (e) {
    const c = classifyErr(e);
    if (c.final) return c.result;
  }
  // many Icecast/Shoutcast servers do not like HEAD: ask for the headers with GET and hang up
  try {
    const g = await fetchFollow('GET', url, o);
    if (streamOk(g)) return ALIVE;
    return dead(isHtml(g) && is2xx(g.status) ? 'html-page' : 'http-' + g.status);
  } catch (e) {
    return classifyErr(e).result;
  }
}

function parsePlaylist(body) {
  const out = [];
  String(body || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') return;
    const pls = /^File\d+\s*=\s*(\S.*)$/i.exec(line);
    const cand = pls ? pls[1].trim() : line;
    if (/^https?:\/\//i.test(cand)) out.push(cand);
  });
  return out;
}

async function checkPlaylist(url, o, depth) {
  let r;
  try {
    r = await fetchFollow('GET', url, Object.assign({}, o, { wantBody: true }));
  } catch (e) {
    return classifyErr(e).result;
  }
  if (!is2xx(r.status)) return dead('http-' + r.status);
  const urls = parsePlaylist(r.body);
  if (!urls.length) return dead('empty-playlist');
  let last = dead('empty-playlist');
  for (const u of urls.slice(0, 2)) {
    const res = await checkAny(new URL(u, r.url).toString(), o, depth + 1);
    if (res.alive) return res;
    last = res;
  }
  return last;
}

async function checkHls(url, o) {
  let r;
  try {
    r = await fetchFollow('GET', url, Object.assign({}, o, { wantBody: true }));
  } catch (e) {
    return classifyErr(e).result;
  }
  if (!is2xx(r.status)) return dead('http-' + r.status);
  return /^\s*#EXTM3U/.test(r.body) ? ALIVE : dead('bad-hls');
}

function kindOf(url) {
  let p = '';
  try { p = new URL(url).pathname.toLowerCase(); } catch (e) { return 'stream'; }
  if (/\.m3u8$/.test(p)) return 'hls';
  if (/\.(m3u|pls)$/.test(p)) return 'playlist';
  return 'stream';
}

function checkAny(url, o, depth) {
  const kind = kindOf(url);
  if (kind === 'hls') return checkHls(url, o);
  if (kind === 'playlist' && depth < 2) return checkPlaylist(url, o, depth);
  return checkStream(url, o);
}

// ---------- public API ----------

/**
 * @param {string} uri     address as shown in a station list
 * @param {object} o       { timeoutMs, resolveTuneIn(uri) -> Promise<string> }
 * @returns {Promise<{alive: true|false|null, reason: string}>} null = could not tell, do not act
 */
async function checkStation(uri, o) {
  const opts = Object.assign({ timeoutMs: 8000 }, o || {});
  let target = String(uri || '').trim();
  if (!/^https?:\/\//i.test(target)) return unknown('not-http');
  if (/Tune\.ashx/i.test(target)) {
    if (!opts.resolveTuneIn) return unknown('no-resolver');
    try {
      target = await opts.resolveTuneIn(target);
    } catch (e) {
      return unknown('tunein-api'); // the directory may be down: never block on that
    }
    if (!target) return unknown('tunein-empty');
  }
  let timer = null;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve(dead('timeout')), opts.timeoutMs * 4);
  });
  try {
    return await Promise.race([checkAny(target, opts, 0), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks many stations with a limited number in flight. Results are returned, not applied:
 * the caller decides what to do with them.
 */
async function checkMany(uris, o) {
  const opts = o || {};
  const results = [];
  let next = 0;
  const workers = Math.max(1, Math.min(Number(opts.concurrency) || 4, 8));
  async function worker() {
    while (next < uris.length) {
      if (opts.shouldStop && opts.shouldStop()) return;
      const uri = uris[next++];
      let r;
      try { r = await checkStation(uri, opts); } catch (e) { r = unknown('internal'); }
      results.push({ uri: uri, alive: r.alive, reason: r.reason });
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

// Our own network being down looks like "every station is dead": detect it.
function looksLikeNetworkProblem(results) {
  const definite = results.filter(r => r.alive !== null);
  if (definite.length < 10) return false;
  const deadCount = definite.filter(r => r.alive === false).length;
  return deadCount / definite.length >= 0.8;
}

module.exports = { checkStation, checkMany, looksLikeNetworkProblem, parsePlaylist, kindOf, rawProbe };
