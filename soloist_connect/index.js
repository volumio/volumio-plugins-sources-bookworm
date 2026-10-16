'use strict';

const libQ = require('kew');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const WebSocket = require('ws');
const VConf = require('v-conf');

const SERVICE_UNIT = 'soloist.service';
const WS_HOST = '127.0.0.1';
const WS_PORT = 9878; // fixed local port for the Soloist WebSocket API
const ENV_FILE = '/data/soloist/soloist.env';
const CACHE_DIR = '/data/soloist/cache';
const YIELD_PATH = '/data/soloist/alsa.yield';
// Connect yield only. Core syncState applies play|pause while isVolatile.
// status=stop drops volatileService, re-pushes the last play frame, then
// skips us against the leftover queue row. Set to 'stop' to undo this step.
const CONNECT_LEAVE_STATUS = 'pause';
const SETTINGS_BACKUP_DIR = '/data/INTERNAL/soloist_connect/backups';
const SETTINGS_BACKUP_SCHEMA = 1;
const SETTINGS_BACKUP_NAME_RE = /^[A-Za-z0-9._ -]{1,64}$/;
// Stored settings only. peppy_metering is Peppy's, not this page.
// api_key is added only when retain_api_key is on.
const SETTINGS_BACKUP_KEYS = [
  'device_name',
  'retain_api_key',
  'initial_volume',
  'align_volume',
  'output_trim_db',
  'loudness_normalization',
  'crossfade',
  'crossfade_ms',
  'buffer_ms',
  'cache_location',
  'cache_size_mb',
  'seek_coalesce_ms',
  'inactive_hold_ms',
  'quality_retry_ms',
  'quality_retry_max',
  'queue_fetch_ms',
  'queue_playback',
  'queue_remote_playback',
  'verbose_logging',
  'auto_update_binary',
];

// RAM cache ceiling, as a fraction of MemTotal.
//
// A tmpfs is not reclaimable: pages sit in memory until the files are deleted,
// and a full one returns ENOSPC to the daemon rather than being paged out. The
// boards that most want this mode are the ones least able to give up memory to
// it, so the ceiling is a share of what the board actually has rather than a
// fixed number that happens to suit a 1 GB Pi.
//
// The daemon's own floor is 100 MB (-z, min 100), so a board that cannot spare
// 100 MB cannot use RAM mode at all and is kept on disk.
const RAM_CACHE_MAX_FRACTION = 0.25;
const RAM_CACHE_MIN_MB = 100;

// Spotify's own quality tiers, from the app's audio quality menu:
//
//   Low        24 kbps
//   Normal     96 kbps
//   High      160 kbps
//   Very High 320 kbps
//   Lossless  FLAC, up to 24-bit/44.1 kHz
//
// Boundaries sit between the tiers rather than on them, so a track that
// compresses slightly under or over its target still lands in the right band.
// The lossless boundary is well clear: measured 1847 kbps on lossless against
// 338 on Very High.
const QUALITY_TIERS = [
  { max: 60, label: 'Low' },
  { max: 128, label: 'Normal' },
  { max: 240, label: 'High' },
  { max: 450, label: 'Very High' },
  { max: Infinity, label: 'Lossless' },
];
const QUALITY_RETRY_DEFAULT_MS = 300;
const QUALITY_RETRY_MAX_MS = 2000;
const QUALITY_RETRY_DEFAULT_COUNT = 2;
const QUALITY_RETRY_MAX_COUNT = 10;
// A skip can open a cache file that is still filling. 300 ms × 2 is enough
// for the fd to appear, not for the download. Watch growth on a 1 s floor
// until the size stops moving or we land in Lossless.
const QUALITY_GROWTH_MS_FLOOR = 1000;
const QUALITY_GROWTH_MAX = 90;
const SEEK_COALESCE_DEFAULT_MS = 200;
const SEEK_COALESCE_MAX_MS = 2000;
const INACTIVE_HOLD_DEFAULT_MS = 2000;
const INACTIVE_HOLD_MAX_MS = 10000;
const QUEUE_FETCH_DEFAULT_MS = 2500;
const QUEUE_FETCH_MAX_MS = 10000;
// How close to the end of a queue-mode row a buffering event has to be for it
// to mean "our track just finished" rather than a mid-track rebuffer.
const QUEUE_END_WINDOW_MS = 1500;
// Cap on the URI -> item metadata harvested from Soloist events, so a long
// session cannot grow the map without bound.
const TRACK_CACHE_MAX = 500;
// How long a queue row may sit between "play sent" and "audio playing" before
// the row is given up and core moves on. A play issued while another device
// holds the Connect session produces no local playback and no event, so
// without this the mixed list waits for a row that will never start.
const QUEUE_START_TIMEOUT_MS = 8000;
// Browse tile for Spotify's own queue (previous / now / upcoming). This is
// not Volumio's mixed list. get_queue is authenticated and answers with
// queue_changed; a broadcast of that event is capped at 10, limit 0 asks
// for all. Local WS, so the wait is short.
const BROWSE_URI = 'soloist_connect';
const BROWSE_NAME = 'Spotify Queue';
// Home tiles do not render Font Awesome. They load albumart through
// Volumio's albumart server, same path rtlsdr_radio uses for radio.svg.
const BROWSE_ALBUMART =
  '/albumart?sourceicon=music_service/soloist_connect/assets/spotify.svg';
// Spotify kills a Soloist build 90 days after its build date. The plugin
// process timer (not cron, not a unit) inspects once a day while we stay up.
const BINARY_LIFE_DAYS = 90;
const FRESHNESS_CHECK_MS = 24 * 60 * 60 * 1000;
const AUTO_UPDATE_WITHIN_DAYS = 7;
// data/cache dirs are fixed in launch-soloist.sh

module.exports = SoloistConnect;

function SoloistConnect(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;
  this.servicename = 'soloist_connect';

  this.ws = null;
  this.wsReconnectTimer = null;
  this.active = false; // Soloist is the active Spotify Connect device
  // The last is_active the daemon reported, recorded without the hold delay.
  // `active` deliberately lags by inactive_hold_ms so a blink during a seek
  // does not end a Connect session; that lag makes it the wrong thing to ask
  // before starting a queue row.
  this.deviceActive = false;
  this.activatedAt = 0; // when Soloist last became active
  this.lastPlayTransitionAt = 0; // when status last flipped to 'play'
  this.volatileSet = false;
  // Re-entry guard for state publication. servicePushState runs the whole
  // Volumio state chain synchronously; a nested publication would recurse until
  // the Socket.IO encoder blew the stack.
  this.publishing = false;
  this.ignoreStopEvent = false;
  this.state = this.emptyState();
  this.positionAnchor = { position_ms: 0, timestamp_ms: Date.now(), speed: 0 };
  this.seekTimer = null;
  // The last object handed to servicePushState. Core keeps it by reference as
  // volatileState, so the seek tick writes here to be seen.
  this.publishedState = null;
  this.pushStateTimer = null;
  this.pushStateDirty = false;
  this.volumeTimer = null;
  this.volumeFromSoloistTimer = null;
  this.lastSentVolume = -1;
  this.volumeFromSoloist = false;
  this.pendingMixerVolume = null;
  // When align_volume is on, Soloist's --initial-volume is not written to
  // the mixer. volumeAligned is set after we copy Volumio's knob to Soloist;
  // volumeAlignPending ignores the daemon's first reports until they match.
  this.volumeAligned = false;
  this.volumeAlignPending = false;
  this.volumeAlignTimer = null;
  this.quality = '';       // Spotify tier for the current track, '' until known
  this.qualityUri = '';    // track the last measurement was taken against
  this.qualityPath = '';   // cache file that track was reading from
  this.qualitySize = 0;    // published size; a later growth upgrades the tier
  this.qualityWatchPath = '';
  this.qualityWatchSize = 0;
  this.qualityRetryTimer = null;
  this.qualityRetryCount = 0;
  this.qualityRetryUri = '';
  this.qualityGrowthTimer = null;
  this.qualityGrowthCount = 0;
  this.pendingYieldAt = 0; // yield in progress; leftover play must not reclaim
  this.takeoverInFlight = false;
  this.lastStateRefreshAt = 0; // throttle for unsolicited get_state requests
  this.seekCommandTimer = null;
  this.pendingSeekMs = null;
  this.inactiveHoldTimer = null;
  this.loggedIn = false; // stored Spotify session; a queue row needs one
  // Queue mode: Volumio's queue owns the playhead, not Spotify Connect.
  this.queueMode = false;
  this.queueUri = '';   // the URI core asked us to play for this row
  this.queueIndex = -1; // the queue position that row occupies
  this.queueStartTimer = null; // waiting for the row we asked for to start
  // uri -> Soloist queue item, harvested from events. explodeUri has no
  // Spotify Web API to ask, so a playlist row shows what we have already seen.
  this.trackCache = new Map();
  // Last queue_changed payload. The browse tile reads this; nothing here is
  // written into Volumio's play queue.
  this.spotifyQueue = { previous: [], upcoming: [] };
  this.queueWaiters = [];
  // True after handleBrowseUri for our tile. Unsolicited queue_changed is
  // capped at 10; a watching tile asks get_queue again so the page stays
  // complete. Cleared when the tile is removed.
  this.browseWatching = false;
  this.browseRefreshTimer = null;
  this.browseRefreshInFlight = false;
  this.browseRefreshDirty = false;
  this.freshnessTimer = null;
  this.binaryUpdateBusy = false;
}

// ---------------------------------------------------------------------------
// Volumio lifecycle
// ---------------------------------------------------------------------------

SoloistConnect.prototype.onVolumioStart = function () {
  const configFile = this.commandRouter.pluginManager.getConfigurationFile(
    this.context,
    'config.json'
  );
  this.config = new VConf();
  this.config.loadFile(configFile);
  this.ensureConfigDefaults();
  this.restoreRetainedApiKey();
  return libQ.resolve();
};

// Uninstall deletes /data/configuration/music_service/soloist_connect wholesale
// (removePluginFromConfiguration runs rm -rf on it), so the API key cannot
// survive there. With "Retain my API key" on, uninstall.sh preserves
// /data/soloist/soloist.env and /data/soloist/data instead. On a fresh install
// the config has no key but the env file still does, so restore it.
//
// The env file is mode 0600 and owned by volumio, the same user this process
// runs as. Nothing is logged but the fact that a key was restored.
SoloistConnect.prototype.restoreRetainedApiKey = function () {
  if ((this.config.get('api_key') || '').trim()) return;

  let env;
  try {
    env = fs.readFileSync(ENV_FILE, 'utf8');
  } catch (e) {
    return; // no retained state, which is the normal first-install case
  }

  const m = env.match(/^API_KEY="((?:[^"\\]|\\.)*)"$/m);
  if (!m) return;

  const key = m[1].replace(/\\(.)/g, '$1').trim();
  if (!key) return;

  this.logger.info('SoloistConnect: restoring retained API key from ' + ENV_FILE);
  this.config.set('api_key', key);

  const name = env.match(/^DEVICE_NAME="((?:[^"\\]|\\.)*)"$/m);
  if (name) {
    const deviceName = name[1].replace(/\\(.)/g, '$1').trim();
    if (deviceName) this.config.set('device_name', deviceName);
  }
};

// Volumio copies the shipped config.json into /data/configuration only when no
// config exists there. On upgrade the stored config is kept as-is, so a setting
// added in a later version is absent and get() returns undefined, which reaches
// the env file as an empty value.
//
// requiredConf.json is not the answer: checkRequiredConfigurationParameters
// calls set() for every key on every plugin load, which would overwrite the
// user's value with the default at each boot. Seed only what is missing.
SoloistConnect.prototype.ensureConfigDefaults = function () {
  let defaults;
  try {
    defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (e) {
    this.logger.error('SoloistConnect: cannot read shipped config.json: ' + e.message);
    return;
  }

  for (const key of Object.keys(defaults)) {
    if (this.config.has(key)) continue;
    const spec = defaults[key];
    this.logger.info('SoloistConnect: adding missing config key ' + key + ' = ' + spec.value);
    this.config.addConfigValue(key, spec.type, spec.value);
  }
};

SoloistConnect.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// Shipped package.json and alsa-lib/SOURCE.md. Not gated behind verbose:
// a capture has to say which plugin and which shim it came from, including
// when the daemon never starts (no API key).
SoloistConnect.prototype.pluginVersion = function () {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const v = pkg && pkg.version;
    return typeof v === 'string' && v.trim() ? v.trim() : 'unknown';
  } catch (e) {
    return 'unknown';
  }
};

SoloistConnect.prototype.shimVersion = function () {
  try {
    const text = fs.readFileSync(path.join(__dirname, 'alsa-lib', 'SOURCE.md'), 'utf8');
    const m = String(text).match(/Library version is \*\*([^*]+)\*\*/);
    return m && m[1].trim() ? m[1].trim() : 'unknown';
  } catch (e) {
    return 'unknown';
  }
};

SoloistConnect.prototype.logPluginIdentity = function () {
  this.logger.info(
    'SoloistConnect: plugin=' + this.pluginVersion() + ' shim=' + this.shimVersion()
  );
};

SoloistConnect.prototype.onStart = function () {
  const defer = libQ.defer();
  const self = this;

  this.logPluginIdentity();
  this.armFreshnessTimer({ initial: true });

  if (!this.volumeCallbackRegistered) {
    this.commandRouter.addCallback('volumioupdatevolume', (vol) => {
      self.onVolumioVolume(vol);
    });
    this.volumeCallbackRegistered = true;
  }

  this.unpinPlaybackDevice();
  this.warnIfSpopStarted();

  const apiKey = (this.config.get('api_key') || '').trim();
  if (!apiKey) {
    this.commandRouter.pushToastMessage(
      'info',
      'Spotify Soloist',
      'Please enter your Soloist API key in the plugin settings (Spotify for Developers dashboard).'
    );
    // Start "successfully" so the user can open settings; the daemon starts after saving.
    defer.resolve();
    return defer.promise;
  }

  this.clearAlsaYield();
  this.setMpdIgnoreUpdate(false);
  this.startDaemon()
    .then(() => {
      self.connectWebSocket();
      defer.resolve();
    })
    .fail((e) => {
      self.logger.error('SoloistConnect: failed to start daemon: ' + e);
      defer.reject(e);
    });

  return defer.promise;
};

SoloistConnect.prototype.onStop = function () {
  const defer = libQ.defer();
  this.clearPendingSeek();
  this.clearInactiveHold();
  this.clearQualityRetry();
  this.clearQueueStartTimer();
  this.clearFreshnessTimer();
  this.leaveQueueMode('plugin stop', false);
  this.removeFromBrowseSources();
  this.disconnectWebSocket();
  this.unsetVolatile();
  this.setMpdIgnoreUpdate(false);
  // Stop and unpin from boot. start/restart from onStart still work on a
  // disabled unit. disable without this left WantedBy=multi-user.target
  // able to bring the daemon back with the plugin off.
  exec(`/usr/bin/sudo /bin/systemctl stop ${SERVICE_UNIT}`, () => {
    exec(`/usr/bin/sudo /bin/systemctl disable ${SERVICE_UNIT}`, () => defer.resolve());
  });
  return defer.promise;
};

SoloistConnect.prototype.onRestart = function () {
  return this.onStop().then(() => this.onStart());
};

// ---------------------------------------------------------------------------
// Daemon management
// ---------------------------------------------------------------------------

SoloistConnect.prototype.pluginPath = function () {
  return '/data/plugins/music_service/soloist_connect';
};

SoloistConnect.prototype.binaryPath = function () {
  const staged = '/data/soloist/bin/soloist';
  if (fs.existsSync(staged)) return staged;
  return path.join(this.pluginPath(), 'bin', 'soloist');
};

SoloistConnect.prototype.runPath = function () {
  return this.binaryPath();
};

SoloistConnect.prototype.downloadScript = function () {
  return (
    '/usr/bin/sudo /bin/bash ' +
    path.join(this.pluginPath(), 'download-soloist.sh')
  );
};

SoloistConnect.prototype.startDaemon = function () {
  const defer = libQ.defer();
  const self = this;

  this.ensureBinaryFresh()
    .then(() => {
      self.syncPeppyMeteringFromPeppy();
      self.writeEnvFile();
      exec(
        `/usr/bin/sudo /bin/systemctl restart ${SERVICE_UNIT}`,
        { timeout: 30000 },
        (error) => {
          if (error) {
            self.logger.error('SoloistConnect: systemctl restart failed: ' + error);
            self.commandRouter.pushToastMessage('error', 'Spotify Soloist', 'systemctl failed: ' + error);
            defer.reject(error);
          } else {
            self.logger.info('SoloistConnect: soloist daemon started');
            defer.resolve();
          }
        }
      );
    })
    .fail((e) => {
      const msg = (e && e.message) || String(e);
      self.logger.error('SoloistConnect: startDaemon pre-flight failed: ' + msg);
      self.commandRouter.pushToastMessage('error', 'Spotify Soloist', 'Startup failed: ' + msg);
      defer.reject(e);
    });

  return defer.promise;
};

// Soloist builds expire after 90 days (exit code 10). Check and re-download if
// needed. Fully async: a synchronous download here would block Volumio's event
// loop (and freeze the whole UI) for up to 5 minutes at boot.
SoloistConnect.prototype.ensureBinaryFresh = function () {
  const defer = libQ.defer();
  const self = this;
  const bin = this.binaryPath();

  const download = () => {
    exec(self.downloadScript(), { timeout: 300000 }, (error) => {
      if (error) defer.reject(error);
      else defer.resolve();
    });
  };

  if (!fs.existsSync(bin)) {
    download();
    return defer.promise;
  }

  exec(`${this.runPath()} --version`, { timeout: 15000 }, (error) => {
    if (error && error.code === 10) {
      self.logger.info('SoloistConnect: build expired, re-downloading');
      self.commandRouter.pushToastMessage(
        'info',
        'Spotify Soloist',
        'Installed Soloist build has expired. Downloading a fresh build from Spotify...'
      );
      download();
    } else {
      // Any other failure mode: let the daemon itself surface it via systemd
      defer.resolve();
    }
  });

  return defer.promise;
};

// Days until Spotify's 90-day kill, from `soloist --version`.
// Exit 10 is already dead. Junk output is null: do not download on that.
SoloistConnect.prototype.remainingBinaryDays = function (stdout, exitCode, nowMs) {
  if (exitCode === 10) return 0;
  const text = String(stdout || '');
  const m = text.match(/\((\d{8})\)/);
  if (!m) return null;
  const y = parseInt(m[1].slice(0, 4), 10);
  const mo = parseInt(m[1].slice(4, 6), 10) - 1;
  const day = parseInt(m[1].slice(6, 8), 10);
  const built = Date.UTC(y, mo, day);
  if (!Number.isFinite(built)) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const remaining = Math.floor((built + BINARY_LIFE_DAYS * 86400000 - now) / 86400000);
  return remaining > 0 ? remaining : 0;
};

