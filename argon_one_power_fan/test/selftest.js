"use strict";

/**
 * Development self-test for Argon ONE Power & Fan. Runs on any Node >= 18 and
 * touches no hardware: the GPIO library, I2C tools and Volumio itself are
 * replaced by stand-ins. Run:  node test/selftest.js
 */

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Module = require("module");

var ROOT = path.join(__dirname, "..");
var passed = 0;
var failed = 0;
var pending = [];

function test(name, fn) {
  pending.push({ name: name, fn: fn });
}
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "argonpf-"));
}

// ---------------------------------------------------------------------------
// Stand-ins for modules that only exist on the Volumio device
// ---------------------------------------------------------------------------

var kewStub = {
  defer: function () {
    var resolve, reject;
    var p = new Promise(function (a, b) {
      resolve = a;
      reject = b;
    });
    var d = { resolve: resolve, reject: reject, promise: null };
    d.promise = {
      then: function (a, b) {
        return p.then(a, b);
      },
      fail: function (b) {
        return p.catch(b);
      },
    };
    return d;
  },
  resolve: function (v) {
    var p = Promise.resolve(v);
    return {
      then: function (a, b) {
        return p.then(a, b);
      },
      fail: function (b) {
        return p.catch(b);
      },
    };
  },
};

function VConfStub() {
  this.data = {};
  this.file = null;
}
VConfStub.prototype.loadFile = function (file) {
  this.file = file;
  this.data = {};
  var raw = JSON.parse(fs.readFileSync(file, "utf8"));
  for (var k in raw)
    this.data[k] = raw[k] && raw[k].value !== undefined ? raw[k].value : raw[k];
};
VConfStub.prototype.get = function (k) {
  return this.data[k];
};
VConfStub.prototype.set = function (k, v) {
  this.data[k] = v;
};
VConfStub.prototype.save = function () {
  var out = {};
  for (var k in this.data)
    out[k] = { type: typeof this.data[k], value: this.data[k] };
  fs.writeFileSync(this.file, JSON.stringify(out, null, 2));
};

var gpioxStub = {
  GPIO_MODE_INPUT_PULLDOWN: 3,
  GPIO_EDGE_RISING: 0,
  GPIO_EDGE_FALLING: 1,
  GPIO_EDGE_BOTH: 2,
  watchCalls: [],
  deinitCalls: [],
  cb: null,
  watch_gpio: function (pin, mode, debounce, edge, cb) {
    gpioxStub.watchCalls.push({
      pin: pin,
      mode: mode,
      debounce: debounce,
      edge: edge,
    });
    gpioxStub.cb = cb;
    return 0;
  },
  deinit_gpio: function (pin) {
    gpioxStub.deinitCalls.push(pin);
    return true;
  },
};

var origLoad = Module._load;
Module._load = function (request) {
  if (request === "kew" || request === "/volumio/node_modules/kew")
    return kewStub;
  if (request === "v-conf" || request === "/volumio/node_modules/v-conf")
    return VConfStub;
  if (request === "@iiot2k/gpiox") return gpioxStub;
  return origLoad.apply(this, arguments);
};

var Platform = require(path.join(ROOT, "lib/platform"));
var I2c = require(path.join(ROOT, "lib/i2c"));
var ArgonMcu = require(path.join(ROOT, "lib/argon"));
var FanController = require(path.join(ROOT, "lib/fan"));
var PowerButton = require(path.join(ROOT, "lib/button"));
var UartConfig = require(path.join(ROOT, "lib/uartconfig"));

// ---------------------------------------------------------------------------
// Fan
// ---------------------------------------------------------------------------

test("fan: speedFor matches the stock algorithm", function () {
  var curve = [
    { temp: 55, speed: 30 },
    { temp: 60, speed: 55 },
    { temp: 65, speed: 100 },
  ];
  var sf = FanController.speedFor;
  assert.strictEqual(sf(40, curve), 0);
  assert.strictEqual(sf(54.9, curve), 0);
  assert.strictEqual(sf(55, curve), 30);
  assert.strictEqual(sf(59.9, curve), 30);
  assert.strictEqual(sf(60, curve), 55);
  assert.strictEqual(sf(65, curve), 100);
  assert.strictEqual(sf(90, curve), 100);
  // unordered input
  assert.strictEqual(sf(62, [curve[2], curve[0], curve[1]]), 55);
  // 1-24 raised to 25, 0 stays 0
  assert.strictEqual(sf(70, [{ temp: 50, speed: 10 }]), 25);
  assert.strictEqual(sf(70, [{ temp: 50, speed: 24 }]), 25);
  assert.strictEqual(sf(70, [{ temp: 50, speed: 25 }]), 25);
  assert.strictEqual(sf(70, [{ temp: 50, speed: 0 }]), 0);
});

test("fan: loop writes spin-up first, holds before lowering, retries failures", async function () {
  var writes = [];
  var temps = [70, 70, 40, 40, 40];
  var failOnce = false;
  var mcu = {
    i2c: { abortSettle: function () {} },
    setFanSpeed: async function (s) {
      if (failOnce) {
        failOnce = false;
        throw new Error("boom");
      }
      writes.push(s);
    },
  };
  var idx = 0;
  var fan = new FanController({
    mcu: mcu,
    readTemp: function () {
      var t = temps[Math.min(idx, temps.length - 1)];
      idx++;
      return t;
    },
    getCurve: function () {
      return [
        { temp: 55, speed: 30 },
        { temp: 60, speed: 55 },
        { temp: 65, speed: 100 },
      ];
    },
    cycleMs: 30,
    errorMs: 30,
  });
  fan.start();
  await sleep(40);
  assert.deepStrictEqual(
    writes.slice(0, 2),
    [100, 100],
    "spin-up then target at 70 C",
  );
  await sleep(200);
  assert.strictEqual(
    writes[writes.length - 1],
    0,
    "drops to 0 after hold-down",
  );
  assert.ok(writes.indexOf(0) > 1, "lowering did not happen immediately");
  await fan.stop({ final: false });

  // failed write is retried
  writes = [];
  idx = 0;
  temps = [70];
  failOnce = true;
  var fan2 = new FanController({
    mcu: mcu,
    readTemp: function () {
      return 70;
    },
    getCurve: function () {
      return [
        { temp: 55, speed: 30 },
        { temp: 60, speed: 55 },
        { temp: 65, speed: 100 },
      ];
    },
    cycleMs: 30,
    errorMs: 30,
  });
  fan2.start();
  await sleep(150);
  assert.ok(writes.length >= 2, "write retried after the failure");
  assert.ok(fan2.getStatus().speed === 100);
  await fan2.stop({ final: false });
});

test("fan: the temperature is read again after the hold before lowering", async function () {
  var curve = [
    { temp: 55, speed: 30 },
    { temp: 60, speed: 55 },
    { temp: 65, speed: 100 },
  ];
  async function run(seq) {
    var writes = [];
    var i = 0;
    var fan = new FanController({
      mcu: {
        i2c: { abortSettle: function () {} },
        setFanSpeed: async function (s) {
          writes.push(s);
        },
      },
      readTemp: function () {
        var v = seq[Math.min(i, seq.length - 1)];
        i++;
        return v;
      },
      getCurve: function () {
        return curve;
      },
      cycleMs: 30,
    });
    fan.start();
    await sleep(250);
    await fan.stop({ final: false });
    return { writes: writes, status: fan.getStatus() };
  }

  // 70 C, a dip to 40 C, but 70 C again after the hold: the lower speed is never written
  var heated = await run([70, 40, 70]);
  assert.deepStrictEqual(
    heated.writes,
    [100, 100],
    "no write for the dip that did not last",
  );
  assert.strictEqual(heated.status.speed, 100);
  assert.strictEqual(heated.status.temp, 70);

  // the temperature after the hold decides the speed, not the one before it
  var partly = await run([70, 40, 62]);
  assert.deepStrictEqual(
    partly.writes,
    [100, 100, 100, 55],
    "55% for the 62 C after the hold, not 0%",
  );
  assert.strictEqual(partly.status.temp, 62);

  // a dip that lasts is still written after the hold
  var lasting = await run([70, 40, 40]);
  assert.deepStrictEqual(lasting.writes, [100, 100, 0]);
  assert.strictEqual(lasting.status.temp, 40);

  // an unreadable temperature after the hold writes nothing
  var unreadable = await run([70, 40, null]);
  assert.deepStrictEqual(unreadable.writes, [100, 100]);
});

test("fan: unreadable temperature keeps the previous speed", async function () {
  var writes = [];
  var seq = [70, null, null, null];
  var i = 0;
  var fan = new FanController({
    mcu: {
      i2c: { abortSettle: function () {} },
      setFanSpeed: async function (s) {
        writes.push(s);
      },
    },
    readTemp: function () {
      var v = seq[Math.min(i, seq.length - 1)];
      i++;
      return v;
    },
    getCurve: function () {
      return [
        { temp: 55, speed: 30 },
        { temp: 60, speed: 55 },
        { temp: 65, speed: 100 },
      ];
    },
    cycleMs: 20,
  });
  fan.start();
  await sleep(150);
  await fan.stop({ final: false });
  assert.deepStrictEqual(
    writes,
    [100, 100],
    "only the initial write, nothing for failed reads",
  );
});

test("fan: reapply writes again at once", async function () {
  var writes = [];
  var fan = new FanController({
    mcu: {
      i2c: { abortSettle: function () {} },
      setFanSpeed: async function (s) {
        writes.push(s);
      },
    },
    readTemp: function () {
      return 62;
    },
    getCurve: function () {
      return [
        { temp: 55, speed: 30 },
        { temp: 60, speed: 55 },
        { temp: 65, speed: 100 },
      ];
    },
    cycleMs: 5000,
  });
  fan.start();
  await sleep(30);
  var first = writes.length;
  fan.reapply();
  await sleep(30);
  await fan.stop({ final: false });
  assert.ok(writes.length > first, "a write followed reapply");
});

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

test("button: width classes", function () {
  var c = PowerButton.classify;
  assert.strictEqual(c(2), "noise");
  assert.strictEqual(c(9.9), "noise");
  assert.strictEqual(c(10), "reboot");
  assert.strictEqual(c(20.2), "reboot");
  assert.strictEqual(c(26.9), "reboot");
  assert.strictEqual(c(27), "ambiguous");
  assert.strictEqual(c(32.9), "ambiguous");
  assert.strictEqual(c(33), "shutdown");
  assert.strictEqual(c(40.4), "shutdown");
  assert.strictEqual(c(41.3), "shutdown");
  assert.strictEqual(c(50), "shutdown");
  assert.strictEqual(c(50.1), "other");
  assert.strictEqual(c(65), "other");
});

test("button: pulses measured from edge timestamps, correct watch call", async function () {
  gpioxStub.watchCalls = [];
  gpioxStub.deinitCalls = [];
  var clock = 0n;
  var seen = [];
  var b = new PowerButton({
    gpiox: gpioxStub,
    now: function () {
      return clock;
    },
    onPress: function (cls, w) {
      seen.push([cls, Math.round(w)]);
    },
  });
  assert.strictEqual(b.start(), true);
  assert.deepStrictEqual(gpioxStub.watchCalls[0], {
    pin: 4,
    mode: 3,
    debounce: 0,
    edge: 2,
  });

  function pulse(ms) {
    clock += 1000000000n;
    gpioxStub.cb(1, gpioxStub.GPIO_EDGE_RISING, 4);
    clock += BigInt(Math.round(ms * 1e6));
    gpioxStub.cb(0, gpioxStub.GPIO_EDGE_FALLING, 4);
  }
  [20.2, 40.4, 5, 60, 30].forEach(pulse);
  gpioxStub.cb(0, gpioxStub.GPIO_EDGE_FALLING, 4); // stray falling edge: ignored
  await sleep(30);
  assert.deepStrictEqual(seen, [
    ["reboot", 20],
    ["shutdown", 40],
    ["noise", 5],
    ["other", 60],
    ["ambiguous", 30],
  ]);

  b.stop();
  assert.deepStrictEqual(gpioxStub.deinitCalls, [4]);
  pulse(20); // after stop: ignored
  await sleep(20);
  assert.strictEqual(seen.length, 5);
});

