'use strict';

/*
 * Weboberflaeche des Plugins (Tastentest, Einlese-Assistent, Profile) und Ereignisempfang vom Mapper.
 *
 *  HTTP  0.0.0.0:<web_port>   statische Seiten aus www/ + JSON-API + Server-Sent Events
 *  UDP   127.0.0.1:<event_port>  Ereignisse von x10mapper.py
 *
 * Laeuft im Volumio-Prozess als Benutzer "volumio" (keine Root-Rechte), nur zwischen onStart und onStop.
 * Schutz: feste Dateiliste, Groessenlimits, JSON-Content-Type fuer Schreibzugriffe, Origin-Pruefung,
 * Content-Security-Policy ohne Inline-Skripte.
 */

var http = require('http');
var dgram = require('dgram');
var fs = require('fs');
var path = require('path');
var C = require('./constants');

var STATIC = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/test.html': 'test.html',
  '/wizard.html': 'wizard.html',
  '/profiles.html': 'profiles.html',
  '/profile.html': 'profile.html',
  '/print.html': 'print.html',
  '/print.js': 'print.js',
  '/app.css': 'app.css',
  '/app.js': 'app.js',
  '/home.js': 'home.js',
  '/test.js': 'test.js',
  '/wizard.js': 'wizard.js',
  '/profiles.js': 'profiles.js',
  '/profile.js': 'profile.js',
  '/receivers.html': 'receivers.html',
  '/receivers.js': 'receivers.js',
  '/receiver.html': 'receiver.html',
  '/receiver.js': 'receiver.js'
};
var MIME = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
var CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
var MAX_SSE_CLIENTS = 20;

function HttpError(status, code, detail) {
  var e = new Error(code);
  e.status = status;
  e.code = code;
  e.detail = detail || '';
  return e;
}

function WebServer(ctl, logger) {
  this.ctl = ctl;               // Controller mit den API-Funktionen (siehe index.js)
  this.logger = logger;
  this.server = null;
  this.udp = null;
  this.clients = [];
  this.keepAlive = null;
  this.port = null;
  this.eventPort = null;
  this.error = null;
  this.wwwDir = path.join(__dirname, '..', 'www');
}

// ------------------------------------------------------------------ lifecycle

WebServer.prototype.start = function (wantedPort, wantedEventPort) {
  var self = this;
  return self.stop().then(function () {
    return Promise.all([self._startUdp(wantedEventPort), self._startHttp(wantedPort)]);
  }).then(function () {
    self.keepAlive = setInterval(function () { self._write(': ping\n\n'); }, 20000);
    return { port: self.port, eventPort: self.eventPort };
  });
};

WebServer.prototype._startUdp = function (wanted) {
  var self = this;
  return new Promise(function (resolve) {
    var attempt = 0;
    var tryBind = function () {
      var sock = dgram.createSocket('udp4');
      sock.once('error', function (e) {
        try { sock.close(); } catch (x) { /* ignore */ }
        if (e.code === 'EADDRINUSE' && attempt < 10) {
          attempt++;
          tryBind();
          return;
        }
        self.logger.error(C.LOG_PREFIX + 'UDP event port: ' + e.message);
        self.eventPort = null;
        resolve();
      });
      sock.once('listening', function () {
        sock.removeAllListeners('error');
        sock.on('error', function (e) { self.logger.warn(C.LOG_PREFIX + 'UDP: ' + e.message); });
        sock.on('message', function (buf) { self._onUdp(buf); });
        self.udp = sock;
        self.eventPort = wanted + attempt;
        resolve();
      });
      sock.bind(wanted + attempt, '127.0.0.1');
    };
    tryBind();
  });
};

WebServer.prototype._startHttp = function (wanted) {
  var self = this;
  return new Promise(function (resolve) {
    var attempt = 0;
    var server = http.createServer(function (req, res) { self._handle(req, res); });
    server.requestTimeout = 60000;
    server.headersTimeout = 20000;
    server.on('error', function (e) {
      if (e.code === 'EADDRINUSE' && attempt < 10) {
        attempt++;
        setTimeout(function () { server.listen(wanted + attempt, '0.0.0.0'); }, 50);
        return;
      }
      self.error = e.message;
      self.logger.error(C.LOG_PREFIX + 'web server: ' + e.message);
      resolve();
    });
    server.on('listening', function () {
      self.port = server.address().port;
      self.error = null;
      self.server = server;
      self.logger.info(C.LOG_PREFIX + 'web interface on port ' + self.port);
      resolve();
    });
    server.listen(wanted, '0.0.0.0');
  });
};

