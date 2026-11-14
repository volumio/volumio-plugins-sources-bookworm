'use strict';
/**
 * Radiosender: Erreichbarkeitspruefung, Vorlagen-Datei radiopresets.txt, Senderkatalog.
 *
 * Pruefung ueber eine einfache HTTP-Anfrage auf Socket-Ebene, weil viele Radioserver (SHOUTcast v1)
 * mit "ICY 200 OK" statt "HTTP/1.x 200" antworten, was Node.js' HTTP-Parser ablehnt.
 */
var net = require('net');
var tls = require('tls');
var C = require('./constants');

/**
 * Eine URI pruefen. Ergebnis: { uri, ok, status, type, final_uri, ms, error }.
 * ok = Antwort 2xx (HTTP oder ICY). Weiterleitungen (bis 3) werden verfolgt.
 */
function checkUri(uri, timeoutMs, hops) {
  timeoutMs = timeoutMs || C.LIMITS.RADIO_CHECK_MS;
  hops = hops || 0;
  var started = Date.now();
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(uri); } catch (e) { resolve({ uri: uri, ok: false, error: 'invalid_uri', ms: 0 }); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { resolve({ uri: uri, ok: false, error: 'invalid_uri', ms: 0 }); return; }
    var secure = u.protocol === 'https:';
    var port = Number(u.port) || (secure ? 443 : 80);
    var host = u.hostname.replace(/^\[|\]$/g, '');
    var done = false;
    var buf = '';
    var sock;
    function finish(res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch (e) { /* ignore */ }
      res.uri = uri;
      res.ms = Date.now() - started;
      resolve(res);
    }
    var timer = setTimeout(function () { finish({ ok: false, error: 'timeout' }); }, timeoutMs);
    var opts = { host: host, port: port };
    var onConnect = function () {
      sock.write('GET ' + (u.pathname || '/') + (u.search || '') + ' HTTP/1.0\r\n' +
        'Host: ' + u.host + '\r\nUser-Agent: X10Remote-Volumio/1.0\r\nAccept: */*\r\nIcy-MetaData: 0\r\nConnection: close\r\n\r\n');
    };
    try {
      sock = secure ? tls.connect(Object.assign(opts, { servername: net.isIP(host) ? undefined : host }), onConnect)
        : net.connect(opts, onConnect);
    } catch (e) {
      finish({ ok: false, error: e.code || e.message });
      return;
    }
    sock.setEncoding('latin1');
    sock.on('data', function (chunk) {
      buf += chunk;
      var end = buf.indexOf('\r\n\r\n');
      if (end === -1) end = buf.indexOf('\n\n');
      if (end === -1 && buf.length < 16384) return;
      var head = buf.slice(0, end === -1 ? 16384 : end).split(/\r?\n/);
      var m = /^(HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i.exec(head[0] || '');
      if (!m) { finish({ ok: false, error: 'no_http_answer' }); return; }
      var status = Number(m[2]);
      var headers = {};
      head.slice(1).forEach(function (l) {
        var i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      });
      if (status >= 300 && status < 400 && headers.location && hops < 3) {
        var next;
        try { next = new URL(headers.location, uri).toString(); } catch (e) { finish({ ok: false, status: status, error: 'bad_redirect' }); return; }
        done = true;
        clearTimeout(timer);
        try { sock.destroy(); } catch (e) { /* ignore */ }
        checkUri(next, Math.max(1000, timeoutMs - (Date.now() - started)), hops + 1).then(function (r) {
          r.uri = uri;
          r.final_uri = r.final_uri || next;
          r.ms = Date.now() - started;
          resolve(r);
        });
        return;
      }
      var type = headers['content-type'] || (m[1].toUpperCase() === 'ICY' ? 'audio/mpeg (ICY)' : '');
      finish({ ok: status >= 200 && status < 300, status: status, type: type, name: headers['icy-name'] || '',
        bitrate: headers['icy-br'] || '', error: status >= 200 && status < 300 ? '' : 'http_' + status });
    });
    sock.on('error', function (e) { finish({ ok: false, error: e.code || e.message }); });
    sock.on('end', function () { if (!done) finish({ ok: false, error: 'closed' }); });
  });
}

