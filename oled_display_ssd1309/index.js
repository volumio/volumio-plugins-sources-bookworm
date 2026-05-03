'use strict';

/**
 * Volumio OLED Display Plugin (v1.7.17)
 *
 * Changes from v1.7.15:
 *   - Configurable date format dropdown: Day + Month name, DD.MM.YYYY,
 *     MM/DD/YYYY, YYYY-MM-DD.  Translated in all 7 languages.
 *   - Fixed i18nJson parameter order (language file first, default second).
 *   - UIConfig.json uses TRANSLATE. prefix per Volumio's documented pattern.
 *
 * NOTE: Lifecycle methods (onVolumioStart, onStart, onStop, getUIConfig,
 * saveConfig) MUST return kew promises — Volumio 4's plugin manager
 * rejects native Promises with "does not return adequate promise".
 * Internal methods (_startPlugin, _stopPlugin) use native Promises.
 */

var fs = require('fs');
var path = require('path');
var libQ = require('/volumio/node_modules/kew');  // Required: Volumio's plugin manager checks for kew promises

module.exports = ControllerOledDisplay;

var MAX_CONSECUTIVE_ERRORS = 3;
var MIN_BACKOFF_MS = 2000;
var MAX_BACKOFF_MS = 30000;
var BACKOFF_MULTIPLIER = 2;

// Splash screen safety timeout: if Volumio never sends pushState,
// auto-dismiss the splash after this many milliseconds.
var SPLASH_TIMEOUT_MS = 30000;

function ControllerOledDisplay(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;

  this.display = null;
  this.renderer = null;
  this.socket = null;
  this.config = null;

  this._renderTimerId = null;
  this._rendering = false;
  this._renderInterval = 500;
  this._consecutiveErrors = 0;
  this._currentBackoff = 0;
  this._circuitOpen = false;
  this._stopped = false;
  this._sigTermHandler = null;

  // Cached config values
  this._cachedContrast = 255;
  this._cachedIdleContrast = 30;
  this._cachedIdleDimMs = 120000;
  this._cachedScreensaverMode = 'bouncing_clock';
  this._cachedScreensaverMs = 300000;
  this._cachedVolumeOverlayMs = 2000;
  this._cachedPlaybackLayout = 'classic';
  this._cachedDateFormat = 'day_month_name';

  // Splash screen: stays active until first pushState arrives (or safety timeout)
  this._splashActive = true;
  this._splashStartTime = Date.now();

  // Screensaver state
  this._screensaverActive = false;

  this.currentState = {
    title: '', artist: '', status: 'stop', seek: 0,
    duration: 0, volume: 0, bitdepth: '', samplerate: '', bitrate: '',
    trackType: ''
  };
  this._lastStateTime = null;
  this.lastActivityTime = Date.now();
  this._lastVolumeChangeTime = 0;
  this.isDimmed = false;
  this._lastSocketErrLog = 0;
}


// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

ControllerOledDisplay.prototype.onVolumioStart = function () {
  this._ensureConfig();
  return libQ.resolve();
};

ControllerOledDisplay.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  self._ensureConfig();
  self._stopped = false;

  self._startPlugin()
    .then(function () {
      self.logger.info('OLED: Plugin started successfully');
      defer.resolve();
    })
    .catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      self.logger.error('OLED: Start failed: ' + msg);
      try {
        self.commandRouter.pushToastMessage('error', 'OLED Display',
          'Display failed: ' + msg);
      } catch (_) { }
      defer.resolve();
    });

  return defer.promise;
};

ControllerOledDisplay.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  self._stopped = true;

  self._stopPlugin()
    .then(function () {
      self.logger.info('OLED: Plugin stopped');
      defer.resolve();
    })
    .catch(function (err) {
      self.logger.error('OLED: Stop error: ' + ((err && err.message) ? err.message : err));
      defer.resolve();
    });

  return defer.promise;
};


// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

