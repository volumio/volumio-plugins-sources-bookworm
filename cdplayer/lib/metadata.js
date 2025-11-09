const { detectCdDevice } = require("./utils");
const { execFile } = require("child_process");
const { promisify } = require("util");
const _nodeFetch = require("node-fetch");
global.fetch = _nodeFetch.default || _nodeFetch;
const execFileAsync = promisify(execFile);

/**
 * @typedef {Object} TrackMetadata
 * @property {number|null} no
 * @property {string}       title
 * @property {number|null}  durationSec
 *
 * @typedef {Object} CdMetadata
 * @property {string}   album
 * @property {string}   artist
 * @property {string}   releaseId
 * @property {TrackMetadata[]} tracks
 */

/**
 * Retrieves the MusicBrainz Disc ID of the currently inserted audio CD.
 *
 * @async
 * @function getDiscId
 * @returns {Promise<string|null>} Resolves with the MusicBrainz Disc ID string, or `null` if not found.
 * @throws {Error} If the `discid` command fails to execute or times out.
 *
 */
async function getDiscId() {
  const device = detectCdDevice();
  try {
    const { stdout } = await execFileAsync("/usr/local/bin/discid", [device], {
      env: { LANG: "C" },
      timeout: 10000,
      windowsHide: true,
    });

    if (!stdout) {
      return null;
    }

    const out = stdout.trim();
    // Common outputs to handle:
    // DiscID        : eWrWSTdIuUCI95ca00chZOSFHug-
    // FreeDB DiscID : b10c9c0c
    // First track   : 1
    // Last track    : 12
    // Length        : 242310 sectors (  53:50.80)
    // Track 1       :      150    20520 (   4:33.60)
    // Track 2       :    20670    15218 (   3:22.91)
    const m = /DiscID\s*:\s*([A-Za-z0-9._-]{20,})/i.exec(out);
    return m ? m[1] : null;
  } catch (err) {
    throw err;
  }
}

/**
 * Fetch MusicBrainz metadata for a given disc ID.
 *
 * @async
 * @function fetchMusicBrainzMetadata
 * @param {string} discId - The MusicBrainz Disc ID (e.g., `"eWrWSTdIuUCI95ca00chZOSFHug-"`).
 * @returns {Promise<Object>} Resolves with the parsed JSON response from MusicBrainz.
 * @throws {Error} If the fetch fails, the API returns a non-OK HTTP status, or the response cannot be parsed.
 */
async function fetchMusicBrainzMetadata(discId) {
  const url = `https://musicbrainz.org/ws/2/discid/${encodeURIComponent(
    discId
  )}?inc=recordings+artists&fmt=json`;

  const headers = {
    "User-Agent": "Volumio-CD-Plugin/1.0 (contact: matteo.tonini@gmail.com)",
    Accept: "application/json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `MusicBrainz fetch failed with status ${response.status}`
      );
    }
    return await response.json();
  } catch (err) {
    throw err;
  }
}

/**
 * Picks a release object from a MusicBrainz /discid response.
 * Prefers a release that includes at least one medium with track data.
 * Falls back to the first release if none contain tracks.
 *
 * @function pickRelease
 * @param {Object} mbJson - The full JSON response from the MusicBrainz /discid endpoint.
 * @param {Array<Object>} mbJson.releases - The list of releases returned by MusicBrainz.
 * @returns {Object|null} The chosen release object, or null if no valid release is found.
 */
function pickRelease(mbJson) {
  if (
    !mbJson ||
    !Array.isArray(mbJson.releases) ||
    mbJson.releases.length === 0
  ) {
    return null;
  }
  // Prefer a release with medium+tracks; fallback to the first release.
  const withTracks = mbJson.releases.find(
    (r) =>
      Array.isArray(r.media) &&
      r.media.some((m) => Array.isArray(m.tracks) && m.tracks.length)
  );
  return withTracks || mbJson.releases[0];
}

/**
 * Formats a MusicBrainz "artist-credit" array into a readable artist string.
 *
 * Example input:
 * [
 *   { name: 'Artist' },
 *   { joinphrase: ' & ', name: 'Feat' }
 * ]
 * -> "Artist & Feat"
 *
 * @function formatArtistCredit
 * @param {Array<Object>} [credit=[]] - The "artist-credit" array from MusicBrainz.
 * @param {string} [credit[].name] - The credited artist’s name.
 * @param {Object} [credit[].artist] - Nested artist object (if present).
 * @param {string} [credit[].joinphrase] - Optional string that joins artists (e.g., ' & ', ' feat. ').
 * @returns {string} The formatted artist name string, or "Unknown" if unavailable.
 */
