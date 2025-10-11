"use strict";

const http = require("http");
const { spawn } = require("child_process");

const fs = require("fs");
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

// TODO: implement detectCdDevice
const CD_DEVICE = process.env.CD_DEVICE || "/dev/sr0"; // or detectCdDevice();

// --- Config / binaries ---
const HOST = process.env.CD_HTTP_HOST || "127.0.0.1";
const PORT = Number(process.env.CD_HTTP_PORT || 8088);
const GST = process.env.GST_BIN || "/usr/bin/gst-launch-1.0";

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

// --- Range parsing (single range only) ---
function parseRange(h, total) {
  if (!h || !/^bytes=/.test(h)) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return null;
  let [, s, e] = m;
  let start = s === "" ? null : parseInt(s, 10);
  let end = e === "" ? null : parseInt(e, 10);
  if (start === null && end === null) return null;
  if (start === null) {
    const n = Math.min(end + 1, total);
    start = total - n;
    end = total - 1;
  } else if (end === null) {
    end = total - 1;
  }
  if (start < 0 || end < start || start >= total) return null;
  end = Math.min(end, total - 1);
  return { start, end };
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

  const range = parseRange(req.headers.range, totalBytes);
  const H = 44; // WAV header size

  // Common headers
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");

  if (range) {
    const { start, end } = range;
    const partLen = end - start + 1;
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalBytes}`);
    res.setHeader("Content-Length", String(partLen));
    if (req.method === "HEAD") return res.end();

    // Send requested header slice if any
    const hdr = wavHeader({ dataBytes });
    if (start < H) {
      const hdrEnd = Math.min(end, H - 1);
      res.write(hdr.subarray(start, hdrEnd + 1));
      if (end < H) return res.end(); // entirely within header
    }

    // Stream requested data slice from live pipeline
    const dataStart = Math.max(start, H) - H; // offset into PCM
    const dataEnd = end - H; // inclusive
    const toSend = dataEnd - dataStart + 1;
    if (toSend <= 0) return res.end();

    const p = gstTrackPcm(n);
    let skipped = 0,
      sent = 0;

    const onChunk = (chunk) => {
      if (skipped < dataStart) {
        const needSkip = dataStart - skipped;
        if (chunk.length <= needSkip) {
          skipped += chunk.length;
          return;
        }
        chunk = chunk.subarray(needSkip);
        skipped = dataStart;
      }
      const remain = toSend - sent;
      const slice = chunk.length > remain ? chunk.subarray(0, remain) : chunk;
      if (slice.length) {
        res.write(slice);
        sent += slice.length;
      }
      if (sent >= toSend) {
        try {
          p.stdout.off("data", onChunk);
        } catch {}
        try {
          p.kill("SIGTERM");
        } catch {}
        return res.end();
      }
    };

    p.stdout.on("data", onChunk);
    p.on("error", () => {
      try {
        res.end();
      } catch {}
    });
    p.on("close", () => {
      if (!res.writableEnded)
        try {
          res.end();
        } catch {}
    });
    req.on("close", () => {
      try {
        p.kill("SIGTERM");
      } catch {}
    });
    return;
  }

  // --- No Range: full response (as before)
  res.statusCode = 200;
  res.setHeader("Content-Length", String(totalBytes));
  if (req.method === "HEAD") return res.end();

  // 1) full header
  res.write(wavHeader({ dataBytes }));
  // 2) full payload
  const p = gstTrackPcm(n);
  p.stdout.pipe(res, { end: true });
  p.on("error", () => {
    try {
      res.end();
    } catch {}
  });
  p.on("close", () => {
    if (!res.writableEnded)
      try {
        res.end();
      } catch {}
  });
  req.on("close", () => {
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(
    `CD HTTP @ http://${HOST}:${PORT}/wav/track/:n  (fixed-size WAV; no Range yet)`
  );
});
