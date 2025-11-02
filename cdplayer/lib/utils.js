"use strict";

const { execFile } = require("child_process");
const fs = require("fs");

/**
 * @typedef {Object} CdTrack
 * @property {string}   album
 * @property {string}   artist
 * @property {string}   title
 * @property {string}   trackType
 * @property {string}   type
 * @property {string}   service
 * @property {string}   uri
 * @property {number}   duration
 */

/**
 * Detects the CD device path available on the system.
 *
 * @function detectCdDevice
 * @returns {string} The path to the detected CD device, or `"/dev/sr0"` if none are found.
 */
function detectCdDevice() {
  const envDev = process.env.CD_DEVICE;
  if (envDev && fs.existsSync(envDev)) return envDev;
  const candidates = [
    "/dev/sr0",
    "/dev/sr1",
    "/dev/cdrom",
    "/dev/cdrw",
    "/dev/dvd",
  ];
  return candidates.find((p) => fs.existsSync(p)) || "/dev/sr0";
}

/**
 * Runs the `cdparanoia -Q` command to query information about the CD device.
 *
 * This function executes the `cdparanoia` command-line utility using Node's `execFile`
 * to detect and query the CD drive specified by `detectCdDevice()`. It returns a Promise
 * that resolves with the command output (either stdout or stderr), or rejects if an
 * error occurs and no output is available.
 *
 * @function runCdparanoiaQ
 * @returns {Promise<string>} A promise that:
 * - **resolves** with the trimmed command output (stdout or stderr)
 * - **rejects** with an `Error` if the command fails and no output is produced
 *
 * @rejects {Error} If `cdparanoia` fails and no valid output is returned.
 */
function runCdparanoiaQ() {
  return new Promise((resolve, reject) => {
    const opts = {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 15000,
    };
    execFile(
      "/usr/bin/cdparanoia",
      ["-Q", detectCdDevice()],
      opts,
      (err, stdout = "", stderr = "") => {
        const out = (stdout || stderr || "").trim();

        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          err.message = `${err.message}${out ? `\n\nOutput:\n${out}` : ""}`;
          return reject(err);
        }

        resolve(out);
      }
    );
  });
}

/**
 * Parse durations from `cdparanoia -Q` output.
 * Returns an object keyed by track number with duration in whole seconds.
 * @param {string} out
 * @returns {Record<number, number>}
 */
function parseDurationsFromQ(out) {
  // lines look like: "  1.     30253 [06:43.28]        0 [00:00.00] ..."
  const re = /^\s*(\d+)\.\s+(\d+)\s+\[/gm; // (trackNo). (lengthInSectors) [
  const durations = {};
  let m;
  while ((m = re.exec(out))) {
    const track = parseInt(m[1], 10);
    const sectors = parseInt(m[2], 10);
    // audio CD = 75 frames(sectors)/sec → round to whole seconds for UI
    durations[track] = Math.round(sectors / 75);
  }
  return durations;
}

/**
 * Lists the tracks available on the inserted audio CD.
 *
 * @async
 * @function listCD
 * @returns {Promise<Array<CdTrack>>}
 * A promise that resolves with an array of track objects representing
 * the detected CD tracks.
 *
 * @throws {Error} If querying or parsing the CD fails.
 */
async function listCD() {
  try {
    const out = await runCdparanoiaQ();
    const durations = parseDurationsFromQ(out);

    let items = [];
    for (const [trackNumber, duration] of Object.entries(durations)) {
      items.push({
        album: "Audio CD",
        artist: "Unknown",
        title: `Track ${trackNumber}`,
        trackType: "wav",
        type: "song",
        service: "cdplayer",
        uri: `cdplayer/${trackNumber}`,
        duration,
      });
    }
    return items;
  } catch (err) {
    throw err;
  }
}

module.exports = {
  listCD,
  detectCdDevice,
};
