"use strict";

/**
 * Argon ONE Power & Fan (beta) - Volumio 4 plugin
 *
 * Power: case power button on GPIO4 (double tap = reboot, hold = shutdown) and
 * optional arming of the case MCU for UART power-off (needs the UART).
 * Fan: CPU-temperature fan control that mimics Argon's argononed.py.
 *
 * The case MCU is at I2C 0x1a. No Python, no apt packages, no sudo.
 */

const fs = require("fs");
const path = require("path");
const execFile = require("child_process").execFile;

// kew and v-conf come from Volumio itself (as other plugins do).
function requireVolumio(name) {
  try {
    return require(`/volumio/node_modules/${name}`);
  } catch {
    return require(name);
  }
}
const libQ = requireVolumio("kew");
const VConf = requireVolumio("v-conf");

const Platform = require("./lib/platform");
const I2c = require("./lib/i2c");
const ArgonMcu = require("./lib/argon");
const FanController = require("./lib/fan");
const PowerButton = require("./lib/button");
const UartConfig = require("./lib/uartconfig");

// Log prefix "[Argon ONE Power & Fan] ", used by log() below.
const LOG_PREFIX = require("./lib/constants").LOG_PREFIX;

const ENDPOINT = "system_hardware/argon_one_power_fan";
const BOOT_DIR = "/boot";
const ACTION_LATCH_MS = 60000;
const FIRMWARE_WAIT_MS = 5000; // longest a shutdown waits for the firmware probe

module.exports = ArgonOnePowerFanController;

// Bridges between native promises and kew promises (Volumio expects kew).
function fromPromise(p) {
  const d = libQ.defer();
  p.then(
    function (v) {
      d.resolve(v);
    },
    function (e) {
      d.reject(e);
    },
  );
  return d.promise;
}
function toNative(kewPromise) {
  return new Promise(function (resolve, reject) {
    kewPromise.then(resolve, reject);
  });
}
function isTrue(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// Limits and defaults for the fan settings, shared by the save handler (validates
// user input) and the readers (stored values outside the limits, e.g. from a manual
// edit of config.json, fall back to the defaults).
// config.json and the values in UIConfig.json hold their own copies of these defaults
// (static JSON cannot reference this constant), and the cfgBool() calls in this file
// repeat the other config.json defaults. Keep them in sync by hand; the self-test
// "defaults: ..." fails when they differ.
const FAN_BOUNDS = { temp: { min: 0, max: 100 }, speed: { min: 0, max: 100 } };
const FAN_DEFAULTS = { t1: 55, s1: 30, t2: 60, s2: 55, t3: 65, s3: 100 };

// The config key of a fan value: 't1' -> 'fanT1'.
function fanKey(k) {
  return "fan" + k.toUpperCase();
}

// A whole number from user input or config: '55' and 55 pass, '' and '55.5' and '5x' give NaN.
function wholeNumber(v) {
  if (v === undefined || v === null) return NaN;
  const s = String(v).trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}

function inBounds(n, b) {
  return Number.isInteger(n) && n >= b.min && n <= b.max;
}

// Temperatures strictly rising, speeds not falling as the temperature rises.
function curveOrdered(v) {
  return v.t1 < v.t2 && v.t2 < v.t3 && v.s1 <= v.s2 && v.s2 <= v.s3;
}

function ArgonOnePowerFanController(context) {
  const self = this;

  self.context = context;
  self.commandRouter = context.coreCommand;
  self.logger = context.logger;
  self.configManager = context.configManager;
  self.execFile = context.execFile || execFile;

  self.model = "";
  self.pi5 = false;
  self.tag = "other";

  self.i2c = null;
  self.mcu = null;
  self.fan = null;
  self.button = null;
  self.gpiox = null;
  self.buttonError = null;

  self.detecting = null;
  self.actionInFlight = false;
  self.actionTimer = null;
  self.actionLatchMs = ACTION_LATCH_MS; // an instance value so a test can shorten it
  self.firmwareWaitMs = FIRMWARE_WAIT_MS; // likewise
  self.shuttingDown = false;

  // Goes up on every onStart and onStop. applyConfig() waits for the case firmware
  // probe (a few seconds on the first run); if the plugin is stopped or restarted
  // in the meantime, the generation it noted at the beginning no longer matches
  // and it must not start the fan loop for a plugin that is no longer running.
  self.lifecycleGeneration = 0;

  self.i18nStrings = {};
  self.i18nDefaults = {};
}

// ---------------------------------------------------------------------------
// Volumio lifecycle
// ---------------------------------------------------------------------------

ArgonOnePowerFanController.prototype.onVolumioStart = function () {
  const self = this;
  self.configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context,
    "config.json",
  );
  self.config = new VConf();
  self.config.loadFile(self.configFile);
  return libQ.resolve();
};

