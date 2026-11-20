'use strict';

/*
 * "Mobile Remote": a single page built for the phone, on its own port.
 *
 *  HTTP  0.0.0.0:<mobile_port>   remote.html + remote.js + remote.css + small JSON API
 *                                + optionally the two pictures chosen by the user (light/dark)
 *
 * OFF by default; runs only when switched on in the web interface, and only between onStart and
 * onStop, inside the Volumio process as user "volumio" (no root privileges).
 *
 * Deliberately separate from the configuration web interface: this port cannot configure anything. It knows
 * exactly four things - read the state (title, artist, album, volume, labels of the 20 buttons), press one
 * of the 20 buttons, set the volume, previous/pause/play/next (Volumio's own commands). Protection as for
 * the web interface: fixed file list, small size limits, JSON content type and origin check for writes,
 * Content-Security-Policy without inline scripts.
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var C = require('./constants');

var STATIC = {
  '/': 'remote.html',
  '/remote.html': 'remote.html',
  '/remote.css': 'remote.css',
  '/remote.js': 'remote.js'
};
var MIME = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
var CSP = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
var BODY_LIMIT = 200;

function HttpError(status, code) {
  var e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

function MobileServer(ctl, logger) {
  this.ctl = ctl;
  this.logger = logger;
  this.server = null;
  this.port = null;
  this.error = null;
  this.wwwDir = path.join(__dirname, '..', 'www', 'mobile');
}

MobileServer.prototype.start = function (wanted) {
  var self = this;
  return self.stop().then(function () {
    return new Promise(function (resolve) {
      var attempt = 0;
      var server = http.createServer(function (req, res) { self._handle(req, res); });
      server.requestTimeout = 20000;
      server.headersTimeout = 10000;
      server.on('error', function (e) {
        if (e.code === 'EADDRINUSE' && attempt < 10) {
          attempt++;
          setTimeout(function () { server.listen(wanted + attempt, '0.0.0.0'); }, 50);
          return;
        }
        self.error = e.message;
        self.logger.error(C.LOG_PREFIX + 'mobile remote server: ' + e.message);
        resolve();
      });
      server.on('listening', function () {
        self.port = server.address().port;
        self.error = null;
        self.server = server;
        self.logger.info(C.LOG_PREFIX + 'mobile remote on port ' + self.port);
        resolve();
      });
      server.listen(wanted, '0.0.0.0');
    });
  });
};

MobileServer.prototype.stop = function () {
  var server = this.server;
  this.server = null;
  this.port = null;
  if (!server) return Promise.resolve();
  return new Promise(function (resolve) {
    try {
      server.close(function () { resolve(); });
      if (server.closeAllConnections) server.closeAllConnections();
    } catch (e) {
      resolve();
    }
  });
};

MobileServer.prototype._handle = function (req, res) {
  var self = this;
  var url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    return self._error(res, HttpError(400, 'bad_url'));
  }
  var p = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if ((req.method === 'GET' || req.method === 'HEAD') && STATIC[p]) return self._static(req, res, STATIC[p]);
  var ctl = self.ctl;
  // picture chosen by the user above the volume control (light/dark); without one the page shows text
  var g = /^\/graphic-(light|dark)$/.exec(p);
  if (req.method === 'GET' && g) return self._file(res, ctl.mobileGraphicFile(g[1]));
  var routes = {
    'GET /api/state': function () { return ctl.mobileState(req.socket.localAddress); },
    'POST /api/press': function (body) { return ctl.mobilePress(body && body.button); },
    'POST /api/volume': function (body) { return ctl.mobileVolume(body); },
    'POST /api/transport': function (body) { return ctl.mobileTransport(body && body.action); }
  };
  var route = routes[req.method + ' ' + p];
  if (!route) return self._error(res, HttpError(req.method === 'GET' || req.method === 'POST' ? 404 : 405, 'not_found'));

  Promise.resolve().then(function () {
    if (req.method !== 'POST') return route();
    self._checkOrigin(req);
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw HttpError(415, 'json_required');
    return self._body(req).then(route);
  }).then(function (result) {
    self._json(res, 200, result === undefined ? { ok: true } : result);
  }).catch(function (e) {
    self._error(res, e);
  });
};

/** Writes only from the page itself (same host:port). */
MobileServer.prototype._checkOrigin = function (req) {
  var origin = req.headers.origin;
  if (!origin || origin === 'null') return;
  var host;
  try { host = new URL(origin).host; } catch (e) { throw HttpError(403, 'origin_rejected'); }
  if (host !== req.headers.host) throw HttpError(403, 'origin_rejected');
};

MobileServer.prototype._body = function (req) {
  return new Promise(function (resolve, reject) {
    var size = 0;
    var chunks = [];
    var failed = false;
    req.on('data', function (c) {
      if (failed) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(HttpError(413, 'body_too_large'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (failed) return;
      try {
        var obj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('object');
        resolve(obj);
      } catch (e) {
        reject(HttpError(400, 'json_invalid'));
      }
    });
    req.on('error', function () {
      if (!failed) reject(HttpError(400, 'request_error'));
      failed = true;
    });
  });
};

MobileServer.prototype._static = function (req, res, file) {
  var ext = file.split('.').pop();
  fs.readFile(path.join(this.wwwDir, file), function (err, data) {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('file missing');
      return;
    }
    var headers = { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache', 'Content-Length': data.length };
    if (ext === 'html') headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
};

/** Serve an image file; img = promise of { path, mime } or null. */
MobileServer.prototype._file = function (res, img) {
  var self = this;
  Promise.resolve(img).then(function (img) {
    if (!img) return self._error(res, HttpError(404, 'not_found'));
    fs.readFile(img.path, function (err, data) {
      if (err) return self._error(res, HttpError(404, 'not_found'));
      res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'no-cache', 'Content-Length': data.length });
      res.end(data);
    });
  }).catch(function () { self._error(res, HttpError(404, 'not_found')); });
};

MobileServer.prototype._json = function (res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

MobileServer.prototype._error = function (res, e) {
  var status = (e && e.status) || 500;
  if (status >= 500) this.logger.error(C.LOG_PREFIX + 'mobile remote request failed: ' + (e && e.stack || e));
  if (res.headersSent) {
    try { res.end(); } catch (x) { /* ignore */ }
    return;
  }
  this._json(res, status, { error: (e && typeof e.code === 'string' && status < 500) ? e.code : 'internal_error' });
};

module.exports = { MobileServer: MobileServer };
