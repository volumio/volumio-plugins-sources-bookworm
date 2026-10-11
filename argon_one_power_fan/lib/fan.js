"use strict";

/**
 * Fan control that mimics Argon's current argononed.py (temp_check):
 *   - read the CPU temperature every 30 s
 *   - speed = speed of the first threshold (highest first) at or below the temp
 *   - speeds 1-24 are raised to 25
 *   - when the speed would go DOWN, wait 30 s before writing (anti-hunting)
 *   - before writing a non-zero speed, write 100% first (spin-up for older units)
 *   - after an I2C error wait 60 s
 *
 * Deliberate differences from the stock script:
 *   - an unreadable temperature keeps the previous speed (stock: treats it as 0)
 *   - a failed write is retried on the next cycle (stock: remembers it as done)
 *   - after the 30 s hold before lowering, the temperature is read again and the
 *     speed recalculated; a speed that is no longer lower is not written (stock
 *     writes the speed calculated before the wait)
 */

const LOG_PREFIX = require("./constants").LOG_PREFIX;

const INITIAL = 200; // forces the first write, and after settings change
const MIN_SPEED = 25;

// curve: [{temp, speed}, ...] in any order. Returns 0-100.
function speedFor(temp, curve) {
  const pairs = curve.slice().sort(function (a, b) {
    return b.temp - a.temp;
  });
  for (let i = 0; i < pairs.length; i++) {
    if (temp >= pairs[i].temp) {
      const s = pairs[i].speed;
      if (s < 1) return 0;
      if (s < MIN_SPEED) return MIN_SPEED;
      return s;
    }
  }
  return 0;
}

// o: { mcu, readTemp(), getCurve(), logger, cycleMs, errorMs }
function FanController(o) {
  this.mcu = o.mcu;
  this.readTemp = o.readTemp;
  this.getCurve = o.getCurve;
  this.logger = o.logger || null;
  this.cycleMs = o.cycleMs || 30000;
  this.errorMs = o.errorMs || 60000;

  this.running = false;
  this.token = 0;
  this.resetPrev = false;
  this._wake = null;
  this._tempWarned = false;

  this.lastTemp = null;
  this.lastTempAt = 0;
  this.lastSpeed = null;
  this.lastSpeedAt = 0;
  this.lastError = null;
}

FanController.prototype._log = function (level, msg) {
  if (this.logger && this.logger[level]) this.logger[level](LOG_PREFIX + msg);
};

FanController.prototype._sleep = function (ms) {
  const self = this;
  return new Promise(function (resolve) {
    const t = setTimeout(function () {
      self._wake = null;
      resolve(false);
    }, ms);
    self._wake = function () {
      clearTimeout(t);
      self._wake = null;
      resolve(true);
    };
  });
};

FanController.prototype.start = function () {
  if (this.running) return;
  this.running = true;
  this.token++;
  this.resetPrev = true;
  const token = this.token;
  const self = this;
  this._loop(token).catch(function (e) {
    self._log("error", `fan loop crashed: ${e && e.message}`);
    if (self.token === token) self.running = false;
  });
};

// Ends the loop. opts.final: write the speed for the current temperature once
// (no hold-down) so the fan is not left at an arbitrary value. opts.off: fan
// control was turned off in the settings, so switch the fan off once. A failed
// write is only logged; the caller keeps the new setting either way.
FanController.prototype.stop = async function (opts) {
  const wasRunning = this.running;
  this.running = false;
  this.token++;
  if (this._wake) this._wake();
  if (this.mcu.i2c && this.mcu.i2c.abortSettle) this.mcu.i2c.abortSettle();
  if (wasRunning && opts && opts.off) {
    try {
      await this.mcu.setFanSpeed(0);
      this.lastSpeed = 0;
      this.lastSpeedAt = Date.now();
    } catch (e) {
      this._log("warn", `fan off write failed: ${e.message}`);
    }
  } else if (wasRunning && opts && opts.final) {
    try {
      const t = this.readTemp();
      if (t !== null) {
        const speed = speedFor(t, this.getCurve());
        await this.mcu.setFanSpeed(speed);
        this.lastSpeed = speed;
        this.lastSpeedAt = Date.now();
      }
    } catch (e) {
      this._log("warn", `final fan write failed: ${e.message}`);
    }
  }
};

// Settings changed: re-evaluate and write at once (stock sets prev = INITIAL).
FanController.prototype.reapply = function () {
  this.resetPrev = true;
  if (this._wake) this._wake();
};

FanController.prototype._loop = async function (token) {
  let prev = INITIAL;
  while (this.token === token) {
    if (this.resetPrev) {
      prev = INITIAL;
      this.resetPrev = false;
    }

    let temp = this.readTemp();
    if (temp === null) {
      if (!this._tempWarned) {
        this._log(
          "warn",
          "CPU temperature unreadable; keeping the previous fan speed",
        );
        this._tempWarned = true;
      }
      await this._sleep(this.cycleMs);
      continue;
    }
    this._tempWarned = false;
    this.lastTemp = temp;
    this.lastTempAt = Date.now();

    let speed = speedFor(temp, this.getCurve());

    if (speed === prev) {
      await this._sleep(this.cycleMs);
      continue;
    }
    if (speed < prev && prev !== INITIAL) {
      // Pause before speed reduction to prevent fluctuations.
      const woke = await this._sleep(this.cycleMs);
      if (this.token !== token) break;
      if (woke) continue; // settings changed: evaluate again

      // The pause is only worth anything if the lower speed still holds after it.
      const again = this.readTemp();
      if (again === null) continue;
      temp = again;
      this.lastTemp = temp;
      this.lastTempAt = Date.now();
      speed = speedFor(temp, this.getCurve());
      if (speed >= prev) continue; // it heated up again: the next pass handles it
    }

    prev = speed;
    try {
      if (speed > 0) await this.mcu.setFanSpeed(100); // spin-up
      if (this.token !== token) break;
      await this.mcu.setFanSpeed(speed);
      this.lastSpeed = speed;
      this.lastSpeedAt = Date.now();
      this.lastError = null;
      this._log("info", `fan ${speed}% at ${temp.toFixed(1)} C`);
      await this._sleep(this.cycleMs);
    } catch (e) {
      this.lastError = e.message;
      prev = INITIAL; // retry next cycle
      this._log("warn", `fan write failed: ${e.message}`);
      await this._sleep(this.errorMs);
    }
  }
};

FanController.prototype.getStatus = function () {
  return {
    running: this.running,
    temp: this.lastTemp,
    tempAt: this.lastTempAt,
    speed: this.lastSpeed,
    speedAt: this.lastSpeedAt,
    error: this.lastError,
  };
};

module.exports = FanController;
module.exports.speedFor = speedFor;
module.exports.MIN_SPEED = MIN_SPEED;
