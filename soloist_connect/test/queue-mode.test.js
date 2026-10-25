// Queue-mode regression check for soloist_connect.
//
// Runs the queue-mode paths against captured event payloads.
// No daemon, no ALSA, no Volumio: the WebSocket send, the ALSA
// yield and the core state machine are stubbed, so this only asserts the
// decisions this plugin makes, which is exactly the part that is not visible
// from a listening test.
//
//   node test/queue-mode.test.js
//
// Exits non-zero on any failure.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const libQ = require('kew');
const SoloistConnect = require('../index.js');

const pushed = [];
const logs = [];
const queuePushes = [];
const nextCalls = [];
const browseAdds = [];
const browseRemoves = [];
const browsePushes = [];
const toasts = [];
let queueSaves = 0;
let startPlaybackTimerCalls = 0;

function makeCtx() {
  const sm = {
    isVolatile: false,
    volatileService: undefined,
    volatileCallback: undefined,
    currentPosition: 0,
    currentSongDuration: 0,
    playQueue: { arrayQueue: [], saveQueue() { queueSaves++; } },
    updateTrackBlock() {},
    startPlaybackTimer() { startPlaybackTimerCalls++; },
    next() { nextCalls.push(this.currentPosition); },
    setVolatile(d) { this.isVolatile = true; this.volatileService = d.service; this.volatileCallback = d.callback; },
    unSetVolatile() { if (this.volatileCallback) { this.volatileCallback.call(); this.volatileCallback = undefined; } this.isVolatile = false; this.volatileService = undefined; },
    setConsumeUpdateService() {},
  };
  const coreCommand = {
    stateMachine: sm,
    volumioGetState() { return { service: 'other' }; },
    volumiosetvolume(v) { logs.push('mixer ' + v); },
    volumioStop() { return { then: (f) => { f(); return { then: (g) => { g(); return { fail: () => {} }; } }; } }; },
    pluginManager: { getPlugin: () => null },
    servicePushState(state) { pushed.push(JSON.parse(JSON.stringify(state))); },
    volumioPushQueue(q) { queuePushes.push(JSON.parse(JSON.stringify(q))); },
    volumioAddToBrowseSources(data) { browseAdds.push(data); },
    volumioRemoveToBrowseSources(name) { browseRemoves.push(name); },
    broadcastMessage(emit, payload) { browsePushes.push({ emit, payload }); },
    getUIConfigOnPlugin() { return libQ.resolve({ sections: [] }); },
    pushToastMessage(type, title, msg) { toasts.push({ type, title, msg }); },
    reboot() { logs.push('reboot'); },
    closeModals() { logs.push('closeModals'); },
    getI18nString(key) {
      if (key === 'COMMON.CANCEL') return 'Cancel';
      if (key === 'COMMON.GOT_IT') return 'Got it';
      if (key === 'COMMON.RESTART') return 'Restart';
      return key;
    },
  };
  return {
    coreCommand,
    logger: {
      info: (m) => logs.push('info ' + m),
      error: (m) => logs.push('error ' + m),
      warn: (m) => logs.push('warn ' + m),
    },
    configManager: {},
  };
}

function newPlugin(config) {
  const ctx = makeCtx();
  const p = new SoloistConnect(ctx);
  p.commandRouter = ctx.coreCommand;
  const settings = Object.assign({ queue_playback: true }, config || {});
  p.config = { get: (key) => settings[key] };
  p.loggedIn = true;
  // Measured: is_active is true for a play we issue ourselves, with the app
  // closed. The other case is exercised explicitly in test 22.
  p.deviceActive = true;
  // no daemon socket and no sound card in the harness
  p.sendCommand = function (payload) { logs.push('cmd ' + JSON.stringify(payload)); };
  p.requestAlsaYield = function () { logs.push('yield requested'); };
  p.clearAlsaYield = function () { logs.push('yield cleared'); };
  p.alsaHeldByUs = function () { return false; };
  p.updateQuality = function () {};
  p.fetchAudioSpec = function () {};
  return p;
}

function writablePlugin(config, backupDir) {
  const settings = Object.assign({
    api_key: 'spak_test',
    device_name: 'Volumio',
    retain_api_key: true,
    initial_volume: 50,
    align_volume: false,
    output_trim_db: 0,
    buffer_ms: 500,
    cache_location: 'disk',
    cache_size_mb: 1024,
    seek_coalesce_ms: 200,
    inactive_hold_ms: 2000,
    quality_retry_ms: 300,
    quality_retry_max: 2,
    queue_fetch_ms: 2500,
    queue_playback: false,
    queue_remote_playback: false,
    verbose_logging: false,
    loudness_normalization: true,
    crossfade: false,
    crossfade_ms: 2000,
    auto_update_binary: false,
    peppy_metering: false,
  }, config || {});
  const p = newPlugin(settings);
  p.config = {
    get: (key) => settings[key],
    set: (key, value) => { settings[key] = value; },
    has: (key) => Object.prototype.hasOwnProperty.call(settings, key),
  };
  p._settingsBackupDir = backupDir;
  p.startDaemon = function () {
    logs.push('startDaemon');
    return libQ.resolve();
  };
  p.connectWebSocket = function () { logs.push('connectWebSocket'); };
  p.syncBrowseSource = function () { logs.push('syncBrowseSource'); };
  p.clearPendingSeek = function () {};
  p.ramCacheSizeMb = function () { return 0; };
  return p;
}

function makeBackupDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-bak-'));
}

// A queue holding one Spotify row at position 0, which is what
// queueRowIsCurrent checks the start deadline against.
function armQueue(p, uri) {
  const sm = p.context.coreCommand.stateMachine;
  sm.currentPosition = 0;
  sm.playQueue.arrayQueue = [{
    uri: uri,
    service: 'soloist_connect',
    name: 'Spotify track',
    title: 'Spotify track',
    artist: '',
    album: '',
    albumart: '/albumart',
    duration: 0,
  }];
  return sm;
}

const OURS = 'spotify:track:3Che0Dm9dlytqujcprVAwE';
const ROLLED = 'spotify:track:567e29TDzLwZwfDuEpGTwo';

const item = {
  uri: OURS,
  entity_type: 'track',
  decorations: {
    identity: { name: 'Heat Waves' },
    visual_identity: { cover: [
      { url: 'small.jpg', size: 'small' },
      { url: 'large.jpg', size: 'large' },
    ] },
    parent: { entity: { uri: 'spotify:album:0E2xXn23qVmfx9ThZjWFBE', decorations: { identity: { name: 'Dreamland' } } } },
    creators: [
      { entity: { decorations: { identity: { name: 'Glass Animals' } } } },
      { entity: { decorations: { identity: { name: 'iann dior' } } } },
    ],
    playback: { duration_ms: 175301 },
  },
};

const rolledItem = JSON.parse(JSON.stringify(item));
rolledItem.uri = ROLLED;
rolledItem.decorations.identity.name = 'Something Else';
rolledItem.decorations.playback.duration_ms = 142000;

function evt(status, uri, positionMs, contextUri, useItem, isActive) {
  return {
    type: 'playback_state',
    status: status,
    item: useItem,
    context: { uri: contextUri, entity_type: 'track', decorations: {} },
    position: { position_ms: positionMs, timestamp_ms: Date.now(), speed: status === 'playing' ? 1 : 0 },
    is_active: isActive === undefined ? true : isActive,
  };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('PASS ' + name);
  } else {
    failures++;
    console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
  }
}

// 1. metadata parser
{
  const p = newPlugin();
  const m = p.itemMeta(item);
  check('itemMeta title', m.title === 'Heat Waves', m.title);
  check('itemMeta artist', m.artist === 'Glass Animals, iann dior', m.artist);
  check('itemMeta album', m.album === 'Dreamland', m.album);
  check('itemMeta duration', m.durationMs === 175301, String(m.durationMs));
  check('itemMeta art prefers large', m.albumart === 'large.jpg', m.albumart);
}