SoloistConnect.prototype.clearFreshnessTimer = function () {
  if (this.freshnessTimer) {
    clearTimeout(this.freshnessTimer);
    this.freshnessTimer = null;
  }
};

// First fire is one period later. startDaemon already ran ensureBinaryFresh.
SoloistConnect.prototype.armFreshnessTimer = function (opts) {
  const self = this;
  opts = opts || {};
  this.clearFreshnessTimer();
  const delay = this.freshnessCheckMs || FRESHNESS_CHECK_MS;
  this.freshnessTimer = setTimeout(function () {
    self.freshnessTimer = null;
    self.runFreshnessTick();
  }, delay);
  if (opts.initial) {
    this.logger.info('SoloistConnect: freshness armed period=24h');
  }
};

SoloistConnect.prototype.binaryFreshnessRemaining = function (done) {
  const bin = this.binaryPath();
  if (!fs.existsSync(bin)) {
    done(null, null);
    return;
  }
  exec(this.runPath() + ' --version', { timeout: 15000 }, (error, stdout) => {
    const code = error && typeof error.code === 'number' ? error.code : 0;
    done(null, this.remainingBinaryDays(stdout, code));
  });
};

SoloistConnect.prototype.runFreshnessTick = function () {
  const self = this;
  this.armFreshnessTimer();
  this.binaryFreshnessRemaining(function (err, remaining) {
    self.applyFreshness(remaining);
  });
};

SoloistConnect.prototype.applyFreshness = function (remaining) {
  const auto = this.config.get('auto_update_binary') === true;
  let action = 'noop';
  if (this.binaryUpdateBusy) {
    action = 'skip-busy';
  } else if (remaining == null) {
    action = 'noop';
  } else if (!auto) {
    action = remaining === 0 ? 'expired-off' : 'noop';
  } else if (remaining > AUTO_UPDATE_WITHIN_DAYS) {
    action = 'noop';
  } else if (this.owningPlayback()) {
    action = 'skip-play';
  } else {
    action = 'pull';
  }

  this.logger.info(
    'SoloistConnect: freshness remaining=' +
      (remaining == null ? 'unknown' : remaining) +
      ' auto=' + (auto ? 'on' : 'off') +
      ' action=' + action
  );

  if (action === 'expired-off') {
    this.commandRouter.pushToastMessage(
      'info',
      'Spotify Soloist',
      'The Soloist build has expired. Press Update Soloist binary now.'
    );
    return;
  }
  if (action === 'skip-play') {
    this.commandRouter.pushToastMessage(
      'info',
      'Spotify Soloist',
      'Soloist binary is near expiry. Update is waiting until Spotify is not playing here.'
    );
    return;
  }
  if (action === 'pull') this.pullFreshBinary();
};

// Same script as the Update button. No reboot countdown.
SoloistConnect.prototype.pullFreshBinary = function () {
  const self = this;
  if (this.binaryUpdateBusy) return;
  this.binaryUpdateBusy = true;
  this.commandRouter.pushToastMessage(
    'info',
    'Spotify Soloist',
    'Downloading a new Soloist binary from Spotify. We do not review that tarball.'
  );
  this.runDownloadScript(function (error) {
    if (error) {
      self.binaryUpdateBusy = false;
      self.commandRouter.pushToastMessage(
        'error',
        'Spotify Soloist',
        'Automatic Soloist update failed. The running binary was left alone.'
      );
      return;
    }
    libQ.resolve()
      .then(function () { return self.startDaemon(); })
      .then(function () { self.connectWebSocket(); })
      .then(function () {
        self.binaryUpdateBusy = false;
        self.commandRouter.pushToastMessage(
          'success',
          'Spotify Soloist',
          'Soloist binary updated. No reboot.'
        );
      })
      .fail(function (e) {
        self.binaryUpdateBusy = false;
        self.logger.error('SoloistConnect: auto-update start failed: ' + e);
      });
  });
};

// Largest tmpfs cache this board can carry, in MB, or 0 if RAM mode is not
// viable here. Read from MemTotal rather than assumed: the same plugin runs on
// a 512 MB Zero 2 W and a 16 GB x86 box.
//
// Returns 0 when MemTotal is unreadable. Refusing RAM mode on a board we
// cannot measure is the safe direction; guessing a size is not.
SoloistConnect.prototype.ramCacheCeilingMb = function () {
  let meminfo;
  try {
    meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
  } catch (e) {
    this.logger.warn('SoloistConnect: cannot read /proc/meminfo: ' + e.message);
    return 0;
  }
  const m = meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m);
  if (!m) {
    this.logger.warn('SoloistConnect: no MemTotal line in /proc/meminfo');
    return 0;
  }

  const totalMb = Math.floor(parseInt(m[1], 10) / 1024);
  const ceiling = Math.floor(totalMb * RAM_CACHE_MAX_FRACTION);
  return ceiling >= RAM_CACHE_MIN_MB ? ceiling : 0;
};

// The tmpfs size to write to the env file, and the cache size the daemon is
// given, are the same number in RAM mode. They must not diverge: the daemon
// fills to -z and has no idea the filesystem underneath is smaller, so a -z
// larger than the tmpfs means it writes until ENOSPC instead of evicting.
//
// Returns 0 in disk mode, or when the board cannot carry a tmpfs cache.
SoloistConnect.prototype.ramCacheSizeMb = function () {
  if (this.config.get('cache_location') !== 'ram') return 0;

  const ceiling = this.ramCacheCeilingMb();
  if (!ceiling) return 0;

  // 0 means "no limit" to the daemon, which cannot be honoured against a fixed
  // tmpfs. In RAM mode it becomes the ceiling.
  const requested = parseInt(this.config.get('cache_size_mb'), 10);
  if (!Number.isFinite(requested) || requested <= 0) return ceiling;
  return Math.min(requested, ceiling);
};

// Config values are validated at the boundary by validateSettings() before they
// reach the store, and v-conf enforces the types declared in config.json. This
// writer therefore trusts the config and does no revalidation.
SoloistConnect.prototype.writeEnvFile = function () {
  const esc = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Resolved here, not in the shell: cache-location.sh runs before the daemon
  // and must be handed a decided number, and the same number is what the
  // daemon is given as -z so the two cannot disagree.
  const ramMb = this.ramCacheSizeMb();
  const cacheSize = ramMb > 0 ? ramMb : this.config.get('cache_size_mb');

  // One line per daemon start, recording what was read and what was decided.
  //
  // Not gated behind verbose_logging. A stored cache_location of 'ram' once
  // produced CACHE_LOCATION="disk" in this file, and nothing in the source
  // accounts for it: the config store held 'ram', the MemTotal ceiling was
  // 4000 MB, and every caller runs in-process against the same config object.
  // Reading the code could not distinguish which of those three inputs was
  // actually false at the moment of the write, because none of them was
  // recorded. This records them.
  this.logger.info(
    'SoloistConnect: writeEnvFile cache_location=' +
      JSON.stringify(this.config.get('cache_location')) +
      ' cache_size_mb=' +
      JSON.stringify(this.config.get('cache_size_mb')) +
      ' ceiling=' +
      this.ramCacheCeilingMb() +
      ' -> ramMb=' +
      ramMb +
      ' CACHE_SIZE=' +
      cacheSize
  );

  const lines = [
    `API_KEY="${esc(this.config.get('api_key'))}"`,
    `DEVICE_NAME="${esc(this.config.get('device_name'))}"`,
    `INITIAL_VOLUME="${this.initialVolumeForDaemon()}"`,
    `CACHE_SIZE="${cacheSize}"`,
    // Read by cache-location.sh from the unit's ExecStartPre. "ram" is written
    // only when the board can actually carry it; otherwise this stays "disk"
    // whatever the user selected, and the toast from saveSoloistSettings says
    // so rather than leaving them with a setting that silently did nothing.
    `CACHE_LOCATION="${ramMb > 0 ? 'ram' : 'disk'}"`,
    `CACHE_TMPFS_MB="${ramMb}"`,
    `TLENGTH_MS="${this.config.get('buffer_ms')}"`,
    `OUTPUT_TRIM_DB="${this.config.get('output_trim_db')}"`,
    `LOUDNESS_NORMALIZATION="${this.config.get('loudness_normalization') !== false ? 'true' : 'false'}"`,
    `CROSSFADE="${this.config.get('crossfade') === true ? 'true' : 'false'}"`,
    `CROSSFADE_MS="${parseInt(this.config.get('crossfade_ms'), 10) || 2000}"`,
    `EXTERNAL_VOLUME="${this.mixerIsExternal() ? 'true' : 'false'}"`,
    // Read by uninstall.sh, which runs after the plugin config has been
    // rendered unreadable and cannot consult it.
    `RETAIN_API_KEY="${this.config.get('retain_api_key') === true ? 'true' : 'false'}"`,
    `PLAYBACK_DEVICE="${this.playbackDevice()}"`,
    // Read by launch-soloist.sh, which turns it into APULSE_DIAG.
    //
    // Every diagnostic in the apulse shim is gated behind that variable and
    // diag_on() returns early when it is unset, so the shim's handling of an
    // ALSA fault is invisible in the shipped build. When volumioswitch reports
    // that it cannot write to its target, the journal shows the symptom and
    // nothing on either side of it: whether apulse recovered, or reopened the
    // device, or gave up, is not recorded. Setting it changes no behaviour.
    `VERBOSE_LOGGING="${this.config.get('verbose_logging') === true ? 'true' : 'false'}"`,
  ];
  fs.mkdirSync('/data/soloist', { recursive: true });
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
};

// pcm.volumio's slave.pcm only. Does not walk nested slave { } blocks.
// Hardware mixer: volumioMultiRoomServer or volumioOutput.
// Software mixer with nothing above SoftMaster: softvolume.
SoloistConnect.prototype.volumioDirectSlave = function (conf) {
  const text = String(conf || '');
  const start = text.search(/^\s*pcm\.volumio\s*\{/m);
  if (start < 0) return '';
  const brace = text.indexOf('{', start);
  if (brace < 0) return '';
  let depth = 0;
  let end = -1;
  for (let i = brace; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return '';
  const block = text.slice(brace, end + 1);
  const quoted = block.match(/^\s*slave\.pcm\s+"([^"]+)"/m);
  if (quoted) return quoted[1];
  const bare = block.match(/^\s*slave\.pcm\s+(\S+)/m);
  return bare ? bare[1].replace(/;$/, '') : '';
};

// Peppy wins when pcm.spotify exists. Otherwise open softvolume only when
// that is already pcm.volumio's slave (maroen: empty → SoftMaster). Extra
// plug:volumio + FLOAT32 + 882 asserts on PCM2704; softvolume plays.
// Switcher / Fusion / Hardware stay on plug:volumio.
SoloistConnect.prototype.resolvePlaybackDevice = function (conf, peppyMetering) {
  const text = String(conf || '');
  if (peppyMetering && /^\s*pcm\.spotify\s*\{/m.test(text)) return 'plug:spotify';
  if (this.volumioDirectSlave(text) === 'softvolume') return 'softvolume';
  return 'plug:volumio';
};

SoloistConnect.prototype.playbackDevice = function () {
  let conf = '';
  try {
    conf = fs.readFileSync('/etc/asound.conf', 'utf8');
  } catch (e) { /* missing asound: plug:volumio */ }
  return this.resolvePlaybackDevice(conf, this.config.get('peppy_metering') === true);
};

// What the running unit was launched with. Unreadable is not a mismatch:
// Peppy notifies after every ALSA rewrite, and treating a failed /proc read
// as "wrong device" would restart in a loop.
SoloistConnect.prototype.livePlaybackDevice = function () {
  const pid = this.daemonPid();
  if (!pid) return { readable: false, device: '' };
  let env;
  try {
    env = fs.readFileSync('/proc/' + pid + '/environ', 'utf8');
  } catch (e) {
    return { readable: false, device: '' };
  }
  const line = env.split('\0').find((item) => item.startsWith('APULSE_PLAYBACK_DEVICE='));
  return { readable: true, device: line ? line.slice('APULSE_PLAYBACK_DEVICE='.length) : '' };
};

SoloistConnect.prototype.setPeppyMetering = function (enabled) {
  const want = !!enabled;
  if (this.config.get('peppy_metering') !== want) {
    this.config.set('peppy_metering', want);
  }
  this.writeEnvFile();
  const wantDev = this.playbackDevice();
  const live = this.livePlaybackDevice();
  if (!live.readable) {
    this.logger.info('SoloistConnect: metering live unread want=' + wantDev + ' skip');
    return libQ.resolve();
  }
  if (live.device === wantDev) {
    this.logger.info('SoloistConnect: metering live=' + live.device + ' want=' + wantDev + ' skip');
    return libQ.resolve();
  }
  if (!this.active && !this.ws) {
    this.logger.info('SoloistConnect: metering live=' + live.device + ' want=' + wantDev + ' skip');
    return libQ.resolve();
  }
  this.logger.info('SoloistConnect: metering live=' + live.device + ' want=' + wantDev + ' restart');
  return this.restartForMetering();
};

// Device is chosen at process start. Restart the unit only — do not run
// startDaemon() (binary download + re-ask Peppy) on a Peppy notify.
SoloistConnect.prototype.restartForMetering = function () {
  if (this.meteringRestart) return this.meteringRestart;
  const self = this;
  this.clearPendingSeek();
  this.clearInactiveHold();
  this.clearQualityRetry();
  this.clearQueueStartTimer();
  this.leaveQueueMode('metering restart', false);
  const defer = libQ.defer();
  this.meteringRestart = defer.promise;
  exec(
    `/usr/bin/sudo /bin/systemctl restart ${SERVICE_UNIT}`,
    { timeout: 30000 },
    (error) => {
      self.meteringRestart = null;
      if (error) {
        self.logger.error('SoloistConnect: restart for metering failed: ' + error);
        defer.reject(error);
      } else {
        self.connectWebSocket();
        defer.resolve();
      }
    }
  );
  return this.meteringRestart;
};

SoloistConnect.prototype.syncPeppyMeteringFromPeppy = function () {
  let want;
  try {
    want = this.commandRouter.executeOnPlugin(
      'user_interface',
      'peppy_screensaver',
      'soloistMeteringWanted'
    );
  } catch (e) {
    return;
  }
  if (typeof want === 'boolean' && this.config.get('peppy_metering') !== want) {
    this.config.set('peppy_metering', want);
  }
};

SoloistConnect.prototype.unpinPlaybackDevice = function () {
  const unit = '/etc/systemd/system/soloist.service';
  let text;
  try {
    text = fs.readFileSync(unit, 'utf8');
  } catch (e) {
    return;
  }
  if (!/^\s*Environment=APULSE_PLAYBACK_DEVICE=/m.test(text)) return;
  try {
    execSync(
      '/usr/bin/sudo /bin/bash ' + path.join(this.pluginPath(), 'unpin-playback-device.sh'),
      { timeout: 15000 }
    );
  } catch (e) {
    this.logger.warn('SoloistConnect: cannot unpin unit playback device: ' + e);
  }
};

SoloistConnect.prototype.warnIfSpopStarted = function () {
  try {
    const plugins = new VConf();
    plugins.loadFile('/data/configuration/plugins.json');
    if (plugins.get('music_service.spop.status') === 'STARTED') {
      this.commandRouter.pushToastMessage(
        'warning',
        'Spotify Soloist',
        'Stock Spotify Connect is also enabled. Use Soloist or Spotify Connect, not both.'
      );
    }
  } catch (e) { /* plugins.json unreadable */ }
};

// ---------------------------------------------------------------------------
// WebSocket client (Soloist local API)
// ---------------------------------------------------------------------------

SoloistConnect.prototype.connectWebSocket = function () {
  const self = this;
  this.disconnectWebSocket();

  const url = `ws://${WS_HOST}:${WS_PORT}`;
  this.logger.info('SoloistConnect: connecting to ' + url);

  try {
    this.ws = new WebSocket(url);
  } catch (e) {
    this.scheduleReconnect();
    return;
  }

  this.ws.on('open', () => {
    self.logger.info('SoloistConnect: WebSocket connected');
    self.fetchAudioSpec();
    // Tile only after the daemon answers, and only when queue playback is
    // on. A dead source with no WS is what Volumio's music-service docs
    // tell us not to register. Off must not advertise songs that skip.
    self.syncBrowseSource();
    self.alignToVolumioVolume();
    self.sendCommand({ command: 'get_state' });
  });

  this.ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    // Verbose logging is every event Soloist sends us, which is what
    // `soloist ctl trace` prints. We already hold that WebSocket, so there is
    // nothing to spawn or supervise: trace would open a second client to the
    // same endpoint to see the same messages.
    //
    // The setting used to add --verbose to the daemon. There is no such flag;
    // the binary answers "unrecognized option '--verbose'" and carries on, so
    // the toggle produced nothing at all.
    if (self.config.get('verbose_logging') === true) {
      self.logger.info('SoloistConnect: ws event ' + raw.toString());
    }
    self.handleEvent(msg);
  });

  this.ws.on('close', () => self.scheduleReconnect());
  this.ws.on('error', () => {
    /* close will follow */
  });
};

SoloistConnect.prototype.disconnectWebSocket = function () {
  this.resetVolumeAlign();
  this.resolveQueueWaiters(this.spotifyQueue);
  if (this.wsReconnectTimer) {
    clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = null;
  }
  if (this.ws) {
    try {
      this.ws.removeAllListeners();
      // ws closes cleanly, but the socket can still fail while it is being torn
      // down (e.g. the daemon is stopped at the same moment). An 'error' with no
      // listener on an EventEmitter throws and would take Volumio down, so log
      // it rather than swallow it.
      this.ws.on('error', (e) => {
        this.logger.warn('SoloistConnect: error while closing WebSocket: ' + e.message);
      });
      this.ws.close();
    } catch (e) {
      this.logger.warn('SoloistConnect: WebSocket close failed: ' + e.message);
    }
    this.ws = null;
  }
};

SoloistConnect.prototype.scheduleReconnect = function () {
  const self = this;
  if (this.wsReconnectTimer) return;
  this.wsReconnectTimer = setTimeout(() => {
    self.wsReconnectTimer = null;
    self.connectWebSocket();
  }, 5000);
};

SoloistConnect.prototype.sendCommand = function (payload) {
  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify(Object.assign({ type: 'command' }, payload)));
  }
};

