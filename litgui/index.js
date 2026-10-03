'use strict';

/**
 * LitGUI plugin controller.
 *
 * Volumio's plugin runtime instantiates this controller, calls
 * onVolumioStart() during boot, then onStart() once the user enables
 * the plugin. On start the plugin does TWO independent things, each
 * isolated so one failing never prevents the other or stops the plugin:
 *
 *   1. Express server (port from config.json, default 7777) — the
 *      PRIMARY access path. Serves ./ui/ statically and is always
 *      reachable at http://<volumio>:<port> regardless of which UI is
 *      selected in Volumio's settings. A catch-all route returns
 *      index.html so the client-side-routed SPA works on deep links
 *      (e.g. /playback) just as it does under Volumio's own server.
 *
 *   2. registerThirdPartyUI — the DISCOVERY/kiosk path. Lists LitGUI in
 *      Settings → System → User Interface Style so users with an
 *      attached display can set it as the default UI at the root URL.
 *
 * Node convention: Volumio 3's plugin runtime is Node 14 here (>=8
 * required), so this file uses ES5 prototype style (var, function
 * constructor). The bundled UI is ES module syntax — that's served to
 * the browser, not run in Node.
 */

var libQ = require('kew');
var express = require('express');
var path = require('path');
var fs = require('fs');
var os = require('os');

var DEFAULT_PORT = 7777;

module.exports = ControllerLitGUI;

function ControllerLitGUI(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;

  this.port = DEFAULT_PORT;
  this.expressApp = null;
  this.expressServer = null;
}

ControllerLitGUI.prototype.onVolumioStart = function () {
  // Read the Express port from config.json using plain fs — no external
  // config library needed for a single read-only value. config.json sits
  // next to this file. Any read/parse failure falls back to DEFAULT_PORT
  // so a missing or malformed config never stops the plugin from starting.
  this.port = DEFAULT_PORT;
  try {
    var raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    var cfg = JSON.parse(raw);
    var configured = cfg && cfg.port && cfg.port.value;
    if (typeof configured === 'number' && configured > 0) {
      this.port = configured;
    }
  } catch (e) {
    this.logger.warn(
      '[LitGUI] Could not read port from config.json, using default ' +
      DEFAULT_PORT + ': ' + (e && e.message ? e.message : e)
    );
  }
  return libQ.resolve();
};

ControllerLitGUI.prototype.onStart = function () {
  var self = this;

  // ── Path 1: Express server (primary access) ───────────────
  // Wrapped so a failure here (e.g. port in use) logs a warning but
  // does NOT prevent registerThirdPartyUI or stop the plugin.
  try {
    self._startExpress();
  } catch (e) {
    self.logger.warn(
      '[LitGUI] Express server failed to start: ' + (e && e.message ? e.message : e)
    );
  }

  // ── Path 2: registerThirdPartyUI (discovery / kiosk) ──────
  // Independent of Express; isolated for the same reason.
  try {
    var uiData = {
      uiPrettyName: 'LitGUI',
      uiName: 'litgui',
      uiPath: __dirname + '/ui'
    };
    self.commandRouter.registerThirdPartyUI(uiData);
    self.logger.info('[LitGUI] Third Party UI registered at /litgui/');
  } catch (e) {
    self.logger.warn(
      '[LitGUI] registerThirdPartyUI failed: ' + (e && e.message ? e.message : e)
    );
  }

  return libQ.resolve();
};

ControllerLitGUI.prototype._startExpress = function () {
  var self = this;

  var port = self.port || DEFAULT_PORT;

  var uiDir = path.join(__dirname, 'ui');
  var app = express();

  // Serve static assets (index.html, litgui-panel.js, favicon.svg).
  app.use(express.static(uiDir));

  // SPA fallback: any GET that didn't match a static file returns
  // index.html so client-side routes (e.g. /playback) resolve. Using a
  // middleware (not app.get('*')) avoids path-pattern parsing quirks.
  app.use(function (req, res, next) {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(uiDir, 'index.html'));
  });

  self.expressApp = app;
  self.expressServer = app.listen(port, function () {
    self.logger.info('[LitGUI] Express serving UI on port ' + port);
  });

  self.expressServer.on('error', function (err) {
    self.logger.warn(
      '[LitGUI] Express server error: ' + (err && err.message ? err.message : err)
    );
  });
};

