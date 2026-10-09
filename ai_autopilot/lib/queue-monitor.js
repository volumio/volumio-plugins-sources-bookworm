'use strict';

/**
 * Polls Volumio state/queue and:
 *   - Records the currently playing track into history once (when it starts).
 *   - Fires onTrigger() when the configured trigger condition is satisfied.
 *
 * Trigger modes:
 *   'queue_empty' - fire when the player stops because the queue emptied.
 *   'keep_ahead'  - fire whenever remaining tracks after current < keep_ahead_count.
 *   'manual'      - never auto-fire. Manual only.
 */
class QueueMonitor {
  constructor({ commandRouter, logger, verbose, onTrackPlayed, onTrackSkipped, onTrigger, pollMs = 4000, cooldownMs = 10000, triggerTimeoutMs = 30000, skipThresholdSec = 30 }) {
    this.commandRouter = commandRouter;
    this.logger = logger || console;
    this.verbose = !!verbose;
    this.onTrackPlayed = onTrackPlayed || (() => {});
    this.onTrackSkipped = onTrackSkipped || (() => {});
    this.onTrigger = onTrigger || (() => {});
    this.pollMs = pollMs;
    this.cooldownMs = cooldownMs;
    this.triggerTimeoutMs = triggerTimeoutMs;
    this.skipThresholdSec = skipThresholdSec;

    this.config = { trigger_mode: 'keep_ahead', keep_ahead_count: 3, enabled: true };
    this._lastTrack = null; // { uri, title, artist, album, service, startedAt, lastSeekMs, duration }
    this._triggerInFlight = false;
    this._triggerStartedAt = 0;
    this._lastTriggerAt = 0;
    this._lastLoggedSummary = '';
    this._timer = null;
  }

  setConfig(cfg) {
    Object.assign(this.config, cfg || {});
  }

  setVerbose(v) {
    this.verbose = !!v;
  }

  setCooldown(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return;
    this.cooldownMs = n;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this.pollMs);
    setTimeout(() => this._tick(), 500);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _tick() {
    if (!this.config.enabled) {
      this._vlogChange('tick: DISABLED');
      return;
    }

    let state;
    try {
      state = this.commandRouter.volumioGetState();
    } catch (e) {
      this.logger.error && this.logger.error('[ai_autopilot] volumioGetState failed: ' + e.message);
      return;
    }

    let queue = [];
    try {
      queue = this.commandRouter.volumioGetQueue() || [];
    } catch (e) {
      try {
        queue = this.commandRouter.stateMachine.getQueue();
      } catch (e2) {
        queue = [];
      }
    }

    this._recordIfNewTrack(state);

    const mode = this.config.trigger_mode;
    const pos = state && typeof state.position === 'number' ? state.position : -1;
    const remaining = Math.max(0, queue.length - (pos + 1));
    const status = state && state.status;
    const cooldownLeft = Math.max(0, this.cooldownMs - (Date.now() - this._lastTriggerAt));

    // Safety: if a trigger has been "in-flight" longer than triggerTimeoutMs,
    // assume something is stuck and forcibly reset so the plugin doesn't deadlock.
    if (this._triggerInFlight && (Date.now() - this._triggerStartedAt) > this.triggerTimeoutMs) {
      this.logger.error && this.logger.error(
        '[ai_autopilot] trigger in-flight timed out after ' +
        Math.floor((Date.now() - this._triggerStartedAt) / 1000) + 's; force-resetting.');
      this._triggerInFlight = false;
    }

    let fire = false;
    let reason = '';
    if (this._triggerInFlight) {
      reason = 'trigger in-flight';
    } else if (cooldownLeft > 0) {
      reason = 'cooldown ' + Math.ceil(cooldownLeft / 1000) + 's';
    } else if (mode === 'manual') {
      reason = 'manual mode';
    } else if (mode === 'queue_empty') {
      if (queue.length === 0 || (status === 'stop' && pos >= queue.length - 1)) {
        fire = true; reason = 'queue empty';
      } else {
        reason = 'queue has ' + (queue.length - pos - 1) + ' ahead';
      }
    } else if (mode === 'keep_ahead') {
      const target = Math.max(1, Number(this.config.keep_ahead_count) || 3);
      if (status === 'play' || status === 'pause') {
        if (remaining < target) { fire = true; reason = 'remaining ' + remaining + ' < target ' + target; }
        else { reason = 'remaining ' + remaining + ' >= target ' + target; }
      } else if (queue.length === 0) {
        fire = true; reason = 'queue empty while stopped';
      } else {
        reason = 'status=' + status + ' (idle)';
      }
    }

    const summary =
      'state=' + status +
      ' pos=' + pos +
      ' qLen=' + queue.length +
      ' remain=' + remaining +
      ' mode=' + mode +
      ' cd=' + Math.ceil(cooldownLeft / 1000) + 's' +
      ' inflight=' + this._triggerInFlight +
      ' fire=' + fire +
      ' why="' + reason + '"';
    this._vlogChange('tick: ' + summary);

    if (fire) {
      this._triggerInFlight = true;
      this._triggerStartedAt = Date.now();
      this._lastTriggerAt = Date.now();
      this.logger.info('[ai_autopilot] TRIGGER FIRE (' + reason + ')');

      // Guarantee we reset inflight even if the returned promise never settles.
      let finished = false;
      const markDone = (label) => {
        if (finished) return;
        finished = true;
        this._triggerInFlight = false;
        this.logger.info('[ai_autopilot] TRIGGER DONE (' + label + ')');
      };

      Promise.resolve()
        .then(() => this.onTrigger())
        .then(() => markDone('ok'))
        .catch((e) => {
          this.logger.error && this.logger.error('[ai_autopilot] trigger error: ' + (e && e.message ? e.message : e));
          markDone('error');
        });

      // Hard safety net: reset after triggerTimeoutMs no matter what.
      setTimeout(() => markDone('timeout'), this.triggerTimeoutMs);
    }
  }

