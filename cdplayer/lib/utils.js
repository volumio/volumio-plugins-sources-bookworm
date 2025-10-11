"use strict";

const { execFile } = require("child_process");

/**
 * Run `cdparanoia -Q` and return the raw output (stdout or stderr) as a string.
 */
function runCdparanoiaQ() {
  return new Promise((resolve, reject) => {
    const opts = {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 15000,
    };
    execFile(
      "/usr/bin/cdparanoia",
      ["-Q", "/dev/sr0"],
      opts,
      (err, stdout, stderr) => {
        const out = stdout && stdout.trim() ? stdout : stderr || "";
        if (!out.trim() && err) return reject(err);
        resolve(out);
      }
    );
  });
}

/**
 * Parse `cdparanoia -Q` output and return the list of track numbers (ints).
 * @param {string} out
 * @returns {number[]}
 */
function parseCdparanoiaQ(out) {
  const tracks = [];
  out.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*(\d+)\.\s+\d+/); // e.g. "  1.    23581 [05:14.31]"
    if (m) tracks.push(parseInt(m[1], 10));
  });
  return tracks;
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
    // audio CD = 75 frames(sectors)/sec → round to whole seconds for Volumio UI
    durations[track] = Math.round(sectors / 75);
  }
  return durations;
}

async function listCD(ctx) {
  try {
    const out = await runCdparanoiaQ();

    ctx.log(`Asked cdparanoia -Q, got ${out.length} bytes of output`);

    const trackNums = parseCdparanoiaQ(out);
    ctx.log(`Parsed tracks: ${JSON.stringify(trackNums)}`);

    ctx._lastTrackNums = trackNums;

    if (trackNums.length === 0) {
      ctx.error(`No audio tracks returned`);
      ctx.commandRouter.pushToastMessage(
        "error",
        "CD Player",
        "Please insert an audio CD (0)"
      );
      return { navigation: { lists: [] } };
    }

    ctx._trackDurations = parseDurationsFromQ(out);

    const items = trackNums.map((n) =>
      getItem(
        n,
        ctx._trackDurations && ctx._trackDurations[n],
        `cdplayer/${n}`,
        "cdplayer"
      )
    );

    return {
      navigation: {
        prev: { uri: "cdplayer" },
        lists: [
          {
            title: "CD Tracks",
            icon: "fa fa-music",
            availableListViews: ["list"],
            items,
          },
        ],
      },
    };
  } catch (err) {
    ctx.error(`cdparanoia -Q error: ${err.message || err}`);
    ctx.commandRouter.pushToastMessage(
      "error",
      "CD Player",
      "Please insert an audio CD (1)"
    );

    return { navigation: { lists: [] } };
  }
}

/**
 * Creates a track item object representing a single audio CD track.
 *
 * @param {number} n - The track number (1-based).
 * @param {number} duration - Track duration in seconds.
 * @param {string} uri - The resource URI for the track (e.g., playback URL or browse URI).
 * @param {string} service - The service identifier (e.g., "cdplayer" or "mpd").
 * @returns {Object} A track item object for Volumio’s browse or playback UI.
 * @returns {string} return.album - The album name (fixed as "Audio CD").
 * @returns {string} return.artist - The track artist (fixed as "Unknown").
 * @returns {string} return.trackType - The file/stream type (e.g., "wav").
 * @returns {string} return.type - The Volumio item type (always "song").
 * @returns {string} return.title - The display title (e.g., "Track 1").
 * @returns {string} return.service - The source service name.
 * @returns {string} return.uri - The track URI.
 * @returns {number} return.duration - The duration in seconds (if available).
 */
function getItem(n, duration, uri, service) {
  return {
    album: "Audio CD",
    artist: "Unknown",
    trackType: "wav",
    type: "song",
    title: `Track ${n}`,
    service,
    uri,
    duration,
  };
}

module.exports = {
  listCD,
  getItem,
};
