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
  // Right after the stream is (re)issued the sound card is still closed while
  // MPD connects and buffers (~1.5 s on fab-01). For this long neither the card
  // is taken as evidence, so a reissue is not reissued again before it can
  // work. The same wait applies to a `stop` from Volumio after the plugin's
  // own reissue (`reissuedAt`): one command every 10 s at most.
  audioGraceMs:        10000,
  // Right after the offline playlist is queued, Volumio can still report the
  // stream it is replacing — playing, or stopped while it gives up connecting
  // (zupt, 2026-11-03 10:57:33). For this long that state is not believed.
  offlineGraceMs:      10000,
  // MPD's silence counts as a stopped radio only once it has lasted this
  // long. MPD rides out short network hiccups by itself (one or two lines of
  // "Decoder is too slow"), and a reissue during one cuts a connection that
  // would have recovered (zupt, 2026-11-03 10:52). The stalls that never end
  // by themselves lasted 3 min, 24 min and 27 h.
  mpdSilenceMs:        20000,
  // MPD logs every ~5 s while silent, the tick is 5 s: one tick without a
  // line inside this gap does not end the silence.
  mpdSilenceGapMs:     10000,
  autoRestore:         true
};

function isStream(obs) {
  return obs.stream === true || obs.service === 'webradio';
}

function initialMemory() {
  return { wanted: null, mode: MODE.RADIO, stops: 0, lastTryAt: 0, tries: 0, lastPlayAt: 0,
           reissuedAt: 0, offlineAt: 0, silentSince: 0, silentAt: 0 };
}

function copy(mem) {
  return {
    wanted:    mem.wanted ? { uri: mem.wanted.uri, service: mem.wanted.service,
                              title: mem.wanted.title } : null,
    mode:      mem.mode,
    stops:     mem.stops,
    lastTryAt: mem.lastTryAt,
    tries:     mem.tries || 0,
    lastPlayAt: mem.lastPlayAt || 0,
    reissuedAt: mem.reissuedAt || 0,
    offlineAt:  mem.offlineAt || 0,
    silentSince: mem.silentSince || 0,
    silentAt:   mem.silentAt || 0
  };
}

/** How long FALLBACK waits before the next restore: base × 2^tries, capped. */
function restoreWait(mem, cfg) {
  var c = Object.assign({}, DEFAULTS, cfg || {});
  var cap = Math.max(c.maxRestoreIntervalMs, c.restoreIntervalMs);
  return Math.min(c.restoreIntervalMs * Math.pow(2, (mem && mem.tries) || 0), cap);
}