async function main() {
  // 2. explodeUri before and after the cache has seen the track
  {
    const p = newPlugin();
    const out = await p.explodeUri(OURS);
    check('explodeUri unseen returns one row', out && out.length === 1);
    check('explodeUri unseen is honest', out[0].name === 'Spotify track', out[0].name);
    check('explodeUri carries service', out[0].service === 'soloist_connect', out[0].service);

    p.cacheItem(item);
    const out2 = await p.explodeUri(OURS);
    check('explodeUri cached name', out2[0].name === 'Heat Waves', out2[0].name);
    check('explodeUri cached duration s', out2[0].duration === 175, String(out2[0].duration));

    const bad = await p.explodeUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    check('explodeUri refuses playlist', Array.isArray(bad) && bad.length === 0);
  }

  // 3. clearAddPlayTrack enters queue mode and does not go volatile
  {
    const p = newPlugin();
    p.cacheItem(item);
    await p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    check('queue mode entered', p.queueMode === true);
    check('queue uri recorded', p.queueUri === OURS);
    check('not volatile', p.volatileSet === false);
    check('core not volatile', p.context.coreCommand.stateMachine.isVolatile === false);
    check('play sent with uri', logs.some((l) => l === 'cmd {"command":"play","uri":"' + OURS + '"}'));
    check('metadata prefilled from cache', p.state.title === 'Heat Waves', p.state.title);
  }

  // 4. no session -> the row is skipped, core gets a stop
  {
    const p = newPlugin();
    p.loggedIn = false;
    pushed.length = 0;
    nextCalls.length = 0;
    await p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    await new Promise((r) => setImmediate(r));
    check('skip does not publish stop', pushed.length === 0,
      JSON.stringify(pushed[0] || null));
    check('skip advances with next()', nextCalls.length === 1, String(nextCalls.length));
    check('skip left queue mode', p.queueMode === false);
  }

  // 5. mid-track buffering is not the end of the row
  {
    const p = newPlugin();
    p.cacheItem(item);
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    const consumed = p.checkQueueRow(evt('buffering', OURS, 305, OURS, item), OURS);
    check('mid-track buffering ignored', consumed === false && p.queueMode === true);
  }

  // 6. the real end-of-row event from the trace
  {
    const p = newPlugin();
    p.cacheItem(item);
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.state.duration = 175;
    pushed.length = 0;
    const consumed = p.checkQueueRow(evt('buffering', OURS, 175301, OURS, item), OURS);
    check('end of row consumed', consumed === true);
    check('end of row published stop', pushed.length === 1 && pushed[0].status === 'stop',
      JSON.stringify(pushed[0] || null));
    check('end of row paused soloist', logs.some((l) => l === 'cmd {"command":"pause"}'));
    check('end of row yielded alsa', logs.some((l) => l === 'yield requested'));
    check('end of row is once only',
      p.checkQueueRow(evt('buffering', OURS, 175301, OURS, item), OURS) === false &&
      pushed.length === 1);
    check('end of row left queue mode', p.queueMode === false);
  }

  // 7. the roll into autoplay, if the buffering event were missed
  {
    const p = newPlugin();
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    pushed.length = 0;
    const consumed = p.checkQueueRow(evt('buffering', ROLLED, 0, OURS, rolledItem), ROLLED);
    check('roll consumed', consumed === true);
    check('roll published stop', pushed.length === 1 && pushed[0].status === 'stop');
  }

  // 8. the phone starting a playlist ends queue mode, does not end the row
  {
    const p = newPlugin();
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    pushed.length = 0;
    const consumed = p.checkQueueRow(
      evt('playing', ROLLED, 0, 'spotify:playlist:37i9dQZEVXcUnNfzphGkKK', rolledItem), ROLLED);
    check('foreign context not consumed', consumed === false);
    check('foreign context left queue mode', p.queueMode === false);
    check('foreign context did not report stop', pushed.length === 0);
  }

  // 9. idle mapping differs by mode
  {
    const p = newPlugin();
    p.state.status = 'play';
    check('idle stays play in connect mode', p.mapStatus('idle') === 'play');
    p.queueMode = true;
    check('idle is stop in queue mode', p.mapStatus('idle') === 'stop');
  }

  // 10. queue_changed harvests metadata for later rows
  {
    const p = newPlugin();
    pushed.length = 0;
    logs.length = 0;
    p.handleEvent({ type: 'queue_changed', previous: [{ item: item }], upcoming: [{ item: rolledItem }] });
    check('cached from queue_changed previous', p.trackCache.has(OURS));
    check('cached from queue_changed upcoming', p.trackCache.has(ROLLED));
    check('queue_changed keeps previous', p.spotifyQueue.previous.length === 1);
    check('queue_changed keeps upcoming', p.spotifyQueue.upcoming.length === 1);
    check('queue_changed does not enter queue mode', p.queueMode === false);
    check('queue_changed does not publish state', pushed.length === 0);
    check('queue_changed does not send a command', logs.length === 0, logs.join(' | '));
  }

  // 11. the seek path works in both modes
  //
  // Every one of these used to be gated on volatileSet, so in a queue row the
  // seek command was never sent and a jump was never republished: the bar
  // moved and the audio did not.
  {
    const p = newPlugin();
    p.seekCoalesceMs = () => 0;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    logs.length = 0;
    p.seek(90000);
    check('queue mode sends seek to soloist',
      logs.some((l) => l === 'cmd {"command":"seek","position_ms":90000}'),
      logs.join(' | '));

    p.state.status = 'play';
    p.state.duration = 175;
    p.positionAnchor = { position_ms: 10000, timestamp_ms: Date.now(), speed: 1 };
    pushed.length = 0;
    p.handleEvent({
      type: 'position_sync',
      position: { position_ms: 90000, timestamp_ms: Date.now(), speed: 1 },
    });
    check('queue mode republishes a seek jump',
      pushed.length === 1 && Math.abs(pushed[0].seek - 90000) < 500,
      JSON.stringify(pushed[0] || null));

    check('ownership is true in queue mode', p.owningPlayback() === true);
    p.queueMode = false;
    check('ownership is false when we own nothing', p.owningPlayback() === false);
    p.volatileSet = true;
    check('ownership is true in connect mode', p.owningPlayback() === true);
  }

  // 12. the queue row is filled from the daemon's metadata
  //
  // In queue mode the UI reads the queue row, not our published state, and
  // explodeUri can only fill that row from URIs Soloist has already named. A
  // track it has never mentioned queued with no artwork and duration 0.
  {
    const p = newPlugin();
    const sm = p.context.coreCommand.stateMachine;
    sm.currentPosition = 0;
    sm.playQueue.arrayQueue = [{
      uri: OURS,
      service: 'soloist_connect',
      name: 'Spotify track',
      title: 'Spotify track',
      artist: '',
      album: '',
      albumart: '/albumart',
      duration: 0,
    }];
    queuePushes.length = 0;
    queueSaves = 0;
    startPlaybackTimerCalls = 0;
    sm.currentSongDuration = 0;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.applyItem(item);
    const row = sm.playQueue.arrayQueue[0];
    check('queue row name filled', row.name === 'Heat Waves', row.name);
    check('queue row artist filled', row.artist === 'Glass Animals, iann dior', row.artist);
    check('queue row album filled', row.album === 'Dreamland', row.album);
    check('queue row albumart filled', row.albumart === 'large.jpg', row.albumart);
    check('queue row duration filled', row.duration === 175, String(row.duration));
    check('queue push emitted', queuePushes.length === 1, String(queuePushes.length));
    check('queue saved', queueSaves === 1, String(queueSaves));
    check('duration written onto the running timer',
      sm.currentSongDuration === 175000, String(sm.currentSongDuration));
    check('startPlaybackTimer not called', startPlaybackTimerCalls === 0,
      String(startPlaybackTimerCalls));

    queuePushes.length = 0;
    p.applyItem(item);
    check('unchanged row does not push again', queuePushes.length === 0);
  }

  // 13. a row that is not ours is never touched
  {
    const p = newPlugin();
    const sm = p.context.coreCommand.stateMachine;
    sm.currentPosition = 0;
    sm.playQueue.arrayQueue = [{
      uri: 'mnt/INTERNAL/Adele/21/Don\'t You Remember.mp3',
      service: 'mpd',
      name: 'Don\'t You Remember',
      albumart: '/albumart?cacheid=113',
      duration: 243,
    }];
    queuePushes.length = 0;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.applyItem(item);
    check('foreign row untouched', sm.playQueue.arrayQueue[0].name === 'Don\'t You Remember');
    check('foreign row no push', queuePushes.length === 0);
  }

  // 14. Connect mode never writes to the queue
  {
    const p = newPlugin();
    const sm = p.context.coreCommand.stateMachine;
    sm.currentPosition = 0;
    sm.playQueue.arrayQueue = [{ uri: OURS, service: 'soloist_connect', name: 'Spotify track', duration: 0 }];
    queuePushes.length = 0;
    p.volatileSet = true;
    p.applyItem(item);
    check('connect mode leaves the queue alone',
      sm.playQueue.arrayQueue[0].name === 'Spotify track' && queuePushes.length === 0);
  }

  // 15. a row that never starts does not hang the mixed list
  //
  // A play issued while another device holds the Connect session is accepted
  // and then produces no local playback and no event. Without the deadline the
  // queue waits for a row that will never start.
  {
    const p = newPlugin();
    armQueue(p, OURS);
    p.queueStartTimeoutMs = () => 40;
    pushed.length = 0;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    check('start deadline armed', p.queueStartTimer !== null);
    await new Promise((r) => setTimeout(r, 90));
    check('stalled row reported stop', pushed.length === 1 && pushed[0].status === 'stop',
      JSON.stringify(pushed[0] || null));
    check('stalled row cleared its timer', p.queueStartTimer === null);
    check('stalled row left queue mode', p.queueMode === false);
  }

  // 16. a row that does start cancels the deadline
  {
    const p = newPlugin();
    armQueue(p, OURS);
    p.queueStartTimeoutMs = () => 40;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.checkQueueRow(evt('playing', OURS, 500, OURS, item), OURS);
    check('playing cancels the deadline', p.queueStartTimer === null);
    pushed.length = 0;
    await new Promise((r) => setTimeout(r, 90));
    check('started row is not skipped', pushed.length === 0 && p.queueMode === true);
  }

  // 16b. a deadline must not outlive the row it was armed for
  //
  // Core does not call our stop() on an advance, so a timer armed for one row
  // can fire while a different row is playing. Firing then reports a stop for
  // whatever core is on now, skipping an innocent track.
  {
    const p = newPlugin();
    const sm = armQueue(p, OURS);
    p.queueStartTimeoutMs = () => 40;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    // core moves on without telling us
    sm.currentPosition = 1;
    sm.playQueue.arrayQueue.push({ uri: 'mnt/local.mp3', service: 'mpd', duration: 100 });
    pushed.length = 0;
    await new Promise((r) => setTimeout(r, 90));
    check('stale deadline reports nothing', pushed.length === 0,
      JSON.stringify(pushed[0] || null));
  }

  // 17. the session moving to another device ends the row, it does not reclaim
  //
  // Reclaiming here ran takeOverPlayback, which calls volumioStop and grabs the
  // device while core was already starting the next row. MPD opened a card we
  // had not released and failed with "Device or resource busy".
  {
    const p = newPlugin();
    let takeovers = 0;
    p.takeOverPlayback = function () { takeovers++; };
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.state.status = 'play';
    p.state.duration = 175;
    pushed.length = 0;
    logs.length = 0;
    const consumed = p.checkQueueRow(
      evt('paused', ROLLED, 0, 'spotify:station:track:' + OURS.split(':')[2], rolledItem, false),
      ROLLED);
    check('transfer away is consumed', consumed === true);
    check('transfer away reported stop', pushed.length === 1 && pushed[0].status === 'stop',
      JSON.stringify(pushed[0] || null));
    check('transfer away yielded before core moves on',
      logs.indexOf('yield requested') !== -1);
    check('transfer away did not reclaim', takeovers === 0, String(takeovers));
    check('transfer away left queue mode', p.queueMode === false);
  }

  // 18. the session starting here still reclaims
  {
    const p = newPlugin();
    let takeovers = 0;
    p.takeOverPlayback = function () { takeovers++; };
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.state.status = 'play';
    pushed.length = 0;
    const consumed = p.checkQueueRow(
      evt('playing', ROLLED, 0, 'spotify:playlist:37i9dQZEVXcUnNfzphGkKK', rolledItem, true),
      ROLLED);
    check('local takeover not consumed', consumed === false);
    check('local takeover reclaims', takeovers === 1, String(takeovers));
    check('local takeover reports no stop', pushed.length === 0);
  }

  // 19. the settings gate
  {
    const off = newPlugin({ queue_playback: false });
    armQueue(off, OURS);
    pushed.length = 0;
    logs.length = 0;
    off.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    check('queue playback off does not enter queue mode', off.queueMode === false);
    check('queue playback off sends no play',
      !logs.some((l) => l.indexOf('"command":"play"') !== -1), logs.join(' | '));
    nextCalls.length = 0;
    await new Promise((r) => setImmediate(r));
    check('queue playback off advances with next()', nextCalls.length === 1,
      String(nextCalls.length));
    check('queue playback off does not publish stop', pushed.length === 0,
      JSON.stringify(pushed[0] || null));

    const on = newPlugin({ queue_playback: true });
    armQueue(on, OURS);
    logs.length = 0;
    on.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    check('queue playback on plays the row',
      on.queueMode === true &&
      logs.some((l) => l === 'cmd {"command":"play","uri":"' + OURS + '"}'));
  }

  // 20. remote playback keeps a row that produced no local audio
  {
    const p = newPlugin({ queue_playback: true, queue_remote_playback: true });
    armQueue(p, OURS);
    p.queueStartTimeoutMs = () => 40;
    pushed.length = 0;
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    await new Promise((r) => setTimeout(r, 90));
    check('remote playback does not skip the row', pushed.length === 0,
      JSON.stringify(pushed[0] || null));
    check('remote playback leaves queue mode', p.queueMode === false);
    check('remote playback does not claim ownership', p.owningPlayback() === false);
  }

  // 21. only daemon settings restart the daemon
  {
    const p = newPlugin();
    const stored = {
      api_key: 'k', device_name: 'Volumio', initial_volume: 50,
      cache_size_mb: 1024, cache_location: 'disk', buffer_ms: 500,
      output_trim_db: 0, verbose_logging: false, align_volume: false,
      loudness_normalization: true, crossfade: false, crossfade_ms: 2000,
      queue_playback: false, queue_remote_playback: false,
    };
    p.config = { get: (key) => stored[key] };
    const same = Object.assign({}, stored);
    check('queue switches alone do not restart',
      p.daemonSettingsChanged(Object.assign(same, { queue_playback: true })) === false);
    check('queue fetch wait alone does not restart',
      p.daemonSettingsChanged(Object.assign(same, { queue_fetch_ms: 1000 })) === false);
    check('a daemon setting does restart',
      p.daemonSettingsChanged(Object.assign({}, stored, { buffer_ms: 400 })) === true);
    check('align volume on restarts',
      p.daemonSettingsChanged(Object.assign({}, stored, { align_volume: true })) === true);
    check('initial volume change restarts when align is off',
      p.daemonSettingsChanged(Object.assign({}, stored, { initial_volume: 20 })) === true);
    stored.align_volume = true;
    check('initial volume change does not restart when align is on',
      p.daemonSettingsChanged(Object.assign({}, stored, { initial_volume: 20 })) === false);
    stored.align_volume = false;
    check('loudness off restarts',
      p.daemonSettingsChanged(Object.assign({}, stored, { loudness_normalization: false })) === true);
    check('crossfade on restarts',
      p.daemonSettingsChanged(Object.assign({}, stored, { crossfade: true })) === true);
    check('crossfade_ms change restarts',
      p.daemonSettingsChanged(Object.assign({}, stored, { crossfade_ms: 4000 })) === true);
    check('loudness unchanged does not restart',
      p.daemonSettingsChanged(Object.assign({}, stored)) === false);
    check('auto_update_binary on does not restart',
      p.daemonSettingsChanged(Object.assign({}, stored, { auto_update_binary: true })) === false);
  }

  // 21b. a section save posts only its own fields
  {
    const p = newPlugin();
    const stored = {
      api_key: 'k', device_name: 'Test', initial_volume: 35,
      cache_size_mb: 1024, cache_location: 'disk', buffer_ms: 300,
      output_trim_db: 4, verbose_logging: true, loudness_normalization: true,
      crossfade: false, crossfade_ms: 2000,
      retain_api_key: true, queue_playback: false, queue_remote_playback: false,
      align_volume: false,
      seek_coalesce_ms: 200, inactive_hold_ms: 2000,
      quality_retry_ms: 300, quality_retry_max: 2,
      queue_fetch_ms: 2500,
      auto_update_binary: false,
    };
    p.config = { get: (key) => stored[key] };
    const result = p.validateSettings({
      queue_playback: true,
      queue_remote_playback: false,
    });
    check('partial save is accepted', result.ok === true, result.message);
    check('partial save keeps the API key', result.values.api_key === 'k');
    check('partial save keeps volume', result.values.initial_volume === 35);
    check('partial save keeps align off', result.values.align_volume === false);
    check('partial save keeps trim', result.values.output_trim_db === 4);
    check('partial save keeps loudness on', result.values.loudness_normalization === true);
    check('partial save keeps crossfade off', result.values.crossfade === false);
    check('partial save keeps crossfade_ms', result.values.crossfade_ms === 2000);
    check('partial save keeps verbose', result.values.verbose_logging === true);
    check('partial save sets queue on', result.values.queue_playback === true);
    check('partial save keeps queue fetch wait', result.values.queue_fetch_ms === 2500);
    check('partial save keeps auto_update_binary off',
      result.values.auto_update_binary === false);
    check('partial queue save does not restart',
      p.daemonSettingsChanged(result.values) === false);
    const updateOnly = p.validateSettings({ auto_update_binary: true });
    check('update section save is accepted', updateOnly.ok === true, updateOnly.message);
    check('update section save sets auto_update_binary',
      updateOnly.values.auto_update_binary === true);
    check('update section save keeps queue off',
      updateOnly.values.queue_playback === false);
    check('update section save does not restart',
      p.daemonSettingsChanged(updateOnly.values) === false);
  }

  // 22. a row is not sent to a session we do not hold
  //
  // play is routed to whichever device holds the session. Sending one while the
  // session is elsewhere starts audio on that device, and the later skip does
  // not take it back: the track played on the other device anyway.
  {
    const off = newPlugin({ queue_playback: true, queue_remote_playback: false });
    armQueue(off, OURS);
    off.deviceActive = false;
    logs.length = 0;
    pushed.length = 0;
    off.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    check('remote off sends no play to another device',
      !logs.some((l) => l.indexOf('"command":"play"') !== -1), logs.join(' | '));
    check('remote off does not enter queue mode', off.queueMode === false);
    nextCalls.length = 0;
    await new Promise((r) => setImmediate(r));
    check('remote off advances with next()', nextCalls.length === 1,
      String(nextCalls.length));
    check('remote off does not publish stop', pushed.length === 0,
      JSON.stringify(pushed[0] || null));

    const on = newPlugin({ queue_playback: true, queue_remote_playback: true });
    armQueue(on, OURS);
    on.deviceActive = false;
    logs.length = 0;
    on.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    check('remote on does send the play',
      logs.some((l) => l === 'cmd {"command":"play","uri":"' + OURS + '"}'),
      logs.join(' | '));
  }

  // 23. the pre-check reads the reported flag, not the delayed one
  //
  // The hold is deliberate: is_active blinks false during a seek and comes
  // back, and yielding on that blink ends the Connect session, so `active` only
  // drops after inactive_hold_ms. That is why it is the wrong flag to ask
  // before starting a queue row, and why deviceActive exists alongside it.
  {
    const p = newPlugin();
    p.inactiveHoldMs = () => 2000;
    // Establish the state the hold protects: the device is active and playing.
    p.updateActive({ is_active: true });
    check('both flags true while active', p.active === true && p.deviceActive === true);

    // The blink.
    p.updateActive({ is_active: false });
    check('reported flag is immediate', p.deviceActive === false);
    check('held flag still lags', p.active === true);
    check('hold is armed', p.inactiveHoldTimer !== null);

    // It comes back before the hold expires, which is the case the hold exists
    // for: the session must not end.
    p.updateActive({ is_active: true });
    check('blink did not end the session',
      p.active === true && p.deviceActive === true && p.inactiveHoldTimer === null);
    p.clearInactiveHold();
  }

  // 23b. with no hold, both flags drop together
  {
    const p = newPlugin();
    p.inactiveHoldMs = () => 0;
    p.unsetVolatile = function () {};
    p.updateActive({ is_active: true });
    p.updateActive({ is_active: false });
    check('no hold means no lag', p.active === false && p.deviceActive === false);
  }

  // 24. album context with our item is not a session move
  {
    const p = newPlugin();
    let takeovers = 0;
    p.takeOverPlayback = function () { takeovers++; };
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    pushed.length = 0;
    const consumed = p.checkQueueRow(
      evt('playing', OURS, 500, 'spotify:album:0E2xXn23qVmfx9ThZjWFBE', item, true),
      OURS);
    check('album context not consumed', consumed === false);
    check('album context stays in queue mode', p.queueMode === true);
    check('album context does not reclaim', takeovers === 0, String(takeovers));
    check('album context reports no stop', pushed.length === 0);
  }

  // 25. idle ends the row only after it has started
  {
    const p = newPlugin();
    armQueue(p, OURS);
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    pushed.length = 0;
    const early = p.checkQueueRow(evt('idle', '', 0, '', { uri: '' }, true), '');
    check('idle before start is ignored', early === false && p.queueMode === true);
    check('idle before start reports no stop', pushed.length === 0);

    p.checkQueueRow(evt('playing', OURS, 500, OURS, item), OURS);
    const late = p.checkQueueRow(evt('idle', OURS, 175301, OURS, item), OURS);
    check('idle after start is consumed', late === true);
    check('idle after start published stop', pushed.length === 1 && pushed[0].status === 'stop',
      JSON.stringify(pushed[0] || null));
  }

  // 26. playback_changed idle after start ends the row
  {
    const p = newPlugin();
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.state.uri = OURS;
    p.state.status = 'play';
    p.clearQueueStartTimer();
    pushed.length = 0;
    p.handleEvent({ type: 'playback_changed', status: 'idle' });
    check('playback_changed idle published stop',
      pushed.length === 1 && pushed[0].status === 'stop',
      JSON.stringify(pushed[0] || null));
    check('playback_changed idle left queue mode', p.queueMode === false);
  }

  // 27. stop is not published while we still hold the card
  {
    const p = newPlugin();
    p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.state.duration = 175;
    let held = true;
    p.alsaHeldByUs = function () { return held; };
    pushed.length = 0;
    p.checkQueueRow(evt('buffering', OURS, 175301, OURS, item), OURS);
    check('held card defers the stop', pushed.length === 0 && p.queueMode === false);
    held = false;
    await new Promise((r) => setTimeout(r, 40));
    check('stop publishes after the card is free',
      pushed.length === 1 && pushed[0].status === 'stop',
      JSON.stringify(pushed[0] || null));
  }

  // 28. the browse tile is Spotify's queue, not Volumio's
  {
    const p = newPlugin();
    p.state.uri = OURS;
    p.state.title = 'Heat Waves';
    p.state.artist = 'Glass Animals, iann dior';
    p.state.album = 'Dreamland';
    p.state.albumart = 'large.jpg';
    p.state.duration = 175;
    const page = p.buildQueueBrowse({
      previous: [{ item: item, source: 'context' }],
      upcoming: [
        { item: rolledItem, source: 'queue' },
        {
          item: {
            uri: 'spotify:track:autoplay1',
            decorations: {
              identity: { name: 'Radio Cut' },
              visual_identity: { cover: [] },
              parent: { entity: { decorations: { identity: { name: 'Radio' } } } },
              creators: [{ entity: { decorations: { identity: { name: 'Someone' } } } }],
              playback: { duration_ms: 120000 },
            },
          },
          source: 'autoplay',
        },
      ],
    });
    const titles = page.navigation.lists.map((l) => l.title);
    check('browse has now playing', titles[0] === 'Now playing', titles.join(','));
    check('browse has play next', titles.indexOf('Play next') !== -1, titles.join(','));
    check('browse has autoplay', titles.indexOf('Autoplay') !== -1, titles.join(','));
    check('browse drops current from previous', titles.indexOf('Recently played') === -1, titles.join(','));
    check('browse now playing is our uri',
      page.navigation.lists[0].items[0].uri === OURS);
    check('browse play next is the queued uri',
      page.navigation.lists[1].items[0].uri === ROLLED);
    check('browse songs keep service',
      page.navigation.lists[1].items[0].service === 'soloist_connect');
    check('browse songs are songs',
      page.navigation.lists[1].items[0].type === 'song');

    const withPlaceholder = p.buildQueueBrowse({
      previous: [],
      upcoming: [
        { item: rolledItem, source: 'context' },
        {
          item: {
            uri: 'spotify:meta:node_rules_placeholder',
            entity_type: 'unknown',
            decorations: { playback: { duration_ms: 0 } },
          },
          source: 'context',
        },
      ],
    });
    check('browse drops placeholder rows',
      withPlaceholder.navigation.lists.find((l) => l.title === 'Up next').items.length === 1);
  }

  // 29. logged out browse does not leak the last queue
  {
    const p = newPlugin();
    p.loggedIn = false;
    p.spotifyQueue = { previous: [{ item: item }], upcoming: [{ item: rolledItem }] };
    const page = p.buildQueueBrowse(p.spotifyQueue);
    check('logged out is one info list', page.navigation.lists.length === 1);
    check('logged out is not a song',
      page.navigation.lists[0].items[0].type === 'item-no-menu');
    check('logged out names the reason',
      page.navigation.lists[0].items[0].title === 'Not signed in');
  }

  // 30. empty queue, signed in
  {
    const p = newPlugin();
    p.state.uri = '';
    const page = p.buildQueueBrowse({ previous: [], upcoming: [] });
    check('empty queue is info',
      page.navigation.lists[0].items[0].title === 'Nothing in the Spotify queue');
  }

  // 31. handleBrowseUri asks get_queue only when a session and socket exist
  {
    const p = newPlugin();
    p.loggedIn = false;
    logs.length = 0;
    await p.handleBrowseUri('soloist_connect');
    check('logged out browse does not get_queue',
      !logs.some((l) => l.indexOf('get_queue') !== -1), logs.join(' | '));

    p.loggedIn = true;
    p.ws = null;
    logs.length = 0;
    await p.handleBrowseUri('soloist_connect');
    check('closed socket browse does not get_queue',
      !logs.some((l) => l.indexOf('get_queue') !== -1), logs.join(' | '));

    logs.length = 0;
    const foreign = await p.handleBrowseUri('mpd');
    check('foreign browse uri is empty',
      foreign.navigation.lists.length === 0);
    check('foreign browse does not get_queue',
      !logs.some((l) => l.indexOf('get_queue') !== -1), logs.join(' | '));

    const off = newPlugin({ queue_playback: false });
    off.ws = { readyState: 1 };
    logs.length = 0;
    const hidden = await off.handleBrowseUri('soloist_connect');
    check('queue playback off browse is empty',
      hidden.navigation.lists.length === 0);
    check('queue playback off browse does not get_queue',
      !logs.some((l) => l.indexOf('get_queue') !== -1), logs.join(' | '));

    p.ws = { readyState: 1 };
    p.state.uri = OURS;
    p.state.title = 'Heat Waves';
    logs.length = 0;
    const pending = p.handleBrowseUri('soloist_connect');
    check('open socket browse sends get_queue all',
      logs.some((l) => l === 'cmd {"command":"get_queue","limit":0}'),
      logs.join(' | '));
    p.handleEvent({
      type: 'queue_changed',
      previous: [],
      upcoming: [{ item: rolledItem, source: 'context' }],
    });
    const page = await pending;
    const titles = page.navigation.lists.map((l) => l.title);
    check('get_queue reply fills up next', titles.indexOf('Up next') !== -1, titles.join(','));
    check('get_queue reply keeps now playing', titles.indexOf('Now playing') !== -1);
  }

  // 32. a missed get_queue falls back to the last event
  {
    const p = newPlugin({ queue_fetch_ms: 20 });
    p.ws = { readyState: 1 };
    p.state.uri = '';
    p.handleEvent({
      type: 'queue_changed',
      previous: [],
      upcoming: [{ item: rolledItem, source: 'context' }],
    });
    logs.length = 0;
    const page = await p.handleBrowseUri('soloist_connect');
    check('timeout still sent get_queue',
      logs.some((l) => l === 'cmd {"command":"get_queue","limit":0}'));
    check('timeout uses last upcoming',
      page.navigation.lists[0].items[0].uri === ROLLED,
      JSON.stringify(page.navigation.lists[0] && page.navigation.lists[0].items[0]));
  }

  // 33. browse does not touch playback
  {
    const p = newPlugin();
    p.cacheItem(item);
    await p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
    p.ws = { readyState: 1 };
    logs.length = 0;
    pushed.length = 0;
    const pending = p.handleBrowseUri('soloist_connect');
    p.handleEvent({ type: 'queue_changed', previous: [], upcoming: [] });
    await pending;
    check('browse leaves queue mode on', p.queueMode === true);
    check('browse does not pause',
      !logs.some((l) => l === 'cmd {"command":"pause"}'), logs.join(' | '));
    check('browse does not play',
      !logs.some((l) => l.indexOf('"command":"play"') !== -1), logs.join(' | '));
    check('browse does not yield',
      !logs.some((l) => l.indexOf('yield') !== -1), logs.join(' | '));
    check('browse does not publish state', pushed.length === 0);
  }

  // 34. a browse song still explodes the way a mixed-list row does
  {
    const p = newPlugin();
    p.cacheItem(rolledItem);
    const song = p.browseItemFromEntity(rolledItem);
    const out = await p.explodeUri(song.uri);
    check('browse explode name', out[0].name === 'Something Else', out[0].name);
    check('browse explode service', out[0].service === 'soloist_connect');
  }

  // 35. tile registration is a no-op when core has no browse hooks
  {
    const p = newPlugin();
    delete p.commandRouter.volumioAddToBrowseSources;
    delete p.commandRouter.volumioRemoveToBrowseSources;
    p.addToBrowseSources();
    p.removeFromBrowseSources();
    check('missing browse hooks do not throw', true);

    const q = newPlugin();
    browseAdds.length = 0;
    browseRemoves.length = 0;
    q.addToBrowseSources();
    q.removeFromBrowseSources();
    check('add browse uses our uri',
      browseAdds.length === 1 && browseAdds[0].uri === 'soloist_connect',
      JSON.stringify(browseAdds[0] || null));
    check('add browse is not the stock spotify uri',
      browseAdds[0].uri !== 'spotify');
    check('add browse uses sourceicon',
      browseAdds[0].albumart ===
        '/albumart?sourceicon=music_service/soloist_connect/assets/spotify.svg',
      String(browseAdds[0].albumart));
    check('add browse does not rely on font-awesome',
      browseAdds[0].icon === undefined);
    check('remove browse uses the tile name',
      browseRemoves.length === 1 && browseRemoves[0] === 'Spotify Queue');

    const off = newPlugin({ queue_playback: false });
    off.ws = { readyState: 1 };
    browseAdds.length = 0;
    browseRemoves.length = 0;
    off.addToBrowseSources();
    check('queue playback off does not add the tile', browseAdds.length === 0);
    off.syncBrowseSource();
    check('queue playback off sync removes the tile',
      browseRemoves.length === 1 && browseRemoves[0] === 'Spotify Queue');

    const on = newPlugin({ queue_playback: true });
    on.ws = { readyState: 1 };
    browseAdds.length = 0;
    browseRemoves.length = 0;
    on.syncBrowseSource();
    check('queue playback on sync adds the tile', browseAdds.length === 1);
    check('queue playback on sync does not remove', browseRemoves.length === 0);
  }

  // 36. an open tile is refreshed from Spotify events; a closed one is not
  {
    const closed = newPlugin();
    browsePushes.length = 0;
    logs.length = 0;
    closed.handleEvent({
      type: 'queue_changed',
      previous: [],
      upcoming: [{ item: rolledItem, source: 'context' }],
    });
    await new Promise((r) => setTimeout(r, 80));
    check('closed tile does not get_queue on queue_changed',
      !logs.some((l) => l.indexOf('get_queue') !== -1), logs.join(' | '));
    check('closed tile does not push browse', browsePushes.length === 0);

    const p = newPlugin();
    p.ws = { readyState: 1 };
    p.state.uri = OURS;
    p.state.title = 'Heat Waves';
    browsePushes.length = 0;
    logs.length = 0;
    const pending = p.handleBrowseUri('soloist_connect');
    p.handleEvent({
      type: 'queue_changed',
      previous: [],
      upcoming: [{ item: rolledItem, source: 'queue' }],
    });
    await pending;
    check('open reply pushes the tile',
      browsePushes.length >= 1 && browsePushes[0].emit === 'pushBrowseLibrary');
    const opened = browsePushes[browsePushes.length - 1].payload;
    check('open reply keeps play next',
      opened.navigation.lists.some((l) => l.title === 'Play next'));
    check('open reply keeps now playing',
      opened.navigation.lists.some((l) => l.title === 'Now playing'));

    logs.length = 0;
    browsePushes.length = 0;
    p.handleEvent({ type: 'track_changed', item: rolledItem });
    check('track_changed paints now playing',
      browsePushes.length >= 1 &&
      browsePushes[0].payload.navigation.lists[0].items[0].uri === ROLLED,
      JSON.stringify(browsePushes[0] && browsePushes[0].payload.navigation.lists[0]));
    await new Promise((r) => setTimeout(r, 80));
    check('open tile asks get_queue after a change',
      logs.some((l) => l === 'cmd {"command":"get_queue","limit":0}'),
      logs.join(' | '));

    const off = newPlugin({ queue_playback: false });
    off.browseWatching = true;
    off.ws = { readyState: 1 };
    browsePushes.length = 0;
    logs.length = 0;
    off.handleEvent({ type: 'track_changed', item: item });
    await new Promise((r) => setTimeout(r, 80));
    check('queue playback off does not refresh browse',
      browsePushes.length === 0 &&
      !logs.some((l) => l.indexOf('get_queue') !== -1));
  }

  // 37. search is present and empty
  {
    const p = newPlugin();
    const out = await p.search({ value: 'heat' });
    check('search returns nothing', out === undefined);
  }

  // 38. queue fetch wait is a timing setting, default 2500
  {
    const unset = newPlugin();
    check('queue fetch default', unset.queueFetchMs() === 2500);
    check('queue fetch 0 is allowed', newPlugin({ queue_fetch_ms: 0 }).queueFetchMs() === 0);
    check('queue fetch 10000 is allowed',
      newPlugin({ queue_fetch_ms: 10000 }).queueFetchMs() === 10000);
    check('queue fetch out of range falls back',
      newPlugin({ queue_fetch_ms: 10001 }).queueFetchMs() === 2500);
    const p = newPlugin({ queue_fetch_ms: 2500 });
    const bad = p.validateSettings({ queue_fetch_ms: 10001 });
    check('queue fetch out of range is rejected',
      bad.ok === false && /Queue fetch wait/.test(bad.message), bad.message);
    const zero = p.validateSettings({ queue_fetch_ms: 0 });
    check('queue fetch 0 saves', zero.ok === true && zero.values.queue_fetch_ms === 0);
  }

  // 39. align volume copies the Volumio knob to Soloist and does not yank the mixer
  {
    const mixer = [];
    const p = newPlugin({ align_volume: true, initial_volume: 50 });
    p.mixerIsExternal = () => true;
    p.commandRouter.volumioGetState = () => ({ volume: 20, mute: false });
    p.commandRouter.volumiosetvolume = (v) => mixer.push(v);
    p.volatileSet = true;
    logs.length = 0;

    check('align seeds daemon from the knob', p.initialVolumeForDaemon() === 20);
    check('align off seeds daemon from initial volume',
      newPlugin({ align_volume: false, initial_volume: 50 }).initialVolumeForDaemon() === 50);

    p.applySoloistVolume(50);
    check('startup volume is not applied before align', mixer.length === 0);

    p.updateActive({ is_active: true });
    check('becoming active sends Volumio volume to Soloist',
      logs.some((l) => l === 'cmd {"command":"set_volume","volume":20}'),
      logs.join(' | '));
    check('align does not write the mixer', mixer.length === 0);

    p.applySoloistVolume(50);
    check('initial Soloist volume is ignored after align', mixer.length === 0);

    p.applySoloistVolume(20);
    check('echo of the aligned volume is ignored', mixer.length === 0);

    p.applySoloistVolume(40);
    check('later app slider moves the mixer', mixer.length === 1 && mixer[0] === 40);

    const muted = newPlugin({ align_volume: true });
    muted.mixerIsExternal = () => true;
    muted.commandRouter.volumioGetState = () => ({ volume: 20, mute: true });
    logs.length = 0;
    muted.updateActive({ is_active: true });
    check('mute aligns as zero',
      logs.some((l) => l === 'cmd {"command":"set_volume","volume":0}'));

    const none = newPlugin({ align_volume: true });
    none.mixerIsExternal = () => false;
    none.commandRouter.volumioGetState = () => ({ volume: 20 });
    logs.length = 0;
    none.updateActive({ is_active: true });
    check('no mixer does not align',
      !logs.some((l) => l.indexOf('set_volume') !== -1));

    const disabled = newPlugin({ align_volume: true });
    disabled.mixerIsExternal = () => true;
    disabled.commandRouter.volumioGetState = () => ({
      volume: 20, disableVolumeControl: true,
    });
    logs.length = 0;
    disabled.updateActive({ is_active: true });
    check('disabled volume control does not align',
      !logs.some((l) => l.indexOf('set_volume') !== -1));

    const off = newPlugin({ align_volume: false });
    off.mixerIsExternal = () => true;
    off.active = true;
    off.volatileSet = true;
    const offMixer = [];
    off.commandRouter.volumiosetvolume = (v) => offMixer.push(v);
    off.applySoloistVolume(50);
    check('align off still applies startup volume',
      offMixer.length === 1 && offMixer[0] === 50);
  }

  // 40. convert playlist rewrites only spop track rows
  //
  // A saved list that is already soloist_connect + mpd. That shape
  // is the write target. The stock plugin's lists still say spop.
  {
    const convertedList = [
      {
        album: 'The Papercut Chronicles II',
        albumart: 'https://i.scdn.co/image/ab67616d0000b27318b8088fe0c3dbf78398b55a',
        artist: 'Gym Class Heroes, Adam Levine',
        service: 'soloist_connect',
        title: 'Stereo Hearts (feat. Adam Levine)',
        uri: 'spotify:track:0qOnSQQF0yzuPWsXrQ9paz',
      },
      {
        album: 'Brothers In Arms (Remastered Version)',
        albumart: '/albumart?cacheid=113&web=Dire%20Straits/Brothers%20In%20Arms%20(Remastered%20Version)/extralarge&path=%2Fmnt%2FINTERNAL%2FDire%20Straits%2FBrothers%20In%20Arms%20(Remastered%20Version)&icon=fa-tags&metadata=false',
        artist: 'Dire Straits',
        service: 'mpd',
        title: 'Walk Of Life',
        uri: 'mnt/INTERNAL/Dire Straits/Brothers In Arms (Remastered Version)/03 - Walk Of Life.mp3',
      },
      {
        album: 'Dopamine',
        albumart: 'https://i.scdn.co/image/ab67616d0000b273cc2cf912462d8ae4ef856434',
        artist: 'BØRNS',
        service: 'soloist_connect',
        title: 'Electric Love',
        uri: 'spotify:track:2GiJYvgVaD2HtM8GqD9EgQ',
      },
      {
        album: 'x (Deluxe Edition)',
        albumart: '/albumart?cacheid=113&web=Ed%20Sheeran/x%20(Deluxe%20Edition)/extralarge&path=%2Fmnt%2FINTERNAL%2FEd%20Sheeran%2Fx%20(Deluxe%20Edition)&icon=fa-tags&metadata=false',
        artist: 'Ed Sheeran',
        service: 'mpd',
        title: 'Thinking Out Loud',
        uri: 'mnt/INTERNAL/Ed Sheeran/x (Deluxe Edition)/11 - Thinking Out Loud.mp3',
      },
    ];
    const spopMixed = [
      Object.assign({}, convertedList[0], { service: 'spop' }),
      convertedList[1],
      Object.assign({}, convertedList[2], { service: 'spop' }),
      convertedList[3],
      {
        album: '',
        albumart: '',
        artist: '',
        service: 'spop',
        title: 'Daily Mix',
        uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
      },
    ];

    const p = newPlugin();
    const already = p.convertPlaylistRows(convertedList);
    check('already converted list changes nothing', already.converted === 0);
    check('already converted list keeps rows',
      already.rows[0] === convertedList[0] && already.rows[1] === convertedList[1]);

    const out = p.convertPlaylistRows(spopMixed);
    check('spop tracks are counted', out.converted === 2 && out.total === 5);
    check('spop tracks become soloist_connect',
      out.rows[0].service === 'soloist_connect' &&
      out.rows[2].service === 'soloist_connect');
    check('converted uri and title stay put',
      out.rows[0].uri === spopMixed[0].uri &&
      out.rows[0].title === spopMixed[0].title);
    check('mpd row is untouched',
      out.rows[1] === spopMixed[1] && out.rows[1].service === 'mpd');
    check('spop playlist uri stays spop',
      out.rows[4].service === 'spop' && out.rows[4].uri === spopMixed[4].uri);

    check('empty clone name uses (Soloist)',
      p.playlistCloneName('Test', '') === 'Test (Soloist)');
    check('custom clone name is trimmed',
      p.playlistCloneName('Test', '  Mixed nights  ') === 'Mixed nights');
    check('playlist name Test is allowed', p.playlistNameAllowed('Test') === true);
    check('playlist name with slash is refused',
      p.playlistNameAllowed('Test/foo') === false);
    check('playlist name with dotdot is refused',
      p.playlistNameAllowed('foo..bar') === false);
    check('posted select object is the value',
      p.postedPlaylistName({ value: 'Test', label: 'Test (2 Spotify rows)' }) === 'Test');

    const store = { Test: convertedList, Old: JSON.parse(JSON.stringify(spopMixed)) };
    function stubLists(plugin) {
      plugin.commandRouter.playListManager = {
        playlistFolder: '/data/playlist/',
        listPlaylist() { return Promise.resolve(Object.keys(store)); },
        getPlaylistContent(name) { return Promise.resolve(store[name] || []); },
        saveJSONFile(folder, name, rows) {
          store[name] = rows;
          logs.push('save ' + folder + name);
          return Promise.resolve();
        },
      };
    }

    stubLists(p);
    const options = await p.listConvertiblePlaylists();
    check('already converted Test is not offered',
      !options.some((o) => o.value === 'Test'));
    check('spop list is offered with a count',
      options.length === 1 && options[0].value === 'Old' &&
      /2 Spotify rows/.test(options[0].label),
      JSON.stringify(options));

    toasts.length = 0;
    logs.length = 0;
    await p.convertPlaylist({ convert_playlist: 'Old', convert_overwrite: false });
    check('clone writes Test-style dest name',
      Object.prototype.hasOwnProperty.call(store, 'Old (Soloist)'));
    check('clone leaves the source file',
      store.Old[0].service === 'spop');
    check('clone dest matches source shape',
      store['Old (Soloist)'][0].service === 'soloist_connect' &&
      store['Old (Soloist)'][1].service === 'mpd');
    check('clone toast names the dest',
      toasts.some((t) => t.type === 'success' && /Old \(Soloist\)/.test(t.msg)),
      JSON.stringify(toasts));

    toasts.length = 0;
    await p.convertPlaylist({ convert_playlist: 'Old', convert_overwrite: false });
    check('clone refuses a dest that exists',
      toasts.some((t) => t.type === 'error' && /already exists/.test(t.msg)));

    toasts.length = 0;
    await p.convertPlaylist({
      convert_playlist: 'Old',
      convert_overwrite: false,
      convert_name: 'Bad/name',
    });
    check('clone refuses a dest with a slash',
      toasts.some((t) => t.type === 'error' && /cannot contain/.test(t.msg)));

    toasts.length = 0;
    await p.convertPlaylist({ convert_playlist: 'Old', convert_overwrite: true });
    check('overwrite rewrites the same file',
      store.Old[0].service === 'soloist_connect' &&
      store.Old[1].service === 'mpd' &&
      store.Old[4].service === 'spop');
    check('overwrite toast counts rows',
      toasts.some((t) => t.type === 'success' && /Converted 2 of 5/.test(t.msg)),
      JSON.stringify(toasts));

    toasts.length = 0;
    await p.convertPlaylist({ convert_playlist: 'Test', convert_overwrite: true });
    check('overwrite of an already converted list is refused',
      toasts.some((t) => t.type === 'error' && /no Spotify Connect/.test(t.msg)));
  }

  // 41. manual binary update: progress modal, then 15s reboot countdown with Restart and Cancel
  {
    const p = newPlugin();
    let started = 0;
    let countdown = 0;
    p.startDaemon = function () { started++; return Promise.resolve(); };
    p.connectWebSocket = function () {};
    p.initUpdateRebootCountdown = function () { countdown++; this.showUpdateRebootModal(15); };
    p.runDownloadScript = function (cb) { cb(null); };
    browsePushes.length = 0;
    logs.length = 0;
    toasts.length = 0;
    await p.updateSoloistBinary();
    check('success opens the system progress modal',
      browsePushes.some((e) => e.emit === 'openModal' && e.payload.progress === true &&
        /Do not power off/.test(e.payload.message)));
    check('success paints the progress bar',
      browsePushes.some((e) => e.emit === 'modalProgress' && e.payload.progressNumber === 10));
    check('success starts the 15s countdown instead of the daemon',
      countdown === 1 && started === 0);
    check('success drops the shared busy flag so a later tick can pull',
      p.binaryUpdateBusy === false);
    check('countdown modal has Restart, Cancel and 15 seconds',
      browsePushes.some((e) => e.emit === 'openModal' && !e.payload.progress &&
        /15 seconds/.test(e.payload.message) &&
        e.payload.buttons[0].name === 'Restart' &&
        e.payload.buttons[0].payload.method === 'finishUpdateReboot' &&
        e.payload.buttons[1].name === 'Cancel' &&
        e.payload.buttons[1].payload.method === 'cancelUpdateReboot'));

    const fail = newPlugin();
    fail.startDaemon = function () { started++; return Promise.resolve(); };
    fail.initUpdateRebootCountdown = function () { countdown++; };
    fail.runDownloadScript = function (cb) { cb(new Error('curl fail')); };
    browsePushes.length = 0;
    try {
      await fail.updateSoloistBinary();
      check('failed download rejects', false);
    } catch (e) {
      check('failed download rejects', /curl fail/.test(String(e)));
    }
    check('failed download stays on the progress modal',
      browsePushes.some((e) => e.emit === 'modalDone' && /Update failed/.test(e.payload.message)));
    check('failed download does not reboot or start the daemon',
      countdown === 1 && started === 0 && !logs.includes('reboot'));

    const cancel = newPlugin();
    cancel.startDaemon = function () { started++; return Promise.resolve(); };
    cancel.connectWebSocket = function () {};
    logs.length = 0;
    toasts.length = 0;
    cancel.updateRebootTimer = setInterval(function () {}, 60000);
    await cancel.cancelUpdateReboot();
    check('cancel stops the countdown and starts the new binary',
      cancel.updateRebootTimer === null && logs.includes('closeModals') &&
      started === 1 && !logs.includes('reboot'));
    check('cancel says the binary is already installed',
      toasts.some((t) => t.type === 'info' && /already installed/.test(t.msg)));

    const finish = newPlugin();
    logs.length = 0;
    finish.finishUpdateReboot();
    check('countdown end closes the modal and reboots',
      logs.includes('closeModals') && logs.includes('reboot'));
  }

  // 41. playback device: Peppy, switcher, Hardware, and SoftMaster-only
  {
    const p = newPlugin();
    const maroenSoftware =
      'pcm.volumio {\n    type             empty\n    slave.pcm       "softvolume"\n}\n' +
      'pcm.softvolume {\n    type            plug\n    slave {\n        pcm         "volumioSoftVol"\n' +
      '        format      "S24_3LE"\n    }\n}\n';
    const switcherConf =
      'pcm.volumio {\n    type             empty\n    slave.pcm       "volumioMultiRoomServer"\n}\n' +
      'pcm.softvolume {\n    type            plug\n}\n' +
      'pcm.spotify {\n  type plug\n}\n';
    const hardware =
      'pcm.volumio {\n    type             empty\n    slave.pcm       "volumioOutput"\n}\n';
    const localPlayback =
      'pcm.volumioLocalPlayback {\n    type empty\n    slave.pcm "softvolume"\n}\n' +
      'pcm.volumio {\n    type empty\n    slave.pcm "volumioOutput"\n}\n';

    check('SoftMaster-only Software opens softvolume',
      p.resolvePlaybackDevice(maroenSoftware, false) === 'softvolume');
    check('Peppy metering wins over SoftMaster-only',
      p.resolvePlaybackDevice(maroenSoftware + 'pcm.spotify {\n  type plug\n}\n', true) ===
        'plug:spotify');
    check('switcher stays on plug:volumio',
      p.resolvePlaybackDevice(switcherConf, false) === 'plug:volumio');
    check('Peppy + switcher opens plug:spotify',
      p.resolvePlaybackDevice(switcherConf, true) === 'plug:spotify');
    check('Hardware stays on plug:volumio',
      p.resolvePlaybackDevice(hardware, false) === 'plug:volumio');
    check('volumioLocalPlayback slave is not pcm.volumio',
      p.resolvePlaybackDevice(localPlayback, false) === 'plug:volumio');
    check('empty asound stays on plug:volumio',
      p.resolvePlaybackDevice('', false) === 'plug:volumio');
    check('slave name is empty → softvolume only',
      p.volumioDirectSlave(maroenSoftware) === 'softvolume' &&
      p.volumioDirectSlave(switcherConf) === 'volumioMultiRoomServer' &&
      p.volumioDirectSlave(hardware) === 'volumioOutput');
  }

  // 42. quality: hold a growing cache file, publish when it settles or is lossless
  {
    const PATH_A = '/data/soloist/cache/cache/aa/aa.file';
    const PATH_B = '/data/soloist/cache/cache/bb/bb.file';
    const URI = 'spotify:track:qualityGrowth';
    const DURATION = 317000;

    function qualityPlugin() {
      const p = newPlugin({ quality_retry_ms: 300, quality_retry_max: 2 });
      p.updateQuality = SoloistConnect.prototype.updateQuality;
      p.watchQualityGrowth = SoloistConnect.prototype.watchQualityGrowth;
      p.clearQualityGrowth = SoloistConnect.prototype.clearQualityGrowth;
      p.clearQualityRetry = SoloistConnect.prototype.clearQualityRetry;
      p.resetQuality = SoloistConnect.prototype.resetQuality;
      p.holdQualityRetry = SoloistConnect.prototype.holdQualityRetry;
      p.pickCacheFile = SoloistConnect.prototype.pickCacheFile;
      p.qualityRetryMs = SoloistConnect.prototype.qualityRetryMs;
      p.qualityRetryMax = SoloistConnect.prototype.qualityRetryMax;
      p.owningPlayback = function () { return false; };
      p.daemonPid = function () { return 1; };
      p.cacheFiles = [];
      p.listCacheFiles = function () { return this.cacheFiles.slice(); };
      return p;
    }

    function stopWatch(p) {
      if (p.qualityGrowthTimer) {
        clearTimeout(p.qualityGrowthTimer);
        p.qualityGrowthTimer = null;
      }
      if (p.qualityRetryTimer) {
        clearTimeout(p.qualityRetryTimer);
        p.qualityRetryTimer = null;
      }
    }

    {
      const p = qualityPlugin();
      p.cacheFiles = [{ path: PATH_A, size: 802816 }];
      p.updateQuality(URI, DURATION);
      check('growing first sample is not published', p.quality === '', p.quality);
      check('growing first sample schedules a watch', p.qualityGrowthTimer !== null);
      stopWatch(p);
    }

    {
      const p = qualityPlugin();
      p.cacheFiles = [{ path: PATH_A, size: 802816 }];
      p.updateQuality(URI, DURATION);
      stopWatch(p);
      p.updateQuality(URI, DURATION);
      check('stable partial publishes Low', p.quality === 'Low', p.quality);
      stopWatch(p);
    }

    {
      const p = qualityPlugin();
      p.cacheFiles = [{ path: PATH_A, size: 18898196 }];
      p.updateQuality(URI, DURATION);
      check('complete lossless publishes immediately', p.quality === 'Lossless', p.quality);
      check('complete lossless does not keep watching', p.qualityGrowthTimer === null);
      stopWatch(p);
    }

    {
      const p = qualityPlugin();
      p.cacheFiles = [{ path: PATH_A, size: 802816 }];
      p.updateQuality(URI, DURATION);
      stopWatch(p);
      p.cacheFiles = [{ path: PATH_A, size: 18898196 }];
      p.updateQuality(URI, DURATION);
      check('growth to lossless publishes without a stable pair', p.quality === 'Lossless', p.quality);
      stopWatch(p);
    }

    {
      const p = qualityPlugin();
      p.cacheFiles = [{ path: PATH_A, size: 802816 }];
      p.updateQuality(URI, DURATION);
      stopWatch(p);
      p.updateQuality(URI, DURATION);
      check('partial first lock was Low', p.quality === 'Low', p.quality);
      p.cacheFiles = [{ path: PATH_A, size: 18898196 }];
      p.updateQuality(URI, DURATION);
      check('same fd growing upgrades Low to Lossless', p.quality === 'Lossless', p.quality);
      stopWatch(p);
    }

    {
      const p = qualityPlugin();
      p.qualityPath = PATH_A;
      p.qualityUri = 'spotify:track:previous';
      p.quality = 'Lossless';
      p.cacheFiles = [{ path: PATH_A, size: 802816 }];
      p.updateQuality(URI, DURATION);
      check('stale previous fd is not measured against the new duration', p.quality === 'Lossless', p.quality);
      stopWatch(p);
    }

    {
      const p = qualityPlugin();
      p.cacheFiles = [
        { path: PATH_A, size: 18898196 },
        { path: PATH_B, size: 409600 },
      ];
      p.qualityUri = URI;
      p.quality = 'Lossless';
      p.qualityPath = PATH_A;
      p.updateQuality(URI, DURATION);
      check('prefetch second fd keeps the current label', p.quality === 'Lossless', p.quality);
      stopWatch(p);
    }
  }

  // 43. identity line reads the shipped package.json and SOURCE.md
  {
    const fs = require('fs');
    const path = require('path');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'alsa-lib', 'SOURCE.md'), 'utf8');
    const shim = source.match(/Library version is \*\*([^*]+)\*\*/);
    const p = newPlugin();
    logs.length = 0;
    p.logPluginIdentity();
    check('plugin version is package.json',
      p.pluginVersion() === pkg.version && typeof pkg.version === 'string' && pkg.version.length > 0);
    check('shim version is SOURCE.md',
      p.shimVersion() === shim[1] && typeof shim[1] === 'string' && shim[1].length > 0);
    check('identity line is always logged',
      logs.some((m) => m === 'info SoloistConnect: plugin=' + pkg.version + ' shim=' + shim[1]));
  }

  // 44. pause is not sent after the session has left this speaker
  {
    function pauseCmds() {
      return logs.filter((l) => l === 'cmd {"command":"pause"}');
    }

    {
      const p = newPlugin({ queue_playback: false, inactive_hold_ms: 0 });
      p.deviceActive = true;
      p.active = true;
      p.volatileSet = true;
      p.state.status = 'play';
      p.state.title = 'Heat Waves';
      p.state.uri = OURS;
      p.context.coreCommand.stateMachine.setVolatile({
        service: 'soloist_connect',
        callback: p.unsetVolatile.bind(p),
      });
      logs.length = 0;
      pushed.length = 0;
      nextCalls.length = 0;
      p.updateActive({ is_active: false });
      check('transfer-away yield is requested',
        logs.indexOf('yield requested') !== -1, logs.join(' | '));
      check('transfer-away yield does not pause Spotify',
        pauseCmds().length === 0, logs.join(' | '));
      check('transfer-away drops volatile', p.volatileSet === false);
      check('connect yield publishes pause',
        pushed.length === 1 && pushed[0].status === 'pause',
        JSON.stringify(pushed[0] || null));
      check('connect yield pause keeps the title',
        pushed[0] && pushed[0].title === 'Heat Waves',
        JSON.stringify(pushed[0] || null));
      check('connect yield does not call next()', nextCalls.length === 0,
        String(nextCalls.length));
    }

    {
      const p = newPlugin({ inactive_hold_ms: 0 });
      p.deviceActive = true;
      p.active = true;
      p.queueMode = true;
      p.volatileSet = false;
      logs.length = 0;
      pushed.length = 0;
      nextCalls.length = 0;
      p.updateActive({ is_active: false });
      check('queue mode does not yield on is_active=false',
        logs.indexOf('yield requested') === -1 && p.queueMode === true,
        logs.join(' | '));
      check('queue mode inactive does not publish stop', pushed.length === 0,
        JSON.stringify(pushed[0] || null));
      check('queue mode inactive does not call next()', nextCalls.length === 0);
    }

    {
      const p = newPlugin();
      p.volatileSet = true;
      p.state.status = 'play';
      p.state.title = 'Heat Waves';
      p.context.coreCommand.stateMachine.setVolatile({
        service: 'soloist_connect',
        callback: p.unsetVolatile.bind(p),
      });
      pushed.length = 0;
      nextCalls.length = 0;
      p.leaveVolatileForQueue();
      check('leave volatile for queue does not publish', pushed.length === 0,
        JSON.stringify(pushed[0] || null));
      check('leave volatile for queue does not call next()', nextCalls.length === 0);
    }

    {
      const p = newPlugin({ queue_playback: false });
      p.deviceActive = true;
      logs.length = 0;
      p.stop();
      check('local stop still pauses', pauseCmds().length === 1, logs.join(' | '));
      check('local stop still yields', logs.indexOf('yield requested') !== -1);
    }

    {
      const p = newPlugin({ queue_playback: false });
      p.deviceActive = false;
      logs.length = 0;
      p.stop();
      check('stop after the session left does not pause',
        pauseCmds().length === 0, logs.join(' | '));
    }

    {
      const p = newPlugin();
      p.deviceActive = false;
      p.clearAddPlayTrack({ uri: OURS, service: 'soloist_connect' });
      logs.length = 0;
      p.endQueueRow('session left');
      check('queue row end after transfer does not pause',
        pauseCmds().length === 0, logs.join(' | '));
    }

    {
      const p = newPlugin({ queue_playback: false });
      p.deviceActive = false;
      logs.length = 0;
      p.pause();
      check('Volumio pause button still sends pause',
        pauseCmds().length === 1, logs.join(' | '));
    }
  }

  // 45. settings backup: key follows Retain; restore uses validate+apply
  {
    const dir = makeBackupDir();

    {
      const p = writablePlugin({ retain_api_key: true, api_key: 'spak_keep' }, dir);
      const snap = p.settingsBackupSnapshot();
      check('retain on includes api_key', snap.values.api_key === 'spak_keep');
      check('retain on snapshot is schema 1', snap.schema_version === 1);
      check('snapshot omits peppy_metering',
        !Object.prototype.hasOwnProperty.call(snap.values, 'peppy_metering'));
    }

    {
      const p = writablePlugin({ retain_api_key: false, api_key: 'spak_omit' }, dir);
      const snap = p.settingsBackupSnapshot();
      check('retain off omits api_key',
        !Object.prototype.hasOwnProperty.call(snap.values, 'api_key'));
    }

    {
      const p = writablePlugin({
        retain_api_key: false,
        api_key: 'spak_live',
        device_name: 'Speaker',
        peppy_metering: true,
      }, dir);
      toasts.length = 0;
      browsePushes.length = 0;
      await p.createSettingsBackup({ backup_name: 'no-key' });
      check('create no-key backup writes a file',
        fs.existsSync(path.join(dir, 'no-key.json')));
      check('create refreshes the open settings page',
        browsePushes.some((b) => b.emit === 'pushUiConfig'),
        JSON.stringify(browsePushes));
      p.config.set('api_key', 'spak_kept');
      p.config.set('device_name', 'Other');
      toasts.length = 0;
      logs.length = 0;
      p.restoreSettingsBackup({ selected_backup: 'no-key' });
      check('restore without key keeps live api_key', p.config.get('api_key') === 'spak_kept');
      check('restore without key applies device_name', p.config.get('device_name') === 'Speaker');
      check('restore does not write peppy_metering', p.config.get('peppy_metering') === true);
    }

    {
      const p = writablePlugin({ peppy_metering: true, device_name: 'Live' }, dir);
      fs.writeFileSync(path.join(dir, 'with-peppy.json'), JSON.stringify({
        schema_version: 1,
        values: {
          device_name: 'FromBak',
          retain_api_key: true,
          peppy_metering: false,
          initial_volume: 50,
          align_volume: false,
          output_trim_db: 0,
          buffer_ms: 500,
          cache_location: 'disk',
          cache_size_mb: 1024,
          seek_coalesce_ms: 200,
          inactive_hold_ms: 2000,
          quality_retry_ms: 300,
          quality_retry_max: 2,
          queue_fetch_ms: 2500,
          queue_playback: false,
          queue_remote_playback: false,
          verbose_logging: false,
        },
      }));
      p.restoreSettingsBackup({ selected_backup: 'with-peppy' });
      check('crafted peppy_metering in backup is ignored',
        p.config.get('peppy_metering') === true);
      check('crafted backup still applies device_name',
        p.config.get('device_name') === 'FromBak');
    }

    {
      const p = writablePlugin({}, dir);
      toasts.length = 0;
      p.createSettingsBackup({ backup_name: '../etc' });
      check('bad backup name is rejected',
        toasts.some((t) => t.type === 'error') &&
        !fs.existsSync(path.join(dir, '../etc.json')));
      check('bad backup name does not write under backup dir',
        fs.readdirSync(dir).indexOf('etc.json') === -1);
    }

    {
      const p = writablePlugin({ device_name: 'Unchanged' }, dir);
      fs.writeFileSync(path.join(dir, 'bad-schema.json'), JSON.stringify({
        schema_version: 2,
        values: { device_name: 'Evil' },
      }));
      toasts.length = 0;
      p.restoreSettingsBackup({ selected_backup: 'bad-schema' });
      check('bad schema is rejected', toasts.some((t) => t.type === 'error'));
      check('bad schema leaves live config', p.config.get('device_name') === 'Unchanged');
    }

    {
      const p = writablePlugin({ buffer_ms: 500, queue_playback: false }, dir);
      p.createSettingsBackup({ backup_name: 'daemon' });
      p.config.set('buffer_ms', 400);
      logs.length = 0;
      toasts.length = 0;
      p.restoreSettingsBackup({ selected_backup: { value: 'daemon', label: 'daemon' } });
      check('restore of daemon fields restarts Soloist',
        logs.indexOf('startDaemon') !== -1, logs.join(' | '));
      check('restore of daemon fields applies buffer_ms', p.config.get('buffer_ms') === 500);
    }

    {
      const p = writablePlugin({ buffer_ms: 500, queue_playback: false }, dir);
      p.createSettingsBackup({ backup_name: 'queue-only' });
      p.config.set('queue_playback', true);
      logs.length = 0;
      p.restoreSettingsBackup({ selected_backup: 'queue-only' });
      check('restore of queue only does not restart',
        logs.indexOf('startDaemon') === -1, logs.join(' | '));
      check('restore of queue only applies queue_playback',
        p.config.get('queue_playback') === false);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 46. account playing is not a local claim
  {
    function claimPlugin(config) {
      const p = newPlugin(Object.assign({ queue_playback: false }, config || {}));
      p.takeovers = 0;
      p.takeOverPlayback = function () { this.takeovers++; };
      return p;
    }

    {
      const p = claimPlugin();
      logs.length = 0;
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      check('account playing does not claim',
        p.takeovers === 0 && p.state.status === 'pause' && p.deviceActive === false);
      check('account playing logs the refusal',
        logs.some((l) => l === 'info SoloistConnect: not claiming: playing while is_active=false'),
        logs.join(' | '));
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, true));
      check('this speaker playing still claims',
        p.takeovers === 1 && p.deviceActive === true && p.state.status === 'play');
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, true));
      check('later local playing still claims',
        p.takeovers === 1 && p.deviceActive === true && p.state.status === 'play');
    }

    {
      const p = claimPlugin();
      p.deviceActive = false;
      p.handleEvent({ type: 'playback_changed', status: 'playing' });
      check('playback_changed playing while inactive does not claim',
        p.takeovers === 0 && p.state.status === 'pause');
    }

    {
      const p = claimPlugin();
      p.deviceActive = true;
      p.pendingYieldAt = Date.now();
      p.setStatus('playing');
      check('pendingYieldAt still blocks while this speaker',
        p.takeovers === 0 && p.state.status === 'pause');
    }

    {
      const p = claimPlugin();
      p.deviceActive = false;
      p.commandRouter.volumioGetState = function () {
        return { service: 'soloist_connect' };
      };
      p.setStatus('playing');
      check('already current still claims',
        p.takeovers === 1 && p.state.status === 'play');
    }

    {
      const p = claimPlugin();
      p.queueMode = true;
      p.queueUri = OURS;
      p.deviceActive = false;
      logs.length = 0;
      p.setStatus('playing');
      check('queue mode still does not takeOver', p.takeovers === 0);
      check('queue mode still clears yield',
        logs.indexOf('info SoloistConnect: not claiming: playing while is_active=false') === -1 &&
        logs.indexOf('yield cleared') !== -1,
        logs.join(' | '));
      check('queue mode still maps to play', p.state.status === 'play');
    }
  }

  // 46b. playing before is_active is claimed from device_changed only
  //
  // Soloist can send playing while is_active is still false, then
  // device_changed. The refusal is replayed from that edge for 2s
  // (CLAIM_DEFER_MS). Activation, auth_state, queue mode, pause, an aged
  // refusal, and the yield window do not claim.
  {
    function claimPlugin(config) {
      const p = newPlugin(Object.assign({ queue_playback: false }, config || {}));
      p.takeovers = 0;
      p.takeOverPlayback = function () { this.takeovers++; };
      return p;
    }

    {
      const p = claimPlugin();
      logs.length = 0;
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.handleEvent({ type: 'playback_changed', status: 'playing' });
      check('split handover has not claimed yet',
        p.takeovers === 0 && p.state.status === 'pause' && p.claimDeferredAt > 0);
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('device_changed claims the deferred play',
        p.takeovers === 1 && p.deviceActive === true && p.state.status === 'play' &&
        p.claimDeferredAt === 0);
      check('device_changed logs the deferred claim',
        logs.some((l) => l === 'info SoloistConnect: claiming deferred play: is_active=true'),
        logs.join(' | '));
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('second device_changed does not claim again', p.takeovers === 1);
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.claimDeferredAt = Date.now() - 2500;
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('aged refusal does not claim on activation',
        p.takeovers === 0 && p.claimDeferredAt === 0 && p.state.status === 'pause');
    }

    {
      const p = claimPlugin();
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('activation with no refused play does not claim',
        p.takeovers === 0 && p.claimDeferredAt === 0);
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.handleEvent(evt('paused', OURS, 1000, 'spotify:album:x', item, false));
      check('paused clears the deferred play', p.claimDeferredAt === 0 && p.state.status === 'pause');
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('activation after pause does not claim', p.takeovers === 0);
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.pendingYieldAt = Date.now();
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('yield window blocks the deferred claim',
        p.takeovers === 0 && p.state.status === 'pause' && p.claimDeferredAt === 0);
      p.pendingYieldAt = 0;
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('later device_changed does not revive a swallowed claim', p.takeovers === 0);
    }

    {
      const p = claimPlugin();
      p.pendingYieldAt = Date.now();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      check('leftover play is not remembered',
        p.takeovers === 0 && p.claimDeferredAt === 0 && p.state.status === 'pause');
      p.clearInactiveHold();
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.handleEvent({ type: 'device_changed', is_active: true, status: 'paused' });
      check('device_changed paused does not claim',
        p.takeovers === 0 && p.claimDeferredAt === 0 && p.state.status === 'pause');
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      const remembered = p.claimDeferredAt;
      p.handleEvent({ type: 'auth_state', logged_in: true, is_active: true });
      check('auth_state does not replay a refused play',
        p.takeovers === 0 && p.claimDeferredAt === remembered && p.deviceActive === true);
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.queueMode = true;
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('queue mode does not replay a refused play',
        p.takeovers === 0 && p.claimDeferredAt === 0 && p.state.status === 'pause');
    }

    {
      const p = claimPlugin();
      p.handleEvent(evt('playing', OURS, 1000, 'spotify:album:x', item, false));
      p.handleEvent(evt('buffering', OURS, 1000, 'spotify:album:x', item, false));
      check('buffering keeps the deferred play', p.claimDeferredAt > 0 && p.takeovers === 0);
      p.handleEvent({ type: 'device_changed', is_active: true });
      check('device_changed after buffering still claims',
        p.takeovers === 1 && p.state.status === 'play');
    }
  }

  // 47. engine prefs: loudness default on, crossfade default off
  {
    const { spawnSync } = require('child_process');
    const helper = path.join(__dirname, '..', 'apply-engine-prefs.sh');
    function runPrefs(dir, extra) {
      return spawnSync('bash', [helper], {
        env: Object.assign({}, process.env, { SOLOIST_DATA_DIR: dir }, extra || {}),
        encoding: 'utf8',
      });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const r = runPrefs(dir);
      const global = path.join(dir, 'settings', 'prefs');
      const text = fs.existsSync(global) ? fs.readFileSync(global, 'utf8') : '';
      check('helper default exits 0', r.status === 0, String(r.status) + ' ' + (r.stderr || ''));
      check('helper writes global prefs', fs.existsSync(global));
      check('helper does not create Users',
        !fs.existsSync(path.join(dir, 'settings', 'Users')));
      check('helper default writes normalize on', text.indexOf('audio.normalize_v2=true') !== -1, text);
      check('helper default writes crossfade off', text.indexOf('audio.crossfade_v2=false') !== -1, text);
      check('helper default drops time key', text.indexOf('audio.crossfade.time_v2') === -1, text);
      check('helper writes no quality key', text.indexOf('play_bitrate') === -1, text);
      check('helper default logs loudness on',
        (r.stderr || '').indexOf('engine_prefs loudness=on') !== -1, r.stderr);
      check('helper default logs crossfade off',
        (r.stderr || '').indexOf('crossfade=off') !== -1, r.stderr);
      check('helper logs one store', (r.stderr || '').indexOf('stores=1') !== -1, r.stderr);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const r = runPrefs(dir, { LOUDNESS_NORMALIZATION: 'false' });
      const text = fs.readFileSync(path.join(dir, 'settings', 'prefs'), 'utf8');
      check('helper loudness off exits 0', r.status === 0, String(r.status));
      check('helper writes normalize false', text.indexOf('audio.normalize_v2=false') !== -1, text);
      check('helper loudness off keeps fade off',
        text.indexOf('audio.crossfade_v2=false') !== -1 &&
        text.indexOf('audio.crossfade.time_v2') === -1, text);
      check('helper logs loudness off',
        (r.stderr || '').indexOf('engine_prefs loudness=off') !== -1, r.stderr);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const global = path.join(dir, 'settings', 'prefs');
      fs.mkdirSync(path.dirname(global), { recursive: true });
      fs.writeFileSync(global, 'keep.me=1\naudio.normalize_v2=true\nother=yes\n');
      const r = runPrefs(dir, { LOUDNESS_NORMALIZATION: 'false' });
      const text = fs.readFileSync(global, 'utf8');
      check('helper merge exits 0', r.status === 0, String(r.status));
      check('helper keeps unrelated lines',
        text.indexOf('keep.me=1') !== -1 && text.indexOf('other=yes') !== -1, text);
      check('helper replaces normalize once',
        (text.match(/audio\.normalize_v2=/g) || []).length === 1 &&
        text.indexOf('audio.normalize_v2=false') !== -1, text);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const user = path.join(dir, 'settings', 'Users', 'abc', 'prefs');
      fs.mkdirSync(path.dirname(user), { recursive: true });
      fs.writeFileSync(user, 'session=1\n');
      const r = runPrefs(dir, {
        LOUDNESS_NORMALIZATION: 'true',
        CROSSFADE: 'true',
        CROSSFADE_MS: '4000',
      });
      const userText = fs.readFileSync(user, 'utf8');
      check('helper user-store exits 0', r.status === 0, String(r.status));
      check('helper writes user prefs when present',
        userText.indexOf('audio.normalize_v2=true') !== -1 &&
        userText.indexOf('audio.crossfade_v2=true') !== -1 &&
        userText.indexOf('audio.crossfade.time_v2=4000') !== -1 &&
        userText.indexOf('session=1') !== -1, userText);
      check('helper writes both stores', (r.stderr || '').indexOf('stores=2') !== -1, r.stderr);
      check('helper logs fade time',
        (r.stderr || '').indexOf('crossfade=4000ms') !== -1, r.stderr);
      check('helper does not add a second user dir',
        fs.readdirSync(path.join(dir, 'settings', 'Users')).join(',') === 'abc');
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const global = path.join(dir, 'settings', 'prefs');
      fs.mkdirSync(path.dirname(global), { recursive: true });
      fs.writeFileSync(global,
        'audio.crossfade_v2=true\naudio.crossfade.time_v2=4000\nsession=1\n');
      const r = runPrefs(dir, { CROSSFADE: 'false' });
      const text = fs.readFileSync(global, 'utf8');
      check('helper off-after-on exits 0', r.status === 0, String(r.status));
      check('helper off writes boolean false', text.indexOf('audio.crossfade_v2=false') !== -1, text);
      check('helper off drops stale time', text.indexOf('audio.crossfade.time_v2') === -1, text);
      check('helper off keeps unrelated', text.indexOf('session=1') !== -1, text);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const r = runPrefs(dir, { CROSSFADE: 'true', CROSSFADE_MS: '500' });
      const text = fs.readFileSync(path.join(dir, 'settings', 'prefs'), 'utf8');
      check('helper short ms exits 0', r.status === 0);
      check('helper short ms clamps to 2000',
        text.indexOf('audio.crossfade.time_v2=2000') !== -1, text);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const r = runPrefs(dir, { CROSSFADE: 'true', CROSSFADE_MS: 'junk' });
      const text = fs.readFileSync(path.join(dir, 'settings', 'prefs'), 'utf8');
      check('helper junk ms exits 0', r.status === 0);
      check('helper junk ms writes 2000',
        text.indexOf('audio.crossfade.time_v2=2000') !== -1, text);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const r = runPrefs(dir, { CROSSFADE: 'true', CROSSFADE_MS: '15000' });
      const text = fs.readFileSync(path.join(dir, 'settings', 'prefs'), 'utf8');
      check('helper high ms exits 0', r.status === 0);
      check('helper high ms clamps to 12000',
        text.indexOf('audio.crossfade.time_v2=12000') !== -1, text);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-prefs-'));
      const r = runPrefs(dir, { LOUDNESS_NORMALIZATION: 'junk', CROSSFADE: 'junk' });
      const text = fs.readFileSync(path.join(dir, 'settings', 'prefs'), 'utf8');
      check('helper junk env exits 0', r.status === 0);
      check('helper junk loudness writes on', text.indexOf('audio.normalize_v2=true') !== -1, text);
      check('helper junk fade writes off',
        text.indexOf('audio.crossfade_v2=false') !== -1 &&
        text.indexOf('audio.crossfade.time_v2') === -1, text);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    {
      const dir = makeBackupDir();
      const p = writablePlugin({ retain_api_key: false }, dir);
      const snap = p.settingsBackupSnapshot();
      check('backup includes loudness_normalization',
        snap.values.loudness_normalization === true, JSON.stringify(snap.values));
      check('backup includes crossfade off',
        snap.values.crossfade === false, JSON.stringify(snap.values));
      check('backup includes crossfade_ms',
        snap.values.crossfade_ms === 2000, JSON.stringify(snap.values));
      check('backup includes auto_update_binary off',
        snap.values.auto_update_binary === false, JSON.stringify(snap.values));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 48. binary freshness: parse --version, daily clock, skip play/busy, pull does not reboot
  {
    const p = newPlugin();
    const built = 'Spotify Soloist 1.3.8.36 (20260617)';
    const day0 = Date.UTC(2026, 5, 17);
    check('remaining at build day is 90',
      p.remainingBinaryDays(built, 0, day0) === 90);
    check('remaining at day 83 is 7',
      p.remainingBinaryDays(built, 0, day0 + 83 * 86400000) === 7);
    check('remaining at day 90 is 0',
      p.remainingBinaryDays(built, 0, day0 + 90 * 86400000) === 0);
    check('remaining after expiry is 0',
      p.remainingBinaryDays(built, 0, day0 + 91 * 86400000) === 0);
    check('exit 10 is already dead',
      p.remainingBinaryDays(built, 10, day0) === 0);
    check('junk version is unknown',
      p.remainingBinaryDays('not a version', 0, day0) === null);
    check('missing date is unknown',
      p.remainingBinaryDays('1.3.8.36', 0, day0) === null);

    let ticks = 0;
    p.runFreshnessTick = function () { ticks++; };
    p.freshnessCheckMs = 40;
    logs.length = 0;
    p.armFreshnessTimer({ initial: true });
    check('arm logs the 24h period once',
      logs.filter((l) => l.indexOf('freshness armed period=24h') !== -1).length === 1,
      logs.join(' | '));
    await new Promise((r) => setTimeout(r, 80));
    check('first fire is after the delay, not at arm', ticks === 1, String(ticks));
    logs.length = 0;
    p.armFreshnessTimer();
    check('re-arm does not log again',
      !logs.some((l) => l.indexOf('freshness armed') !== -1), logs.join(' | '));
    p.clearFreshnessTimer();
    const ticksAfterClear = ticks;
    await new Promise((r) => setTimeout(r, 80));
    check('clear stops the pending fire', ticks === ticksAfterClear, String(ticks));

    function freshnessActions(opts) {
      const fp = newPlugin({ auto_update_binary: !!opts.auto });
      let pulled = 0;
      fp.volatileSet = !!opts.volatile;
      fp.queueMode = !!opts.queue;
      fp.binaryUpdateBusy = !!opts.busy;
      fp.pullFreshBinary = function () { pulled++; };
      logs.length = 0;
      toasts.length = 0;
      fp.applyFreshness(opts.remaining);
      const line = logs.find((l) => l.indexOf('SoloistConnect: freshness remaining=') !== -1) || '';
      return { pulled: pulled, line: line, toasts: toasts.slice() };
    }

    const farOff = freshnessActions({ remaining: 80, auto: false });
    check('far remaining auto-off is noop',
      /remaining=80 auto=off action=noop/.test(farOff.line) && farOff.pulled === 0,
      farOff.line);
    const expiredOff = freshnessActions({ remaining: 0, auto: false });
    check('expired auto-off toasts for the button',
      /remaining=0 auto=off action=expired-off/.test(expiredOff.line) &&
      expiredOff.pulled === 0 &&
      expiredOff.toasts.some((t) => /expired/.test(t.msg)),
      expiredOff.line);
    const unknown = freshnessActions({ remaining: null, auto: true });
    check('unknown remaining is noop',
      /remaining=unknown auto=on action=noop/.test(unknown.line) && unknown.pulled === 0,
      unknown.line);
    const farOn = freshnessActions({ remaining: 80, auto: true });
    check('far remaining auto-on is noop',
      /remaining=80 auto=on action=noop/.test(farOn.line) && farOn.pulled === 0,
      farOn.line);
    const play = freshnessActions({ remaining: 3, auto: true, volatile: true });
    check('near expiry while we own playback skips',
      /remaining=3 auto=on action=skip-play/.test(play.line) && play.pulled === 0,
      play.line);
    const queue = freshnessActions({ remaining: 3, auto: true, queue: true });
    check('near expiry on a queue row skips',
      /remaining=3 auto=on action=skip-play/.test(queue.line) && queue.pulled === 0,
      queue.line);
    const busy = freshnessActions({ remaining: 3, auto: true, busy: true });
    check('shared busy flag skips a pull',
      /remaining=3 auto=on action=skip-busy/.test(busy.line) && busy.pulled === 0,
      busy.line);
    const radio = freshnessActions({ remaining: 3, auto: true });
    check('web radio and other idle sources can pull',
      /remaining=3 auto=on action=pull/.test(radio.line) && radio.pulled === 1,
      radio.line);

    const puller = newPlugin({ auto_update_binary: true });
    let countdown = 0;
    let started = 0;
    puller.initUpdateRebootCountdown = function () { countdown++; };
    puller.startDaemon = function () { started++; return libQ.resolve(); };
    puller.connectWebSocket = function () { logs.push('connectWebSocket'); };
    puller.runDownloadScript = function (cb) { cb(null); };
    logs.length = 0;
    toasts.length = 0;
    puller.pullFreshBinary();
    await new Promise((r) => setTimeout(r, 30));
    check('silent pull starts the daemon and does not reboot',
      started === 1 && countdown === 0 && !logs.includes('reboot'),
      'started=' + started + ' countdown=' + countdown);
    check('silent pull drops the busy flag', puller.binaryUpdateBusy === false);
    check('silent pull says no reboot',
      toasts.some((t) => t.type === 'success' && /No reboot/.test(t.msg)));

    const failPull = newPlugin({ auto_update_binary: true });
    failPull.initUpdateRebootCountdown = function () { countdown++; };
    failPull.startDaemon = function () { started++; return libQ.resolve(); };
    failPull.runDownloadScript = function (cb) { cb(new Error('cdn fail')); };
    toasts.length = 0;
    failPull.pullFreshBinary();
    check('failed silent pull leaves the running binary',
      failPull.binaryUpdateBusy === false &&
      toasts.some((t) => t.type === 'error' && /left alone/.test(t.msg)));
  }

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
}

main();