// Soloist's WebSocket API does not expose codec/samplerate/bitdepth.
// Audio leaves through pcm.volumio, so report the ALSA hw_params of any
// open playback stream (the shared AAMPP chain).
SoloistConnect.prototype.fetchAudioSpec = function () {
  const self = this;
  exec(
    'sh -c "cat /proc/asound/card*/pcm*p/sub*/hw_params 2>/dev/null"',
    { timeout: 5000 },
    (error, stdout) => {
      if (error || !stdout) return;
      const rateM = stdout.match(/rate:\s*(\d+)/);
      const fmtM = stdout.match(/format:\s*(\S+)/);
      const chM = stdout.match(/channels:\s*(\d+)/);
      if (!rateM && !fmtM) return;

      const rate = rateM ? parseInt(rateM[1], 10) : 0;
      const fmt = fmtM ? fmtM[1] : '';
      const channels = chM ? parseInt(chM[1], 10) : 2;

      let bitdepth = '';
      if (/S16/.test(fmt)) bitdepth = '16 bit';
      else if (/S24/.test(fmt)) bitdepth = '24 bit';
      else if (/S32|FLOAT/.test(fmt)) bitdepth = '32 bit';

      self.audioSpec = {
        samplerate: rate ? (rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1) + ' kHz' : '',
        bitdepth: bitdepth,
        channels: channels || 2,
      };
    }
  );
};

// ---------------------------------------------------------------------------
// Stream quality
// ---------------------------------------------------------------------------
//
// Soloist sends no quality field. ALSA bit depth is FLOAT decoded then
// converted, so it reads the same for every tier. The only signal is the
// cache file Soloist has open under /proc/<pid>/fd: size × 8 / duration.
// Identify by that fd, not mtime. Do not open the file: a live read of the
// playing cache ended the Connect session (CKJvnbW).
//
// Pairing, not "seen twice":
//   new fd → measure now
//   last fd × a new uri → refuse (6289411 against the next duration)
//   two fds on a uri change, last path is one of them → measure the other
//   two fds, same uri → prefetch, keep the current label
// A uri change clears the published label so a skip cannot keep the
// previous track. Empty/stale/ambiguous retries per the operator
// settings, then stops.
//
// The file is not always complete when the fd appears. A skip before
// prefetch finishes opens a few hundred KB and the size/duration ratio
// reads as Low; locking that sample looks like a quality collapse.
// Hold the label while the same path is still growing,
// publish Lossless as soon as the bitrate crosses the floor, and upgrade
// if a later sample of the same fd is larger.

SoloistConnect.prototype.updateQuality = function (uri, durationMs, isRetry) {
  if (!uri || !durationMs || durationMs <= 0) return;

  const files = this.listCacheFiles();
  const picked = this.pickCacheFile(files, uri);

  if (picked.hold) {
    if (picked.hold !== 'prefetch' && this.holdQualityRetry(uri, durationMs)) {
      this.logger.info(
        'SoloistConnect: quality hold: fds=' + files.length + ' ' + picked.hold
      );
    }
    return;
  }

  if (
    this.quality &&
    this.qualityUri === uri &&
    this.qualityPath === picked.file.path &&
    picked.file.size <= this.qualitySize
  ) {
    this.clearQualityRetry();
    this.clearQualityGrowth();
    return;
  }

  const kbps = Math.round((picked.file.size * 8) / (durationMs / 1000) / 1000);
  let sample = '';
  for (const tier of QUALITY_TIERS) {
    if (kbps < tier.max) {
      sample = tier.label;
      break;
    }
  }

  const lossless = sample === 'Lossless';
  const stable =
    this.qualityWatchPath === picked.file.path &&
    this.qualityWatchSize === picked.file.size;
  this.qualityWatchPath = picked.file.path;
  this.qualityWatchSize = picked.file.size;

  if (
    !this.quality &&
    !lossless &&
    !stable &&
    this.watchQualityGrowth(uri, durationMs)
  ) {
    this.logger.info(
      'SoloistConnect: open ' + picked.file.path + ' ' + picked.file.size +
        ' bytes over ' + Math.round(durationMs / 1000) + 's = ' + kbps +
        ' kbps (growing, hold)'
    );
    return;
  }

  this.logger.info(
    'SoloistConnect: open ' + picked.file.path + ' ' + picked.file.size +
    ' bytes over ' + Math.round(durationMs / 1000) + 's = ' + kbps +
    ' kbps -> ' + sample
  );

  const changed = this.quality !== sample || this.qualityPath !== picked.file.path;
  this.quality = sample;
  this.qualityUri = uri;
  this.qualityPath = picked.file.path;
  this.qualitySize = picked.file.size;
  this.clearQualityRetry();
  if (lossless || !this.watchQualityGrowth(uri, durationMs)) {
    this.clearQualityGrowth();
  }

  if (changed && this.active && this.owningPlayback() && this.state.uri === uri) {
    this.state.bitdepth = this.quality;
    this.schedulePushState();
  }
};

SoloistConnect.prototype.pickCacheFile = function (files, uri) {
  if (!files.length) return { hold: 'empty' };

  if (files.length === 1) {
    const only = files[0];
    if (this.qualityPath === only.path && this.qualityUri && this.qualityUri !== uri) {
      return { hold: 'stale' };
    }
    return { file: only };
  }

  if (this.qualityUri === uri && this.quality) return { hold: 'prefetch' };

  if (this.qualityPath) {
    const others = files.filter((f) => f.path !== this.qualityPath);
    if (others.length === 1) return { file: others[0] };
  }
  return { hold: 'ambiguous' };
};

SoloistConnect.prototype.listCacheFiles = function () {
  const pid = this.daemonPid();
  if (!pid) return [];

  let entries;
  try {
    entries = fs.readdirSync('/proc/' + pid + '/fd');
  } catch (e) {
    return [];
  }

  const byPath = {};
  for (const fd of entries) {
    let target;
    try {
      target = fs.readlinkSync('/proc/' + pid + '/fd/' + fd);
    } catch (e) {
      continue;
    }
    if (target.indexOf(CACHE_DIR + '/cache/') !== 0) continue;
    if (!target.endsWith('.file')) continue;
    if (byPath[target]) continue;
    let size;
    try {
      size = fs.statSync(target).size;
    } catch (e) {
      continue;
    }
    if (!size) continue;
    byPath[target] = { path: target, size: size };
  }
  return Object.keys(byPath).map((k) => byPath[k]);
};

SoloistConnect.prototype.holdQualityRetry = function (uri, durationMs) {
  const delay = this.qualityRetryMs();
  const max = this.qualityRetryMax();
  if (delay <= 0 || max <= 0) return false;
  if (this.qualityRetryUri !== uri) {
    this.qualityRetryUri = uri;
    this.qualityRetryCount = 0;
  }
  if (this.qualityRetryCount >= max) return false;
  if (this.qualityRetryTimer) return false;
  this.qualityRetryCount += 1;
  this.qualityRetryTimer = setTimeout(() => {
    this.qualityRetryTimer = null;
    this.updateQuality(uri, durationMs, true);
  }, delay);
  return true;
};

SoloistConnect.prototype.clearQualityRetry = function () {
  if (this.qualityRetryTimer) {
    clearTimeout(this.qualityRetryTimer);
    this.qualityRetryTimer = null;
  }
  this.qualityRetryCount = 0;
  this.qualityRetryUri = '';
};

SoloistConnect.prototype.watchQualityGrowth = function (uri, durationMs) {
  const delay = this.qualityRetryMs();
  if (delay <= 0) return false;
  if (this.qualityGrowthCount >= QUALITY_GROWTH_MAX) return false;
  if (this.qualityGrowthTimer) return true;
  this.qualityGrowthCount += 1;
  this.qualityGrowthTimer = setTimeout(() => {
    this.qualityGrowthTimer = null;
    this.updateQuality(uri, durationMs, true);
  }, Math.max(delay, QUALITY_GROWTH_MS_FLOOR));
  return true;
};

SoloistConnect.prototype.clearQualityGrowth = function () {
  if (this.qualityGrowthTimer) {
    clearTimeout(this.qualityGrowthTimer);
    this.qualityGrowthTimer = null;
  }
  this.qualityGrowthCount = 0;
  this.qualityWatchPath = '';
  this.qualityWatchSize = 0;
};

SoloistConnect.prototype.resetQuality = function () {
  this.clearQualityRetry();
  this.clearQualityGrowth();
  this.quality = '';
  this.qualityUri = '';
  this.qualityPath = '';
  this.qualitySize = 0;
};

SoloistConnect.prototype.daemonPid = function () {
  try {
    const out = execSync(
      '/bin/systemctl show -p MainPID --value ' + SERVICE_UNIT,
      { encoding: 'utf8', timeout: 2000 }
    ).trim();
    const pid = parseInt(out, 10);
    return pid > 0 ? pid : 0;
  } catch (e) {
    return 0;
  }
};

// ---------------------------------------------------------------------------
// Soloist events -> Volumio state
// ---------------------------------------------------------------------------

// Only trust is_active when the event actually carries it. Many Soloist events
// (e.g. auth_state on a token refresh) omit the field; treating a missing field
// as `false` made the plugin think the Connect session ended, which let
// Volumio's routine stop() echoes reach Soloist as real pause commands and
// caused an endless play/pause loop.
SoloistConnect.prototype.updateActive = function (msg) {
  if (typeof msg.is_active !== 'boolean') return;
  this.deviceActive = msg.is_active;
  if (msg.is_active) {
    if (this.inactiveHoldTimer) {
      this.clearInactiveHold();
      this.logger.info('SoloistConnect: hold yield cancelled');
    }
    const becameActive = !this.active;
    if (becameActive) this.activatedAt = Date.now();
    this.active = true;
    if (becameActive) this.alignToVolumioVolume();
    return;
  }
  if (this.inactiveHoldTimer) return;
  // Queue mode does not yield on inactive. is_active is about which device the
  // phone points at, and the play was ours, so it says nothing about who owns
  // the playhead here.
  if (this.queueMode) return;
  const holdMs = this.inactiveHoldMs();
  const yieldNow = () => {
    this.inactiveHoldTimer = null;
    this.active = false;
    this.resetVolumeAlign();
    this.unsetVolatile();
  };
  if (holdMs <= 0) {
    yieldNow();
    return;
  }
  this.inactiveHoldTimer = setTimeout(yieldNow, holdMs);
  this.logger.info('SoloistConnect: hold yield: is_active=false hold=' + holdMs + 'ms');
};

SoloistConnect.prototype.clearInactiveHold = function () {
  if (!this.inactiveHoldTimer) return;
  clearTimeout(this.inactiveHoldTimer);
  this.inactiveHoldTimer = null;
};

SoloistConnect.prototype.clearPendingSeek = function () {
  if (this.seekCommandTimer) {
    clearTimeout(this.seekCommandTimer);
    this.seekCommandTimer = null;
  }
  this.pendingSeekMs = null;
};

SoloistConnect.prototype.itemUri = function (item) {
  return (item && item.uri) || '';
};

SoloistConnect.prototype.seekCoalesceMs = function () {
  const n = parseInt(this.config.get('seek_coalesce_ms'), 10);
  if (!Number.isFinite(n) || n < 0 || n > SEEK_COALESCE_MAX_MS) {
    return SEEK_COALESCE_DEFAULT_MS;
  }
  return n;
};

SoloistConnect.prototype.inactiveHoldMs = function () {
  const n = parseInt(this.config.get('inactive_hold_ms'), 10);
  if (!Number.isFinite(n) || n < 0 || n > INACTIVE_HOLD_MAX_MS) {
    return INACTIVE_HOLD_DEFAULT_MS;
  }
  return n;
};

SoloistConnect.prototype.qualityRetryMs = function () {
  const n = parseInt(this.config.get('quality_retry_ms'), 10);
  if (!Number.isFinite(n) || n < 0 || n > QUALITY_RETRY_MAX_MS) {
    return QUALITY_RETRY_DEFAULT_MS;
  }
  return n;
};

SoloistConnect.prototype.qualityRetryMax = function () {
  const n = parseInt(this.config.get('quality_retry_max'), 10);
  if (!Number.isFinite(n) || n < 0 || n > QUALITY_RETRY_MAX_COUNT) {
    return QUALITY_RETRY_DEFAULT_COUNT;
  }
  return n;
};

SoloistConnect.prototype.queueFetchMs = function () {
  const n = parseInt(this.config.get('queue_fetch_ms'), 10);
  if (!Number.isFinite(n) || n < 0 || n > QUEUE_FETCH_MAX_MS) {
    return QUEUE_FETCH_DEFAULT_MS;
  }
  return n;
};

// ---------------------------------------------------------------------------
// Device ownership
// ---------------------------------------------------------------------------
//
// Cork is not a close. Yield is unsetVolatile/stop only: write YIELD_PATH
// so apulse closes the PCM, then wait until /proc/asound shows it gone.
// Bluetooth SIGKILLs bluealsa-aplay; we cannot kill Soloist. Takeover
// stops whoever else holds the device and claims volatile. It must not
// yield: first play has already opened pcm.volumio (Peppyalsa 16384 vs
// our 22050). Yielding then reopening is what failed avail().
//
// `active` is Spotify Connect device status. It is not cleared on yield:
// clearing it made the next is_active=true look like a new selection and
// stole the session back from MPD.

SoloistConnect.prototype.requestAlsaYield = function () {
  try {
    fs.writeFileSync(YIELD_PATH, String(Date.now()));
  } catch (e) {
    this.logger.error('SoloistConnect: failed to request ALSA yield: ' + e);
  }
};

SoloistConnect.prototype.clearAlsaYield = function () {
  try {
    fs.unlinkSync(YIELD_PATH);
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      this.logger.error('SoloistConnect: failed to clear ALSA yield: ' + e);
    }
  }
};

SoloistConnect.prototype.waitAlsaReleasedSync = function (timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 2000);
  while (this.alsaHeldByUs() && Date.now() < deadline) {
    try {
      execSync('sleep 0.02', { timeout: 200 });
    } catch (e) {
      break;
    }
  }
};

SoloistConnect.prototype.alsaOwnerPids = function () {
  let out = '';
  try {
    out = execSync('sh -c "cat /proc/asound/card*/pcm*p/sub*/status 2>/dev/null"', {
      encoding: 'utf8',
      timeout: 500,
    });
  } catch (e) {
    return [];
  }
  const pids = [];
  const re = /owner_pid\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(out))) pids.push(parseInt(m[1], 10));
  return pids;
};

SoloistConnect.prototype.daemonPids = function () {
  const pids = [];
  try {
    const main = parseInt(
      execSync('systemctl show -p MainPID --value ' + SERVICE_UNIT, {
        encoding: 'utf8',
        timeout: 500,
      }).trim(),
      10
    );
    if (main > 0) pids.push(main);
  } catch (e) {
    /* unit not running */
  }
  const owners = this.alsaOwnerPids();
  for (let i = 0; i < owners.length; i++) {
    if (pids.indexOf(owners[i]) >= 0) continue;
    try {
      const comm = fs.readFileSync('/proc/' + owners[i] + '/comm', 'utf8').trim();
      if (comm === 'soloist' || comm === 'launch-soloist.sh') pids.push(owners[i]);
    } catch (e) {
      /* process gone */
    }
  }
  return pids;
};

SoloistConnect.prototype.alsaHeldByUs = function () {
  const us = this.daemonPids();
  if (!us.length) return false;
  const owners = this.alsaOwnerPids();
  for (let i = 0; i < owners.length; i++) {
    if (us.indexOf(owners[i]) >= 0) return true;
  }
  return false;
};

SoloistConnect.prototype.alsaHeldByOther = function () {
  const us = this.daemonPids();
  const owners = this.alsaOwnerPids();
  for (let i = 0; i < owners.length; i++) {
    if (us.indexOf(owners[i]) < 0) return true;
  }
  return false;
};

SoloistConnect.prototype.alsaHolders = function () {
  const us = this.daemonPids();
  const owners = this.alsaOwnerPids();
  const holders = [];
  for (let i = 0; i < owners.length; i++) {
    const pid = owners[i];
    if (us.indexOf(pid) >= 0) continue;
    let comm = '?';
    try {
      comm = fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim();
    } catch (e) {
      /* process gone */
    }
    holders.push({ pid: pid, comm: comm });
  }
  return holders;
};

// Release whoever /proc/asound says holds playback, by comm. Do not kill.
// mpd is already stopped by volumioStop. shairport-sync is left: the AirPlay
// plugin restarts it onto the same card. vtcs (Tidal Connect) is the holder
// that kept plug:volumio busy on cold-start play (BR8MhQz).
SoloistConnect.prototype.requestHoldersRelease = function () {
  const holders = this.alsaHolders();
  if (!holders.length) return;
  this.logger.info(
    'SoloistConnect: alsa held by ' +
      holders.map((h) => h.comm + '=' + h.pid).join(' ')
  );
  for (let i = 0; i < holders.length; i++) {
    this.requestHolderRelease(holders[i]);
  }
};

SoloistConnect.prototype.requestHolderRelease = function (h) {
  if (!h || !h.comm) return;
  if (h.comm === 'mpd' || h.comm === 'soloist' || h.comm === 'launch-soloist.sh') {
    return;
  }
  if (h.comm === 'vtcs') {
    const self = this;
    exec('/usr/bin/sudo /bin/systemctl stop vtcs.service', { timeout: 5000 }, (error) => {
      if (error) {
        self.logger.warn('SoloistConnect: cannot release vtcs: ' + error);
      }
    });
  }
};

SoloistConnect.prototype.waitUntil = function (pred, timeoutMs) {
  const self = this;
  const defer = libQ.defer();
  const deadline = Date.now() + (timeoutMs || 2000);
  const tick = function () {
    if (pred.call(self)) {
      defer.resolve();
      return;
    }
    if (Date.now() >= deadline) {
      defer.resolve();
      return;
    }
    setTimeout(tick, 20);
  };
  tick();
  return defer.promise;
};

// What Volumio currently considers the active service, as ytcr's
// isCurrentService() does. Asking Volumio rather than trusting our own flag is
// the difference between taking the device once and taking it repeatedly.
SoloistConnect.prototype.isCurrentService = function () {
  try {
    const state = this.commandRouter.volumioGetState();
    return !!(state && state.service === this.servicename);
  } catch (e) {
    return false;
  }
};

SoloistConnect.prototype.mpdPlugin = function () {
  try {
    return this.commandRouter.pluginManager.getPlugin('music_service', 'mpd') || null;
  } catch (e) {
    return null;
  }
};

// MPD's stop announcement is treated as end-of-track: syncState then plays
// the next queue item. ytcr and squeezelite_mc mute that with ignoreUpdate
// before volumioStop. Without it, Soloist and MPD write pcm.volumio together.
SoloistConnect.prototype.setMpdIgnoreUpdate = function (ignore) {
  const mpd = this.mpdPlugin();
  if (mpd && typeof mpd.ignoreUpdate === 'function') {
    mpd.ignoreUpdate(!!ignore);
  }
};

