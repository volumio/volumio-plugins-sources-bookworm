'use strict';

const libQ = require('kew');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fetch = require('node-fetch');

const History = require('./lib/history');
const QueueMonitor = require('./lib/queue-monitor');
const Presets = require('./lib/presets');
const Feedback = require('./lib/feedback');
const HttpApi = require('./lib/http-api');
const { QobuzMetadataCache } = require('./lib/qobuz-metadata-cache');
const {
  QobuzClient,
  FORMAT,
  fetchAppConfig,
  qobuzOAuthAuthorizeUrl,
  exchangeQobuzOAuthCode,
  extractQobuzLocalUserAuth
} = require('./lib/qobuz');
const { TrackCache } = require('./lib/track-cache');
const {
  qobuzTrackIdFromUri,
  localQobuzTrackIdFromUri,
  localQobuzPlaybackFromState,
  findLocalQobuzQueueIndex,
  downloadStatusForTrack
} = require('./lib/download-state');
const Recommenders = {
  llm:     require('./recommenders/llm'),
  lastfm:  require('./recommenders/lastfm'),
  spotify: require('./recommenders/spotify'),
  local:   require('./recommenders/local')
};

module.exports = AiAutopilot;

function AiAutopilot(context) {
  const self = this;
  self.context = context;
  self.commandRouter = context.coreCommand;
  self.logger = context.logger;
  self.configManager = context.configManager;
}

// ---------- Lifecycle ----------

