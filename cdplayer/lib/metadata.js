const https = require("https");
const { execFile } = require("child_process");

// Compute MusicBrainz DiscID via cd-discid (libdiscid). Install: sudo apt-get install cd-discid
function getDiscId(device = "/dev/sr0") {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/cd-discid",
      [device],
      { env: { LANG: "C" } },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        // cd-discid output: <discid> <tracks> <offset1> <offset2> ... <offsetN> <total_sectors>
        const discid = stdout.trim().split(/\s+/)[0];
        resolve(discid || null);
      }
    );
  });
}

function httpsJson(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Volumio-CD-Plugin/1.0 (contact: cdplugin@example)",
          Accept: "application/json",
          ...headers,
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
  });
}

// Fetch {album, artist, artUrl} from MusicBrainz + CoverArtArchive
async function fetchCdMetadata(device = "/dev/sr0") {
  const discid = await getDiscId(device);
  if (!discid) return null;

  // 1) Find releases that contain this disc
  const mb = await httpsJson(
    `https://musicbrainz.org/ws/2/release?discids=${encodeURIComponent(
      discid
    )}&inc=artist-credits&fmt=json`
  );
  const release = mb && mb.releases && mb.releases[0];
  if (!release) return null;

  const album = release.title || "Audio CD";
  const artist = (release["artist-credit"] || [])
    .map((ac) => (ac.artist && ac.artist.name) || ac.name || "")
    .join("");

  // 2) Cover Art (falls back gracefully)
  const relId = release.id;
  let artUrl = null;
  if (relId) {
    // jpeg front (default size) – CAA will redirect. Works fine in Volumio.
    artUrl = `https://coverartarchive.org/release/${relId}/front`;
  }

  return { album, artist, artUrl };
}

module.exports = {
  fetchCdMetadata,
};
