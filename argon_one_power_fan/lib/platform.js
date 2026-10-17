"use strict";

/**
 * Platform helpers: Pi model, CPU temperature, UART runtime state.
 * No writes. Everything here reads system files or runs `pinctrl get`.
 */

const fs = require("fs");
const execFile = require("child_process").execFile;

const THERMAL_FILE = "/sys/class/thermal/thermal_zone0/temp";
const MODEL_FILE = "/proc/device-tree/model";
const PINCTRL_CANDIDATES = [
  "/usr/bin/pinctrl",
  "/usr/sbin/pinctrl",
  "/bin/pinctrl",
  "/opt/vc/bin/pinctrl",
];

function readModel() {
  try {
    return fs.readFileSync(MODEL_FILE, "utf8").replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

function isPi5(model) {
  return /Raspberry Pi 5/i.test(model || "");
}

// Tag used by [section] filters in the boot config files. A Pi 400 ("Raspberry Pi 400
// Rev 1.0") is matched by the Pi 4 pattern too, which is what is wanted: [pi4]
// sections apply to it, and it cannot be in an Argon ONE case anyway.
function modelTag(model) {
  if (isPi5(model)) return "pi5";
  if (/Raspberry Pi 4/i.test(model || "")) return "pi4";
  return "other";
}

// CPU temperature in degrees C, or null when it cannot be read.
// Same source as Argon's script (thermal_zone0, millidegrees).
function readCpuTemp() {
  try {
    const v = parseInt(fs.readFileSync(THERMAL_FILE, "utf8").trim(), 10);
    if (isNaN(v)) return null;
    return v / 1000;
  } catch {
    return null;
  }
}

function findPinctrl() {
  for (let i = 0; i < PINCTRL_CANDIDATES.length; i++) {
    if (fs.existsSync(PINCTRL_CANDIDATES[i])) return PINCTRL_CANDIDATES[i];
  }
  return null;
}

// Does GPIO14 currently have a UART TX function? ('pinctrl get 14' reports
// e.g. "14: a5 pn | hi // GPIO14 = TXD1"). Resolves 'active', 'inactive' or
// 'unknown' (cannot tell). Never rejects.
function readUartRuntime(pi5) {
  return new Promise(function (resolve) {
    const bin = findPinctrl();
    if (!bin) {
      // Fallback used by Argon's script on Pi 4: /dev/serial0 exists when the UART is enabled.
      if (!pi5)
        return resolve(fs.existsSync("/dev/serial0") ? "active" : "inactive");
      return resolve("unknown");
    }
    execFile(bin, ["get", "14"], { timeout: 3000 }, function (err, stdout) {
      if (err) return resolve("unknown");
      resolve(parseUartRuntime(String(stdout)));
    });
  });
}

function parseUartRuntime(text) {
  if (/\bTXD\d*\b/i.test(text)) return "active";
  if (/GPIO14/i.test(text) || /^\s*14:/m.test(text)) return "inactive";
  return "unknown";
}

// Argon's own services: argononed (fan and button) and, with the V5's OLED, argononeoledd.
const ARGON_SERVICES = ["argononed", "argononeoledd"];

// `systemctl is-active a b` prints one state per unit, in the order asked.
function parseActiveUnits(text, units) {
  const lines = String(text || "")
    .split("\n")
    .map(function (l) {
      return l.trim();
    });
  return units.filter(function (u, i) {
    return lines[i] === "active";
  });
}

// Which of Argon's services are running now. Resolves [] when none is. The exit status
// of `systemctl is-active` is non-zero when none is active, so the check works on the
// output: one state line per unit means it worked, whatever the exit status. Rejects when
// the check itself failed (systemctl cannot be run, it timed out, or the output is not
// one state per unit), so "nothing running" and "could not tell" stay apart.
// `exec` is for tests.
function readActiveArgonServices(exec) {
  const run = exec || execFile;
  return new Promise(function (resolve, reject) {
    run(
      "systemctl",
      ["is-active"].concat(ARGON_SERVICES),
      { timeout: 3000 },
      function (err, stdout, stderr) {
        if (err && err.killed) return reject(new Error("systemctl timed out"));
        if (err && typeof err.code !== "number") return reject(err); // could not be run (e.g. ENOENT)
        const states = String(stdout || "")
          .split("\n")
          .filter(function (l) {
            return l.trim() !== "";
          });
        if (states.length !== ARGON_SERVICES.length) {
          const detail = String(stderr || stdout || "")
            .trim()
            .slice(0, 120);
          return reject(
            new Error(
              `unexpected output from systemctl is-active (exit ${err ? err.code : 0}${detail ? `: ${detail}` : ""})`,
            ),
          );
        }
        resolve(parseActiveUnits(stdout, ARGON_SERVICES));
      },
    );
  });
}

module.exports = {
  readModel: readModel,
  isPi5: isPi5,
  modelTag: modelTag,
  readCpuTemp: readCpuTemp,
  readUartRuntime: readUartRuntime,
  parseUartRuntime: parseUartRuntime,
  ARGON_SERVICES: ARGON_SERVICES,
  parseActiveUnits: parseActiveUnits,
  readActiveArgonServices: readActiveArgonServices,
};
