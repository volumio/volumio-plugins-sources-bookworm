'use strict';

// =============================================================================
// decide() — the whole policy of the watchdog, as one pure function.
//
// Every tick the plugin reads the player state and asks: "should the radio be
// playing, and is it?" This function answers with the single next step. It
// has no timers, no Volumio and no network inside, so every case it handles
// can be written down as one row of a test table.
//
// Why a loop instead of reacting to events: in 1.x each recovery path issued
// a command and then waited for an event to say it had worked. When the event
// never came (2026-10-21, 03:12 — the station flapping right after its nightly
// restart), the plugin sat in FALLBACK with no timer armed for eight hours.
// Here nothing waits. The confirmation of every action is the next tick, and
// the tick never stops while the plugin is active.
// =============================================================================

var MODE = {
  RADIO:    'RADIO',    // the wanted stream should be playing
  FALLBACK: 'FALLBACK'  // the offline playlist is standing in for it
};

var ACTION = {
  NONE:         'NONE',
  ADOPT:        'ADOPT',         // a stream started playing — look after it
  FORGET:       'FORGET',        // the user moved on — look after nothing
  PLAY_RADIO:   'PLAY_RADIO',    // (re)issue the wanted stream
  PLAY_OFFLINE: 'PLAY_OFFLINE',  // play the offline playlist, freshly shuffled
  TRY_RADIO:    'TRY_RADIO'      // probe the stream; play it only if it answers
};

var DEFAULTS = {
  // One stopped tick can be Volumio between two of its own states, so a stop
  // is seen twice before anything is done about it.
  stopsBeforeReissue:  2,
  // After this many stopped ticks in a row the radio is given up for now.
  stopsBeforeFallback: 4,
  // The offline playlist reports `stop` for an instant between tracks; a
  // failed restore also lands here, and goes back to the playlist.
  stopsBeforeReplay:   2,
  restoreIntervalMs:   30000,
  // Each restore that reaches the radio and fails doubles the wait before the
  // next one, up to this cap. A station that answers but sends no audio for
  // hours would otherwise cut the playlist for a few seconds every interval.
  // A probe that fails costs nothing audible, so it does not count.
  maxRestoreIntervalMs: 600000,
  autoRestore:         true
};

function isStream(obs) {
  return obs.stream === true || obs.service === 'webradio';
}

function initialMemory() {
  return { wanted: null, mode: MODE.RADIO, stops: 0, lastTryAt: 0, tries: 0 };
}

function copy(mem) {
  return {
    wanted:    mem.wanted ? { uri: mem.wanted.uri, service: mem.wanted.service,
                              title: mem.wanted.title } : null,
    mode:      mem.mode,
    stops:     mem.stops,
    lastTryAt: mem.lastTryAt,
    tries:     mem.tries || 0
  };
}

/** How long FALLBACK waits before the next restore: base × 2^tries, capped. */
function restoreWait(mem, cfg) {
  var c = Object.assign({}, DEFAULTS, cfg || {});
  var cap = Math.max(c.maxRestoreIntervalMs, c.restoreIntervalMs);
  return Math.min(c.restoreIntervalMs * Math.pow(2, (mem && mem.tries) || 0), cap);
}

/** A restore passed the probe and the radio was played: count the attempt. */
function noteAttempt(mem) {
  var m = copy(mem);
  m.tries++;
  return m;
}

function wantedFrom(obs) {
  return { uri: obs.uri, service: obs.service || 'webradio', title: obs.title || undefined };
}

function result(action, mem, why) {
  return { action: action, mem: mem, why: why };
}

/**
 * @param {object|null} obs  player state ({status, uri, service, stream, title}),
 *                           or null when it could not be read
 * @param {object} mem       the memory returned by the previous call
 * @param {number} now       epoch ms
 * @param {object} [cfg]     overrides for DEFAULTS
 * @returns {{action: string, mem: object, why: string}}
 */
