'use strict';

var libQ = require('kew');
var vconf = require('v-conf');

module.exports = ControllerPlex;

function ControllerPlex(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;
  this.config = new vconf();
  this.adapter = null;
  this._plexLoginState = null;
  this._started = false;
}

// ── Plex Login Helpers ───────────────────────────────────────────────

function plexTvRequest(method, path, headers, postBody) {
  var https = require('https');
  return new Promise(function (resolve, reject) {
    var defaultHeaders = { 'Accept': 'application/json' };
    if (method === 'POST' && !postBody) {
      defaultHeaders['Content-Length'] = '0';
    }
    var options = {
      hostname: 'plex.tv',
      path: path,
      method: method,
      headers: Object.assign(defaultHeaders, headers),
      timeout: 10000,
    };
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Failed to parse Plex.tv response')); }
        } else {
          reject(new Error('Plex.tv API error: HTTP ' + res.statusCode + ' body: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('timeout', function () {
      req.destroy(new Error('Request to plex.tv timed out'));
    });
    req.on('error', reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

function generateClientId() {
  return require('crypto').randomBytes(16).toString('hex');
}

// Returns true for addresses that are noise rather than real server connections:
//   172.16–31.x.x  — Docker bridge networks (172.16.0.0/12)
//   127.x.x.x      — loopback
//   169.254.x.x    — link-local / APIPA
// Also handles Plex hostnames that encode the IP with dashes, e.g.:
//   172-17-0-1.abc123.plex.direct  →  decoded as 172.17.0.1  →  noisy
function isNoisyAddress(host) {
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^127\./.test(host)
    || /^169\.254\./.test(host)) return true;

  // Decode dash-encoded IP prefix used in plex.direct / plex.tv hostnames.
  var m = host.match(/^(\d+)-(\d+)-(\d+)-(\d+)\./);
  if (m) return isNoisyAddress(m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4]);

  return false;
}

// Sort score for a connection host: lower = more preferred.
// Home routers assign low 3rd octets (192.168.0.x, 192.168.1.x).
// Docker Compose uses 192.168.16.x, 192.168.32.x, etc.
// By sorting ascending we naturally pick the real server before Docker duplicates.
function connSortScore(host) {
  var ip = host;
  var m = host.match(/^(\d+)-(\d+)-(\d+)-(\d+)\./);
  if (m) ip = m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4];
  var m192 = ip.match(/^192\.168\.(\d+)\./);
  if (m192) return parseInt(m192[1]);   // 0–255: prefer lower 3rd octet
  if (/^10\./.test(ip)) return 300;
  return 400;                           // hostnames (plex.direct etc.)
}

// Extract { protocol, host, port } from a Plex connection URI.
// Plex always includes a full URI (e.g. https://192-168-1-1.abc.plex.direct:32400)
// which gives us the correct hostname for TLS SNI/cert matching.
function parseConnUri(uri) {
  var m = (uri || '').match(/^(https?):\/\/([^:/]+)(?::(\d+))?/);
  if (!m) return null;
  return { protocol: m[1], host: m[2], port: Number(m[3]) || (m[1] === 'https' ? 443 : 80) };
}


ControllerPlex.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config.loadFile(configFile);

  var host = this.config.get('host') || '';
  var port = this.config.get('port') || 32400;
  var token = this.config.get('token') || '';
  var https = this.config.get('https') || false;
  var shuffle = this.config.get('shuffle') || false;
  var pageSize = this.config.get('pageSize') || 100;
  var gaplessPlayback = this.config.get('gaplessPlayback') !== false;
  var crossfadeEnabled = this.config.get('crossfadeEnabled') || false;
  var crossfadeDuration = this.config.get('crossfadeDuration') || 5;

  this._initAdapter(host, port, token, https, shuffle, pageSize, gaplessPlayback, crossfadeEnabled, crossfadeDuration);

  return libQ.resolve();
};

ControllerPlex.prototype.onStart = function () {
  this._started = true;
  if (this.adapter) {
    this.adapter.onStart();
  }
  return libQ.resolve();
};

ControllerPlex.prototype.onStop = function () {
  this._started = false;
  if (this.adapter) {
    this.adapter.onStop();
  }
  return libQ.resolve();
};

ControllerPlex.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// ── UI Config ───────────────────────────────────────────────────────

