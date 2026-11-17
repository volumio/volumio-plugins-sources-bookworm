'use strict';

// Disk Automount - the plugin itself runs as the unprivileged "volumio" user.
// It never calls sudo and never edits system files. To mount a disk it writes a
// small request file; systemd (disk-automount.path -> disk-automount-apply.service)
// starts the root helper /usr/local/sbin/disk-automount, which validates the request
// and reports the result in /run/disk_automount/status.

const fs = require('fs');
const path = require('path');
const execFile = require('child_process').execFile;
const libQ = require('kew');
const vConf = require('v-conf');

const HELPER = '/usr/local/sbin/disk-automount';
const CONF_DIR = '/data/configuration/system_hardware/disk_automount';
const REQUEST_FILE = CONF_DIR + '/request';
const STATUS_FILE = '/run/disk_automount/status';
const MPD_MUSIC = '/var/lib/mpd/music';
const ANSWER_TIMEOUT_MS = 40000;
const LIBRARY_UPDATE_DELAY_MS = 20000;

// Mirrors the helper's rules (the helper is authoritative). Used to keep the UI list clean.
const SAFE_UUID = /^[A-Za-z0-9-]{4,64}$/;
const SAFE_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const RESERVED_NAMES = ['internal', 'usb', 'nas', 'upnp', 'playlists', 'favourites'];
const RESERVED_LABELS = ['volumio', 'volumio_data', 'boot', 'imgpart'];
const SYSTEM_MOUNTS = ['/', '/boot', '/boot/efi', '/data', '/imgpart', '/static'];
const ALLOWED_FS = ['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'ntfs', 'exfat', 'vfat'];

module.exports = ControllerDiskAutomount;

function ControllerDiskAutomount(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;
  this.config = null;
  this.updateTimer = null;
}

/* ---------- lifecycle ---------- */

ControllerDiskAutomount.prototype.onVolumioStart = function () {
  const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config = new vConf();
  this.config.loadFile(configFile);
  return libQ.resolve();
};

ControllerDiskAutomount.prototype.onStart = function () {
  const self = this;
  if (!fs.existsSync(HELPER)) {
    self.logger.error('[disk_automount] helper ' + HELPER + ' is missing, reinstall the plugin');
    return libQ.resolve();
  }
  // The boot service has already mounted the disk. MPD may have started before the
  // link existed, so ask it to rescan once it is surely up.
  if (self.config.get('link_mpd') && self.isMounted()) {
    self.updateTimer = setTimeout(function () {
      self.updateTimer = null;
      self.mpcUpdate().fail(function () { /* best effort: playback does not depend on it */ });
    }, LIBRARY_UPDATE_DELAY_MS);
  }
  return libQ.resolve();
};

ControllerDiskAutomount.prototype.onStop = function () {
  if (this.updateTimer) {
    clearTimeout(this.updateTimer);
    this.updateTimer = null;
  }
  return libQ.resolve();
};

ControllerDiskAutomount.prototype.onRestart = function () {
  return libQ.resolve();
};

ControllerDiskAutomount.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

/* ---------- helpers ---------- */

ControllerDiskAutomount.prototype.tr = function (key) {
  const dir = path.join(__dirname, 'i18n');
  const load = function (lang) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'strings_' + lang + '.json'), 'utf8'));
    } catch (e) {
      return {};
    }
  };
  let lang = 'en';
  try {
    lang = this.commandRouter.sharedVars.get('language_code') || 'en';
  } catch (e) { /* keep en */ }
  const cur = load(lang);
  return cur[key] || load('en')[key] || key;
};

ControllerDiskAutomount.prototype.toast = function (type, message) {
  this.commandRouter.pushToastMessage(type, 'Disk Automount', message);
};

ControllerDiskAutomount.prototype.mountPoint = function () {
  return '/mnt/' + this.config.get('mount_name');
};

ControllerDiskAutomount.prototype.isMounted = function () {
  const name = this.config.get('mount_name');
  if (!SAFE_NAME.test(name)) { return false; }
  try {
    // /proc/mounts lists mount points with spaces escaped; our names never contain any
    return fs.readFileSync('/proc/mounts', 'utf8').split('\n').some(function (line) {
      return line.split(' ')[1] === '/mnt/' + name;
    });
  } catch (e) {
    return false;
  }
};

