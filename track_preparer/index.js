'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var spawn = require('child_process').spawn;
var vConf = require('v-conf');
var http = require('http');
var os = require('os');

var VERSION = (function () {
    try { return require('./package.json').version; } catch (e) { return 'unknown'; }
}());

module.exports = ControllerTrackPreparer;

var DEFAULTS = {
    in_music: '/mnt/HDD/in/music',
    out_music: '/mnt/HDD/out/music'
};
var KEYS = Object.keys(DEFAULTS);
var HDD_ROOT = '/mnt/HDD';
var PORT_BASE = 8765;
var PORT_MAX_TRIES = 20;
var AUDIO_EXTS = ['.flac', '.mp3', '.wav', '.ape', '.wv', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma', '.ac3', '.dts', '.aiff', '.aif', '.tta', '.mpc', '.mp2', '.mka', '.shn', '.zip', '.iso', '.cue', '.m4b'];   // + архивы (.zip/.iso/.iso.wv) на распаковку

function ControllerTrackPreparer(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.pluginDir = __dirname;
    this.isRunning = false;
    this.stopping = false;
    this.child = null;
    this.server = null;
    this.port = PORT_BASE;
    this.serverStopped = false;
}

/* ---------- жизненный цикл ---------- */

ControllerTrackPreparer.prototype.onVolumioStart = function () {
    var self = this;
    self.logger.info('track_preparer: onVolumioStart');
    var configFile;
    try {
        configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    } catch (e) {
        self.logger.error('track_preparer: cannot resolve config path: ' + e);
        return libQ.resolve();
    }
    try {
        if (!fs.existsSync(configFile)) {
            fs.ensureDirSync(path.dirname(configFile));
            fs.copySync(path.join(self.pluginDir, 'config.json'), configFile);
        }
    } catch (e) {
        self.logger.error('track_preparer: cannot prepare config: ' + e);
    }
    try {
        self.config = new vConf();
        self.config.loadFile(configFile);
    } catch (e) {
        self.logger.error('track_preparer: cannot load config: ' + e);
        self.config = null;
    }
    return libQ.resolve();
};

ControllerTrackPreparer.prototype.onStart = function () {
    var self = this;
    self.logger.info('track_preparer: onStart');

    try { self.createDirs(); }
    catch (e) { self.logger.error('track_preparer: createDirs failed: ' + e); }

    try { self.markStaleRun(); }
    catch (e) { self.logger.error('track_preparer: markStaleRun failed: ' + e); }

    // Сервер поднимаем — это единственное, что действительно нужно.
    // Всё остальное обёрнуто в try/catch, чтобы не мешало.
    try { self.startServer(); }
    catch (e) {
        self.logger.error('track_preparer: startServer threw: ' + e + '\n' + (e && e.stack));
    }

    return libQ.resolve();
};

ControllerTrackPreparer.prototype.onStop = function () {
    this.logger.info('track_preparer: onStop');
    this.stopPipeline();
    this.stopServer();
    return libQ.resolve();
};

// Плагин остановлен (выключен/удаляется): просим идущую обработку закончить текущий шаг
// и выйти; если за 15 с не вышла — завершаем процесс.
ControllerTrackPreparer.prototype.stopPipeline = function () {
    var self = this, child = self.child;
    if (!self.isRunning || !child) { return; }
    self.stopping = true;
    self.cancel();
    var timer = setTimeout(function () {
        try { child.kill('SIGTERM'); } catch (e) { /* уже завершился */ }
    }, 15000);
    if (timer.unref) { timer.unref(); }
};

ControllerTrackPreparer.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

/* ---------- пути ---------- */

// Both folders must stay inside /mnt/HDD: the plugin must never write to the
// Volumio system partitions (and in particular never under /volumio).
ControllerTrackPreparer.prototype.safePath = function (value) {
    try {
        var p = path.resolve(String(value));
        if (p === HDD_ROOT || p.indexOf(HDD_ROOT + path.sep) !== 0) { return null; }
        return p;
    } catch (e) { return null; }
};

ControllerTrackPreparer.prototype.getPath = function (key) {
    var v = null;
    try { v = this.config ? this.config.get(key) : null; } catch (e) { v = null; }
    var p = (typeof v === 'string' && v.length) ? v : DEFAULTS[key];
    var safe = this.safePath(p);
    if (!safe && p !== DEFAULTS[key]) {
        this.logger.warn('track_preparer: ignoring folder outside ' + HDD_ROOT + ': ' + p);
    }
    return safe || DEFAULTS[key];
};

ControllerTrackPreparer.prototype.getPaths = function () {
    var self = this, out = {};
    KEYS.forEach(function (k) { out[k] = self.getPath(k); });
    return out;
};

// The input and output folders must not be the same or nested in one another.
ControllerTrackPreparer.prototype.pathsSeparate = function (paths) {
    var a = paths.in_music, b = paths.out_music;
    return a !== b && a.indexOf(b + path.sep) !== 0 && b.indexOf(a + path.sep) !== 0;
};

ControllerTrackPreparer.prototype.hddPresent = function () {
    try { return fs.statSync(HDD_ROOT).isDirectory(); } catch (e) { return false; }
};

ControllerTrackPreparer.prototype.createDirs = function () {
    var paths = this.getPaths();
    if (!this.hddPresent()) {
        this.logger.error('track_preparer: ' + HDD_ROOT + ' not found');
        return false;
    }
    try {
        KEYS.forEach(function (k) { fs.ensureDirSync(paths[k]); });
        fs.ensureDirSync(path.join(this.pluginDir, 'log'));
    } catch (e) {
        this.logger.error('track_preparer: cannot create dirs: ' + e);
        return false;
    }
    return true;
};

/* ---------- i18n ---------- */

function readJson(file) {
    try { return fs.readJsonSync(file); } catch (e) { return {}; }
}

ControllerTrackPreparer.prototype.langCode = function () {
    try { return this.commandRouter.sharedVars.get('language_code') || 'en'; }
    catch (e) { return 'en'; }
};

// The custom page only ships Russian and English. Volumio may use regional
// codes ("ru_RU", "en_GB"), so compare the prefix.
ControllerTrackPreparer.prototype.pageLang = function () {
    var lang = String(this.langCode() || 'en').toLowerCase().trim();
    return /^(ru|uk|be)([_-]|$)/.test(lang) ? 'ru' : 'en';
};

ControllerTrackPreparer.prototype.t = function (key) {
    var dir = path.join(this.pluginDir, 'i18n');
    var en = readJson(path.join(dir, 'strings_en.json'));
    var cur = readJson(path.join(dir, 'strings_' + this.langCode() + '.json'));
    return cur[key] || en[key] || key;
};

/* ---------- UI (страница настроек плагина) ---------- */

ControllerTrackPreparer.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var dir = path.join(self.pluginDir, 'i18n');
    var enFile = path.join(dir, 'strings_en.json');
    var langFile = path.join(dir, 'strings_' + self.langCode() + '.json');
    if (!fs.existsSync(langFile)) { langFile = enFile; }

    self.commandRouter.i18nJson(langFile, enFile, path.join(self.pluginDir, 'UIConfig.json'))
        .then(function (uiconf) {
            try {
                var url = self.monitorUrl();
                (uiconf.sections || []).forEach(function (sec) {
                    (sec.content || []).forEach(function (el) {
                        if (el.id === 'open_monitor' && el.onClick) {
                            el.onClick.url = url;
                        }
                    });
                    if (sec.id === 'section_run') {
                        sec.description = self.t('RUN_DESC') + '  (' + url + ')';
                    }
                });
            } catch (e) {
                self.logger.error('track_preparer: getUIConfig patch failed: ' + e);
            }
            defer.resolve(uiconf);
        })
        .fail(function (e) {
            self.logger.error('track_preparer: UIConfig failed: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

/* ---------- вспомогательное ---------- */

ControllerTrackPreparer.prototype.logDir = function () {
    return path.join(this.pluginDir, 'log');
};

ControllerTrackPreparer.prototype.dirHasAudio = function (dir, depth) {
    depth = depth || 0;
    if (depth > 20) { return false; }
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return false; }
    for (var i = 0; i < names.length; i++) {
        var full = path.join(dir, names[i]);
        var st;
        try { st = fs.lstatSync(full); } catch (e) { continue; }
        if (st.isSymbolicLink()) { continue; }
        if (st.isDirectory()) {
            if (this.dirHasAudio(full, depth + 1)) { return true; }
        } else if (AUDIO_EXTS.indexOf(path.extname(names[i]).toLowerCase()) !== -1) {
            return true;
        }
    }
    return false;
};

ControllerTrackPreparer.prototype.hasInput = function (paths) {
    return this.dirHasAudio(paths.in_music);
};

ControllerTrackPreparer.prototype.parseSkipped = function (stdoutTail) {
    try {
        var lines = String(stdoutTail).trim().split('\n');
        return JSON.parse(lines[lines.length - 1]).skipped || 0;
    } catch (e) {
        return 0;
    }
};

ControllerTrackPreparer.prototype.statusFile = function () {
    return path.join(this.logDir(), 'status.json');
};

ControllerTrackPreparer.prototype.readStatus = function () {
    try { return fs.readJsonSync(this.statusFile()); } catch (e) { return null; }
};

ControllerTrackPreparer.prototype.patchStatus = function (patch) {
    var st = this.readStatus() || {};
    Object.keys(patch).forEach(function (k) { st[k] = patch[k]; });
    try { fs.writeJsonSync(this.statusFile(), st); } catch (e) { /* ignore */ }
};

ControllerTrackPreparer.prototype.markStaleRun = function () {
    var st = this.readStatus();
    if (st && st.state === 'running' && !this.isRunning) {
        this.patchStatus({ state: 'error', message: 'interrupted', cancelling: false });
    }
};

ControllerTrackPreparer.prototype.tailLog = function (maxLines) {
    var file = path.join(this.logDir(), 'run.log');
    try {
        var size = fs.statSync(file).size;
        if (size === 0) { return []; }
        var len = Math.min(size, 65536);
        var buf = Buffer.alloc(len);
        var fd = fs.openSync(file, 'r');
        fs.readSync(fd, buf, 0, len, size - len);
        fs.closeSync(fd);
        var lines = buf.toString('utf8').split('\n');
        if (size > len) { lines.shift(); }
        return lines.filter(function (l) { return l.length; }).slice(-maxLines);
    } catch (e) {
        return [];
    }
};

ControllerTrackPreparer.prototype.monitorUrl = function () {
    var host = 'volumio.local';
    try {
        var ifaces = os.networkInterfaces();
        Object.keys(ifaces).forEach(function (n) {
            (ifaces[n] || []).forEach(function (a) {
                if (a.family === 'IPv4' && !a.internal && host === 'volumio.local') {
                    host = a.address;
                }
            });
        });
    } catch (e) { /* ignore */ }
    return 'http://' + host + ':' + (this.port || PORT_BASE) + '/';
};

/* ---------- запуск пайплайна ---------- */

ControllerTrackPreparer.prototype.start = function () {
    var self = this;
    if (self.isRunning) { return { ok: false, reason: 'TOAST_BUSY' }; }
    var paths = self.getPaths();
    if (!self.pathsSeparate(paths)) { return { ok: false, reason: 'TOAST_BAD_PATHS' }; }
    if (!self.createDirs()) { return { ok: false, reason: 'TOAST_NO_DISK' }; }
    if (!self.hasInput(paths)) { return { ok: false, reason: 'TOAST_EMPTY' }; }

    self.isRunning = true;
    self.stopping = false;
    try { fs.removeSync(path.join(self.logDir(), 'cancel.flag')); } catch (e) { /* ignore */ }

    var env = {};
    Object.keys(process.env).forEach(function (k) { env[k] = process.env[k]; });
    env.TP_IN_MUSIC = paths.in_music;
    env.TP_OUT_MUSIC = paths.out_music;
    env.TP_LOG_DIR = self.logDir();
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';

    var script = path.join(self.pluginDir, 'bin', 'run_pipeline.py');
    var child;
    try {
        child = spawn('nice', ['-n', '15', 'python3', script], {
            cwd: path.join(self.pluginDir, 'bin'),
            env: env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (e) {
        self.isRunning = false;
        self.logger.error('track_preparer: spawn failed: ' + e);
        return { ok: false, reason: 'TOAST_ERROR' };
    }

    self.child = child;
    var title = self.t('PLUGIN_NAME');
    var tail = '', errTail = '', finished = false;
    child.stdout.on('data', function (d) { tail = (tail + d).slice(-4096); });
    child.stderr.on('data', function (d) { errTail = (errTail + d).slice(-4096); });

    function done(failed, code) {
        if (finished) { return; }
        finished = true;
        var stopping = self.stopping;
        self.stopping = false;
        self.isRunning = false;
        self.child = null;
        var st = self.readStatus();
        if (stopping) {
            self.patchStatus({ state: 'error', message: 'interrupted', cancelling: false,
                               finished: Date.now() / 1000 });
            self.logger.info('track_preparer: pipeline stopped together with the plugin');
            return;
        }
        if (failed || (st && st.state === 'running')) {
            self.patchStatus({ state: 'error', message: errTail.slice(-300) || ('exit ' + code),
                               cancelling: false, finished: Date.now() / 1000 });
            self.logger.error('track_preparer: pipeline failed (' + code + '): ' + errTail);
            self.commandRouter.pushToastMessage('error', title, self.t('TOAST_ERROR'));
            return;
        }
        if (st && st.state === 'cancelled') {
            self.commandRouter.pushToastMessage('info', title, self.t('TOAST_CANCELLED'));
            return;
        }
        var skipped = self.parseSkipped(tail);
        if (skipped > 0) {
            self.commandRouter.pushToastMessage('warning', title,
                self.t('TOAST_DONE_PROBLEMS').replace('%d', String(skipped)));
        } else {
            self.commandRouter.pushToastMessage('success', title, self.t('TOAST_DONE'));
        }
    }

    child.on('error', function (e) { errTail += String(e); done(true, 'spawn'); });
    child.on('close', function (code) { done(code !== 0, code); });
    return { ok: true };
};

ControllerTrackPreparer.prototype.cancel = function () {
    if (!this.isRunning) { return { ok: false }; }
    try { fs.writeFileSync(path.join(this.logDir(), 'cancel.flag'), '1'); }
    catch (e) { return { ok: false }; }
    return { ok: true };
};

/* ---------- HTTP-сервер (окно выполнения) ---------- */

ControllerTrackPreparer.prototype.startServer = function () {
    var self = this;
    if (self.server && self.server.listening) {
        self.logger.info('track_preparer: web server already on ' + self.port);
        return;
    }
    self.serverStopped = false;
    self.logger.info('track_preparer: starting web server from port ' + PORT_BASE);

    function tryListen(port, attempt) {
        attempt = attempt || 0;
        var srv = http.createServer(function (req, res) {
            try { self.handleHttp(req, res); }
            catch (e) {
                self.logger.error('track_preparer: handler threw: ' + e + '\n' + (e && e.stack));
                try { res.writeHead(500); res.end('handler error'); } catch (ee) {}
            }
        });
        srv.on('error', function (e) {
            if (self.serverStopped) { return; }
            self.logger.error('track_preparer: listen error on ' + port + ': ' + e.code);
            if (e.code === 'EADDRINUSE' && attempt < PORT_MAX_TRIES) {
                tryListen(port + 1, attempt + 1);
            }
        });
        srv.listen(port, '0.0.0.0', function () {
            // onStop may have run while the asynchronous listen was pending
            if (self.serverStopped) {
                try { srv.close(); } catch (e) { /* ignore */ }
                return;
            }
            self.server = srv;
            self.port = port;
            self.logger.info('track_preparer: web server listening on 0.0.0.0:' + port
                             + '  URL: ' + self.monitorUrl());
        });
    }
    tryListen(PORT_BASE, 0);
};

ControllerTrackPreparer.prototype.stopServer = function () {
    this.serverStopped = true;
    if (this.server) {
        try { this.server.close(); } catch (e) { /* ignore */ }
        this.server = null;
    }
};

function sendJson(res, code, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
}

ControllerTrackPreparer.prototype.handleHttp = function (req, res) {
    var self = this;
    var url = (req.url || '/').split('?')[0];

    // ВАЖНО: НЕ ставим X-Frame-Options — Volumio встраивает нашу страницу
    // в iframe, и запрещающий заголовок ломает отображение.
    // Явно разрешаем встраивание откуда угодно.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");

    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        var file = path.join(self.pluginDir, 'web', 'index.html');
        var html;
        if (fs.existsSync(file)) {
            try { html = fs.readFileSync(file, 'utf8'); }
            catch (e) {
                self.logger.error('track_preparer: cannot read web/index.html: ' + e);
                html = self.fallbackHtml('cannot read web/index.html: ' + e);
            }
        } else {
            self.logger.error('track_preparer: web/index.html missing at ' + file);
            html = self.fallbackHtml('web/index.html not found at ' + file);
        }
        // The page is bilingual; tell it the language selected in Volumio,
        // not the language of the browser that opened the iframe.
        html = html.replace(/__TP_LANG__/g, self.pageLang());
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        return res.end(html);
    }

    // Диагностика: открыть /api/health — увидеть состояние.
    if (req.method === 'GET' && url === '/api/health') {
        var f = path.join(self.pluginDir, 'web', 'index.html');
        return sendJson(res, 200, {
            ok: true,
            version: VERSION,
            pluginDir: self.pluginDir,
            webFile: f,
            webFileExists: fs.existsSync(f),
            server: !!self.server,
            listening: !!(self.server && self.server.listening),
            port: self.port,
            running: self.isRunning,
            hdd: self.hddPresent(),
            paths: self.getPaths(),
            node: process.version,
            uptime: process.uptime(),
            lang: self.pageLang()
        });
    }

    if (req.method === 'GET' && url === '/api/status') {
        return sendJson(res, 200, {
            running: self.isRunning,
            status: self.readStatus(),
            paths: self.getPaths(),
            log: self.tailLog(300),
            port: self.port,
            version: VERSION,
            lang: self.pageLang()
        });
    }

    if (req.method === 'POST' && (url === '/api/start' || url === '/api/cancel')) {
        if (req.headers['x-track-preparer'] !== '1') {
            return sendJson(res, 403, { ok: false, reason: 'forbidden' });
        }
        return sendJson(res, 200, url === '/api/start' ? self.start() : self.cancel());
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + url);
};

ControllerTrackPreparer.prototype.fallbackHtml = function (reason) {
    var esc = String(reason || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    var ru = this.pageLang() === 'ru';
    var txt = ru ? {
        title: 'резервная страница',
        reason: 'Причина: ',
        explain: 'Сервер живой, но <code>web/index.html</code> не загрузился. '
            + 'Проверьте, что файл лежит в <code>&lt;pluginDir&gt;/web/index.html</code>.',
        input: 'Вход: ',
        output: 'Выход: ',
        start: 'Начать обработку'
    } : {
        title: 'fallback page',
        reason: 'Reason: ',
        explain: 'The server is running, but <code>web/index.html</code> could not be loaded. '
            + 'Make sure the file exists at <code>&lt;pluginDir&gt;/web/index.html</code>.',
        input: 'Input: ',
        output: 'Output: ',
        start: 'Start processing'
    };
    return '<!DOCTYPE html><html lang="' + (ru ? 'ru' : 'en') + '"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<title>Track Preparer (' + txt.title + ')</title>'
        + '<style>'
        + 'body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;color:#1a1a1a;padding:24px;max-width:720px;margin:auto}'
        + 'code{background:#eef0f3;padding:2px 6px;border-radius:4px;font-family:monospace}'
        + 'button{padding:12px 20px;background:#111827;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer;margin-top:12px}'
        + 'button:disabled{opacity:.5;cursor:default}'
        + '#log{background:#0f1419;color:#cfd8dc;padding:12px;border-radius:8px;height:300px;overflow:auto;'
        + 'font:12px/1.5 monospace;white-space:pre-wrap;margin-top:12px}'
        + '.err{color:#b91c1c;font-size:13px;margin-top:8px}'
        + '</style></head><body>'
        + '<h1>Track Preparer — ' + txt.title + '</h1>'
        + '<p class="err">' + txt.reason + esc + '</p>'
        + '<p>' + txt.explain + '</p>'
        + '<p>' + txt.input + '<code>/mnt/HDD/in/music</code><br>'
        + txt.output + '<code>/mnt/HDD/out/music</code></p>'
        + '<button id="b">' + txt.start + '</button>'
        + '<div id="log">…</div>'
        + '<script>'
        + 'var b=document.getElementById("b"),L=document.getElementById("log");'
        + 'b.onclick=function(){fetch("/api/start",{method:"POST",headers:{"X-Track-Preparer":"1"}})'
        + '.then(function(r){return r.json()}).then(function(x){'
        + 'if(!x.ok){L.textContent+="\\nstart: "+x.reason;}});};'
        + 'function poll(){fetch("/api/status",{cache:"no-store"}).then(function(r){return r.json()})'
        + '.then(function(d){b.disabled=d.running;L.textContent=(d.log||[]).join("\\n")||"…";'
        + 'L.scrollTop=L.scrollHeight;}).catch(function(){}).then(function(){setTimeout(poll,1500)})}poll();'
        + '</script></body></html>';
};