SoloistConnect.prototype.takeOverPlayback = function () {
  if (this.isCurrentService() || this.volatileSet) {
    this.clearAlsaYield();
    this.setVolatile();
    return;
  }

  if (this.takeoverInFlight) return;

  const self = this;
  const sm = this.context.coreCommand.stateMachine;

  this.logger.info('SoloistConnect: taking over playback');
  this.takeoverInFlight = true;
  this.setMpdIgnoreUpdate(true);
  if (typeof sm.setConsumeUpdateService === 'function') {
    sm.setConsumeUpdateService(undefined);
  }

  if (sm.isVolatile && sm.volatileService === this.servicename) {
    this.volatileSet = false;
    try {
      sm.unSetVolatile();
    } catch (e) {
      /* already cleared */
    }
  }

  const claim = function () {
    if (sm.isVolatile && sm.volatileService !== self.servicename) {
      self.volatileSet = false;
      try {
        sm.unSetVolatile();
      } catch (e) {
        /* already cleared */
      }
    }
    if (typeof sm.setConsumeUpdateService === 'function') {
      sm.setConsumeUpdateService(undefined);
    }
    self.setVolatile();
    self.clearAlsaYield();
    self.takeoverInFlight = false;
  };

  const stopOthers = function () {
    try {
      const p = self.context.coreCommand.volumioStop();
      if (p && typeof p.then === 'function') {
        return p;
      }
    } catch (e) {
      self.logger.error('SoloistConnect: playback takeover failed: ' + e);
    }
    return libQ.resolve();
  };

  stopOthers()
    .then(function () {
      self.requestHoldersRelease();
      return self.waitUntil(function () { return !this.alsaHeldByOther(); }, 2000);
    })
    .then(claim)
    .fail(function (e) {
      self.logger.error('SoloistConnect: playback takeover failed: ' + e);
      claim();
    });
};

SoloistConnect.prototype.logVerbose = function (msg) {
  if (this.config.get('verbose_logging') === true) {
    this.logger.info('SoloistConnect: ' + msg);
  }
};

SoloistConnect.prototype.handleEvent = function (msg) {
  switch (msg.type) {
    case 'auth_state':
      this.loggedIn = msg.logged_in === true;
      this.updateActive(msg);
      if (msg.logged_in) this.sendCommand({ command: 'get_state' });
      this.pushQueueBrowse();
      break;

    case 'playback_state':
      this.updateActive(msg);
      {
        const prevUri = this.state.uri;
        const incomingUri = this.itemUri(msg.item);
        if (incomingUri) this.cacheItem(msg.item);
        if (this.checkQueueRow(msg, incomingUri)) break;
        this.setStatus(msg.status);
        this.applyPosition(msg.position);
        if (incomingUri) this.applyItem(msg.item);
        if (incomingUri && incomingUri !== prevUri) this.scheduleBrowseRefresh();
        // Active with no item and nothing held: a handover that arrived as a
        // bare state. Ask rather than publish a blank.
        else if (this.active && !this.state.uri) this.requestStateRefresh();
        if (typeof msg.volume === 'number') this.applySoloistVolume(msg.volume);
        // End of the current track: Soloist repeats that item as buffering
        // before track_changed. Publishing it is what metavolumio latched.
        const sameTrackBuffering =
          msg.status === 'buffering' &&
          incomingUri !== '' &&
          incomingUri === prevUri;
        if (sameTrackBuffering) {
          this.logVerbose('hold publish: playback_state buffering same uri ' +
            prevUri);
        } else if (!incomingUri) {
          // Idle + empty item is a seek blink. applyItem
          // on uri="" published play with no title; Soloist was still active.
          this.logVerbose('hold publish: playback_state empty item uri=' +
            (this.state.uri || ''));
        } else {
          this.schedulePushState();
        }
      }
      break;

    case 'track_changed':
      // Backstop for the end of a queue row: 110 ms of lead on the measured
      // runs, against 380 ms for the buffering event checkQueueRow watches.
      if (
        this.queueMode &&
        this.itemUri(msg.item) &&
        this.itemUri(msg.item) !== this.queueUri
      ) {
        this.cacheItem(msg.item);
        this.endQueueRow('track_changed to ' + this.itemUri(msg.item));
        this.scheduleBrowseRefresh();
        break;
      }
      if (this.itemUri(msg.item)) this.applyItem(msg.item);
      this.logVerbose('track_changed uri=' + (this.state.uri || '') +
        ' title=' + JSON.stringify(this.state.title || ''));
      // Now playing on the tile can move immediately; upcoming is refreshed
      // with a full get_queue because the broadcast event is capped at 10.
      this.pushQueueBrowse();
      this.scheduleBrowseRefresh();
      if (!this.state.uri) this.requestStateRefresh();
      else this.pushStateNow();
      break;

    case 'playback_changed':
      // Same end-of-row idle as checkQueueRow: only after the row has started,
      // so a leftover idle between play-sent and first audio is ignored.
      if (this.queueMode && msg.status === 'idle' && !this.queueStartTimer) {
        this.endQueueRow('playback_changed idle');
        break;
      }
      this.setStatus(msg.status);
      // Status-only event. On a source switch back to Soloist, unsetVolatile
      // has already reset this.state, so there is nothing to show.
      if (!this.state.uri) this.requestStateRefresh();
      // buffering/idle here have no item. On auto-advance they arrive before
      // track_changed and a push would republish the previous track.
      else if (msg.status === 'buffering' || msg.status === 'idle') {
        this.logVerbose('hold publish: playback_changed ' + msg.status +
          ' uri=' + this.state.uri);
      } else {
        this.pushStateNow();
      }
      break;

    case 'queue_changed':
      // Free metadata for URIs we may later be asked to queue. explodeUri has
      // no Spotify Web API to fall back on. The same payload is the browse
      // tile; it is not pushed into Volumio's play queue.
      {
        const rows = [].concat(msg.previous || [], msg.upcoming || []);
        for (const row of rows) {
          if (row && row.item) this.cacheItem(row.item);
        }
        const waiting = this.queueWaiters.length > 0;
        this.rememberQueue(msg);
        // A get_queue reply is the full list. An unsolicited event is not;
        // ask again if the tile is open so the page does not shrink to 10.
        if (waiting) this.pushQueueBrowse();
        else this.scheduleBrowseRefresh();
      }
      break;

    case 'command_result':
      if (msg.command === 'skip_next' || msg.command === 'skip_prev') {
        this.logVerbose(msg.command + ' result');
      }
      break;

    case 'volume_changed':
      if (typeof msg.volume === 'number') this.applySoloistVolume(msg.volume);
      break;

    case 'device_changed':
      this.updateActive(msg);
      break;

    case 'position_sync':
      // Update the anchor only. A full push here used to sit on the
      // coalesced timer and delay skip UI. A mid-track jump is a user seek
      // and still publishes. A reset to ~0 is the next track arriving; wait
      // for track_changed rather than pushing the old title at 0:00.
      {
        const before = this.currentSeekMs();
        this.applyPosition(msg.position);
        this.state.seek = this.currentSeekMs();
        if (this.owningPlayback() && Math.abs(this.state.seek - before) > 2000) {
          if (this.state.seek <= 2000) {
            this.logVerbose('hold publish: position_sync reset to ' +
              this.state.seek + 'ms uri=' + (this.state.uri || ''));
          } else {
            this.publishState(this.stateSnapshot());
          }
        }
      }
      break;

    default:
      break;
  }
};

SoloistConnect.prototype.setStatus = function (soloistStatus) {
  const mapped = this.mapStatus(soloistStatus);
  if (mapped === 'play' && this.state.status !== 'play') {
    if (this.pendingYieldAt && Date.now() - this.pendingYieldAt < 1500 &&
        !this.isCurrentService()) {
      this.state.status = 'pause';
      this.syncSeekTimer();
      return;
    }
    if (!this.queueMode && !this.deviceActive && !this.isCurrentService()) {
      this.logger.info('SoloistConnect: not claiming: playing while is_active=false');
      this.state.status = 'pause';
      this.syncSeekTimer();
      return;
    }
    this.pendingYieldAt = 0;
    this.lastPlayTransitionAt = Date.now();
    // The ALSA stream only exists once playback starts. At WebSocket connect
    // /proc/asound reports "closed", so the sample rate has to be read here or
    // it is never read at all.
    this.fetchAudioSpec();
    // In queue mode core owns the playhead, so claiming volatile here is what
    // would take next/prev and end-of-track away from the mixed list. The
    // device is already ours; only make sure the shim is not still being told
    // to release it.
    if (this.queueMode) {
      this.clearAlsaYield();
      this.clearQueueStartTimer();
    } else this.takeOverPlayback();
  }
  this.state.status = mapped;
  this.syncSeekTimer();
};

SoloistConnect.prototype.mapStatus = function (s) {
  if (s === 'playing') return 'play';
  // Buffering happens briefly at every track start/seek; pushing it as 'pause'
  // makes Volumio's state machine flap pause/play and echo commands back.
  if (s === 'buffering') return this.state.status === 'play' ? 'play' : 'pause';
  if (s === 'paused') return 'pause';
  // idle is the gap between Spotify tracks, not a source stop. Publishing
  // it as stop is the same end-of-block path that auto-starts the next
  // queue item — and our stop() then pauses Soloist, so nothing advances.
  //
  // In queue mode that path is exactly what we want: advancing the mixed list
  // is core's job, and idle there means our row is over.
  if (s === 'idle') {
    if (this.queueMode) return 'stop';
    return this.state.status === 'play' ? 'play' : 'stop';
  }
  return 'stop';
};

// Decorations to flat metadata. Split out of applyItem so a queue row and the
// now-playing line read the same fields from the same parser.
SoloistConnect.prototype.itemMeta = function (item) {
  const dec = (item && item.decorations) || {};
  const identity = dec.identity || {};
  const parent = dec.parent && dec.parent.entity;
  const creators = dec.creators || [];
  const playback = dec.playback || {};
  const covers = (dec.visual_identity && dec.visual_identity.cover) || [];

  let art = '';
  const preferred = ['large', 'xlarge', 'default', 'small'];
  for (const size of preferred) {
    const hit = covers.find((c) => c.size === size);
    if (hit) {
      art = hit.url;
      break;
    }
  }
  if (!art && covers.length) art = covers[0].url;

  return {
    uri: (item && item.uri) || '',
    title: identity.name || '',
    album:
      (parent && parent.decorations && parent.decorations.identity
        ? parent.decorations.identity.name
        : '') || '',
    artist: creators
      .map((c) =>
        c.entity && c.entity.decorations && c.entity.decorations.identity
          ? c.entity.decorations.identity.name
          : ''
      )
      .filter(Boolean)
      .join(', '),
    durationMs: playback.duration_ms || 0,
    albumart: art || '/albumart',
  };
};

SoloistConnect.prototype.applyItem = function (item) {
  const meta = this.itemMeta(item);
  const uri = meta.uri;

  this.state.uri = uri;
  this.state.title = meta.title;
  this.state.album = meta.album;
  this.state.artist = meta.artist;
  this.state.duration = Math.round(meta.durationMs / 1000);
  if (uri && uri !== this.qualityUri) {
    this.quality = '';
    this.qualitySize = 0;
    this.clearQualityGrowth();
    if (this.qualityRetryUri !== uri) this.clearQualityRetry();
  }
  this.updateQuality(uri, meta.durationMs);
  this.state.albumart = meta.albumart;
  this.cacheItem(item);
  this.updateQueueRow(meta);
};

// In queue mode the UI does not read what we publish.
// CoreStateMachine::getState returns trackBlock.name, .artist, .album,
// .albumart and .duration straight from the queue row for a non-volatile
// service; our pushed state only carries seek and status. explodeUri can only
// fill that row from URIs Soloist has already named this session, so a track it
// has never mentioned queues with no artwork, the placeholder title and
// duration 0, which also leaves the seek bar with no end. Write the real
// metadata into the row the moment the daemon tells us what it is.
SoloistConnect.prototype.updateQueueRow = function (meta) {
  if (!this.queueMode || !meta || !meta.uri || meta.uri !== this.queueUri) return;
  const sm = this.context.coreCommand.stateMachine;
  try {
    const queue = sm.playQueue && sm.playQueue.arrayQueue;
    if (!queue) return;
    const row = queue[sm.currentPosition];
    if (!row || row.uri !== meta.uri) return;

    let changed = false;
    const set = (key, value) => {
      if (value && row[key] !== value) {
        row[key] = value;
        changed = true;
      }
    };
    set('name', meta.title);
    set('title', meta.title);
    set('artist', meta.artist);
    set('album', meta.album);
    if (meta.albumart && meta.albumart !== '/albumart') set('albumart', meta.albumart);
    const duration = Math.round(meta.durationMs / 1000);
    let durationChanged = false;
    if (duration && row.duration !== duration) {
      row.duration = duration;
      durationChanged = true;
      changed = true;
    }
    if (!changed) return;

    this.logVerbose('queue row metadata filled for ' + meta.uri);
    if (typeof sm.updateTrackBlock === 'function') sm.updateTrackBlock();
    // play() already started increasePlaybackTimer. startPlaybackTimer()
    // again would arm a second loop on the same currentSeek (nStartTime is
    // ignored; the old timeout is not cancelled). Write the duration the
    // running loop reads.
    if (durationChanged) sm.currentSongDuration = duration * 1000;
    if (typeof sm.playQueue.saveQueue === 'function') sm.playQueue.saveQueue();
    if (typeof this.commandRouter.volumioPushQueue === 'function') {
      this.commandRouter.volumioPushQueue(queue);
    }
  } catch (e) {
    this.logger.error('SoloistConnect: could not fill the queue row: ' + e);
  }
};

SoloistConnect.prototype.applyPosition = function (pos) {
  if (pos == null) return;
  if (typeof pos === 'number' && Number.isFinite(pos)) {
    this.positionAnchor = {
      position_ms: pos,
      timestamp_ms: Date.now(),
      speed: this.state.status === 'play' ? 1 : 0,
    };
    return;
  }
  if (typeof pos !== 'object') return;
  const positionMs = Number(
    pos.position_ms != null ? pos.position_ms : pos.position
  );
  if (!Number.isFinite(positionMs)) return;
  const timestampMs = Number(pos.timestamp_ms);
  const now = Date.now();
  let ts = Number.isFinite(timestampMs) ? timestampMs : now;
  // A timestamp more than 2s off "now" is clock skew or seconds-vs-ms.
  // currentSeekMs would jump. Treat position_ms as now instead.
  if (Math.abs(now - ts) > 2000) ts = now;
  this.positionAnchor = {
    position_ms: positionMs,
    timestamp_ms: ts,
    speed: this.state.status === 'play' ? 1 : 0,
  };
};

SoloistConnect.prototype.currentSeekMs = function () {
  const a = this.positionAnchor;
  const speed = this.state.status === 'play' ? 1 : 0;
  return Math.max(
    0,
    Math.round((a.position_ms || 0) + (Date.now() - a.timestamp_ms) * speed)
  );
};

// The seek bar needs the tick, but on the published object. See
// syncSeekTimer().
SoloistConnect.prototype.emptyState = function () {
  return {
    status: 'stop',
    service: this.servicename,
    title: '',
    artist: '',
    album: '',
    albumart: '/albumart',
    uri: '',
    trackType: 'spotify',
    seek: 0,
    duration: 0,
    samplerate: '',
    bitdepth: '',
    channels: 2,
    disableUiControls: false,
  };
};

// Soloist fires playback_state + track_changed + playback_changed together.
// Coalesce those to one push on the next turn. Do not add a delay — a
// pending timer was swallowing skip/track updates until the next tick
// from Soloist (often seconds).
SoloistConnect.prototype.schedulePushState = function () {
  if (this.pushStateTimer) {
    this.pushStateDirty = true;
    return;
  }
  this.pushStateTimer = setImmediate(() => {
    this.pushStateTimer = null;
    this.pushState();
    if (this.pushStateDirty) {
      this.pushStateDirty = false;
      this.schedulePushState();
    }
  });
};

SoloistConnect.prototype.pushStateNow = function () {
  if (this.pushStateTimer) {
    clearImmediate(this.pushStateTimer);
    this.pushStateTimer = null;
  }
  this.pushStateDirty = false;
  this.pushState();
};

// Publishing state must never re-enter itself.
//
// servicePushState drives Volumio's state machine synchronously: syncState,
// pushState, volumioPushState, then every interface plugin. If anything in that
// chain leads back here, the second publication nests inside the first and the
// stack grows until JSON.stringify in the Socket.IO encoder throws
// RangeError: Maximum call stack size exceeded. That is what a fatal crash on
// takeover looked like, with the encoder as the victim rather than the cause.
//
// Two rules, both cheap:
//   - a re-entry guard, so a nested call is dropped rather than recursing;
//   - publish a snapshot, never this.state, so Volumio cannot observe the live
//     object mutating underneath it during nested publication. The state
//     machine keeps volatileState by reference, so handing it the live object
//     aliases our mutable state into core.
SoloistConnect.prototype.stateSnapshot = function () {
  return Object.assign({}, this.state);
};

SoloistConnect.prototype.publishState = function (state) {
  if (this.publishing) {
    this.logger.warn(
      'SoloistConnect: state publication re-entered; dropping nested push'
    );
    return;
  }
  this.publishing = true;
  try {
    // Keep the object we hand over. CoreStateMachine.syncState stores it by
    // reference as volatileState, and getState() reads seek from it on every
    // call, so this is the object the UI is looking at until the next publish.
    this.publishedState = state;
    this.logVerbose(
      'publish ' + (state.status || '') +
      ' uri=' + (state.uri || '') +
      ' title=' + JSON.stringify(state.title || '') +
      ' artist=' + JSON.stringify(state.artist || '')
    );
    this.commandRouter.servicePushState(state, this.servicename);
  } finally {
    this.publishing = false;
  }
};

// Advance the position on the object core is holding.
//
// The seek bar is not interpolated by the UI. volumioGetState() is
// stateMachine.getState(), which for a volatile service returns
// volatileState.seek: the value from the last publish. Skip forward and back
// use the same figure as their origin, and so does a browser refresh.
//
// Stock spop gets away with `this.state.seek += 1000` because syncState keeps
// the pushed object by reference and spop pushes this.state itself, so the
// increment lands on what the UI reads. We publish a snapshot on purpose, to
// stop core aliasing our mutable state during a nested publication, so ticking
// this.state would write to an object core is not looking at. Tick the
// snapshot instead.
//
// Never publish from here. A publish per second runs the state machine,
// volumiodiscovery, every interface plugin and MRS's multiroom sync, and MRS
// plus volumioswitch then fails snd_pcm_avail(softvolume) and XRUNs the DAC.
SoloistConnect.prototype.syncSeekTimer = function () {
  if (this.state.status === 'play' && this.active) {
    if (this.seekTimer) return;
    this.seekTimer = setInterval(() => {
      if (this.state.status !== 'play' || !this.active) {
        this.stopSeekTimer();
        return;
      }
      const seek = this.currentSeekMs();

      this.state.seek = seek;
      if (this.publishedState) this.publishedState.seek = seek;
    }, 1000);
    return;
  }
  this.stopSeekTimer();
};