ArgonOnePowerFanController.prototype.onStart = function () {
  const self = this;

  self.shuttingDown = false;
  self.releaseActionLatch();
  self.lifecycleGeneration++;
  self.loadI18n();
  self.model = Platform.readModel();
  self.pi5 = Platform.isPi5(self.model);
  self.tag = Platform.modelTag(self.model);
  self.log(`starting on "${self.model || "unknown model"}"`);

  // One I2C queue for the life of the plugin, not one per start: a stop/start must not
  // let the old start's last operation (or a cancelled probe's restore) overlap the new
  // start's, so everything that talks to the case goes through the same queue.
  if (!self.i2c) self.i2c = new I2c({ logger: self.logger });
  self.mcu = new ArgonMcu(self.i2c, self.logger);
  self.detecting = null; // a probe of the previous start belongs to the old MCU
  self.fan = new FanController({
    mcu: self.mcu,
    readTemp: Platform.readCpuTemp,
    getCurve: function () {
      return self.getCurve();
    },
    logger: self.logger,
  });

  self.logUartStatus();
  self.warnIfArgonServiceActive();

  // Do not hold up Volumio's start-up: the firmware probe takes a few seconds.
  self.applyConfig().catch(function (e) {
    self.log(`start failed: ${e && e.message}`, "error");
  });

  return libQ.resolve();
};

ArgonOnePowerFanController.prototype.onStop = function () {
  const self = this;
  self.lifecycleGeneration++;
  self.stopButton();
  self.releaseActionLatch();

  // A firmware probe still running is cancelled: it queues no more steps, and its restore
  // of the duty register is already in the I2C queue, which the next start shares, so
  // that start's probe runs after it. Nothing here needs to wait for the probe.
  if (self.mcu && self.detecting) self.mcu.cancelDetect();
  self.detecting = null;

  const p = self.fan
    ? self.fan.stop({ final: self.cfgBool("fanEnabled", true) })
    : Promise.resolve();
  return fromPromise(p.catch(function () {}));
};

ArgonOnePowerFanController.prototype.onVolumioShutdown = function () {
  const self = this;
  self.log("Volumio shutdown");
  self.shuttingDown = true;
  self.stopButton();

  const work = (async function () {
    if (self.fan) await self.fan.stop({ final: false });

    const signalOn =
      self.cfgBool("powerEnabled", true) && self.cfgBool("uartSignal", false);
    if (!signalOn) return;
    if (!self.i2cReady()) {
      self.log("case not armed for power-off: I2C not available", "warn");
      return;
    }
    const runtime = await Platform.readUartRuntime(self.pi5);
    const fileState = UartConfig.scan(self.uartOpts()).state;
    const fileOn =
      fileState === "managed" ||
      fileState === "foreign" ||
      fileState === "both";
    if (!(runtime === "active" || (runtime === "unknown" && fileOn))) {
      self.log(
        `case not armed for power-off: UART not active (${runtime}, ${fileState})`,
        "warn",
      );
      return;
    }
    await self.waitForFirmware();
    await self.mcu.armPowerOff();
    self.log(`case armed for power-off (${self.mcu.firmware} firmware)`);
  })();

  return fromPromise(
    work.catch(function (e) {
      self.log(`shutdown handling failed: ${e && e.message}`, "error");
    }),
  );
};

// Resolves with the promise's value, or with TIMED_OUT after ms (the timer is cleared).
const TIMED_OUT = { timedOut: true };
function raceTimeout(promise, ms) {
  let timer;
  const limit = new Promise(function (resolve) {
    timer = setTimeout(function () {
      resolve(TIMED_OUT);
    }, ms);
  });
  return Promise.race([promise, limit]).finally(function () {
    clearTimeout(timer);
  });
}

// The arming command depends on the case firmware. If the start-up probe is still
// running (or never ran), wait for it, but not for long: a shutdown must not hang on
// I2C. Never rejects. Without an answer the probe is cancelled: it queues no more probe
// steps, and cancelDetect() queues the restore of the fan duty register right away if
// the probe had written to it. The arm command is queued after that, so it is the last
// thing on the bus without waiting for the probe to wind down. It falls back to the
// legacy byte, which is what an unprobed case gets.
ArgonOnePowerFanController.prototype.waitForFirmware = async function () {
  const self = this;
  try {
    if (
      (await raceTimeout(self.ensureFirmware(), self.firmwareWaitMs)) !==
      TIMED_OUT
    )
      return;

    self.mcu.cancelDetect();
    self.log(
      `firmware still unknown after ${self.firmwareWaitMs} ms at shutdown, probe cancelled, arming with the legacy command`,
      "warn",
    );
  } catch (e) {
    self.log(
      `firmware probe failed at shutdown (${e && e.message}), arming with the legacy command`,
      "warn",
    );
  }
};

