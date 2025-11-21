/// <reference path="../types.js" />
const fs = require("fs");
const { spawn, execFile } = require("child_process");

/**
 * Try to locate the system `udevadm` binary across common paths.
 * @returns {string} Full path or "udevadm" fallback
 */
function findUdevadm() {
  const c = [
    "/sbin/udevadm",
    "/usr/sbin/udevadm",
    "/usr/bin/udevadm",
    "/bin/udevadm",
    "udevadm",
  ];
  for (const p of c) {
    if (p === "udevadm") return p; // fallback last
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {
      // ignore and continue
    }
  }
  return "udevadm";
}

/**
 * Create a tray watcher that listens for udev block events (srX devices)
 * and fires callbacks when a CD is inserted or ejected.
 *
 * @param {TrayWatcherOptions} options
 * @returns {TrayWatcher}
 */
function createTrayWatcher({
  logger,
  device,
  onEject,
  onEvent,
  debounceMs = 1000,
}) {
  let pendingEject = false;
  let lastMediaPresent = null;
  const log = logger || console;
  const udevadm = findUdevadm();
  let proc = null;
  let buffer = "";
  let lastEjectAt = 0;
  const devBase = device ? device.replace(/^.*\//, "") : null;

  /**
   * Fetch current udev properties for a given device.
   * @param {string} dev
   * @returns {Promise<UdevProps|null>}
   */
  async function readProps(dev) {
    return new Promise((resolve) => {
      execFile(
        udevadm,
        ["info", "--query=property", `--name=${dev}`],
        // if the device is mid-transition, udevadm may hang; use timeout
        { timeout: 2000 },
        (err, stdout = "") => {
          if (err) return resolve(null);
          const outputObj = Object.fromEntries(
            stdout
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              // slice handles cases where the value itself contains "=" characters
              .map((line) => line.split("=").slice(0, 2))
          );
          resolve(outputObj);
        }
      );
    });
  }

  /**
   * Parse a udev monitor record and extract action + devname.
   * @param {string} text
   * @returns {{action: string, devname: string}|null}
   */
  function parsedRecord(text) {
    const head = (/(add|remove|change)/.exec(text) || [])[1] || "";
    const devname = (/DEVNAME=(.*)/.exec(text) || [])[1] || "";
    const ejectReq = (/DISK_EJECT_REQUEST=(.*)/.exec(text) || [])[1] || "";
    const isSr = /\/sr\d+$/.test(devname);
    if (!isSr) return null;
    if (devBase && devname.replace(/^.*\//, "") !== devBase) return null;
    return { action: head, devname, ejectReq };
  }

  /**
   * Handle a relevant udev event by reading device properties and firing callbacks.
   * @param {{action: string, devname: string}} relevantEvent
   */
  async function handleEvent(relevantEvent) {
    log.log(
      `[tray-watcher] handling ${relevantEvent.action} on ${relevantEvent.devname}`
    );
    let props = null;
    try {
      props = await readProps(relevantEvent.devname);
    } catch (err) {
      log.error(`[tray-watcher] Error reading props: ${err.message}`);
    }

    const ejectRequested = relevantEvent.ejectReq === "1";

    // Extract media flags
    const mediaProp = props?.ID_CDROM_MEDIA; // "1", "0", or undefined
    const ready = props?.SYSTEMD_READY;

    // Normalize to tri-state
    // true  = media present
    // false = explicitly no media
    // null  = unknown (couldn't tell)
    let mediaPresent = null;
    if (mediaProp === "1") {
      mediaPresent = true;
    } else if (mediaProp === "0") {
      mediaPresent = false;
    } else {
      mediaPresent = null;
    }

    // Update state based on eject request
    if (ejectRequested) {
      pendingEject = true;
    }

    let noDisc = false;

    if (relevantEvent.action === "remove") {
      // Device removed completely
      noDisc = true;
    } else {
      const mediaNotPresentOrUnknown =
        mediaPresent === false || mediaPresent === null;

      // Eject heuristics:
      // 1. If we saw ejectReq recently and now media is not present/unknown → eject
      if (pendingEject && mediaNotPresentOrUnknown) {
        noDisc = true;
      }
      // 2. Or if we see a transition from "media present" to "not present"
      //    even without ejectReq (for drives without DISK_EJECT_REQUEST)
      else if (lastMediaPresent === true && mediaNotPresentOrUnknown) {
        noDisc = true;
      }
      // Otherwise, we don't call eject
    }

    log.log(
      `[tray-watcher] decision for ${relevantEvent.devname}: ` +
        `action=${relevantEvent.action} media=${mediaProp ?? "<none>"} ` +
        `ready=${ready ?? "<none>"} ejectReq=${ejectRequested ? "1" : "0"} ` +
        `mediaPresent=${mediaPresent === null ? "null" : mediaPresent} ` +
        `pendingEject=${pendingEject} noDisc=${noDisc}`
    );

    if (noDisc) {
      pendingEject = false; // we've acted on this eject
      const now = Date.now();
      if (now - lastEjectAt > debounceMs) {
        lastEjectAt = now;
        try {
          onEject &&
            onEject({
              devname: relevantEvent.devname,
              media: mediaProp,
              ready,
            });
        } catch (e) {
          log.error(`[tray-watcher] Error in onEject callback: ${e.message}`);
        }
      }
    }

    // Update last media state for next event
    lastMediaPresent = mediaPresent;
  }

  /** Start monitoring for block events. */
  function start() {
    if (proc) return;
    proc = spawn(udevadm, [
      "monitor",
      "--kernel",
      "--udev",
      "--subsystem-match=block",
      "--property",
    ]);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      // complete udev records end with double newlines
      const records = buffer.split(/\n{2,}/);
      // if incomplete, keep last part in buffer
      buffer = records.pop() || "";

      for (const record of records) {
        const relevantEvent = parsedRecord(record);
        if (!relevantEvent) continue;
        // Handle the event asynchronously without blocking the loop
        handleEvent(relevantEvent);
      }
    });
    proc.on("error", (e) => log.error("[tray-watcher] " + e.message));
    proc.on("close", (_c, _s) => {
      proc = null;
    });
    log.log("[tray-watcher] Udevadm monitor started");
  }

  /** Stop monitoring and kill the underlying child process. */
  function stop() {
    try {
      proc && !proc.killed && proc.kill("SIGTERM");
    } catch {}
    proc = null;
  }

  return { start, stop, isRunning: () => !!proc };
}

module.exports = { createTrayWatcher };