SoloistConnect.prototype.stopSeekTimer = function () {
  if (!this.seekTimer) return;
  clearInterval(this.seekTimer);
  this.seekTimer = null;
};

// Do we own what is coming out of the DAC right now?
//
// volatileSet alone answered this until queue mode existed, and every place
// that asked the question in those terms silently stopped working for a queue
// row: the seek command was dropped, a seek jump was never republished, mixer
// volume was parked, and a quality retry never reached the UI. Ownership is
// the question, not which of the two modes we are in.
SoloistConnect.prototype.owningPlayback = function () {
  return this.volatileSet || this.queueMode;
};

SoloistConnect.prototype.pushState = function () {
  if (!this.active) return;
  // Only publish while we are the volatile service. setVolatile is asserted
  // once, on the takeover edge in updateActive, not here: calling it from
  // pushState meant every event from a still-connected phone re-claimed the
  // session, so our metadata overwrote whatever the user had switched to.
  if (!this.owningPlayback()) return;
  this.state.service = this.servicename;
  this.state.seek = this.currentSeekMs();
  // The quality tier is measured from the cache and does not depend on ALSA, so
  // it must not be gated behind audioSpec. fetchAudioSpec runs when the
  // WebSocket connects, at which point nothing is playing and /proc/asound
  // reads "closed", so audioSpec stayed unset and a correctly measured tier was
  // never shown.
  this.state.bitdepth = this.quality;
  if (this.audioSpec) {
    this.state.samplerate = this.audioSpec.samplerate;
    this.state.channels = this.audioSpec.channels;
  }
  this.publishState(this.stateSnapshot());
};

// Ask the daemon what is playing. playback_state is the answer and carries the
// decorated item, so a claim that landed with no metadata repairs itself on the
// next event instead of waiting for the user to skip.
//
// Throttled: a daemon that answers get_state without an item would otherwise be
// asked again by its own reply, indefinitely.
SoloistConnect.prototype.requestStateRefresh = function () {
  const now = Date.now();
  if (now - this.lastStateRefreshAt < 3000) return;
  this.lastStateRefreshAt = now;
  this.sendCommand({ command: 'get_state' });
};

// Publish once on the volatile claim edge.
//
// pushState() returns early while volatileSet is false, and the claim is
// asynchronous: playback_state runs takeOverPlayback (volumioStop, then a poll
// until the device is free) while its own schedulePushState fires on the very
// next turn of the event loop. Metadata already written by applyItem is
// therefore dropped by that push, and nothing publishes afterwards, because
// setVolatile did not push and the only remaining events on a mid-track resume
// are position_sync, which publishes solely on a jump over 2000 ms.
//
// A skip publishes because track_changed calls pushStateNow after the claim has
// completed. Auto-advance used to publish the previous track first: Soloist
// sends buffering/idle with no new item, then repeats the old URI, then
// track_changed. Those earlier pushes are held.
//
// Empty state is not published: claiming with no item yet would blank the UI.
// Ask the daemon instead.
SoloistConnect.prototype.publishOnClaim = function () {
  if (!this.state.uri) {
    this.requestStateRefresh();
    return;
  }
  this.schedulePushState();
};

SoloistConnect.prototype.setVolatile = function () {
  if (this.volatileSet) return;
  this.volatileSet = true;
  this.context.coreCommand.stateMachine.setVolatile({
    service: this.servicename,
    callback: this.unsetVolatile.bind(this),
  });

  // Volumio emits a stop() echo shortly after volatile mode begins. Swallow
  // that window and nothing more. The stock Spotify plugin uses the same two
  // seconds, cleared unconditionally: a latch tied to session state made every
  // later stop unreachable.
  this.ignoreStopEvent = true;
  if (this.ignoreStopTimer) clearTimeout(this.ignoreStopTimer);
  this.ignoreStopTimer = setTimeout(() => {
    this.ignoreStopTimer = null;
    this.ignoreStopEvent = false;
  }, 2000);
  this.flushPendingMixerVolume();
  this.publishOnClaim();
};

// pause is account-wide. After the session has left this speaker, sending
// one here stops the phone or desktop that now holds it.
SoloistConnect.prototype.pauseIfOurs = function () {
  if (!this.deviceActive) return;
  this.sendCommand({ command: 'pause' });
};

SoloistConnect.prototype.unsetVolatile = function () {
  this.clearPendingSeek();
  this.clearInactiveHold();
  this.resetQuality();
  if (!this.volatileSet) return;
  // Pause, not stop: see CONNECT_LEAVE_STATUS. endQueueRow still publishes
  // stop after leaving queue mode; that is what syncState turns into next().
  this.state.status = CONNECT_LEAVE_STATUS;
  const snapshot = this.stateSnapshot();
  this.volatileSet = false;
  this.setMpdIgnoreUpdate(false);
  if (this.pushStateTimer) {
    clearImmediate(this.pushStateTimer);
    this.pushStateTimer = null;
  }
  this.pushStateDirty = false;
  this.stopSeekTimer();
  this.state = this.emptyState();
  this.publishedState = null;
  this.pendingMixerVolume = null;
  this.pendingYieldAt = Date.now();
  this.requestAlsaYield();
  this.pauseIfOurs();
  this.waitAlsaReleasedSync(2000);
  this.publishState(snapshot);

  try {
    this.context.coreCommand.stateMachine.unSetVolatile();
  } catch (e) {
    /* already cleared by core, which is the common case */
  }
};

// ---------------------------------------------------------------------------
// Queue mode: Volumio's queue owns the playhead
// ---------------------------------------------------------------------------
//
// Two modes, never both at once.
//
//   Connect mode - the phone owns the playhead. We are volatile, idle maps to
//                  play so Soloist can auto-advance, and next/prev are
//                  skip_next/skip_prev inside Spotify's own context.
//   queue mode   - Volumio's queue owns the playhead. We are NOT volatile, so
//                  core walks the mixed list, calls clearAddPlayTrack for each
//                  soloist_connect row and starts the next service itself when
//                  we report stop. next/prev never reach us here:
//                  CoreStateMachine::next only calls the plugin while
//                  isVolatile.
//
// Measured, and the reason this works at all:
//
//   - play with a uri needs only a stored session. The Spotify app does not
//     have to be open, and is_active is true for a play we issue ourselves.
//   - Soloist does not stop at the end of a single URI, it rolls into autoplay,
//     and there is no daemon switch for that: go-librespot has
//     disable_autoplay, Soloist has only --single-track, which exits the
//     process. But the roll is announced before it is audible. playback_state
//     buffering with position == duration arrived 380 ms ahead of the next
//     track's audio on the tightest of three runs. That event is the end of the
//     row.
//   - Releasing the DAC takes 1-12 ms (pcm close handed off keep=1) and MPD
//     opened 172-220 ms later with no busy card and no dead PCM, so the pause
//     and the yield fit inside that 380 ms.

// Drop volatile without the pause and yield that unsetVolatile performs: core
// has already stopped whatever was playing and is about to hand us a row.
// Clearing our own flag first makes core's volatileCallback a no-op, which is
// the idiom takeOverPlayback already uses.
SoloistConnect.prototype.leaveVolatileForQueue = function () {
  const sm = this.context.coreCommand.stateMachine;
  this.clearInactiveHold();
  if (this.ignoreStopTimer) {
    clearTimeout(this.ignoreStopTimer);
    this.ignoreStopTimer = null;
  }
  this.ignoreStopEvent = false;
  this.volatileSet = false;
  try {
    if (sm.isVolatile) sm.unSetVolatile();
  } catch (e) {
    /* already cleared by core */
  }
  if (typeof sm.setConsumeUpdateService === 'function') {
    sm.setConsumeUpdateService(undefined);
  }
};

SoloistConnect.prototype.leaveQueueMode = function (reason, reclaim) {
  if (!this.queueMode) return;
  this.logger.info('SoloistConnect: leaving queue mode: ' + reason);
  this.clearQueueStartTimer();
  this.queueMode = false;
  this.queueUri = '';
  this.queueIndex = -1;
  // The phone taking the session mid-row does not produce a fresh play
  // transition, so setStatus would never claim. Claim here instead. Core
  // stopping us is the opposite case and must not reclaim.
  if (reclaim && this.state.status === 'play') this.takeOverPlayback();
};

// Is the row we armed still the one core is playing?
//
// Core does not call our stop() when it advances: CoreStateMachine::stop
// resolves trackBlock at the new currentPosition and stops that service, not
// the one that just finished. So a timer armed for one row can outlive it, and
// firing then would report a stop for whatever is current now.
SoloistConnect.prototype.queueRowIsCurrent = function (uri, index) {
  try {
    const sm = this.context.coreCommand.stateMachine;
    if (sm.currentPosition !== index) return false;
    const queue = sm.playQueue && sm.playQueue.arrayQueue;
    if (!queue) return false;
    const row = queue[index];
    return !!(row && row.uri === uri && row.service === this.servicename);
  } catch (e) {
    return false;
  }
};

// The position core is currently playing, or -1 if it cannot be read.
SoloistConnect.prototype.currentQueueIndex = function () {
  try {
    const sm = this.context.coreCommand.stateMachine;
    const index = sm.currentPosition;
    return typeof index === 'number' ? index : -1;
  } catch (e) {
    return -1;
  }
};

// Queue playback is off by default. A Spotify row still appears in the queue
// when it is off, and is skipped when it is reached: a row that silently
// vanishes from the list the user built is dishonest, a row that is visibly
// skipped is not.
SoloistConnect.prototype.queuePlaybackEnabled = function () {
  return this.config.get('queue_playback') === true;
};

// What to do with a row that did not produce local audio. Off skips it. On
// leaves it playing wherever the Connect session went.
SoloistConnect.prototype.remoteQueuePlayback = function () {
  return this.config.get('queue_remote_playback') === true;
};

// How long to wait for a queue row to start. A method so a test can shorten it.
SoloistConnect.prototype.queueStartTimeoutMs = function () {
  return QUEUE_START_TIMEOUT_MS;
};

SoloistConnect.prototype.clearQueueStartTimer = function () {
  if (!this.queueStartTimer) return;
  clearTimeout(this.queueStartTimer);
  this.queueStartTimer = null;
};

// A row we cannot play. Core invoked us from play() while currentStatus is
// still stop, so a stop publish hits syncState's "No code" branch and the
// mixed list does not move. next() from stop increments and plays the
// following row. Must not run inside play()'s own turn.
SoloistConnect.prototype.skipQueueRow = function (uri, reason) {
  this.logger.info('SoloistConnect: skipping queue row ' + uri + ': ' + reason);
  this.clearQueueStartTimer();
  this.leaveVolatileForQueue();
  this.queueMode = false;
  this.queueUri = '';
  this.queueIndex = -1;
  this.state = this.emptyState();
  this.state.uri = uri;
  const self = this;
  setImmediate(() => {
    try {
      const sm = self.context.coreCommand.stateMachine;
      if (sm && typeof sm.next === 'function') sm.next();
    } catch (e) {
      self.logger.error('SoloistConnect: skip could not advance: ' + e);
    }
  });
};

// End of our row. Pause before the roll is audible, release the DAC, then
// report stop, which is what CoreStateMachine::syncState turns into
// currentPosition++ and a play of the next service.
SoloistConnect.prototype.endQueueRow = function (reason) {
  if (!this.queueMode) return;
  this.clearQueueStartTimer();
  this.logger.info(
    'SoloistConnect: queue row ended (' + reason + ') uri=' + this.queueUri
  );
  this.clearPendingSeek();
  this.clearQualityRetry();
  this.stopSeekTimer();
  this.pauseIfOurs();
  this.pendingYieldAt = Date.now();
  this.requestAlsaYield();
  this.state.status = 'stop';
  this.state.seek = (this.state.duration || 0) * 1000;
  const snapshot = this.stateSnapshot();
  // Leave before the stop publish: syncState will play the next service in
  // the same turn, and that service is not us.
  this.leaveQueueMode('row ended', false);
  const publish = () => this.publishState(snapshot);
  // stop() and unsetVolatile wait for the PCM. Publishing stop immediately
  // lets core open MPD on a card we still hold. If we already released,
  // publish now so the 380 ms buffering lead is not spent waiting.
  if (!this.alsaHeldByUs()) {
    publish();
    return;
  }
  this.waitUntil(function () { return !this.alsaHeldByUs(); }, 2000)
    .then(publish);
};

// Queue-mode watchdog, run on every playback_state.
//
// Returns true when the event has been consumed and must not be published as
// ordinary playback.
SoloistConnect.prototype.checkQueueRow = function (msg, incomingUri) {
  if (!this.queueMode) return false;

  // Context alone is not a session move: play of a track URI may name the
  // album as context while the item is still our row. Only the item URI
  // says the playhead left. Then is_active says which way.
  //
  //   is_active true  - something started playing here, so the row is over and
  //                     Connect mode takes back over.
  //   is_active false - the session went to a different device. Reclaiming
  //                     there runs takeOverPlayback, which calls volumioStop
  //                     and grabs the device while core is already starting the
  //                     next row; MPD then opened a card we had not released
  //                     and failed with "Device or resource busy". End the row
  //                     instead, so the yield happens before core moves on.
  const context = (msg && msg.context && msg.context.uri) || '';
  if (
    context &&
    this.queueUri &&
    context !== this.queueUri &&
    incomingUri &&
    incomingUri !== this.queueUri
  ) {
    if (msg.is_active === false) {
      this.endQueueRow('session moved to ' + context);
      return true;
    }
    this.leaveQueueMode('context is ' + context, true);
    return false;
  }

  if (!incomingUri) return false;

  if (incomingUri !== this.queueUri) {
    this.endQueueRow('rolled to ' + incomingUri);
    return true;
  }

  // Our row is producing audio here, so it started.
  if (msg.status === 'playing') this.clearQueueStartTimer();

  // Idle after the row has started is the gap after our URI. Idle before
  // first audio is leftover and must not skip the row.
  if (msg.status === 'idle' && !this.queueStartTimer) {
    this.endQueueRow('idle');
    return true;
  }

  const durationMs = this.itemMeta(msg.item).durationMs;
  const positionMs = Number(
    msg.position && msg.position.position_ms != null
      ? msg.position.position_ms
      : NaN
  );
  if (
    msg.status === 'buffering' &&
    durationMs > 0 &&
    Number.isFinite(positionMs) &&
    durationMs - positionMs <= QUEUE_END_WINDOW_MS
  ) {
    this.endQueueRow('end at ' + positionMs + ' of ' + durationMs);
    return true;
  }
  return false;
};

// Metadata for a queue row.
//
// There is no Spotify Web API here, so a playlist row can only show what
// Soloist has already told us about that URI. Anything unseen plays correctly
// and names itself the moment track_changed arrives.
SoloistConnect.prototype.cacheItem = function (item) {
  const uri = (item && item.uri) || '';
  if (uri.indexOf('spotify:track:') !== 0) return;
  const meta = this.itemMeta(item);
  if (!meta.title) return;
  if (this.trackCache.has(uri)) this.trackCache.delete(uri);
  this.trackCache.set(uri, meta);
  while (this.trackCache.size > TRACK_CACHE_MAX) {
    const oldest = this.trackCache.keys().next().value;
    this.trackCache.delete(oldest);
  }
};

SoloistConnect.prototype.explodeUri = function (uri) {
  const raw = typeof uri === 'string' ? uri : (uri && uri.uri) || '';
  if (raw.indexOf('spotify:track:') !== 0) {
    this.logger.error(
      'SoloistConnect: only spotify:track: URIs can be queued, got ' + raw
    );
    return libQ.resolve([]);
  }
  const meta = this.trackCache.get(raw);
  return libQ.resolve([
    {
      uri: raw,
      service: this.servicename,
      type: 'song',
      trackType: 'spotify',
      name: (meta && meta.title) || 'Spotify track',
      title: (meta && meta.title) || 'Spotify track',
      artist: (meta && meta.artist) || '',
      album: (meta && meta.album) || '',
      albumart: (meta && meta.albumart) || '/albumart',
      duration: meta ? Math.round(meta.durationMs / 1000) : 0,
    },
  ]);
};

// ---------------------------------------------------------------------------
// Convert a Volumio playlist saved by the stock Spotify plugin
// ---------------------------------------------------------------------------
//
// Playback only accepts service soloist_connect. Lists saved under spop are
// left alone at play time. This rewrite changes that field on track rows
// and nothing else. Album/playlist/artist URIs stay spop: explodeUri would
// skip them if we relabelled them.

SoloistConnect.prototype.isConvertiblePlaylistRow = function (row) {
  return !!(
    row &&
    row.service === 'spop' &&
    typeof row.uri === 'string' &&
    row.uri.indexOf('spotify:track:') === 0
  );
};

SoloistConnect.prototype.convertPlaylistRows = function (rows) {
  const list = Array.isArray(rows) ? rows : [];
  let converted = 0;
  let skipped = 0;
  const out = list.map((row) => {
    if (!this.isConvertiblePlaylistRow(row)) {
      skipped++;
      return row;
    }
    converted++;
    const copy = Object.assign({}, row);
    copy.service = this.servicename;
    return copy;
  });
  return { rows: out, converted, skipped, total: list.length };
};

SoloistConnect.prototype.playlistNameAllowed = function (name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.indexOf('/') !== -1) return false;
  if (trimmed.indexOf('\\') !== -1) return false;
  if (trimmed.indexOf('..') !== -1) return false;
  return true;
};

SoloistConnect.prototype.playlistCloneName = function (source, requested) {
  const custom = typeof requested === 'string' ? requested.trim() : '';
  if (custom) return custom;
  return source + ' (Soloist)';
};

SoloistConnect.prototype.postedPlaylistName = function (raw) {
  if (raw && typeof raw === 'object') return String(raw.value || '').trim();
  return String(raw == null ? '' : raw).trim();
};

SoloistConnect.prototype.playlistManager = function () {
  return this.commandRouter && this.commandRouter.playListManager;
};

SoloistConnect.prototype.listConvertiblePlaylists = function () {
  const self = this;
  const pm = this.playlistManager();
  if (!pm || typeof pm.listPlaylist !== 'function') return libQ.resolve([]);
  return libQ.resolve(pm.listPlaylist())
    .then((names) => {
      const list = Array.isArray(names) ? names : [];
      let chain = libQ.resolve([]);
      list.forEach((name) => {
        chain = chain.then((opts) => {
          if (!self.playlistNameAllowed(name)) return opts;
          if (typeof pm.getPlaylistContent !== 'function') return opts;
          return libQ.resolve(pm.getPlaylistContent(name))
            .then((rows) => {
              const n = self.convertPlaylistRows(rows).converted;
              if (n) {
                opts.push({
                  value: name,
                  label: name + ' (' + n + ' Spotify row' + (n === 1 ? '' : 's') + ')',
                });
              }
              return opts;
            })
            .fail(() => opts);
        });
      });
      return chain;
    })
    .fail(() => []);
};