// A reboot must never arm the case (it would cut power mid-reboot).
ArgonOnePowerFanController.prototype.onVolumioReboot = function () {
  const self = this;
  self.log("Volumio reboot");
  self.shuttingDown = true;
  self.stopButton();
  const p = self.fan ? self.fan.stop({ final: false }) : Promise.resolve();
  return fromPromise(p.catch(function () {}));
};

// Output to the log with the plugin name in front, e.g.
// "[Argon ONE Power & Fan] pulse 41.0 ms (shutdown)". Info unless level is
// 'warn' or 'error'.
ArgonOnePowerFanController.prototype.log = function (s, level) {
  const self = this;
  self.logger[level || "info"](LOG_PREFIX + s);
};

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

ArgonOnePowerFanController.prototype.cfgBool = function (key, def) {
  const v = this.config ? this.config.get(key) : undefined;
  if (v === undefined || v === null) return def;
  return isTrue(v);
};

ArgonOnePowerFanController.prototype.cfgInt = function (key, def) {
  const v = this.config ? parseInt(this.config.get(key), 10) : NaN;
  return isNaN(v) ? def : v;
};

// On/off mode (default): one threshold, the case only ever gets 0 or 100.
// Speed steps mode: the three configured threshold and speed pairs.
ArgonOnePowerFanController.prototype.getCurve = function () {
  let v = this.fanValues();
  if (!this.cfgBool("fanSpeedSteps", false)) {
    return [{ temp: v.t1, speed: 100 }];
  }
  if (!curveOrdered(v)) {
    this.warnBadFanConfig("stored thresholds are out of order");
    v = FAN_DEFAULTS;
  }
  return [
    { temp: v.t1, speed: v.s1 },
    { temp: v.t2, speed: v.s2 },
    { temp: v.t3, speed: v.s3 },
  ];
};

// The stored fan values; one outside its limits falls back to the default.
ArgonOnePowerFanController.prototype.fanValues = function () {
  const self = this;
  const v = {};
  Object.keys(FAN_DEFAULTS).forEach(function (k) {
    const n = self.config ? wholeNumber(self.config.get(fanKey(k))) : NaN;
    const kind = k.charAt(0) === "t" ? "temp" : "speed";
    if (inBounds(n, FAN_BOUNDS[kind])) {
      v[k] = n;
    } else {
      self.warnBadFanConfig(`stored ${fanKey(k)} is out of range`);
      v[k] = FAN_DEFAULTS[k];
    }
  });
  return v;
};

// Logs once per distinct problem, not on every 30 s fan cycle.
ArgonOnePowerFanController.prototype.warnBadFanConfig = function (msg) {
  this.badConfigSeen = this.badConfigSeen || {};
  if (this.badConfigSeen[msg]) return;
  this.badConfigSeen[msg] = true;
  this.log(`${msg}, using the default`, "warn");
};

ArgonOnePowerFanController.prototype.uartOpts = function () {
  return {
    pi5: this.pi5,
    tag: this.tag,
    bootDir: BOOT_DIR,
    backupDir: this.configFile ? path.dirname(this.configFile) : null,
  };
};

ArgonOnePowerFanController.prototype.i2cReady = function () {
  return !!this.i2c && this.i2c.toolsPresent() && this.i2c.deviceAccessible();
};

// ---------------------------------------------------------------------------
// Applying the configuration
// ---------------------------------------------------------------------------

ArgonOnePowerFanController.prototype.applyConfig = async function () {
  const self = this;
  const generation = self.lifecycleGeneration; // see the constructor: detects a stop during the probe
  const powerOn = self.cfgBool("powerEnabled", true);
  const fanOn = self.cfgBool("fanEnabled", true);
  const signalOn = powerOn && self.cfgBool("uartSignal", false);

  if (powerOn) self.startButton();
  else self.stopButton();

  // Fan control turned off: switch the fan off once (only if it was being controlled).
  if (!fanOn && self.fan.running) await self.fan.stop({ off: true });
  if (!fanOn && !signalOn) return;

  if (!self.i2cReady()) {
    self.log(
      `I2C not available (i2cset/i2cget or /dev/i2c-${self.i2c.bus})`,
      "warn",
    );
    return;
  }
  await self.ensureFirmware();
  // The plugin was stopped (or restarted) during the probe: do not start the fan loop.
  if (self.shuttingDown || generation !== self.lifecycleGeneration) return;

  if (fanOn) {
    if (self.fan.running) self.fan.reapply();
    else self.fan.start();
  }
};