function decide(obs, mem, now, cfg) {
  var c = Object.assign({}, DEFAULTS, cfg || {});
  var m = copy(mem || initialMemory());

  // An unreadable state is not evidence of anything: neither count it nor
  // clear the streak. The next tick asks again.
  if (!obs) return result(ACTION.NONE, m, 'player state unreadable');

  var playing = obs.status === 'play';

  // ---- nothing to look after ----------------------------------------------
  if (!m.wanted) {
    if (playing && isStream(obs) && obs.uri) {
      m.wanted = wantedFrom(obs);
      m.mode   = MODE.RADIO;
      m.stops  = 0;
      m.tries  = 0;
      return result(ACTION.ADOPT, m, 'a stream started playing');
    }
    return result(ACTION.NONE, m, 'no stream to watch');
  }

  // ---- something is playing -----------------------------------------------
  if (playing) {
    m.stops = 0;

    if (isStream(obs)) {
      if (obs.uri && obs.uri !== m.wanted.uri) {
        // The user tuned to another station. That one is now the radio.
        m.wanted = wantedFrom(obs);
        m.mode   = MODE.RADIO;
        m.tries  = 0;
        return result(ACTION.ADOPT, m, 'another stream is playing');
      }
      if (m.mode === MODE.FALLBACK) {
        // Our restore took hold — or the user resumed it. Either way: radio.
        m.mode  = MODE.RADIO;
        m.tries = 0;
        return result(ACTION.NONE, m, 'the stream is playing again');
      }
      return result(ACTION.NONE, m, 'the stream is playing');
    }

    // Local music. In RADIO mode nobody but the user put it there.
    if (m.mode === MODE.RADIO) {
      m.wanted = null;
      return result(ACTION.FORGET, m, 'the user switched to a local source');
    }

    // FALLBACK: our own playlist is playing. Is it time to try the radio?
    if (c.autoRestore && now - m.lastTryAt >= restoreWait(m, c)) {
      m.lastTryAt = now;
      return result(ACTION.TRY_RADIO, m, 'time to check whether the stream is back');
    }
    return result(ACTION.NONE, m, 'the offline playlist is playing');
  }

  // ---- paused: a person did that, leave it alone --------------------------
  if (obs.status === 'pause') {
    m.stops = 0;
    return result(ACTION.NONE, m, 'paused');
  }

  // ---- stopped -------------------------------------------------------------
  m.stops++;

  if (m.mode === MODE.RADIO) {
    if (m.stops >= c.stopsBeforeFallback) {
      m.mode      = MODE.FALLBACK;
      m.stops     = 0;
      m.lastTryAt = now; // the stream just failed: wait a full interval
      m.tries     = 0;
      return result(ACTION.PLAY_OFFLINE, m, 'the stream did not come back');
    }
    if (m.stops >= c.stopsBeforeReissue) {
      return result(ACTION.PLAY_RADIO, m, 'the stream is stopped');
    }
    return result(ACTION.NONE, m, 'stopped — confirming on the next tick');
  }

  // FALLBACK and stopped: the playlist ended, died, or a restore attempt
  // failed. In every one of those cases the answer is the playlist.
  if (m.stops >= c.stopsBeforeReplay) {
    m.stops = 0;
    return result(ACTION.PLAY_OFFLINE, m, 'nothing is playing in fallback');
  }
  return result(ACTION.NONE, m, 'stopped — confirming on the next tick');
}

/** The user stopped playback on purpose: look after nothing. */
function forget(mem) {
  var m = copy(mem || initialMemory());
  m.wanted = null;
  m.mode   = MODE.RADIO;
  m.stops  = 0;
  m.tries  = 0;
  return m;
}

module.exports = {
  MODE: MODE, ACTION: ACTION, DEFAULTS: DEFAULTS,
  decide: decide, forget: forget, noteAttempt: noteAttempt, restoreWait: restoreWait,
  initialMemory: initialMemory, isStream: isStream
};