ControllerLitGUI.prototype.onStop = function () {
  var self = this;

  // Close the Express server so the port is freed and the plugin can be
  // cleanly restarted. Guarded — onStop must resolve even if Express
  // never started.
  try {
    if (self.expressServer) {
      self.expressServer.close();
      self.expressServer = null;
      self.expressApp = null;
      self.logger.info('[LitGUI] Express server stopped');
    }
  } catch (e) {
    self.logger.warn(
      '[LitGUI] Error stopping Express server: ' + (e && e.message ? e.message : e)
    );
  }

  // Volumio exposes no deregister API for Third Party UIs in the public
  // commandRouter surface. The user's UI selection persists; disabling
  // or uninstalling the plugin makes the UI files unavailable but the
  // setting stays pointed at LitGUI until they switch back.
  this.logger.info('[LitGUI] Plugin stopped');
  return libQ.resolve();
};

ControllerLitGUI.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};
// ── Settings page (cog) ──────────────────────────────────────────
// Volumio calls getUIConfig when the user opens the plugin's settings.
// We load the static UIConfig.json shell (via i18nJson for transl/label
// resolution) then inject ONE "Open LitGUI" button per usable network
// interface. Each button is an absolute http://<ip>:<port> openUrl,
// because the settings page is served by Volumio on :3000 — a relative
// URL cannot reach the plugin's own Express port, and Node cannot know
// which interface the browser used, so we list them all and let the user
// pick the address matching their network.
ControllerLitGUI.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();
  var lang_code = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
    .then(function (uiconf) {
      var port = self.port || DEFAULT_PORT;
      var ips = self._getUsableIPv4s();
      var labelBase = 'Open LitGUI';
      try {
        var s = JSON.parse(fs.readFileSync(__dirname + '/i18n/strings_en.json', 'utf8'));
        if (s && s.OPEN_BUTTON_LABEL) labelBase = s.OPEN_BUTTON_LABEL;
      } catch (e) { /* fall back to default label */ }

      var content = [];
      if (ips.length === 0) {
        // No usable interface detected — show a non-clickable hint instead
        // of a broken button.
        content.push({
          id: 'open_none',
          element: 'button',
          label: labelBase,
          description: 'No network address detected. Open http://<device-ip>:' + port + ' manually.',
          onClick: { type: 'openUrl', url: 'http://127.0.0.1:' + port }
        });
      } else {
        ips.forEach(function (nic, i) {
          content.push({
            id: 'open_' + i,
            element: 'button',
            label: labelBase,
            description: nic.iface + ' — ' + nic.address + ':' + port,
            onClick: { type: 'openUrl', url: 'http://' + nic.address + ':' + port }
          });
        });
      }

      uiconf.sections[0].content = content;
      defer.resolve(uiconf);
    })
    .fail(function (e) {
      self.logger.error('[LitGUI] getUIConfig failed: ' + (e && e.message ? e.message : e));
      defer.reject(new Error());
    });

  return defer.promise;
};

// Return usable non-internal IPv4 interfaces as {iface, address}.
// Skips loopback/internal and common virtual ranges (docker/veth/bridge)
// so the buttons point at real LAN addresses.
ControllerLitGUI.prototype._getUsableIPv4s = function () {
  var out = [];
  var ifaces = {};
  try { ifaces = os.networkInterfaces() || {}; } catch (e) { return out; }

  Object.keys(ifaces).forEach(function (name) {
    // Skip obvious virtual interfaces by name.
    if (/^(lo|docker|veth|br-|virbr|tun|tap)/i.test(name)) return;
    (ifaces[name] || []).forEach(function (addr) {
      if (!addr || addr.internal) return;
      var fam = addr.family;
      if (fam !== 'IPv4' && fam !== 4) return;
      // Skip docker's default 172.17/16 bridge range.
      if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr.address)) return;
      out.push({ iface: name, address: addr.address });
    });
  });
  return out;
};