ArgonOnePowerFanController.prototype.ensureFirmware = function () {
  const self = this;
  if (self.mcu.firmware !== "unknown")
    return Promise.resolve(self.mcu.firmware);
  if (!self.detecting) {
    // A probe that finishes after a stop/start must not clear the new start's probe.
    const probe = self.mcu.detect().then(
      function (r) {
        if (self.detecting === probe) self.detecting = null;
        return r;
      },
      function (e) {
        if (self.detecting === probe) self.detecting = null;
        throw e;
      },
    );
    self.detecting = probe;
  }
  return self.detecting;
};

// Argon's own service (argononed; argononeoledd on the V5) also drives the fan and
// watches the power button, so running next to this plugin the two fight. Logged once
// per start; never throws.
ArgonOnePowerFanController.prototype.warnIfArgonServiceActive =
  async function () {
    const self = this;
    try {
      const active = await Platform.readActiveArgonServices();
      if (active.length) {
        self.log(
          `Argon's own service is running (${active.join(", ")}). It also controls the fan and watches the ` +
            `power button, so it will conflict with this plugin. Stop it with: sudo systemctl disable --now ${active.join(" ")}`,
          "warn",
        );
      }
    } catch (e) {
      self.log(
        `could not check for Argon's own service: ${e && e.message}`,
        "warn",
      );
    }
  };

ArgonOnePowerFanController.prototype.startButton = function () {
  const self = this;
  if (!self.gpiox) {
    try {
      self.gpiox = require("@iiot2k/gpiox");
    } catch (e) {
      self.buttonError = `gpiox module not loaded: ${e.message}`;
      self.log(self.buttonError, "error");
      return false;
    }
  }
  if (!self.button) {
    self.button = new PowerButton({
      gpiox: self.gpiox,
      logger: self.logger,
      onPress: function (cls, widthMs) {
        self.handlePress(cls, widthMs);
      },
    });
  }
  const ok = self.button.start();
  self.buttonError = ok ? null : self.button.error;
  if (!ok) {
    self.commandRouter.pushToastMessage(
      "error",
      self.t("PLUGIN_NAME"),
      self.t("BUTTON_START_FAILED", self.buttonError),
    );
  }
  return ok;
};

// What a double tap does: 'reboot' (whole system, default) or 'restart' (Volumio app only).
ArgonOnePowerFanController.prototype.doubleTapAction = function () {
  const v = this.config ? String(this.config.get("powerDoubleTap")) : "";
  return v === "restart" ? "restart" : "reboot";
};

ArgonOnePowerFanController.prototype.stopButton = function () {
  if (this.button) this.button.stop();
};

ArgonOnePowerFanController.prototype.handlePress = function (cls, widthMs) {
  const self = this;
  self.log(`pulse ${widthMs.toFixed(1)} ms (${cls})`);
  if (cls === "ambiguous") {
    self.log(`ambiguous pulse ${widthMs.toFixed(1)} ms ignored`, "warn");
    return;
  }
  if (cls !== "reboot" && cls !== "shutdown") return;
  if (self.actionInFlight || self.shuttingDown) return;

  const title = self.t("PLUGIN_NAME");
  const appRestart = cls === "reboot" && self.doubleTapAction() === "restart";
  if (self.cfgBool("powerLogOnly", false)) {
    self.commandRouter.pushToastMessage(
      "info",
      title,
      self.t(
        cls === "reboot" ? "BUTTON_TEST_REBOOT" : "BUTTON_TEST_SHUTDOWN",
        widthMs.toFixed(1),
      ) + (appRestart ? ` [${self.t("POWER_DOUBLE_TAP_RESTART")}]` : ""),
    );
    return;
  }

  // One action at a time. The latch releases after a minute in case the
  // command did not take effect.
  self.releaseActionLatch();
  self.actionInFlight = true;
  self.actionTimer = setTimeout(function () {
    self.releaseActionLatch();
  }, self.actionLatchMs);

  self.commandRouter.pushToastMessage(
    "info",
    title,
    self.t(
      appRestart
        ? "BUTTON_RESTART"
        : cls === "reboot"
          ? "BUTTON_REBOOT"
          : "BUTTON_SHUTDOWN",
    ),
  );
  try {
    if (appRestart) self.restartVolumioApp();
    else if (cls === "reboot") self.commandRouter.reboot();
    else self.commandRouter.shutdown();
  } catch (e) {
    self.log(`${cls} failed: ${e.message}`, "error");
    self.releaseActionLatch();
  }
};