ControllerDiskAutomount.prototype.mpcUpdate = function () {
  const self = this;
  const defer = libQ.defer();
  execFile('/usr/bin/mpc', ['update'], { timeout: 15000 }, function (err) {
    if (err) {
      self.logger.error('[disk_automount] mpc update failed: ' + err.message);
      defer.reject(err);
    } else {
      defer.resolve();
    }
  });
  return defer.promise;
};

// Lists partitions that are sensible to offer: known filesystem, has a UUID, not a
// system disk, and not mounted anywhere except at our own mount point.
ControllerDiskAutomount.prototype.listDisks = function () {
  const self = this;
  const defer = libQ.defer();
  const ownMount = self.mountPoint();
  execFile('/bin/lsblk', ['-J', '-o', 'NAME,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT,TYPE'], { timeout: 10000 }, function (err, stdout) {
    if (err) {
      self.logger.error('[disk_automount] lsblk failed: ' + err.message);
      return defer.resolve([]);
    }
    const out = [];
    const walk = function (nodes) {
      (nodes || []).forEach(function (n) {
        const mounts = [].concat(n.mountpoints || [], n.mountpoint || []).filter(Boolean);
        const skip = !n.uuid || !SAFE_UUID.test(n.uuid) ||
          ALLOWED_FS.indexOf(n.fstype) === -1 ||
          /^(loop|mmcblk|ram|zram|sr)/.test(n.name) ||
          RESERVED_LABELS.indexOf(String(n.label || '').toLowerCase()) !== -1 ||
          mounts.some(function (m) { return SYSTEM_MOUNTS.indexOf(m) !== -1 || m !== ownMount; });
        if (!skip) { out.push(n); }
        walk(n.children);
      });
    };
    try {
      walk(JSON.parse(stdout).blockdevices);
    } catch (e) {
      self.logger.error('[disk_automount] cannot parse lsblk output: ' + e.message);
    }
    defer.resolve(out);
  });
  return defer.promise;
};

/* ---------- request / answer ---------- */

ControllerDiskAutomount.prototype.writeRequest = function (action) {
  const id = String(Date.now());
  const lines = [
    'ID=' + id,
    'ACTION=' + action,
    'UUID=' + this.config.get('device'),
    'NAME=' + this.config.get('mount_name'),
    'LINK_MPD=' + (this.config.get('link_mpd') ? 1 : 0),
    'OPEN_PERMS=' + (this.config.get('open_perms') ? 1 : 0),
    'MOUNT_ON_BOOT=' + (this.config.get('mount_on_boot') ? 1 : 0)
  ];
  fs.mkdirSync(CONF_DIR, { recursive: true });
  // written in place (not renamed): systemd's PathChanged fires on close-after-write
  fs.writeFileSync(REQUEST_FILE, lines.join('\n') + '\n', { mode: 0o644 });
  return id;
};

function readStatus() {
  try {
    const st = {};
    fs.readFileSync(STATUS_FILE, 'utf8').split('\n').forEach(function (line) {
      const i = line.indexOf('=');
      if (i > 0) { st[line.slice(0, i)] = line.slice(i + 1); }
    });
    return st;
  } catch (e) {
    return null;
  }
}

ControllerDiskAutomount.prototype.waitForAnswer = function (id) {
  const defer = libQ.defer();
  const started = Date.now();
  (function poll() {
    const st = readStatus();
    if (st && st.ID === id) { return defer.resolve(st); }
    if (Date.now() - started > ANSWER_TIMEOUT_MS) { return defer.resolve(null); }
    setTimeout(poll, 500);
  })();
  return defer.promise;
};