SoloistConnect.prototype.playlistExists = function (name) {
  const pm = this.playlistManager();
  if (!pm || typeof pm.listPlaylist !== 'function') return libQ.resolve(false);
  return libQ.resolve(pm.listPlaylist())
    .then((names) => Array.isArray(names) && names.indexOf(name) !== -1)
    .fail(() => false);
};

SoloistConnect.prototype.writeConvertedPlaylist = function (dest, result) {
  const self = this;
  const pm = this.playlistManager();
  if (!pm || typeof pm.saveJSONFile !== 'function') {
    return libQ.reject(new Error('Playlist manager cannot save'));
  }
  const folder = pm.playlistFolder || '/data/playlist/';
  return libQ.resolve(pm.saveJSONFile(folder, dest, result.rows)).then(() => {
    const playHint = self.queuePlaybackEnabled()
      ? ''
      : ' Turn on Play Spotify tracks from the Volumio queue to play them.';
    self.commandRouter.pushToastMessage(
      'success',
      'Spotify Soloist',
      'Converted ' + result.converted + ' of ' + result.total +
        ' rows into "' + dest + '".' + playHint
    );
  });
};

SoloistConnect.prototype.convertPlaylist = function (data) {
  const self = this;
  const pm = this.playlistManager();
  if (!pm || typeof pm.getPlaylistContent !== 'function') {
    this.commandRouter.pushToastMessage(
      'error', 'Spotify Soloist', 'Playlist manager is not available.'
    );
    return libQ.resolve();
  }

  const source = this.postedPlaylistName(data && data.convert_playlist);
  const overwrite = !!(data && data.convert_overwrite);
  if (!this.playlistNameAllowed(source)) {
    this.commandRouter.pushToastMessage(
      'error',
      'Spotify Soloist',
      'Select a playlist that still has Spotify Connect track rows.'
    );
    return libQ.resolve();
  }

  const dest = overwrite
    ? source
    : this.playlistCloneName(source, data && data.convert_name);
  if (!this.playlistNameAllowed(dest)) {
    this.commandRouter.pushToastMessage(
      'error',
      'Spotify Soloist',
      'New playlist name cannot contain / \\ or ..'
    );
    return libQ.resolve();
  }

  return libQ.resolve(pm.getPlaylistContent(source))
    .then((rows) => {
      const result = self.convertPlaylistRows(rows);
      if (!result.converted) {
        self.commandRouter.pushToastMessage(
          'error',
          'Spotify Soloist',
          'That playlist has no Spotify Connect track rows to convert.'
        );
        return libQ.resolve();
      }
      if (overwrite) return self.writeConvertedPlaylist(dest, result);
      return self.playlistExists(dest).then((exists) => {
        if (exists) {
          self.commandRouter.pushToastMessage(
            'error',
            'Spotify Soloist',
            'Playlist "' + dest + '" already exists.'
          );
          return libQ.resolve();
        }
        return self.writeConvertedPlaylist(dest, result);
      });
    })
    .fail((e) => {
      self.logger.error('SoloistConnect: playlist convert failed: ' + e);
      self.commandRouter.pushToastMessage(
        'error', 'Spotify Soloist', 'Could not convert that playlist.'
      );
      return libQ.resolve();
    });
};

// ---------------------------------------------------------------------------
// Spotify queue browse tile
// ---------------------------------------------------------------------------
//
// Spotify's play queue, not Volumio's. get_queue / queue_changed report
// previous (most recent first) and upcoming. The current track is
// playback_state.item, which we already keep on this.state. Opening the tile
// asks get_queue when a session and a socket exist; a missed reply falls
// back to the last event. Tapping a track is explodeUri, the path a mixed
// list already uses. The tile is not registered when queue playback is
// off: those songs would skip, which is what stopped playback on Integro.

SoloistConnect.prototype.addToBrowseSources = function () {
  if (!this.queuePlaybackEnabled()) return;
  if (typeof this.commandRouter.volumioAddToBrowseSources !== 'function') return;
  try {
    this.commandRouter.volumioAddToBrowseSources({
      name: BROWSE_NAME,
      uri: BROWSE_URI,
      plugin_type: 'music_service',
      plugin_name: this.servicename,
      albumart: BROWSE_ALBUMART,
    });
  } catch (e) {
    this.logger.warn('SoloistConnect: could not add browse source: ' + e.message);
  }
};

SoloistConnect.prototype.removeFromBrowseSources = function () {
  this.browseWatching = false;
  this.clearBrowseRefreshTimer();
  if (typeof this.commandRouter.volumioRemoveToBrowseSources !== 'function') return;
  try {
    this.commandRouter.volumioRemoveToBrowseSources(BROWSE_NAME);
  } catch (e) {
    this.logger.warn('SoloistConnect: could not remove browse source: ' + e.message);
  }
};

// Show the tile only when a tap can play. The setting is read here, not
// only at start, so a Volumio-queue save adds or removes it without a
// daemon restart.
SoloistConnect.prototype.syncBrowseSource = function () {
  if (this.queuePlaybackEnabled() && this.wsIsOpen()) {
    this.addToBrowseSources();
    return;
  }
  this.removeFromBrowseSources();
};

SoloistConnect.prototype.rememberQueue = function (msg) {
  this.spotifyQueue = {
    previous: Array.isArray(msg && msg.previous) ? msg.previous : [],
    upcoming: Array.isArray(msg && msg.upcoming) ? msg.upcoming : [],
  };
  this.resolveQueueWaiters(this.spotifyQueue);
};

SoloistConnect.prototype.resolveQueueWaiters = function (queue) {
  const waiters = this.queueWaiters;
  this.queueWaiters = [];
  const snapshot = queue || { previous: [], upcoming: [] };
  for (const waiter of waiters) {
    try {
      waiter(snapshot);
    } catch (e) {
      this.logger.warn('SoloistConnect: queue waiter failed: ' + e.message);
    }
  }
};

SoloistConnect.prototype.wsIsOpen = function () {
  return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
};

SoloistConnect.prototype.fetchSpotifyQueue = function () {
  const defer = libQ.defer();
  const snapshot = this.spotifyQueue || { previous: [], upcoming: [] };
  // Official: get_queue needs a stored session, not is_active. Do not send
  // it without one; the reply is an error, not an empty list.
  if (!this.loggedIn || !this.wsIsOpen()) {
    defer.resolve(snapshot);
    return defer.promise;
  }

  const self = this;
  const waitMs = this.queueFetchMs();
  const timer = setTimeout(function () {
    const i = self.queueWaiters.indexOf(onQueue);
    if (i !== -1) self.queueWaiters.splice(i, 1);
    defer.resolve(self.spotifyQueue || snapshot);
  }, waitMs);
  const onQueue = function (queue) {
    clearTimeout(timer);
    defer.resolve(queue);
  };
  this.queueWaiters.push(onQueue);
  this.sendCommand({ command: 'get_queue', limit: 0 });
  return defer.promise;
};

SoloistConnect.prototype.browsePage = function (lists) {
  return {
    navigation: {
      prev: { uri: '/' },
      lists: lists || [],
    },
  };
};

SoloistConnect.prototype.browseInfo = function (title, artist) {
  return this.browsePage([
    {
      title: BROWSE_NAME,
      icon: 'fa fa-spotify',
      availableListViews: ['list'],
      items: [
        {
          service: this.servicename,
          type: 'item-no-menu',
          title: title,
          artist: artist || '',
          icon: 'fa fa-info-circle',
          uri: BROWSE_URI,
        },
      ],
    },
  ]);
};

SoloistConnect.prototype.browseList = function (title, items) {
  if (!items || !items.length) return null;
  return {
    title: title,
    icon: 'fa fa-spotify',
    availableListViews: ['list'],
    items: items,
  };
};

SoloistConnect.prototype.browseItemFromEntity = function (item) {
  const meta = this.itemMeta(item);
  if (!meta.uri) return null;
  const isTrack = meta.uri.indexOf('spotify:track:') === 0;
  return {
    service: this.servicename,
    type: isTrack ? 'song' : 'item-no-menu',
    title: meta.title || (isTrack ? 'Spotify track' : 'Spotify item'),
    artist: meta.artist || '',
    album: meta.album || '',
    albumart: meta.albumart || '/albumart',
    uri: meta.uri,
    duration: meta.durationMs ? Math.round(meta.durationMs / 1000) : 0,
  };
};

SoloistConnect.prototype.browseNowPlaying = function () {
  const uri = (this.state && this.state.uri) || '';
  if (!uri) return null;
  const isTrack = uri.indexOf('spotify:track:') === 0;
  return {
    service: this.servicename,
    type: isTrack ? 'song' : 'item-no-menu',
    title: this.state.title || (isTrack ? 'Spotify track' : 'Spotify item'),
    artist: this.state.artist || '',
    album: this.state.album || '',
    albumart: this.state.albumart || '/albumart',
    uri: uri,
    duration: this.state.duration || 0,
  };
};

SoloistConnect.prototype.browseSongsFromRows = function (rows, skipUri) {
  const items = [];
  if (!Array.isArray(rows)) return items;
  for (const row of rows) {
    if (!row || !row.item) continue;
    const uri = this.itemUri(row.item);
    if (!uri || uri === skipUri || uri.indexOf('spotify:track:') !== 0) continue;
    const song = this.browseItemFromEntity(row.item);
    if (song) items.push(song);
  }
  return items;
};

SoloistConnect.prototype.buildQueueBrowse = function (queue) {
  if (!this.loggedIn) {
    return this.browseInfo(
      'Not signed in',
      'Pair this speaker from the Spotify app first'
    );
  }

  const q = queue || this.spotifyQueue || { previous: [], upcoming: [] };
  const now = this.browseNowPlaying();
  const skip = now ? now.uri : '';
  const playNext = [];
  const upNext = [];
  const autoplay = [];
  const upcoming = Array.isArray(q.upcoming) ? q.upcoming : [];
  for (const row of upcoming) {
    if (!row || !row.item) continue;
    const uri = this.itemUri(row.item);
    if (!uri || uri === skip || uri.indexOf('spotify:track:') !== 0) continue;
    const song = this.browseItemFromEntity(row.item);
    if (!song) continue;
    if (row.source === 'autoplay') autoplay.push(song);
    else if (row.source === 'queue') playNext.push(song);
    else upNext.push(song);
  }

  const lists = [];
  const add = (title, items) => {
    const list = this.browseList(title, items);
    if (list) lists.push(list);
  };
  add('Now playing', now ? [now] : []);
  add('Play next', playNext);
  add('Up next', upNext);
  add('Autoplay', autoplay);
  add('Recently played', this.browseSongsFromRows(q.previous, skip));

  if (!lists.length) {
    return this.browseInfo(
      'Nothing in the Spotify queue',
      this.wsIsOpen() ? 'Play something on this speaker' : 'Waiting for Soloist'
    );
  }
  return this.browsePage(lists);
};

SoloistConnect.prototype.isBrowseUri = function (uri) {
  return uri === BROWSE_URI || uri.indexOf(BROWSE_URI + '/') === 0;
};

SoloistConnect.prototype.clearBrowseRefreshTimer = function () {
  if (this.browseRefreshTimer) {
    clearTimeout(this.browseRefreshTimer);
    this.browseRefreshTimer = null;
  }
};

// Rebuild the open tile. Volumio browse is request/response; this is the
// only way an open page sees queue_changed. Sections stay split.
SoloistConnect.prototype.pushQueueBrowse = function (queue) {
  if (!this.browseWatching || !this.queuePlaybackEnabled()) return;
  if (typeof this.commandRouter.broadcastMessage !== 'function') return;
  try {
    this.commandRouter.broadcastMessage(
      'pushBrowseLibrary',
      this.buildQueueBrowse(queue || this.spotifyQueue)
    );
  } catch (e) {
    this.logger.warn('SoloistConnect: could not refresh browse: ' + e.message);
  }
};

// Unsolicited queue_changed is capped at 10. Ask for the full list, and
// collapse a track_changed + queue_changed pair into one get_queue.
SoloistConnect.prototype.scheduleBrowseRefresh = function () {
  if (!this.browseWatching || !this.queuePlaybackEnabled()) return;
  if (this.browseRefreshInFlight) {
    this.browseRefreshDirty = true;
    return;
  }
  if (this.browseRefreshTimer) return;
  const self = this;
  this.browseRefreshTimer = setTimeout(function () {
    self.browseRefreshTimer = null;
    self.refreshQueueBrowse();
  }, 50);
};

SoloistConnect.prototype.refreshQueueBrowse = function () {
  if (!this.browseWatching || !this.queuePlaybackEnabled()) return;
  if (this.browseRefreshInFlight) {
    this.browseRefreshDirty = true;
    return;
  }
  if (!this.loggedIn || !this.wsIsOpen()) {
    this.pushQueueBrowse();
    return;
  }
  this.browseRefreshInFlight = true;
  this.browseRefreshDirty = false;
  const self = this;
  this.fetchSpotifyQueue()
    .then(function (queue) {
      self.browseRefreshInFlight = false;
      self.pushQueueBrowse(queue);
      if (self.browseRefreshDirty) self.scheduleBrowseRefresh();
    })
    .fail(function () {
      self.browseRefreshInFlight = false;
      self.pushQueueBrowse();
      if (self.browseRefreshDirty) self.scheduleBrowseRefresh();
    });
};

SoloistConnect.prototype.handleBrowseUri = function (curUri) {
  const defer = libQ.defer();
  const self = this;
  const uri = typeof curUri === 'string' ? curUri : '';
  if (!this.queuePlaybackEnabled() || !this.isBrowseUri(uri)) {
    this.browseWatching = false;
    this.clearBrowseRefreshTimer();
    defer.resolve(this.browsePage([]));
    return defer.promise;
  }

  this.browseWatching = true;
  this.fetchSpotifyQueue()
    .then(function (queue) {
      defer.resolve(self.buildQueueBrowse(queue));
    })
    .fail(function (e) {
      self.logger.error('SoloistConnect: browse failed: ' + e);
      defer.resolve(self.buildQueueBrowse(self.spotifyQueue));
    });
  return defer.promise;
};

// Music-service plugins are asked on every search. There is no catalog.
SoloistConnect.prototype.search = function () {
  return libQ.resolve();
};

SoloistConnect.prototype.clearAddPlayTrack = function (track) {
  const uri = (track && track.uri) || '';
  const index = this.currentQueueIndex();
  if (uri.indexOf('spotify:track:') !== 0) {
    this.skipQueueRow(uri, 'not a Spotify track URI');
    return libQ.resolve();
  }
  if (!this.queuePlaybackEnabled()) {
    this.skipQueueRow(uri, 'queue playback is off in the plugin settings');
    return libQ.resolve();
  }
  if (!this.loggedIn) {
    this.skipQueueRow(uri, 'no stored Spotify session');
    return libQ.resolve();
  }
  // Decide before sending, not after.
  //
  // `play` is routed to whichever device holds the Connect session, so issuing
  // one while the session is elsewhere starts audio on someone else's speaker.
  // Skipping the row afterwards does not undo that: the pause in endQueueRow is
  // a request against a session we do not own, and the observed result was the
  // track playing on the other device anyway. The deadline below stays as the
  // backstop for losing the session between here and the first audio.
  if (!this.deviceActive && !this.remoteQueuePlayback()) {
    this.skipQueueRow(uri, 'another device holds the Spotify session');
    return libQ.resolve();
  }

  this.leaveVolatileForQueue();
  this.queueMode = true;
  this.queueUri = uri;
  this.queueIndex = index;

  this.clearPendingSeek();
  this.clearQualityRetry();
  this.resetQuality();
  this.state = this.emptyState();
  this.publishedState = null;
  this.positionAnchor = { position_ms: 0, timestamp_ms: Date.now(), speed: 0 };
  const meta = this.trackCache.get(uri);
  this.state.uri = uri;
  if (meta) {
    this.state.title = meta.title;
    this.state.artist = meta.artist;
    this.state.album = meta.album;
    this.state.albumart = meta.albumart;
    this.state.duration = Math.round(meta.durationMs / 1000);
  }

  // The previous row's service has already been stopped by core. Make sure the
  // shim is not still being told to let go before we ask for audio.
  this.pendingYieldAt = 0;
  this.clearAlsaYield();
  this.logger.info(
    'SoloistConnect: queue row play ' + uri + ' at position ' + index
  );
  this.sendCommand({ command: 'play', uri: uri });

  // Nothing in the protocol reports "that play went to a different device".
  // A play issued while another device holds the session is accepted and then
  // simply never produces local playback, and no event says so. Give the row a
  // deadline, bound to the row it was armed for, which also covers an expired
  // session, a track that will not play, and a dead network.
  this.clearQueueStartTimer();
  const deadline = this.queueStartTimeoutMs();
  this.queueStartTimer = setTimeout(() => {
    this.queueStartTimer = null;
    if (!this.queueRowIsCurrent(uri, index)) {
      this.logVerbose(
        'start deadline for ' + uri + ' dropped: core has moved on'
      );
      return;
    }
    if (this.remoteQueuePlayback()) {
      this.logger.info(
        'SoloistConnect: queue row ' + uri + ' produced no local audio within ' +
        deadline + 'ms; remote playback is on, leaving it with the active ' +
        'Connect device'
      );
      this.leaveQueueMode('remote playback, no local audio', false);
      return;
    }
    this.logger.info(
      'SoloistConnect: queue row ' + uri + ' did not start within ' +
      deadline + 'ms, skipping'
    );
    this.endQueueRow('no playback within ' + deadline + 'ms');
  }, deadline);
  return libQ.resolve();
};

// ---------------------------------------------------------------------------
// Volumio playback controls -> Soloist commands
// ---------------------------------------------------------------------------

// Volumio emits a stop() echo shortly after volatile mode begins; setVolatile
// opens a two-second window for it. Outside that window a stop is real and is
// forwarded, which is what lets the user select another source.
//
// This used to read `if (this.ignoreStopEvent || this.active)`, so no stop ever
// reached Soloist while a Connect session existed and the device could not be
// released. ytcr's stop() has no suppression at all; the stock Spotify plugin
// suppresses only inside its own two-second window.
SoloistConnect.prototype.stop = function () {
  if (this.ignoreStopEvent) {
    this.logger.info('SoloistConnect: ignoring stop echo from volatile setup');
    return libQ.resolve();
  }
  this.leaveQueueMode('core stopped this service', false);
  this.clearPendingSeek();
  this.clearInactiveHold();
  this.clearQualityRetry();
  this.clearQueueStartTimer();
  this.logger.info('SoloistConnect: yielding playback');
  this.setMpdIgnoreUpdate(false);
  this.pendingYieldAt = Date.now();
  this.requestAlsaYield();
  this.pauseIfOurs();
  const self = this;
  return this.waitUntil(function () { return !this.alsaHeldByUs(); }, 2000)
    .then(function () {
      if (self.alsaHeldByUs()) {
        self.logger.error('SoloistConnect: ALSA still held after yield');
      }
    });
};