ControllerPlex.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;
  var lang_code = this.commandRouter.sharedVars.get('language_code');

  this.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
    .then(function (uiconf) {
      // plex_login section (sections[0])
      var loginState = self._plexLoginState;
      uiconf.sections[0].content[1].value = (loginState && loginState.authUrl) ? loginState.authUrl : '';
      if (loginState && loginState.connectionOptions && loginState.connectionOptions.length > 0) {
        uiconf.sections[0].content[3].options = loginState.connectionOptions;
        uiconf.sections[0].content[3].value = loginState.connectionOptions[0];
      }

      // plex_connection section (sections[1])
      uiconf.sections[1].content[0].value = self.config.get('host') || '';
      uiconf.sections[1].content[1].value = self.config.get('port') || 32400;
      uiconf.sections[1].content[2].value = self.config.get('token') || '';
      uiconf.sections[1].content[3].value = self.config.get('https') || false;

      // plex_browse section (sections[2])
      uiconf.sections[2].content[0].value = self.config.get('shuffle') || false;
      uiconf.sections[2].content[1].value = self.config.get('pageSize') || 100;

      // plex_playback section (sections[3])
      uiconf.sections[3].content[0].value = self.config.get('gaplessPlayback') !== false;
      uiconf.sections[3].content[1].value = self.config.get('crossfadeEnabled') || false;
      uiconf.sections[3].content[2].value = self.config.get('crossfadeDuration') || 5;

      defer.resolve(uiconf);
    })
    .fail(function (error) {
      self.logger.error('[Plex] Failed to load UI config: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

ControllerPlex.prototype.saveConfig = function (data) {
  var safeData = Object.assign({}, data);
  if (safeData.token) {
    safeData.token = typeof safeData.token === 'object'
      ? Object.assign({}, safeData.token, { value: '████████' })
      : '████████';
  }
  this.logger.info('[Plex] saveConfig data: ' + JSON.stringify(safeData));

  var host = (data.host && data.host.value !== undefined) ? data.host.value : data.host;
  var port = (data.port && data.port.value !== undefined) ? data.port.value : data.port;
  var token = (data.token && data.token.value !== undefined) ? data.token.value : data.token;
  var https = (data.https && data.https.value !== undefined) ? data.https.value : data.https;

  // v-conf requires port to be a number
  port = Number(port) || 32400;
  https = !!https;

  this.config.set('host', host);
  this.config.set('port', port);
  this.config.set('token', token);
  this.config.set('https', https);

  var shuffle = this.config.get('shuffle') || false;
  var pageSize = this.config.get('pageSize') || 100;
  var gaplessPlayback = this.config.get('gaplessPlayback') !== false;
  var crossfadeEnabled = this.config.get('crossfadeEnabled') || false;
  var crossfadeDuration = this.config.get('crossfadeDuration') || 5;
  this._initAdapter(host, port, token, https, shuffle, pageSize, gaplessPlayback, crossfadeEnabled, crossfadeDuration);

  this.commandRouter.pushToastMessage('success', 'Plex', 'Configuration saved');
  return libQ.resolve();
};

ControllerPlex.prototype.saveBrowseOptions = function (data) {
  this.logger.info('[Plex] saveBrowseOptions data: ' + JSON.stringify(data));

  var shuffle = (data.shuffle && data.shuffle.value !== undefined) ? data.shuffle.value : data.shuffle;
  shuffle = !!shuffle;

  var pageSize = (data.pageSize && data.pageSize.value !== undefined) ? data.pageSize.value : data.pageSize;
  pageSize = Number(pageSize) || 100;
  if (pageSize < 10) pageSize = 10;
  if (pageSize > 1000) pageSize = 1000;

  this.config.set('shuffle', shuffle);
  this.config.set('pageSize', pageSize);

  var host = this.config.get('host') || '';
  var port = this.config.get('port') || 32400;
  var token = this.config.get('token') || '';
  var https = this.config.get('https') || false;
  var gaplessPlayback = this.config.get('gaplessPlayback') !== false;
  var crossfadeEnabled = this.config.get('crossfadeEnabled') || false;
  var crossfadeDuration = this.config.get('crossfadeDuration') || 5;

  this._initAdapter(host, port, token, https, shuffle, pageSize, gaplessPlayback, crossfadeEnabled, crossfadeDuration);

  this.commandRouter.pushToastMessage('success', 'Plex', 'Options saved');
  return libQ.resolve();
};

ControllerPlex.prototype.savePlaybackOptions = function (data) {
  this.logger.info('[Plex] savePlaybackOptions data: ' + JSON.stringify(data));

  var gaplessPlayback = (data.gaplessPlayback && data.gaplessPlayback.value !== undefined) ? data.gaplessPlayback.value : data.gaplessPlayback;
  gaplessPlayback = gaplessPlayback !== false;

  var crossfadeEnabled = (data.crossfadeEnabled && data.crossfadeEnabled.value !== undefined) ? data.crossfadeEnabled.value : data.crossfadeEnabled;
  crossfadeEnabled = !!crossfadeEnabled;

  var crossfadeDuration = (data.crossfadeDuration && data.crossfadeDuration.value !== undefined) ? data.crossfadeDuration.value : data.crossfadeDuration;
  crossfadeDuration = Number(crossfadeDuration) || 5;
  if (crossfadeDuration < 1) crossfadeDuration = 1;
  if (crossfadeDuration > 12) crossfadeDuration = 12;

  this.config.set('gaplessPlayback', gaplessPlayback);
  this.config.set('crossfadeEnabled', crossfadeEnabled);
  this.config.set('crossfadeDuration', crossfadeDuration);

  var host = this.config.get('host') || '';
  var port = this.config.get('port') || 32400;
  var token = this.config.get('token') || '';
  var https = this.config.get('https') || false;
  var shuffle = this.config.get('shuffle') || false;
  var pageSize = this.config.get('pageSize') || 100;

  this._initAdapter(host, port, token, https, shuffle, pageSize, gaplessPlayback, crossfadeEnabled, crossfadeDuration);

  this.commandRouter.pushToastMessage('success', 'Plex', 'Options saved');
  return libQ.resolve();
};

// ── Browse ──────────────────────────────────────────────────────────

ControllerPlex.prototype.handleBrowseUri = function (uri) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.handleBrowseUri(uri);
};

// ── Explode ─────────────────────────────────────────────────────────

ControllerPlex.prototype.explodeUri = function (uri) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.explodeUri(uri);
};

// ── Playback ────────────────────────────────────────────────────────

ControllerPlex.prototype.clearAddPlayTrack = function (track) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.clearAddPlayTrack(track);
};

