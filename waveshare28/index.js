'use strict';

const libQ = require('kew');
const fs = require('fs-extra');
const { execFileSync, exec } = require('child_process');
const path = require('path');
const REBOOT_SECONDS = 15;

const TOOL_PATHS = [
  '/usr/local/bin/waveshare28-config',
  '/usr/bin/waveshare28-config'
];
const SETTINGS_BACKUP_DIR = '/data/INTERNAL/waveshare28/backups';
const SETTINGS_BACKUP_SCHEMA = 1;
const SETTINGS_BACKUP_NAME_RE = /^[A-Za-z0-9._ -]{1,64}$/;
const SETTINGS_BACKUP_KEYS = [
  'rotation',
  'speed',
  'backend',
  'console',
  'hdmi',
  'status_text_portrait',
  'status_text_landscape',
  'bar_gap_portrait',
  'bar_gap_landscape',
  'strip_portrait',
  'strip_landscape',
  'theme'
];
const PLUGIN_VERSION = require('./package.json').version;

module.exports = Waveshare28;

function Waveshare28(context) {
  const self = this;
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;
  self.toolPath = null;
  self.board = null;
  self.rebootTimer = null;
  self.rebootLeft = 0;
}

Waveshare28.prototype.onVolumioStart = function () {
  const self = this;
  const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

Waveshare28.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

Waveshare28.prototype.findTool = function () {
  for (let i = 0; i < TOOL_PATHS.length; i++) {
    if (fs.existsSync(TOOL_PATHS[i])) {
      return TOOL_PATHS[i];
    }
  }
  return null;
};

// Peppy-style: if the tool is not on PATH, install it from this plugin's
// payload. Do not refuse start just because /usr/local/bin is empty.
Waveshare28.prototype.ensureTool = function () {
  const self = this;
  let tool = self.findTool();
  if (tool) {
    return tool;
  }
  const installer = path.join(__dirname, 'install.sh');
  if (!fs.existsSync(installer)) {
    throw new Error('plugin payload is missing install.sh');
  }
  self.logger.info('[waveshare28] tool not on PATH; installing from plugin payload');
  execFileSync('/bin/sh', [installer], { encoding: 'utf8', timeout: 180000 });
  tool = self.findTool();
  if (!tool) {
    throw new Error('payload install finished but waveshare28-config is still missing');
  }
  return tool;
};

Waveshare28.prototype.runTool = function (args, opts) {
  const self = this;
  const tool = self.toolPath || self.findTool();
  if (!tool) {
    throw new Error('waveshare28-config is not installed');
  }
  const argv = Array.isArray(args) ? args : args.split(' ');
  try {
    // Always sudo. Volumio runs plugin code as volumio; the sudoers file
    // is the whole binary. A first unprivileged attempt prints
    // "ERROR: run as root" into the journal even when the retry works.
    return execFileSync('sudo', ['-n', tool].concat(argv), {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (e) {
    if (!(opts && opts.quiet)) {
      self.logger.error('[waveshare28] ' + tool + ' ' + argv.join(' ') + ' failed: ' + e);
    }
    throw e;
  }
};

function fieldValue(data, key) {
  if (data[key] === undefined) {
    return undefined;
  }
  if (data[key] !== null && typeof data[key] === 'object' && data[key].value !== undefined) {
    return data[key].value;
  }
  return data[key];
}

function setSelect(item, value) {
  const match = (item.options || []).find(function (o) {
    return String(o.value) === String(value);
  });
  item.value = match || { value: value, label: String(value) };
}

function findSection(uiconf, id) {
  return (uiconf.sections || []).find(function (s) {
    return s.id === id;
  });
}

function setField(section, id, fn) {
  const item = section.content.find(function (c) {
    return c.id === id;
  });
  if (item) {
    fn(item);
  }
}

function removeFields(section, ids) {
  const drop = {};
  ids.forEach(function (id) {
    drop[id] = true;
  });
  section.content = section.content.filter(function (item) {
    return !drop[item.id];
  });
  if (section.saveButton && section.saveButton.data) {
    section.saveButton.data = section.saveButton.data.filter(function (id) {
      return !drop[id];
    });
  }
}

Waveshare28.prototype.onStart = function () {
  const self = this;
  const defer = libQ.defer();

  try {
    self.toolPath = self.ensureTool();
    self.board = JSON.parse(self.runTool(['detect']));
  } catch (e) {
    self.logger.error('[waveshare28] start failed: ' + e);
    self.commandRouter.pushToastMessage('error', self.pluginText('TOAST_TITLE'), String(e.message || e));
    defer.reject(e);
    return defer.promise;
  }

  if (!self.board.supported) {
    const why = self.pluginText(self.board.reason === 'armv6' ? 'TOAST_ARMV6' : 'TOAST_NOT_PI');
    self.logger.error('[waveshare28] unsupported board: ' + self.board.reason);
    self.commandRouter.pushToastMessage('error', self.pluginText('TOAST_TITLE'), why);
    defer.reject(new Error('Unsupported board: ' + self.board.reason));
    return defer.promise;
  }

  self.logger.info('[waveshare28] using ' + self.toolPath + ' on ' + self.board.family);

  // Install only copies files. The panel starts when the user enables
  // the plugin, not when the zip is unpacked.
  try {
    self.runTool(['apply']);
    const state = JSON.parse(self.runTool(['show', '--json']));
    if (state.reboot_required) {
      self.logger.info('[waveshare28] framebuffer overlay not on this boot; reboot required');
      self.initRebootCountdown();
    }
  } catch (e) {
    self.logger.error('[waveshare28] apply on start failed: ' + e);
    self.toast('error', 'TOAST_START_FAILED');
    defer.reject(e);
    return defer.promise;
  }

  defer.resolve();
  return defer.promise;
};

Waveshare28.prototype.onStop = function () {
  const self = this;
  const defer = libQ.defer();
  self.clearRebootTimer();
  try {
    if (self.findTool()) {
      self.runTool(['recover']);
    }
  } catch (e) {
    self.logger.error('[waveshare28] recover on stop failed: ' + e);
  }
  self.toolPath = null;
  self.board = null;
  defer.resolve();
  return defer.promise;
};

Waveshare28.prototype.getUIConfig = function () {
  const self = this;
  const defer = libQ.defer();
  const lang_code = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    path.join(__dirname, 'i18n', 'strings_' + lang_code + '.json'),
    path.join(__dirname, 'i18n', 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json')
  )
    .then(function (uiconf) {
      let state;
      try {
        if (!self.findTool()) {
          self.ensureTool();
        }
        state = JSON.parse(self.runTool(['show', '--json']));
      } catch (e) {
        self.logger.error('[waveshare28] show --json failed: ' + e);
        defer.reject(e);
        return;
      }

      const board = state.board || self.board || {};
      const params = board.params || {};
      const status = findSection(uiconf, 'section_status');
      const settings = findSection(uiconf, 'section_settings');
      const ui = findSection(uiconf, 'section_ui');

      setField(status, 'board_family', function (item) {
        item.value = (board.family || '') + (board.revision ? ' (' + board.revision + ')' : '');
      });
      setField(status, 'board_model', function (item) {
        item.value = board.model || '';
      });
      setField(status, 'kms3a', function (item) {
        item.value = board.kms3a || 'n/a';
      });
      if (board.family !== 'pi3a+') {
        removeFields(status, ['kms3a']);
      }
      setField(status, 'panel_live', function (item) {
        if (state.reboot_required) {
          item.value = self.pluginText('PANEL_REBOOT_REQUIRED');
        } else if (state.device) {
          item.value = String(state.device);
        } else {
          item.value = '';
        }
      });

      setField(settings, 'rotation', function (item) {
        setSelect(item, state.rotation);
      });
      setField(settings, 'speed', function (item) {
        item.value = String(state.speed);
      });
      setField(settings, 'backend', function (item) {
        setSelect(item, state.backend);
      });
      setField(settings, 'console', function (item) {
        setSelect(item, state.console);
      });
      setField(settings, 'hdmi', function (item) {
        item.value = state.hdmi === 'on';
      });
      setField(ui, 'status_text_portrait', function (item) {
        setSelect(item, state.status_text_portrait || 'normal');
      });
      setField(ui, 'status_text_landscape', function (item) {
        setSelect(item, state.status_text_landscape || 'normal');
      });
      setField(ui, 'bar_gap_portrait', function (item) {
        setSelect(item, state.bar_gap_portrait || 'default');
      });
      setField(ui, 'bar_gap_landscape', function (item) {
        setSelect(item, state.bar_gap_landscape || 'default');
      });
      setField(ui, 'strip_portrait', function (item) {
        setSelect(item, state.strip_portrait || 'progress');
      });
      setField(ui, 'strip_landscape', function (item) {
        setSelect(item, state.strip_landscape || 'progress');
      });
      setField(ui, 'theme', function (item) {
        setSelect(item, state.theme || 'ink');
      });

      if (!params.hdmi) {
        removeFields(settings, ['hdmi']);
      }

      const backups = self.listSettingsBackups();
      const none = { value: '', label: self.pluginText('BACKUP_NONE_YET') };
      uiconf.sections.forEach(function (section) {
        if (!section.content) {
          return;
        }
        section.content.forEach(function (el) {
          if (el.id !== 'selected_backup' && el.id !== 'selected_backup_delete') {
            return;
          }
          el.options = backups.length ? backups : [none];
          el.value = backups.length
            ? { value: backups[0].value, label: backups[0].label }
            : { value: none.value, label: none.label };
        });
      });

      defer.resolve(uiconf);
      if (self.rebootLeft > 0) {
        self.showRebootModal(self.rebootLeft);
      }
    })
    .fail(function (error) {
      self.logger.error('[waveshare28] Failed to load UI config: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

Waveshare28.prototype.saveSettings = function (data) {
  const self = this;
  const defer = libQ.defer();
  try {
    const before = JSON.parse(self.runTool(['show', '--json']));
    const args = [];
    const rotation = fieldValue(data, 'rotation');
    const speed = fieldValue(data, 'speed');
    const backend = fieldValue(data, 'backend');
    const consoleMode = fieldValue(data, 'console');
    if (rotation !== undefined) {
      args.push('rotation=' + rotation);
    }
    if (speed !== undefined) {
      args.push('speed=' + String(speed).trim());
    }
    if (backend !== undefined) {
      args.push('backend=' + backend);
    }
    if (consoleMode !== undefined && backend === 'framebuffer') {
      args.push('console=' + consoleMode);
    }
    if (data.hdmi !== undefined) {
      args.push('hdmi=' + (data.hdmi ? 'on' : 'off'));
    }
    const statusPortrait = fieldValue(data, 'status_text_portrait');
    const statusLandscape = fieldValue(data, 'status_text_landscape');
    const barGapPortrait = fieldValue(data, 'bar_gap_portrait');
    const barGapLandscape = fieldValue(data, 'bar_gap_landscape');
    const stripPortrait = fieldValue(data, 'strip_portrait');
    const stripLandscape = fieldValue(data, 'strip_landscape');
    const theme = fieldValue(data, 'theme');
    if (statusPortrait !== undefined) {
      args.push('status_text_portrait=' + statusPortrait);
    }
    if (statusLandscape !== undefined) {
      args.push('status_text_landscape=' + statusLandscape);
    }
    if (barGapPortrait !== undefined) {
      args.push('bar_gap_portrait=' + barGapPortrait);
    }
    if (barGapLandscape !== undefined) {
      args.push('bar_gap_landscape=' + barGapLandscape);
    }
    if (stripPortrait !== undefined) {
      args.push('strip_portrait=' + stripPortrait);
    }
    if (stripLandscape !== undefined) {
      args.push('strip_landscape=' + stripLandscape);
    }
    if (theme !== undefined) {
      args.push('theme=' + theme);
    }
    if (args.length === 0) {
      defer.resolve();
      return defer.promise;
    }
    self.runTool(['set'].concat(args));
    const after = JSON.parse(self.runTool(['show', '--json']));
    self.afterSetMaybeReboot(before, after, self.pluginText('TOAST_APPLIED'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[waveshare28] set failed: ' + e);
    self.toast('error', 'TOAST_APPLY_FAILED');
    defer.reject(e);
  }
  return defer.promise;
};

Waveshare28.prototype.pluginText = function (key) {
  const lang = this.commandRouter.sharedVars.get('language_code');
  const dir = path.join(__dirname, 'i18n');
  const en = readStrings(path.join(dir, 'strings_en.json'));
  const local = lang && lang !== 'en'
    ? readStrings(path.join(dir, 'strings_' + lang + '.json'))
    : null;
  if (local && local[key]) {
    return local[key];
  }
  return (en && en[key]) || key;
};

Waveshare28.prototype.toast = function (level, key) {
  this.commandRouter.pushToastMessage(level, this.pluginText('TOAST_TITLE'), this.pluginText(key));
};

function readStrings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

Waveshare28.prototype.coreI18n = function (key, fallback) {
  try {
    const s = this.commandRouter.getI18nString && this.commandRouter.getI18nString(key);
    if (s && s !== key) {
      return s;
    }
  } catch (e) {
    /* core string missing */
  }
  return fallback;
};

// Firmware overlays (backend, fbtft rotate/speed, HDMI) are not live
// until the next boot. console= only rewrites the unit.
Waveshare28.prototype.afterSetMaybeReboot = function (before, after, okToast) {
  if (this.needsReboot(before, after)) {
    this.logger.info(
      '[waveshare28] firmware overlay not live (' +
        (before && before.backend) +
        ' -> ' +
        (after && after.backend) +
        ', reboot_required=' +
        (after && after.reboot_required) +
        ')'
    );
    this.initRebootCountdown();
    return;
  }
  this.commandRouter.pushToastMessage('success', this.pluginText('TOAST_TITLE'), okToast);
};

Waveshare28.prototype.needsReboot = function (before, after) {
  if (!before || !after) {
    return true;
  }
  // apply already said the backend device is not on this boot.
  if (after.reboot_required) {
    return true;
  }
  if (before.backend !== after.backend) {
    return true;
  }
  if (after.backend === 'framebuffer' || before.backend === 'framebuffer') {
    if (Number(before.rotation) !== Number(after.rotation)) {
      return true;
    }
    if (Number(before.speed) !== Number(after.speed)) {
      return true;
    }
    if (before.hdmi !== after.hdmi) {
      return true;
    }
  }
  return false;
};

Waveshare28.prototype.showRebootModal = function (seconds) {
  this.commandRouter.broadcastMessage('openModal', {
    title: this.pluginText('TOAST_TITLE'),
    message: this.pluginText('TOAST_REBOOT').replace('{seconds}', String(seconds)),
    size: 'lg',
    buttons: [
      {
        name: this.coreI18n('COMMON.RESTART', 'Restart'),
        class: 'btn btn-info',
        emit: 'callMethod',
        payload: {
          endpoint: 'system_controller/waveshare28',
          method: 'finishReboot',
          data: {}
        }
      },
      {
        name: this.coreI18n('COMMON.CANCEL', 'Cancel'),
        class: 'btn btn-warning',
        emit: 'callMethod',
        payload: {
          endpoint: 'system_controller/waveshare28',
          method: 'cancelReboot',
          data: {}
        }
      }
    ]
  });
};

Waveshare28.prototype.clearRebootTimer = function () {
  if (this.rebootTimer) {
    clearInterval(this.rebootTimer);
    this.rebootTimer = null;
  }
};

Waveshare28.prototype.finishReboot = function () {
  this.rebootLeft = 0;
  this.clearRebootTimer();
  if (typeof this.commandRouter.closeModals === 'function') {
    this.commandRouter.closeModals();
  }
  this.logger.info('[waveshare28] rebooting after firmware overlay change');
  if (typeof this.commandRouter.reboot === 'function') {
    this.commandRouter.reboot();
  } else {
    exec('/usr/bin/sudo /sbin/reboot', { timeout: 15000 }, function () {});
  }
};

Waveshare28.prototype.initRebootCountdown = function () {
  const self = this;
  self.clearRebootTimer();
  self.rebootLeft = REBOOT_SECONDS;
  // A section onSave refreshes the plugin page and closes a modal
  // opened in the same tick. Wait for that redraw.
  setTimeout(function () {
    if (self.rebootLeft <= 0) {
      return;
    }
    self.showRebootModal(self.rebootLeft);
    self.rebootTimer = setInterval(function () {
      self.rebootLeft -= 1;
      if (self.rebootLeft > 0) {
        self.showRebootModal(self.rebootLeft);
      } else {
        self.finishReboot();
      }
    }, 1000);
  }, 500);
};

Waveshare28.prototype.cancelReboot = function () {
  this.rebootLeft = 0;
  this.clearRebootTimer();
  if (typeof this.commandRouter.closeModals === 'function') {
    this.commandRouter.closeModals();
  }
  this.toast('info', 'TOAST_REBOOT_CANCELLED');
  return this.updateUIConfig();
};

Waveshare28.prototype.updateUIConfig = function () {
  const self = this;
  if (typeof this.commandRouter.getUIConfigOnPlugin !== 'function') {
    return libQ.resolve();
  }
  return this.commandRouter
    .getUIConfigOnPlugin('system_controller', 'waveshare28', {})
    .then(function (uiconf) {
      self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
    })
    .fail(function (e) {
      self.logger.error('[waveshare28] pushUiConfig failed: ' + e);
      return libQ.resolve();
    });
};

Waveshare28.prototype.settingsBackupDir = function () {
  return this._settingsBackupDir || SETTINGS_BACKUP_DIR;
};

Waveshare28.prototype.sanitizeBackupName = function (raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name || name.indexOf('..') !== -1 || /[\\/]/.test(name)) {
    return '';
  }
  if (!SETTINGS_BACKUP_NAME_RE.test(name)) {
    return '';
  }
  return name;
};

Waveshare28.prototype.settingsBackupPath = function (name) {
  return path.join(this.settingsBackupDir(), name + '.json');
};

Waveshare28.prototype.ensureSettingsBackupDir = function () {
  const dir = this.settingsBackupDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (e) {
    /* some filesystems refuse mode */
  }
  return dir;
};

Waveshare28.prototype.settingsBackupSnapshot = function () {
  const state = JSON.parse(this.runTool(['show', '--json']));
  const values = {};
  SETTINGS_BACKUP_KEYS.forEach(function (key) {
    values[key] = state[key];
  });
  return {
    schema_version: SETTINGS_BACKUP_SCHEMA,
    plugin_version: PLUGIN_VERSION,
    created: new Date().toISOString(),
    values: values
  };
};

Waveshare28.prototype.validateBackupValues = function (values) {
  if (!values || typeof values !== 'object') {
    return { ok: false, key: 'BACKUP_NO_VALUES' };
  }
  const rotation = parseInt(values.rotation, 10);
  if ([0, 90, 180, 270].indexOf(rotation) === -1) {
    return { ok: false, key: 'BACKUP_BAD_ROTATION' };
  }
  const speed = parseInt(values.speed, 10);
  if (!Number.isFinite(speed) || speed <= 0) {
    return { ok: false, key: 'BACKUP_BAD_SPEED' };
  }
  if (values.backend !== 'spi' && values.backend !== 'framebuffer') {
    return { ok: false, key: 'BACKUP_BAD_BACKEND' };
  }
  if (values.console !== 'share' && values.console !== 'release') {
    return { ok: false, key: 'BACKUP_BAD_CONSOLE' };
  }
  if (values.hdmi !== 'on' && values.hdmi !== 'off') {
    return { ok: false, key: 'BACKUP_BAD_HDMI' };
  }
  // Schema 1 backups written before these keys restore as the shipped defaults.
  const statusPortrait = values.status_text_portrait == null || values.status_text_portrait === ''
    ? 'normal'
    : values.status_text_portrait;
  const statusLandscape = values.status_text_landscape == null || values.status_text_landscape === ''
    ? 'normal'
    : values.status_text_landscape;
  const barGapPortrait = values.bar_gap_portrait == null || values.bar_gap_portrait === ''
    ? 'default'
    : values.bar_gap_portrait;
  const barGapLandscape = values.bar_gap_landscape == null || values.bar_gap_landscape === ''
    ? 'default'
    : values.bar_gap_landscape;
  const stripPortrait = values.strip_portrait == null || values.strip_portrait === ''
    ? 'progress'
    : values.strip_portrait;
  const stripLandscape = values.strip_landscape == null || values.strip_landscape === ''
    ? 'progress'
    : values.strip_landscape;
  const theme = values.theme == null || values.theme === ''
    ? 'ink'
    : values.theme;
  if (statusPortrait !== 'normal' && statusPortrait !== 'large') {
    return { ok: false, key: 'BACKUP_BAD_STATUS_TEXT_PORTRAIT' };
  }
  if (statusLandscape !== 'normal' && statusLandscape !== 'large') {
    return { ok: false, key: 'BACKUP_BAD_STATUS_TEXT_LANDSCAPE' };
  }
  if (barGapPortrait !== 'tight' && barGapPortrait !== 'default' && barGapPortrait !== 'roomy') {
    return { ok: false, key: 'BACKUP_BAD_BAR_GAP_PORTRAIT' };
  }
  if (barGapLandscape !== 'tight' && barGapLandscape !== 'default' && barGapLandscape !== 'roomy') {
    return { ok: false, key: 'BACKUP_BAD_BAR_GAP_LANDSCAPE' };
  }
  if (stripPortrait !== 'progress' && stripPortrait !== 'stream' && stripPortrait !== 'off') {
    return { ok: false, key: 'BACKUP_BAD_STRIP_PORTRAIT' };
  }
  if (stripLandscape !== 'progress' && stripLandscape !== 'stream' && stripLandscape !== 'off') {
    return { ok: false, key: 'BACKUP_BAD_STRIP_LANDSCAPE' };
  }
  if (theme !== 'ink' && theme !== 'dusk' && theme !== 'studio' && theme !== 'night') {
    return { ok: false, key: 'BACKUP_BAD_THEME' };
  }
  return {
    ok: true,
    values: {
      rotation: rotation,
      speed: speed,
      backend: values.backend,
      console: values.console,
      hdmi: values.hdmi,
      status_text_portrait: statusPortrait,
      status_text_landscape: statusLandscape,
      bar_gap_portrait: barGapPortrait,
      bar_gap_landscape: barGapLandscape,
      strip_portrait: stripPortrait,
      strip_landscape: stripLandscape,
      theme: theme
    }
  };
};

Waveshare28.prototype.readSettingsBackup = function (name) {
  const safe = this.sanitizeBackupName(name);
  if (!safe) {
    return { ok: false, key: 'BACKUP_CHOOSE' };
  }
  let raw;
  try {
    raw = fs.readFileSync(this.settingsBackupPath(safe), 'utf8');
  } catch (e) {
    return { ok: false, key: 'BACKUP_MISSING' };
  }
  let snap;
  try {
    snap = JSON.parse(raw);
  } catch (e) {
    return { ok: false, key: 'BACKUP_BAD_JSON' };
  }
  if (!snap || snap.schema_version !== SETTINGS_BACKUP_SCHEMA ||
      !snap.values || typeof snap.values !== 'object') {
    return { ok: false, key: 'BACKUP_BAD_SCHEMA' };
  }
  return { ok: true, name: safe, snapshot: snap };
};

Waveshare28.prototype.listSettingsBackups = function () {
  let names;
  try {
    names = fs.readdirSync(this.settingsBackupDir());
  } catch (e) {
    return [];
  }
  const options = [];
  for (let i = 0; i < names.length; i++) {
    const file = names[i];
    if (!file.endsWith('.json')) {
      continue;
    }
    const name = file.slice(0, -5);
    if (!this.sanitizeBackupName(name)) {
      continue;
    }
    const read = this.readSettingsBackup(name);
    if (!read.ok) {
      continue;
    }
    options.push({ value: name, label: name });
  }
  options.sort(function (a, b) {
    return a.value.localeCompare(b.value);
  });
  return options;
};

Waveshare28.prototype.createSettingsBackup = function (data) {
  const name = this.sanitizeBackupName(data && data.backup_name);
  if (!name) {
    this.toast('error', 'TOAST_BACKUP_NAME');
    return libQ.resolve();
  }
  try {
    this.ensureSettingsBackupDir();
    const snap = this.settingsBackupSnapshot();
    snap.name = name;
    fs.writeFileSync(this.settingsBackupPath(name), JSON.stringify(snap, null, 2) + '\n', { mode: 0o640 });
  } catch (e) {
    this.logger.error('[waveshare28] settings backup failed: ' + e);
    this.toast('error', 'TOAST_BACKUP_WRITE');
    return libQ.resolve();
  }
  this.toast('success', 'TOAST_BACKUP_SAVED');
  return this.updateUIConfig();
};

Waveshare28.prototype.restoreSettingsBackup = function (data) {
  const name = fieldValue(data || {}, 'selected_backup');
  const read = this.readSettingsBackup(name);
  if (!read.ok) {
    this.toast('error', read.key);
    return libQ.resolve();
  }
  const checked = this.validateBackupValues(read.snapshot.values);
  if (!checked.ok) {
    this.logger.error('[waveshare28] rejected settings backup: ' + checked.key);
    this.toast('error', checked.key);
    return libQ.resolve();
  }
  const before = JSON.parse(this.runTool(['show', '--json']));
  try {
    const v = checked.values;
    const args = [
      'rotation=' + v.rotation,
      'speed=' + v.speed,
      'backend=' + v.backend,
      'status_text_portrait=' + v.status_text_portrait,
      'status_text_landscape=' + v.status_text_landscape,
      'bar_gap_portrait=' + v.bar_gap_portrait,
      'bar_gap_landscape=' + v.bar_gap_landscape,
      'strip_portrait=' + v.strip_portrait,
      'strip_landscape=' + v.strip_landscape,
      'theme=' + v.theme
    ];
    if (v.backend === 'framebuffer') {
      args.push('console=' + v.console);
      if (this.board && this.board.params && this.board.params.hdmi) {
        args.push('hdmi=' + v.hdmi);
      }
    }
    this.runTool(['set'].concat(args));
  } catch (e) {
    this.logger.error('[waveshare28] restore set failed: ' + e);
    this.toast('error', 'TOAST_BACKUP_RESTORE_FAILED');
    return libQ.resolve();
  }
  const after = JSON.parse(this.runTool(['show', '--json']));
  this.afterSetMaybeReboot(before, after, this.pluginText('TOAST_RESTORED'));
  return this.updateUIConfig();
};

Waveshare28.prototype.deleteSettingsBackup = function (data) {
  const name = this.sanitizeBackupName(fieldValue(data || {}, 'selected_backup_delete'));
  if (!name) {
    this.toast('error', 'BACKUP_CHOOSE');
    return libQ.resolve();
  }
  try {
    fs.unlinkSync(this.settingsBackupPath(name));
  } catch (e) {
    this.toast('error', 'BACKUP_MISSING');
    return libQ.resolve();
  }
  this.toast('success', 'TOAST_BACKUP_DELETED');
  return this.updateUIConfig();
};

Waveshare28.prototype.runVerify = function () {
  const self = this;
  const defer = libQ.defer();
  try {
    const out = self.runTool(['verify'], { quiet: true });
    self.toast('success', 'TOAST_NO_DRIFT');
    self.logger.info('[waveshare28] verify:\n' + out);
    defer.resolve();
  } catch (e) {
    const out = (e.stdout || e.message || String(e)).toString();
    self.toast('warning', 'TOAST_DRIFT');
    self.logger.warn('[waveshare28] verify:\n' + out);
    defer.resolve();
  }
  return defer.promise;
};