SoloistConnect.prototype.pause = function () {
  this.clearPendingSeek();
  this.logger.info('SoloistConnect: forwarding pause');
  this.sendCommand({ command: 'pause' });
  return libQ.resolve();
};

SoloistConnect.prototype.play = function () {
  this.pendingYieldAt = 0;
  this.sendCommand({ command: 'play' });
  return libQ.resolve();
};

SoloistConnect.prototype.resume = function () {
  this.pendingYieldAt = 0;
  this.sendCommand({ command: 'play' });
  return libQ.resolve();
};

SoloistConnect.prototype.next = function () {
  this.clearPendingSeek();
  this.clearQualityRetry();
  this.logVerbose('next fired');
  this.sendCommand({ command: 'skip_next' });
  return libQ.resolve();
};

SoloistConnect.prototype.previous = function () {
  this.clearPendingSeek();
  this.clearQualityRetry();
  this.logVerbose('prev fired');
  this.sendCommand({ command: 'skip_prev' });
  return libQ.resolve();
};

SoloistConnect.prototype.seek = function (positionMs) {
  const ms = Math.round(Number(positionMs));
  if (!Number.isFinite(ms) || ms < 0) return libQ.resolve();
  this.pendingSeekMs = ms;
  if (this.seekCommandTimer) clearTimeout(this.seekCommandTimer);
  const send = () => {
    this.seekCommandTimer = null;
    const pos = this.pendingSeekMs;
    this.pendingSeekMs = null;
    if (pos == null || !this.owningPlayback()) return;
    this.logVerbose('seek ' + pos + 'ms');
    this.sendCommand({ command: 'seek', position_ms: pos });
  };
  const delay = this.seekCoalesceMs();
  if (delay <= 0) {
    send();
    return libQ.resolve();
  }
  this.seekCommandTimer = setTimeout(send, delay);
  return libQ.resolve();
};

SoloistConnect.prototype.random = function (value) {
  this.sendCommand({ command: 'set_shuffle', enabled: !!value });
  return libQ.resolve();
};

SoloistConnect.prototype.repeat = function (value, repeatSingle) {
  // Coordinate both repeat commands per the Soloist WebSocket API reference
  if (repeatSingle) {
    this.sendCommand({ command: 'set_repeat_context', enabled: false });
    this.sendCommand({ command: 'set_repeat_track', enabled: true });
  } else if (value) {
    this.sendCommand({ command: 'set_repeat_track', enabled: false });
    this.sendCommand({ command: 'set_repeat_context', enabled: true });
  } else {
    this.sendCommand({ command: 'set_repeat_track', enabled: false });
    this.sendCommand({ command: 'set_repeat_context', enabled: false });
  }
  return libQ.resolve();
};

// A snapshot, not the live object. Volumio's state machine stores what it is
// given by reference, so returning this.state would let core observe our
// mutations mid-publication.
SoloistConnect.prototype.getState = function () {
  this.state.seek = this.currentSeekMs();
  return this.stateSnapshot();
};

// SoftMaster / hardware mixer is the attenuator. Pulse sink-input volume
// is Connect protocol only (same as spop external_volume). Mixer type None
// has no ALSA gain, so the shim must keep scaling.
SoloistConnect.prototype.mixerIsExternal = function () {
  try {
    const t = this.commandRouter.executeOnPlugin(
      'audio_interface',
      'alsa_controller',
      'getConfigParam',
      'mixer_type'
    );
    return !!(t && t !== 'None');
  } catch (e) {
    return true;
  }
};

SoloistConnect.prototype.clearVolumeFromSoloist = function () {
  this.volumeFromSoloist = false;
  if (this.volumeFromSoloistTimer) {
    clearTimeout(this.volumeFromSoloistTimer);
    this.volumeFromSoloistTimer = null;
  }
};

SoloistConnect.prototype.commitMixerVolume = function (rounded) {
  this.volumeFromSoloist = true;
  if (this.volumeFromSoloistTimer) clearTimeout(this.volumeFromSoloistTimer);
  this.volumeFromSoloistTimer = setTimeout(() => {
    this.volumeFromSoloist = false;
    this.volumeFromSoloistTimer = null;
  }, 1500);
  this.commandRouter.volumiosetvolume(rounded);
};

SoloistConnect.prototype.flushPendingMixerVolume = function () {
  if (this.pendingMixerVolume == null) return;
  if (this.alignVolumeEnabled() && (!this.volumeAligned || this.volumeAlignPending)) {
    return;
  }
  if (!this.mixerIsExternal() || !this.active || !this.owningPlayback()) return;
  const rounded = this.pendingMixerVolume;
  this.pendingMixerVolume = null;
  this.commitMixerVolume(rounded);
};

SoloistConnect.prototype.alignVolumeEnabled = function () {
  return this.config.get('align_volume') === true;
};

// --initial-volume is unused on the mixer when align is on. Seed the daemon
// from the knob so the first Connect report is already close.
SoloistConnect.prototype.initialVolumeForDaemon = function () {
  if (!this.alignVolumeEnabled()) return this.config.get('initial_volume');
  const v = this.volumioVolumeForAlign();
  return v == null ? this.config.get('initial_volume') : v;
};

SoloistConnect.prototype.volumioVolumeForAlign = function () {
  if (!this.mixerIsExternal()) return null;
  let state;
  try {
    state = this.commandRouter.volumioGetState();
  } catch (e) {
    return null;
  }
  if (!state || state.disableVolumeControl === true) return null;
  if (state.mute === true) return 0;
  if (typeof state.volume !== 'number' || isNaN(state.volume)) return null;
  return Math.max(0, Math.min(100, Math.round(state.volume)));
};

SoloistConnect.prototype.resetVolumeAlign = function () {
  this.volumeAligned = false;
  this.volumeAlignPending = false;
  if (this.volumeAlignTimer) {
    clearTimeout(this.volumeAlignTimer);
    this.volumeAlignTimer = null;
  }
};

// Stock Spotify copies the Volumio knob onto the daemon when this speaker
// becomes the active Connect device. Without that, --initial-volume (50)
// arrives as volume_changed and yanks the mixer.
SoloistConnect.prototype.alignToVolumioVolume = function () {
  if (!this.alignVolumeEnabled()) return;
  if (!this.deviceActive && !this.active) return;
  if (this.volumeAligned) return;

  const v = this.volumioVolumeForAlign();
  this.volumeAligned = true;
  if (v == null) {
    this.volumeAlignPending = false;
    return;
  }

  this.volumeAlignPending = true;
  this.lastSentVolume = v;
  this.state.volume = v;
  this.pendingMixerVolume = null;
  this.logger.info('SoloistConnect: align volume to Volumio ' + v);
  this.sendCommand({ command: 'set_volume', volume: v });
  if (this.volumeAlignTimer) clearTimeout(this.volumeAlignTimer);
  this.volumeAlignTimer = setTimeout(() => {
    this.volumeAlignTimer = null;
    this.volumeAlignPending = false;
  }, 2000);
};

SoloistConnect.prototype.applySoloistVolume = function (vol) {
  if (typeof vol !== 'number' || isNaN(vol)) return;
  const rounded = Math.round(vol);
  if (this.alignVolumeEnabled() && !this.volumeAligned) return;
  if (this.alignVolumeEnabled() && this.volumeAlignPending) {
    if (Math.abs(rounded - this.lastSentVolume) < 2) {
      this.volumeAlignPending = false;
      if (this.volumeAlignTimer) {
        clearTimeout(this.volumeAlignTimer);
        this.volumeAlignTimer = null;
      }
      this.lastSentVolume = rounded;
      this.state.volume = rounded;
    }
    return;
  }
  this.state.volume = rounded;

  if (Math.abs(rounded - this.lastSentVolume) < 2) {
    this.lastSentVolume = rounded;
    return;
  }
  this.lastSentVolume = rounded;

  // Connect-only: no mixer to move, Pulse remains the gain.
  if (!this.mixerIsExternal()) return;

  // SoftMaster/HW must not be written while MPD still owns the PCM.
  // playback_state on first claim runs takeOverPlayback (async volumioStop)
  // then used to call volumiosetvolume in the same tick. That amixer on a
  // foreign softvolume is the update-check / leftover-local path.
  if (!this.active || !this.owningPlayback()) {
    this.pendingMixerVolume = rounded;
    return;
  }
  this.commitMixerVolume(rounded);
};

// Mirror the knob to Connect so the Spotify app slider matches. Collapse
// bursts — do not queue a set_volume per tick in front of skip/pause
// (Soloist handles commands serially; that queue was seconds of lag).
SoloistConnect.prototype.onVolumioVolume = function (data) {
  if (!this.active) return;
  if (data && data.disableVolumeControl) return;
  const vol = data && typeof data.vol === 'number' ? data.vol : data;
  if (typeof vol !== 'number' || isNaN(vol)) return;
  const rounded = Math.round(vol);
  if (this.volumeFromSoloist) {
    this.lastSentVolume = rounded;
    this.clearVolumeFromSoloist();
    return;
  }
  if (Math.abs(rounded - this.lastSentVolume) < 2) return;
  if (this.volumeTimer) clearTimeout(this.volumeTimer);
  this.volumeTimer = setTimeout(() => {
    this.volumeTimer = null;
    this.lastSentVolume = rounded;
    this.sendCommand({ command: 'set_volume', volume: rounded });
  }, 80);
};

SoloistConnect.prototype.volume = function (data) {
  this.onVolumioVolume(data);
  return libQ.resolve();
};

// ---------------------------------------------------------------------------
// UI configuration
// ---------------------------------------------------------------------------

// Peppy and Now Playing do this after a backup write: rebuild the page and
// push it to the open settings tab so the restore list updates without leaving.
SoloistConnect.prototype.updateUIConfig = function () {
  const self = this;
  if (typeof this.commandRouter.getUIConfigOnPlugin !== 'function') {
    return libQ.resolve();
  }
  return this.commandRouter
    .getUIConfigOnPlugin('music_service', 'soloist_connect', {})
    .then((uiconf) => {
      self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
    })
    .fail((e) => {
      self.logger.error('SoloistConnect: pushUiConfig failed: ' + e);
      return libQ.resolve();
    });
};

SoloistConnect.prototype.getUIConfig = function () {
  const defer = libQ.defer();
  const self = this;
  const langCode = this.commandRouter.sharedVars.get('language_code');

  this.commandRouter
    .i18nJson(
      path.join(__dirname, 'i18n', `strings_${langCode}.json`),
      path.join(__dirname, 'i18n', 'strings_en.json'),
      path.join(__dirname, 'UIConfig.json')
    )
    .then((uiconf) => {
      // Look up by id across every section. A field that moves to another
      // section must not depend on sections[0] or on list position.
      const findEl = (id) => {
        const sections = uiconf.sections || [];
        for (let i = 0; i < sections.length; i++) {
          const el = (sections[i].content || []).find((c) => c.id === id);
          if (el) return el;
        }
        return null;
      };
      const set = (id, value) => {
        const el = findEl(id);
        if (el) el.value = value;
      };

      // A select is not an input: it needs {value,label}, and the label must
      // match one of its own options or the dropdown renders blank. Assigning
      // the bare string did exactly that. Take the label from the option list
      // i18nJson has already translated, so it cannot drift from the strings
      // file, and fall back to a known-good option when the stored value is
      // missing or no longer offered.
      const setSelect = (id, value, fallback) => {
        const el = findEl(id);
        if (!el) return;
        const opts = el.options || [];
        const match =
          opts.find((o) => o.value === value) || opts.find((o) => o.value === fallback);
        if (match) el.value = { value: match.value, label: match.label };
      };

      set('api_key', self.config.get('api_key') || '');
      set('retain_api_key', self.config.get('retain_api_key') === true);
      set('device_name', self.config.get('device_name') || 'Volumio');
      set('initial_volume', self.config.get('initial_volume'));
      set('align_volume', self.config.get('align_volume') === true);
      set('cache_size_mb', self.config.get('cache_size_mb'));
      setSelect('cache_location', self.config.get('cache_location'), 'disk');
      set('buffer_ms', self.config.get('buffer_ms'));
      set('seek_coalesce_ms', self.seekCoalesceMs());
      set('inactive_hold_ms', self.inactiveHoldMs());
      set('quality_retry_ms', self.qualityRetryMs());
      set('quality_retry_max', self.qualityRetryMax());
      set('queue_fetch_ms', self.queueFetchMs());
      set('output_trim_db', self.config.get('output_trim_db'));
      set('loudness_normalization', self.config.get('loudness_normalization') !== false);
      set('crossfade', self.config.get('crossfade') === true);
      set('crossfade_ms', self.config.get('crossfade_ms'));
      set('queue_playback', self.config.get('queue_playback') === true);
      set('queue_remote_playback', self.config.get('queue_remote_playback') === true);
      set('verbose_logging', self.config.get('verbose_logging') === true);
      set('auto_update_binary', self.config.get('auto_update_binary') === true);
      set('convert_overwrite', false);
      set('convert_name', '');
      return self.listConvertiblePlaylists()
        .then((options) => {
          const el = findEl('convert_playlist');
          if (el) {
            const none = (el.options && el.options[0]) || {
              value: '',
              label: 'No Spotify Connect playlists found',
            };
            el.options = options.length ? options : [none];
            el.value = options.length
              ? { value: options[0].value, label: options[0].label }
              : { value: none.value, label: none.label };
          }
          const backupNone = {
            value: '',
            label: 'No settings backups yet',
          };
          const backups = self.listSettingsBackups();
          ['selected_backup', 'selected_backup_delete'].forEach((id) => {
            const backupEl = findEl(id);
            if (!backupEl) return;
            const none = (backupEl.options && backupEl.options[0]) || backupNone;
            backupEl.options = backups.length ? backups : [none];
            backupEl.value = backups.length
              ? { value: backups[0].value, label: backups[0].label }
              : { value: none.value, label: none.label };
          });
          self.warnIfSpopStarted();
          defer.resolve(uiconf);
        })
        .fail((e) => defer.reject(new Error('Failed loading UIConfig: ' + e)));
    })
    .fail((e) => defer.reject(new Error('Failed loading UIConfig: ' + e)));

  return defer.promise;
};

// Validate before writing. v-conf enforces the type declared in config.json and
// throws on a non-numeric value, so a cleared number field must be rejected here
// with a message rather than reaching the config store. Returning early leaves
// the stored settings untouched and the daemon running on the last good values.
// A section save only posts that section's fields. Absent means keep stored.
SoloistConnect.prototype.postedOrStoredBool = function (data, key, stored) {
  if (data[key] === undefined) return !!stored;
  return !!data[key];
};

SoloistConnect.prototype.postedOrStoredInt = function (data, key, fallback, check) {
  if (data[key] === undefined || data[key] === null || data[key] === '') {
    const stored = parseInt(this.config.get(key), 10);
    return {
      ok: true,
      value: Number.isFinite(stored) ? stored : fallback,
    };
  }
  const n = parseInt(data[key], 10);
  if (!Number.isFinite(n) || !check(n)) return { ok: false };
  return { ok: true, value: n };
};

SoloistConnect.prototype.validateSettings = function (data) {
  const initialVolume = this.postedOrStoredInt(
    data, 'initial_volume', 50, (n) => n >= 0 && n <= 100
  );
  if (!initialVolume.ok) {
    return { ok: false, message: 'Initial volume must be a number between 0 and 100.' };
  }

  const cacheSize = this.postedOrStoredInt(
    data, 'cache_size_mb', 1024, (n) => n === 0 || n >= 100
  );
  if (!cacheSize.ok) {
    return { ok: false, message: 'Cache size must be 0 (no limit) or at least 100 MB.' };
  }

  // Pulse tlength, the software target Soloist paces against. The ALSA
  // period is chosen independently in the shim. Below 100ms the software
  // buffer is too small for a loaded device; 2000ms is the uncapped
  // upstream default.
  const bufferMs = this.postedOrStoredInt(
    data, 'buffer_ms', 500, (n) => n >= 100 && n <= 2000
  );
  if (!bufferMs.ok) {
    return { ok: false, message: 'Output buffer must be between 100 and 2000 ms.' };
  }

  const outputTrimDb = this.postedOrStoredInt(
    data, 'output_trim_db', 0, (n) => n >= -12 && n <= 12
  );
  if (!outputTrimDb.ok) {
    return { ok: false, message: 'Output trim must be an integer between -12 and 12 dB.' };
  }

  const crossfadeMs = this.postedOrStoredInt(
    data, 'crossfade_ms', 2000, (n) => n >= 1000 && n <= 12000
  );
  if (!crossfadeMs.ok) {
    return { ok: false, message: 'Crossfade time must be between 1000 and 12000 ms.' };
  }

  // A UI select hands back either the bare value or {value,label}, depending on
  // how the field was rendered and whether it was touched. Take both.
  //
  // An absent or empty value keeps whatever is stored rather than failing the
  // save: a field the user never touched must not block the eight fields they
  // did. A present but unrecognised value is still an error.
  const rawLocation = data.cache_location;
  let cacheLocation =
    rawLocation && typeof rawLocation === 'object' ? rawLocation.value : rawLocation;
  if (cacheLocation === undefined || cacheLocation === null || cacheLocation === '') {
    cacheLocation = this.config.get('cache_location') || 'disk';
  }
  if (cacheLocation !== 'disk' && cacheLocation !== 'ram') {
    return { ok: false, message: 'Cache location must be Disk or RAM.' };
  }

  const seekCoalesce = this.parseOptionalMs(
    data.seek_coalesce_ms,
    'seek_coalesce_ms',
    SEEK_COALESCE_DEFAULT_MS,
    SEEK_COALESCE_MAX_MS
  );
  if (!seekCoalesce.ok) {
    return { ok: false, message: 'Seek coalesce must be between 0 and ' + SEEK_COALESCE_MAX_MS + ' ms.' };
  }

  const inactiveHold = this.parseOptionalMs(
    data.inactive_hold_ms,
    'inactive_hold_ms',
    INACTIVE_HOLD_DEFAULT_MS,
    INACTIVE_HOLD_MAX_MS
  );
  if (!inactiveHold.ok) {
    return { ok: false, message: 'Inactive hold must be between 0 and ' + INACTIVE_HOLD_MAX_MS + ' ms.' };
  }

  const qualityRetry = this.parseOptionalMs(
    data.quality_retry_ms,
    'quality_retry_ms',
    QUALITY_RETRY_DEFAULT_MS,
    QUALITY_RETRY_MAX_MS
  );
  if (!qualityRetry.ok) {
    return { ok: false, message: 'Quality retry wait must be between 0 and ' + QUALITY_RETRY_MAX_MS + ' ms.' };
  }

  const qualityRetryMax = this.parseOptionalMs(
    data.quality_retry_max,
    'quality_retry_max',
    QUALITY_RETRY_DEFAULT_COUNT,
    QUALITY_RETRY_MAX_COUNT
  );
  if (!qualityRetryMax.ok) {
    return { ok: false, message: 'Quality retries must be between 0 and ' + QUALITY_RETRY_MAX_COUNT + '.' };
  }

  const queueFetch = this.parseOptionalMs(
    data.queue_fetch_ms,
    'queue_fetch_ms',
    QUEUE_FETCH_DEFAULT_MS,
    QUEUE_FETCH_MAX_MS
  );
  if (!queueFetch.ok) {
    return { ok: false, message: 'Queue fetch wait must be between 0 and ' + QUEUE_FETCH_MAX_MS + ' ms.' };
  }

  return {
    ok: true,
    values: {
      api_key: data.api_key === undefined
        ? (this.config.get('api_key') || '')
        : (data.api_key || '').trim(),
      device_name: data.device_name === undefined
        ? (this.config.get('device_name') || 'Volumio')
        : ((data.device_name || '').trim() || 'Volumio'),
      initial_volume: initialVolume.value,
      align_volume: this.postedOrStoredBool(
        data, 'align_volume', this.config.get('align_volume')
      ),
      cache_size_mb: cacheSize.value,
      cache_location: cacheLocation,
      buffer_ms: bufferMs.value,
      seek_coalesce_ms: seekCoalesce.value,
      inactive_hold_ms: inactiveHold.value,
      quality_retry_ms: qualityRetry.value,
      quality_retry_max: qualityRetryMax.value,
      queue_fetch_ms: queueFetch.value,
      output_trim_db: outputTrimDb.value,
      loudness_normalization: this.postedOrStoredBool(
        data,
        'loudness_normalization',
        this.config.get('loudness_normalization') === undefined
          ? true
          : this.config.get('loudness_normalization')
      ),
      crossfade: this.postedOrStoredBool(
        data,
        'crossfade',
        this.config.get('crossfade') === undefined
          ? false
          : this.config.get('crossfade')
      ),
      crossfade_ms: crossfadeMs.value,
      retain_api_key: this.postedOrStoredBool(
        data, 'retain_api_key', this.config.get('retain_api_key')
      ),
      queue_playback: this.postedOrStoredBool(
        data, 'queue_playback', this.config.get('queue_playback')
      ),
      queue_remote_playback: this.postedOrStoredBool(
        data, 'queue_remote_playback', this.config.get('queue_remote_playback')
      ),
      verbose_logging: this.postedOrStoredBool(
        data, 'verbose_logging', this.config.get('verbose_logging')
      ),
      auto_update_binary: this.postedOrStoredBool(
        data, 'auto_update_binary', this.config.get('auto_update_binary')
      ),
    },
  };
};