ControllerPlex.prototype.prefetch = function (track) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.prefetch(track);
};

ControllerPlex.prototype.stop = function () {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.stop();
};

ControllerPlex.prototype.pause = function () {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.pause();
};

ControllerPlex.prototype.resume = function () {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.resume();
};

ControllerPlex.prototype.seek = function (position) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.seek(position);
};

ControllerPlex.prototype.next = function () {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.next();
};

ControllerPlex.prototype.previous = function () {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.previous();
};

// ── Search ──────────────────────────────────────────────────────────

ControllerPlex.prototype.search = function (query) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.search(query);
};

// ── Goto ────────────────────────────────────────────────────────────

ControllerPlex.prototype.goto = function (data) {
  if (!this.adapter) {
    return libQ.reject(new Error('Plex plugin not initialized'));
  }
  return this.adapter.goto(data);
};

// ── Plex Login ──────────────────────────────────────────────────────

ControllerPlex.prototype._getPlexClientId = function () {
  var id = this.config.get('clientId');
  if (!id) {
    id = generateClientId();
    this.config.set('clientId', id);
  }
  return id;
};

ControllerPlex.prototype._refreshUI = function () {
  var self = this;
  self.getUIConfig().then(function (uiconf) {
    self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
  }).fail(function (err) {
    self.logger.error('[Plex] Failed to refresh UI: ' + err);
  });
};