test("button: watch_gpio failure is reported, not thrown", function () {
  var b = new PowerButton({
    gpiox: {
      GPIO_MODE_INPUT_PULLDOWN: 3,
      GPIO_EDGE_BOTH: 2,
      watch_gpio: function () {
        return undefined;
      },
    },
  });
  assert.strictEqual(b.start(), false);
  assert.ok(b.error);
});

// ---------------------------------------------------------------------------
// I2C and MCU protocol
// ---------------------------------------------------------------------------

function fakeExec(log, handler) {
  return function (file, args, opts, cb) {
    log.push([file].concat(args));
    var r = handler ? handler(file, args) : { out: "" };
    setImmediate(function () {
      if (r.err) cb(new Error(r.err), "", r.stderr || "");
      else cb(null, r.out || "", "");
    });
  };
}

test("i2c: exact command lines, serialised, hex formatting", async function () {
  var log = [];
  var i2c = new I2c({
    exec: fakeExec(log, function (f) {
      return { out: f.indexOf("i2cget") > -1 ? "0x1f\n" : "" };
    }),
  });
  var results = await Promise.all([
    i2c.sendByte(0xfe),
    i2c.writeReg(0x80, 5),
    i2c.readReg(0x80),
    i2c.sendByte(0),
  ]);
  assert.strictEqual(results[2], 31);
  assert.deepStrictEqual(log, [
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0xfe"],
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0x80", "0x05"],
    ["/usr/sbin/i2cget", "-y", "1", "0x1a", "0x80"],
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0x00"],
  ]);
});

test("i2c: an error does not break the queue", async function () {
  var log = [];
  var n = 0;
  var i2c = new I2c({
    exec: fakeExec(log, function () {
      n++;
      return n === 1
        ? { err: "nope", stderr: "Error: Write failed" }
        : { out: "" };
    }),
  });
  await assert.rejects(i2c.sendByte(1), /Write failed/);
  await i2c.sendByte(2);
  assert.strictEqual(log.length, 2);
});

test("i2c: abortSettle ends the delay early", async function () {
  var i2c = new I2c({ exec: fakeExec([], null) });
  var t0 = Date.now();
  var p = i2c.sendByte(1, 5000);
  await sleep(20);
  i2c.abortSettle();
  await p;
  assert.ok(Date.now() - t0 < 1000);
});

test("argon: firmware probe distinguishes register and legacy", async function () {
  // register firmware: the written value reads back
  var reg = 40;
  var logA = [];
  var i2cA = new I2c({
    exec: fakeExec(logA, function (f, a) {
      if (f.indexOf("i2cget") > -1) return { out: "0x" + reg.toString(16) };
      reg = parseInt(a[4], 16); // i2cset -y 1 0x1a 0x80 VALUE
      return { out: "" };
    }),
  });
  var mcuA = new ArgonMcu(i2cA);
  i2cA._settle = function () {
    return Promise.resolve();
  }; // skip the 1 s settle in the test
  assert.strictEqual(await mcuA.detect(), "register");
  assert.strictEqual(reg, 40, "duty register restored");

  // legacy firmware: read fails
  var i2cB = new I2c({
    exec: fakeExec([], function () {
      return { err: "Read failed" };
    }),
  });
  var mcuB = new ArgonMcu(i2cB);
  mcuB.retryMs = 0;
  assert.strictEqual(await mcuB.detect(), "legacy");

  // register-looking read but value never sticks -> legacy
  var i2cC = new I2c({
    exec: fakeExec([], function (f) {
      return f.indexOf("i2cget") > -1 ? { out: "0x28" } : { out: "" };
    }),
  });
  i2cC._settle = function () {
    return Promise.resolve();
  };
  var mcuC = new ArgonMcu(i2cC);
  assert.strictEqual(await mcuC.detect(), "legacy");
});

// A bus glitch must not decide the protocol; errors on every attempt still mean legacy.
test("argon: firmware probe retries errors and records how it decided", async function () {
  function rig(handler) {
    var logs = { info: [], warn: [] };
    var log = [];
    var i2c = new I2c({ exec: fakeExec(log, handler) });
    i2c._settle = function () {
      return Promise.resolve();
    };
    var mcu = new ArgonMcu(i2c, {
      info: function (m) {
        logs.info.push(m);
      },
      warn: function (m) {
        logs.warn.push(m);
      },
    });
    mcu.retryMs = 0;
    return { mcu: mcu, logs: logs, log: log };
  }
  function reads(log) {
    return log.filter(function (c) {
      return c[0].indexOf("i2cget") > -1;
    }).length;
  }

  // a register unit whose first read glitches: still register, found on the second attempt
  var reg = 40;
  var glitch = true;
  var a = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1) {
      if (glitch) {
        glitch = false;
        return { err: "Command failed", stderr: "Error: Read failed" };
      }
      return { out: "0x" + reg.toString(16) };
    }
    reg = parseInt(args[4], 16);
    return { out: "" };
  });
  assert.strictEqual(await a.mcu.detect(), "register");
  assert.strictEqual(a.mcu.firmware, "register");
  assert.strictEqual(a.logs.warn.length, 1, "the failed attempt is logged");
  assert.ok(/attempt 1 failed.*Read failed/.test(a.logs.warn[0]));
  assert.ok(/firmware probe: register \(value changed\)/.test(a.logs.info[0]));

  // a legacy unit whose first read glitches: the clean answer on the next attempt is final
  var b = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1)
      return b.fail++ === 0
        ? { err: "x", stderr: "Error: Read failed" }
        : { out: "0x28" };
    return { out: "" };
  });
  b.fail = 0;
  assert.strictEqual(await b.mcu.detect(), "legacy");
  assert.ok(/legacy \(value did not change\)/.test(b.logs.info[0]));

  // errors on every attempt: legacy (Argon's rule), after exactly three tries, error text logged
  var c = rig(function () {
    return { err: "x", stderr: "Error: Read failed" };
  });
  assert.strictEqual(await c.mcu.detect(), "legacy");
  assert.strictEqual(reads(c.log), 3);
  assert.strictEqual(
    c.log.length,
    3,
    "the register was never touched, so nothing is written",
  );
  assert.ok(
    /legacy \(i2c error on all 3 attempts: .*Read failed/.test(c.logs.info[0]),
  );

  // the probe write takes effect, then every read fails: legacy, but the duty is put back
  var live3 = 40;
  var h = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1)
      return h.firstRead++ === 0
        ? { out: "0x28" }
        : { err: "x", stderr: "Error: Read failed" };
    live3 = parseInt(args[4], 16);
    return { out: "" };
  });
  h.firstRead = 0;
  assert.strictEqual(await h.mcu.detect(), "legacy");
  assert.strictEqual(
    live3,
    40,
    "duty register restored after the failed probe",
  );
  assert.deepStrictEqual(
    h.log
      .filter(function (cmd) {
        return cmd[0].indexOf("i2cset") > -1;
      })
      .map(function (cmd) {
        return cmd[4] + "=" + cmd[5];
      }),
    ["0x80=0x29", "0x80=0x28"],
    "one probe write, one restore",
  );
  assert.ok(/legacy \(i2c error on all 3 attempts/.test(h.logs.info[0]));
  assert.ok(
    !h.logs.warn.some(function (m) {
      return /could not restore/.test(m);
    }),
  );

  // the same, but the restore write fails too: still legacy, with a warning
  var k = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1)
      return k.firstRead++ === 0
        ? { out: "0x28" }
        : { err: "x", stderr: "Error: Read failed" };
    return parseInt(args[4], 16) === 40
      ? { err: "x", stderr: "Error: Write failed" }
      : { out: "" };
  });
  k.firstRead = 0;
  assert.strictEqual(await k.mcu.detect(), "legacy");
  assert.ok(
    k.logs.warn.some(function (m) {
      return /could not restore.*Write failed/.test(m);
    }),
    JSON.stringify(k.logs.warn),
  );

  // the write sticks but its readback glitches: the retry starts from the changed
  // register, yet the original duty (40) is what ends up back in it
  var live = 40;
  var gets = 0;
  var e = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1) {
      gets++;
      if (gets === 2) return { err: "x", stderr: "Error: Read failed" }; // the readback
      return { out: "0x" + live.toString(16) };
    }
    live = parseInt(args[4], 16);
    return { out: "" };
  });
  assert.strictEqual(await e.mcu.detect(), "register");
  assert.strictEqual(
    live,
    40,
    "duty register back at its original value, not one step above",
  );
  assert.strictEqual(reads(e.log), 4);

  // a write that errors after it was applied is handled the same way
  var live2 = 40;
  var writes2 = 0;
  var g = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1) return { out: "0x" + live2.toString(16) };
    live2 = parseInt(args[4], 16);
    if (++writes2 === 1) return { err: "x", stderr: "Error: Write failed" }; // applied, but reported as failed
    return { out: "" };
  });
  assert.strictEqual(await g.mcu.detect(), "register");
  assert.strictEqual(live2, 40);

  // the value stuck but the restore write fails: still register, with a warning
  var held = 40;
  var d = rig(function (f, args) {
    if (f.indexOf("i2cget") > -1) return { out: "0x" + held.toString(16) };
    var v = parseInt(args[4], 16);
    if (v === 40) return { err: "x", stderr: "Error: Write failed" }; // the restore write
    held = v;
    return { out: "" };
  });
  assert.strictEqual(await d.mcu.detect(), "register");
  assert.strictEqual(
    reads(d.log),
    2,
    "no second attempt once the value has stuck",
  );
  assert.ok(
    d.logs.warn.some(function (m) {
      return /could not restore/.test(m);
    }),
  );
});

test("argon: arming for power-off and fan speed per firmware", async function () {
  var log = [];
  var i2c = new I2c({ exec: fakeExec(log, null) });
  i2c._settle = function () {
    return Promise.resolve();
  };
  var mcu = new ArgonMcu(i2c);
  mcu.firmware = "legacy";
  await mcu.armPowerOff();
  mcu.firmware = "register";
  await mcu.armPowerOff();
  assert.strictEqual(
    mcu.setPowerMode,
    undefined,
    "0xFE/0xFD power modes are deliberately not implemented",
  );
  mcu.firmware = "legacy";
  await mcu.setFanSpeed(150);
  await mcu.setFanSpeed(30);
  mcu.firmware = "register";
  await mcu.setFanSpeed(55);
  assert.deepStrictEqual(log, [
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0xff"],
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0x86", "0x01"],
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0x64"],
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0x1e"],
    ["/usr/sbin/i2cset", "-y", "1", "0x1a", "0x80", "0x37"],
  ]);
});

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

