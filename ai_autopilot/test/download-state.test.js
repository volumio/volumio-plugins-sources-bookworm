'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  qobuzTrackIdFromUri,
  localQobuzTrackIdFromUri,
  localQobuzPlaybackFromState,
  findLocalQobuzQueueIndex,
  downloadStatusForTrack
} = require('../lib/download-state');
const { TrackCache } = require('../lib/track-cache');

function testQobuzTrackIdFromUri() {
  assert.strictEqual(qobuzTrackIdFromUri('qobuz://song/123456'), '123456');
  assert.strictEqual(qobuzTrackIdFromUri('qobuz://track/987'), '987');
  assert.strictEqual(qobuzTrackIdFromUri('music-library/INTERNAL/qobuz-tap/123456.flac'), null);
  assert.strictEqual(qobuzTrackIdFromUri('tidal://song/123456'), null);
  assert.strictEqual(qobuzTrackIdFromUri(''), null);
}

function testLocalQobuzTrackIdFromUri() {
  assert.strictEqual(localQobuzTrackIdFromUri('music-library/INTERNAL/qobuz-tap/123456.flac'), '123456');
  assert.strictEqual(localQobuzTrackIdFromUri('/mnt/INTERNAL/qobuz-tap/987.flac'), '987');
  assert.strictEqual(localQobuzTrackIdFromUri('mnt/INTERNAL/qobuz-tap/987.flac'), '987');
  assert.strictEqual(localQobuzTrackIdFromUri('INTERNAL/qobuz-tap/987.flac'), '987');
  assert.strictEqual(localQobuzTrackIdFromUri('music-library/USB/qobuz-tap/42.flac'), '42');
  assert.strictEqual(localQobuzTrackIdFromUri('qobuz://song/123456'), null);
  assert.strictEqual(localQobuzTrackIdFromUri('music-library/INTERNAL/other/123456.flac'), null);
}

function testLocalQobuzPlaybackFromState() {
  assert.deepStrictEqual(localQobuzPlaybackFromState({
    service: 'mpd',
    uri: 'music-library/INTERNAL/qobuz-tap/123456.flac'
  }), {
    active: true,
    trackId: '123456',
    libraryUri: 'music-library/INTERNAL/qobuz-tap/123456.flac'
  });
  assert.deepStrictEqual(localQobuzPlaybackFromState({
    service: 'qobuz',
    uri: 'qobuz://song/123456'
  }), {
    active: false,
    trackId: '',
    libraryUri: ''
  });
}

function testFindLocalQobuzQueueIndex() {
  const queue = [
    { uri: 'qobuz://song/42' },
    { uri: 'mnt/INTERNAL/qobuz-tap/77.flac' },
    { uri: 'qobuz://song/77' }
  ];
  assert.strictEqual(findLocalQobuzQueueIndex(queue, '77'), 1);
  assert.strictEqual(findLocalQobuzQueueIndex(queue, '42'), -1);
  assert.strictEqual(findLocalQobuzQueueIndex(null, '77'), -1);
}

function testDownloadStatusForTrack() {
  assert.deepStrictEqual(downloadStatusForTrack('42', {
    jobs: { '42': { state: 'downloading', progress: 0.4 } },
    cachedFile: null
  }), {
    state: 'downloading',
    progress: 0.4,
    cached: false,
    libraryUri: '',
    error: ''
  });

  assert.deepStrictEqual(downloadStatusForTrack('42', {
    jobs: { '42': { state: 'error', progress: 0, error: 'missing credentials' } },
    cachedFile: null
  }), {
    state: 'error',
    progress: 0,
    cached: false,
    libraryUri: '',
    error: 'missing credentials'
  });

  assert.deepStrictEqual(downloadStatusForTrack('42', {
    jobs: { '42': { state: 'done', progress: 1, libraryUri: 'music-library/INTERNAL/qobuz-tap/42.flac' } },
    cachedFile: '/mnt/INTERNAL/qobuz-tap/42.flac',
    libraryUri: 'music-library/INTERNAL/qobuz-tap/42.flac'
  }), {
    state: 'cached',
    progress: 1,
    cached: true,
    libraryUri: 'music-library/INTERNAL/qobuz-tap/42.flac'
  });

  assert.deepStrictEqual(downloadStatusForTrack('77', {
    jobs: {},
    cachedFile: '/mnt/INTERNAL/qobuz-tap/77.flac',
    libraryUri: 'music-library/INTERNAL/qobuz-tap/77.flac'
  }), {
    state: 'cached',
    progress: 1,
    cached: true,
    libraryUri: 'music-library/INTERNAL/qobuz-tap/77.flac'
  });

  assert.strictEqual(downloadStatusForTrack(null, { jobs: {} }), null);

  assert.deepStrictEqual(downloadStatusForTrack('42', {
    jobs: {},
    cachedFile: '/mnt/INTERNAL/qobuz-tap/42.flac',
    libraryUri: 'music-library/INTERNAL/qobuz-tap/42.flac',
    localPlaybackTrackId: '42'
  }), {
    state: 'cached',
    progress: 1,
    cached: true,
    libraryUri: 'music-library/INTERNAL/qobuz-tap/42.flac',
    playingLocal: true
  });
}

function testTrackCacheIgnoresPartialFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-autopilot-cache-'));
  try {
    fs.writeFileSync(path.join(dir, '42.flac.part'), 'partial');
    const cache = new TrackCache({ dir, resolveStreamUrl: async () => '', logger: console });
    assert.strictEqual(cache.existing('42'), null);
    fs.writeFileSync(path.join(dir, '42.flac'), 'done');
    assert.strictEqual(cache.existing('42'), path.join(dir, '42.flac'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

testQobuzTrackIdFromUri();
testLocalQobuzTrackIdFromUri();
testLocalQobuzPlaybackFromState();
testFindLocalQobuzQueueIndex();
testDownloadStatusForTrack();
testTrackCacheIgnoresPartialFiles();
console.log('download state tests passed');