ControllerPlex.prototype.startPlexLogin = function () {
  var self = this;
  var clientId = self._getPlexClientId();
  var headers = {
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Product': 'Volumio Plex Plugin',
  };

  self.logger.info('[Plex] Starting Plex login flow');

  return libQ.resolve(
    plexTvRequest('POST', '/api/v2/pins?strong=true', headers)
      .then(function (pin) {
        self.logger.info('[Plex] PIN response: id=' + pin.id + ' code=' + pin.code + ' expiresAt=' + pin.expiresAt);

        var params = [
          ['clientID', clientId],
          ['code', pin.code],
          ['context[device][product]', 'Volumio Plex Plugin'],
          ['context[device][environment]', 'bundled'],
          ['context[device][layout]', 'desktop'],
          ['context[device][platform]', 'Web'],
          ['context[device][version]', '4.0'],
        ].map(function (pair) {
          return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
        }).join('&');

        var authUrl = 'https://app.plex.tv/auth#?' + params;

        self._plexLoginState = {
          pinId: pin.id,
          clientId: clientId,
          authUrl: authUrl,
          servers: [],
        };

        self.logger.info('[Plex] PIN created: ' + pin.code);
        self.commandRouter.pushToastMessage('info', 'Plex', 'Open the Auth URL shown below in a browser, then click Check Login Status');
        self._refreshUI();
      })
      .catch(function (err) {
        self.logger.error('[Plex] startPlexLogin failed: ' + err);
        self.commandRouter.pushToastMessage('error', 'Plex', 'Login failed: ' + err.message);
      })
  );
};

ControllerPlex.prototype.checkPlexLogin = function () {
  var self = this;
  if (!self._plexLoginState || !self._plexLoginState.pinId) {
    self.commandRouter.pushToastMessage('warning', 'Plex', 'Click "Login with Plex" first');
    return libQ.resolve();
  }

  var state = self._plexLoginState;
  var headers = {
    'X-Plex-Client-Identifier': state.clientId,
    'X-Plex-Product': 'Volumio Plex Plugin',
  };

  return libQ.resolve(
    plexTvRequest('GET', '/api/v2/pins/' + state.pinId, headers)
      .then(function (pin) {
        self.logger.info('[Plex] PIN poll: id=' + pin.id + ' authToken=' + (pin.authToken ? 'present' : 'null') + ' keys=' + Object.keys(pin).join(','));
        if (!pin.authToken) {
          self.commandRouter.pushToastMessage('info', 'Plex', 'Not yet authenticated — open the Auth URL and sign in first');
          return;
        }

        var resourceHeaders = Object.assign({}, headers, { 'X-Plex-Token': pin.authToken });
        return plexTvRequest('GET', '/api/v2/resources?includeHttps=1&includeRelay=0&includeIPv6=0', resourceHeaders)
          .then(function (resources) {
            var servers = resources.filter(function (r) {
              return r.provides && r.provides.indexOf('server') >= 0;
            });

            if (servers.length === 0) {
              self.commandRouter.pushToastMessage('warning', 'Plex', 'No Plex Media Servers found on your account');
              return;
            }

            // 1. Collect all candidates after basic filtering.
            var candidates = [];
            servers.forEach(function (s) {
              (s.connections || []).forEach(function (c) {
                var parsed = parseConnUri(c.uri);
                var host = (parsed && parsed.host) ? parsed.host : c.address;
                var port = (parsed && parsed.port) ? parsed.port : c.port;
                var protocol = c.protocol;
                var isRawIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);

                if (isNoisyAddress(host)) return;
                if (protocol === 'https' && isRawIp) return;

                candidates.push({ s: s, c: c, host: host, port: port, protocol: protocol });

                // Plex servers configured for "Secure connections: Required/Preferred"
                // only advertise HTTPS in the cloud API.  Recover the HTTP option by
                // decoding the IP that is encoded in the .plex.direct hostname.
                if (protocol === 'https' && c.local) {
                  var dashIp = host.match(/^(\d+)-(\d+)-(\d+)-(\d+)\./);
                  if (dashIp) {
                    var rawIp = dashIp[1] + '.' + dashIp[2] + '.' + dashIp[3] + '.' + dashIp[4];
                    if (!isNoisyAddress(rawIp)) {
                      candidates.push({ s: s, c: c, host: rawIp, port: port, protocol: 'http' });
                    }
                  }
                }
              });
            });

            // 2. Sort so that lower 192.168.x.x third-octets come first,
            //    ensuring real LAN IPs (192.168.0/1.x) beat Docker ones (192.168.16.x+).
            candidates.sort(function (a, b) {
              return connSortScore(a.host) - connSortScore(b.host);
            });

            // 3. Deduplicate: keep only the first (best) connection per
            //    (server × local/remote × protocol) group.
            var seen = Object.create(null);
            var connectionOptions = [];
            candidates.forEach(function (item) {
              var scope = item.c.local ? 'local' : 'remote';
              var key = item.s.clientIdentifier + '|' + scope + '|' + item.protocol;
              if (seen[key]) return;
              seen[key] = true;
              var label = item.s.name + ' \u2014 ' + scope + ' ' + item.protocol.toUpperCase()
                + ' (' + item.host + ':' + item.port + ')';
              var value = [item.s.clientIdentifier, item.host, String(item.port), item.protocol].join('|');
              connectionOptions.push({ value: value, label: label });
            });

            // Fallback: if filtering removed everything, show raw HTTP connections.
            if (connectionOptions.length === 0) {
              servers.forEach(function (s) {
                (s.connections || []).forEach(function (c) {
                  if (c.protocol !== 'http') return;
                  var scope = c.local ? 'local' : 'remote';
                  var label = s.name + ' \u2014 ' + scope + ' HTTP (' + c.address + ':' + c.port + ')';
                  var value = [s.clientIdentifier, c.address, String(c.port), 'http'].join('|');
                  connectionOptions.push({ value: value, label: label });
                });
              });
            }

            state.authToken = pin.authToken;
            state.servers = servers;
            state.connectionOptions = connectionOptions;
            self.commandRouter.pushToastMessage('success', 'Plex', 'Found ' + connectionOptions.length + ' connection(s) — select one and click Apply Server');
            self._refreshUI();
          });
      })
      .catch(function (err) {
        self.logger.error('[Plex] checkPlexLogin failed: ' + err);
        self.commandRouter.pushToastMessage('error', 'Plex', 'Check failed: ' + err.message);
      })
  );
};