  _vlogChange(msg) {
    if (!this.verbose) return;
    // only log when the summary actually changes, to avoid flooding
    if (msg === this._lastLoggedSummary) return;
    this._lastLoggedSummary = msg;
    this.logger.info('[ai_autopilot] ' + msg);
  }

  _recordIfNewTrack(state) {
    if (!state) return;

    // update seek snapshot for currently-tracked track
    if (this._lastTrack && state.uri === this._lastTrack.uri && typeof state.seek === 'number') {
      this._lastTrack.lastSeekMs = state.seek;
      if (typeof state.duration === 'number' && state.duration > 0) {
        this._lastTrack.duration = state.duration;
      }
    }

    if (!state.uri || state.status !== 'play') return;
    if (this._lastTrack && state.uri === this._lastTrack.uri) return;

    // URI changed → previous track is "done". Decide skip vs. played.
    if (this._lastTrack) {
      this._maybeEmitSkip(this._lastTrack);
    }

    this._lastTrack = {
      uri: state.uri,
      title: state.title,
      artist: state.artist,
      album: state.album,
      service: state.service,
      startedAt: Date.now(),
      lastSeekMs: typeof state.seek === 'number' ? state.seek : 0,
      duration: typeof state.duration === 'number' ? state.duration : 0
    };
    this.onTrackPlayed({
      title: state.title,
      artist: state.artist,
      album: state.album,
      service: state.service,
      uri: state.uri
    });
  }

  _maybeEmitSkip(prev) {
    if (!prev) return;
    const playedSec = Math.floor(((prev.lastSeekMs || 0)) / 1000);
    const durSec = Math.floor(prev.duration || 0);
    const threshold = Math.max(5, Math.min(this.skipThresholdSec, durSec > 0 ? Math.floor(durSec * 0.3) : this.skipThresholdSec));
    // Only count as skip if we know a duration and it was cut short.
    // If duration unknown, require < skipThresholdSec.
    let skipped = false;
    if (durSec > 0 && playedSec + 2 < durSec && playedSec < threshold) skipped = true;
    if (durSec === 0 && playedSec < this.skipThresholdSec) skipped = true;

    this.logger && this.logger.info && this.logger.info(
      '[ai_autopilot] track ended: "' + (prev.artist || '?') + ' — ' + (prev.title || '?') + '"' +
      ' played=' + playedSec + 's of ' + (durSec || '?') + 's threshold=' + threshold + 's skipped=' + skipped);

    if (skipped) {
      try {
        this.onTrackSkipped({
          uri: prev.uri,
          title: prev.title,
          artist: prev.artist,
          album: prev.album,
          service: prev.service,
          playedSec,
          durationSec: durSec
        });
      } catch (e) {
        this.logger && this.logger.error && this.logger.error('[ai_autopilot] onTrackSkipped error: ' + e.message);
      }
    }
  }
}

module.exports = QueueMonitor;
