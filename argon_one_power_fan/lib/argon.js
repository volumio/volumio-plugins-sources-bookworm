"use strict";

/**
 * The Argon case MCU protocol at I2C address 0x1a, following Argon's current
 * scripts (argonregister.py) and the Argon ONE i2c code legend:
 * https://github.com/Argon40Tech/Argon-ONE-i2c-Codes
 *
 * Two firmware generations:
 *   register: fan duty in register 0x80 (firmware 0x81, control 0x86)
 *   legacy:   fan speed as a single byte written to 0x1a
 *
 * Legacy single-byte codes used: 0x00 fan off, 0x01-0x64 (1-100) fan duty,
 * 0xFF arm the case for UART power-off (needs the UART).
 * The legend's 0xFD/0xFE power modes are not used (see the note below).
 */

const LOG_PREFIX = require("./constants").LOG_PREFIX;

const REG_DUTY = 0x80;
const REG_CTRL = 0x86;
const SETTLE_MS = 1000; // Argon's helpers sleep 1 s after each write
const PROBE_TRIES = 3;
const PROBE_RETRY_MS = 500;

function ArgonMcu(i2c, logger) {
  this.i2c = i2c;
  this.logger = logger || null;
  this.retryMs = PROBE_RETRY_MS; // pause between probe attempts (a test sets 0)
  this._cancelled = false;
  this._probeState = null; // the running probe's state, for cancelDetect()
  this.firmware = "unknown"; // 'register' | 'legacy' | 'unknown'
}

ArgonMcu.prototype._log = function (msg) {
  if (this.logger) this.logger.info(LOG_PREFIX + msg);
};

ArgonMcu.prototype._warn = function (msg) {
  if (this.logger) this.logger.warn(LOG_PREFIX + msg);
};

// Stops a running detect() before its next probe step (a step already queued or running
// still completes: the I2C queue cannot take one back). Used at shutdown, so that no
// probe step follows the arm command. If a probe write may have changed the duty
// register, the restore is queued here and now, behind whatever step is in flight: the
// I2C queue is first in, first out, so anything queued after this call (the arm command)
// runs after the restore, however long the steps in flight take.
ArgonMcu.prototype.cancelDetect = function () {
  this._cancelled = true;
  const state = this._probeState;
  if (state && state.touched) this._restoreOnce(state);
};

// Best-effort: put the duty register back to the value found before the probe wrote to
// it. Never throws; a failure only leaves the duty one step off until the next fan write.
ArgonMcu.prototype._restoreDuty = async function (original) {
  try {
    await this.i2c.writeReg(REG_DUTY, original, SETTLE_MS);
  } catch (e) {
    this._warn(
      `firmware probe: could not restore the fan duty register: ${e.message}`,
    );
  }
};

// The restore is queued at most once per probe, whichever path asks first (a cancel, the
// register result, or the all-attempts-failed exit); the others get the same promise.
ArgonMcu.prototype._restoreOnce = function (state) {
  if (!state.restoring) state.restoring = this._restoreDuty(state.original);
  return state.restoring;
};

ArgonMcu.prototype._checkCancel = function () {
  if (!this._cancelled) return;
  const e = new Error("firmware probe cancelled");
  e.cancelled = true;
  throw e;
};

// One run of Argon's checksupport(): write duty+1 to register 0x80 and read it back;
// if the value stuck, the firmware has registers. Resolves { firmware, why } once
// the readback has answered; throws if the bus errors before that. state.original is
// the duty from the first successful read of the whole probe: a failed attempt may
// already have changed the register, so a retry must not take its own read as the
// value to put back.
ArgonMcu.prototype._probeOnce = async function (state) {
  const i2c = this.i2c;
  this._checkCancel();
  const oldVal = await i2c.readReg(REG_DUTY);
  if (state.original === undefined) state.original = oldVal;
  let newVal = oldVal + 1;
  if (newVal >= 100) newVal = 98;
  this._checkCancel();
  state.touched = true; // set before the write: one reported as failed may still have taken effect
  await i2c.writeReg(REG_DUTY, newVal, SETTLE_MS);
  this._checkCancel();
  const back = await i2c.readReg(REG_DUTY);
  if (back === oldVal)
    return { firmware: "legacy", why: "value did not change" };
  // The value stuck, so this is register firmware whatever happens next (also when the
  // probe was cancelled meanwhile: the restore is its last step either way).
  await this._restoreOnce(state);
  return { firmware: "register", why: "value changed" };
};

// Argon's helpers treat any error as "legacy", and a legacy unit may well answer the
// register read with an error, so errors still end up as legacy, but only after
// PROBE_TRIES attempts: a one-off bus glitch must not decide the protocol for the session.
ArgonMcu.prototype.detect = async function () {
  const state = {};
  this._cancelled = false;
  this._probeState = state; // lets cancelDetect() see whether a probe write was issued
  try {
    return await this._detect(state);
  } finally {
    if (this._probeState === state) this._probeState = null;
  }
};

ArgonMcu.prototype._detect = async function (state) {
  let result = "legacy";
  let why = "";
  let lastErr = null;
  let cancelled = false;
  for (let n = 1; n <= PROBE_TRIES; n++) {
    try {
      const r = await this._probeOnce(state);
      result = r.firmware;
      why = r.why;
      lastErr = null;
      break;
    } catch (e) {
      if (e.cancelled) {
        cancelled = true;
        break;
      }
      lastErr = e;
      if (n < PROBE_TRIES) {
        this._warn(
          `firmware probe attempt ${n} failed (${e.message}), trying again`,
        );
        await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      }
    }
  }
  if (cancelled) {
    // No answer: the firmware stays 'unknown'. A probe write may already have taken
    // effect, so the duty goes back (already queued by cancelDetect if it was needed
    // then); nothing else is queued.
    if (state.touched) await this._restoreOnce(state);
    this._log("firmware probe cancelled");
    return this.firmware;
  }
  if (lastErr) {
    why = `i2c error on all ${PROBE_TRIES} attempts: ${lastErr.message}`;
    // A probe write may have taken effect before the readbacks failed: one
    // best-effort try to put the duty back (the bus may well be down, then it fails too).
    if (state.touched) await this._restoreOnce(state);
  }
  this.firmware = result;
  this._log(`firmware probe: ${result} (${why})`);
  return result;
};

ArgonMcu.prototype.setFanSpeed = function (speed) {
  const s = Math.max(0, Math.min(100, Math.round(speed)));
  if (this.firmware === "register")
    return this.i2c.writeReg(REG_DUTY, s, SETTLE_MS);
  return this.i2c.sendByte(s, SETTLE_MS);
};

// Arms the case for power-off: the MCU then cuts power when the Pi's UART line drops
// (the drop itself happens in every shutdown; only an armed MCU acts on it).
// Register firmware: 1 to register 0x86. Legacy (and unprobed): 0xFF.
ArgonMcu.prototype.armPowerOff = function () {
  if (this.firmware === "register") return this.i2c.writeReg(REG_CTRL, 1);
  return this.i2c.sendByte(0xff);
};

// NOT IMPLEMENTED: writing the power modes 0xFE (always on) and 0xFD (default).
// They are listed in Argon's i2c code legend, but Argon's scripts never write
// them and they do not work on a real V2 case, so the plugin has no code for them.

module.exports = ArgonMcu;
