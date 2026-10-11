"use strict";

/**
 * Power button on GPIO4. The case MCU sends one active-high pulse per command;
 * the pulse width selects the command (confirmed on a V2: about 20 ms for a
 * double tap, about 40 ms for a hold, sent on release). Timing is fixed here.
 *
 * Edge callbacks only take a timestamp; everything else happens afterwards in
 * setImmediate, so the event loop work cannot stretch the measured width.
 */

const LOG_PREFIX = require("./constants").LOG_PREFIX;

const PIN = 4;

// Width classes in ms. Boundaries sit about 10 ms from the specified clusters.
//   < 10        noise
//   10 .. <27   reboot (double tap)
//   27 .. <33   ambiguous: logged, never acted on
//   33 .. 50    shutdown (hold)
//   > 50        other (includes Argon's 60-70 ms OLED-toggle pulse): ignored
function classify(widthMs) {
  if (widthMs < 10) return "noise";
  if (widthMs < 27) return "reboot";
  if (widthMs < 33) return "ambiguous";
  if (widthMs <= 50) return "shutdown";
  return "other";
}

// o: { gpiox, logger, onPress(cls, widthMs), now() }
function PowerButton(o) {
  this.gpiox = o.gpiox;
  this.logger = o.logger || null;
  this.onPress = o.onPress || function () {};
  this.now =
    o.now ||
    function () {
      return process.hrtime.bigint();
    };
  this.listening = false;
  this.error = null;
  this.riseAt = null;
  this.last = null; // { cls, widthMs, at }
  const self = this;
  this._cb = function (state, edge) {
    self._onEdge(state, edge);
  };
}

PowerButton.prototype._log = function (level, msg) {
  if (this.logger && this.logger[level]) this.logger[level](LOG_PREFIX + msg);
};

PowerButton.prototype.start = function () {
  if (this.listening) return true;
  const g = this.gpiox;
  try {
    // Pull-down input, debounce 0 (any debounce swallows 20 ms pulses), both edges.
    const r = g.watch_gpio(
      PIN,
      g.GPIO_MODE_INPUT_PULLDOWN,
      0,
      g.GPIO_EDGE_BOTH,
      this._cb,
    );
    if (r === undefined || r === false) {
      let why = "watch_gpio failed";
      try {
        if (g.error_text) why += `: ${g.error_text()}`;
      } catch {
        /* ignore */
      }
      this.error = why;
      this._log("error", `${why} (is GPIO${PIN} in use by another plugin?)`);
      return false;
    }
  } catch (e) {
    this.error = e.message;
    this._log("error", `watch_gpio threw: ${e.message}`);
    return false;
  }
  this.listening = true;
  this.error = null;
  this.riseAt = null;
  this._log("info", `power button: listening on GPIO${PIN}`);
  return true;
};

PowerButton.prototype.stop = function () {
  if (!this.listening) return;
  this.listening = false;
  this.riseAt = null;
  try {
    this.gpiox.deinit_gpio(PIN);
  } catch (e) {
    this._log("warn", `deinit_gpio failed: ${e.message}`);
  }
  this._log("info", "power button: stopped");
};

PowerButton.prototype._onEdge = function (state, edge) {
  const t = this.now(); // timestamp first, nothing else on the hot path
  if (!this.listening) return;
  const g = this.gpiox;
  let rising;
  if (edge === g.GPIO_EDGE_RISING) rising = true;
  else if (edge === g.GPIO_EDGE_FALLING) rising = false;
  else rising = Number(state) === 1;

  if (rising) {
    this.riseAt = t;
    return;
  }
  if (this.riseAt === null) return; // falling edge without a rising edge
  const widthMs = Number(t - this.riseAt) / 1e6;
  this.riseAt = null;
  const self = this;
  setImmediate(function () {
    self._handle(widthMs);
  });
};

PowerButton.prototype._handle = function (widthMs) {
  const cls = classify(widthMs);
  this.last = { cls: cls, widthMs: widthMs, at: Date.now() };
  this._log("info", `button pulse ${widthMs.toFixed(1)} ms -> ${cls}`);
  try {
    this.onPress(cls, widthMs);
  } catch (e) {
    this._log("error", `press handler failed: ${e.message}`);
  }
};

module.exports = PowerButton;
module.exports.classify = classify;
module.exports.PIN = PIN;