WebServer.prototype.stop = function () {
  var self = this;
  if (self.keepAlive) clearInterval(self.keepAlive);
  self.keepAlive = null;
  self.clients.forEach(function (c) { try { c.end(); } catch (e) { /* ignore */ } });
  self.clients = [];
  if (self.udp) {
    try { self.udp.close(); } catch (e) { /* ignore */ }
    self.udp = null;
  }
  var server = self.server;
  self.server = null;
  self.port = null;
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

// --------------------------------------------------------------------- events

WebServer.prototype._onUdp = function (buf) {
  if (buf.length > 4096) return;
  var ev;
  try { ev = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
  if (!ev || typeof ev.event !== 'string') return;
  if (['press', 'unmapped', 'passthrough', 'swallowed', 'capture'].indexOf(ev.event) === -1) return;
  this.broadcast(ev);
};

WebServer.prototype.broadcast = function (obj) {
  this._write('data: ' + JSON.stringify(obj) + '\n\n');
};

WebServer.prototype._write = function (data) {
  this.clients.forEach(function (c) {
    try { c.write(data); } catch (e) { /* ignore */ }
  });
};

// --------------------------------------------------------------------- routing

WebServer.prototype._handle = function (req, res) {
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
  if (req.method === 'GET' && p === '/api/events') return self._sse(req, res);
  var logo = /^\/logo\/([a-z0-9-]{1,40})\/(logo-[0-9a-f]{12}\.(?:png|jpg|webp))$/.exec(p);
  if (req.method === 'GET' && logo) return self._file(res, self.ctl.logoFile(logo[1], logo[2]));
  var img = /^\/(img|rimg|pimg)\/([^/]{1,240})\/([1-6])$/.exec(p);
  if (req.method === 'GET' && img) {
    var imgId;
    try { imgId = decodeURIComponent(img[2]); } catch (e) { return self._error(res, HttpError(404, 'not_found')); }
    return self._image(res, imgId, img[3], img[1]);
  }

  var route = self._routes()[req.method + ' ' + p];
  if (!route) return self._error(res, HttpError(req.method === 'GET' || req.method === 'POST' ? 404 : 405, 'not_found'));

  Promise.resolve().then(function () {
    if (req.method !== 'POST') return route(url.searchParams);
    self._checkOrigin(req);
    if (!route.anyType && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      throw HttpError(415, 'json_required');
    }
    return self._body(req, route.limit || (route.big ? C.LIMITS.IMAGE_BODY_BYTES : C.LIMITS.BODY_BYTES)).then(function (body) {
      return route(body);
    });
  }).then(function (result) {
    self._json(res, 200, result === undefined ? { ok: true } : result);
  }).catch(function (e) {
    self._error(res, e);
  });
};

WebServer.prototype._routes = function () {
  var ctl = this.ctl;
  var r = {
    'GET /api/info': function () { return ctl.webInfo(); },
    'GET /api/i18n': function (q) { return ctl.webI18n(q.get('lang')); },
    'GET /api/state': function (q) { return ctl.webState(q.get('lang')); },
    'GET /api/devices': function () { return ctl.webDevices(); },
    'GET /api/audioconf': function () { return ctl.webAudioConf(); },
    'GET /api/profiles': function (q) { return ctl.webProfiles(q.get('lang')); },
    'GET /api/profile': function (q) { return ctl.webProfile(q.get('id'), q.get('lang')); },
    'POST /api/profile/save': function (b) { return ctl.webSaveProfile(b && b.profile, b && b.activate === true); },
    'POST /api/profile/delete': function (b) { return ctl.webDeleteProfile(b && b.id); },
    'POST /api/profile/rename': function (b) { return ctl.webRenameProfile(b && b.id, b && b.name); },
    'POST /api/profile/duplicate': function (b) { return ctl.webDuplicateProfile(b && b.id); },
    'GET /api/profile/print': function (q) { return ctl.webPrintProfile(q.get('id'), q.get('lang')); },
    'GET /api/commandref': function (q) { return ctl.webCommandRef(q.get('lang')); },
    'POST /api/profile/activate': function (b) { return ctl.webActivate(b && b.id, !!(b && b.active)); },
    'POST /api/profile/select': function (b) { return ctl.webSelect(b && b.id); },
    'GET /api/key': function (q) { return ctl.webKeyInfo(q); },
    'POST /api/key/configure': function (b) { return ctl.webConfigureKey(b); },
    'POST /api/profile/image/delete': function (b) { return ctl.webDeleteImage(b && b.id, b && b.slot); },
    'GET /api/receivers': function () { return ctl.webReceivers(); },
    'GET /api/receiver': function (q) { return ctl.webReceiver(q.get('id')); },
    'POST /api/receiver/save': function (b) { return ctl.webSaveReceiver(b && b.receiver); },
    'POST /api/receiver/delete': function (b) { return ctl.webDeleteReceiver(b && b.id); },
    'POST /api/receiver/image/delete': function (b) { return ctl.webDeleteReceiverImage(b && b.id, b && b.slot); },
    'GET /api/thdused': function (q) { return ctl.webThdUsed(q); },
    'GET /api/radio/presets': function () { return ctl.webRadioPresets(); },
    'POST /api/radio/check': function (b) { return ctl.webRadioCheck(b && b.uris); },
    'POST /api/radio/checkall': function (b) { return ctl.webRadioCheckAll(b && b.lang); },
    'POST /api/radio/favourites': function (b) { return ctl.webRadioFavourites(b && b.id); },
    'GET /api/presets': function (q) { return ctl.webPresets(q.get('lang')); },
    'POST /api/preset/create': function (b) { return ctl.webCreateFromPreset(b && b.id, b && b.activate === true); },
    'POST /api/capture/identify': function () { return ctl.webCapture('identify'); },
    'POST /api/capture/start': function (b) { return ctl.webCapture('start', b && b.device); },
    'POST /api/capture/keepalive': function () { return ctl.webCapture('keepalive'); },
    'POST /api/capture/stop': function () { return ctl.webCapture('stop'); }
  };
  var image = function (b) { return ctl.webSetImage(b && b.id, b && b.slot, b && b.data); };
  image.big = true;
  r['POST /api/profile/image'] = image;
  var rimage = function (b) { return ctl.webSetReceiverImage(b && b.id, b && b.slot, b && b.data); };
  rimage.big = true;
  r['POST /api/receiver/image'] = rimage;
  r['POST /api/profile/save'].limit = C.LIMITS.PROFILE_BODY_BYTES;   // Senderlogos kommen als data-URL mit
  r['POST /api/capture/stop'].anyType = true;       // navigator.sendBeacon beim Verlassen der Seite
  return r;
};

WebServer.prototype._checkOrigin = function (req) {
  var origin = req.headers.origin;
  if (!origin || origin === 'null') return;
  var host;
  try { host = new URL(origin).host; } catch (e) { throw HttpError(403, 'origin_rejected'); }
  if (host !== req.headers.host) throw HttpError(403, 'origin_rejected');
};

WebServer.prototype._body = function (req, limit) {
  return new Promise(function (resolve, reject) {
    var size = 0;
    var chunks = [];
    var failed = false;
    req.on('data', function (c) {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(HttpError(413, 'body_too_large'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (failed) return;
      var text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
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

WebServer.prototype._static = function (req, res, file) {
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

WebServer.prototype._image = function (res, id, slot, kind) {
  var store = kind === 'rimg' ? this.ctl.receivers : (kind === 'pimg' ? this.ctl.presetImages() : this.ctl.store);
  return this._file(res, Promise.resolve().then(function () { return store.imageFile(id, slot); }));
};

/** Bilddatei ausliefern; img = Promise auf { path, mime } oder null. */
WebServer.prototype._file = function (res, img) {
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

WebServer.prototype._sse = function (req, res) {
  var self = this;
  if (self.clients.length >= MAX_SSE_CLIENTS) {
    var oldest = self.clients.shift();
    try { oldest.end(); } catch (e) { /* ignore */ }
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write('retry: 2000\n\n');
  self.clients.push(res);
  req.on('close', function () {
    self.clients = self.clients.filter(function (c) { return c !== res; });
  });
};

WebServer.prototype._json = function (res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

WebServer.prototype._error = function (res, e) {
  var status = (e && e.status) || 500;
  if (status >= 500) this.logger.error(C.LOG_PREFIX + 'web request failed: ' + (e && e.stack || e));
  if (res.headersSent) {
    try { res.end(); } catch (x) { /* ignore */ }
    return;
  }
  this._json(res, status, { error: (e && e.code && typeof e.code === 'string' && status < 500) ? e.code : 'internal_error',
    detail: status < 500 && e && e.detail ? String(e.detail) : '' });
};

module.exports = { WebServer: WebServer, HttpError: HttpError };