test("platform: model tags and UART runtime parsing", function () {
  assert.strictEqual(Platform.isPi5("Raspberry Pi 5 Model B Rev 1.0"), true);
  assert.strictEqual(Platform.isPi5("Raspberry Pi 4 Model B Rev 1.4"), false);
  assert.strictEqual(
    Platform.modelTag("Raspberry Pi 4 Model B Rev 1.4"),
    "pi4",
  );
  assert.strictEqual(
    Platform.modelTag("Raspberry Pi 400 Rev 1.0"),
    "pi4",
    "a Pi 400 gets the [pi4] sections",
  );
  assert.strictEqual(
    Platform.modelTag("Raspberry Pi 5 Model B Rev 1.0"),
    "pi5",
  );
  assert.strictEqual(Platform.modelTag(""), "other");
  assert.strictEqual(
    Platform.parseUartRuntime("14: a5    pn | hi // GPIO14 = TXD1\n"),
    "active",
  );
  assert.strictEqual(
    Platform.parseUartRuntime("14: a4    pn | hi // GPIO14 = TXD0\n"),
    "active",
  );
  assert.strictEqual(
    Platform.parseUartRuntime("14: ip    pn | hi // GPIO14 = input\n"),
    "inactive",
  );
  assert.strictEqual(Platform.parseUartRuntime(""), "unknown");
});

// ---------------------------------------------------------------------------
// Boot-config handling
// ---------------------------------------------------------------------------

test("uartconfig: line parsing for Pi 4 and Pi 5", function () {
  var l = UartConfig.lineSetsUart;
  assert.strictEqual(l("enable_uart=1", false), "on");
  assert.strictEqual(l("enable_uart=0", false), "off");
  assert.strictEqual(l("  enable_uart = 1  ", false), "on");
  assert.strictEqual(l("#enable_uart=1", false), null);
  assert.strictEqual(l("dtparam=uart0=on", false), null);
  assert.strictEqual(l("dtparam=uart0=on", true), "on");
  assert.strictEqual(l("dtparam=uart0", true), "on");
  assert.strictEqual(l("dtparam=uart0=off", true), "off");
  assert.strictEqual(l("dtparam=i2c_arm=on,uart0=on", true), "on");
  assert.strictEqual(l("dtparam=uart0_console", true), null);
  assert.strictEqual(l("enable_uart=1", true), null);
});

test("uartconfig: scanText honours sections and ignores the plugin block", function () {
  var text = [
    "enable_uart=1",
    "[pi5]",
    "enable_uart=0",
    "[all]",
    UartConfig.BEGIN,
    "enable_uart=1",
    UartConfig.END,
    "",
  ].join("\n");
  var r = UartConfig.scanText(text, false, "pi4");
  assert.deepStrictEqual(r.foreign, [1]);
  assert.deepStrictEqual(r.off, []); // the [pi5] line does not apply on a Pi 4
  assert.strictEqual(r.own, true);
  var r5 = UartConfig.scanText(text, false, "pi5");
  assert.deepStrictEqual(r5.off, [3]);
});

test("uartconfig: block add/remove round trip, CRLF kept, other lines untouched", function () {
  var base = "dtparam=audio=off\r\n\r\ngpu_mem=32\r\n";
  var added = UartConfig.addBlock(base, false);
  assert.ok(
    added.indexOf(
      UartConfig.BEGIN + "\r\nenable_uart=1\r\n" + UartConfig.END + "\r\n",
    ) > -1,
  );
  assert.strictEqual(UartConfig.removeBlock(added), base);
  // adding twice does not duplicate
  assert.strictEqual(UartConfig.addBlock(added, false), added);
  // no trailing newline in the source
  assert.strictEqual(
    UartConfig.removeBlock(UartConfig.addBlock("a=1", true)),
    "a=1\n",
  );
  assert.ok(UartConfig.addBlock("", true).indexOf("dtparam=uart0=on") > -1);
});

test("uartconfig: an incomplete block is never removed and the file is left untouched", function () {
  var B = UartConfig.BEGIN;
  var E = UartConfig.END;
  var noEnd = [
    "dtparam=audio=off",
    B,
    "enable_uart=1",
    "gpu_mem=32",
    "dtoverlay=vc4-kms-v3d",
    "",
  ].join("\n");
  var twoBegin = [
    B,
    "enable_uart=1",
    B,
    "gpu_mem=32",
    E,
    "arm_boost=1",
    "",
  ].join("\n");
  var strayEnd = ["gpu_mem=32", E, "arm_boost=1", ""].join("\n");
  var good = [B, "enable_uart=1", E, "arm_boost=1", ""].join("\n");

  assert.strictEqual(UartConfig.blockStatus(""), "none");
  assert.strictEqual(UartConfig.blockStatus("a=1\n"), "none");
  assert.strictEqual(UartConfig.blockStatus(good), "ok");
  assert.strictEqual(UartConfig.blockStatus(good + good), "ok");
  assert.strictEqual(UartConfig.blockStatus(noEnd), "malformed");
  assert.strictEqual(UartConfig.blockStatus(twoBegin), "malformed");
  assert.strictEqual(
    UartConfig.blockStatus(strayEnd),
    "none",
    "a stray END removes nothing, so it is harmless",
  );
  assert.strictEqual(
    UartConfig.blockStatus(B + "\r\nenable_uart=1\r\n" + E + "\r\n"),
    "ok",
  );

  // removeBlock refuses: the text comes back unchanged
  assert.strictEqual(UartConfig.removeBlock(noEnd), noEnd);
  assert.strictEqual(UartConfig.removeBlock(twoBegin), twoBegin);
  assert.strictEqual(UartConfig.removeBlock(strayEnd), strayEnd);
  assert.strictEqual(UartConfig.removeBlock(good), "arm_boost=1\n");

  // scanText: nothing after an unterminated BEGIN is hidden as "ours"
  var s = UartConfig.scanText(noEnd, false, "pi4");
  assert.strictEqual(s.malformed, true);
  assert.strictEqual(s.own, false);
  assert.deepStrictEqual(s.foreign, [3]);

  // enable and disable on a real file: refused, file byte for byte unchanged
  var dir = tmpdir();
  var bk = tmpdir();
  var file = path.join(dir, "userconfig.txt");
  var opts = { pi5: false, tag: "pi4", bootDir: dir, backupDir: bk };
  [noEnd, twoBegin].forEach(function (text) {
    fs.writeFileSync(file, text);
    var d = UartConfig.disable(opts);
    assert.ok(!d.ok && !d.changed && d.reason === "malformed");
    var e = UartConfig.enable(opts);
    assert.ok(!e.ok && !e.changed && e.reason === "malformed");
    assert.strictEqual(fs.readFileSync(file, "utf8"), text);
    assert.ok(
      !fs.existsSync(path.join(bk, "userconfig.txt.bak")),
      "no backup for a refused change",
    );
  });

  // a stray END does not block enable/disable
  fs.writeFileSync(file, strayEnd);
  var ok = UartConfig.enable(opts);
  assert.ok(ok.ok && ok.changed);
  assert.ok(UartConfig.disable(opts).changed);
  assert.strictEqual(fs.readFileSync(file, "utf8"), strayEnd);
});

test("uartconfig: enable/disable on real files in the five states", function () {
  var dir = tmpdir();
  var bk = tmpdir();
  function opts() {
    return { pi5: false, tag: "pi4", bootDir: dir, backupDir: bk };
  }
  function w(name, text) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  function rd(name) {
    return fs.readFileSync(path.join(dir, name), "utf8");
  }

  w("config.txt", "include volumioconfig.txt\ninclude userconfig.txt\n");
  w("volumioconfig.txt", "# dtparam=uart0_console # Disabled by default\n");
  w("userconfig.txt", "# user\ndtparam=foo=1\n");
  assert.strictEqual(UartConfig.scan(opts()).state, "off");

  // off -> managed
  var r = UartConfig.enable(opts());
  assert.ok(r.ok && r.changed);
  assert.strictEqual(UartConfig.scan(opts()).state, "managed");
  assert.ok(
    fs.existsSync(path.join(bk, "userconfig.txt.bak")),
    "one-time backup written",
  );
  assert.strictEqual(
    rd("config.txt"),
    "include volumioconfig.txt\ninclude userconfig.txt\n",
    "config.txt untouched",
  );
  var again = UartConfig.enable(opts());
  assert.ok(again.ok && !again.changed && again.reason === "already");

  // foreign line added -> both
  w("config.txt", rd("config.txt") + "enable_uart=1\n");
  var s = UartConfig.scan(opts());
  assert.strictEqual(s.state, "both");
  assert.deepStrictEqual(s.foreign, [{ file: "config.txt", line: 3 }]);

  // disable removes only the plugin block; the foreign line stays
  var d = UartConfig.disable(opts());
  assert.ok(d.ok && d.changed);
  assert.strictEqual(d.status.state, "foreign");
  assert.strictEqual(rd("userconfig.txt"), "# user\ndtparam=foo=1\n");
  assert.ok(rd("config.txt").indexOf("enable_uart=1") > -1);

  // foreign only: enable writes nothing
  var f = UartConfig.enable(opts());
  assert.ok(f.ok && !f.changed && f.reason === "foreign");
  assert.strictEqual(rd("userconfig.txt"), "# user\ndtparam=foo=1\n");

  // conflict: an explicit off line and nothing on
  w("config.txt", "enable_uart=0\n");
  assert.strictEqual(UartConfig.scan(opts()).state, "conflict");
  var c = UartConfig.enable(opts());
  assert.ok(!c.ok && c.reason === "conflict");
  assert.strictEqual(rd("userconfig.txt"), "# user\ndtparam=foo=1\n");

  // disable with no block: no change
  var n = UartConfig.disable(opts());
  assert.ok(n.ok && !n.changed);
});

// ---------------------------------------------------------------------------
// Plugin object with a fake Volumio
// ---------------------------------------------------------------------------