ControllerOledDisplay.prototype._getInt = function (key, fallback) {
  if (!this.config) return fallback;
  var raw = this.config.get(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  var val = parseInt(raw, 10);
  return isNaN(val) ? fallback : val;
};

ControllerOledDisplay.prototype._getBool = function (key, fallback) {
  if (!this.config) return fallback;
  var raw = this.config.get(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.toLowerCase() === 'true';
  return !!raw;
};

ControllerOledDisplay.prototype._getStr = function (key, fallback) {
  if (!this.config) return fallback;
  var raw = this.config.get(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw);
};

ControllerOledDisplay.prototype._cacheConfig = function () {
  this._cachedContrast = this._getInt('contrast', 255);
  this._cachedIdleContrast = this._getInt('idle_contrast', 30);
  this._cachedIdleDimMs = this._getInt('idle_dim_seconds', 120) * 1000;
  this._cachedScreensaverMode = this._getStr('screensaver_mode', 'bouncing_clock');
  this._cachedScreensaverMs = this._getInt('screensaver_seconds', 300) * 1000;
  this._cachedVolumeOverlayMs = this._getInt('volume_overlay_seconds', 2) * 1000;
  this._cachedPlaybackLayout = this._getStr('playback_layout', 'classic');
  this._cachedDateFormat = this._getStr('date_format', 'day_month_name');
};

ControllerOledDisplay.prototype._ensureConfig = function () {
  if (this.config) return;

  var vconf = require('/volumio/node_modules/v-conf');
  this.config = new vconf();

  // Try Volumio-managed config path first (persists across reboots)
  try {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(
      this.context, 'config.json'
    );
    this.config.loadFile(configFile);
    this.logger.info('OLED: Config loaded from ' + configFile);
    return;
  } catch (err) {
    this.logger.warn('OLED: pluginManager config unavailable: ' +
      ((err && err.message) ? err.message : err));
  }

  // Fallback: bundled default (writes here may not persist across reboots
  // if Volumio later creates its own managed copy)
  try {
    var fallbackPath = path.join(__dirname, 'config.json');
    this.config.loadFile(fallbackPath);
    this.logger.warn('OLED: Config loaded from fallback: ' + fallbackPath);
  } catch (err2) {
    this.logger.error('OLED: Fallback config failed: ' +
      ((err2 && err2.message) ? err2.message : err2));
  }
};

/**
 * Load localized day/month names from the i18n strings file
 * matching Volumio's current language setting.  Falls back to English.
 */
ControllerOledDisplay.prototype._loadLanguageData = function () {
  var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  try {
    var langCode = this.commandRouter.sharedVars.get('language_code') || 'en';
    var langFile = path.join(__dirname, 'i18n', 'strings_' + langCode + '.json');

    if (!fs.existsSync(langFile)) {
      langFile = path.join(__dirname, 'i18n', 'strings_en.json');
    }

    var strings = JSON.parse(fs.readFileSync(langFile, 'utf8'));
    var date = strings.DATE || {};

    var dayKeys = ['DAY_SUN', 'DAY_MON', 'DAY_TUE', 'DAY_WED', 'DAY_THU', 'DAY_FRI', 'DAY_SAT'];
    var monKeys = ['MON_JAN', 'MON_FEB', 'MON_MAR', 'MON_APR', 'MON_MAY', 'MON_JUN',
                   'MON_JUL', 'MON_AUG', 'MON_SEP', 'MON_OCT', 'MON_NOV', 'MON_DEC'];

    for (var d = 0; d < 7; d++) {
      if (date[dayKeys[d]]) dayNames[d] = date[dayKeys[d]];
    }
    for (var m = 0; m < 12; m++) {
      if (date[monKeys[m]]) monthNames[m] = date[monKeys[m]];
    }

    this.logger.info('OLED: Language loaded: ' + langCode);
  } catch (err) {
    this.logger.warn('OLED: Language load failed, using English: ' +
      ((err && err.message) ? err.message : err));
  }

  return { dayNames: dayNames, monthNames: monthNames };
};

ControllerOledDisplay.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;

  self._ensureConfig();

  var langCode = this.commandRouter.sharedVars.get('language_code');
  var langFile = path.join(__dirname, 'i18n', 'strings_' + (langCode || 'en') + '.json');
  var defaultFile = path.join(__dirname, 'i18n', 'strings_en.json');
  var uiconfFile = path.join(__dirname, 'UIConfig.json');

  // i18nJson(languageDict, defaultDict, uiConfigFile)
  // Language-specific file first, English fallback second
  self.commandRouter.i18nJson(langFile, defaultFile, uiconfFile)
    .then(function (uiconf) {
      self._populateUIConfig(uiconf);
      defer.resolve(uiconf);
    })
    .fail(function () {
      try {
        var raw = JSON.parse(fs.readFileSync(uiconfFile, 'utf8'));
        self._populateUIConfig(raw);
        defer.resolve(raw);
      } catch (e) {
        defer.reject(new Error('Could not load settings'));
      }
    });

  return defer.promise;
};

ControllerOledDisplay.prototype._populateUIConfig = function (uiconf) {
  try {
    var hw = uiconf.sections[0];
    hw.content[0].value = this._getInt('i2c_bus_number', 1);
    var addrVal = this._getStr('i2c_address', '0x3C');
    hw.content[1].value = {
      value: addrVal,
      label: addrVal === '0x3D' ? '0x3D' : '0x3C (default)'
    };
    hw.content[2].value = this._getInt('contrast', 255);
    hw.content[3].value = this._getBool('rotate_180', false);

    var disp = uiconf.sections[1];

    var pbLayout = this._getStr('playback_layout', 'classic');
    disp.content[0].value = this._findSelectValue(disp.content[0], pbLayout);

    disp.content[1].value = this._getInt('scroll_speed', 3);

    var riVal = String(this._getInt('render_interval_ms', 500));
    disp.content[2].value = this._findSelectValue(disp.content[2], riVal);

    disp.content[3].value = this._getInt('idle_dim_seconds', 120);
    disp.content[4].value = this._getInt('idle_contrast', 30);
    disp.content[5].value = this._getBool('clock_24h', true);
    disp.content[6].value = this._getBool('colon_blink', true);

    var dateFormat = this._getStr('date_format', 'day_month_name');
    disp.content[7].value = this._findSelectValue(disp.content[7], dateFormat);

    var ssMode = this._getStr('screensaver_mode', 'bouncing_clock');
    disp.content[8].value = this._findSelectValue(disp.content[8], ssMode);

    disp.content[9].value = this._getInt('screensaver_seconds', 300);
    disp.content[10].value = this._getInt('volume_overlay_seconds', 2);
  } catch (err) {
    this.logger.error('OLED: UI config populate error: ' + err.message);
  }
};

/**
 * Find the matching option label for a select element's current value.
 * Uses the already-translated labels from i18nJson.
 */
ControllerOledDisplay.prototype._findSelectValue = function (element, value) {
  if (element && element.options) {
    for (var i = 0; i < element.options.length; i++) {
      if (element.options[i].value === value) {
        return { value: value, label: element.options[i].label };
      }
    }
  }
  return { value: value, label: value };
};

ControllerOledDisplay.prototype.saveConfig = function (data) {
  var self = this;

  // Step 1: Write new values directly to the Volumio-managed config file.
  // We bypass v-conf's set() entirely because its deferred auto-save
  // overwrites our file with stale values after our synchronous write.
  self._persistToManagedConfig(data);

  // Step 2: Discard the current v-conf instance so _ensureConfig will
  // reload from the file we just wrote.
  self.config = null;
  self._ensureConfig();

  // Step 3: Refresh cached values from the freshly loaded config.
  self._cacheConfig();

  self.commandRouter.pushToastMessage('success', 'OLED Display', 'Settings saved. Restarting display…');

  self._stopPlugin()
    .then(function () {
      self._stopped = false;
      return self._startPlugin();
    })
    .catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      self.logger.error('OLED: Restart failed: ' + msg);
      self.commandRouter.pushToastMessage('error', 'OLED Display', 'Restart failed: ' + msg);
    });

  return libQ.resolve();
};

