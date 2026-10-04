'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { QobuzMetadataCache, normalizeTrackMeta } = require('../lib/qobuz-metadata-cache');

function testNormalizeTrackMeta() {
  const meta = normalizeTrackMeta('42', {
    name: 'Track Title',
    artist: 'Artist',
    album: 'Album',
    albumart: '/albumart?id=1',
    uri: 'qobuz://song/42'
  });
  assert.strictEqual(typeof meta.updatedAt, 'number');
  delete meta.updatedAt;
  assert.deepStrictEqual(meta, {
    trackId: '42',
    title: 'Track Title',
    artist: 'Artist',
    album: 'Album',
    albumart: '/albumart?id=1',
    uri: 'qobuz://song/42'
  });
  assert.strictEqual(normalizeTrackMeta('not-id', { title: 'x' }), null);
  assert.strictEqual(normalizeTrackMeta('42', {}), null);
}

function testCacheRoundTrip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-autopilot-meta-'));
  const filePath = path.join(dir, 'qobuz-meta.json');
  try {
    const cache = new QobuzMetadataCache({ filePath, logger: console });
    cache.load();
    const remembered = cache.remember('762667', {
      title: 'Part I',
      artist: 'Keith Jarrett',
      album: 'The Koln Concert',
      albumart: '/albumart?x=1'
    });
    assert.strictEqual(remembered.title, 'Part I');
    assert.strictEqual(remembered.artist, 'Keith Jarrett');

    const reloaded = new QobuzMetadataCache({ filePath, logger: console });
    reloaded.load();
    assert.strictEqual(reloaded.get('762667').album, 'The Koln Concert');
    assert.strictEqual(reloaded.get('missing'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

testNormalizeTrackMeta();
testCacheRoundTrip();
console.log('qobuz metadata cache tests passed');
