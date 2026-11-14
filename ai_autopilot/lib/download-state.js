'use strict';

function qobuzTrackIdFromUri(uri) {
  const m = String(uri || '').match(/^qobuz:\/\/(?:song|track)\/(\d+)/i);
  return m ? m[1] : null;
}

function localQobuzTrackIdFromUri(uri) {
  const m = String(uri || '').match(/^(?:music-library\/(?:INTERNAL|USB)|\/?mnt\/(?:INTERNAL|USB)|(?:INTERNAL|USB))\/qobuz-tap\/(\d+)\.[^/]+$/i);
  return m ? m[1] : null;
}

function localQobuzPlaybackFromState(state) {
  const uri = state && state.uri ? String(state.uri) : '';
  const trackId = state && state.service === 'mpd' ? localQobuzTrackIdFromUri(uri) : null;
  return {
    active: !!trackId,
    trackId: trackId || '',
    libraryUri: trackId ? uri : ''
  };
}

function findLocalQobuzQueueIndex(queue, trackId) {
  if (!Array.isArray(queue) || !trackId) return -1;
  const wanted = String(trackId);
  for (let i = 0; i < queue.length; i++) {
    if (String(localQobuzTrackIdFromUri(queue[i] && queue[i].uri) || '') === wanted) return i;
  }
  return -1;
}

function downloadStatusForTrack(trackId, opts) {
  if (!trackId) return null;
  opts = opts || {};
  const jobs = opts.jobs || {};
  const job = jobs[String(trackId)] || null;
  const cachedFile = opts.cachedFile || null;
  const libraryUri = opts.libraryUri || (job && job.libraryUri) || '';
  const playingLocal = !!(opts.localPlaybackTrackId && String(opts.localPlaybackTrackId) === String(trackId));
  const localPlaybackLibraryUri = opts.localPlaybackLibraryUri || '';

  if (cachedFile || (job && job.state === 'done' && libraryUri)) {
    const status = {
      state: 'cached',
      progress: 1,
      cached: true,
      libraryUri: libraryUri
    };
    if (playingLocal) status.playingLocal = true;
    return status;
  }

  if (job) {
    return {
      state: job.state || 'queued',
      progress: Number(job.progress) || 0,
      cached: false,
      libraryUri: job.libraryUri || '',
      error: job.error || ''
    };
  }

  return playingLocal ? {
    state: 'playing-local',
    progress: 1,
    cached: true,
    libraryUri: localPlaybackLibraryUri,
    playingLocal: true
  } : null;
}

module.exports = {
  qobuzTrackIdFromUri,
  localQobuzTrackIdFromUri,
  localQobuzPlaybackFromState,
  findLocalQobuzQueueIndex,
  downloadStatusForTrack
};
