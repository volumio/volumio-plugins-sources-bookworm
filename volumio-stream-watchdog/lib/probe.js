'use strict';

// =============================================================================
// HTTP probe of a stream URL.
//
// In 2.0 the probe is no longer the judge of whether the radio is fine — the
// player state is. It answers one narrower question, asked only while the
// offline playlist is playing: "is it worth interrupting the playlist to try
// the radio now?" A HEAD that passes proves the server answers, not that it
// is sending audio; the next ticks of the loop check that part.
//
// Native http/https only. Pass: 2xx, 3xx, or 405 (Shoutcast/Icecast servers
// reject HEAD). Fail: refused, DNS failure, timeout, other 4xx, any 5xx.
// .m3u/.pls URIs are resolved first, so the HEAD hits the stream itself and
// not the playlist file, which is always reachable.
// =============================================================================

var libQ = (function () {
  try { return require('/volumio/node_modules/kew'); } catch (e) { return require('kew'); }
}());

var DEFAULT_TIMEOUT_MS = 5000;

function createProbe(opts) {
  opts = opts || {};
  var logger    = opts.logger || { verbose: function () {}, info: function () {}, warn: function () {} };
  var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  var tag       = opts.tag || '';
  var cache     = {}; // original URI -> resolved stream URI

  function isHttp(uri) {
    return !!uri && (uri.indexOf('http://') === 0 || uri.indexOf('https://') === 0);
  }

  /** HEAD request. Resolves true (reachable) or false. Never rejects. */
  function probeStream(uri) {
    var defer = libQ.defer();

    if (!isHttp(uri)) {
      logger.verbose(tag + 'Probe skipped — non-HTTP URI: ' + uri);
      defer.resolve(true);
      return defer.promise;
    }

    var settled = false;
    function finish(ok, reason) {
      if (settled) return;
      settled = true;
      logger.verbose(tag + 'Probe ' + (ok ? 'PASS' : 'FAIL') + ' (' + reason + '): ' + uri);
      defer.resolve(ok);
    }

    var req;
    try {
      var parsed = new URL(uri);
      var mod    = require(uri.indexOf('https://') === 0 ? 'https' : 'http');
      req = mod.request(parsed, {
        method:  'HEAD',
        headers: { 'User-Agent': 'VolumioStreamWatchdog' }
      }, function (res) {
        var code = res.statusCode;
        res.resume(); // drain so the socket can close
        finish((code >= 200 && code < 400) || code === 405, 'HTTP ' + code);
      });
    } catch (e) {
      finish(false, 'request error: ' + e.message);
      return defer.promise;
    }

    req.setTimeout(timeoutMs, function () {
      req.destroy();
      finish(false, 'timeout');
    });
    req.on('error', function (err) { finish(false, err.code || err.message); });
    req.end();

    return defer.promise;
  }

  /** GET that resolves the body as text, capped at 64 KB. Rejects on error. */
  function fetchText(uri) {
    var defer = libQ.defer();
    var settled = false;
    function done(err, text) {
      if (settled) return;
      settled = true;
      if (err) defer.reject(err); else defer.resolve(text);
    }

    var req;
    try {
      var mod = require(uri.indexOf('https://') === 0 ? 'https' : 'http');
      req = mod.get(new URL(uri), function (res) {
        if (res.statusCode >= 400) { res.resume(); done('HTTP ' + res.statusCode); return; }
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
          body += chunk;
          if (body.length > 65536) { req.destroy(); done(null, body); }
        });
        res.on('end', function () { done(null, body); });
      });
    } catch (e) {
      done('bad URI');
      return defer.promise;
    }
    req.setTimeout(timeoutMs, function () { req.destroy(); done('timeout'); });
    req.on('error', function (e) { done(e.code || e.message); });
    return defer.promise;
  }

  /** First http(s) URL in an .m3u or .pls body, or null. */
  function parsePlaylist(body, isPls) {
    var lines = String(body || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var candidate = null;
      if (isPls) {
        var m = line.match(/^File\d*\s*=\s*(\S.*)$/i);
        if (m) candidate = m[1].trim();
      } else {
        if (line.charAt(0) === '#') continue;
        candidate = line;
      }
      if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
    }
    return null;
  }

  /** Resolves an .m3u/.pls URI to the stream inside it; cached per URI. */
  function resolvePlaylistUri(uri) {
    if (!isHttp(uri)) return libQ.resolve(uri);
    if (Object.prototype.hasOwnProperty.call(cache, uri)) return libQ.resolve(cache[uri]);

    var pathname;
    try { pathname = new URL(uri).pathname.toLowerCase(); } catch (e) { return libQ.resolve(uri); }
    var isPls = /\.pls$/.test(pathname);
    var isM3u = /\.m3u$/.test(pathname);
    if (!isPls && !isM3u) { cache[uri] = uri; return libQ.resolve(uri); }

    var defer = libQ.defer();
    fetchText(uri).then(function (body) {
      var resolved = parsePlaylist(body, isPls);
      if (resolved) {
        logger.info(tag + 'Resolved playlist URI ' + uri + ' → ' + resolved);
      } else {
        resolved = uri;
        logger.warn(tag + 'No stream URL found in playlist ' + uri + ' — probing the playlist URI directly');
      }
      cache[uri] = resolved;
      defer.resolve(resolved);
    }).fail(function (err) {
      logger.warn(tag + 'Could not fetch playlist ' + uri + ' (' + err + ') — probing the playlist URI directly');
      cache[uri] = uri;
      defer.resolve(uri);
    });
    return defer.promise;
  }

  /** Resolve, then probe. Resolves true or false; never rejects. */
  function probe(uri) {
    return resolvePlaylistUri(uri).then(function (target) { return probeStream(target); });
  }

  return {
    probe: probe,
    probeStream: probeStream,
    resolvePlaylistUri: resolvePlaylistUri,
    parsePlaylist: parsePlaylist,
    fetchText: fetchText,
    clearCache: function () { cache = {}; }
  };
}

module.exports = { createProbe: createProbe };