// Absent or empty keeps the stored value so a field the UI did not post cannot
// fail the rest of the save. A present non-number or out-of-range value fails.
SoloistConnect.prototype.parseOptionalMs = function (raw, key, fallback, max) {
  if (raw === undefined || raw === null || raw === '') {
    const stored = parseInt(this.config.get(key), 10);
    return {
      ok: true,
      value: Number.isFinite(stored) && stored >= 0 && stored <= max ? stored : fallback,
    };
  }
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0 || n > max) return { ok: false };
  return { ok: true, value: n };
};

// Which saved values the daemon actually reads. Everything else is decided in
// this process at runtime, so changing only those must not restart playback.
const DAEMON_SETTINGS = [
  'api_key',
  'device_name',
  'cache_size_mb',
  'cache_location',
  'buffer_ms',
  'output_trim_db',
  'loudness_normalization',
  'crossfade',
  'crossfade_ms',
  'verbose_logging',
];

SoloistConnect.prototype.daemonSettingsChanged = function (values) {
  for (const key of DAEMON_SETTINGS) {
    if (this.config.get(key) !== values[key]) return true;
  }
  const alignNow = this.config.get('align_volume') === true;
  const alignNext = values.align_volume === true;
  if (alignNow !== alignNext) return true;
  // While align is on, --initial-volume is taken from the Volumio knob.
  if (!alignNext && this.config.get('initial_volume') !== values.initial_volume) {
    return true;
  }
  return false;
};

SoloistConnect.prototype.applyValidatedSettings = function (values, opts) {
  opts = opts || {};
  const self = this;
  const restartNeeded = this.daemonSettingsChanged(values);

  this.config.set('api_key', values.api_key);
  this.config.set('device_name', values.device_name);
  this.config.set('initial_volume', values.initial_volume);
  this.config.set('align_volume', values.align_volume);
  this.config.set('cache_size_mb', values.cache_size_mb);
  this.config.set('cache_location', values.cache_location);
  this.config.set('buffer_ms', values.buffer_ms);
  this.config.set('seek_coalesce_ms', values.seek_coalesce_ms);
  this.config.set('inactive_hold_ms', values.inactive_hold_ms);
  this.config.set('quality_retry_ms', values.quality_retry_ms);
  this.config.set('quality_retry_max', values.quality_retry_max);
  this.config.set('queue_fetch_ms', values.queue_fetch_ms);
  this.config.set('output_trim_db', values.output_trim_db);
  this.config.set('loudness_normalization', values.loudness_normalization);
  this.config.set('crossfade', values.crossfade);
  this.config.set('crossfade_ms', values.crossfade_ms);
  this.config.set('retain_api_key', values.retain_api_key);
  this.config.set('queue_playback', values.queue_playback);
  this.config.set('queue_remote_playback', values.queue_remote_playback);
  this.config.set('verbose_logging', values.verbose_logging);
  this.config.set('auto_update_binary', values.auto_update_binary);
  this.clearPendingSeek();
  this.syncBrowseSource();

  // Say what was actually applied. The requested size is clamped against
  // MemTotal in RAM mode, and RAM mode is refused outright on a board too small
  // to carry the daemon's own 100 MB floor. Either would otherwise be a setting
  // that appears to have been accepted and did something different.
  if (opts.cachePosted && values.cache_location === 'ram') {
    const ramMb = this.ramCacheSizeMb();
    if (!ramMb) {
      this.commandRouter.pushToastMessage(
        'warning',
        'Spotify Soloist',
        'This board does not have enough memory for a RAM cache. Staying on disk.'
      );
    } else if (ramMb < values.cache_size_mb) {
      this.commandRouter.pushToastMessage(
        'info',
        'Spotify Soloist',
        'RAM cache limited to ' + ramMb + ' MB on this board.'
      );
    }
  }

  // Restarting the daemon stops whatever is playing. Do it only when the
  // daemon is actually reading something that changed; the queue switches are
  // read by this process on the next track.
  const savedToast = opts.savedToast || 'Settings saved.';
  const restartToast = opts.restartToast || 'Settings saved. Restarting Soloist...';
  if (!restartNeeded) {
    this.commandRouter.pushToastMessage('success', 'Spotify Soloist', savedToast);
    return libQ.resolve();
  }

  this.commandRouter.pushToastMessage('success', 'Spotify Soloist', restartToast);
  return this.startDaemon()
    .then(() => self.connectWebSocket())
    .fail((e) => {
      self.logger.error('SoloistConnect: save/restart failed: ' + e);
      return libQ.resolve(); // keep UI responsive; error already toasted
    });
};

SoloistConnect.prototype.saveSoloistSettings = function (data) {
  const result = this.validateSettings(data);
  if (!result.ok) {
    this.logger.error('SoloistConnect: rejected settings: ' + result.message);
    this.commandRouter.pushToastMessage('error', 'Spotify Soloist', result.message);
    return libQ.resolve();
  }

  return this.applyValidatedSettings(result.values, {
    cachePosted: data.cache_location !== undefined || data.cache_size_mb !== undefined,
  });
};

SoloistConnect.prototype.settingsBackupDir = function () {
  return this._settingsBackupDir || SETTINGS_BACKUP_DIR;
};

SoloistConnect.prototype.sanitizeBackupName = function (raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name || name.indexOf('..') !== -1 || /[\\/]/.test(name)) return '';
  if (!SETTINGS_BACKUP_NAME_RE.test(name)) return '';
  return name;
};

SoloistConnect.prototype.postedSelectValue = function (raw) {
  if (raw && typeof raw === 'object') return raw.value;
  return raw;
};

SoloistConnect.prototype.settingsBackupPath = function (name) {
  return path.join(this.settingsBackupDir(), name + '.json');
};

SoloistConnect.prototype.ensureSettingsBackupDir = function () {
  const dir = this.settingsBackupDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (e) {
    /* mode may be refused on some filesystems; create still happened */
  }
  return dir;
};

SoloistConnect.prototype.settingsBackupSnapshot = function () {
  const retain = this.config.get('retain_api_key') === true;
  const values = {};
  for (let i = 0; i < SETTINGS_BACKUP_KEYS.length; i++) {
    const key = SETTINGS_BACKUP_KEYS[i];
    values[key] = this.config.get(key);
  }
  if (retain) values.api_key = this.config.get('api_key') || '';
  return {
    schema_version: SETTINGS_BACKUP_SCHEMA,
    plugin_version: this.pluginVersion(),
    created: new Date().toISOString(),
    values: values,
  };
};

SoloistConnect.prototype.readSettingsBackup = function (name) {
  const safe = this.sanitizeBackupName(name);
  if (!safe) return { ok: false, message: 'Choose a settings backup.' };
  let raw;
  try {
    raw = fs.readFileSync(this.settingsBackupPath(safe), 'utf8');
  } catch (e) {
    return { ok: false, message: 'That settings backup is not on this device.' };
  }
  let snap;
  try {
    snap = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: 'That settings backup is not valid JSON.' };
  }
  if (!snap || snap.schema_version !== SETTINGS_BACKUP_SCHEMA ||
      !snap.values || typeof snap.values !== 'object') {
    return { ok: false, message: 'That settings backup is not a schema 1 snapshot.' };
  }
  return { ok: true, name: safe, snapshot: snap };
};

SoloistConnect.prototype.listSettingsBackups = function () {
  let names;
  try {
    names = fs.readdirSync(this.settingsBackupDir());
  } catch (e) {
    return [];
  }
  const options = [];
  for (let i = 0; i < names.length; i++) {
    const file = names[i];
    if (!file.endsWith('.json')) continue;
    const name = file.slice(0, -5);
    if (!this.sanitizeBackupName(name)) continue;
    const read = this.readSettingsBackup(name);
    if (!read.ok) continue;
    options.push({ value: name, label: name });
  }
  options.sort((a, b) => a.value.localeCompare(b.value));
  return options;
};

SoloistConnect.prototype.createSettingsBackup = function (data) {
  const name = this.sanitizeBackupName(data && data.backup_name);
  if (!name) {
    this.commandRouter.pushToastMessage(
      'error',
      'Spotify Soloist',
      'Backup name must be 1–64 letters, numbers, spaces, dots, underscores or hyphens.'
    );
    return libQ.resolve();
  }
  try {
    this.ensureSettingsBackupDir();
    const snap = this.settingsBackupSnapshot();
    snap.name = name;
    const dest = this.settingsBackupPath(name);
    const hasKey = Object.prototype.hasOwnProperty.call(snap.values, 'api_key');
    fs.writeFileSync(dest, JSON.stringify(snap, null, 2) + '\n', { mode: 0o600 });
    try {
      fs.chmodSync(dest, hasKey ? 0o600 : 0o640);
    } catch (e) {
      /* mode best-effort */
    }
  } catch (e) {
    this.logger.error('SoloistConnect: settings backup failed: ' + e);
    this.commandRouter.pushToastMessage('error', 'Spotify Soloist', 'Could not write the settings backup.');
    return libQ.resolve();
  }
  this.commandRouter.pushToastMessage('success', 'Spotify Soloist', 'Settings backup saved.');
  return this.updateUIConfig();
};

SoloistConnect.prototype.restoreSettingsBackup = function (data) {
  const name = this.postedSelectValue(data && data.selected_backup);
  const read = this.readSettingsBackup(name);
  if (!read.ok) {
    this.commandRouter.pushToastMessage('error', 'Spotify Soloist', read.message);
    return libQ.resolve();
  }
  const result = this.validateSettings(read.snapshot.values);
  if (!result.ok) {
    this.logger.error('SoloistConnect: rejected settings backup: ' + result.message);
    this.commandRouter.pushToastMessage('error', 'Spotify Soloist', result.message);
    return libQ.resolve();
  }
  const values = read.snapshot.values;
  const self = this;
  return this.applyValidatedSettings(result.values, {
    cachePosted: values.cache_location !== undefined || values.cache_size_mb !== undefined,
    savedToast: 'Settings restored.',
    restartToast: 'Settings restored. Restarting Soloist...',
  }).then(() => self.updateUIConfig());
};

SoloistConnect.prototype.deleteSettingsBackup = function (data) {
  const name = this.sanitizeBackupName(this.postedSelectValue(data && data.selected_backup_delete));
  if (!name) {
    this.commandRouter.pushToastMessage('error', 'Spotify Soloist', 'Choose a settings backup.');
    return libQ.resolve();
  }
  try {
    fs.unlinkSync(this.settingsBackupPath(name));
  } catch (e) {
    this.commandRouter.pushToastMessage(
      'error',
      'Spotify Soloist',
      'That settings backup is not on this device.'
    );
    return libQ.resolve();
  }
  this.commandRouter.pushToastMessage('success', 'Spotify Soloist', 'Settings backup deleted.');
  return this.updateUIConfig();
};

SoloistConnect.prototype.runDownloadScript = function (callback) {
  exec(this.downloadScript(), { timeout: 300000 }, callback);
};

SoloistConnect.prototype.coreI18n = function (key, fallback) {
  try {
    const s = this.commandRouter.getI18nString && this.commandRouter.getI18nString(key);
    if (s && s !== key) return s;
  } catch (e) { /* core string missing */ }
  return fallback;
};

// Same contract as system install-to-disk: openModal({progress:true})
// opens modal-progress.html; a follow-up modalProgress paints the bar.
SoloistConnect.prototype.pushBinaryUpdateProgress = function (status, progressNumber, message) {
  const data = {
    progress: true,
    progressNumber: progressNumber,
    title: 'Spotify Soloist',
    message: message,
    size: 'lg',
    buttons: []
  };
  let emit = 'modalProgress';
  if (status === 'started') {
    emit = 'openModal';
  } else if (status === 'done' || status === 'error') {
    emit = 'modalDone';
    data.buttons = [{
      name: this.coreI18n('COMMON.GOT_IT', 'Got it'),
      class: 'btn btn-info ng-scope',
      emit: 'closeModals',
      payload: ''
    }];
  }
  this.commandRouter.broadcastMessage(emit, data);
  if (status === 'started') {
    this.commandRouter.broadcastMessage('modalProgress', data);
  }
};

// 15 s so the user can read it. Restart is COMMON.RESTART with the same
// reboot emit I2S DAC and install-to-disk use; we call finishUpdateReboot
// so the countdown is cleared first. Cancel starts the new binary instead.
SoloistConnect.prototype.showUpdateRebootModal = function (seconds) {
  this.commandRouter.broadcastMessage('openModal', {
    title: 'Spotify Soloist',
    message: 'Soloist binary updated. Your device will restart in ' + seconds + ' seconds.',
    size: 'lg',
    buttons: [
      {
        name: this.coreI18n('COMMON.RESTART', 'Restart'),
        class: 'btn btn-info',
        emit: 'callMethod',
        payload: {
          endpoint: 'music_service/soloist_connect',
          method: 'finishUpdateReboot',
          data: {}
        }
      },
      {
        name: this.coreI18n('COMMON.CANCEL', 'Cancel'),
        class: 'btn btn-warning',
        emit: 'callMethod',
        payload: {
          endpoint: 'music_service/soloist_connect',
          method: 'cancelUpdateReboot',
          data: {}
        }
      }
    ]
  });
};

SoloistConnect.prototype.clearUpdateRebootTimer = function () {
  if (this.updateRebootTimer) {
    clearInterval(this.updateRebootTimer);
    this.updateRebootTimer = null;
  }
};

SoloistConnect.prototype.finishUpdateReboot = function () {
  this.clearUpdateRebootTimer();
  if (typeof this.commandRouter.closeModals === 'function') {
    this.commandRouter.closeModals();
  }
  this.logger.info('SoloistConnect: rebooting after Soloist binary update');
  if (typeof this.commandRouter.reboot === 'function') {
    this.commandRouter.reboot();
  } else {
    exec('/usr/bin/sudo /sbin/reboot', { timeout: 15000 }, () => {});
  }
};

SoloistConnect.prototype.initUpdateRebootCountdown = function () {
  const self = this;
  self.updateRebootLeft = self.updateRebootSeconds || 15;
  self.showUpdateRebootModal(self.updateRebootLeft);
  self.updateRebootTimer = setInterval(function () {
    self.updateRebootLeft -= 1;
    if (self.updateRebootLeft > 0) {
      self.showUpdateRebootModal(self.updateRebootLeft);
    } else {
      self.finishUpdateReboot();
    }
  }, 1000);
};

SoloistConnect.prototype.cancelUpdateReboot = function () {
  const self = this;
  self.clearUpdateRebootTimer();
  self.binaryUpdateBusy = false;
  if (typeof self.commandRouter.closeModals === 'function') {
    self.commandRouter.closeModals();
  }
  self.commandRouter.pushToastMessage(
    'info',
    'Spotify Soloist',
    'Reboot cancelled. The new Soloist binary is already installed.'
  );
  return libQ.resolve()
    .then(() => self.startDaemon())
    .then(() => self.connectWebSocket())
    .fail((e) => {
      self.logger.error('SoloistConnect: start after cancelled reboot failed: ' + e);
      return libQ.resolve();
    });
};

SoloistConnect.prototype.updateSoloistBinary = function () {
  const self = this;
  const defer = libQ.defer();
  if (self.binaryUpdateBusy) {
    return libQ.resolve();
  }
  self.binaryUpdateBusy = true;
  self.pushBinaryUpdateProgress(
    'started',
    10,
    'Downloading a new Soloist binary. Do not power off.'
  );
  this.runDownloadScript((error) => {
    if (error) {
      self.binaryUpdateBusy = false;
      self.pushBinaryUpdateProgress('error', 0, 'Update failed: ' + error);
      defer.reject(error);
      return;
    }
    if (typeof self.commandRouter.closeModals === 'function') {
      self.commandRouter.closeModals();
    }
    self.binaryUpdateBusy = false;
    self.initUpdateRebootCountdown();
    defer.resolve();
  });
  return defer.promise;
};
