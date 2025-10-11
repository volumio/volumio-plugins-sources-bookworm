// /data/plugins/music_service/cdplayer/backend/cd-http.js
const http = require("http");
const { spawn } = require("child_process");
const GST = "/usr/bin/gst-launch-1.0";

function gstTrackWav(n) {
  const args = [
    "-q",
    "cdparanoiasrc",
    `track=${n}`,
    "device=/dev/sr0",
    "!",
    "audioconvert",
    "!",
    "audioresample",
    "!",
    // Ensure raw PCM shape; not strictly required but nice to be explicit:
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
  if (req.method === "HEAD") {
    // don’t spawn for HEAD
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    });
    return res.end();
  }
  const m = req.url.match(/^\/track\/(\d+)$/);
  if (!m) {
    res.writeHead(404);
    return res.end("Use /track/:n");
  }
  const n = parseInt(m[1], 10);

  const p = gstTrackWav(n);
  let sent = false;

  const send200 = () => {
    if (sent) return;
    sent = true;
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      Connection: "close",
      "Transfer-Encoding": "chunked",
    });
    console.log("[cd-http] first bytes → sending headers");
  };

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
  req.on("close", () => {
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});

server.listen(8088, "127.0.0.1", () =>
  console.log("CD HTTP @ http://127.0.0.1:8088/track/:n")
);