ArgonOnePowerFanController.prototype.restartVolumioApp = function () {
  const self = this;
  // `volumio vrestart` stops then starts the service; running it from this plugin
  // can kill the CLI during the stop. Ask systemd to restart the service instead.
  self.execFile(
    "sudo",
    ["-n", "/bin/systemctl", "restart", "volumio.service"],
    { timeout: 15000 },
    function (err, stdout, stderr) {
      if (!err) return;
      const detail = stderr ? ` | ${String(stderr).trim()}` : "";
      self.log(`Volumio app restart failed: ${err.message}${detail}`, "error");
      self.releaseActionLatch();
    },
  );
};

// Frees the one-action-at-a-time latch and cancels its timer, so a stale timer can
// never release a later latch. Also used on stop/start: the latch must not outlive
// the running plugin.
ArgonOnePowerFanController.prototype.releaseActionLatch = function () {
  if (this.actionTimer) {
    clearTimeout(this.actionTimer);
    this.actionTimer = null;
  }
  this.actionInFlight = false;
};

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

function findElement(uiconf, id) {
  for (let s = 0; s < uiconf.sections.length; s++) {
    const content = uiconf.sections[s].content || [];
    for (let c = 0; c < content.length; c++) {
      if (content[c].id === id) return content[c];
    }
  }
  return null;
}

ArgonOnePowerFanController.prototype.getUIConfig = function () {
  const self = this;
  const langCode = self.commandRouter.sharedVars.get("language_code");

  // Show what is on disk.
  if (self.config && self.configFile) self.config.loadFile(self.configFile);

  const work = (async function () {
    const uiconf = await toNative(
      self.commandRouter.i18nJson(
        `${__dirname}/i18n/strings_${langCode}.json`,
        `${__dirname}/i18n/strings_en.json`,
        `${__dirname}/UIConfig.json`,
      ),
    );
    const status = await self.collectStatus();
    self.fillUiConfig(uiconf, status);
    self.logUartStatus(status);
    return uiconf;
  })();

  return fromPromise(
    work.catch(function (e) {
      self.log(`Failed to build the settings page: ${e && e.message}`, "error");
      throw e;
    }),
  );
};

ArgonOnePowerFanController.prototype.collectStatus = async function () {
  const self = this;
  return {
    uart: UartConfig.scan(self.uartOpts()),
    runtime: await Platform.readUartRuntime(self.pi5),
  };
};

ArgonOnePowerFanController.prototype.fillUiConfig = function (uiconf, st) {
  const self = this;
  function set(id, value) {
    const el = findElement(uiconf, id);
    if (el) el.value = value;
  }

  set("powerEnabled", self.cfgBool("powerEnabled", true));
  set("powerLogOnly", self.cfgBool("powerLogOnly", false));
  const tap = self.doubleTapAction();
  set("powerDoubleTap", {
    value: tap,
    label: self.t(
      tap === "restart"
        ? "POWER_DOUBLE_TAP_RESTART"
        : "POWER_DOUBLE_TAP_REBOOT",
    ),
  });
  set("uartSignal", self.cfgBool("uartSignal", false));
  set("uartStatus", self.uartStatusText(st.uart, st.runtime));

  const fanMode = !self.cfgBool("fanEnabled", true)
    ? "off"
    : self.cfgBool("fanSpeedSteps", false)
      ? "steps"
      : "onoff";
  set("fanMode", {
    value: fanMode,
    label: self.t(
      fanMode === "off"
        ? "FAN_OPT_OFF"
        : fanMode === "steps"
          ? "FAN_OPT_STEPS"
          : "FAN_OPT_ONOFF",
    ),
  });
  // The stored thresholds, whichever mode is active (getCurve() collapses them in on/off mode).
  const fv = self.fanValues();
  set("fanOnTemp", fv.t1);
  set("fanT1", fv.t1);
  set("fanS1", fv.s1);
  set("fanT2", fv.t2);
  set("fanS2", fv.s2);
  set("fanT3", fv.t3);
  set("fanS3", fv.s3);
};