/** Mehrere URIs pruefen, hoechstens `parallel` gleichzeitig. */
function checkMany(uris, parallel) {
  parallel = parallel || 4;
  var out = new Array(uris.length);
  var next = 0;
  function worker() {
    if (next >= uris.length) return Promise.resolve();
    var i = next++;
    return checkUri(uris[i]).then(function (r) { out[i] = r; return worker(); });
  }
  var ws = [];
  for (var w = 0; w < Math.min(parallel, uris.length); w++) ws.push(worker());
  return Promise.all(ws).then(function () { return out; });
}

/**
 * radiopresets.txt lesen. Bloecke durch Leerzeilen getrennt:
 *   Sendername
 *   http://uri-1            (1 bis 3 URIs, Reihenfolge = Failover)
 *   quality: 128k           (optional)
 *   format: MP3             (optional)
 * Zeilen, die mit '#' oder ';' beginnen, sind Kommentare.
 */
function parsePresets(text) {
  var stations = [];
  var warnings = [];
  var blocks = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  blocks.forEach(function (block) {
    var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^[#;]/.test(l); });
    if (!lines.length) return;
    var st = { name: lines[0].slice(0, C.LIMITS.RADIO_NAME), uris: [], quality: '', format: '' };
    if (/^https?:\/\//i.test(st.name)) { warnings.push({ code: 'preset_no_name', line: lines[0] }); return; }
    lines.slice(1).forEach(function (l) {
      var kv = /^(quality|format)\s*:\s*(.*)$/i.exec(l);
      if (kv) { st[kv[1].toLowerCase()] = kv[2].slice(0, C.LIMITS.RADIO_TEXT); return; }
      var u = require('./profiles').cleanUri(l);
      if (!u) { warnings.push({ code: 'preset_bad_line', station: st.name, line: l }); return; }
      if (st.uris.length >= C.LIMITS.RADIO_URIS) { warnings.push({ code: 'preset_too_many', station: st.name, line: l }); return; }
      if (st.uris.indexOf(u) === -1) st.uris.push(u);
    });
    if (!st.uris.length) { warnings.push({ code: 'preset_no_uri', station: st.name }); return; }
    stations.push(st);
  });
  return { stations: stations, warnings: warnings };
}

/**
 * Senderkatalog aller Profile (auch inaktiver). Gedacht fuer x10remote-action radio und fuer andere Plugins
 * (z. B. HD44780/VFD-Display): nur lesen, Sender ueber jede ihrer URIs zuordnen.
 */
function buildCatalog(profiles, activeIds, version) {
  var stations = [];
  profiles.forEach(function (p) {
    (p.keys || []).forEach(function (k) {
      if (k.action !== 'radio' || !k.radio) return;
      stations.push({
        id: p.id + '/' + k.id,
        name: k.radio.name,
        uris: k.radio.uris.slice(),
        logo: k.radio.logo ? p.id + '/' + k.radio.logo : null,
        quality: k.radio.quality || '',
        format: k.radio.format || '',
        profile: { id: p.id, name: p.name, active: activeIds.indexOf(p.id) !== -1 },
        key: { id: k.id, name: k.name, remote_label: k.remote_label || '' }
      });
    });
  });
  return {
    format: 'x10remote-radio-stations',
    version: 1,
    generated: new Date().toISOString(),
    generator: 'x10remote ' + (version || ''),
    note: 'Generated by the X10 RF Remote plugin - do not edit, changes are overwritten. logo is relative to this folder.',
    stations: stations
  };
}

module.exports = {
  checkUri: checkUri,
  checkMany: checkMany,
  parsePresets: parsePresets,
  buildCatalog: buildCatalog
};
