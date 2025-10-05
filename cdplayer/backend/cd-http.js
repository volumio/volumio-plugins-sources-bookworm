// /data/plugins/music_service/cdplayer/backend/cd-http.js
const http = require("http");
const { spawn } = require("child_process");

const GST = "/usr/bin/gst-launch-1.0";

function gstTrackFlac(n) {
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
    "flacenc",
    "quality=5",
    "!",
    "fdsink",
    "fd=1",
  ];
  console.log(`[cd-http] spawn: ${GST} ${args.join(" ")}`);
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
  const m = req.url.match(/^\/track\/(\d+)$/);
  if (!m) {
    res.writeHead(404);
    return res.end("Use /track/:n");
  }
  const n = parseInt(m[1], 10);

  const p = gstTrackFlac(n);
  // write headers after the child starts; if it dies immediately, we won’t send 200
  let headersSent = false;
  const send200 = () => {
    if (headersSent) return;
    headersSent = true;
    res.writeHead(200, {
      "Content-Type": "audio/flac",
      "Cache-Control": "no-store",
      Connection: "close",
      "Transfer-Encoding": "chunked",
    });
  };

  // if we get any data, send headers and pipe
  p.stdout.once("data", (chunk) => {
    send200();
    res.write(chunk);
    p.stdout.pipe(res, { end: true });
  });
  p.stdout.on("error", () => res.end());
  p.stderr.on("data", (d) =>
    console.error("[cd-http:gstreamer]", d.toString())
  );

  // if the process exits before any data, return 500
  p.on("exit", (code) => {
    if (!headersSent) {
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