// The one-phrase UART status for the settings page. Who enabled it, where, and what
// the pins are doing right now go to the log (uartLogLine).
ArgonOnePowerFanController.prototype.uartStatusText = function (scan, runtime) {
  const self = this;
  if (scan.state === "conflict") return self.t("UART_ST_BLOCKED");
  const fileOn =
    scan.state === "managed" ||
    scan.state === "foreign" ||
    scan.state === "both";
  if (fileOn)
    return self.t(
      runtime === "inactive" ? "UART_ST_ENABLED_REBOOT" : "UART_ST_ENABLED",
    );
  return self.t(
    runtime === "active" ? "UART_ST_DISABLED_REBOOT" : "UART_ST_DISABLED",
  );
};

ArgonOnePowerFanController.prototype.uartLogLine = function (scan, runtime) {
  function where(list) {
    return list
      .map(function (f) {
        return `${f.file}:${f.line}`;
      })
      .join(", ");
  }
  let boot;
  switch (scan.state) {
    case "managed":
      boot = "on (set by this plugin)";
      break;
    case "foreign":
      boot = `on (set by another setting: ${where(scan.foreign)})`;
      break;
    case "both":
      boot = `on (set by this plugin and another setting: ${where(scan.foreign)})`;
      break;
    case "conflict":
      boot = `blocked (turned off by ${where(scan.off)})`;
      break;
    default:
      boot = "off";
  }
  const now =
    runtime === "active"
      ? "yes (GPIO14 in UART mode)"
      : runtime === "inactive"
        ? "no"
        : "unknown";
  const note = scan.malformed
    ? "; WARNING: the plugin block in a boot file is incomplete (BEGIN/END lines), nothing will be changed until it is fixed by hand"
    : "";
  return `UART: boot setting ${boot}; in use now: ${now}${note}`;
};

// Writes the UART detail to the log. Never throws.
ArgonOnePowerFanController.prototype.logUartStatus = async function (status) {
  const self = this;
  try {
    const st = status || (await self.collectStatus());
    self.log(self.uartLogLine(st.uart, st.runtime));
  } catch (e) {
    self.log(`UART status not logged: ${e && e.message}`, "warn");
  }
};

ArgonOnePowerFanController.prototype.fanStateText = function () {
  const self = this;
  const s = self.fan ? self.fan.lastSpeed : null;
  if (s === null || s === undefined) return self.t("FAN_NOT_SET");
  return s === 0 ? self.t("FAN_OFF") : self.t("FAN_PERCENT", s);
};

// ---------------------------------------------------------------------------
// Settings saves and button callbacks
// ---------------------------------------------------------------------------

ArgonOnePowerFanController.prototype.toast = function (type, key) {
  const args = Array.prototype.slice.call(arguments, 1);
  this.commandRouter.pushToastMessage(
    type,
    this.t("PLUGIN_NAME"),
    this.t.apply(this, args),
  );
};

ArgonOnePowerFanController.prototype.savePower = function (data) {
  const self = this;

  const work = (async function () {
    const powerOn = isTrue(data.powerEnabled);
    const logOnly = isTrue(data.powerLogOnly);
    const tapRaw = data.powerDoubleTap;
    const tap =
      String(tapRaw && typeof tapRaw === "object" ? tapRaw.value : tapRaw) ===
      "restart"
        ? "restart"
        : "reboot";
    const wantUart = isTrue(data.uartSignal);
    const hadUart = self.cfgBool("uartSignal", false);
    let effectiveUart = hadUart;
    let rebootNeeded = false;

    function where(list) {
      return list
        .map(function (f) {
          return `${f.file}:${f.line}`;
        })
        .join(", ");
    }

    if (wantUart !== hadUart) {
      const opts = self.uartOpts();
      if (wantUart) {
        const r = UartConfig.enable(opts);
        if (r.ok) {
          effectiveUart = true;
          if (r.changed) self.toast("success", "UART_WRITTEN");
          else if (r.reason === "foreign")
            self.toast("info", "UART_FOREIGN_KEPT", where(r.status.foreign));
          const rt = await Platform.readUartRuntime(self.pi5);
          rebootNeeded = rt === "inactive";
        } else if (r.reason === "conflict") {
          self.toast("error", "UART_CONFLICT", where(r.status.off));
        } else if (r.reason === "malformed") {
          self.toast("error", "UART_MALFORMED");
        } else {
          self.toast("error", "UART_IO_ERROR", r.error || "");
        }
      } else {
        const d = UartConfig.disable(opts);
        if (d.ok) {
          effectiveUart = false;
          if (d.changed) {
            if (d.status.foreign.length)
              self.toast(
                "info",
                "UART_REMOVED_FOREIGN",
                where(d.status.foreign),
              );
            else self.toast("success", "UART_REMOVED");
            const rt2 = await Platform.readUartRuntime(self.pi5);
            rebootNeeded = rt2 === "active" && d.status.state === "off";
          }
        } else if (d.reason === "malformed") {
          self.toast("error", "UART_MALFORMED");
        } else {
          self.toast("error", "UART_IO_ERROR", d.error || "");
        }
      }
    }

    self.config.set("powerEnabled", powerOn);
    self.config.set("powerLogOnly", logOnly);
    self.config.set("powerDoubleTap", tap);
    self.config.set("uartSignal", effectiveUart);
    self.config.save();

    await self.applyConfig();
    if (effectiveUart !== wantUart) {
      // The UART change was refused (conflict or write error): the switch must
      // go back to what is stored, and the error toast is already shown.
      self.updateUIConfig();
      return;
    }
    self.toast("success", "SETTINGS_SAVED");
    self.logUartStatus();
    self.updateUIConfig(); // refreshes the UART status line
    if (rebootNeeded) self.openRebootModal();
  })();

  return fromPromise(
    work.catch(function (e) {
      self.log(`savePower failed: ${e && e.message}`, "error");
    }),
  );
};