/** The offline playlist was actually queued: its start-up grace runs from now. */
function noteOffline(mem, now) {
  var m = copy(mem);
  m.offlineAt = now;
  return m;
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

/** silence: 'card' | 'mpd' when what was acted on is silence Volumio did not report. */
function result(action, mem, why, silence) {
  var r = { action: action, mem: mem, why: why };
  if (silence === 'card') r.cardIdle = true;
  if (silence === 'mpd')  r.starved  = true;
  return r;
}

/**
 * @param {object|null} obs  player state ({status, uri, service, stream, title}),
 *                           or null when it could not be read; `audio` is the
 *                           sound card (true flowing, false idle, null/absent
 *                           unknown — see lib/soundcard.js); `starved` is true
 *                           when MPD played silence since the last tick
 *                           (lib/mpdlog.js); `offline` is true when the
 *                           track playing is one the plugin queued itself
 *                           (lib/offline.js)
 * @param {object} mem       the memory returned by the previous call
 * @param {number} now       epoch ms
 * @param {object} [cfg]     overrides for DEFAULTS
 * @returns {{action: string, mem: object, why: string, cardIdle?: boolean, starved?: boolean}}
 *          cardIdle / starved are set when the card's silence / MPD's
 *          silence is what was acted on
 */
function decide(obs, mem, now, cfg) {
  var c = Object.assign({}, DEFAULTS, cfg || {});
  var m = copy(mem || initialMemory());

  // An unreadable state is not evidence of anything: neither count it nor
  // clear the streak. The next tick asks again.
  if (!obs) return result(ACTION.NONE, m, 'player state unreadable');

  var playing = obs.status === 'play';
  var paused  = obs.status === 'pause';

  // Volumio can stay on `pause` after a resume while MPD plays again (fab-01,
  // 2026-10-30: pause, then play). The sound card is the better witness.
  if (paused && obs.audio === true) { playing = true; paused = false; }

  // How long has MPD been playing silence? Only a silence that outlasts a
  // network hiccup is acted on.
  if (obs.starved === true) {
    if (!m.silentSince || now - m.silentAt > c.mpdSilenceGapMs) m.silentSince = now;
    m.silentAt = now;
  } else if (obs.starved === false && now - m.silentAt > c.mpdSilenceGapMs) {
    m.silentSince = 0;
  }
  var mpdSilent = obs.starved === true && now - m.silentSince >= c.mpdSilenceMs;

  // Volumio says the radio is playing but nothing is heard: the sound card is
  // not playing (2026-10-30 07:10: MPD stopped underneath, 3 h 30 of silence)
  // or MPD has been feeding it silence for a while (2026-10-30 18:12: the
  // stream's connection stalled, 24 min). That is a stopped radio, and it goes down the same path
  // as one: count, reissue, offline playlist.
  var silence = null; // 'card' | 'mpd'
  if (playing && (obs.audio === false || mpdSilent) && m.wanted &&
      m.mode === MODE.RADIO && isStream(obs) && (!obs.uri || obs.uri === m.wanted.uri)) {
    if (now - m.lastPlayAt < c.audioGraceMs) {
      // Our own reissue is still starting. Neither count it nor clear the
      // streak — clearing it would reissue forever and never fall back.
      return result(ACTION.NONE, m, 'the stream was just reissued — giving the sound card time');
    }
    silence = obs.audio === false ? 'card' : 'mpd';
    playing = false;
  }

  // ---- nothing to look after ----------------------------------------------
  if (!m.wanted) {
    if (playing && isStream(obs) && obs.uri) {
      m.wanted = wantedFrom(obs);
      m.mode   = MODE.RADIO;
      m.stops  = 0;
      m.tries  = 0;
      m.lastPlayAt = now; // a station just tuned may still be buffering
      return result(ACTION.ADOPT, m, 'a stream started playing');
    }
    return result(ACTION.NONE, m, 'no stream to watch');
  }

  // ---- the offline playlist was just queued ---------------------------------
  // What Volumio reports for a few seconds is the stream being replaced, not
  // the result: taking it for "the stream is back" flipped to RADIO, and the
  // playlist that then started was taken for the user's choice (2026-11-03).
  var offlinePlaying = playing && !isStream(obs);
  if (m.mode === MODE.FALLBACK && now - m.offlineAt < c.offlineGraceMs && !offlinePlaying) {
    return result(ACTION.NONE, m, 'the offline playlist is starting');
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
        m.lastPlayAt = now;
        return result(ACTION.ADOPT, m, 'another stream is playing');
      }
      if (m.mode === MODE.FALLBACK) {
        // Our restore took hold — or the user resumed it. Either way: radio.
        m.mode  = MODE.RADIO;
        m.tries = 0;
        m.lastPlayAt = now;
        return result(ACTION.NONE, m, 'the stream is playing again');
      }
      return result(ACTION.NONE, m, 'the stream is playing');
    }

    // Local music the plugin queued itself is the offline playlist, whatever
    // the mode says: never the user's choice.
    if (m.mode === MODE.RADIO && obs.offline === true) {
      m.mode      = MODE.FALLBACK;
      m.lastTryAt = now; // the stream just failed: wait a full interval
      return result(ACTION.NONE, m, 'the offline playlist is playing');
    }

    // Any other local music. In RADIO mode nobody but the user put it there.
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

  // ---- stopped, or paused -------------------------------------------------
  // A pause pressed in the Volumio UI has already made the plugin forget the
  // stream (userCommand). One that is still here came from elsewhere — a
  // remote, a script, MPD pausing itself when its output fails — and nobody
  // is there to undo it: on a radio it is a stop like any other.
  // Our own reissue is still being carried out: Volumio says `stop` until MPD
  // has connected. A second command now would pile onto the first — on
  // 2026-11-05 two reissues and the offline playlist, 5 s apart into an MPD
  // held by a stalled connection, left the radio playing over a queue of
  // offline tracks. As with the sound card: neither counted nor cleared.
  if (m.mode === MODE.RADIO && silence === null && now - m.reissuedAt < c.audioGraceMs) {
    return result(ACTION.NONE, m, 'the stream was just reissued — giving it time');
  }

  m.stops++;
  var stopped = silence === 'card' ? 'the sound card is not playing'
              : silence === 'mpd'  ? 'MPD is playing silence'
              : paused             ? 'the player is paused' : 'the stream is stopped';

  if (m.mode === MODE.RADIO) {
    if (m.stops >= c.stopsBeforeFallback) {
      m.mode      = MODE.FALLBACK;
      m.stops     = 0;
      m.lastTryAt = now; // the stream just failed: wait a full interval
      m.tries     = 0;
      m.offlineAt = now;
      return result(ACTION.PLAY_OFFLINE, m, 'the stream did not come back', silence);
    }
    if (m.stops >= c.stopsBeforeReissue) {
      m.lastPlayAt = now;
      m.reissuedAt = now;
      return result(ACTION.PLAY_RADIO, m, stopped, silence);
    }
    return result(ACTION.NONE, m, silence === 'card' ? 'sound card idle — confirming on the next tick'
                                : silence === 'mpd'  ? 'MPD playing silence — confirming on the next tick'
                                : paused             ? 'paused — confirming on the next tick'
                                                     : 'stopped — confirming on the next tick', silence);
  }

  // FALLBACK and stopped: the playlist ended, died, or a restore attempt
  // failed. In every one of those cases the answer is the playlist.
  if (m.stops >= c.stopsBeforeReplay) {
    m.stops = 0;
    m.offlineAt = now;
    return result(ACTION.PLAY_OFFLINE, m, 'nothing is playing in fallback');
  }
  return result(ACTION.NONE, m, 'stopped — confirming on the next tick');
}