ControllerPlex.prototype.applyPlexServer = function (data) {
  var self = this;
  var state = self._plexLoginState;

  if (!state || !state.servers || state.servers.length === 0) {
    self.commandRouter.pushToastMessage('warning', 'Plex', 'No servers available — complete login first');
    return libQ.resolve();
  }

  var selectedValue = (data.plexServer && data.plexServer.value !== undefined)
    ? data.plexServer.value
    : data.plexServer;

  var parts = (selectedValue || '').split('|');
  var serverId = parts[0];
  var host = parts[1];
  var port = Number(parts[2]);
  var proto = parts[3];

  if (!host || !port || !proto) {
    self.commandRouter.pushToastMessage('error', 'Plex', 'No connection selected — check login status first');
    return libQ.resolve();
  }

  var server = state.servers.find(function (s) { return s.clientIdentifier === serverId; })
    || state.servers[0];

  var token = server.accessToken || state.authToken;
  var useHttps = proto === 'https';

  self.config.set('host', host);
  self.config.set('port', port);
  self.config.set('token', token);
  self.config.set('https', useHttps);

  var shuffle = self.config.get('shuffle') || false;
  var pageSize = self.config.get('pageSize') || 100;
  var gaplessPlayback = self.config.get('gaplessPlayback') !== false;
  var crossfadeEnabled = self.config.get('crossfadeEnabled') || false;
  var crossfadeDuration = self.config.get('crossfadeDuration') || 5;

  self._initAdapter(host, port, token, useHttps, shuffle, pageSize, gaplessPlayback, crossfadeEnabled, crossfadeDuration);
  self.commandRouter.pushToastMessage('success', 'Plex', 'Connected to ' + server.name);
  self._refreshUI();
  return libQ.resolve();
};

// ── Internal ────────────────────────────────────────────────────────

ControllerPlex.prototype._initAdapter = function (host, port, token, https, shuffle, pageSize, gaplessPlayback, crossfadeEnabled, crossfadeDuration) {
  if (this.adapter && this._started) {
    this.adapter.onStop();
  }

  var compiled = require('./dist/index.js');
  var VolumioAdapter = compiled.VolumioAdapter;
  var PlexApiClient = compiled.PlexApiClient;
  var PlexService = compiled.PlexService;

  var connection = { host: host, port: port, token: token, https: !!https };
  var apiClient = new PlexApiClient(connection);
  var plexService = new PlexService(apiClient, connection);

  this.adapter = new VolumioAdapter(this.context, libQ);
  this.adapter.configure(plexService, connection, {
    shuffle: !!shuffle,
    pageSize: Number(pageSize) || 100,
    gaplessPlayback: gaplessPlayback !== false,
    crossfadeEnabled: !!crossfadeEnabled,
    crossfadeDuration: Number(crossfadeDuration) || 5,
  });

  if (this._started) {
    this.adapter.onStart();
  }
};