AiAutopilot.prototype.onVolumioStart = function () {
  const self = this;
  const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

AiAutopilot.prototype.onStart = function () {
  const self = this;
  const defer = libQ.defer();

  try {
    self.dataDir = path.join('/data/plugins/music_service/ai_autopilot');
    fs.ensureDirSync(self.dataDir);

    self.history = new History({
      filePath: path.join(self.dataDir, 'history.json'),
      windowSize: self.config.get('history_window', 20),
      logger: self.logger
    });
    self.history.load();

    self.feedback = new Feedback({
      filePath: path.join(self.dataDir, 'feedback.json'),
      logger: self.logger
    });
    self.feedback.load();

    self.qobuzMeta = new QobuzMetadataCache({
      filePath: path.join(self.dataDir, 'qobuz-meta.json'),
      logger: self.logger
    });
    self.qobuzMeta.load();

    self.downloadJobs = {};
    self._downloadInFlight = {};
    self._qobuzClient = null;
    self._qobuzBrowserAuth = null;
    self._prefetchLastAt = 0;
    self.setupTrackCache();

    self.monitor = new QueueMonitor({
      commandRouter: self.commandRouter,
      logger: self.logger,
      verbose: self.config.get('verbose_log', false),
      onTrackPlayed: (track) => self.handleTrackPlayed(track),
      onTrackSkipped: (track) => self.handleTrackSkipped(track),
      onTrigger: () => self.handleAutoTrigger()
    });

    self.applyTriggerConfig();
    self.monitor.start();

    // HTTP API for one-tap like/dislike from phone/browser
    self.httpApi = new HttpApi({
      plugin: self,
      port: Number(self.config.get('http_api_port', 8488)) || 0,
      logger: self.logger
    });
    self.httpApi.start();

    // One-time migration: if user had a legacy llm_api_key set,
    // copy it into the current provider's slot (only if that slot is empty).
    try {
      const legacy = self.config.get('llm_api_key', '') || '';
      const provider = self.config.get('llm_provider', 'anthropic');
      if (legacy && provider && provider !== 'ollama') {
        const slotKey = 'llm_api_key_' + provider;
        const slotVal = self.config.get(slotKey, '') || '';
        if (!slotVal) {
          self.config.set(slotKey, legacy);
          self.logger.info('[ai_autopilot] migrated legacy llm_api_key -> ' + slotKey);
        }
      }
    } catch (e) {
      self.logger.error('[ai_autopilot] key migration error: ' + e.message);
    }

    // Always log the installed music_service plugin names at startup.
    // This is the #1 thing you need to know to configure searchSource aliases.
    try {
      const names = self.commandRouter.pluginManager.getPluginNames('music_service') || [];
      self.logger.info('[ai_autopilot] installed music_service plugins: ' + JSON.stringify(names));
    } catch (e) {
      self.logger.info('[ai_autopilot] could not list plugins: ' + e.message);
    }

    self.log('AI Autopilot started');
    defer.resolve();
  } catch (err) {
    self.logger.error('[ai_autopilot] onStart failed: ' + err.stack);
    defer.reject(err);
  }

  return defer.promise;
};

AiAutopilot.prototype.onStop = function () {
  const self = this;
  try {
    if (self.monitor) self.monitor.stop();
    if (self.history) self.history.flush();
    if (self.httpApi) self.httpApi.stop();
  } catch (e) {
    self.logger.error('[ai_autopilot] onStop error: ' + e.message);
  }
  return libQ.resolve();
};

// ---------- Qobuz local download/cache ----------

AiAutopilot.prototype._downloadQuality = function () {
  const q = Number(this.config.get('download_quality', FORMAT.FLAC_24_96));
  return [FORMAT.MP3_320, FORMAT.FLAC_16_44, FORMAT.FLAC_24_96, FORMAT.FLAC_24_192].indexOf(q) >= 0
    ? q
    : FORMAT.FLAC_24_96;
};

AiAutopilot.prototype._downloadDir = function () {
  return this.config.get('download_dir', '/mnt/INTERNAL/qobuz-tap') || '/mnt/INTERNAL/qobuz-tap';
};

AiAutopilot.prototype.setupTrackCache = function () {
  const self = this;
  self.trackCache = new TrackCache({
    dir: self._downloadDir(),
    resolveStreamUrl: (trackId) => self.resolveQobuzStreamUrl(trackId),
    logger: self.logger
  });
};

AiAutopilot.prototype._firstQueuedQobuzTrackId = function () {
  const self = this;
  let queue = [];
  try {
    queue = self.commandRouter.volumioGetQueue() || [];
  } catch (e) {
    try { queue = self.commandRouter.stateMachine.getQueue() || []; } catch (e2) { queue = []; }
  }
  for (const q of queue) {
    const id = qobuzTrackIdFromUri(q && q.uri);
    if (id) return id;
  }
  return process.env.QOBUZ_TEST_TRACK_ID || '19512574';
};

AiAutopilot.prototype._qobuzCredentials = function () {
  const self = this;
  return {
    email: self.config.get('qobuz_email', '') || process.env.QOBUZ_EMAIL || '',
    password: self.config.get('qobuz_password', '') || process.env.QOBUZ_PASSWORD || '',
    userId: self.config.get('qobuz_user_id', '') || process.env.QOBUZ_USER_ID || '',
    authToken: self.config.get('qobuz_auth_token', '') || process.env.QOBUZ_AUTH_TOKEN || '',
    appId: process.env.QOBUZ_APP_ID || '',
    secret: process.env.QOBUZ_APP_SECRET || '',
    authKey: process.env.QOBUZ_AUTH_KEY || ''
  };
};

AiAutopilot.prototype._getQobuzClient = async function (force) {
  const self = this;
  if (self._qobuzClient && !force) return self._qobuzClient;

  const creds = self._qobuzCredentials();
  if (!creds.authToken && (!creds.email || !creds.password)) {
    throw new Error('Qobuz credentials are missing. Set Qobuz email/password or Qobuz user_auth_token in plugin settings.');
  }

  const client = new QobuzClient();
  await client.init({
    email: creds.email,
    password: creds.password,
    userId: creds.userId || undefined,
    authToken: creds.authToken || undefined,
    appId: creds.appId || undefined,
    secret: creds.secret || undefined,
    authKey: creds.authKey || undefined,
    testTrackId: self._firstQueuedQobuzTrackId()
  });
  self._qobuzClient = client;
  return client;
};

AiAutopilot.prototype.startQobuzBrowserAuth = async function (redirectUri) {
  const self = this;
  const cfg = await fetchAppConfig();
  if (!cfg || !cfg.appId || !cfg.authKey) {
    throw new Error('Qobuz browser auth: app_id/private_key not found in web bundle');
  }
  const state = crypto.randomBytes(16).toString('hex');
  self._qobuzBrowserAuth = {
    appId: cfg.appId,
    authKey: cfg.authKey,
    state,
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  return qobuzOAuthAuthorizeUrl(cfg.appId, redirectUri, state);
};

AiAutopilot.prototype.completeQobuzBrowserAuth = async function (code, state) {
  const self = this;
  const pending = self._qobuzBrowserAuth;
  if (!pending || !pending.appId || !pending.authKey) {
    throw new Error('Qobuz browser auth: no pending login. Start again.');
  }
  if (Date.now() > pending.expiresAt) {
    self._qobuzBrowserAuth = null;
    throw new Error('Qobuz browser auth: login expired. Start again.');
  }
  if (state && pending.state && state !== pending.state) {
    self._qobuzBrowserAuth = null;
    throw new Error('Qobuz browser auth: state mismatch. Start again.');
  }

  const exchanged = await exchangeQobuzOAuthCode({
    appId: pending.appId,
    authKey: pending.authKey,
    code: code
  });
  self.config.set('qobuz_auth_token', exchanged.authToken);
  if (exchanged.userId) self.config.set('qobuz_user_id', exchanged.userId);
  self._qobuzBrowserAuth = null;
  self._qobuzClient = null;
  return {
    ok: true,
    tokenSaved: true,
    userIdSaved: !!exchanged.userId
  };
};

AiAutopilot.prototype._volumioCommand = async function (cmd) {
  const url = 'http://localhost:3000/api/v1/commands/?cmd=' + encodeURIComponent(cmd).replace(/%26/g, '&').replace(/%3D/g, '=');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Volumio command ' + cmd + ' failed: ' + res.status);
};

AiAutopilot.prototype._mpcCurrentFile = function () {
  try {
    return execFileSync('mpc', ['-f', '%file%', 'current'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) {
    return '';
  }
};

AiAutopilot.prototype._restorePlaybackAfterResolve = async function (state) {
  const self = this;
  const status = state && state.status;
  if (status === 'play') return;
  const target = status === 'pause' ? 'pause' : 'stop';
  try {
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 800));
      await self._volumioCommand(target);
      await new Promise((resolve) => setTimeout(resolve, 500));
      let current = null;
      try { current = self.commandRouter.volumioGetState(); } catch (e) {}
      if (!current || current.status === target) return;
    }
  } catch (e) {
    const logWarn = self.logger.warn || self.logger.info || function () {};
    logWarn.call(self.logger, '[ai_autopilot] Qobuz playback fallback restore warning: ' + (e && e.message ? e.message : e));
  }
};

AiAutopilot.prototype._resolveQobuzStreamUrlFromPlayback = async function (trackId) {
  const self = this;
  let state = null;
  try { state = self.commandRouter.volumioGetState(); } catch (e) {}
  const currentId = qobuzTrackIdFromUri(state && state.uri);
  if (String(currentId || '') !== String(trackId || '')) {
    throw new Error('Qobuz API login failed, and playback fallback can only resolve the current Qobuz track. Play this track first or set Qobuz user_auth_token.');
  }

  const beforeStatus = state && state.status;
  if (beforeStatus !== 'play') await self._volumioCommand('play');

  const deadline = Date.now() + 15000;
  let url = '';
  while (Date.now() < deadline) {
    url = self._mpcCurrentFile();
    if (/^https?:\/\//i.test(url)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await self._restorePlaybackAfterResolve(state);
  if (!/^https?:\/\//i.test(url)) throw new Error('Qobuz playback fallback did not expose a stream URL');
  self.logger.info('[ai_autopilot] Qobuz stream URL resolved via current playback fallback for track ' + trackId);
  return url;
};

AiAutopilot.prototype.resolveQobuzStreamUrl = async function (trackId) {
  const self = this;
  const fmt = self._downloadQuality();
  const resolveOnce = async (force) => {
    const client = await self._getQobuzClient(force);
    const info = await client.getFileUrl(trackId, fmt);
    if (!info || !info.url) throw new Error('Qobuz did not return a stream URL for track ' + trackId);
    return info.url;
  };

  try {
    return await resolveOnce(false);
  } catch (e) {
    if (/401|auth|User authentication/i.test(e && e.message ? e.message : String(e))) {
      self._qobuzClient = null;
      try {
        return await resolveOnce(true);
      } catch (e2) {
        if (/401|auth|User authentication/i.test(e2 && e2.message ? e2.message : String(e2))) {
          return self._resolveQobuzStreamUrlFromPlayback(trackId);
        }
        throw e2;
      }
    }
    throw e;
  }
};

AiAutopilot.prototype._downloadStatus = function (trackId, localPlayback) {
  const self = this;
  if (!trackId || !self.trackCache) return null;
  localPlayback = localPlayback || {};
  const cachedFile = self.trackCache.existing(trackId);
  return downloadStatusForTrack(trackId, {
    jobs: self.downloadJobs || {},
    cachedFile,
    libraryUri: cachedFile ? self.trackCache.libraryUri(cachedFile) : '',
    localPlaybackTrackId: localPlayback.trackId || '',
    localPlaybackLibraryUri: localPlayback.libraryUri || ''
  });
};

AiAutopilot.prototype._rememberQobuzMeta = function (trackId, meta) {
  const self = this;
  if (!trackId || !self.qobuzMeta) return null;
  return self.qobuzMeta.remember(trackId, meta || {}) || self.qobuzMeta.get(trackId);
};

AiAutopilot.prototype._qobuzMetaFromQueue = function (trackId) {
  const self = this;
  const wanted = String(trackId || '');
  if (!wanted) return null;
  let state = null;
  try { state = self.commandRouter.volumioGetState(); } catch (e) {}
  if (String(qobuzTrackIdFromUri(state && state.uri) || '') === wanted) {
    const remembered = self._rememberQobuzMeta(wanted, {
      title: state.title || '',
      artist: state.artist || '',
      album: state.album || '',
      albumart: state.albumart || '',
      uri: state.uri || ''
    });
    if (remembered) return remembered;
  }

  const queue = self._queueSnapshot();
  for (const q of queue) {
    const id = qobuzTrackIdFromUri(q && q.uri);
    if (String(id || '') !== wanted) continue;
    const remembered = self._rememberQobuzMeta(wanted, {
      title: q.name || q.title || '',
      artist: q.artist || '',
      album: q.album || '',
      albumart: q.albumart || '',
      uri: q.uri || ''
    });
    if (remembered) return remembered;
  }
  if (self.history && typeof self.history.all === 'function') {
    const items = self.history.all().slice().reverse();
    for (const h of items) {
      const id = qobuzTrackIdFromUri(h && h.uri);
      if (String(id || '') !== wanted) continue;
      const remembered = self._rememberQobuzMeta(wanted, {
        title: h.title || '',
        artist: h.artist || '',
        album: h.album || '',
        albumart: h.albumart || '',
        uri: h.uri || ''
      });
      if (remembered) return remembered;
    }
  }
  return self.qobuzMeta ? self.qobuzMeta.get(wanted) : null;
};

AiAutopilot.prototype.downloadTrack = async function (trackId, meta) {
  const self = this;
  trackId = String(trackId || '').trim();
  if (!/^\d+$/.test(trackId)) throw new Error('Invalid Qobuz track id');
  if (!self.trackCache) self.setupTrackCache();
  meta = Object.assign({}, self._qobuzMetaFromQueue(trackId) || {}, meta || {});

  const cached = self.trackCache.existing(trackId);
  if (cached) {
    const res = { trackId, file: cached, libraryUri: self.trackCache.libraryUri(cached), cached: true };
    self.downloadJobs[trackId] = { state: 'done', progress: 1, libraryUri: res.libraryUri };
    return res;
  }

  if (!self.config.get('download_enabled', false)) throw new Error('Qobuz downloads are disabled in settings.');

  if (self._downloadInFlight[trackId]) return self._downloadInFlight[trackId];

  self.downloadJobs[trackId] = { state: 'downloading', progress: 0, libraryUri: '' };
  const p = self.trackCache.download(trackId, Object.assign({ ext: 'flac' }, meta || {}), (progress) => {
    const job = self.downloadJobs[trackId] || {};
    job.state = 'downloading';
    job.progress = Math.max(0, Math.min(1, Number(progress) || 0));
    self.downloadJobs[trackId] = job;
  }).then((res) => {
    self.downloadJobs[trackId] = { state: 'done', progress: 1, libraryUri: res.libraryUri };
    self.logger.info('[ai_autopilot] Qobuz track cached: ' + trackId + ' -> ' + res.libraryUri);
    return res;
  }).catch((e) => {
    self.downloadJobs[trackId] = { state: 'error', progress: 0, error: e && e.message ? e.message : String(e), libraryUri: '' };
    self.logger.error('[ai_autopilot] Qobuz download failed for ' + trackId + ': ' + (e && e.message ? e.message : e));
    throw e;
  }).then((res) => {
    delete self._downloadInFlight[trackId];
    return res;
  }, (err) => {
    delete self._downloadInFlight[trackId];
    throw err;
  });
  self._downloadInFlight[trackId] = p;
  return p;
};

AiAutopilot.prototype.downloadAndPlay = async function (trackId) {
  const self = this;
  const res = await self.downloadTrack(trackId);
  const play = await self._playLocalPreservingQueue(trackId, res.libraryUri, self._qobuzMetaFromQueue(trackId));
  res.playing = true;
  res.queueIndex = play.queueIndex;
  res.addedToQueue = play.addedToQueue;
  return res;
};

AiAutopilot.prototype._queueSnapshot = function () {
  const self = this;
  try {
    const queue = self.commandRouter.volumioGetQueue();
    if (Array.isArray(queue)) return queue;
    if (queue && Array.isArray(queue.queue)) return queue.queue;
  } catch (e) {}
  try {
    const queue = self.commandRouter.stateMachine.getQueue();
    if (Array.isArray(queue)) return queue;
    if (queue && Array.isArray(queue.queue)) return queue.queue;
  } catch (e2) {}
  return [];
};

AiAutopilot.prototype._playQueueIndex = async function (index) {
  const self = this;
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid queue index for local playback');
  if (self.commandRouter && typeof self.commandRouter.volumioPlay === 'function') {
    await libQ.resolve(self.commandRouter.volumioPlay(n));
    return;
  }
  await self._volumioCommand('play&N=' + n);
};

AiAutopilot.prototype._playLocalPreservingQueue = async function (trackId, libraryUri, meta) {
  const self = this;
  const queue = self._queueSnapshot();
  let index = findLocalQobuzQueueIndex(queue, trackId);
  let addedToQueue = false;
  meta = Object.assign({}, self._qobuzMetaFromQueue(trackId) || {}, meta || {});

  if (index < 0) {
    const item = {
      uri: libraryUri,
      service: 'mpd',
      name: meta.title || '',
      title: meta.title || '',
      artist: meta.artist || '',
      album: meta.album || '',
      albumart: meta.albumart || ''
    };
    const res = await libQ.resolve(self.commandRouter.addQueueItems([item]));
    index = res && typeof res.firstItemIndex === 'number' ? res.firstItemIndex : self._queueSnapshot().length - 1;
    addedToQueue = true;
  }

  await self._playQueueIndex(index);
  return { queueIndex: index, addedToQueue };
};

AiAutopilot.prototype.playCachedTrack = async function (trackId) {
  const self = this;
  trackId = String(trackId || '').trim();
  if (!/^\d+$/.test(trackId)) throw new Error('Invalid Qobuz track id');
  if (!self.trackCache) self.setupTrackCache();
  const cached = self.trackCache.existing(trackId);
  if (!cached) throw new Error('No downloaded local file for Qobuz track ' + trackId);
  const libraryUri = self.trackCache.libraryUri(cached);
  const play = await self._playLocalPreservingQueue(trackId, libraryUri, self._qobuzMetaFromQueue(trackId));
  self.downloadJobs[trackId] = { state: 'done', progress: 1, libraryUri };
  return { trackId, file: cached, libraryUri, cached: true, playing: true, queueIndex: play.queueIndex, addedToQueue: play.addedToQueue };
};

AiAutopilot.prototype._isLocalQobuzCachePlayback = function () {
  const self = this;
  try {
    return localQobuzPlaybackFromState(self.commandRouter.volumioGetState()).active;
  } catch (e) {
    return false;
  }
};

AiAutopilot.prototype.prefetchUpcoming = async function (opts) {
  const self = this;
  opts = opts || {};
  if (!self.config.get('download_enabled', false)) return { ok: true, skipped: 'disabled' };
  const n = Math.max(0, Math.min(20, Number(self.config.get('prefetch_count', 0)) || 0));
  if (!n && !opts.limit) return { ok: true, skipped: 'off' };
  if (self.config.get('quiet_mode_enabled', false) && self._isLocalQobuzCachePlayback()) {
    return { ok: true, skipped: 'quiet_mode' };
  }
  if (!opts.force && Date.now() - self._prefetchLastAt < 15000) {
    return { ok: true, skipped: 'throttled' };
  }
  self._prefetchLastAt = Date.now();

  let state = null;
  let queue = [];
  try { state = self.commandRouter.volumioGetState(); } catch (e) {}
  try {
    queue = self.commandRouter.volumioGetQueue() || [];
  } catch (e) {
    try { queue = self.commandRouter.stateMachine.getQueue() || []; } catch (e2) { queue = []; }
  }
  const pos = state && typeof state.position === 'number' ? state.position : -1;
  const start = opts.includeCurrent ? Math.max(0, pos) : Math.max(0, pos + 1);
  const limit = Math.max(1, Math.min(50, Number(opts.limit || n) || n || 1));
  const ids = [];
  for (let i = start; i < queue.length && ids.length < limit; i++) {
    const id = qobuzTrackIdFromUri(queue[i] && queue[i].uri);
    if (!id) continue;
    if (self._downloadStatus(id) && self._downloadStatus(id).cached) continue;
    if (self._downloadInFlight && self._downloadInFlight[id]) continue;
    ids.push(id);
  }

  const started = [];
  for (const id of ids) {
    started.push(id);
    self.downloadTrack(id).catch(() => {});
  }
  return { ok: true, started };
};

AiAutopilot.prototype.downloadQueueWindow = async function (limit) {
  return this.prefetchUpcoming({ force: true, includeCurrent: true, limit: limit || 10 });
};

AiAutopilot.prototype.onRestart = function () {
  return libQ.resolve();
};

AiAutopilot.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// ---------- UI Config ----------

AiAutopilot.prototype.getUIConfig = function () {
  const self = this;
  const defer = libQ.defer();
  const langCode = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    path.join(__dirname, 'i18n', 'strings_' + langCode + '.json'),
    path.join(__dirname, 'i18n', 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json')
  )
    .then((uiconf) => {
      const setField = (sectionIdx, fieldId, value) => {
        const section = uiconf.sections[sectionIdx];
        if (!section) return;
        const field = section.content.find((c) => c.id === fieldId);
        if (!field) return;
        if (field.element === 'select') {
          const match = (field.options || []).find((o) => o.value === value);
          field.value = match || { value, label: String(value) };
        } else {
          field.value = value;
        }
      };

      // section 0 - general
      setField(0, 'enabled', self.config.get('enabled', true));
      setField(0, 'source', self.config.get('source', 'auto'));
      setField(0, 'trigger_mode', self.config.get('trigger_mode', 'keep_ahead'));
      setField(0, 'keep_ahead_count', self.config.get('keep_ahead_count', 3));
      setField(0, 'cooldown_sec', self.config.get('cooldown_sec', 5));
      setField(0, 'http_api_port', self.config.get('http_api_port', 8488));
      setField(0, 'history_window', self.config.get('history_window', 20));
      setField(0, 'avoid_same_album_window', self.config.get('avoid_same_album_window', 10));
      setField(0, 'avoid_same_artist_window', self.config.get('avoid_same_artist_window', 0));
      setField(0, 'feedback_use_skip', self.config.get('feedback_use_skip', false));
      setField(0, 'verbose_log', self.config.get('verbose_log', false));

      // section 1 - recommender
      setField(1, 'recommender', self.config.get('recommender', 'llm'));
      setField(1, 'llm_provider', self.config.get('llm_provider', 'anthropic'));
      // per-provider model dropdowns
      const providers = [
        'anthropic', 'openai', 'google', 'groq', 'deepseek', 'xai',
        'mistral', 'openrouter', 'perplexity', 'together', 'ollama'
      ];
      providers.forEach((p) => {
        setField(1, 'llm_model_' + p, self.config.get('llm_model_' + p, ''));
      });
      // per-provider API key fields (excluding ollama which needs no key)
      const providersWithKey = providers.filter((p) => p !== 'ollama').concat(['custom']);
      providersWithKey.forEach((p) => {
        setField(1, 'llm_api_key_' + p, self.config.get('llm_api_key_' + p, ''));
      });
      setField(1, 'llm_model_custom', self.config.get('llm_model_custom', ''));
      setField(1, 'llm_base_url', self.config.get('llm_base_url', ''));
      setField(1, 'llm_hints', self.config.get('llm_hints', ''));
      setField(1, 'llm_system_prompt', self.config.get('llm_system_prompt', ''));
      setField(1, 'energy_min', self.config.get('energy_min', 0));
      setField(1, 'energy_max', self.config.get('energy_max', 10));

      // Inject preset options dynamically
      const promptSection = uiconf.sections[1];
      const promptField = promptSection && promptSection.content.find((c) => c.id === 'prompt_preset_selected');
      if (promptField) {
        promptField.options = Presets.PROMPTS.map((p) => ({ value: p.id, label: p.name }));
        const saved = self.config.get('prompt_preset_selected', 'default');
        const match = promptField.options.find((o) => o.value === saved) || promptField.options[0];
        promptField.value = match;
      }
      // Per-parent sub-preset dropdowns
      Presets.PROMPTS.forEach((parent) => {
        const subField = promptSection && promptSection.content.find((c) => c.id === 'prompt_sub_' + parent.id);
        if (!subField) return;
        const opts = [{ value: '', label: '(parent default)' }]
          .concat((parent.subs || []).map((s) => ({ value: s.id, label: s.name })));
        subField.options = opts;
        const savedSub = self.config.get('prompt_sub_' + parent.id, '');
        const match = opts.find((o) => o.value === savedSub) || opts[0];
        subField.value = match;
      });
      const hintField = promptSection && promptSection.content.find((c) => c.id === 'hint_preset_selected');
      if (hintField) {
        hintField.options = Presets.HINTS.map((h) => ({ value: h.id, label: h.name }));
        const saved = self.config.get('hint_preset_selected', 'none');
        const match = hintField.options.find((o) => o.value === saved) || hintField.options[0];
        hintField.value = match;
      }

      // Dynamically populate the "Open in browser" buttons' URLs with
      // data: URLs containing the current prompt / hints text. The user can
      // view or save-as in a new tab without SSH.
      const encodeDataUrl = (text) =>
        'data:text/plain;charset=utf-8,' + encodeURIComponent(text || '(empty — use a preset above)');
      const openPromptBtn = promptSection && promptSection.content.find((c) => c.id === 'open_prompt_browser');
      if (openPromptBtn && openPromptBtn.onClick) {
        openPromptBtn.onClick.url = encodeDataUrl(self.config.get('llm_system_prompt', ''));
      }
      const openHintsBtn = promptSection && promptSection.content.find((c) => c.id === 'open_hints_browser');
      if (openHintsBtn && openHintsBtn.onClick) {
        openHintsBtn.onClick.url = encodeDataUrl(self.config.get('llm_hints', ''));
      }

      const remoteBaseUrl = () => {
        let host = null;
        try {
          const os = require('os');
          const ifs = os.networkInterfaces();
          Object.keys(ifs).forEach((name) => {
            (ifs[name] || []).forEach((iface) => {
              if (!iface.internal && iface.family === 'IPv4' && !host) host = iface.address;
            });
          });
        } catch (e) {}
        // Prefer the port the HTTP server actually bound to (it may have moved off a
        // busy port), then fall back to the configured value.
        const port = (self.httpApi && self.httpApi.actualPort) ||
          Number(self.config.get('http_api_port', 8488)) || 8488;
        return 'http://' + (host || 'volumio.local') + ':' + port + '/';
      };

      // Remote control button — fill in LAN IP + port dynamically.
      const actionsSection = uiconf.sections[2];
      const openRemoteBtn = actionsSection && actionsSection.content &&
        actionsSection.content.find((c) => c.id === 'open_remote');
      const remoteUrl = remoteBaseUrl();
      if (openRemoteBtn && openRemoteBtn.onClick) {
        openRemoteBtn.onClick.url = remoteUrl;
        // Show the URL as text too — the in-app button can't always hand off to an
        // external browser (iOS), so the user can copy/open this in Safari directly.
        openRemoteBtn.doc = (openRemoteBtn.doc ? openRemoteBtn.doc + '  ' : '') +
          'Safari: ' + remoteUrl;
      }
      setField(1, 'lastfm_api_key', self.config.get('lastfm_api_key', ''));
      setField(1, 'lastfm_user', self.config.get('lastfm_user', ''));
      setField(1, 'spotify_client_id', self.config.get('spotify_client_id', ''));
      setField(1, 'spotify_client_secret', self.config.get('spotify_client_secret', ''));
      setField(1, 'spotify_refresh_token', self.config.get('spotify_refresh_token', ''));

      // section 3 - Qobuz local downloads
      setField(3, 'download_enabled', self.config.get('download_enabled', false));
      setField(3, 'download_dir', self.config.get('download_dir', '/mnt/INTERNAL/qobuz-tap'));
      setField(3, 'download_quality', self._downloadQuality());
      setField(3, 'qobuz_email', self.config.get('qobuz_email', ''));
      setField(3, 'qobuz_password', '');
      setField(3, 'qobuz_user_id', '');
      setField(3, 'qobuz_auth_token', '');
      setField(3, 'qobuz_local_user_json', '');
      setField(3, 'prefetch_count', self.config.get('prefetch_count', 0));
      setField(3, 'quiet_mode_enabled', self.config.get('quiet_mode_enabled', false));
      const qobuzSection = uiconf.sections.find((s) => s.id === 'section_qobuz_downloads');
      const qobuzAuthBtn = qobuzSection && qobuzSection.content &&
        qobuzSection.content.find((c) => c.id === 'qobuz_browser_auth');
      if (qobuzAuthBtn && qobuzAuthBtn.onClick) {
        const authUrl = remoteUrl.replace(/\/$/, '') + '/qobuz-auth/start';
        qobuzAuthBtn.onClick.url = authUrl;
        qobuzAuthBtn.doc = (qobuzAuthBtn.doc ? qobuzAuthBtn.doc + '  ' : '') +
          'Safari: ' + authUrl;
      }

      defer.resolve(uiconf);
    })
    .fail((err) => {
      self.logger.error('[ai_autopilot] getUIConfig error: ' + err);
      defer.reject(err);
    });

  return defer.promise;
};

AiAutopilot.prototype.saveGeneralSettings = function (data) {
  const self = this;
  ['enabled', 'keep_ahead_count', 'cooldown_sec', 'http_api_port', 'history_window',
   'avoid_same_album_window', 'avoid_same_artist_window',
   'verbose_log', 'feedback_use_skip'].forEach((k) => {
    if (data[k] !== undefined) self.config.set(k, data[k]);
  });
  if (data.source) self.config.set('source', valueOf(data.source));
  if (data.trigger_mode) self.config.set('trigger_mode', valueOf(data.trigger_mode));

  self.applyTriggerConfig();
  self.history && self.history.setWindowSize(self.config.get('history_window', 20));

  // restart HTTP API if the port changed
  if (self.httpApi) {
    const newPort = Number(self.config.get('http_api_port', 8488)) || 0;
    if (newPort !== self.httpApi.port) {
      self.httpApi.stop();
      self.httpApi.port = newPort;
      self.httpApi.start();
    }
  }

  self.commandRouter.pushToastMessage('success', 'AI Autopilot', self.t('SETTINGS_SAVED'));
  return libQ.resolve({});
};

AiAutopilot.prototype.saveDownloadSettings = function (data) {
  const self = this;
  data = data || {};
  ['download_enabled', 'quiet_mode_enabled'].forEach((k) => {
    if (data[k] !== undefined) self.config.set(k, !!data[k]);
  });
  if (data.download_dir !== undefined) {
    self.config.set('download_dir', String(data.download_dir || '/mnt/INTERNAL/qobuz-tap'));
  }
  if (data.download_quality !== undefined) {
    const q = Number(valueOf(data.download_quality));
    if ([FORMAT.MP3_320, FORMAT.FLAC_16_44, FORMAT.FLAC_24_96, FORMAT.FLAC_24_192].indexOf(q) >= 0) {
      self.config.set('download_quality', q);
    }
  }
  if (data.qobuz_email !== undefined) self.config.set('qobuz_email', String(data.qobuz_email || '').trim());
  if (data.qobuz_password !== undefined && data.qobuz_password !== '') {
    self.config.set('qobuz_password', String(data.qobuz_password));
    self._qobuzClient = null;
  }
  if (data.qobuz_local_user_json !== undefined && String(data.qobuz_local_user_json).trim() !== '') {
    const parsed = extractQobuzLocalUserAuth(String(data.qobuz_local_user_json));
    if (!parsed.authToken) {
      self.commandRouter.pushToastMessage('error', 'AI Autopilot', 'Qobuz local user JSON에서 token을 찾지 못했습니다.');
      return libQ.reject(new Error('Qobuz local user JSON did not contain a token'));
    }
    self.config.set('qobuz_auth_token', parsed.authToken);
    if (parsed.userId) self.config.set('qobuz_user_id', parsed.userId);
    self._qobuzClient = null;
  }
  if (data.qobuz_user_id !== undefined && String(data.qobuz_user_id).trim() !== '') {
    self.config.set('qobuz_user_id', String(data.qobuz_user_id).trim());
    self._qobuzClient = null;
  }
  if (data.qobuz_auth_token !== undefined && String(data.qobuz_auth_token).trim() !== '') {
    self.config.set('qobuz_auth_token', String(data.qobuz_auth_token).trim());
    self._qobuzClient = null;
  }
  if (data.prefetch_count !== undefined) {
    let n = parseInt(data.prefetch_count, 10);
    if (!Number.isFinite(n)) n = 0;
    self.config.set('prefetch_count', Math.max(0, Math.min(20, n)));
  }
  self.setupTrackCache();
  self.commandRouter.pushToastMessage('success', 'AI Autopilot', self.t('SETTINGS_SAVED'));
  return libQ.resolve({});
};

AiAutopilot.prototype.saveRecommenderSettings = function (data) {
  const self = this;
  if (data.recommender) self.config.set('recommender', valueOf(data.recommender));
  if (data.llm_provider) self.config.set('llm_provider', valueOf(data.llm_provider));

  const providersWithKey = [
    'anthropic', 'openai', 'google', 'groq', 'deepseek', 'xai',
    'mistral', 'openrouter', 'perplexity', 'together', 'custom'
  ];
  const providersAll = providersWithKey.concat(['ollama']);

  // Persist per-provider API keys. Only save if the user submitted a non-empty value
  // (this lets the "hidden" providers keep their keys intact when the user saves
  // a different provider's form).
  providersWithKey.forEach((p) => {
    const key = 'llm_api_key_' + p;
    if (data[key] !== undefined && data[key] !== '') self.config.set(key, data[key]);
  });

  // Persist per-provider model dropdowns.
  providersAll.forEach((p) => {
    const key = 'llm_model_' + p;
    if (data[key] !== undefined) self.config.set(key, valueOf(data[key]));
  });
  if (data.llm_model_custom !== undefined) self.config.set('llm_model_custom', data.llm_model_custom);

  // Resolve effective llm_model and llm_api_key based on current provider.
  const provider = self.config.get('llm_provider', 'anthropic');
  const customModel = (self.config.get('llm_model_custom', '') || '').trim();
  const preset = (self.config.get('llm_model_' + provider, '') || '').trim();
  self.config.set('llm_model', customModel || preset);
  self.config.set('llm_api_key', self.config.get('llm_api_key_' + provider, '') || '');

  [
    'llm_base_url',
    'llm_hints',
    'llm_system_prompt',
    'lastfm_api_key',
    'lastfm_user',
    'spotify_client_id',
    'spotify_client_secret',
    'spotify_refresh_token'
  ].forEach((k) => {
    if (data[k] !== undefined) self.config.set(k, data[k]);
  });
  if (data.prompt_preset_selected !== undefined) self.config.set('prompt_preset_selected', valueOf(data.prompt_preset_selected));
  if (data.hint_preset_selected !== undefined) self.config.set('hint_preset_selected', valueOf(data.hint_preset_selected));
  Presets.PROMPTS.forEach((parent) => {
    const key = 'prompt_sub_' + parent.id;
    if (data[key] !== undefined) self.config.set(key, valueOf(data[key]));
  });
  if (data.energy_min !== undefined) self.config.set('energy_min', Number(data.energy_min));
  if (data.energy_max !== undefined) self.config.set('energy_max', Number(data.energy_max));
  self.commandRouter.pushToastMessage('success', 'AI Autopilot', self.t('SETTINGS_SAVED'));
  return libQ.resolve({});
};

// ---------- Button actions ----------

AiAutopilot.prototype.triggerManual = function () {
  const self = this;
  self.commandRouter.pushToastMessage('info', 'AI Autopilot', self.t('MANUAL_TRIGGER_OK'));
  return self.pickAndQueue();
};

AiAutopilot.prototype.applyPromptPreset = function () {
  const self = this;
  const id = self.config.get('prompt_preset_selected', 'default');
  const parent = Presets.PROMPTS.find((p) => p.id === id);
  if (!parent) {
    self.commandRouter.pushToastMessage('error', 'AI Autopilot', 'Preset not found: ' + id);
    return libQ.resolve({});
  }
  const subId = self.config.get('prompt_sub_' + id, '');
  const sub = subId && parent.subs && parent.subs.find((s) => s.id === subId);
  const text = sub ? sub.text : parent.text;
  const label = parent.name + (sub ? ' → ' + sub.name : '');
  self.config.set('llm_system_prompt', text);
  self.logger.info('[ai_autopilot] applied prompt preset: ' + label);
  self.commandRouter.pushToastMessage('success', 'AI Autopilot',
    self.t('PRESET_LOADED') + ' (' + label + ')');
  return libQ.resolve({});
};

AiAutopilot.prototype.applyHintPreset = function () {
  const self = this;
  const id = self.config.get('hint_preset_selected', 'none');
  const preset = Presets.HINTS.find((h) => h.id === id);
  if (!preset) {
    self.commandRouter.pushToastMessage('error', 'AI Autopilot', 'Preset not found: ' + id);
    return libQ.resolve({});
  }
  self.config.set('llm_hints', preset.text);
  self.commandRouter.pushToastMessage('success', 'AI Autopilot', self.t('PRESET_LOADED'));
  return libQ.resolve({});
};

AiAutopilot.prototype.clearHistory = function () {
  const self = this;
  if (self.history) self.history.clear();
  self.commandRouter.pushToastMessage('success', 'AI Autopilot', self.t('HISTORY_CLEARED'));
  return libQ.resolve({});
};

// Core updater used by both the settings button and the remote panel.
// Resolves to { ok, updated, message } and never rejects.
AiAutopilot.prototype._performUpdate = function () {
  const self = this;
  const updater = require('./lib/updater');
  return updater.update({
    pluginDir: __dirname,
    currentSha: self.config.get('installed_sha', ''),
    logger: self.logger
  }).then((r) => {
    if (!r.updated) {
      return { ok: true, updated: false, message: self.t('UPDATE_UP_TO_DATE') };
    }
    self.config.set('installed_sha', r.toSha);
    self.logger.info('[ai_autopilot] updated ' + r.fromSha + ' -> ' + r.toSha +
      ' (depsChanged=' + r.depsChanged + ')');
    return { ok: true, updated: true, message: self.t('UPDATE_DONE').replace('{{sha}}', (r.toSha || '').slice(0, 7)) };
  }).catch((e) => {
    self.logger.error('[ai_autopilot] update error: ' + ((e && e.stack) || e));
    return { ok: false, updated: false, message: self.t('UPDATE_FAILED').replace('{{err}}', (e && e.message) || String(e)) };
  });
};

AiAutopilot.prototype.checkForUpdate = function () {
  const self = this;
  const defer = libQ.defer();
  self.commandRouter.pushToastMessage('info', 'AI Autopilot', self.t('UPDATE_CHECKING'));
  self._performUpdate().then((res) => {
    self.commandRouter.pushToastMessage(res.ok ? 'success' : 'error', 'AI Autopilot', res.message);
    defer.resolve({});
  });
  return defer.promise;
};

// Remote-panel entry point: returns the result object directly (for a toast in
// the web UI) instead of pushing a Volumio toast.
AiAutopilot.prototype.remoteUpdate = function () {
  return this._performUpdate();
};

AiAutopilot.prototype.exportPromptsToFile = function () {
  const self = this;
  try {
    const p = path.join(self.dataDir, 'system_prompt.txt');
    const h = path.join(self.dataDir, 'hints.txt');
    fs.writeFileSync(p, self.config.get('llm_system_prompt', '') || '', 'utf8');
    fs.writeFileSync(h, self.config.get('llm_hints', '') || '', 'utf8');
    const msg = self.t('EXPORT_OK').replace('{{path}}', self.dataDir);
    self.logger.info('[ai_autopilot] exported prompts to ' + p + ' and ' + h);
    self.commandRouter.pushToastMessage('success', 'AI Autopilot', msg);
  } catch (e) {
    self.logger.error('[ai_autopilot] exportPrompts error: ' + e.message);
    self.commandRouter.pushToastMessage('error', 'AI Autopilot', e.message);
  }
  return libQ.resolve({});
};

AiAutopilot.prototype.importPromptsFromFile = function () {
  const self = this;
  try {
    const p = path.join(self.dataDir, 'system_prompt.txt');
    const h = path.join(self.dataDir, 'hints.txt');
    if (!fs.existsSync(p) && !fs.existsSync(h)) {
      self.commandRouter.pushToastMessage('warning', 'AI Autopilot', self.t('IMPORT_MISSING'));
      return libQ.resolve({});
    }
    let pText = '', hText = '';
    if (fs.existsSync(p)) pText = fs.readFileSync(p, 'utf8');
    if (fs.existsSync(h)) hText = fs.readFileSync(h, 'utf8');
    self.config.set('llm_system_prompt', pText);
    self.config.set('llm_hints', hText);
    const msg = self.t('IMPORT_OK')
      .replace('{{p}}', String(pText.length))
      .replace('{{h}}', String(hText.length));
    self.logger.info('[ai_autopilot] imported prompts: system=' + pText.length + ' hints=' + hText.length);
    self.commandRouter.pushToastMessage('success', 'AI Autopilot', msg);
  } catch (e) {
    self.logger.error('[ai_autopilot] importPrompts error: ' + e.message);
    self.commandRouter.pushToastMessage('error', 'AI Autopilot', e.message);
  }
  return libQ.resolve({});
};

AiAutopilot.prototype._currentPlayingTrack = function () {
  const self = this;
  try {
    const s = self.commandRouter.volumioGetState();
    if (s && s.uri && s.title) {
      return { uri: s.uri, title: s.title, artist: s.artist, album: s.album, service: s.service };
    }
  } catch (e) {}
  return null;
};

AiAutopilot.prototype._recordFeedback = function (rating) {
  const self = this;
  const t = self._currentPlayingTrack();
  if (!t) {
    self.commandRouter.pushToastMessage('warning', 'AI Autopilot', self.t('FEEDBACK_NO_TRACK'));
    return libQ.resolve({});
  }
  self.feedback.record({
    uri: t.uri,
    artist: t.artist,
    title: t.title,
    rating: rating,
    source: 'button'
  });
  const label = (t.artist ? t.artist + ' — ' : '') + t.title;
  const key = rating === 'like' ? 'FEEDBACK_LIKED' : 'FEEDBACK_DISLIKED';
  self.commandRouter.pushToastMessage('success', 'AI Autopilot',
    self.t(key).replace('{{track}}', label));
  self.logger.info('[ai_autopilot] BUTTON feedback ' + rating + ': "' + label + '"');
  return libQ.resolve({});
};

AiAutopilot.prototype.showRemoteUrl = function () {
  const self = this;
  let host = null;
  // Try to discover the Volumio host's LAN IP from the OS.
  try {
    const os = require('os');
    const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach((name) => {
      (ifs[name] || []).forEach((iface) => {
        if (!iface.internal && iface.family === 'IPv4' && !host) host = iface.address;
      });
    });
  } catch (e) {}
  const port = Number(self.config.get('http_api_port', 8488)) || 8488;
  const urlStr = 'http://' + (host || 'volumio.local') + ':' + port + '/';
  self.logger.info('[ai_autopilot] Remote URL: ' + urlStr);
  const msg = self.t('REMOTE_URL_TOAST').replace('{{url}}', urlStr);
  self.commandRouter.pushToastMessage('info', 'AI Autopilot', msg);
  return libQ.resolve({});
};

AiAutopilot.prototype.likeCurrent = function () {
  return this._recordFeedback('like');
};

AiAutopilot.prototype.dislikeCurrent = function () {
  return this._recordFeedback('dislike');
};

AiAutopilot.prototype.feedbackStatus = function () {
  const self = this;
  const snap = self.feedback.snapshot({ maxLikes: 20, maxDislikes: 20 });
  const likeNames = snap.likes.map((l) => (l.artist ? l.artist + ' — ' : '') + l.title);
  const disNames = snap.dislikes.map((d) =>
    (d.artist ? d.artist + ' — ' : '') + d.title + (d.source === 'skip' ? ' (skip)' : ''));
  self.logger.info('[ai_autopilot] feedback LIKES (' + snap.likes.length + '): ' + JSON.stringify(likeNames));
  self.logger.info('[ai_autopilot] feedback DISLIKES (' + snap.dislikes.length + '): ' + JSON.stringify(disNames));
  const msg = self.t('FEEDBACK_SUMMARY')
    .replace('{{likes}}', String(snap.likes.length))
    .replace('{{dislikes}}', String(snap.dislikes.length));
  self.commandRouter.pushToastMessage('info', 'AI Autopilot', msg);
  return libQ.resolve({});
};

AiAutopilot.prototype.clearFeedback = function () {
  const self = this;
  if (self.feedback) self.feedback.clear();
  self.commandRouter.pushToastMessage('success', 'AI Autopilot', self.t('FEEDBACK_CLEARED'));
  return libQ.resolve({});
};

AiAutopilot.prototype.listSources = function () {
  const self = this;
  const categories = ['music_service', 'user_interface', 'system_controller',
    'miscellanea', 'audio_interface'];
  try {
    categories.forEach((cat) => {
      let names = [];
      try {
        names = self.commandRouter.pluginManager.getPluginNames(cat) || [];
      } catch (e) {
        names = ['<error:' + e.message + '>'];
      }
      self.logger.info('[ai_autopilot] plugins[' + cat + '] = ' + JSON.stringify(names));
    });

    // Also try a generic search to see which services actually return hits.
    const testQueries = ['jazz', 'radiohead'];
    testQueries.forEach((q) => {
      try {
        const res = self.commandRouter.volumioSearch({ value: q });
        libQ.resolve(res).then((sections) => {
          if (!Array.isArray(sections)) return;
          const svcs = sections.map((s) => ({
            service: s.service,
            plugin_name: s.plugin_name,
            title: s.title,
            items: (s.items || []).length
          }));
          self.logger.info('[ai_autopilot] search("' + q + '") services = ' + JSON.stringify(svcs));
        }).fail((e) => self.logger.error('[ai_autopilot] search err: ' + e.message));
      } catch (e) {
        self.logger.error('[ai_autopilot] search threw: ' + e.message);
      }
    });
  } catch (e) {
    self.logger.error('[ai_autopilot] listSources error: ' + e.message);
  }
  self.commandRouter.pushToastMessage('info', 'AI Autopilot', self.t('SOURCES_LISTED'));
  return libQ.resolve({});
};

AiAutopilot.prototype.dryRun = function () {
  const self = this;
  const defer = libQ.defer();

  const recommenderName = self.config.get('recommender', 'llm');
  const source = self.config.get('source', 'tidal');
  self.logger.info('[ai_autopilot] DRY RUN begin: recommender=' + recommenderName +
    ' source=' + source + ' historySize=' + (self.history ? self.history.all().length : 0));

  const RecClass = Recommenders[recommenderName];
  if (!RecClass) {
    defer.reject(new Error('Unknown recommender: ' + recommenderName));
    return defer.promise;
  }

  const recommender = new RecClass({
    config: self.configSnapshot(),
    logger: self.logger,
    log: (m) => self.log(m)
  });

  const history = self.history.recent();
  const fb = self.feedback ? self.feedback.snapshot({ maxLikes: 15, maxDislikes: 15 }) : { likes: [], dislikes: [] };

  recommender.recommend(history, fb)
    .then((pick) => {
      if (!pick || !pick.title) {
        self.commandRouter.pushToastMessage('warning', 'AI Autopilot', self.t('NO_RECOMMENDATION'));
        defer.resolve({});
        return;
      }
      const query = pick.artist ? pick.artist + ' ' + pick.title : pick.title;
      return self.searchSourceDiagnostic(source, query).then((diag) => {
        const label = (pick.artist ? pick.artist + ' — ' : '') + pick.title;
        self.logger.info('[ai_autopilot] DRY RUN pick=' + label +
          ' source=' + source +
          ' matches=' + diag.matched.length +
          ' allServices=' + JSON.stringify(diag.allServices) +
          ' sampleMatches=' + JSON.stringify(diag.matched.slice(0, 3).map(m => ({ service: m.service, uri: m.uri }))));
        const msg = self.t('DRY_RUN_RESULT')
          .replace('{{pick}}', label)
          .replace('{{source}}', source)
          .replace('{{count}}', String(diag.matched.length))
          .replace('{{services}}', diag.allServices.join(',') || 'none');
        self.commandRouter.pushToastMessage('info', 'AI Autopilot', msg);
        defer.resolve({});
      });
    })
    .catch((err) => {
      self.logger.error('[ai_autopilot] dryRun error: ' + (err && err.stack ? err.stack : err));
      self.commandRouter.pushToastMessage('error', 'AI Autopilot', err.message || String(err));
      defer.reject(err);
    });

  return defer.promise;
};

// ---------- Core logic ----------

AiAutopilot.prototype.applyTriggerConfig = function () {
  const self = this;
  if (!self.monitor) return;
  self.monitor.setConfig({
    trigger_mode: self.config.get('trigger_mode', 'keep_ahead'),
    keep_ahead_count: self.config.get('keep_ahead_count', 3),
    enabled: self.config.get('enabled', true)
  });
  self.monitor.setCooldown(Number(self.config.get('cooldown_sec', 5)) * 1000);
  self.monitor.setVerbose(self.config.get('verbose_log', false));
};

AiAutopilot.prototype.handleTrackPlayed = function (track) {
  const self = this;
  if (!track || !track.title) return;
  if (localQobuzTrackIdFromUri(track.uri)) {
    self.log('Local Qobuz cache playback; history unchanged for ' + track.uri);
  } else {
    self.history.push({
      title: track.title,
      artist: track.artist,
      album: track.album,
      service: track.service,
      uri: track.uri,
      at: Date.now()
    });
    self.log('Recorded history: ' + track.artist + ' — ' + track.title);
  }
  self.prefetchUpcoming().catch((e) => {
    self.logger.error('[ai_autopilot] Qobuz prefetch failed: ' + (e && e.message ? e.message : e));
  });
};

AiAutopilot.prototype.handleTrackSkipped = function (track) {
  const self = this;
  if (!track || !track.title) return;
  if (localQobuzTrackIdFromUri(track.uri)) {
    self.log('Local Qobuz cache skip ignored for feedback: ' + track.uri);
    return;
  }
  const useSkip = !!self.config.get('feedback_use_skip', false);
  if (!useSkip) {
    self.logger.info('[ai_autopilot] skip detected but feedback_use_skip=OFF; ignoring: "' +
      (track.artist || '?') + ' — ' + track.title + '"');
    return;
  }
  self.feedback.record({
    uri: track.uri,
    artist: track.artist,
    title: track.title,
    rating: 'dislike',
    source: 'skip'
  });
  self.logger.info('[ai_autopilot] SKIP feedback recorded: "' + (track.artist || '?') + ' — ' + track.title + '"');
};

AiAutopilot.prototype.handleAutoTrigger = function () {
  const self = this;
  if (!self.config.get('enabled', true)) return;
  if (self.config.get('quiet_mode_enabled', false) && self._isLocalQobuzCachePlayback()) {
    self.log('quiet mode: auto trigger paused during local cache playback');
    return;
  }
  return self.pickAndQueue().fail((err) => {
    self.logger.error('[ai_autopilot] auto trigger failed: ' + err.message);
  });
};

AiAutopilot.prototype.pickAndQueue = function () {
  const self = this;
  const defer = libQ.defer();
  const t0 = Date.now();

  const recommenderName = self.config.get('recommender', 'llm');
  const source = self.config.get('source', 'auto');
  const provider = self.config.get('llm_provider', 'anthropic');
  const historySize = self.history ? self.history.all().length : 0;
  self.logger.info('[ai_autopilot] PICK begin: recommender=' + recommenderName +
    ' llm_provider=' + provider + ' source=' + source + ' historySize=' + historySize);

  const RecClass = Recommenders[recommenderName];
  if (!RecClass) {
    defer.reject(new Error('Unknown recommender: ' + recommenderName));
    return defer.promise;
  }

  const recommender = new RecClass({
    config: self.configSnapshot(),
    logger: self.logger,
    log: (m) => self.log(m)
  });

  const history = self.history.recent();
  const fb = self.feedback ? self.feedback.snapshot({ maxLikes: 15, maxDislikes: 15 }) : { likes: [], dislikes: [] };
  self.logger.info('[ai_autopilot] PICK feedback ctx: likes=' + fb.likes.length + ' dislikes=' + fb.dislikes.length);

  recommender
    .recommend(history, fb)
    .then((pick) => {
      const recT = Date.now() - t0;
      if (!pick || !pick.title) {
        self.logger.info('[ai_autopilot] PICK: recommender returned nothing (' + recT + 'ms)');
        self.commandRouter.pushToastMessage('warning', 'AI Autopilot', self.t('NO_RECOMMENDATION'));
        defer.resolve({});
        return;
      }
      const label = (pick.artist ? pick.artist + ' — ' : '') + pick.title;
      self.logger.info('[ai_autopilot] PICK got "' + label + '" in ' + recT + 'ms; resolving on ' + source);
      return self.resolveAndQueue(pick).then(() => {
        self.logger.info('[ai_autopilot] QUEUED "' + label + '" (total ' + (Date.now() - t0) + 'ms)');
        self.commandRouter.pushToastMessage(
          'success',
          'AI Autopilot',
          self.t('TRACK_QUEUED').replace('{{track}}', label)
        );
        defer.resolve({});
      });
    })
    .catch((err) => {
      const msg = err && err.message ? err.message : String(err);
      self.logger.error('[ai_autopilot] PICK FAIL after ' + (Date.now() - t0) + 'ms: ' + (err && err.stack ? err.stack : err));
      self.commandRouter.pushToastMessage('error', 'AI Autopilot', msg);
      defer.reject(err);
    });

  return defer.promise;
};

// Resolve pick via the chosen source plugin and enqueue it.
AiAutopilot.prototype.resolveAndQueue = function (pick) {
  const self = this;
  const source = self.config.get('source', 'auto');
  const query = pick.artist ? pick.artist + ' ' + pick.title : pick.title;

  return self.searchSourceDiagnostic(source, query).then((diag) => {
    self.logger.info('[ai_autopilot] resolve: query="' + query + '" matches=' + diag.matched.length +
      ' services=[' + diag.allServices.join(',') + ']' +
      (diag.fallbackUsed ? ' (fallback used)' : ''));
    if (!diag.matched || diag.matched.length === 0) {
      throw new Error('No ' + source + ' tracks for "' + query + '". Services searched: ' +
        (diag.allServices.join(',') || 'none'));
    }

    // Filter out results that collide with recent albums/artists.
    const albumWin = Math.max(0, Number(self.config.get('avoid_same_album_window', 10)) || 0);
    const artistWin = Math.max(0, Number(self.config.get('avoid_same_artist_window', 0)) || 0);
    const histItems = self.history ? self.history.all() : [];
    const recentAlbums = new Set(
      albumWin > 0 ? histItems.slice(-albumWin).map((t) => (t.album || '').toLowerCase()).filter(Boolean) : []
    );
    const recentArtists = new Set(
      artistWin > 0 ? histItems.slice(-artistWin).map((t) => (t.artist || '').toLowerCase()).filter(Boolean) : []
    );

    const filtered = diag.matched.filter((m) => {
      const a = (m.album || '').toLowerCase();
      const ar = (m.artist || '').toLowerCase();
      if (a && recentAlbums.has(a)) return false;
      if (ar && recentArtists.has(ar)) return false;
      return true;
    });
    const chosen = filtered.length ? filtered : diag.matched; // if all filtered out, fall back
    if (filtered.length === 0 && (recentAlbums.size || recentArtists.size)) {
      self.logger.info('[ai_autopilot] all search results collided with recent album/artist; using first result anyway');
    } else if (filtered.length < diag.matched.length) {
      self.logger.info('[ai_autopilot] filtered ' + (diag.matched.length - filtered.length) +
        ' duplicate-album/artist results');
    }
    const item = chosen[0];
    self.logger.info('[ai_autopilot] adding to queue: service=' + item.service + ' uri=' + item.uri +
      ' album="' + (item.album || '') + '" artist="' + (item.artist || '') + '"');
    // addQueueItems returns a kew/native promise directly; do not wrap in nfcall.
    const p = self.commandRouter.addQueueItems([item]);
    return libQ.resolve(p)
      .then((res) => {
        try {
          self.logger.info('[ai_autopilot] addQueueItems returned: ' +
            (res === undefined ? 'undefined' : JSON.stringify(res).slice(0, 300)));
        } catch (e) {
          self.logger.info('[ai_autopilot] addQueueItems returned (unserializable)');
        }
        return res;
      })
      .fail((err) => {
        self.logger.error('[ai_autopilot] addQueueItems failed: ' + (err && err.message ? err.message : err));
        throw err;
      });
  });
};

// Search across installed plugins; filter by source service.
AiAutopilot.prototype.searchSource = function (source, query) {
  return this.searchSourceDiagnostic(source, query).then((d) => d.matched);
};

// Same search, but also returns all services seen (for diagnosis).
AiAutopilot.prototype.searchSourceDiagnostic = function (source, query) {
  const self = this;
  const defer = libQ.defer();

  const serviceAliases = {
    tidal: ['tidal', 'tidalapi', 'tidal_connect', 'tidal2'],
    qobuz: ['qobuz', 'volumio_qobuz', 'my_qobuz'],
    mpd:   ['mpd']
  };
  const wantAny = (source === 'auto');
  const want = new Set(serviceAliases[source] || [source]);

  self.logger.info('[ai_autopilot] searching query="' + query + '" source=' + source);

  // Try commandRouter.volumioSearch first; if empty, fall back to REST API.
  let results;
  try {
    results = self.commandRouter.volumioSearch({ value: query });
    self.logger.info('[ai_autopilot] volumioSearch returned type=' +
      (results === null ? 'null' : typeof results) +
      ' isArray=' + Array.isArray(results) +
      ' isPromise=' + (results && typeof results.then === 'function'));
  } catch (e) {
    self.logger.error('[ai_autopilot] volumioSearch threw: ' + e.message);
    results = null;
  }

  const toSections = (val) => {
    if (Array.isArray(val)) return val;
    if (val && Array.isArray(val.navigation)) return val.navigation.lists || [];
    if (val && Array.isArray(val.lists)) return val.lists;
    return null;
  };

  libQ.resolve(results)
    .then((raw) => {
      const sectionsFromPrimary = toSections(raw);
      self.logger.info('[ai_autopilot] primary search keys=' +
        (raw && typeof raw === 'object' ? JSON.stringify(Object.keys(raw).slice(0,10)) : 'n/a') +
        ' sections=' + (sectionsFromPrimary ? sectionsFromPrimary.length : 'null'));
      if (sectionsFromPrimary && sectionsFromPrimary.length > 0) return sectionsFromPrimary;
      // Fallback: REST API
      return self._restSearch(query);
    })
    .then((sections) => {
      const diag = { matched: [], allServices: [], fallbackUsed: false };
      if (!sections || !Array.isArray(sections)) {
        defer.resolve(diag);
        return;
      }
      const seen = new Set();
      const svcOfItem = (it, fallback) => {
        if (it && it.service) return String(it.service).toLowerCase();
        if (it && it.uri) {
          const m = String(it.uri).match(/^([a-z0-9_-]+):\/\//i);
          if (m) return m[1].toLowerCase();
        }
        return (fallback || '').toLowerCase();
      };
      sections.forEach((section) => {
        const secSvc = (section.service || section.plugin_name || '').toLowerCase();
        (section.items || []).forEach((it) => {
          const svc = svcOfItem(it, secSvc);
          if (svc && !seen.has(svc)) { seen.add(svc); diag.allServices.push(svc); }
          if (!wantAny && !want.has(svc)) return;
          if (!it.uri) return;
          if (it.type && !(it.type === 'song' || it.type === 'track')) return;
          diag.matched.push({
            service: svc,
            uri: it.uri,
            title: it.title,
            artist: it.artist,
            album: it.album,
            albumart: it.albumart,
            type: 'song'
          });
        });
      });
      if (diag.matched.length === 0 && !wantAny) {
        // fallback: accept any music_service result (but flag it)
        diag.fallbackUsed = true;
        sections.forEach((section) => {
          const secSvc = (section.service || '').toLowerCase();
          (section.items || []).forEach((it) => {
            const svc = svcOfItem(it, secSvc);
            if (!it.uri) return;
            if (it.type && !(it.type === 'song' || it.type === 'track')) return;
            diag.matched.push({
              service: svc,
              uri: it.uri,
              title: it.title,
              artist: it.artist,
              album: it.album,
              albumart: it.albumart,
              type: 'song'
            });
          });
        });
      }
      defer.resolve(diag);
    })
    .fail((err) => defer.reject(err));

  return defer.promise;
};

// Fallback search via Volumio's local REST API.
AiAutopilot.prototype._restSearch = function (query) {
  const self = this;
  const fetch = require('node-fetch');
  const url = 'http://localhost:3000/api/v1/search?query=' + encodeURIComponent(query);
  self.logger.info('[ai_autopilot] REST fallback -> ' + url);
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error('REST search status ' + res.status);
      return res.json();
    })
    .then((data) => {
      // Shape is usually { navigation: { lists: [ {title, availableListViews, items, plugin_name?, ...} ] } }
      let sections = [];
      if (data && data.navigation && Array.isArray(data.navigation.lists)) {
        sections = data.navigation.lists;
      } else if (Array.isArray(data)) {
        sections = data;
      }
      self.logger.info('[ai_autopilot] REST search sections=' + sections.length +
        ' shape=' + (Array.isArray(data) ? 'array' : (data && data.navigation ? 'navigation' : 'unknown')));
      return sections;
    })
    .catch((err) => {
      self.logger.error('[ai_autopilot] REST search failed: ' + err.message);
      return [];
    });
};

// ---------- Helpers ----------

AiAutopilot.prototype.configSnapshot = function () {
  const self = this;
  const provider = self.config.get('llm_provider', 'anthropic');

  // Prefer per-provider key; fall back to legacy unified llm_api_key.
  const providerKey = self.config.get('llm_api_key_' + provider, '') || '';
  const legacyKey = self.config.get('llm_api_key', '') || '';
  const effectiveKey = providerKey || legacyKey;

  // Same for model: per-provider dropdown wins, custom text overrides everything.
  const customModel = (self.config.get('llm_model_custom', '') || '').trim();
  const providerModel = (self.config.get('llm_model_' + provider, '') || '').trim();
  const legacyModel = (self.config.get('llm_model', '') || '').trim();
  const effectiveModel = customModel || providerModel || legacyModel;

  return {
    recommender: self.config.get('recommender', 'llm'),
    llm_provider: provider,
    llm_api_key: effectiveKey,
    llm_model: effectiveModel,
    llm_base_url: self.config.get('llm_base_url', ''),
    llm_hints: self.config.get('llm_hints', ''),
    llm_system_prompt: self.config.get('llm_system_prompt', ''),
    energy_min: Number(self.config.get('energy_min', 0)),
    energy_max: Number(self.config.get('energy_max', 10)),
    avoid_same_album_window: Number(self.config.get('avoid_same_album_window', 10)),
    avoid_same_artist_window: Number(self.config.get('avoid_same_artist_window', 0)),
    lastfm_api_key: self.config.get('lastfm_api_key', ''),
    lastfm_user: self.config.get('lastfm_user', ''),
    spotify_client_id: self.config.get('spotify_client_id', ''),
    spotify_client_secret: self.config.get('spotify_client_secret', ''),
    spotify_refresh_token: self.config.get('spotify_refresh_token', '')
  };
};

// ---------- Quick remote panel (served by lib/http-api.js) ----------

// Recompute the effective llm_model / llm_api_key for the current provider.
// Mirrors the resolution done in saveRecommenderSettings.
AiAutopilot.prototype._resolveEffectiveLlm = function () {
  const self = this;
  const provider = self.config.get('llm_provider', 'anthropic');
  const customModel = (self.config.get('llm_model_custom', '') || '').trim();
  const preset = (self.config.get('llm_model_' + provider, '') || '').trim();
  self.config.set('llm_model', customModel || preset);
  self.config.set('llm_api_key', self.config.get('llm_api_key_' + provider, '') || '');
};

// Apply a prompt preset (respecting its selected sub-variant) into llm_system_prompt,
// without a toast. Used by the quick panel. Returns true if the preset exists.
AiAutopilot.prototype._applyPromptPresetById = function (id) {
  const self = this;
  const parent = Presets.PROMPTS.find((p) => p.id === id);
  if (!parent) return false;
  const subId = self.config.get('prompt_sub_' + id, '');
  const sub = subId && parent.subs && parent.subs.find((s) => s.id === subId);
  self.config.set('prompt_preset_selected', id);
  self.config.set('llm_system_prompt', sub ? sub.text : parent.text);
  return true;
};

// Read option lists straight from UIConfig.json so the panel never drifts from
// the main settings form. Cached after first read.
AiAutopilot.prototype._uiOptions = function (fieldId) {
  const self = this;
  try {
    if (!self._uiconfCache) {
      self._uiconfCache = fs.readJsonSync(path.join(__dirname, 'UIConfig.json'));
    }
    for (const section of (self._uiconfCache.sections || [])) {
      const field = (section.content || []).find((c) => c.id === fieldId);
      if (field && field.options) {
        return field.options.map((o) => ({
          value: o.value,
          label: (typeof o.label === 'string' && o.label.indexOf('TRANSLATE.') === 0)
            ? self.t(o.label.slice('TRANSLATE.'.length))
            : o.label
        }));
      }
    }
  } catch (e) {}
  return [];
};

// Apply a hint preset into llm_hints, without a toast. Used by the remote panel.
AiAutopilot.prototype._applyHintPresetById = function (id) {
  const self = this;
  const preset = Presets.HINTS.find((h) => h.id === id);
  if (!preset) return false;
  self.config.set('hint_preset_selected', id);
  self.config.set('llm_hints', preset.text || '');
  return true;
};

// Snapshot of everything the remote panel renders: now-playing, queue, feedback
// counts, the quick-editable settings, and their option lists.
AiAutopilot.prototype.getQuickState = function () {
  const self = this;

  let state = null;
  let queue = [];
  try { state = self.commandRouter.volumioGetState(); } catch (e) {}
  try {
    queue = self.commandRouter.volumioGetQueue() || [];
  } catch (e) {
    try { queue = self.commandRouter.stateMachine.getQueue() || []; } catch (e2) { queue = []; }
  }

  const stateLocalPlayback = localQobuzPlaybackFromState(state);
  const stateMeta = stateLocalPlayback.active ? (self._qobuzMetaFromQueue(stateLocalPlayback.trackId) || {}) : {};
  const track = state && (state.uri || state.title) ? {
    title: stateMeta.title || state.title || '',
    artist: stateMeta.artist || state.artist || '',
    album: stateMeta.album || state.album || '',
    albumart: stateMeta.albumart || state.albumart || '',
    uri: state.uri || '',
    qobuzTrackId: (stateLocalPlayback.trackId || qobuzTrackIdFromUri(state.uri) || ''),
    localPlayback: stateLocalPlayback.active,
    playbackSource: stateLocalPlayback.active ? 'local' : (qobuzTrackIdFromUri(state.uri) ? 'qobuz' : (state.service || '')),
    libraryUri: stateLocalPlayback.libraryUri,
    duration: Number(state.duration) || 0,
    seek: Number(state.seek) || 0,
    status: state.status || ''
  } : null;

  const pos = state && typeof state.position === 'number' ? state.position : -1;
  const localPlayback = localQobuzPlaybackFromState(state);
  const queueOut = (queue || []).map((q, i) => {
    const localTrackId = localQobuzTrackIdFromUri(q && q.uri);
    const qobuzTrackId = qobuzTrackIdFromUri(q && q.uri);
    if (qobuzTrackId) {
      self._rememberQobuzMeta(qobuzTrackId, {
        title: q.name || q.title || '',
        artist: q.artist || '',
        album: q.album || '',
        albumart: q.albumart || '',
        uri: q.uri || ''
      });
    }
    const trackId = qobuzTrackId || localTrackId;
    const playingLocal = !!(localPlayback.active && trackId && String(trackId) === String(localPlayback.trackId));
    const savedMeta = localTrackId ? (self._qobuzMetaFromQueue(localTrackId) || {}) : {};
    return {
      title: savedMeta.title || q.name || q.title || '',
      artist: savedMeta.artist || q.artist || '',
      album: savedMeta.album || q.album || '',
      albumart: savedMeta.albumart || q.albumart || '',
      uri: q.uri || '',
      current: i === pos || !!(playingLocal && localTrackId),
      source: localTrackId ? 'local' : (qobuzTrackId ? 'qobuz' : (q.service || '')),
      playingLocal,
      qobuzTrackId: trackId || '',
      download: trackId ? self._downloadStatus(trackId, localPlayback) : null
    };
  });

  let counts = { likes: 0, dislikes: 0 };
  let likesList = [];
  if (self.feedback) {
    const snap = self.feedback.snapshot({ maxLikes: 1000, maxDislikes: 1000 });
    counts = { likes: snap.likes.length, dislikes: snap.dislikes.length };
    likesList = self.feedback.snapshot({ maxLikes: 30, maxDislikes: 0 }).likes
      .map((it) => ({ artist: it.artist || '', title: it.title || '' }));
  }

  let volume = null;
  if (state && state.volume !== undefined && state.volume !== null) {
    const v = Number(state.volume);
    if (Number.isFinite(v)) volume = v;
  }
  const player = {
    status: (state && state.status) || 'stop',
    volume: volume,
    mute: !!(state && state.mute)
  };

  const provider = self.config.get('llm_provider', 'anthropic');
  let eMin = Number(self.config.get('energy_min', 0));
  let eMax = Number(self.config.get('energy_max', 10));
  if (!Number.isFinite(eMin)) eMin = 0;
  if (!Number.isFinite(eMax)) eMax = 10;

  const providers = self._uiOptions('llm_provider');
  const models = {};
  providers.forEach((p) => { models[p.value] = self._uiOptions('llm_model_' + p.value); });

  // Per-parent sub-variant option lists (so the panel can repopulate when mood changes).
  const promptSubs = {};
  Presets.PROMPTS.forEach((p) => {
    promptSubs[p.id] = [{ value: '', label: '(기본)' }]
      .concat((p.subs || []).map((s) => ({ value: s.id, label: s.name })));
  });
  const promptId = self.config.get('prompt_preset_selected', 'default');

  return {
    ok: true,
    track,
    player,
    queue: queueOut,
    counts,
    likes: likesList,
    settings: {
      enabled: !!self.config.get('enabled', true),
      energy_min: eMin,
      energy_max: eMax,
      // recommender / LLM
      llm_provider: provider,
      llm_model: (self.config.get('llm_model_' + provider, '') || '').trim(),
      has_key: provider === 'ollama' || !!((self.config.get('llm_api_key_' + provider, '') || '').trim()),
      // prompt-related
      prompt_preset_selected: promptId,
      prompt_sub_selected: self.config.get('prompt_sub_' + promptId, ''),
      hint_preset_selected: self.config.get('hint_preset_selected', 'none'),
      llm_system_prompt: self.config.get('llm_system_prompt', '') || '',
      llm_hints: self.config.get('llm_hints', '') || '',
      // general
      source: self.config.get('source', 'auto'),
      trigger_mode: self.config.get('trigger_mode', 'keep_ahead'),
      keep_ahead_count: Number(self.config.get('keep_ahead_count', 3)),
      cooldown_sec: Number(self.config.get('cooldown_sec', 5)),
      history_window: Number(self.config.get('history_window', 20)),
      avoid_same_album_window: Number(self.config.get('avoid_same_album_window', 10)),
      avoid_same_artist_window: Number(self.config.get('avoid_same_artist_window', 0)),
      // downloads
      download_enabled: !!self.config.get('download_enabled', false),
      download_quality: self._downloadQuality(),
      prefetch_count: Number(self.config.get('prefetch_count', 0)),
      quiet_mode_enabled: !!self.config.get('quiet_mode_enabled', false),
      qobuz_auth_token_saved: !!String(self.config.get('qobuz_auth_token', '') || '').trim(),
      qobuz_user_id_saved: !!String(self.config.get('qobuz_user_id', '') || '').trim()
    },
    options: {
      providers,
      models,
      prompts: Presets.PROMPTS.map((p) => ({ value: p.id, label: p.name })),
      promptSubs,
      hints: Presets.HINTS.map((h) => ({ value: h.id, label: h.name })),
      sources: self._uiOptions('source'),
      triggerModes: self._uiOptions('trigger_mode'),
      downloadQualities: self._uiOptions('download_quality')
    }
  };
};

// Apply a partial settings change from the remote panel, persist it, and return
// the fresh state. Only known keys are honored.
AiAutopilot.prototype.applyQuickChange = function (patch) {
  const self = this;
  patch = patch || {};
  let triggerDirty = false;

  if (patch.enabled !== undefined) {
    self.config.set('enabled', !!patch.enabled);
    triggerDirty = true;
  }

  if (patch.energy_min !== undefined || patch.energy_max !== undefined) {
    const clamp = (n, d) => {
      n = Number(n);
      if (!Number.isFinite(n)) n = d;
      return Math.max(0, Math.min(10, n));
    };
    let lo = patch.energy_min !== undefined ? clamp(patch.energy_min, 0) : clamp(self.config.get('energy_min', 0), 0);
    let hi = patch.energy_max !== undefined ? clamp(patch.energy_max, 10) : clamp(self.config.get('energy_max', 10), 10);
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    self.config.set('energy_min', lo);
    self.config.set('energy_max', hi);
  }

  if (patch.prompt_preset_selected !== undefined) {
    self._applyPromptPresetById(String(patch.prompt_preset_selected));
  }

  if (patch.llm_provider !== undefined) {
    self.config.set('llm_provider', String(patch.llm_provider));
    self._resolveEffectiveLlm();
  }

  if (patch.llm_model !== undefined) {
    const provider = self.config.get('llm_provider', 'anthropic');
    self.config.set('llm_model_' + provider, String(patch.llm_model));
    self._resolveEffectiveLlm();
  }

  // --- prompt-related ---
  // Sub-variant for the currently-selected parent preset; re-apply so the
  // effective system prompt updates to the chosen variant.
  if (patch.prompt_sub_selected !== undefined) {
    const parent = self.config.get('prompt_preset_selected', 'default');
    self.config.set('prompt_sub_' + parent, String(patch.prompt_sub_selected));
    self._applyPromptPresetById(parent);
  }
  if (patch.hint_preset_selected !== undefined) {
    self._applyHintPresetById(String(patch.hint_preset_selected));
  }
  if (patch.llm_system_prompt !== undefined) {
    self.config.set('llm_system_prompt', String(patch.llm_system_prompt));
  }
  if (patch.llm_hints !== undefined) {
    self.config.set('llm_hints', String(patch.llm_hints));
  }

  // --- general ---
  if (patch.source !== undefined) self.config.set('source', String(patch.source));
  if (patch.trigger_mode !== undefined) {
    self.config.set('trigger_mode', String(patch.trigger_mode));
    triggerDirty = true;
  }
  const intIn = (v, lo, hi, d) => {
    let n = parseInt(v, 10);
    if (!Number.isFinite(n)) n = d;
    return Math.max(lo, Math.min(hi, n));
  };
  if (patch.keep_ahead_count !== undefined) {
    self.config.set('keep_ahead_count', intIn(patch.keep_ahead_count, 1, 50, 3));
    triggerDirty = true;
  }
  if (patch.cooldown_sec !== undefined) {
    self.config.set('cooldown_sec', intIn(patch.cooldown_sec, 0, 3600, 5));
    triggerDirty = true;
  }
  if (patch.history_window !== undefined) {
    const hw = intIn(patch.history_window, 1, 200, 20);
    self.config.set('history_window', hw);
    if (self.history) self.history.setWindowSize(hw);
  }
  if (patch.avoid_same_album_window !== undefined) {
    self.config.set('avoid_same_album_window', intIn(patch.avoid_same_album_window, 0, 200, 10));
  }
  if (patch.avoid_same_artist_window !== undefined) {
    self.config.set('avoid_same_artist_window', intIn(patch.avoid_same_artist_window, 0, 200, 0));
  }

  if (patch.download_enabled !== undefined) self.config.set('download_enabled', !!patch.download_enabled);
  if (patch.quiet_mode_enabled !== undefined) self.config.set('quiet_mode_enabled', !!patch.quiet_mode_enabled);
  if (patch.prefetch_count !== undefined) {
    self.config.set('prefetch_count', intIn(patch.prefetch_count, 0, 20, 0));
  }
  if (patch.download_quality !== undefined) {
    const q = Number(patch.download_quality);
    if ([FORMAT.MP3_320, FORMAT.FLAC_16_44, FORMAT.FLAC_24_96, FORMAT.FLAC_24_192].indexOf(q) >= 0) {
      self.config.set('download_quality', q);
      self._qobuzClient = null;
    }
  }

  if (triggerDirty) self.applyTriggerConfig();
  return self.getQuickState();
};

// Transport / volume control from the remote panel. Driven through Volumio's own
// REST command API on localhost:3000 (the same endpoint the search fallback uses),
// which is more stable across Volumio versions than the in-process methods.
AiAutopilot.prototype.playerControl = function (action, value) {
  const self = this;
  let cmd = null;
  if (action === 'toggle')      cmd = 'toggle';
  else if (action === 'play')   cmd = 'play';
  else if (action === 'pause')  cmd = 'pause';
  else if (action === 'next')   cmd = 'next';
  else if (action === 'prev')   cmd = 'prev';
  else if (action === 'volume') {
    let v = Math.max(0, Math.min(100, Number(value)));
    if (!Number.isFinite(v)) v = 0;
    cmd = 'volume&volume=' + v;
  }
  else if (action === 'playindex') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n >= 0) cmd = 'play&N=' + n;
  }
  if (!cmd) return libQ.resolve(self.getQuickState());

  const url = 'http://localhost:3000/api/v1/commands/?cmd=' + cmd;
  const defer = libQ.defer();
  Promise.resolve()
    .then(() => fetch(url))
    .then(() => { defer.resolve(self.getQuickState()); })
    .catch((e) => {
      self.logger.error('[ai_autopilot] playerControl ' + action + ' error: ' + (e && e.message));
      defer.resolve(self.getQuickState());
    });
  return defer.promise;
};

AiAutopilot.prototype.log = function (msg) {
  const verbose = this.config && this.config.get('verbose_log', false);
  if (verbose) this.logger.info('[ai_autopilot] ' + msg);
};

AiAutopilot.prototype.t = function (key) {
  const self = this;
  try {
    const lang = self.commandRouter.sharedVars.get('language_code');
    const strings = require('./i18n/strings_' + lang + '.json');
    if (strings && strings[key]) return strings[key];
  } catch (e) {}
  try {
    const en = require('./i18n/strings_en.json');
    if (en[key]) return en[key];
  } catch (e) {}
  return key;
};

function valueOf(v) {
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}