// Buttons of the Volumio UI that mean "not the radio, not now". Only the UI
// counts: a person opened it and pressed the button. The same commands from
// the REST API or the CLI — a Bluetooth remote through triggerhappy, a
// script — are treated like any other failure and undone.
var UI_OFF  = { stop: true, pause: true };
var UI_SKIP = { next: true, prev: true };

/**
 * A button was pressed in the Volumio UI. Stop and pause: the music off.
 * Next and back: away from the radio — in RADIO mode only; in FALLBACK they
 * just skip a track of the offline playlist, and the radio is still wanted.
 * @returns {{mem: object, forgot: boolean}}
 */
function userCommand(mem, cmd) {
  var m = copy(mem || initialMemory());
  if (m.wanted && (UI_OFF[cmd] || (UI_SKIP[cmd] && m.mode === MODE.RADIO))) {
    return { mem: forget(m), forgot: true };
  }
  return { mem: m, forgot: false };
}

/** The user stopped playback on purpose: look after nothing. */
function forget(mem) {
  var m = copy(mem || initialMemory());
  m.wanted = null;
  m.mode   = MODE.RADIO;
  m.stops  = 0;
  m.tries  = 0;
  m.offlineAt = 0;
  m.silentSince = 0;
  m.silentAt = 0;
  return m;
}

module.exports = {
  MODE: MODE, ACTION: ACTION, DEFAULTS: DEFAULTS,
  decide: decide, forget: forget, userCommand: userCommand,
  noteAttempt: noteAttempt, noteOffline: noteOffline, restoreWait: restoreWait,
  initialMemory: initialMemory, isStream: isStream
};