ArgonOnePowerFanController.prototype.saveFan = function (data) {
  const self = this;

  const work = (async function () {
    const modeRaw = data.fanMode;
    let mode = String(
      modeRaw && typeof modeRaw === "object" ? modeRaw.value : modeRaw,
    );
    if (mode !== "off" && mode !== "steps") mode = "onoff";

    if (mode === "off") {
      // The other fields are hidden while the fan is off; keep what is stored.
      self.config.set("fanEnabled", false);
      self.config.save();
      await self.applyConfig();
      self.toast("success", "SETTINGS_SAVED");
      return;
    }

    const steps = mode === "steps";

    // Validate everything before anything is stored. On/off mode reads one
    // temperature; the fields of the other mode are hidden and ignored.
    const fields = steps
      ? [
          ["fanT1", "t1", "FAN_TEMP_1", "temp"],
          ["fanS1", "s1", "FAN_SPEED_1", "speed"],
          ["fanT2", "t2", "FAN_TEMP_2", "temp"],
          ["fanS2", "s2", "FAN_SPEED_2", "speed"],
          ["fanT3", "t3", "FAN_TEMP_3", "temp"],
          ["fanS3", "s3", "FAN_SPEED_3", "speed"],
        ]
      : [["fanOnTemp", "t1", "FAN_ON_TEMP", "temp"]];
    const v = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const b = FAN_BOUNDS[f[3]];
      const n = wholeNumber(data[f[0]]);
      if (!inBounds(n, b)) {
        return self.rejectFan(
          self.t("FAN_ERR_RANGE", self.t(f[2]), b.min, b.max),
        );
      }
      v[f[1]] = n;
    }
    if (steps && !curveOrdered(v)) {
      return self.rejectFan(self.t("FAN_ERR_ORDER"));
    }

    self.config.set("fanEnabled", true);
    self.config.set("fanSpeedSteps", steps);
    self.config.set("fanT1", v.t1);
    if (steps) {
      ["s1", "t2", "s2", "t3", "s3"].forEach(function (k) {
        self.config.set(fanKey(k), v[k]);
      });
    }
    self.config.save();

    await self.applyConfig();
    self.toast("success", "SETTINGS_SAVED");
  })();

  return fromPromise(
    work.catch(function (e) {
      self.log(`saveFan failed: ${e && e.message}`, "error");
    }),
  );
};

// A rejected save: nothing was stored, so push a fresh settings page. That puts the
// stored values back into the fields (same approach as the IR Activity LED plugin).
ArgonOnePowerFanController.prototype.rejectFan = function (detail) {
  this.updateUIConfig();
  this.toast("error", "FAN_NOT_SAVED", detail);
};

ArgonOnePowerFanController.prototype.updateUIConfig = function () {
  const self = this;
  self.commandRouter
    .getUIConfigOnPlugin("system_hardware", "argon_one_power_fan", {})
    .then(function (uiconf) {
      self.commandRouter.broadcastMessage("pushUiConfig", uiconf);
    });
  self.commandRouter.broadcastMessage("pushUiConfig");
};

