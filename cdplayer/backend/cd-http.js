"use strict";

const http = require("http");
const { spawn } = require("child_process");

// --- Config / binaries ---
const HOST = process.env.CD_HTTP_HOST || "127.0.0.1";
const PORT = Number(process.env.CD_HTTP_PORT || 8088);
const GST = process.env.GST_BIN || "/usr/bin/gst-launch-1.0";
const CD_DEVICE = process.env.CD_DEVICE || "/dev/sr0";

// --- Non-seekable: WAV via GStreamer ---
function gstTrackWav(n) {
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
    "wavenc",
    "!",
    "fdsink",
    "fd=1",
  ];
  console.log("[cd-http] spawn:", GST, args.join(" "));
  const p = spawn(GST, args, { stdio: ["ignore", "pipe", "pipe"] });
  p.stderr.on("data", (d) =>
    console.error("[cd-http:gstreamer]", d.toString())
  );
  p.on("exit", (code, sig) =>
    console.log(`[cd-http] gst exited code=${code} sig=${sig}`)
  );
  return p;
}

const server = http.createServer((req, res) => {
  // HEAD: advertise WAV type; don’t spawn a pipeline
  if (req.method === "HEAD") {
    const mh = req.url.match(/^\/wav\/track\/(\d+)(?:\?.*)?$/);
    if (mh) {
      res.writeHead(200, {
        "Content-Type": "audio/x-wav",
        "Cache-Control": "no-store",
      });
      return res.end();
    }
    res.writeHead(404);
    return res.end("Use /wav/track/:n");
  }

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

  const p = gstTrackWav(n);
  let sent = false;

  const send200 = () => {
    if (sent) return;
    sent = true;
    res.writeHead(200, {
      "Content-Type": "audio/x-wav",
      "Cache-Control": "no-store",
      Connection: "close",
      "Transfer-Encoding": "chunked",
    });
    console.log("[cd-http] first bytes → sending headers");
  };

  // Write the first chunk then pipe the rest
  p.stdout.once("data", (chunk) => {
    send200();
    res.write(chunk);
    p.stdout.pipe(res);
  });

  p.stdout.on("error", () => res.end());

  p.on("exit", () => {
    if (!sent) {
      res.statusCode = 500;
      res.end("gst failed");
    }
  });

  // If client disconnects, stop the pipeline
  req.on("close", () => {
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(
    `CD HTTP @ http://${HOST}:${PORT}/wav/track/:n  (non-seekable WAV)`
  );
});