function formatArtistCredit(credit = []) {
  if (!Array.isArray(credit) || credit.length === 0) return "Unknown";
  return (
    credit
      .map((ac) => `${ac.name || ac.artist?.name || ""}${ac.joinphrase || ""}`)
      .join("")
      .trim() || "Unknown"
  );
}

/**
 * Converts a duration in milliseconds to whole seconds.
 *
 * @function msToSeconds
 * @param {number} ms - Duration in milliseconds.
 * @returns {number|null} Duration in seconds (rounded to nearest integer), or null if invalid.
 */
function msToSeconds(ms) {
  if (typeof ms !== "number") return null;
  return Math.max(0, Math.round(ms / 1000));
}

/**
 * Parses a MusicBrainz /discid response and extracts display-ready metadata.
 *
 * Returns a structured object with album, artist, releaseId, and track list
 * suitable for display in Volumio or similar music UIs.
 *
 * @function parseDiscidResponse
 * @param {Object} mbJson - The MusicBrainz /discid JSON response.
 * @returns {CdMetadata|null} The parsed metadata, or null if no valid release is found.
 *
 * @example
 * const parsed = parseDiscidResponse(mbJson);
 * // parsed = {
 * //   album: "Dark Side of the Moon",
 * //   artist: "Pink Floyd",
 * //   releaseId: "abcd1234-...",
 * //   tracks: [
 * //     { no: 1, title: "Speak to Me", durationSec: 90 },
 * //     { no: 2, title: "Breathe", durationSec: 163 }
 * //   ]
 * // }
 */
function parseMusicBrainzResponse(mbJson) {
  const release = pickRelease(mbJson);
  if (!release) return null;

  const album = release.title || "Audio CD";
  const artist = formatArtistCredit(release["artist-credit"]);
  const releaseId = release.id;

  // Gather tracks from the first medium that has them
  const medium = (release.media || []).find(
    (m) => Array.isArray(m.tracks) && m.tracks.length
  );
  const tracks = (medium?.tracks || []).map((t) => {
    // title priority: track.title -> recording.title
    const title = t.title || t.recording?.title || "Unknown";
    // position/number may appear as string; coerce to int if possible
    const no = t.position ?? t.number ?? null;
    const trackNo =
      typeof no === "string"
        ? parseInt(no, 10)
        : typeof no === "number"
        ? no
        : null;

    // duration priority: track.length -> recording.length (both in ms)
    const lenMs =
      typeof t.length === "number"
        ? t.length
        : typeof t.recording?.length === "number"
        ? t.recording.length
        : null;
    const durationSec = msToSeconds(lenMs);

    return { no: trackNo, title, durationSec };
  });

  return { album, artist, releaseId, tracks };
}

/**
 * Fetches and parses CD metadata using MusicBrainz for the currently inserted disc.
 *
 * @async
 * @function fetchCdMetadata
 * @returns {Promise<CdMetadata|null>}
 *
 */
async function fetchCdMetadata() {
  try {
    const discid = await getDiscId();
    if (!discid) {
      return null;
    }

    const metadata = await fetchMusicBrainzMetadata(discid);

    if (!metadata) {
      return null;
    }

    const parsed = parseMusicBrainzResponse(metadata);
    if (!parsed) {
      return null;
    }
    return parsed;
  } catch (err) {
    // we don't throw here because fetching metadata can fail silently and the plugin still should work
    return null;
  }
}
/**
 * Decorates a list of CD track items with metadata such as album, artist, and album art.
 *
 * @param {CdTrack[]} items - The original list of CD track items.
 * @param {CdMetadata} meta - The metadata to apply to each track.
 * @param {string} albumart - The URL of the album art image.
 * @returns {CdTrack[]} The decorated list of CD track items.
 */
function decorateItems(items, meta, albumart) {
  return items.map((item, index) => ({
    ...item,
    album: meta.album,
    artist: meta.artist,
    title: meta.tracks[index]?.title || item.title,
    albumart,
  }));
}

/**
 * Constructs the URL for the album art image from MusicBrainz Cover Art Archive.
 *
 * @param {string} releaseId - The MusicBrainz release ID.
 * @returns {string} The URL of the album art image.
 */
function getAlbumartUrl(releaseId) {
  return `https://coverartarchive.org/release/${releaseId}/front-500`;
}

module.exports = {
  fetchCdMetadata,
  decorateItems,
  getAlbumartUrl,
};
