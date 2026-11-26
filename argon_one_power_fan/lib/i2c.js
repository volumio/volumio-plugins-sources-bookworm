"use strict";

/**
 * Minimal I2C access for the Argon case MCU, using the i2c-tools binaries that
 * ship in the Volumio image (no npm module, no compile, no sudo: the volumio
 * user is in group i2c). Arguments are passed as an array to execFile, never
 * through a shell. All calls run through one queue so the fan loop and the
 * power-off signal can never overlap.
 */

const fs = require("fs");
const execFile = require("child_process").execFile;

const DEFAULT_SET = "/usr/sbin/i2cset";
const DEFAULT_GET = "/usr/sbin/i2cget";

function hex(n) {
  return `0x${("0" + (n & 0xff).toString(16)).slice(-2)}`;
}

function I2c(opts) {
  opts = opts || {};
  this.bus = opts.bus || 1;
  this.addr = opts.addr || 0x1a;
  this.logger = opts.logger || null;
  this.setPath = opts.setPath || DEFAULT_SET;
  this.getPath = opts.getPath || DEFAULT_GET;
  this.exec = opts.exec || execFile; // injectable for tests
  this.timeoutMs = opts.timeoutMs || 3000;
  this.chain = Promise.resolve();
  this._settleTimer = null;
  this._settleResolve = null;
}

I2c.prototype.toolsPresent = function () {
  return fs.existsSync(this.setPath) && fs.existsSync(this.getPath);
};

I2c.prototype.deviceAccessible = function () {
  try {
    fs.accessSync(
      `/dev/i2c-${this.bus}`,
      fs.constants.R_OK | fs.constants.W_OK,
    );
    return true;
  } catch {
    return false;
  }
};

I2c.prototype._run = function (file, args) {
  const self = this;
  return new Promise(function (resolve, reject) {
    self.exec(
      file,
      args,
      { timeout: self.timeoutMs },
      function (err, stdout, stderr) {
        if (err) {
          const detail = stderr ? ` | ${String(stderr).trim()}` : "";
          err.message = `${err.message || "i2c error"}${detail}`;
          return reject(err);
        }
        resolve(String(stdout || "").trim());
      },
    );
  });
};

I2c.prototype._enqueue = function (task) {
  const p = this.chain.then(task);
  this.chain = p.then(
    function () {},
    function () {},
  );
  return p;
};

I2c.prototype._settle = function (ms) {
  const self = this;
  return new Promise(function (resolve) {
    self._settleResolve = resolve;
    self._settleTimer = setTimeout(function () {
      self._settleTimer = null;
      self._settleResolve = null;
      resolve();
    }, ms);
  });
};

// Ends a running settle delay early (used when the system is shutting down).
I2c.prototype.abortSettle = function () {
  if (this._settleTimer) {
    clearTimeout(this._settleTimer);
    this._settleTimer = null;
  }
  if (this._settleResolve) {
    const r = this._settleResolve;
    this._settleResolve = null;
    r();
  }
};

// Single byte to the device, no register: `i2cset -y 1 0x1a 0xNN`
// (what Argon's legacy write_byte does).
I2c.prototype.sendByte = function (value, settleMs) {
  const self = this;
  return this._enqueue(function () {
    return self
      ._run(self.setPath, ["-y", String(self.bus), hex(self.addr), hex(value)])
      .then(function () {
        return settleMs ? self._settle(settleMs) : undefined;
      });
  });
};

// Register write: `i2cset -y 1 0x1a REG VALUE`
I2c.prototype.writeReg = function (reg, value, settleMs) {
  const self = this;
  return this._enqueue(function () {
    return self
      ._run(self.setPath, [
        "-y",
        String(self.bus),
        hex(self.addr),
        hex(reg),
        hex(value),
      ])
      .then(function () {
        return settleMs ? self._settle(settleMs) : undefined;
      });
  });
};

// Register read: `i2cget -y 1 0x1a REG`, resolves to an integer.
I2c.prototype.readReg = function (reg) {
  const self = this;
  return this._enqueue(function () {
    return self
      ._run(self.getPath, ["-y", String(self.bus), hex(self.addr), hex(reg)])
      .then(function (out) {
        const v = parseInt(out, 16);
        if (isNaN(v)) throw new Error(`unexpected i2cget output: ${out}`);
        return v;
      });
  });
};

module.exports = I2c;
module.exports.hex = hex;
