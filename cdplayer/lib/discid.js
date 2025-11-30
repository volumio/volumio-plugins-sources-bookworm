const crypto = require("crypto");

/**
 *
 * @function calculateMusicBrainzDiscId
 * @param {string} cdDiscIdOutput - The output string from `cd-discid --musicbrainz`.
 * @returns {string} The calculated MusicBrainz Disc ID.
 *
 * @description
 * Calculate MusicBrainz DiscID from the output of:
 *   cd-discid --musicbrainz /dev/sr0
 *
 * Example input:
 *   "12 150 20670 35888 56025 75815 92983 123455 139950 157323 184053 198843 214320 242310"
 *
 * This follows the official MusicBrainz "Disc ID Calculation" algorithm:
 * https://musicbrainz.org/doc/Disc_ID_Calculation
 */

function calculateMusicBrainzDiscId(cdDiscIdOutput) {
  if (!cdDiscIdOutput || typeof cdDiscIdOutput !== "string") {
    throw new Error("cdDiscIdOutput must be a non-empty string");
  }

  // 1. Parse the cd-discid --musicbrainz output line
  //    According to cd-discid manpage with --musicbrainz:
  //      #1: number of tracks (N)
  //      #2..#(N+1): LBA offsets for each track + 150 (lead-in)
  //      #(N+2): lead-out LBA offset + 150
  //
  //    Example:
  //      12 150 20670 ... 214320 242310
  //      ^  ^   ^             ^     ^
  //      N  T1  T2            T12   Lead-out
  const tokens = cdDiscIdOutput
    .trim()
    .split(/\s+/)
    .map((t) => parseInt(t, 10))
    .filter((n) => !Number.isNaN(n));

  if (tokens.length < 3) {
    throw new Error("cd-discid output does not contain enough numeric tokens");
  }

  const trackCount = tokens[0]; // N
  const offsets = tokens.slice(1); // [track1, track2, ..., trackN, leadout]

  // We expect at least N track offsets + 1 lead-out offset.
  if (offsets.length < trackCount + 1) {
    throw new Error(
      `Expected at least ${trackCount + 1} offsets, got ${offsets.length}`
    );
  }

  // 2. Interpret fields as per MusicBrainz spec:
  //    First track number (normally 1), Last track number (= N),
  //    Lead-out offset, and up to 99 frame offsets (padded with 0)
  const firstTrack = 1; // For normal audio CDs, this is always 1.
  const lastTrack = trackCount;

  const trackOffsets = offsets.slice(0, trackCount); // N track offsets
  const leadout = offsets[trackCount]; // lead-out offset

  // 3. Build the 99-track offsets array.
  //    The algorithm requires EXACTLY 99 offsets (4 bytes each) after the lead-out,
  //    padding with 0 if there are fewer than 99 tracks.
  while (trackOffsets.length < 99) {
    trackOffsets.push(0);
  }

  // 4. Construct the 100-element "FrameOffset" array:
  //    FrameOffset[0] = lead-out offset
  //    FrameOffset[1..99] = track offsets (possibly with trailing zeros)
  const frameOffsets = [leadout, ...trackOffsets]; // length 100

  // 5. Convert to upper-case hex ASCII exactly as described:
  //    - First track: 1 byte -> "%02X"
  //    - Last track:  1 byte -> "%02X"
  //    - 100 frame offsets: each 4 bytes -> "%08X"
  const hexParts = [];

  // First track number (normally one): 1 byte -> "%02X"
  hexParts.push(firstTrack.toString(16).padStart(2, "0").toUpperCase());

  // Last track number: 1 byte -> "%02X"
  hexParts.push(lastTrack.toString(16).padStart(2, "0").toUpperCase());

  // Lead-out + 99 frame offsets: 4 bytes each -> "%08X"
  for (const off of frameOffsets) {
    hexParts.push(off.toString(16).padStart(8, "0").toUpperCase());
  }

  // 6. Feed the concatenated hex ASCII into SHA-1 as bytes,
  //    exactly like the C reference code with sha_update on each "%02X"/"%08X".
  const hash = crypto.createHash("sha1");
  for (const part of hexParts) {
    hash.update(part, "ascii");
  }

  const digest = hash.digest(); // 20-byte SHA-1 signature

  // 7. Base64-encode the hash and apply MusicBrainz's URL-safe variant:
  //    - normal Base64 uses '+', '/', '='
  //    - MusicBrainz uses '.', '_', '-' instead.
  let discId = digest.toString("base64");
  discId = discId.replace(/\+/g, ".").replace(/\//g, "_").replace(/=/g, "-");

  // The result is a 28-character string like "d_M.p37bVcYyqGi94zO5XzDVe7w-"
  return discId;
}

// Example usage
// const example =
//   "12 150 20670 35888 56025 75815 92983 123455 139950 157323 184053 198843 214320 242310";
// console.log(calculateMusicBrainzDiscId(example));
module.exports = { calculateMusicBrainzDiscId };
