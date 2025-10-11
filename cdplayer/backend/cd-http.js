"use strict";

const http = require("http");
const { spawn, execFileSync } = require("child_process");

// --- Config / binaries ---
const HOST = process.env.CD_HTTP_HOST || "127.0.0.1";
const PORT = Number(process.env.CD_HTTP_PORT || 8088);
const GST = process.env.GST_BIN || "/usr/bin/gst-launch-1.0";
const CD_DEVICE = process.env.CD_DEVICE || "/dev/sr0";

// ----------------------------------------------
// Helpers: RIFF/WAV header + CD-DA math + sectors
// ----------------------------------------------
function wavHeader({
  dataBytes,
  sampleRate = 44100,
  channels = 2,
  bitsPerSample = 16,
}) {
  const blockAlign = (channels * bitsPerSample) >> 3;
  const byteRate = sampleRate * blockAlign;
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM header size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

function bytesFromSectors(sectors) {
  // CD-DA raw payload we emit: 44100 Hz * 2ch * 16-bit = 176400 bytes/sec
  // cdparanoia -Q "length" column is sectors @ 75/sec → seconds = sectors/75
  // bytes = seconds * 176400 = sectors * (176400/75) = sectors * 2352
  return sectors * 2352;
}

const { spawnSync } = require("child_process"); // add at top if not present

function sectorsForTrack(n) {
  const env = { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/local/bin" };
  const args = ["-Q", "-d", CD_DEVICE];

  // capture BOTH stdout and stderr regardless of exit code
  const proc = spawnSync("/usr/bin/cdparanoia", args, {
    env,
    encoding: "utf8",
  });

  // cdparanoia often writes the table to stderr even on success
  const out = (proc.stdout || "") + (proc.stderr || "");
  if (!out.trim()) {
    console.error(
      "[cd-http] cdparanoia -Q produced no output. status=",
      proc.status,
      " err=",
      proc.error
    );
    return 0;
  }

  // tolerant regex for lines like: "  6.    37453 [08:19.28]"
  const re = new RegExp(
    String.raw`^[\t ]*\*?[\t ]*${n}\.[\t ]+(\d+)[\t ]+\[`,
    "m"
  );
  const m = re.exec(out);

  if (!m) {
    console.error(
      "[cd-http] no TOC match for track",
      n,
      "in -Q output (first lines):\n" + out.split("\n").slice(0, 25).join("\n")
    );
    return 0;
  }

  const sectors = parseInt(m[1], 10);
  if (!Number.isFinite(sectors) || sectors <= 0) {
    console.error("[cd-http] parsed non-positive sectors:", m[1]);
    return 0;
  }
  return sectors;
}

// ----------------------------------------------
// GStreamer: emit RAW PCM to stdout (no wavenc)
// ----------------------------------------------
function gstTrackPcm(n) {
  const args = [
    "-q",
    "cdparanoiasrc",
    `track=${n}`,
    `device=${CD_DEVICE}`,
    "!",
    "audioconvert",
    "!",
    "audioresample",
    "!",
    "audio/x-raw,format=S16LE,channels=2,rate=44100",
    "!",
    "fdsink",
    "fd=1",
  ];
  const p = spawn(GST, args, { stdio: ["ignore", "pipe", "pipe"] });
  return p;
}

// ----------------------------------------------
// HTTP server
// ----------------------------------------------
const server = http.createServer((req, res) => {
  // Single supported route: /wav/track/:n
  const m = req.url.match(/^\/wav\/track\/(\d+)(?:\?.*)?$/);
  if (!m) {
    res.writeHead(404);
    return res.end("Use /wav/track/:n");
  }

  const n = parseInt(m[1], 10);
  if (!Number.isInteger(n) || n <= 0) {
    res.writeHead(400);
    return res.end("invalid track number");
  }

  // Determine fixed total length to keep MPD "duration" stable
  const sectors = sectorsForTrack(n);
  if (!sectors) {
    res.writeHead(500);
    return res.end("could not read track length");
  }
  const dataBytes = bytesFromSectors(sectors);
  const totalBytes = 44 + dataBytes;

  // Advertise a classic file response with a fixed size
  res.statusCode = 200;
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", String(totalBytes));
  res.setHeader("Accept-Ranges", "bytes"); // seeking support comes next step
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "HEAD") {
    // headers only; do NOT write WAV header or start GStreamer
    res.end();
    return;
  }

  // 1) Write RIFF/WAV header (fixed size)
  res.write(wavHeader({ dataBytes }));

  // 2) Pipe raw PCM payload from the CD
  const p = gstTrackPcm(n);
  p.stdout.pipe(res, { end: true });
  p.on("error", () => tryEnd(res));
  p.on("close", () => tryEnd(res));

  // If client disconnects, stop the pipeline
  req.on("close", () => {
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});

function tryEnd(res) {
  if (!res.writableEnded) {
    try {
      res.end();
    } catch {}
  }
}

// Start server
server.listen(PORT, HOST, () => {
  console.log(
    `CD HTTP @ http://${HOST}:${PORT}/wav/track/:n  (fixed-size WAV; no Range yet)`
  );
});