test("plugin: lifecycle, button actions, settings page, saves", async function () {
  var work = tmpdir();
  var cfgFile = path.join(work, "config.json");
  fs.copyFileSync(path.join(ROOT, "config.json"), cfgFile);

  var toasts = [];
  var modals = [];
  var calls = { reboot: 0, shutdown: 0, restart: 0, restartCommand: 0 };
  var strings = JSON.parse(
    fs.readFileSync(path.join(ROOT, "i18n/strings_en.json"), "utf8"),
  );
  var router = {
    sharedVars: {
      get: function () {
        return "en";
      },
    },
    pluginManager: {
      getConfigurationFile: function () {
        return cfgFile;
      },
    },
    i18nJson: function (lang, def, ui) {
      var text = fs
        .readFileSync(ui, "utf8")
        .replace(/TRANSLATE\.([A-Z0-9_]+)/g, function (m, k) {
          assert.ok(strings[k] !== undefined, "missing string: " + k);
          return String(strings[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        });
      return kewStub.resolve(JSON.parse(text));
    },
    pushToastMessage: function (type, title, msg) {
      toasts.push([type, msg]);
    },
    broadcastMessage: function (name, data) {
      modals.push([name, data]);
    },
    getUIConfigOnPlugin: function () {
      return p.getUIConfig();
    },
    closeModals: function () {},
    reboot: function () {
      calls.reboot++;
    },
    volumioRestart: function () {
      calls.restart++;
    },
    shutdown: function () {
      calls.shutdown++;
    },
  };
  var logger = {
    info: function () {},
    warn: function () {},
    error: function (m) {
      console.log("   logged error: " + m);
    },
  };
  var Plugin = require(path.join(ROOT, "index.js"));
  var p = new Plugin({
    coreCommand: router,
    logger: logger,
    configManager: {},
    execFile: function (file, args, opts, cb) {
      assert.strictEqual(file, "sudo");
      assert.deepStrictEqual(args, ["-n", "/bin/systemctl", "restart", "volumio.service"]);
      calls.restartCommand++;
      setImmediate(function () { cb(null, "", ""); });
    },
  });

  // boot dir for UART tests: a foreign setting is present
  var boot = tmpdir();
  fs.writeFileSync(path.join(boot, "config.txt"), "enable_uart=1\n");
  fs.writeFileSync(path.join(boot, "userconfig.txt"), "");
  fs.writeFileSync(path.join(boot, "volumioconfig.txt"), "");
  p.uartOpts = function () {
    return { pi5: false, tag: "pi4", bootDir: boot, backupDir: work };
  };

  await p.onVolumioStart();
  gpioxStub.watchCalls = [];
  await p.onStart();
  await sleep(50);
  assert.strictEqual(
    gpioxStub.watchCalls.length,
    1,
    "button watch started (power enabled by default)",
  );

  function pulse(ms) {
    gpioxStub.cb(1, gpioxStub.GPIO_EDGE_RISING, 4);
    var t = Date.now();
    while (Date.now() - t < ms) {
      /* busy wait: the plugin measures real time here */
    }
    gpioxStub.cb(0, gpioxStub.GPIO_EDGE_FALLING, 4);
  }

  // log-only mode: no action
  p.config.set("powerLogOnly", true);
  pulse(20);
  await sleep(30);
  assert.strictEqual(calls.reboot, 0);
  assert.ok(
    toasts.some(function (t) {
      return /test mode/.test(t[1]);
    }),
  );
  assert.ok(
    toasts.some(function (t) {
      return /pulse \d+\.\d ms/.test(t[1]);
    }),
    "test mode toast shows the pulse width: " + JSON.stringify(toasts),
  );
  p.config.set("powerLogOnly", false);

  // double tap set to "restart the Volumio app": no reboot
  p.config.set("powerDoubleTap", "restart");
  pulse(20);
  await sleep(30);
  assert.strictEqual(calls.restart, 0, "the command router restart method is not used");
  assert.strictEqual(calls.restartCommand, 1, "double tap asks systemd to restart Volumio");
  assert.strictEqual(calls.reboot, 0, "no reboot in restart mode");
  clearTimeout(p.actionTimer);
  p.actionInFlight = false;
  p.config.set("powerDoubleTap", "reboot");

  pulse(20);
  await sleep(30);
  assert.strictEqual(calls.reboot, 1, "double tap pulse reboots");
  pulse(40);
  await sleep(30);
  assert.strictEqual(calls.shutdown, 0, "one action at a time");

  // settings page
  var ui = await p.getUIConfig();
  assert.ok(!/TRANSLATE\./.test(JSON.stringify(ui)));
  function el(id) {
    for (var s = 0; s < ui.sections.length; s++) {
      for (var c = 0; c < ui.sections[s].content.length; c++) {
        if (ui.sections[s].content[c].id === id)
          return ui.sections[s].content[c];
      }
    }
  }
  assert.strictEqual(el("powerEnabled").value, true);
  assert.deepStrictEqual(el("powerDoubleTap").value, {
    value: "reboot",
    label: "Reboot the system",
  });
  await p.savePower({
    powerEnabled: true,
    powerLogOnly: false,
    uartSignal: false,
    powerDoubleTap: { value: "restart", label: "x" },
  });
  assert.strictEqual(p.doubleTapAction(), "restart");
  await p.savePower({
    powerEnabled: true,
    powerLogOnly: false,
    uartSignal: false,
    powerDoubleTap: "junk",
  });
  assert.strictEqual(p.doubleTapAction(), "reboot");
  assert.strictEqual(el("uartSignal").value, false);
  assert.strictEqual(el("fanT2").value, 60);
  ["power_button_status", "fan_temp_now", "fan_state", "fan_firmware"].forEach(
    function (id) {
      assert.ok(
        !el(id),
        id + " is live data and must not be on the settings page",
      );
    },
  );
  // one plain phrase on the page; who set it and where are only in the log
  assert.ok(
    /^Enabled/.test(el("uartStatus").value) &&
      !/config\.txt/.test(el("uartStatus").value),
    el("uartStatus").value,
  );
  var st = function (state, rt) {
    return p.uartStatusText({ state: state, foreign: [], off: [] }, rt);
  };
  assert.strictEqual(st("managed", "active"), "Enabled");
  assert.strictEqual(st("foreign", "active"), "Enabled");
  assert.strictEqual(st("both", "unknown"), "Enabled");
  assert.strictEqual(st("foreign", "inactive"), "Enabled, reboot needed");
  assert.strictEqual(st("off", "inactive"), "Disabled");
  assert.strictEqual(st("off", "unknown"), "Disabled");
  assert.strictEqual(st("off", "active"), "Disabled, reboot needed");
  assert.strictEqual(
    st("conflict", "inactive"),
    "Cannot be enabled (blocked by another setting, see the Volumio log)",
  );
  assert.strictEqual(
    p.uartLogLine(
      {
        state: "foreign",
        foreign: [{ file: "config.txt", line: 14 }],
        off: [],
      },
      "active",
    ),
    "UART: boot setting on (set by another setting: config.txt:14); in use now: yes (GPIO14 in UART mode)",
  );
  assert.ok(
    /blocked \(turned off by config\.txt:5\); in use now: no$/.test(
      p.uartLogLine(
        {
          state: "conflict",
          foreign: [],
          off: [{ file: "config.txt", line: 5 }],
        },
        "inactive",
      ),
    ),
  );

  // log(s, level): plugin name in front, info by default
  var realLogger = p.logger;
  var logged = [];
  p.logger = {
    info: function (m) {
      logged.push(["info", m]);
    },
    warn: function (m) {
      logged.push(["warn", m]);
    },
    error: function (m) {
      logged.push(["error", m]);
    },
  };
  p.log("hello");
  p.log("careful", "warn");
  p.log("broken", "error");
  p.logger = realLogger;
  assert.deepStrictEqual(logged, [
    ["info", "[Argon ONE Power & Fan] hello"],
    ["warn", "[Argon ONE Power & Fan] careful"],
    ["error", "[Argon ONE Power & Fan] broken"],
  ]);

  // a missing string shows its key and is logged once per key
  logged.length = 0;
  p.logger = {
    info: function (m) {
      logged.push(["info", m]);
    },
    warn: function (m) {
      logged.push(["warn", m]);
    },
    error: function (m) {
      logged.push(["error", m]);
    },
  };
  assert.strictEqual(p.t("NO_SUCH_STRING"), "NO_SUCH_STRING");
  assert.strictEqual(p.t("NO_SUCH_STRING"), "NO_SUCH_STRING");
  assert.strictEqual(p.t("ANOTHER_MISSING_ONE"), "ANOTHER_MISSING_ONE");
  p.logger = realLogger;
  assert.deepStrictEqual(logged, [
    ["warn", "[Argon ONE Power & Fan] missing string: NO_SUCH_STRING"],
    ["warn", "[Argon ONE Power & Fan] missing string: ANOTHER_MISSING_ONE"],
  ]);
  assert.strictEqual(ui.sections.length, 2);
  assert.ok(
    /may not be supported/.test(el("fanMode").doc) &&
      /full speed/.test(el("fanMode").doc),
  );

  // every fan control that depends on the mode is hidden when the fan is off: all of
  // them hang on the single fanMode select (visibleIf supports one field and value only)
  var fanContent = ui.sections[1].content;
  var modeFor = {
    fanOnTemp: "onoff",
    fanT1: "steps",
    fanS1: "steps",
    fanT2: "steps",
    fanS2: "steps",
    fanT3: "steps",
    fanS3: "steps",
  };
  Object.keys(modeFor).forEach(function (id) {
    assert.deepStrictEqual(
      el(id).visibleIf,
      { field: "fanMode", value: modeFor[id] },
      id,
    );
  });
  fanContent.forEach(function (c) {
    if (c.visibleIf)
      assert.deepStrictEqual(
        Object.keys(c.visibleIf).sort(),
        ["field", "value"],
        c.id,
      );
  });
  assert.deepStrictEqual(
    el("fanMode").options.map(function (o) {
      return o.value;
    }),
    ["off", "onoff", "steps"],
  );
  assert.ok(
    !el("power_mode_always_on") && !el("power_mode_default"),
    "no power mode buttons",
  );
  assert.strictEqual(p.writePowerMode, undefined);

  // enabling the UART signal while a foreign setting exists: nothing written
  toasts.length = 0;
  await p.savePower({
    powerEnabled: true,
    powerLogOnly: false,
    uartSignal: true,
  });
  assert.strictEqual(
    fs.readFileSync(path.join(boot, "userconfig.txt"), "utf8"),
    "",
  );
  assert.ok(
    toasts.some(function (t) {
      return /already enabled by another setting/.test(t[1]);
    }),
    JSON.stringify(toasts),
  );
  assert.strictEqual(p.cfgBool("uartSignal", false), true);
  await p.savePower({
    powerEnabled: true,
    powerLogOnly: false,
    uartSignal: false,
  });
  assert.strictEqual(p.cfgBool("uartSignal", true), false);
  assert.ok(
    modals.some(function (m) {
      return m[0] === "pushUiConfig" && m[1];
    }),
    "a saved power page is pushed again (UART status line)",
  );

  // a refused UART change (config.txt turns the UART off) pushes the page back to the stored switch
  fs.writeFileSync(path.join(boot, "config.txt"), "enable_uart=0\n");
  toasts.length = 0;
  modals.length = 0;
  await p.savePower({
    powerEnabled: true,
    powerLogOnly: false,
    uartSignal: true,
  });
  assert.ok(
    toasts.some(function (t) {
      return t[0] === "error" && /Cannot enable the UART/.test(t[1]);
    }),
    JSON.stringify(toasts),
  );
  assert.strictEqual(
    p.cfgBool("uartSignal", true),
    false,
    "stored value unchanged",
  );
  var pushed = modals.filter(function (m) {
    return m[0] === "pushUiConfig" && m[1];
  });
  assert.ok(pushed.length >= 1, "page pushed after the refused save");
  var pushedUart = pushed[pushed.length - 1][1].sections[0].content.filter(
    function (c) {
      return c.id === "uartSignal";
    },
  )[0];
  assert.strictEqual(
    pushedUart.value,
    false,
    "pushed page shows the stored switch",
  );
  fs.writeFileSync(path.join(boot, "config.txt"), "enable_uart=1\n");

  // invalid fan settings are refused (page pushed back with the stored values), valid ones saved
  toasts.length = 0;
  // default is on/off: one threshold, the case only gets 0 or 100
  assert.deepStrictEqual(p.getCurve(), [{ temp: 55, speed: 100 }]);
  assert.deepStrictEqual(el("fanMode").value, {
    value: "onoff",
    label: "On/off by temperature",
  });
  await p.saveFan({
    fanMode: "steps",
    fanT1: "60",
    fanS1: "30",
    fanT2: "55",
    fanS2: "55",
    fanT3: "65",
    fanS3: "100",
  });
  assert.ok(
    toasts.some(function (t) {
      return /not saved/.test(t[1]) && /must rise/.test(t[1]);
    }),
    JSON.stringify(toasts),
  );
  assert.strictEqual(p.cfgInt("fanT1", 0), 55);

  // out of range, decimal and empty values: named field and range in the toast,
  // nothing stored, stored values pushed back to the page
  async function refused(data, re) {
    toasts.length = 0;
    modals.length = 0;
    await p.saveFan(data);
    assert.ok(
      toasts.some(function (t) {
        return t[0] === "error" && re.test(t[1]);
      }),
      re + " not in " + JSON.stringify(toasts),
    );
    var pushedFan = modals.filter(function (m) {
      return m[0] === "pushUiConfig" && m[1];
    });
    assert.ok(pushedFan.length >= 1, "page pushed after the refused save");
    var f = pushedFan[pushedFan.length - 1][1].sections[1].content;
    assert.strictEqual(
      f.filter(function (c) {
        return c.id === "fanT1";
      })[0].value,
      55,
      "pushed page shows the stored value",
    );
    assert.strictEqual(p.cfgInt("fanT1", 0), 55, "nothing stored");
    assert.strictEqual(
      p.cfgBool("fanSpeedSteps", true),
      false,
      "mode not stored",
    );
  }
  await refused(
    {
      fanMode: "steps",
      fanT1: "120",
      fanS1: "30",
      fanT2: "60",
      fanS2: "55",
      fanT3: "65",
      fanS3: "100",
    },
    /Setpoint 1: temperature.*from 0 to 100/,
  );
  await refused(
    {
      fanMode: "steps",
      fanT1: "55",
      fanS1: "30",
      fanT2: "60",
      fanS2: "155",
      fanT3: "65",
      fanS3: "100",
    },
    /Setpoint 2: fan speed.*from 0 to 100/,
  );
  await refused(
    {
      fanMode: "steps",
      fanT1: "55.5",
      fanS1: "30",
      fanT2: "60",
      fanS2: "55",
      fanT3: "65",
      fanS3: "100",
    },
    /Setpoint 1: temperature/,
  );
  await refused(
    {
      fanMode: "steps",
      fanT1: "",
      fanS1: "30",
      fanT2: "60",
      fanS2: "55",
      fanT3: "65",
      fanS3: "100",
    },
    /Setpoint 1: temperature/,
  );
  await refused(
    { fanMode: "onoff", fanOnTemp: "-1" },
    /Fan on at.*from 0 to 100/,
  );
  await refused({ fanMode: "onoff", fanOnTemp: "5x" }, /Fan on at/);
  await p.saveFan({
    fanMode: { value: "steps", label: "x" },
    fanT1: "50",
    fanS1: "25",
    fanT2: "58",
    fanS2: "50",
    fanT3: "66",
    fanS3: "90",
  });
  assert.strictEqual(p.cfgInt("fanT1", 0), 50);
  assert.strictEqual(p.cfgInt("fanS3", 0), 90);
  assert.strictEqual(p.getCurve().length, 3);
  var saved = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  assert.strictEqual(saved.fanT1.value, 50);
  assert.strictEqual(saved.fanSpeedSteps.value, true);

  // back to on/off: only t1 is read, hidden fields (even junk) are ignored and kept
  toasts.length = 0;
  await p.saveFan({
    fanMode: "onoff",
    fanOnTemp: "62",
    fanT1: "junk",
    fanS1: "x",
    fanT2: "",
    fanS2: "",
    fanT3: "",
    fanS3: "",
  });
  assert.ok(
    !toasts.some(function (t) {
      return t[0] === "error";
    }),
    JSON.stringify(toasts),
  );
  assert.deepStrictEqual(p.getCurve(), [{ temp: 62, speed: 100 }]);
  assert.strictEqual(p.cfgInt("fanS3", 0), 90);
  await p.saveFan({ fanMode: "onoff", fanOnTemp: "150" });
  assert.ok(
    toasts.some(function (t) {
      return /Fan on at.*from 0 to 100/.test(t[1]);
    }),
  );
  assert.strictEqual(p.cfgInt("fanT1", 0), 62);

  // stored values outside the limits (manual edit) fall back to the defaults when used
  p.config.set("fanT1", 999);
  assert.deepStrictEqual(p.getCurve(), [{ temp: 55, speed: 100 }]);
  p.config.set("fanT1", 62);
  p.config.set("fanSpeedSteps", true);
  p.config.set("fanT2", 40); // not above t1: out of order
  assert.deepStrictEqual(
    p.getCurve().map(function (c) {
      return c.temp;
    }),
    [55, 60, 65],
  );
  p.config.set("fanT2", 58);
  p.config.set("fanSpeedSteps", false);

  // switching between speed steps and on/off updates the fan and the reported state
  var fanWrites = [];
  var fakeMcu = {
    i2c: { abortSettle: function () {} },
    firmware: "legacy",
    setFanSpeed: async function (s) {
      fanWrites.push(s);
    },
  };
  p.i2cReady = function () {
    return true;
  };
  p.mcu = fakeMcu;
  p.fan.mcu = fakeMcu;
  p.fan.readTemp = function () {
    return 57;
  };
  await p.saveFan({
    fanMode: "steps",
    fanT1: "55",
    fanS1: "30",
    fanT2: "60",
    fanS2: "55",
    fanT3: "65",
    fanS3: "100",
  });
  await sleep(80);
  assert.strictEqual(
    p.fanStateText(),
    "30%",
    "speed steps: first threshold speed at 57 C",
  );
  assert.strictEqual(
    p.fanModeText(),
    "speed steps 55 °C → 30%, 60 °C → 55%, 65 °C → 100%",
  );
  await p.saveFan({ fanMode: "onoff", fanOnTemp: "55" });
  await sleep(80);
  assert.strictEqual(
    p.fanStateText(),
    "100%",
    "on/off: reports 100% above the setpoint, writes " +
      JSON.stringify(fanWrites),
  );
  assert.strictEqual(p.fanModeText(), "on/off, on at 55 °C");
  toasts.length = 0;
  p.config.set("fanSpeedSteps", true);
  p.fan.lastError = "boom";
  assert.strictEqual(
    p.fanModeText(),
    "speed steps 55 °C → 30%, 60 °C → 55%, 65 °C → 100%; last write failed: boom",
  );
  p.config.set("fanSpeedSteps", false);
  p.fan.lastError = null;
  await p.saveFan({ fanMode: "onoff", fanOnTemp: "60" });
  await sleep(80);
  assert.strictEqual(
    p.fan.lastSpeed,
    0,
    "a settings change is applied at once, also downwards (stock: prev = 200)",
  );

  // mode off: stored thresholds kept, controller stopped, page shows "Off"
  await p.saveFan({ fanMode: "off", fanOnTemp: "junk" });
  assert.strictEqual(p.cfgBool("fanEnabled", true), false);
  assert.strictEqual(p.cfgInt("fanT1", 0), 60);
  assert.strictEqual(p.fan.running, false);
  assert.strictEqual(p.fanModeText(), "fan control off");
  var uiOff = await p.getUIConfig();
  assert.deepStrictEqual(uiOff.sections[1].content[0].value, {
    value: "off",
    label: "Off",
  });

  // switching a running fan to Off switches it off once; a failed write still saves Off
  p.fan.readTemp = function () {
    return 70;
  };
  await p.saveFan({ fanMode: "onoff", fanOnTemp: "60" });
  await sleep(80);
  assert.strictEqual(
    p.fan.lastSpeed,
    100,
    "fan running at 70 C with setpoint 60",
  );
  fanWrites.length = 0;
  await p.saveFan({ fanMode: "off" });
  assert.deepStrictEqual(fanWrites, [0], "Off writes 0 once");
  assert.strictEqual(p.fan.lastSpeed, 0);
  assert.strictEqual(p.cfgBool("fanEnabled", true), false);
  await p.saveFan({ fanMode: "off" });
  assert.deepStrictEqual(fanWrites, [0], "already Off: no further write");

  await p.saveFan({ fanMode: "onoff", fanOnTemp: "60" });
  await sleep(80);
  toasts.length = 0;
  fakeMcu.setFanSpeed = async function () {
    throw new Error("i2c fail");
  };
  await p.saveFan({ fanMode: "off" });
  assert.strictEqual(
    p.cfgBool("fanEnabled", true),
    false,
    "Off is saved although the write failed",
  );
  assert.ok(
    !toasts.some(function (t) {
      return t[0] === "error";
    }),
    JSON.stringify(toasts),
  );
  assert.strictEqual(p.fan.running, false);
  p.fan.readTemp = function () {
    return 57;
  };

  // show temperature never throws, even without a sensor
  await p.showTemperature();

  // with fan control off the popup has no fan state; with it on, state and mode
  var realReadTemp = Platform.readCpuTemp;
  Platform.readCpuTemp = function () {
    return 48.26;
  };
  toasts.length = 0;
  await p.showTemperature();
  assert.deepStrictEqual(toasts, [
    ["info", "CPU temperature 48.3 °C. Fan control is off"],
  ]);
  p.config.set("fanEnabled", true);
  toasts.length = 0;
  await p.showTemperature();
  assert.ok(
    /^CPU temperature 48\.3 °C\. Fan: .+ \(.+\)$/.test(toasts[0][1]),
    JSON.stringify(toasts),
  );
  p.config.set("fanEnabled", false);
  Platform.readCpuTemp = realReadTemp;

  // reboot hook must not signal power-off; shutdown hook releases the GPIO
  gpioxStub.deinitCalls = [];
  await p.onVolumioShutdown();
  assert.deepStrictEqual(gpioxStub.deinitCalls, [4]);
  await p.onStop();
});

// The defaults live in config.json, in the values of UIConfig.json and in the code
// (the fallbacks used when nothing valid is stored). They must all agree.
test("defaults: config.json, UIConfig.json and the code fallbacks agree", async function () {
  var defaults = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf8"),
  );
  function def(key) {
    return defaults[key].value;
  }
  var expected = {
    powerEnabled: def("powerEnabled"),
    powerLogOnly: def("powerLogOnly"),
    powerDoubleTap: def("powerDoubleTap"),
    uartSignal: def("uartSignal"),
    fanMode: !def("fanEnabled")
      ? "off"
      : def("fanSpeedSteps")
        ? "steps"
        : "onoff",
    fanOnTemp: def("fanT1"),
    fanT1: def("fanT1"),
    fanS1: def("fanS1"),
    fanT2: def("fanT2"),
    fanS2: def("fanS2"),
    fanT3: def("fanT3"),
    fanS3: def("fanS3"),
  };
  function shown(v) {
    return v && typeof v === "object" ? v.value : v;
  }
  function find(uiconf, id) {
    for (var s = 0; s < uiconf.sections.length; s++) {
      var content = uiconf.sections[s].content || [];
      for (var c = 0; c < content.length; c++) {
        if (content[c].id === id) return content[c];
      }
    }
    return null;
  }

  var staticUi = JSON.parse(
    fs.readFileSync(path.join(ROOT, "UIConfig.json"), "utf8"),
  );

  // nothing stored: every value on the page comes from the fallbacks in the code
  var Plugin = require(path.join(ROOT, "index.js"));
  var quiet = {
    info: function () {},
    warn: function () {},
    error: function () {},
  };
  var p = new Plugin({
    coreCommand: {
      sharedVars: {
        get: function () {
          return "en";
        },
      },
    },
    logger: quiet,
    configManager: {},
  });
  p.loadI18n();
  p.config = new VConfStub();
  var fromCode = JSON.parse(JSON.stringify(staticUi));
  p.fillUiConfig(fromCode, { uart: { state: "off" }, runtime: "unknown" });

  Object.keys(expected).forEach(function (id) {
    assert.ok(find(staticUi, id), "UIConfig.json has " + id);
    assert.strictEqual(
      shown(find(staticUi, id).value),
      expected[id],
      "UIConfig.json value of " + id,
    );
    assert.strictEqual(
      shown(find(fromCode, id).value),
      expected[id],
      "code fallback for " + id,
    );
  });
});

// The first applyConfig waits for the firmware probe (a few seconds on the Pi). If the
// plugin is stopped meanwhile, the fan loop must not start afterwards.
test("lifecycle: stopping during the firmware probe does not start the fan", async function () {
  var Plugin = require(path.join(ROOT, "index.js"));
  var quiet = {
    info: function () {},
    warn: function () {},
    error: function () {},
  };
  var p = new Plugin({
    coreCommand: {
      sharedVars: {
        get: function () {
          return "en";
        },
      },
    },
    logger: quiet,
    configManager: {},
  });
  p.loadI18n();
  p.config = new VConfStub();
  p.config.set("powerEnabled", false); // no button in this test

  var endProbe;
  var fakeMcu = {
    i2c: { abortSettle: function () {} },
    firmware: "unknown",
    detect: function () {
      return new Promise(function (resolve) {
        endProbe = resolve;
      });
    },
    cancelDetect: function () {
      endProbe("unknown");
    }, // a cancelled probe ends without an answer
    setFanSpeed: async function () {},
  };
  p.i2c = { bus: 1 };
  p.i2cReady = function () {
    return true;
  };
  p.mcu = fakeMcu;
  p.fan = new FanController({
    mcu: fakeMcu,
    readTemp: function () {
      return 60;
    },
    getCurve: function () {
      return [{ temp: 55, speed: 100 }];
    },
    logger: quiet,
  });

  var applying = p.applyConfig();
  await sleep(20);
  await p.onStop(); // disabled while the probe is running: it is cancelled
  await applying;
  assert.strictEqual(
    p.fan.running,
    false,
    "the fan loop must not start after a stop",
  );
  assert.strictEqual(p.detecting, null);

  // the same sequence without a stop does start it
  fakeMcu.firmware = "legacy";
  await p.applyConfig();
  assert.strictEqual(
    p.fan.running,
    true,
    "control: the fan starts when the plugin was not stopped",
  );
  await p.onStop();
  assert.strictEqual(p.fan.running, false);
});

// The restore of the duty register is queued at the moment of the cancel, so an arm command
// queued right afterwards runs after it, whatever step the probe had in flight and without
// waiting for the probe to end.
test("argon: cancelDetect queues the duty restore ahead of anything queued after it", async function () {
  function rig(opMs, failGet) {
    var log = [];
    var reg = 40;
    var gets = 0;
    var exec = function (file, args, opts, cb) {
      var isGet = file.indexOf("i2cget") > -1;
      log.push(args.slice(2).join(" ") + (isGet ? " get" : " set"));
      var out = "";
      var err = null;
      if (isGet) {
        gets++;
        if (failGet && failGet(gets)) err = new Error("Read failed");
        else out = "0x" + reg.toString(16);
      } else if (args[3] === "0x80") {
        reg = parseInt(args[4], 16);
      }
      setTimeout(function () {
        cb(err, out, "");
      }, opMs);
    };
    var i2c = new I2c({ exec: exec });
    i2c._settle = function () {
      return Promise.resolve();
    };
    var mcu = new ArgonMcu(i2c);
    mcu.retryMs = 0;
    return {
      mcu: mcu,
      log: log,
      reg: function () {
        return reg;
      },
    };
  }
  function restores(log) {
    return log.filter(function (c) {
      return c === "0x1a 0x80 0x28 set";
    }).length;
  }

  // the probe write is in flight (60-120 ms) at the cancel (90 ms); the arm follows at once
  var a = rig(60);
  var probing = a.mcu.detect();
  await sleep(90);
  a.mcu.cancelDetect();
  var arming = a.mcu.armPowerOff(); // queued now, behind the restore
  await arming;
  assert.deepStrictEqual(
    a.log,
    [
      "0x1a 0x80 get",
      "0x1a 0x80 0x29 set",
      "0x1a 0x80 0x28 set",
      "0x1a 0xff set",
    ],
    "read, probe write, restore, arm: " + JSON.stringify(a.log),
  );
  assert.strictEqual(a.reg(), 40);
  assert.strictEqual(await probing, "unknown");
  assert.strictEqual(
    restores(a.log),
    1,
    "one restore only, the probe's own cancel path reuses it",
  );

  // the readback is in flight (120-180 ms) at the cancel: it shows the value stuck, and
  // the register result reuses the restore already queued
  var b = rig(60);
  var probingB = b.mcu.detect();
  await sleep(150);
  b.mcu.cancelDetect();
  await b.mcu.armPowerOff();
  assert.strictEqual(await probingB, "register");
  assert.deepStrictEqual(b.log, [
    "0x1a 0x80 get",
    "0x1a 0x80 0x29 set",
    "0x1a 0x80 get",
    "0x1a 0x80 0x28 set",
    "0x1a 0xff set",
  ]);
  assert.strictEqual(b.reg(), 40);

  // the first readback fails and the probe pauses before its retry: cancelled in the pause
  var c = rig(20, function (n) {
    return n === 2;
  });
  c.mcu.retryMs = 200;
  var probingC = c.mcu.detect();
  await sleep(120); // read, write and the failed readback are done (60 ms)
  c.mcu.cancelDetect();
  await c.mcu.armPowerOff();
  assert.strictEqual(await probingC, "unknown");
  assert.deepStrictEqual(c.log, [
    "0x1a 0x80 get",
    "0x1a 0x80 0x29 set",
    "0x1a 0x80 get",
    "0x1a 0x80 0x28 set",
    "0x1a 0xff set",
  ]);
  assert.strictEqual(c.reg(), 40);
  assert.strictEqual(restores(c.log), 1);

  // cancelled before any write was issued: nothing to restore
  var d = rig(60);
  var probingD = d.mcu.detect();
  await sleep(20); // the first read is in flight
  d.mcu.cancelDetect();
  await d.mcu.armPowerOff();
  assert.strictEqual(await probingD, "unknown");
  assert.deepStrictEqual(d.log, ["0x1a 0x80 get", "0x1a 0xff set"]);

  // not cancelled: the probe restores once, as before
  var e = rig(5);
  assert.strictEqual(await e.mcu.detect(), "register");
  assert.strictEqual(restores(e.log), 1);
  assert.strictEqual(e.reg(), 40);

  // a cancel with no probe running does nothing
  var f = rig(5);
  f.mcu.cancelDetect();
  assert.deepStrictEqual(f.log, []);
});

// A stop cancels a running probe without waiting for it; a start never joins or is
// disturbed by the previous start's probe.
test("lifecycle: stop cancels the probe, a later start probes on its own", async function () {
  var Plugin = require(path.join(ROOT, "index.js"));
  var quiet = {
    info: function () {},
    warn: function () {},
    error: function () {},
  };
  var p = new Plugin({
    coreCommand: {
      sharedVars: {
        get: function () {
          return "en";
        },
      },
    },
    logger: quiet,
    configManager: {},
  });
  p.loadI18n();
  p.config = new VConfStub();

  function fake(name) {
    var m = {
      name: name,
      firmware: "unknown",
      detects: 0,
      cancels: 0,
      finished: false,
      end: null,
      i2c: { abortSettle: function () {} },
      detect: function () {
        m.detects++;
        return new Promise(function (resolve) {
          m.end = resolve;
        });
      },
      // a cancelled probe takes a moment to wind down; the stop does not wait for it
      cancelDetect: function () {
        m.cancels++;
        setTimeout(function () {
          m.finished = true;
          m.end("unknown");
        }, 40);
      },
      setFanSpeed: async function () {},
    };
    return m;
  }

  // the old start's probe is running when the plugin is stopped
  var old = fake("old");
  p.mcu = old;
  p.fan = null;
  var oldProbe = p.ensureFirmware();
  var t0 = Date.now();
  await p.onStop();
  assert.strictEqual(old.cancels, 1, "the running probe is cancelled");
  assert.strictEqual(
    old.finished,
    false,
    "stop does not wait for the cancelled probe",
  );
  assert.ok(Date.now() - t0 < 30);
  assert.strictEqual(p.detecting, null);
  assert.strictEqual(await oldProbe, "unknown");
  assert.strictEqual(old.finished, true);

  // nothing running: a stop cancels nothing
  var idle = fake("idle");
  p.mcu = idle;
  await p.onStop();
  assert.strictEqual(idle.cancels, 0);

  // an old probe that is still pending when the next start begins is not joined, and
  // finishing later does not clear the new probe
  var first = fake("first");
  p.mcu = first;
  var firstProbe = p.ensureFirmware();
  var second = fake("second");
  p.mcu = second;
  p.detecting = null; // what onStart does for a new MCU
  var secondProbe = p.ensureFirmware();
  assert.strictEqual(second.detects, 1, "the new MCU gets its own probe");
  first.end("legacy");
  await firstProbe;
  assert.ok(
    p.detecting,
    "the old probe finishing leaves the new probe registered",
  );
  assert.strictEqual(
    p.ensureFirmware(),
    secondProbe,
    "and it is joined, not repeated",
  );
  assert.strictEqual(second.detects, 1);
  second.end("register");
  assert.strictEqual(await secondProbe, "register");
  assert.strictEqual(p.detecting, null);

  // onStart forgets a probe of the previous start
  p.config.set("powerEnabled", false);
  p.detecting = new Promise(function () {});
  await p.onStart();
  assert.strictEqual(
    p.detecting,
    null,
    "start clears the previous start's probe",
  );
  await p.onStop();
});

// One I2C queue for the plugin's lifetime: a stop and start while a probe step is in
// flight must not let the old operations overlap the new probe's.
test("lifecycle: a stop/start during a slow probe shares the I2C queue and never overlaps", async function () {
  var Plugin = require(path.join(ROOT, "index.js"));
  var quiet = {
    info: function () {},
    warn: function () {},
    error: function () {},
  };
  var log = [];
  var active = 0;
  var maxActive = 0;
  var reg = 40;
  var exec = function (file, args, opts, cb) {
    var isGet = file.indexOf("i2cget") > -1;
    active++;
    maxActive = Math.max(maxActive, active);
    log.push(args.slice(2).join(" ") + (isGet ? " get" : " set"));
    var out = "";
    if (isGet) out = "0x" + reg.toString(16);
    else if (args[3] === "0x80") reg = parseInt(args[4], 16);
    setTimeout(function () {
      active--;
      cb(null, out, "");
    }, 60);
  };
  var i2c = new I2c({ exec: exec });
  i2c._settle = function () {
    return Promise.resolve();
  };

  var p = new Plugin({
    coreCommand: {
      sharedVars: {
        get: function () {
          return "en";
        },
      },
    },
    logger: quiet,
    configManager: {},
  });
  p.config = new VConfStub();
  p.config.set("powerEnabled", false); // no button in this test
  p.i2c = i2c;
  p.i2cReady = function () {
    return true;
  };

  var realTemp = Platform.readCpuTemp;
  var realServices = Platform.readActiveArgonServices;
  Platform.readCpuTemp = function () {
    return 40;
  };
  Platform.readActiveArgonServices = function () {
    return Promise.resolve([]);
  };
  try {
    await p.onStart(); // probe 1: read 0-60 ms, write 60-120 ms
    var firstMcu = p.mcu;
    await sleep(90); // the probe write is in flight
    await p.onStop(); // cancel: the restore is queued behind the write
    assert.strictEqual(
      p.i2c,
      i2c,
      "the I2C object (and its queue) survives the stop",
    );
    await p.onStart(); // probe 2, queued behind the restore
    assert.strictEqual(p.i2c, i2c, "and is shared by the next start");
    assert.notStrictEqual(
      p.mcu,
      firstMcu,
      "each start has its own MCU object (and probes again)",
    );
    await sleep(700);
    await p.onStop();

    assert.deepStrictEqual(
      log.slice(0, 7),
      [
        "0x1a 0x80 get",
        "0x1a 0x80 0x29 set", // probe 1, up to the cancel
        "0x1a 0x80 0x28 set", // its restore, queued at the cancel
        "0x1a 0x80 get",
        "0x1a 0x80 0x29 set",
        "0x1a 0x80 get",
        "0x1a 0x80 0x28 set", // probe 2, complete
      ],
      JSON.stringify(log),
    );
    assert.strictEqual(maxActive, 1, "never two I2C commands at once");
    assert.strictEqual(
      firstMcu.firmware,
      "unknown",
      "the cancelled probe gave no answer",
    );
  } finally {
    Platform.readCpuTemp = realTemp;
    Platform.readActiveArgonServices = realServices;
  }
  assert.strictEqual(
    p.mcu.firmware,
    "register",
    "the second probe, run after the restore, found the register firmware",
  );
});

// Argon's own service running next to the plugin is warned about in the log.
test("platform: parsing of systemctl is-active, and the start-up warning", async function () {
  var parse = Platform.parseActiveUnits;
  var units = ["argononed", "argononeoledd"];
  assert.deepStrictEqual(parse("active\ninactive\n", units), ["argononed"]);
  assert.deepStrictEqual(parse("inactive\nactive\n", units), ["argononeoledd"]);
  assert.deepStrictEqual(parse("active\nactive\n", units), units);
  assert.deepStrictEqual(parse("inactive\ninactive\n", units), []);
  assert.deepStrictEqual(parse("inactive\nunknown\n", units), []);
  assert.deepStrictEqual(parse("", units), []);
  assert.deepStrictEqual(parse(undefined, units), []);
  assert.deepStrictEqual(Platform.ARGON_SERVICES, units);

  // the check itself: the output decides, the exit status does not; a failed check rejects
  function sys(err, stdout, stderr) {
    return function (file, args, opts, cb) {
      assert.strictEqual(file, "systemctl");
      assert.deepStrictEqual(args, ["is-active", "argononed", "argononeoledd"]);
      setImmediate(function () {
        cb(err, stdout, stderr || "");
      });
    };
  }
  function exit(code) {
    var e = new Error("Command failed");
    e.code = code;
    return e;
  }
  assert.deepStrictEqual(
    await Platform.readActiveArgonServices(sys(null, "active\ninactive\n")),
    ["argononed"],
  );
  assert.deepStrictEqual(
    await Platform.readActiveArgonServices(sys(exit(3), "inactive\nactive\n")),
    ["argononeoledd"],
    "a non-zero exit with the states on stdout is a result",
  );
  assert.deepStrictEqual(
    await Platform.readActiveArgonServices(
      sys(exit(3), "inactive\ninactive\n"),
    ),
    [],
    'none running (exit 3) is a successful "none"',
  );
  assert.deepStrictEqual(
    await Platform.readActiveArgonServices(sys(exit(3), "inactive\nunknown\n")),
    [],
  );
  var spawnErr = new Error("spawn systemctl ENOENT");
  spawnErr.code = "ENOENT";
  await assert.rejects(
    Platform.readActiveArgonServices(sys(spawnErr, "")),
    /ENOENT/,
  );
  var killed = new Error("timed out");
  killed.killed = true;
  killed.code = null;
  await assert.rejects(
    Platform.readActiveArgonServices(sys(killed, "")),
    /timed out/,
  );
  await assert.rejects(
    Platform.readActiveArgonServices(
      sys(exit(1), "", "System has not been booted with systemd"),
    ),
    /unexpected output.*exit 1.*not been booted/,
  );
  await assert.rejects(
    Platform.readActiveArgonServices(sys(null, "active\n")),
    /unexpected output/,
    "one state for two units",
  );
  await assert.rejects(
    Platform.readActiveArgonServices(sys(null, "")),
    /unexpected output/,
  );

  var Plugin = require(path.join(ROOT, "index.js"));
  var warns = [];
  var logger = {
    info: function () {},
    warn: function (m) {
      warns.push(m);
    },
    error: function () {},
  };
  var p = new Plugin({
    coreCommand: {
      sharedVars: {
        get: function () {
          return "en";
        },
      },
    },
    logger: logger,
    configManager: {},
  });
  var real = Platform.readActiveArgonServices;
  try {
    Platform.readActiveArgonServices = function () {
      return Promise.resolve([]);
    };
    await p.warnIfArgonServiceActive();
    assert.deepStrictEqual(warns, [], "nothing running, nothing logged");

    Platform.readActiveArgonServices = function () {
      return Promise.resolve(["argononed"]);
    };
    await p.warnIfArgonServiceActive();
    assert.strictEqual(warns.length, 1);
    assert.ok(
      /Argon's own service is running \(argononed\)/.test(warns[0]),
      warns[0],
    );
    assert.ok(
      /sudo systemctl disable --now argononed/.test(warns[0]),
      warns[0],
    );

    warns.length = 0;
    Platform.readActiveArgonServices = function () {
      return Promise.resolve(["argononed", "argononeoledd"]);
    };
    await p.warnIfArgonServiceActive();
    assert.ok(/disable --now argononed argononeoledd/.test(warns[0]), warns[0]);

    // a failure in the check never propagates
    warns.length = 0;
    Platform.readActiveArgonServices = function () {
      return Promise.reject(new Error("no systemd"));
    };
    await p.warnIfArgonServiceActive();
    assert.ok(
      /could not check.*no systemd/.test(warns[0]),
      JSON.stringify(warns),
    );

    // onStart runs the check
    warns.length = 0;
    Platform.readActiveArgonServices = function () {
      return Promise.resolve(["argononed"]);
    };
    p.config = new VConfStub();
    p.config.set("powerEnabled", false);
    await p.onStart();
    await sleep(20);
    assert.ok(
      warns.some(function (m) {
        return /Argon's own service is running/.test(m);
      }),
      JSON.stringify(warns),
    );
    await p.onStop();
  } finally {
    Platform.readActiveArgonServices = real;
  }
});

// The arm command depends on the firmware: a shutdown that overlaps the start-up probe
// waits for it (for a limited time) instead of arming with the legacy byte.
test("shutdown: waits for the firmware probe before arming the case", async function () {
  var Plugin = require(path.join(ROOT, "index.js"));
  var boot = tmpdir();
  fs.writeFileSync(path.join(boot, "config.txt"), "enable_uart=1\n");
  var realRuntime = Platform.readUartRuntime;
  Platform.readUartRuntime = function () {
    return Promise.resolve("active");
  };

  function rig(firmware, detect) {
    var warns = [];
    var armed = [];
    var logger = {
      info: function () {},
      warn: function (m) {
        warns.push(m);
      },
      error: function () {},
    };
    var p = new Plugin({
      coreCommand: {
        sharedVars: {
          get: function () {
            return "en";
          },
        },
      },
      logger: logger,
      configManager: {},
    });
    p.loadI18n();
    p.config = new VConfStub();
    p.config.set("powerEnabled", true);
    p.config.set("uartSignal", true);
    p.uartOpts = function () {
      return { pi5: false, tag: "pi4", bootDir: boot };
    };
    p.i2cReady = function () {
      return true;
    };
    p.fan = null;
    p.mcu = {
      firmware: firmware,
      detects: 0,
      cancels: 0,
      detect: function () {
        p.mcu.detects++;
        return detect(p.mcu);
      },
      cancelDetect: function () {
        p.mcu.cancels++;
      },
      armPowerOff: async function () {
        armed.push(p.mcu.firmware);
      },
    };
    return { p: p, warns: warns, armed: armed };
  }

  try {
    // the probe is still running when the shutdown starts: arming waits for its answer
    var finish;
    var a = rig("unknown", function (mcu) {
      return new Promise(function (resolve) {
        finish = function () {
          mcu.firmware = "register";
          resolve("register");
        };
      });
    });
    var running = a.p.ensureFirmware(); // the start-up probe, in flight
    var shut = a.p.onVolumioShutdown();
    await sleep(30);
    assert.deepStrictEqual(a.armed, [], "not armed while the probe is running");
    finish();
    await shut;
    await running;
    assert.deepStrictEqual(
      a.armed,
      ["register"],
      "armed once, with the probed firmware",
    );
    assert.strictEqual(
      a.p.mcu.detects,
      1,
      "the running probe was joined, not repeated",
    );
    assert.deepStrictEqual(a.warns, []);

    // the probe never answers: arm after the wait limit, with a warning
    var b = rig("unknown", function () {
      return new Promise(function () {});
    });
    b.p.firmwareWaitMs = 40;
    var t0 = Date.now();
    await b.p.onVolumioShutdown();
    assert.deepStrictEqual(
      b.armed,
      ["unknown"],
      "armed with the unprobed (legacy) command",
    );
    assert.ok(
      Date.now() - t0 >= 35 && Date.now() - t0 < 1000,
      "waited the limit, and not for the cancelled probe to end",
    );
    assert.ok(
      b.warns.some(function (m) {
        return /still unknown/.test(m);
      }),
      JSON.stringify(b.warns),
    );
    assert.strictEqual(
      b.p.mcu.cancels,
      1,
      "the probe is cancelled when the wait runs out",
    );
    assert.strictEqual(
      a.p.mcu.cancels,
      0,
      "not cancelled when it answered in time",
    );

    // the probe rejects: arm anyway, with a warning
    var c = rig("unknown", function () {
      return Promise.reject(new Error("bus gone"));
    });
    await c.p.onVolumioShutdown();
    assert.deepStrictEqual(c.armed, ["unknown"]);
    assert.ok(
      c.warns.some(function (m) {
        return /probe failed at shutdown \(bus gone\)/.test(m);
      }),
      JSON.stringify(c.warns),
    );

    // firmware already known: no probe, no wait
    var d = rig("legacy", function () {
      throw new Error("must not probe");
    });
    await d.p.onVolumioShutdown();
    assert.deepStrictEqual(d.armed, ["legacy"]);
    assert.strictEqual(d.p.mcu.detects, 0);
    assert.deepStrictEqual(d.warns, []);

    // nothing armed when the signal setting is off, and no probe either
    var e = rig("unknown", function () {
      throw new Error("must not probe");
    });
    e.p.config.set("uartSignal", false);
    await e.p.onVolumioShutdown();
    assert.deepStrictEqual(e.armed, []);
    assert.strictEqual(e.p.mcu.detects, 0);
  } finally {
    Platform.readUartRuntime = realRuntime;
  }
});

// The same with the real I2C queue: a probe that outlasts the wait limit is cancelled,
// puts the duty register back, and the arm command is the last thing on the bus.
test("shutdown: a probe cancelled at the wait limit restores the duty, then the arm command goes last", async function () {
  var Plugin = require(path.join(ROOT, "index.js"));
  var boot = tmpdir();
  fs.writeFileSync(path.join(boot, "config.txt"), "enable_uart=1\n");
  var realRuntime = Platform.readUartRuntime;
  Platform.readUartRuntime = function () {
    return Promise.resolve("active");
  };

  // a register-firmware case behind a bus that takes opMs for every command
  // failWrite(args) -> true makes that write fail (it is not applied)
  function rig(opMs, failWrite) {
    var log = [];
    var reg = 40;
    var warns = [];
    var logger = {
      info: function () {},
      warn: function (m) {
        warns.push(m);
      },
      error: function () {},
    };
    var exec = function (file, args, opts, cb) {
      log.push(
        args.slice(2).join(" ") +
          (file.indexOf("i2cget") > -1 ? " get" : " set"),
      );
      var out = "";
      var err = null;
      if (file.indexOf("i2cget") > -1) out = "0x" + reg.toString(16);
      else if (failWrite && failWrite(args)) err = new Error("Write failed");
      else if (args[3] === "0x80") reg = parseInt(args[4], 16);
      setTimeout(function () {
        cb(err, out, "");
      }, opMs);
    };
    var i2c = new I2c({ exec: exec });
    i2c._settle = function () {
      return Promise.resolve();
    };
    var mcu = new ArgonMcu(i2c, logger);
    mcu.retryMs = 0;
    var p = new Plugin({
      coreCommand: {
        sharedVars: {
          get: function () {
            return "en";
          },
        },
      },
      logger: logger,
      configManager: {},
    });
    p.loadI18n();
    p.config = new VConfStub();
    p.config.set("powerEnabled", true);
    p.config.set("uartSignal", true);
    p.uartOpts = function () {
      return { pi5: false, tag: "pi4", bootDir: boot };
    };
    p.i2cReady = function () {
      return true;
    };
    p.fan = null;
    p.i2c = i2c;
    p.mcu = mcu;
    return {
      p: p,
      mcu: mcu,
      log: log,
      warns: warns,
      reg: function () {
        return reg;
      },
    };
  }

  try {
    // slow bus: the wait (100 ms) ends while the probe's write (60-120 ms) is in flight
    var a = rig(60);
    var probing = a.p.ensureFirmware();
    a.p.firmwareWaitMs = 100;
    await a.p.onVolumioShutdown();
    var atArm = a.log.slice();
    assert.deepStrictEqual(
      atArm,
      [
        "0x1a 0x80 get",
        "0x1a 0x80 0x29 set",
        "0x1a 0x80 0x28 set",
        "0x1a 0xff set",
      ],
      "the step in flight finished, the duty went back, then the arm byte: " +
        JSON.stringify(atArm),
    );
    assert.strictEqual(
      a.reg(),
      40,
      "the duty register is back at its original value (0x28)",
    );
    await probing;
    await sleep(250); // time enough for the rest of the probe
    assert.deepStrictEqual(
      a.log,
      atArm,
      "no probe step followed the arm command",
    );
    assert.strictEqual(
      a.mcu.firmware,
      "unknown",
      "a cancelled probe gives no answer",
    );
    assert.ok(
      a.warns.some(function (m) {
        return /probe cancelled/.test(m);
      }),
      JSON.stringify(a.warns),
    );
    assert.ok(
      !a.warns.some(function (m) {
        return /could not restore/.test(m);
      }),
      JSON.stringify(a.warns),
    );

    // the restore write fails: warned about, the arm command still goes out last
    var f = rig(60, function (args) {
      return args[3] === "0x80" && args[4] === "0x28";
    });
    f.p.firmwareWaitMs = 100;
    await f.p.onVolumioShutdown();
    assert.deepStrictEqual(f.log, [
      "0x1a 0x80 get",
      "0x1a 0x80 0x29 set",
      "0x1a 0x80 0x28 set",
      "0x1a 0xff set",
    ]);
    assert.ok(
      f.warns.some(function (m) {
        return /could not restore.*Write failed/.test(m);
      }),
      JSON.stringify(f.warns),
    );
    assert.strictEqual(
      f.reg(),
      41,
      "the failed restore leaves the probe value, which is only warned about",
    );

    // the wait ends before the probe has written anything: nothing to put back
    var g = rig(60);
    g.p.firmwareWaitMs = 30; // while the first read (0-60 ms) is in flight
    await g.p.onVolumioShutdown();
    assert.deepStrictEqual(
      g.log,
      ["0x1a 0x80 get", "0x1a 0xff set"],
      "no write, so no restore",
    );
    assert.strictEqual(g.reg(), 40);

    // fast bus: the probe answers in time, the arm command is the register one
    var b = rig(5);
    await b.p.onVolumioShutdown();
    assert.strictEqual(b.mcu.firmware, "register");
    assert.deepStrictEqual(b.log, [
      "0x1a 0x80 get",
      "0x1a 0x80 0x29 set",
      "0x1a 0x80 get",
      "0x1a 0x80 0x28 set",
      "0x1a 0x86 0x01 set",
    ]);
    assert.deepStrictEqual(b.warns, []);
  } finally {
    Platform.readUartRuntime = realRuntime;
  }
});

test("argon: a cancelled probe queues nothing more and gives no answer", async function () {
  var log = [];
  var i2c = new I2c({
    exec: fakeExec(log, function (f) {
      return { out: f.indexOf("i2cget") > -1 ? "0x28" : "" };
    }),
  });
  i2c._settle = function () {
    return Promise.resolve();
  };
  var mcu = new ArgonMcu(i2c);
  var running = mcu.detect();
  mcu.cancelDetect(); // the first read is already queued
  assert.strictEqual(await running, "unknown");
  assert.strictEqual(mcu.firmware, "unknown");
  assert.strictEqual(log.length, 1, "only the read that was already queued");

  // detect() after a cancel starts clean
  assert.strictEqual(
    await mcu.detect(),
    "legacy",
    "the cancel flag does not outlive the probe it stopped",
  );
});

// The one-action-at-a-time latch must not outlive the running plugin, and a stale
// timer must not release a later latch.
test("button action latch: freed by stop/start, and by a failed action without a stale timer", async function () {
  var calls = { shutdown: 0, reboot: 0 };
  var failReboot = false;
  var router = {
    sharedVars: {
      get: function () {
        return "en";
      },
    },
    pushToastMessage: function () {},
    reboot: function () {
      if (failReboot) throw new Error("refused");
      calls.reboot++;
    },
    volumioRestart: function () {},
    shutdown: function () {
      calls.shutdown++;
    },
  };
  var quiet = {
    info: function () {},
    warn: function () {},
    error: function () {},
  };
  var Plugin = require(path.join(ROOT, "index.js"));
  var p = new Plugin({ coreCommand: router, logger: quiet, configManager: {} });
  p.loadI18n();
  p.config = new VConfStub();
  p.config.set("powerEnabled", false); // no button watch: presses are fed in directly

  // a hold sets the latch; a second press is ignored
  p.handlePress("shutdown", 40);
  assert.strictEqual(calls.shutdown, 1);
  assert.strictEqual(p.actionInFlight, true);
  p.handlePress("shutdown", 40);
  assert.strictEqual(calls.shutdown, 1, "ignored while the latch is set");

  // stop and start on the same instance: the latch and its timer are gone
  await p.onStop();
  assert.strictEqual(p.actionInFlight, false, "stop frees the latch");
  assert.strictEqual(p.actionTimer, null, "stop cancels the timer");
  p.handlePress("shutdown", 40);
  assert.strictEqual(p.actionInFlight, true);
  await p.onStart(); // start frees it too
  assert.strictEqual(p.actionInFlight, false, "start frees the latch");
  assert.strictEqual(p.actionTimer, null);
  p.handlePress("shutdown", 40);
  assert.strictEqual(calls.shutdown, 3, "presses work again after stop/start");
  await p.onStop();

  // an action that throws frees the latch and cancels its timer
  p.actionLatchMs = 60;
  failReboot = true;
  p.handlePress("reboot", 20);
  assert.strictEqual(
    p.actionInFlight,
    false,
    "a failed action frees the latch",
  );
  assert.strictEqual(p.actionTimer, null);
  // A later action sets a fresh 60 ms latch. The failed press's timer, had it been
  // left running, would fire 60 ms after the failure, i.e. 30 ms before this latch's
  // own timer, and release it early: so look in between.
  await sleep(30);
  failReboot = false;
  p.handlePress("reboot", 20);
  assert.strictEqual(calls.reboot, 1);
  await sleep(45); // 75 ms after the failure, 45 ms into the new latch
  p.handlePress("reboot", 20);
  assert.strictEqual(
    calls.reboot,
    1,
    "the new latch is not released by the failed press's timer",
  );
  await sleep(40); // the new latch's own timer has fired by now
  assert.strictEqual(p.actionInFlight, false, "the latch times out on its own");
  p.releaseActionLatch();
});

test("button app restart: uses systemd rather than router or CLI restart methods", async function () {
  var logged = [];
  var invocation;
  var finishExec;
  var routerRestartCalls = 0;
  var router = {
    sharedVars: { get: function () { return "en"; } },
    pushToastMessage: function () {},
    volumioRestart: function () { routerRestartCalls++; },
    reboot: function () { throw new Error("must not reboot the system"); },
    shutdown: function () { throw new Error("must not shut down"); },
  };
  var Plugin = require(path.join(ROOT, "index.js"));
  var p = new Plugin({
    coreCommand: router,
    logger: {
      info: function () {},
      warn: function () {},
      error: function (m) { logged.push(m); },
    },
    configManager: {},
    execFile: function (file, args, opts, cb) {
      invocation = [file, args, opts];
      finishExec = cb;
    },
  });
  p.loadI18n();
  p.config = new VConfStub();
  p.config.set("powerEnabled", false);
  p.config.set("powerDoubleTap", "restart");
  p.actionLatchMs = 60000;

  p.handlePress("reboot", 20.1);
  assert.deepStrictEqual(invocation, [
    "sudo",
    ["-n", "/bin/systemctl", "restart", "volumio.service"],
    { timeout: 15000 },
  ]);
  assert.strictEqual(routerRestartCalls, 0, "router restart methods are bypassed");
  assert.strictEqual(p.actionInFlight, true, "the action remains latched until systemd completes");

  var failure = new Error("command unavailable");
  finishExec(failure, "", "not found");
  assert.ok(logged.some(function (m) {
    return /Volumio app restart failed: command unavailable.*not found/.test(m);
  }), JSON.stringify(logged));
  assert.strictEqual(p.actionInFlight, false, "a CLI failure releases the action latch");
  p.releaseActionLatch();
});

// A failure while building the settings page is logged (not just passed on to Volumio).
test("settings page: a failure is logged and passed on", async function () {
  var Plugin = require(path.join(ROOT, "index.js"));
  var logged = [];
  var logger = {
    info: function () {},
    warn: function () {},
    error: function (m) {
      logged.push(m);
    },
  };
  var router = {
    sharedVars: {
      get: function () {
        return "en";
      },
    },
    i18nJson: function () {
      return {
        then: function (ok, fail) {
          return Promise.reject(new Error("boom")).then(ok, fail);
        },
      };
    },
  };
  var p = new Plugin({
    coreCommand: router,
    logger: logger,
    configManager: {},
  });
  p.loadI18n();
  p.config = new VConfStub();

  var failure = null;
  try {
    await p.getUIConfig();
  } catch (e) {
    failure = e;
  }
  assert.ok(
    failure && /boom/.test(failure.message),
    "the error reaches the caller",
  );
  assert.deepStrictEqual(logged, [
    "[Argon ONE Power & Fan] Failed to build the settings page: boom",
  ]);
});

// ---------------------------------------------------------------------------

(async function main() {
  for (var i = 0; i < pending.length; i++) {
    var t = pending[i];
    try {
      await t.fn();
      passed++;
      console.log("ok   - " + t.name);
    } catch (e) {
      failed++;
      console.log("FAIL - " + t.name);
      console.log("       " + ((e && e.stack) || e));
    }
  }
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