ArgonOnePowerFanController.prototype.showTemperature = function () {
  const self = this;
  const temp = Platform.readCpuTemp();
  if (temp === null) {
    self.toast("error", "TEMP_UNREADABLE");
  } else if (!self.cfgBool("fanEnabled", true)) {
    // No fan state to report: the plugin is not controlling the fan.
    self.toast("info", "TEMP_TOAST_FAN_OFF", temp.toFixed(1));
  } else {
    self.toast(
      "info",
      "TEMP_TOAST",
      temp.toFixed(1),
      self.fanStateText(),
      self.fanModeText(),
    );
  }
  return libQ.resolve();
};

// The mode the fan controller is actually using now (also tells whether a save took
// effect and whether the last write to the case failed).
ArgonOnePowerFanController.prototype.fanModeText = function () {
  const self = this;
  if (!self.cfgBool("fanEnabled", true)) return self.t("FAN_CONTROL_OFF");
  const parts = [];
  const curve = self.getCurve();
  if (self.cfgBool("fanSpeedSteps", false)) {
    parts.push(
      self.t(
        "FAN_MODE_STEPS",
        curve
          .map(function (c) {
            return `${c.temp} °C → ${c.speed}%`;
          })
          .join(", "),
      ),
    );
  } else {
    parts.push(self.t("FAN_MODE_ONOFF", curve[0].temp));
  }
  if (!self.fan || !self.fan.running) parts.push(self.t("FAN_NOT_RUNNING"));
  if (self.fan && self.fan.lastError)
    parts.push(self.t("FAN_LAST_ERROR", self.fan.lastError));
  return parts.join("; ");
};

// NOT IMPLEMENTED: buttons to write the case power modes 0xFE (always on) and
// 0xFD (default). They come from Argon's i2c code legend only: Argon's own scripts
// never write them, and they do not work on a real V2 case. Removed on purpose.

ArgonOnePowerFanController.prototype.openRebootModal = function () {
  const self = this;
  self.commandRouter.broadcastMessage("openModal", {
    title: self.t("REBOOT_REQUIRED"),
    message: self.t("REBOOT_MESSAGE"),
    size: "lg",
    buttons: [
      {
        name: self.t("LATER"),
        class: "btn btn-warning",
        emit: "closeModals",
        payload: "",
      },
      {
        name: self.t("REBOOT_NOW"),
        class: "btn btn-info",
        emit: "callMethod",
        payload: { endpoint: ENDPOINT, method: "rebootNow", data: "" },
      },
    ],
  });
};

ArgonOnePowerFanController.prototype.rebootNow = function () {
  this.commandRouter.closeModals();
  this.commandRouter.reboot();
  return libQ.resolve();
};

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

ArgonOnePowerFanController.prototype.loadI18n = function () {
  const self = this;
  const langCode = self.commandRouter.sharedVars.get("language_code");
  function read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }
  self.i18nStrings = read(`${__dirname}/i18n/strings_${langCode}.json`);
  self.i18nDefaults = read(`${__dirname}/i18n/strings_en.json`);
};

// Looks up a string and fills %s placeholders in order ("%%" is a literal percent).
ArgonOnePowerFanController.prototype.t = function (key) {
  const args = Array.prototype.slice.call(arguments, 1);
  let s = this.i18nStrings[key];
  if (s === undefined) s = this.i18nDefaults[key];
  if (s === undefined) {
    // The key itself is shown; logged once per key so a missing string is easy to find.
    this.missingStrings = this.missingStrings || {};
    if (!this.missingStrings[key]) {
      this.missingStrings[key] = true;
      this.log(`missing string: ${key}`, "warn");
    }
    return key;
  }
  let i = 0;
  return String(s).replace(/%s|%%/g, function (m) {
    if (m === "%%") return "%";
    return i < args.length ? String(args[i++]) : "";
  });
};

// ---------------------------------------------------------------------------
// Required stubs
// ---------------------------------------------------------------------------

ArgonOnePowerFanController.prototype.getConfigurationFiles = function () {
  return ["config.json"];
};
ArgonOnePowerFanController.prototype.onRestart = function () {};
ArgonOnePowerFanController.prototype.onInstall = function () {};
ArgonOnePowerFanController.prototype.onUninstall = function () {};
ArgonOnePowerFanController.prototype.getConf = function (varName) {
  return this.config.get(varName);
};
ArgonOnePowerFanController.prototype.setConf = function (varName, varValue) {
  this.config.set(varName, varValue);
};
ArgonOnePowerFanController.prototype.getAdditionalConf = function () {};
ArgonOnePowerFanController.prototype.setAdditionalConf = function () {};
ArgonOnePowerFanController.prototype.setUIConfig = function () {};