// Sends the current config to the helper and shows its answer. Resolves to true on success.
ControllerDiskAutomount.prototype.apply = function (action) {
  const self = this;
  if (!fs.existsSync(HELPER)) {
    self.toast('error', self.tr('NO_HELPER'));
    return libQ.resolve(false);
  }
  let id;
  try {
    id = self.writeRequest(action);
  } catch (e) {
    self.logger.error('[disk_automount] cannot write request: ' + e.message);
    self.toast('error', self.tr('ERROR') + ': ' + e.message);
    return libQ.resolve(false);
  }
  return self.waitForAnswer(id).then(function (st) {
    if (!st) {
      self.toast('error', self.tr('TIMEOUT'));
      return false;
    }
    const ok = st.STATE === 'ok';
    self.toast(ok ? 'success' : 'error', self.tr(st.CODE) + (st.DETAIL ? ': ' + st.DETAIL : ''));
    return ok;
  });
};

/* ---------- UI ---------- */

ControllerDiskAutomount.prototype.getUIConfig = function () {
  const self = this;
  const defer = libQ.defer();
  const lang = self.commandRouter.sharedVars.get('language_code');
  const dir = path.join(__dirname, 'i18n');

  self.commandRouter.i18nJson(
    path.join(dir, 'strings_' + lang + '.json'),
    path.join(dir, 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json')
  ).then(function (ui) {
    return self.listDisks().then(function (disks) {
      const current = self.config.get('device');
      const options = disks.map(function (d) {
        return { value: d.uuid, label: '/dev/' + d.name + ' · ' + d.size + ' · ' + d.fstype + ' · ' + (d.label || '—') };
      });
      const selected = options.filter(function (o) { return o.value === current; })[0] ||
        options[0] || { value: '', label: '' };

      const disk = ui.sections[1].content;
      disk[0].options = options;
      disk[0].value = selected;
      disk[1].value = self.config.get('mount_name');
      disk[2].value = !!self.config.get('link_mpd');
      disk[3].value = !!self.config.get('open_perms');
      disk[4].value = !!self.config.get('mount_on_boot');

      if (!fs.existsSync(HELPER)) {
        ui.sections[0].description = self.tr('STATUS_NO_HELPER');
      } else {
        ui.sections[0].description = (self.isMounted() ? self.tr('STATUS_MOUNTED') : self.tr('STATUS_NOT_MOUNTED')) +
          ': ' + self.mountPoint();
      }
      defer.resolve(ui);
    });
  }).fail(function (e) {
    self.logger.error('[disk_automount] getUIConfig failed: ' + e);
    defer.reject(new Error());
  });
  return defer.promise;
};

ControllerDiskAutomount.prototype.refreshUI = function () {
  const self = this;
  return self.getUIConfig().then(function (ui) {
    self.commandRouter.broadcastMessage('pushUiConfig', ui);
  });
};

ControllerDiskAutomount.prototype.saveConfig = function (data) {
  const self = this;
  const uuid = data.device && data.device.value;
  const name = String(data.mount_name || '').trim();

  if (!uuid || !SAFE_UUID.test(uuid)) {
    self.toast('error', self.tr('NO_DISK'));
    return libQ.resolve();
  }
  if (!SAFE_NAME.test(name) || RESERVED_NAMES.indexOf(name.toLowerCase()) !== -1) {
    self.toast('error', self.tr('BAD_INPUT'));
    return libQ.resolve();
  }

  self.config.set('device', uuid);
  self.config.set('mount_name', name);
  self.config.set('link_mpd', !!data.link_mpd);
  self.config.set('open_perms', !!data.open_perms);
  self.config.set('mount_on_boot', !!data.mount_on_boot);

  return self.apply('mount').then(function (ok) {
    const done = ok && self.config.get('link_mpd') ? self.mpcUpdate().fail(function () {}) : libQ.resolve();
    return done.then(function () { return self.refreshUI(); });
  });
};

ControllerDiskAutomount.prototype.unmountNow = function () {
  const self = this;
  if (!self.config.get('device')) {
    self.toast('error', self.tr('NO_DISK'));
    return libQ.resolve();
  }
  return self.apply('unmount').then(function (ok) {
    const done = ok ? self.mpcUpdate().fail(function () {}) : libQ.resolve();
    return done.then(function () { return self.refreshUI(); });
  });
};

ControllerDiskAutomount.prototype.updateLibrary = function () {
  const self = this;
  return self.mpcUpdate().then(function () {
    self.toast('success', self.tr('LIB_UPDATING'));
  }).fail(function (e) {
    self.toast('error', self.tr('ERROR') + ': ' + e.message);
  });
};