ControllerOledDisplay.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

/**
 * Write config to the Volumio-managed config file, bypassing v-conf.
 *
 * v-conf expects values in wrapped format: {"type":"number","value":30}.
 * Plain JSON values like 30 are silently ignored by v-conf's loadFile().
 *
 * This method reads the existing file, unwraps any v-conf values to get
 * plain values for merging, applies the new UI data, then re-wraps
 * everything into v-conf format before writing.
 *
 * @param {Object} data  Raw save data from the Volumio settings UI
 */
ControllerOledDisplay.prototype._persistToManagedConfig = function (data) {
  try {
    var managedPath = this.commandRouter.pluginManager.getConfigurationFile(
      this.context, 'config.json'
    );

    // Type definitions for each config key (used for v-conf wrapping)
    var keyTypes = {
      'i2c_bus_number': 'number',
      'i2c_address': 'string',
      'contrast': 'number',
      'scroll_speed': 'number',
      'render_interval_ms': 'number',
      'idle_dim_seconds': 'number',
      'idle_contrast': 'number',
      'clock_24h': 'boolean',
      'rotate_180': 'boolean',
      'colon_blink': 'boolean',
      'screensaver_mode': 'string',
      'screensaver_seconds': 'number',
      'volume_overlay_seconds': 'number',
      'playback_layout': 'string',
      'date_format': 'string'
    };

    // Start with existing config from disk (preserves keys not in this save)
    var raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(managedPath, 'utf8'));
    } catch (_) {
      try {
        raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
      } catch (_2) {
        raw = {};
      }
    }

    // Unwrap existing v-conf formatted values to plain values for merging
    var snapshot = {};
    var rawKeys = Object.keys(raw);
    for (var k = 0; k < rawKeys.length; k++) {
      var val = raw[rawKeys[k]];
      if (val && typeof val === 'object' && val.value !== undefined && val.type) {
        snapshot[rawKeys[k]] = val.value;
      } else {
        snapshot[rawKeys[k]] = val;
      }
    }

    // Merge integer values from UI data
    var intKeys = [
      'i2c_bus_number', 'contrast', 'scroll_speed',
      'idle_dim_seconds', 'idle_contrast',
      'screensaver_seconds', 'volume_overlay_seconds'
    ];
    intKeys.forEach(function (key) {
      if (data[key] !== undefined) {
        snapshot[key] = parseInt(data[key], 10);
      }
    });

    // Merge boolean values from UI data
    var boolKeys = ['clock_24h', 'rotate_180', 'colon_blink'];
    boolKeys.forEach(function (key) {
      if (data[key] !== undefined) {
        snapshot[key] = !!data[key];
      }
    });

    // Merge select values (come as { value: "...", label: "..." } from UI)
    if (data.i2c_address) {
      snapshot.i2c_address = (typeof data.i2c_address === 'object')
        ? data.i2c_address.value : data.i2c_address;
    }
    if (data.render_interval_ms) {
      var riRaw = (typeof data.render_interval_ms === 'object')
        ? data.render_interval_ms.value : data.render_interval_ms;
      snapshot.render_interval_ms = parseInt(riRaw, 10);
    }
    if (data.screensaver_mode) {
      snapshot.screensaver_mode = (typeof data.screensaver_mode === 'object')
        ? data.screensaver_mode.value : data.screensaver_mode;
    }
    if (data.playback_layout) {
      snapshot.playback_layout = (typeof data.playback_layout === 'object')
        ? data.playback_layout.value : data.playback_layout;
    }
    if (data.date_format) {
      snapshot.date_format = (typeof data.date_format === 'object')
        ? data.date_format.value : data.date_format;
    }

    // Re-wrap all values in v-conf format: {"type":"number","value":N}
    var vconfData = {};
    var snapshotKeys = Object.keys(snapshot);
    for (var i = 0; i < snapshotKeys.length; i++) {
      var sKey = snapshotKeys[i];
      var sVal = snapshot[sKey];
      var sType = keyTypes[sKey] || (typeof sVal);
      vconfData[sKey] = { type: sType, value: sVal };
    }

    // Ensure directory exists
    var dir = path.dirname(managedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(managedPath, JSON.stringify(vconfData, null, 2), 'utf8');
    this.logger.info('OLED: Config persisted to ' + managedPath);
  } catch (err) {
    this.logger.error('OLED: Failed to persist config: ' +
      ((err && err.message) ? err.message : err));
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// Start / Stop
// ═══════════════════════════════════════════════════════════════════════════

ControllerOledDisplay.prototype._startPlugin = function () {
  var self = this;

  try {
    self._ensureConfig();
    self._cacheConfig();

    var busNumber = self._getInt('i2c_bus_number', 1);
    var addrStr = self._getStr('i2c_address', '0x3C');
    var address = parseInt(addrStr, 16);
    var contrast = self._cachedContrast;
    var scrollSpeed = self._getInt('scroll_speed', 3);
    var rotate = self._getBool('rotate_180', false);
    var clock24h = self._getBool('clock_24h', true);
    var colonBlink = self._getBool('colon_blink', true);
    self._renderInterval = self._getInt('render_interval_ms', 500);

    self.logger.info('OLED: Config → bus=' + busNumber +
      ' addr=0x' + address.toString(16) +
      ' contrast=' + contrast +
      ' interval=' + self._renderInterval + 'ms' +
      ' clock24h=' + clock24h +
      ' rotate=' + rotate +
      ' screensaver=' + self._cachedScreensaverMode);

    // Lazy-load drivers
    var SSD1309 = require('./lib/ssd1309');
    var Renderer = require('./lib/renderer');

    // Init display
    self.display = new SSD1309(
      { busNumber: busNumber, address: address, contrast: contrast, rotate: rotate },
      self.logger
    );

    try {
      self.display.init();
    } catch (i2cErr) {
      self.logger.error('OLED: Display init failed: ' + i2cErr.message);
      self.logger.error('OLED: Check: i2cdetect -y ' + busNumber);
      self.display = null;
      throw i2cErr;
    }

    // Renderer — load localized date names from i18n
    var langData = self._loadLanguageData();
    self.renderer = new Renderer(self.display, {
      scrollSpeed: scrollSpeed,
      clock24h: clock24h,
      colonBlink: colonBlink,
      renderInterval: self._renderInterval,
      dayNames: langData.dayNames,
      monthNames: langData.monthNames,
      dateFormat: self._cachedDateFormat
    });

    // Socket
    self._connectSocket();

    // State
    self.lastActivityTime = Date.now();
    self._lastVolumeChangeTime = 0;
    self.isDimmed = false;
    self._screensaverActive = false;
    self._lastStateTime = Date.now();
    self._consecutiveErrors = 0;
    self._currentBackoff = 0;
    self._circuitOpen = false;
    self._rendering = false;

    // Splash screen: active until first pushState or safety timeout
    self._splashActive = true;
    self._splashStartTime = Date.now();

    self._scheduleNextFrame();

    // SIGTERM handler
    self._sigTermHandler = function () {
      self.logger.info('OLED: SIGTERM received – clearing display');
      if (self.display && self.display.bus) {
        try {
          self.display.clearBuffer();
          self.display.flush();
          self.display.setPower(false);
        } catch (_) { }
      }
      process.exit(0);
    };
    process.on('SIGTERM', self._sigTermHandler);

    self.logger.info('OLED: Render loop started (' + self._renderInterval + 'ms)');
    return Promise.resolve();

  } catch (err) {
    return Promise.reject(err);
  }
};

ControllerOledDisplay.prototype._stopPlugin = function () {
  var self = this;

  try {
    if (self._sigTermHandler) {
      process.removeListener('SIGTERM', self._sigTermHandler);
      self._sigTermHandler = null;
    }

    if (self._renderTimerId) {
      clearTimeout(self._renderTimerId);
      self._renderTimerId = null;
    }

    if (self.socket) {
      try {
        self.socket.removeAllListeners();
        self.socket.disconnect();
      } catch (_) { }
      self.socket = null;
    }

    if (self.display) {
      try {
        self.display.close();
      } catch (err) {
        self.logger.error('OLED: Display close error: ' + err.message);
      }
      self.display = null;
    }

    self.renderer = null;
    return Promise.resolve();

  } catch (err) {
    return Promise.reject(err);
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// Render loop
// ═══════════════════════════════════════════════════════════════════════════

ControllerOledDisplay.prototype._scheduleNextFrame = function () {
  if (this._stopped) return;
  var delay = this._circuitOpen ? this._currentBackoff : this._renderInterval;
  var self = this;
  this._renderTimerId = setTimeout(function () {
    self._renderTimerId = null;
    self._doRenderFrame();
  }, delay);
};

ControllerOledDisplay.prototype._doRenderFrame = function () {
  var self = this;

  if (self._rendering) {
    self._scheduleNextFrame();
    return;
  }
  if (!self.display || !self.display.initialised || !self.renderer) {
    self._scheduleNextFrame();
    return;
  }

  self._rendering = true;

  try {
    self._renderFrameSync();
  } catch (err) {
    self.logger.error('OLED: Unexpected: ' + ((err && err.message) ? err.message : err));
  }

  self._rendering = false;
  self._scheduleNextFrame();
};

ControllerOledDisplay.prototype._renderFrameSync = function () {
  // ── Phase 0: Splash screen ────────────────────────────────────────────
  // Stay on splash until the first pushState arrives from Volumio,
  // confirming the web UI is ready.  Safety timeout auto-dismisses
  // in case Volumio never responds.
  if (this._splashActive) {
    if (Date.now() - this._splashStartTime > SPLASH_TIMEOUT_MS) {
      this.logger.warn('OLED: Splash timeout – dismissing without pushState');
      this._splashActive = false;
    } else {
      this.renderer.renderSplash();
      var result0 = this.display.flush();
      this._handleFlushResult(result0);
      return;
    }
  }

  // ── Prepare state ─────────────────────────────────────────────────────
  var state = Object.assign({}, this.currentState);

  // Interpolate seek, clamped to duration
  if (state.status === 'play' && this._lastStateTime) {
    var interpolated = (this.currentState.seek || 0) + (Date.now() - this._lastStateTime);
    var maxSeekMs = (state.duration || 0) * 1000;
    state.seek = (maxSeekMs > 0) ? Math.min(interpolated, maxSeekMs) : interpolated;
  }

  // Ghost state detection: after AirPlay/Bluetooth disconnect, Volumio may
  // leave status as 'play' or 'pause' with empty metadata and zero duration.
  // Treat this as effectively stopped to avoid showing "Unknown Title" with
  // a runaway seek counter.
  var isGhostState = (state.status === 'play' || state.status === 'pause') &&
                     !state.title && !state.artist && state.duration === 0;
  if (isGhostState) {
    state.status = 'stop';
    state.seek = 0;
  }

  // ── Check volume overlay ──────────────────────────────────────────────
  var now = Date.now();
  var showVolumeOverlay = (this._lastVolumeChangeTime > 0 &&
    (now - this._lastVolumeChangeTime) < this._cachedVolumeOverlayMs);

  // ── Three-stage idle chain: active → dimmed → screensaver ─────────────
  var isIdle = (state.status !== 'play');
  var idleMs = now - this.lastActivityTime;
  var shouldScreensave = false;

  if (isIdle && !showVolumeOverlay) {
    // Stage 2: Dim
    if (this._cachedIdleDimMs > 0 && idleMs > this._cachedIdleDimMs && !this.isDimmed) {
      this.display.setContrast(this._cachedIdleContrast);
      this.isDimmed = true;
      this.logger.info('OLED: Dimmed');
    }

    // Stage 3: Screensaver (time starts counting from when dim was reached)
    if (this.isDimmed &&
        this._cachedScreensaverMs > 0 &&
        this._cachedScreensaverMode !== 'none' &&
        idleMs > this._cachedIdleDimMs + this._cachedScreensaverMs) {
      shouldScreensave = true;
      if (!this._screensaverActive) {
        this._screensaverActive = true;
        this.renderer.resetScreensaver();
        this.logger.info('OLED: Screensaver activated (' + this._cachedScreensaverMode + ')');
      }
    }
  }

  // Wake up from dim/screensaver
  if (this.isDimmed && (!isIdle || showVolumeOverlay || idleMs < 2000)) {
    this.display.setContrast(this._cachedContrast);
    this.isDimmed = false;
    this._screensaverActive = false;
    this.logger.info('OLED: Brightness restored');
  }

  // ── Render ────────────────────────────────────────────────────────────
  this.renderer.render(state, {
    showVolumeOverlay: showVolumeOverlay,
    screensaverActive: shouldScreensave,
    screensaverMode: this._cachedScreensaverMode,
    playbackLayout: this._cachedPlaybackLayout
  });

  var result = this.display.flush();
  this._handleFlushResult(result);
};

/**
 * Handle the flush result for the circuit breaker.
 */
ControllerOledDisplay.prototype._handleFlushResult = function (result) {
  if (result.ok) {
    if (this._circuitOpen) {
      this.logger.info('OLED: I2C recovered');
      this._circuitOpen = false;
      this._currentBackoff = 0;
    }
    this._consecutiveErrors = 0;
  } else {
    this._consecutiveErrors++;
    if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !this._circuitOpen) {
      this._currentBackoff = MIN_BACKOFF_MS;
      this._circuitOpen = true;
      this.logger.error('OLED: Circuit breaker OPEN (' + this._consecutiveErrors +
        ' errors), backoff ' + this._currentBackoff + 'ms');
    } else if (this._circuitOpen) {
      var prev = this._currentBackoff;
      this._currentBackoff = Math.min(this._currentBackoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      if (this._currentBackoff > prev) {
        this.logger.warn('OLED: Still failing, backoff ' + this._currentBackoff + 'ms');
      }
    }
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// Socket.io
// ═══════════════════════════════════════════════════════════════════════════

ControllerOledDisplay.prototype._connectSocket = function () {
  var self = this;
  var io;
  try {
    io = require('/volumio/node_modules/socket.io-client');
  } catch (_) {
    try { io = require('socket.io-client'); } catch (e) {
      self.logger.error('OLED: socket.io-client not found');
      return;
    }
  }

  self.socket = io.connect('http://localhost:3000', {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  });

  self.socket.on('connect', function () {
    self.logger.info('OLED: Socket connected');
    self.socket.emit('getState', '');
  });

  self.socket.on('pushState', function (state) {
    self._onStateUpdate(state);
  });

  self.socket.on('disconnect', function (reason) {
    self.logger.warn('OLED: Socket disconnected (' + reason + ')');
  });

  self.socket.on('reconnect', function (n) {
    self.logger.info('OLED: Socket reconnected (attempt ' + n + ')');
    self.socket.emit('getState', '');
  });

  self.socket.on('connect_error', function (err) {
    var now = Date.now();
    if (now - self._lastSocketErrLog > 10000) {
      self.logger.error('OLED: Socket error: ' + ((err && err.message) ? err.message : err));
      self._lastSocketErrLog = now;
    }
  });

  self.socket.on('shutdown', function () {
    self.logger.info('OLED: Volumio shutdown event – clearing display');
    self._stopped = true;
    if (self._renderTimerId) {
      clearTimeout(self._renderTimerId);
      self._renderTimerId = null;
    }
    if (self.display) {
      try {
        self.display.clearBuffer();
        self.display.flush();
        self.display.setPower(false);
      } catch (_) { }
    }
  });
};


// ═══════════════════════════════════════════════════════════════════════════
// State handling
// ═══════════════════════════════════════════════════════════════════════════

ControllerOledDisplay.prototype._onStateUpdate = function (state) {
  if (!state) return;
  var prev = this.currentState;

  this.currentState = {
    title: state.title || '',
    artist: state.artist || '',
    status: state.status || 'stop',
    seek: state.seek || 0,
    duration: state.duration || 0,
    volume: (state.volume != null) ? state.volume : prev.volume,
    bitdepth: state.bitdepth || '',
    samplerate: state.samplerate || '',
    bitrate: state.bitrate || '',
    trackType: state.trackType || ''
  };

  this._lastStateTime = Date.now();

  // Dismiss splash on first pushState — Volumio is ready
  if (this._splashActive) {
    this._splashActive = false;
    this.logger.info('OLED: Splash dismissed – Volumio ready (' +
      (Date.now() - this._splashStartTime) + 'ms boot)');
  }

  // Track volume changes for overlay
  if (prev.volume !== this.currentState.volume) {
    this._lastVolumeChangeTime = Date.now();
  }

  if (prev.status !== this.currentState.status ||
      prev.title !== this.currentState.title ||
      prev.volume !== this.currentState.volume) {
    this.lastActivityTime = Date.now();
  }
};
