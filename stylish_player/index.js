"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var http = require("http");
var path = require("path");
var os = require("os");
const { spawn, spawnSync, exec, execSync } = require('child_process');
var STREAM_PORT = 9993;
// Persistent data directory — survives Volumio version updates
var PEPPY_DATA_PATH = '/data/INTERNAL/stylish_player';
// Kiosk constants
var VOLUMIO_KIOSK_PATH = "/opt/volumiokiosk.sh";
var VOLUMIO_KIOSK_BAK_PATH = "/home/volumio/.stylish_player/volumiokiosk.sh.bak";
var VOLUMIO_KIOSK_SERVICE_NAME = "volumio-kiosk";

module.exports = ControllerStylishPlayer;

function ControllerStylishPlayer(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  this.server = null;
}

ControllerStylishPlayer.prototype.checkPort = function (port) {
  var self = this;
  const output = spawnSync(
    `lsof -i tcp:${port} | awk '{print $2}' |grep --invert PID`,
    { shell: true }
  )
  if (output.error) {
    self.logger.error('Stylish Player: ' + output.error)
    return null;
  }
  const pid = Buffer.from(output.stdout.buffer).toString().split('\n')[0]
  self.logger.info('Stylish Player: Found process ID ' + pid);
  return pid
};

ControllerStylishPlayer.prototype.getI18n = function (key) {
  var self = this;
  if (!self.i18nStrings) {
    var lang_code = self.commandRouter.sharedVars.get("language_code");
    try {
      self.i18nStrings = fs.readJsonSync(__dirname + "/i18n/strings_" + lang_code + ".json");
    } catch (e) {
      self.i18nStrings = {};
    }
    try {
      self.i18nDefaults = fs.readJsonSync(__dirname + "/i18n/strings_en.json");
    } catch (e) {
      self.i18nDefaults = {};
    }
  }
  return self.i18nStrings[key] || self.i18nDefaults[key] || key;
};

ControllerStylishPlayer.prototype.getTranslations = function () {
  var self = this;
  // Force reload to pick up any language change
  self.i18nStrings = null;
  self.getI18n('_'); // triggers lazy load
  // Merge defaults with language-specific overrides
  return Object.assign({}, self.i18nDefaults || {}, self.i18nStrings || {});
};

ControllerStylishPlayer.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, "config.json");
  this.config = new (require("v-conf"))();
  this.config.loadFile(configFile);

  // The ALSA contribution (has_alsa_contribution=true) references /tmp/stream.mp3
  // via volumiofifo. Since /tmp is tmpfs and cleared on reboot, the FIFO must
  // exist before any audio playback — create it here at earliest boot stage.
  try {
    try { fs.removeSync('/tmp/stream.mp3'); } catch (e) { /* ignore */ }
    execSync('/usr/bin/mkfifo -m 646 /tmp/stream.mp3', { uid: 1000, gid: 1000 });
  } catch (e) {
    // Non-fatal: onStart will retry
  }

  return libQ.resolve();
};

ControllerStylishPlayer.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  // 0. Ensure persistent peppy data directory exists and migrate old data
  self._ensurePeppyDataDir();

  // 1. Ensure FIFO exists BEFORE updating ALSA (which references it)
  self.loadalsastuff();

  // 2. Update ALSA config to include our contribution
  self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'updateALSAConfigFile');

  // 3. Start audio streaming
  self.streamOutViz();

  // 4. Start the HTTP server
  self
    .startServer()
    .then(function () {
      defer.resolve();
    })
    .fail(function (err) {
      defer.reject(err);
    });

  return defer.promise;
};

ControllerStylishPlayer.prototype.onStop = function () {
  var self = this;

  self.stopServer();
  self.stopAudioServer();
  return libQ.resolve();
};

ControllerStylishPlayer.prototype.onRestart = function () {
  // Optional
};

// Ensure the persistent peppy data directory exists. If peppy folders exist in
// the old location (inside the plugin's app/ dir), move them to the persistent
// path so they survive Volumio version updates.
ControllerStylishPlayer.prototype._ensurePeppyDataDir = function () {
  var self = this;
  var meterDest = path.join(PEPPY_DATA_PATH, 'peppy_meter');
  var spectrumDest = path.join(PEPPY_DATA_PATH, 'peppy_spectrum');
  fs.ensureDirSync(meterDest);
  fs.ensureDirSync(spectrumDest);

  // Migrate from old location (plugin app/ dir) if data exists there
  var oldMeter = path.join(__dirname, 'app', 'peppy_meter');
  var oldSpectrum = path.join(__dirname, 'app', 'peppy_spectrum');

  try {
    if (fs.existsSync(oldMeter) && !fs.lstatSync(oldMeter).isSymbolicLink()) {
      var entries = fs.readdirSync(oldMeter, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isDirectory()) continue;
        var src = path.join(oldMeter, entries[i].name);
        var dest = path.join(meterDest, entries[i].name);
        if (!fs.existsSync(dest)) {
          fs.moveSync(src, dest);
          self.logger.info('Stylish Player: Migrated peppy_meter/' + entries[i].name + ' to persistent storage');
        }
      }
      fs.removeSync(oldMeter);
    }
  } catch (e) {
    self.logger.error('Stylish Player: Error migrating peppy_meter: ' + e);
  }

  try {
    if (fs.existsSync(oldSpectrum) && !fs.lstatSync(oldSpectrum).isSymbolicLink()) {
      var entries = fs.readdirSync(oldSpectrum, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isDirectory()) continue;
        var src = path.join(oldSpectrum, entries[i].name);
        var dest = path.join(spectrumDest, entries[i].name);
        if (!fs.existsSync(dest)) {
          fs.moveSync(src, dest);
          self.logger.info('Stylish Player: Migrated peppy_spectrum/' + entries[i].name + ' to persistent storage');
        }
      }
      fs.removeSync(oldSpectrum);
    }
  } catch (e) {
    self.logger.error('Stylish Player: Error migrating peppy_spectrum: ' + e);
  }

  self.logger.info('Stylish Player: Peppy data path ready at ' + PEPPY_DATA_PATH);
};

// Server Management -------------------------------------------------------------------
ControllerStylishPlayer.prototype.loadalsastuff = function () {
  const self = this;
  try {
    // Remove stale FIFO if it exists, then recreate
    try { fs.removeSync('/tmp/stream.mp3'); } catch (e) { /* ignore */ }
    execSync('/usr/bin/mkfifo -m 646 /tmp/stream.mp3', {
      uid: 1000,
      gid: 1000
    });
  } catch (err) {
    self.logger.error('Stylish Player: Failed to create FIFO: ' + err);
  }
};

/**
 * Return the FFmpeg input parameters needed to read the ALSA FIFO for the
 * current track format.
 *
 * The ALSA plug wrapper (sp_out_pipe_fixed) always resamples ALL audio —
 * including DSD/DoP and Spotify — to 44100 Hz S16LE before writing to the FIFO.
 * FFmpeg therefore always reads at this fixed rate regardless of the source
 * format, sample rate, or whether the original track is PCM, DSD, or Spotify.
 *
 * Returns { fmt, inputRate, isDSD }
 */
ControllerStylishPlayer.prototype._fifoParams = function (samplerate, trackType) {
  var type = (trackType || '').toLowerCase();
  var isDSD = (type === 'dsf' || type === 'dff');

  return { fmt: 's16le', inputRate: 44100, isDSD: isDSD };
};

ControllerStylishPlayer.prototype.streamOutViz = function () {
  var self = this;

  this.pipePath = '/tmp/stream.mp3';

  if (self.audioServer) return;

  self.streamClients = [];
  self._currentFifoFmt = 's16le';
  self._currentFifoRate = 44100;
  self._currentIsDSD = false;
  self._fifoDrainStream = null;

  // Restart FFmpeg when the track switches between PCM and DSD (DoP), because
  // the FIFO format and sample rate change.
  self.commandRouter.addCallback('volumioPushState', function (state) {
    if (!state) return;
    var p = self._fifoParams(state.samplerate, state.trackType);
    self.logger.info('Stylish Player: pushState → fmt=' + p.fmt + ' rate=' + p.inputRate + ' isDSD=' + p.isDSD);
    if (p.fmt !== self._currentFifoFmt || p.inputRate !== self._currentFifoRate) {
      self.logger.info('Stylish Player: FIFO format changed, restarting FFmpeg (' +
        self._currentFifoFmt + '/' + self._currentFifoRate + ' → ' + p.fmt + '/' + p.inputRate + ')');
      self._currentFifoFmt = p.fmt;
      self._currentFifoRate = p.inputRate;
      self._currentIsDSD = p.isDSD;
      // Cancel any pending graceful shutdown since we're force-restarting.
      if (self._ffmpegShutdownTimer) {
        clearTimeout(self._ffmpegShutdownTimer);
        self._ffmpegShutdownTimer = null;
      }
      // Close stream clients so browsers reconnect cleanly after the restart.
      var clients = self.streamClients.slice();
      self.streamClients = [];
      clients.forEach(function (r) { try { r.end(); } catch (e) { /* ignore */ } });
      if (self._audioFfmpeg) {
        self._audioFfmpeg.kill('SIGKILL');
        self._audioFfmpeg = null;
      }
      // Start drain to prevent ALSA from blocking during the format-change gap
      // or while waiting for a client to reconnect after being dropped.
      self._startFifoDrain();
      // No clients remain (they were all ended above), so do not restart FFmpeg
      // here — it will be started when the first client reconnects.
    }
  });

  // Drain the FIFO by reading and discarding data so ALSA never blocks on write
  // when FFmpeg is not running (e.g. no stream clients are connected).
  self._startFifoDrain = function () {
    if (self._fifoDrainStream || self._audioFfmpeg) return;
    self.logger.info('Stylish Player: No stream clients — draining FIFO to keep ALSA unblocked');
    try {
      var drain = fs.createReadStream(self.pipePath);
      drain.on('data', function () { /* discard */ });
      drain.on('error', function (e) {
        self.logger.error('Stylish Player: FIFO drain error: ' + e);
        if (self._fifoDrainStream === drain) self._fifoDrainStream = null;
      });
      self._fifoDrainStream = drain;
    } catch (e) {
      self.logger.error('Stylish Player: Failed to start FIFO drain: ' + e);
    }
  };

  self._stopFifoDrain = function () {
    if (self._fifoDrainStream) {
      self.logger.info('Stylish Player: Stopping FIFO drain');
      self._fifoDrainStream.destroy();
      self._fifoDrainStream = null;
    }
  };

  // Start (or restart) the single long-running FFmpeg encoder.
  self._startAudioFfmpeg = function () {
    if (self._audioFfmpeg) return;
    // Stop the FIFO drain before FFmpeg opens the read end of the pipe.
    self._stopFifoDrain();

    self.logger.info('Stylish Player: Starting FFmpeg — fmt=' + self._currentFifoFmt +
      ' inputRate=' + self._currentFifoRate + (self._currentIsDSD ? ' (DoP DSD)' : '') + ' → output 44100 Hz MP3');

    var ffArgs = [
      '-loglevel', 'error',
      '-fflags', '+genpts+discardcorrupt+igndts',
      '-err_detect', 'ignore_err',
      '-f', self._currentFifoFmt,
      '-ar', String(self._currentFifoRate),
      '-ac', '2',
      '-thread_queue_size', '512',
      '-i', self.pipePath,
      '-af', 'aresample=async=1:first_pts=0',
      '-ar', '44100',
      '-codec:a', 'libmp3lame', '-b:a', '128k',
      '-f', 'mp3', 'pipe:1'
    ];

    var proc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    self._audioFfmpeg = proc;

    proc.stdout.on('data', function (chunk) {
      self.streamClients.forEach(function (res) {
        try { res.write(chunk); } catch (e) { /* client already gone */ }
      });
    });

    // MUST drain stderr — if the 64 KB pipe buffer fills up, FFmpeg blocks
    // on its own write() to stderr and stops producing stdout entirely.
    proc.stderr.on('data', function (data) {
      self.logger.error("Stylish Player: FFmpeg: " + data.toString().trim());
    });

    proc.on('exit', function (code) {
      self.logger.info("Stylish Player: FFmpeg exited with code " + code + ". Restarting...");
      // Only null the reference if it still points to this process; a format-change
      // restart may have already spawned a new process and assigned it.
      if (self._audioFfmpeg === proc) {
        self._audioFfmpeg = null;
        // Only restart if there are active stream clients; otherwise drain the
        // FIFO so ALSA never blocks once the kernel buffer fills up.
        if (self.audioServer && self.streamClients.length > 0) {
          setTimeout(self._startAudioFfmpeg, 1000);
        } else if (self.audioServer) {
          self._startFifoDrain();
        }
      }
    });

    proc.on('error', function (err) {
      self.logger.error("Stylish Player: FFmpeg error: " + err);
      if (self._audioFfmpeg === proc) {
        self._audioFfmpeg = null;
      }
    });
  };

  self.audioServer = http.createServer(function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.url.startsWith('/')) {
      self.logger.info('Stylish Player: Stream client connected for ' + req.url);

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache, no-store'
      });

      self.streamClients.push(res);
      // Cancel any pending FFmpeg shutdown — a client reconnected (e.g. page refresh).
      if (self._ffmpegShutdownTimer) {
        clearTimeout(self._ffmpegShutdownTimer);
        self._ffmpegShutdownTimer = null;
        self.logger.info('Stylish Player: Client reconnected — cancelled FFmpeg shutdown');
      }
      // Start FFmpeg if not already running. _startAudioFfmpeg stops the drain
      // internally just before spawning, so the FIFO never has a read-gap that
      // would cause ALSA's volumiofifo plugin to block and report "device busy".
      if (!self._audioFfmpeg) {
        self._startAudioFfmpeg();
      }

      req.on('close', function () {
        self.logger.info("Stylish Player: Stream client disconnected");
        self.streamClients = self.streamClients.filter(function (r) { return r !== res; });
        res.end();
        // Last client: use a grace period before stopping FFmpeg so a page
        // refresh can reconnect without interrupting the audio pipeline.
        if (self.streamClients.length === 0 && self._audioFfmpeg) {
          self.logger.info('Stylish Player: Last stream client left — scheduling FFmpeg shutdown (3s grace)');
          self._ffmpegShutdownTimer = setTimeout(function () {
            self._ffmpegShutdownTimer = null;
            if (self.streamClients.length === 0 && self._audioFfmpeg) {
              self.logger.info('Stylish Player: Grace period expired — stopping FFmpeg');
              self._audioFfmpeg.kill('SIGTERM');
            }
          }, 3000);
        }
      });

    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  const pid = self.checkPort(STREAM_PORT);
  if (pid) {
    self.logger.info("Stylish Player: Audio server already running on port " + STREAM_PORT + " (pid " + pid + ")");
  } else {
    self.logger.info("Stylish Player: Starting audio server on port " + STREAM_PORT);
    self.audioServer.on('error', function (err) {
      self.logger.error("Stylish Player: Audio server error: " + err);
    });
    self.audioServer.listen(STREAM_PORT, function () {
      self.logger.info("Stylish Player: Resilient Audio Streamer on port " + STREAM_PORT);
      // Open the FIFO with O_RDWR as a permanent sentinel. Because this fd holds
      // both the read and write ends open simultaneously:
      //   - FFmpeg's open(O_RDONLY) never blocks waiting for a writer
      //   - ALSA's open(O_WRONLY) never blocks waiting for a reader
      //   - When ALSA closes after playback stops, FFmpeg never receives EOF
      //     (the sentinel is still a writer), so FFmpeg keeps running
      try {
        self._fifoSentinelFd = fs.openSync(self.pipePath, fs.constants.O_RDWR);
        self.logger.info("Stylish Player: FIFO sentinel opened");
      } catch (e) {
        self.logger.error("Stylish Player: Failed to open FIFO sentinel: " + e);
      }
      // No clients yet — start drain only; FFmpeg will be launched on first connect.
      self._startFifoDrain();
    });
  }
};

ControllerStylishPlayer.prototype.startServer = function () {
  var self = this;
  var defer = libQ.defer();

  if (self.server) {
    self.logger.info("Stylish Player: Server already running");
    defer.resolve();
    return defer.promise;
  }

  var port = self.config.get("port", 3339);
  var distPath = path.join(__dirname, "app");

  var mimeTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".txt": "text/plain",
  };

  self.server = http.createServer(function (req, res) {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse the URL and resolve to prevent directory traversal
    var urlPath = new URL(req.url, "http://localhost").pathname;

    // ── Upload endpoint: accept zip files for peppy_meter or peppy_spectrum ──
    if (urlPath === "/api/upload-peppy-pack" && req.method === "POST") {
      var searchParams = new URL(req.url, "http://localhost").searchParams;
      var packType = searchParams.get("type"); // "meter" or "spectrum"

      if (packType !== "meter" && packType !== "spectrum") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid type parameter. Use 'meter' or 'spectrum'." }));
        return;
      }

      var meterDir = path.join(PEPPY_DATA_PATH, "peppy_meter");
      var spectrumDir = path.join(PEPPY_DATA_PATH, "peppy_spectrum");

      var chunks = [];
      var totalSize = 0;
      var MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB limit

      req.on("data", function (chunk) {
        totalSize += chunk.length;
        if (totalSize > MAX_UPLOAD_SIZE) {
          req.destroy();
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "File too large. Maximum 50MB." }));
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", function () {
        if (totalSize > MAX_UPLOAD_SIZE) return;

        var buffer = Buffer.concat(chunks);

        // Validate zip magic bytes (PK\x03\x04)
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file. Only ZIP files are accepted." }));
          return;
        }

        // Write temp file and extract to temp directory
        var tmpFile = path.join(os.tmpdir(), "peppy_upload_" + Date.now() + ".zip");
        var tmpExtractDir = path.join(os.tmpdir(), "peppy_extract_" + Date.now());
        fs.writeFileSync(tmpFile, buffer);
        fs.ensureDirSync(tmpExtractDir);

        // Extract using Python's zipfile (always available on Volumio)
        var pyCmd = 'python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "' + tmpFile + '" "' + tmpExtractDir + '"';
        exec(pyCmd, function (err, stdout, stderr) {
          // Clean up temp zip file
          try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

          if (err) {
            try { fs.removeSync(tmpExtractDir); } catch (e) { /* ignore */ }
            self.logger.error("Stylish Player: Failed to extract zip: " + stderr);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to extract zip file." }));
            return;
          }

          // Remove __MACOSX if present
          var macosxDir = path.join(tmpExtractDir, "__MACOSX");
          if (fs.existsSync(macosxDir)) {
            try { fs.removeSync(macosxDir); } catch (e) { /* ignore */ }
          }

          try {
            // If zip extracted into a single wrapper folder, descend into it
            var extractedTop = fs.readdirSync(tmpExtractDir).filter(function (n) { return n !== "__MACOSX" && n !== ".DS_Store"; });
            var wrapperName = null;
            if (extractedTop.length === 1 && fs.statSync(path.join(tmpExtractDir, extractedTop[0])).isDirectory()) {
              wrapperName = extractedTop[0];
              tmpExtractDir = path.join(tmpExtractDir, wrapperName);
            }

            // Check for templates/ and templates_spectrum/ structure (combined pack)
            var templatesDir = path.join(tmpExtractDir, "templates");
            var templatesSpectrumDir = path.join(tmpExtractDir, "templates_spectrum");
            var hasTemplates = fs.existsSync(templatesDir) && fs.statSync(templatesDir).isDirectory();
            var hasTemplatesSpectrum = fs.existsSync(templatesSpectrumDir) && fs.statSync(templatesSpectrumDir).isDirectory();

            if (hasTemplates || hasTemplatesSpectrum) {
              // Combined pack: move templates/ subfolders to peppy_meter, templates_spectrum/ to peppy_spectrum
              if (hasTemplates) {
                fs.ensureDirSync(meterDir);
                var tmplEntries = fs.readdirSync(templatesDir);
                for (var ti = 0; ti < tmplEntries.length; ti++) {
                  var srcFolder = path.join(templatesDir, tmplEntries[ti]);
                  if (!fs.statSync(srcFolder).isDirectory()) continue;
                  var destFolder = path.join(meterDir, tmplEntries[ti]);
                  fs.removeSync(destFolder); // overwrite if exists
                  fs.copySync(srcFolder, destFolder);
                }
              }
              if (hasTemplatesSpectrum) {
                fs.ensureDirSync(spectrumDir);
                var specEntries = fs.readdirSync(templatesSpectrumDir);
                for (var si = 0; si < specEntries.length; si++) {
                  var srcSpecFolder = path.join(templatesSpectrumDir, specEntries[si]);
                  if (!fs.statSync(srcSpecFolder).isDirectory()) continue;
                  var destSpecFolder = path.join(spectrumDir, specEntries[si]);
                  fs.removeSync(destSpecFolder);
                  fs.copySync(srcSpecFolder, destSpecFolder);
                }
              }
              self.logger.info("Stylish Player: Uploaded combined pack (templates + spectrum)");
            } else {
              // Simple pack: the extracted content IS the pack folder itself.
              // If we descended into a wrapper, use that folder name as the pack name.
              // Otherwise, look for subdirectories that match the WxH pattern.
              var targetDir = packType === "meter" ? meterDir : spectrumDir;
              fs.ensureDirSync(targetDir);

              // Validate spectrum packs: must contain spectrum.txt, not meters.txt
              if (packType === "spectrum") {
                var hasSpectrumTxt = fs.existsSync(path.join(tmpExtractDir, "spectrum.txt"));
                var hasMetersTxt = fs.existsSync(path.join(tmpExtractDir, "meters.txt"));
                if (!hasSpectrumTxt && hasMetersTxt) {
                  try { fs.removeSync(tmpExtractDir); } catch (e) { /* ignore */ }
                  res.writeHead(400, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "This looks like a meter pack (contains meters.txt instead of spectrum.txt). Please upload it as a Peppy Meter pack instead." }));
                  return;
                }
                if (!hasSpectrumTxt) {
                  // Also check subdirectories for spectrum.txt
                  var subDirs = fs.readdirSync(tmpExtractDir).filter(function (n) { return fs.statSync(path.join(tmpExtractDir, n)).isDirectory(); });
                  var anySubHasMetersOnly = subDirs.some(function (d) {
                    return !fs.existsSync(path.join(tmpExtractDir, d, "spectrum.txt")) && fs.existsSync(path.join(tmpExtractDir, d, "meters.txt"));
                  });
                  if (anySubHasMetersOnly) {
                    try { fs.removeSync(tmpExtractDir); } catch (e) { /* ignore */ }
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "This looks like a meter pack (contains meters.txt instead of spectrum.txt). Please upload it as a Peppy Meter pack instead." }));
                    return;
                  }
                }
              }

              if (wrapperName) {
                // The wrapper folder name IS the pack name (e.g. "800x480_g5_1020_sm")
                // Copy the entire contents as a subfolder of targetDir
                var destPack = path.join(targetDir, wrapperName);
                fs.removeSync(destPack);
                fs.copySync(tmpExtractDir, destPack);
              } else {
                // No wrapper — copy each top-level directory into targetDir
                var extractedEntries = fs.readdirSync(tmpExtractDir);
                for (var ei = 0; ei < extractedEntries.length; ei++) {
                  var srcPath = path.join(tmpExtractDir, extractedEntries[ei]);
                  var destPath = path.join(targetDir, extractedEntries[ei]);
                  fs.removeSync(destPath);
                  fs.copySync(srcPath, destPath);
                }
              }
              self.logger.info("Stylish Player: Uploaded peppy " + packType + " pack");
            }
          } catch (moveErr) {
            self.logger.error("Stylish Player: Failed to move extracted files: " + moveErr.message);
            try { fs.removeSync(tmpExtractDir); } catch (e) { /* ignore */ }
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to move extracted files: " + moveErr.message }));
            return;
          }

          // Clean up temp extract directory
          try { fs.removeSync(tmpExtractDir); } catch (e) { /* ignore */ }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Pack uploaded and extracted successfully." }));
        });
      });

      req.on("error", function () {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Upload failed." }));
      });

      return;
    }

    // API endpoint: return saved plugin config as JSON
    if (urlPath === "/api/config") {
      var configData = {
        playerType: self.config.get("playerType", "albumArt"),
        theme: self.config.get("theme", "skeuomorphic"),
        showPlayerControls: self.config.get("showPlayerControls", true),
        hideSeekHandle: self.config.get("hideSeekHandle", false),
        showRemainingTime: self.config.get("showRemainingTime", false),
        albumArtMaxSpace: self.config.get("albumArtMaxSpace", false),
        albumArtAnimated: self.config.get("albumArtAnimated", true),
        showTrackPanel: self.config.get("showTrackPanel", false),
        vizType: self.config.get("vizType", "spectrum"),
        spectrumOptions: self.config.get("spectrumOptions", ""),
        peppyMeterFolder: self.config.get("peppyMeterFolder", ""),
        peppyMeterModel: self.config.get("peppyMeterModel", "random"),
        peppySpectrumFolder: self.config.get("peppySpectrumFolder", ""),
        peppySpectrumModel: self.config.get("peppySpectrumModel", "random"),
        backgroundColor: self.config.get("backgroundColor", ""),
        trackColor: self.config.get("trackColor", ""),
        artistColor: self.config.get("artistColor", ""),
        albumColor: self.config.get("albumColor", ""),
        streamInfoColor: self.config.get("streamInfoColor", ""),
        controlColor: self.config.get("controlColor", ""),
        port: self.config.get("port", 3339),
        latitude: self.config.get("latitude", ""),
        longitude: self.config.get("longitude", ""),

        weatherApiKey: self.config.get("weatherApiKey", ""),
        unitSystem: self.config.get("unitSystem", "metric"),
        idleScreen: self.config.get("idleScreen", "analogClock"),
        idleTimeout: self.config.get("idleTimeout", 5),
        showWeatherInClock: self.config.get("showWeatherInClock", true),
        analogClockShowDate: self.config.get("analogClockShowDate", true),
        unsplashApiKey: self.config.get("unsplashApiKey", ""),
        wallpaperUrl: self.config.get("wallpaperUrl", ""),
        wallpaperShowTime: self.config.get("wallpaperShowTime", true),
        wallpaperShowSeconds: self.config.get("wallpaperShowSeconds", false),
        wallpaperShowWeather: self.config.get("wallpaperShowWeather", true),
        slideshowInterval: self.config.get("slideshowInterval", 30),
        externalUrl: self.config.get("externalUrl", ""),
        use24Hour: self.config.get("use24Hour", false),
        titleFontSize: self.config.get("titleFontSize", ""),
        albumFontSize: self.config.get("albumFontSize", ""),
        artistFontSize: self.config.get("artistFontSize", ""),
        bitrateFontSize: self.config.get("bitrateFontSize", ""),
        progressFontSize: self.config.get("progressFontSize", ""),
        volumeFontSize: self.config.get("volumeFontSize", ""),
        language: self.commandRouter.sharedVars.get("language_code") || 'en',
      };
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(configData));
      return;
    }

    // API endpoint: delete a peppy pack folder (meter, spectrum, or both)
    if (urlPath === "/api/delete-peppy-pack" && req.method === "POST") {
      var delParams = new URL(req.url, "http://localhost").searchParams;
      var delFolder = delParams.get("folder");
      if (!delFolder || /[\/\\]/.test(delFolder)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid folder name." }));
        return;
      }
      var delMeterPath = path.join(PEPPY_DATA_PATH, "peppy_meter", delFolder);
      var delSpectrumPath = path.join(PEPPY_DATA_PATH, "peppy_spectrum", delFolder);
      var deletedMeter = false;
      var deletedSpectrum = false;
      try {
        if (fs.existsSync(delMeterPath)) {
          fs.removeSync(delMeterPath);
          deletedMeter = true;
        }
        if (fs.existsSync(delSpectrumPath)) {
          fs.removeSync(delSpectrumPath);
          deletedSpectrum = true;
        }
      } catch (delErr) {
        self.logger.error("Stylish Player: Failed to delete pack: " + delErr.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to delete: " + delErr.message }));
        return;
      }
      if (!deletedMeter && !deletedSpectrum) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Folder not found." }));
        return;
      }
      var delMsg = deletedMeter && deletedSpectrum ? "Deleted meter + spectrum pack." : deletedMeter ? "Deleted meter pack." : "Deleted spectrum pack.";
      self.logger.info("Stylish Player: " + delMsg + " (" + delFolder + ")");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: delMsg }));
      return;
    }

    // API endpoint: list peppy_meter asset folders and their meter models
    if (urlPath === "/api/peppy-folders") {
      var peppyDir = path.join(PEPPY_DATA_PATH, "peppy_meter");
      var result = [];
      try {
        var entries = fs.readdirSync(peppyDir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isDirectory()) continue;
          var folderName = entries[i].name;
          // Parse WxH prefix (rest is description)
          var match = folderName.match(/^(\d+)x(\d+)/);
          if (!match) continue;
          var w = parseInt(match[1], 10);
          var h = parseInt(match[2], 10);
          var name = folderName.slice(match[0].length).replace(/^[\-+_]/, '') || folderName;
          var models = [];
          var metersPath = path.join(peppyDir, folderName, "meters.txt");
          if (fs.existsSync(metersPath)) {
            var content = fs.readFileSync(metersPath, "utf8");
            var lines = content.split("\n");
            var currentModel = null;
            for (var j = 0; j < lines.length; j++) {
              var sectionMatch = lines[j].trim().match(/^\[(.+)\]$/);
              if (sectionMatch) {
                currentModel = { name: sectionMatch[1], bgr: '' };
                models.push(currentModel);
              } else if (currentModel) {
                var bgrMatch = lines[j].trim().match(/^bgr\.filename\s*=\s*(.+)$/);
                if (bgrMatch) currentModel.bgr = bgrMatch[1].trim();
              }
            }
          }
          result.push({ folder: folderName, width: w, height: h, name: name, models: models });
        }
      } catch (e) {
        // peppy_meter dir may not exist yet
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(result));
      return;
    }

    // API endpoint: return peppy spectrum folder list with models
    if (urlPath === "/api/peppy-spectrum-folders") {
      var spectrumDir = path.join(PEPPY_DATA_PATH, "peppy_spectrum");
      var spectrumResult = [];
      try {
        var specEntries = fs.readdirSync(spectrumDir, { withFileTypes: true });
        for (var si = 0; si < specEntries.length; si++) {
          if (!specEntries[si].isDirectory()) continue;
          var specFolderName = specEntries[si].name;
          // Parse WxH prefix, optionally +N for bars
          var specMatch = specFolderName.match(/^(\d+)x(\d+)(?:\+(\d+))?/);
          if (!specMatch) continue;
          var specW = parseInt(specMatch[1], 10);
          var specH = parseInt(specMatch[2], 10);
          var specBars = specMatch[3] ? parseInt(specMatch[3], 10) : 30;
          var specName = specFolderName.slice(specMatch[0].length).replace(/^[\-+_]/, '') || specFolderName;
          var specModels = [];
          var spectrumPath = path.join(spectrumDir, specFolderName, "spectrum.txt");
          if (fs.existsSync(spectrumPath)) {
            var specContent = fs.readFileSync(spectrumPath, "utf8");
            var specLines = specContent.split("\n");
            var currentSpecModel = null;
            for (var sj = 0; sj < specLines.length; sj++) {
              var specSectionMatch = specLines[sj].trim().match(/^\[(.+)\]$/);
              if (specSectionMatch) {
                currentSpecModel = { name: specSectionMatch[1], bgr: '' };
                specModels.push(currentSpecModel);
              } else if (currentSpecModel) {
                var specBgrMatch = specLines[sj].trim().match(/^bgr\.filename\s*=\s*(.+)$/);
                if (specBgrMatch) currentSpecModel.bgr = specBgrMatch[1].trim();
              }
            }
          }
          spectrumResult.push({ folder: specFolderName, width: specW, height: specH, bars: specBars, name: specName, models: specModels });
        }
      } catch (e) {
        // peppy_spectrum dir may not exist yet
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(spectrumResult));
      return;
    }

    // API endpoint: return i18n translations for current language
    if (urlPath === "/api/translations") {
      var translations = self.getTranslations();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(translations));
      return;
    }

    var safePath = decodeURIComponent(path.normalize(urlPath)).replace(/^(\.\.[/\\])+/, "");

    // Serve peppy assets from the persistent data directory
    var filePath;
    if (safePath.startsWith("/peppy_meter/") || safePath.startsWith("/peppy_spectrum/")) {
      filePath = path.join(PEPPY_DATA_PATH, safePath);
      if (!filePath.startsWith(PEPPY_DATA_PATH)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
    } else {
      filePath = path.join(distPath, safePath);
      // Ensure the resolved path is within distPath
      if (!filePath.startsWith(distPath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
    }

    // Default to index.html for SPA routing
    if (safePath === "/" || safePath === "") {
      filePath = path.join(distPath, "index.html");
    }

    fs.stat(filePath, function (err, stats) {
      if (err || !stats || !stats.isFile()) {
        // Only apply SPA fallback for requests without a file extension (page routes)
        var ext = path.extname(filePath).toLowerCase();
        if (ext) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        // SPA fallback: serve index.html for client-side routes
        var indexPath = path.join(distPath, "index.html");
        fs.readFile(indexPath, function (err2, data) {
          if (err2) {
            res.writeHead(404);
            res.end("Not Found");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(data);
        });
        return;
      }

      var ext = path.extname(filePath).toLowerCase();
      var contentType = mimeTypes[ext] || "application/octet-stream";

      // Prevent caching for .txt and config files (meters.txt, spectrum.txt)
      var cacheHeader = (ext === ".txt" || ext === ".json") ? "no-cache" : "public, max-age=3600";

      fs.readFile(filePath, function (readErr, data) {
        if (readErr) {
          res.writeHead(500);
          res.end("Internal Server Error");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheHeader });
        res.end(data);
      });
    });
  });

  self.server.listen(port, function () {
    self.logger.info("Stylish Player: Server listening on port " + port);
    defer.resolve();
  });

  self.server.on("error", function (err) {
    self.logger.error("Stylish Player: Server error - " + err.message);
    defer.reject(err);
  });

  return defer.promise;
};

ControllerStylishPlayer.prototype.stopServer = function () {
  var self = this;

  if (self.server) {
    self.server.close();
    self.server = null;
    self.logger.info("Stylish Player: Server stopped");
  }
};

ControllerStylishPlayer.prototype.stopAudioServer = function () {
  var self = this;

  if (self._ffmpegShutdownTimer) {
    clearTimeout(self._ffmpegShutdownTimer);
    self._ffmpegShutdownTimer = null;
  }

  if (self._audioFfmpeg) {
    self._audioFfmpeg.kill('SIGTERM');
    self._audioFfmpeg = null;
  }

  if (self._fifoDrainStream) {
    self._fifoDrainStream.destroy();
    self._fifoDrainStream = null;
  }

  if (self._fifoSentinelFd != null) {
    try { fs.closeSync(self._fifoSentinelFd); } catch (e) { /* ignore */ }
    self._fifoSentinelFd = null;
  }

  if (self.audioServer) {
    self.audioServer.close();
    self.audioServer = null;
    self.streamClients = [];
    self.logger.info("Stylish Player: Audio server stopped");
  }
};

// Broadcast config to connected clients ----------------------------------------------------

ControllerStylishPlayer.prototype.broadcastConfig = function () {
  var self = this;
  var configData = {
    playerType: self.config.get("playerType", "albumArt"),
    theme: self.config.get("theme", "skeuomorphic"),
    showPlayerControls: self.config.get("showPlayerControls", true),
    hideSeekHandle: self.config.get("hideSeekHandle", false),
    showRemainingTime: self.config.get("showRemainingTime", false),
    albumArtMaxSpace: self.config.get("albumArtMaxSpace", false),
    albumArtAnimated: self.config.get("albumArtAnimated", true),
    showTrackPanel: self.config.get("showTrackPanel", false),
    vizType: self.config.get("vizType", "spectrum"),
    spectrumOptions: self.config.get("spectrumOptions", ""),
    peppyMeterFolder: self.config.get("peppyMeterFolder", ""),
    peppyMeterModel: self.config.get("peppyMeterModel", "random"),
    peppySpectrumFolder: self.config.get("peppySpectrumFolder", ""),
    peppySpectrumModel: self.config.get("peppySpectrumModel", "random"),
    port: self.config.get("port", 3339),
    latitude: self.config.get("latitude", ""),
    longitude: self.config.get("longitude", ""),
    weatherApiKey: self.config.get("weatherApiKey", ""),
    unitSystem: self.config.get("unitSystem", "metric"),
    idleScreen: self.config.get("idleScreen", "analogClock"),
    idleTimeout: self.config.get("idleTimeout", 5),
    showWeatherInClock: self.config.get("showWeatherInClock", true),
    analogClockShowDate: self.config.get("analogClockShowDate", true),
    unsplashApiKey: self.config.get("unsplashApiKey", ""),
    wallpaperUrl: self.config.get("wallpaperUrl", ""),
    wallpaperShowTime: self.config.get("wallpaperShowTime", true),
    wallpaperShowSeconds: self.config.get("wallpaperShowSeconds", false),
    wallpaperShowWeather: self.config.get("wallpaperShowWeather", true),
    slideshowInterval: self.config.get("slideshowInterval", 30),
    externalUrl: self.config.get("externalUrl", ""),
    use24Hour: self.config.get("use24Hour", false),
    backgroundColor: self.config.get("backgroundColor", ""),
    trackColor: self.config.get("trackColor", ""),
    artistColor: self.config.get("artistColor", ""),
    albumColor: self.config.get("albumColor", ""),
    streamInfoColor: self.config.get("streamInfoColor", ""),
    controlColor: self.config.get("controlColor", ""),
    titleFontSize: self.config.get("titleFontSize", ""),
    albumFontSize: self.config.get("albumFontSize", ""),
    artistFontSize: self.config.get("artistFontSize", ""),
    bitrateFontSize: self.config.get("bitrateFontSize", ""),
    progressFontSize: self.config.get("progressFontSize", ""),
    volumeFontSize: self.config.get("volumeFontSize", ""),
    language: self.commandRouter.sharedVars.get("language_code") || 'en',
  };
  self.commandRouter.broadcastMessage("pushStylishPlayerConfig", configData);
  self.logger.info("Stylish Player: Broadcasted config update: " + JSON.stringify(configData));
};

// Configuration Methods ----------------------------------------------------------------

ControllerStylishPlayer.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;
  var distPath = path.join(__dirname, "app");

  var lang_code = this.commandRouter.sharedVars.get("language_code");

  self.commandRouter
    .i18nJson(
      __dirname + "/i18n/strings_" + lang_code + ".json",
      __dirname + "/i18n/strings_en.json",
      __dirname + "/UIConfig.json",
    )
    .then(function (uiconf) {
      // Populate port value from saved config
      var port = self.config.get("port", 3339);
      uiconf.sections[0].content[0].value = port;

      // Build and populate the app URL
      var thisDevice;
      var ifaces = os.networkInterfaces();
      Object.keys(ifaces).some(function (ifname) {
        return ifaces[ifname].some(function (iface) {
          if (("IPv4" === iface.family || "4" === iface.family) && iface.internal === false) {
            thisDevice = iface.address;
            return true;
          }
          return false;
        });
      });

      if (!thisDevice) {
        thisDevice = self.commandRouter.sharedVars.get("device_name") || "localhost";
      }

      var appUrl = "http://" + thisDevice + ":" + port;
      uiconf.sections[1].content[0].value = appUrl;

      // Populate the "Open App" button with the same URL
      uiconf.sections[1].content[1].onClick = { type: "openUrl", url: appUrl };

      // Populate theme select (Index 0)
      var theme = self.config.get("theme", "skeuomorphic");
      var themeOptions = uiconf.sections[2].content[0].options;
      var matchTheme = themeOptions.find(function (opt) {
        return opt.value === theme;
      });
      if (matchTheme) {
        uiconf.sections[2].content[0].value = matchTheme;
      }

      // Populate player type select (Index 1)
      var playerType = self.config.get("playerType", "albumArt");
      var playerTypeOptions = uiconf.sections[2].content[1].options;
      var matchPlayerType = playerTypeOptions.find(function (opt) {
        return opt.value === playerType;
      });
      if (matchPlayerType) {
        uiconf.sections[2].content[1].value = matchPlayerType;
      }

      // Populate show player controls (Index 2)
      uiconf.sections[2].content[2].value = self.config.get("showPlayerControls", true);

      // Populate hide seek handle (Index 3)
      uiconf.sections[2].content[3].value = self.config.get("hideSeekHandle", false);

      // Populate show remaining time (Index 4)
      uiconf.sections[2].content[4].value = self.config.get("showRemainingTime", false);

      // Populate album art max space (Index 5)
      uiconf.sections[2].content[5].value = self.config.get("albumArtMaxSpace", false);

      // Populate album art animated (Index 6)
      uiconf.sections[2].content[6].value = self.config.get("albumArtAnimated", true);

      // Populate show track panel (Index 7)
      uiconf.sections[2].content[7].value = self.config.get("showTrackPanel", false);

      // Populate viz type select (Index 8)
      var vizType = self.config.get("vizType", "spectrum");
      var vizTypeOptions = uiconf.sections[2].content[8].options;
      var matchVizType = vizTypeOptions.find(function (opt) {
        return opt.value === vizType;
      });
      if (matchVizType) {
        uiconf.sections[2].content[8].value = matchVizType;
      }

      // Populate spectrum options (Index 9)
      uiconf.sections[2].content[9].value = self.config.get("spectrumOptions", "");

      // Dynamically populate peppy meter folder options from disk
      var peppyMeterDir = path.join(PEPPY_DATA_PATH, "peppy_meter");
      try {
        var peppyMeterEntries = fs.readdirSync(peppyMeterDir, { withFileTypes: true });
        for (var pi = 0; pi < peppyMeterEntries.length; pi++) {
          if (!peppyMeterEntries[pi].isDirectory()) continue;
          var pmFolder = peppyMeterEntries[pi].name;
          if (!pmFolder.match(/^\d+x\d+/)) continue;
          uiconf.sections[2].content[10].options.push({ value: pmFolder, label: pmFolder });
        }
      } catch (e) { /* peppy_meter dir may not exist */ }

      // Populate peppy meter folder (Index 10)
      var peppyMeterFolder = self.config.get("peppyMeterFolder", "");
      var peppyMeterFolderOptions = uiconf.sections[2].content[10].options;
      var matchPeppyFolder = peppyMeterFolderOptions.find(function (opt) {
        return opt.value === peppyMeterFolder;
      });
      if (matchPeppyFolder) {
        uiconf.sections[2].content[10].value = matchPeppyFolder;
      }

      // Populate peppy meter model (Index 11)
      // Dynamically populate model options from meters.txt of the selected folder
      var peppyMeterModel = self.config.get("peppyMeterModel", "random");
      if (peppyMeterFolder) {
        var metersPath = path.join(PEPPY_DATA_PATH, "peppy_meter", peppyMeterFolder, "meters.txt");
        if (fs.existsSync(metersPath)) {
          var metersContent = fs.readFileSync(metersPath, "utf8");
          var metersLines = metersContent.split("\n");
          for (var mi = 0; mi < metersLines.length; mi++) {
            var meterSection = metersLines[mi].trim().match(/^\[(.+)\]$/);
            if (meterSection) {
              uiconf.sections[2].content[11].options.push({ value: meterSection[1], label: meterSection[1] });
            }
          }
        }
      }
      var peppyMeterModelOptions = uiconf.sections[2].content[11].options;
      var matchPeppyModel = peppyMeterModelOptions.find(function (opt) {
        return opt.value === peppyMeterModel;
      });
      if (matchPeppyModel) {
        uiconf.sections[2].content[11].value = matchPeppyModel;
      }

      // Dynamically populate peppy spectrum folder options from disk
      var peppySpectrumDir = path.join(PEPPY_DATA_PATH, "peppy_spectrum");
      try {
        var spectrumEntries = fs.readdirSync(peppySpectrumDir, { withFileTypes: true });
        for (var sfi = 0; sfi < spectrumEntries.length; sfi++) {
          if (!spectrumEntries[sfi].isDirectory()) continue;
          var psFolder = spectrumEntries[sfi].name;
          if (!psFolder.match(/^\d+x\d+/)) continue;
          uiconf.sections[2].content[12].options.push({ value: psFolder, label: psFolder });
        }
      } catch (e) { /* peppy_spectrum dir may not exist */ }

      // Populate peppy spectrum folder (Index 12)
      var peppySpectrumFolder = self.config.get("peppySpectrumFolder", "");
      var peppySpectrumFolderOptions = uiconf.sections[2].content[12].options;
      var matchSpectrumFolder = peppySpectrumFolderOptions.find(function (opt) {
        return opt.value === peppySpectrumFolder;
      });
      if (matchSpectrumFolder) {
        uiconf.sections[2].content[12].value = matchSpectrumFolder;
      }

      // Populate peppy spectrum model (Index 13)
      // Dynamically populate model options from spectrum.txt of the selected folder
      var peppySpectrumModel = self.config.get("peppySpectrumModel", "random");
      if (peppySpectrumFolder) {
        var spectrumTxtPath = path.join(PEPPY_DATA_PATH, "peppy_spectrum", peppySpectrumFolder, "spectrum.txt");
        if (fs.existsSync(spectrumTxtPath)) {
          var specTxtContent = fs.readFileSync(spectrumTxtPath, "utf8");
          var specTxtLines = specTxtContent.split("\n");
          for (var smi = 0; smi < specTxtLines.length; smi++) {
            var specSection = specTxtLines[smi].trim().match(/^\[(.+)\]$/);
            if (specSection) {
              uiconf.sections[2].content[13].options.push({ value: specSection[1], label: specSection[1] });
            }
          }
        }
      }
      var peppySpectrumModelOptions = uiconf.sections[2].content[13].options;
      var matchSpectrumModel = peppySpectrumModelOptions.find(function (opt) {
        return opt.value === peppySpectrumModel;
      });
      if (matchSpectrumModel) {
        uiconf.sections[2].content[13].value = matchSpectrumModel;
      }

      // Populate colors section (index 3)
      uiconf.sections[3].content[0].value = self.config.get("backgroundColor", "");
      uiconf.sections[3].content[1].value = self.config.get("trackColor", "");
      uiconf.sections[3].content[2].value = self.config.get("artistColor", "");
      uiconf.sections[3].content[3].value = self.config.get("albumColor", "");
      uiconf.sections[3].content[4].value = self.config.get("streamInfoColor", "");
      uiconf.sections[3].content[5].value = self.config.get("controlColor", "");

      // Populate idle screen section (index 4)
      var idleScreen = self.config.get("idleScreen", "analogClock");
      var idleScreenOptions = uiconf.sections[4].content[0].options;
      var matchIdleScreen = idleScreenOptions.find(function (opt) {
        return opt.value === idleScreen;
      });
      if (matchIdleScreen) {
        uiconf.sections[4].content[0].value = matchIdleScreen;
      }
      uiconf.sections[4].content[1].value = self.config.get("externalUrl", "");
      uiconf.sections[4].content[2].value = self.config.get("idleTimeout", 5);

      // Populate clock section (index 5)
      uiconf.sections[5].content[0].value = self.config.get("use24Hour", false);
      uiconf.sections[5].content[1].value = self.config.get("wallpaperShowSeconds", false);
      uiconf.sections[5].content[2].value = self.config.get("showWeatherInClock", true);
      uiconf.sections[5].content[3].value = self.config.get("analogClockShowDate", true);

      // Populate weather section (index 6)
      uiconf.sections[6].content[0].value = self.config.get("latitude", "");
      uiconf.sections[6].content[1].value = self.config.get("longitude", "");
      uiconf.sections[6].content[2].value = self.config.get("weatherApiKey", "");
      var unitSystem = self.config.get("unitSystem", "metric");
      var unitSystemOptions = uiconf.sections[6].content[3].options;
      var matchUnitSystem = unitSystemOptions.find(function (opt) {
        return opt.value === unitSystem;
      });
      if (matchUnitSystem) {
        uiconf.sections[6].content[3].value = matchUnitSystem;
      }

      // Populate wallpaper section (index 7)
      uiconf.sections[7].content[0].value = self.config.get("unsplashApiKey", "");
      uiconf.sections[7].content[1].value = self.config.get("wallpaperUrl", "");
      uiconf.sections[7].content[2].value = self.config.get("wallpaperShowTime", true);
      uiconf.sections[7].content[3].value = self.config.get("wallpaperShowWeather", true);
      uiconf.sections[7].content[4].value = self.config.get("slideshowInterval", 30);

      // Populate kiosk section — find by id so section ordering is not fragile
      var kioskState = self.checkVolumioKiosk();
      var kioskDesc, kioskButton;
      if (!kioskState.exists) {
        kioskDesc = self.getI18n("KIOSK_NOT_FOUND");
      } else if (kioskState.display === "default") {
        kioskDesc = self.getI18n("KIOSK_SHOWING_DEFAULT");
        kioskButton = {
          id: "kioskSetToStylish",
          element: "button",
          label: self.getI18n("KIOSK_SET_TO_STYLISH"),
          onClick: {
            type: "emit",
            message: "callMethod",
            data: {
              endpoint: "user_interface/stylish_player",
              method: "kioskSetToStylishPlayer"
            }
          }
        };
      } else if (kioskState.display === "stylishPlayer") {
        kioskDesc = self.getI18n("KIOSK_SHOWING_STYLISH");
        kioskButton = {
          id: "kioskRestoreDefault",
          element: "button",
          label: self.getI18n("KIOSK_RESTORE_DEFAULT"),
          onClick: {
            type: "emit",
            message: "callMethod",
            data: {
              endpoint: "user_interface/stylish_player",
              method: "kioskRestoreDefault"
            }
          }
        };
      } else {
        kioskDesc = self.getI18n("KIOSK_SHOWING_UNKNOWN");
        if (fs.existsSync(VOLUMIO_KIOSK_BAK_PATH)) {
          kioskDesc += " " + self.getI18n("KIOSK_RESTORE_BAK_AVAILABLE");
          kioskButton = {
            id: "kioskRestoreBak",
            element: "button",
            label: self.getI18n("KIOSK_RESTORE_BAK_BTN"),
            onClick: {
              type: "emit",
              message: "callMethod",
              data: {
                endpoint: "user_interface/stylish_player",
                method: "kioskRestoreFromBackup"
              }
            }
          };
        }
      }
      var kioskSection = uiconf.sections.find(function (s) { return s.id === 'section_kiosk'; });
      if (kioskSection) {
        kioskSection.description = kioskDesc;
        if (kioskButton) kioskSection.content = [kioskButton];
      }

      // Populate fonts section (last section)
      try {
        var fontsSection = uiconf.sections.find(function (s) { return s.id === 'section_fonts'; });
        if (fontsSection && fontsSection.content) {
          fontsSection.content[0].value = self.config.get("titleFontSize", "");
          fontsSection.content[1].value = self.config.get("albumFontSize", "");
          fontsSection.content[2].value = self.config.get("artistFontSize", "");
          fontsSection.content[3].value = self.config.get("bitrateFontSize", "");
          fontsSection.content[4].value = self.config.get("progressFontSize", "");
          fontsSection.content[5].value = self.config.get("volumeFontSize", "");
        }
      } catch (e) { /* ignore if fonts section not present */ }

      defer.resolve(uiconf);
    })
    .fail(function () {
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerStylishPlayer.prototype.refreshUI = function () {
  var self = this;
  self.getUIConfig().then(function (uiconf) {
    self.commandRouter.broadcastMessage("pushUiConfig", uiconf);
  });
};

ControllerStylishPlayer.prototype.getConfigurationFiles = function () {
  return ["config.json"];
};

ControllerStylishPlayer.prototype.configSaveDaemon = function (data) {
  var self = this;

  self.logger.info("Stylish Player: configSaveDaemon called with data: " + JSON.stringify(data));

  var port = parseInt(data["port"], 10);

  if (isNaN(port) || port < 1024 || port > 65535) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Invalid port number. Must be between 1024 and 65535.");
    return;
  }

  var oldPort = self.config.get("port", 3339);

  // Check kiosk BEFORE saving the new port, so checkVolumioKiosk still finds the old port
  var kioskHasOldPort = false;
  try {
    if (fs.existsSync(VOLUMIO_KIOSK_PATH)) {
      var kioskContent = fs.readFileSync(VOLUMIO_KIOSK_PATH, "utf8");
      kioskHasOldPort = kioskContent.indexOf("localhost:" + oldPort) !== -1;
    }
  } catch (e) {
    self.logger.error("Stylish Player: Could not read kiosk script: " + e.message);
  }

  self.config.set("port", port);

  self.logger.info("Stylish Player: Port saved. Old: " + oldPort + ", New: " + port);

  self.commandRouter.pushToastMessage("success", "Stylish Player", "Settings saved.");

  if (oldPort !== port) {
    self.stopServer();
    self.startServer();
    if (kioskHasOldPort) {
      try {
        execSync("echo volumio | sudo -S sed -i 's|localhost:" + oldPort + "|localhost:" + port + "|g' \"" + VOLUMIO_KIOSK_PATH + "\"");
        self.logger.info("Stylish Player: Updated kiosk URL from port " + oldPort + " to " + port);
        self.restartKioskService();
      } catch (error) {
        self.logger.error("Stylish Player: Failed to update kiosk port: " + error.message);
      }
    }
  }

  self.broadcastConfig();
  self.refreshUI();
};

ControllerStylishPlayer.prototype.configSavePlayerConfig = function (data) {
  var self = this;
  var theme = data["theme"] ? data["theme"].value : "skeuomorphic";
  var playerType = data["playerType"] ? data["playerType"].value : "albumArt";
  var showPlayerControls = data["showPlayerControls"] !== false;
  var hideSeekHandle = data["hideSeekHandle"] === true;
  var showRemainingTime = data["showRemainingTime"] === true;
  var albumArtMaxSpace = data["albumArtMaxSpace"] === true;
  var albumArtAnimated = data["albumArtAnimated"] !== false;
  var showTrackPanel = data["showTrackPanel"] === true;
  var vizType = data["vizType"] ? data["vizType"].value : "spectrum";
  var spectrumOptions = (data["spectrumOptions"] || "").toString().trim();

  // Validate JSON if a value is provided
  if (spectrumOptions) {
    try {
      JSON.parse(spectrumOptions);
    } catch (e) {
      self.commandRouter.pushToastMessage("error", "Stylish Player", "Spectrum Options is not valid JSON: " + e.message);
      return;
    }
  }

  self.config.set("theme", theme);
  self.config.set("playerType", playerType);
  self.config.set("showPlayerControls", showPlayerControls);
  self.config.set("hideSeekHandle", hideSeekHandle);
  self.config.set("showRemainingTime", showRemainingTime);
  self.config.set("albumArtMaxSpace", albumArtMaxSpace);
  self.config.set("albumArtAnimated", albumArtAnimated);
  self.config.set("showTrackPanel", showTrackPanel);
  self.config.set("vizType", vizType);
  self.config.set("spectrumOptions", spectrumOptions);

  if (vizType === "peppyMeter") {
    var peppyMeterFolder = data["peppyMeterFolder"] ? (typeof data["peppyMeterFolder"] === 'object' ? data["peppyMeterFolder"].value : data["peppyMeterFolder"]) : "";
    var peppyMeterModel = data["peppyMeterModel"] ? (typeof data["peppyMeterModel"] === 'object' ? data["peppyMeterModel"].value : data["peppyMeterModel"]) : "random";
    self.config.set("peppyMeterFolder", peppyMeterFolder);
    self.config.set("peppyMeterModel", peppyMeterModel);
  }

  if (vizType === "peppySpectrum") {
    var peppySpectrumFolder = data["peppySpectrumFolder"] ? (typeof data["peppySpectrumFolder"] === 'object' ? data["peppySpectrumFolder"].value : data["peppySpectrumFolder"]) : "";
    var peppySpectrumModel = data["peppySpectrumModel"] ? (typeof data["peppySpectrumModel"] === 'object' ? data["peppySpectrumModel"].value : data["peppySpectrumModel"]) : "random";
    self.config.set("peppySpectrumFolder", peppySpectrumFolder);
    self.config.set("peppySpectrumModel", peppySpectrumModel);
  }

  self.commandRouter.pushToastMessage("success", "Stylish Player", "Player configuration saved.");

  self.broadcastConfig();
};

ControllerStylishPlayer.prototype.configSaveColors = function (data) {
  var self = this;
  var hexPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var fields = ["backgroundColor", "trackColor", "artistColor", "albumColor", "streamInfoColor", "controlColor"];

  for (var i = 0; i < fields.length; i++) {
    var val = (data[fields[i]] || "").toString().trim();
    if (val && !hexPattern.test(val)) {
      self.commandRouter.pushToastMessage("error", "Stylish Player", fields[i] + " must be a valid hex code (e.g. #1a2b3c).");
      return;
    }
    self.config.set(fields[i], val);
  }

  self.commandRouter.pushToastMessage("success", "Stylish Player", "Color settings saved.");
  self.broadcastConfig();
};

ControllerStylishPlayer.prototype.configSaveFonts = function (data) {
  var self = this;
  var fields = ["titleFontSize", "albumFontSize", "artistFontSize", "bitrateFontSize", "progressFontSize", "volumeFontSize"];
  //self.logger.info("Stylish Player: configSaveFonts called with data: " + JSON.stringify(data));

  for (var i = 0; i < fields.length; i++) {
    var val = (data[fields[i]] || "").toString().trim();
    self.config.set(fields[i], val);
  }

  self.commandRouter.pushToastMessage("success", "Stylish Player", "Font settings saved.");
  self.broadcastConfig();
  // // Refresh UI so Volumio core settings page re-reads UIConfig and shows saved values
  // try {
  //   self.refreshUI();
  // } catch (e) {
  //   self.logger.error("Stylish Player: Failed to refresh UI after saving fonts: " + e.message);
  // }
};

ControllerStylishPlayer.prototype.configSaveLocation = function (data) {
  var self = this;

  var latitude = (data["latitude"] || "").toString().trim();
  var longitude = (data["longitude"] || "").toString().trim();

  if (latitude && (isNaN(parseFloat(latitude)) || parseFloat(latitude) < -90 || parseFloat(latitude) > 90)) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Latitude must be between -90 and 90.");
    return;
  }
  if (longitude && (isNaN(parseFloat(longitude)) || parseFloat(longitude) < -180 || parseFloat(longitude) > 180)) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Longitude must be between -180 and 180.");
    return;
  }

  self.config.set("latitude", latitude);
  self.config.set("longitude", longitude);
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Location saved.");

  self.broadcastConfig();
};

ControllerStylishPlayer.prototype.configSaveWeather = function (data) {
  var self = this;

  var latitude = (data["latitude"] || "").toString().trim();
  var longitude = (data["longitude"] || "").toString().trim();
  var apiKey = (data["weatherApiKey"] || "").toString().trim();
  var unitSystem = data["unitSystem"] ? data["unitSystem"].value : "metric";

  if (latitude && (isNaN(parseFloat(latitude)) || parseFloat(latitude) < -90 || parseFloat(latitude) > 90)) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Latitude must be between -90 and 90.");
    return;
  }
  if (longitude && (isNaN(parseFloat(longitude)) || parseFloat(longitude) < -180 || parseFloat(longitude) > 180)) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Longitude must be between -180 and 180.");
    return;
  }

  self.config.set("latitude", latitude);
  self.config.set("longitude", longitude);
  self.config.set("weatherApiKey", apiKey);
  self.config.set("unitSystem", unitSystem);
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Weather settings saved.");

  self.broadcastConfig();
};

// Kiosk Management -----------------------------------------------------------------------

ControllerStylishPlayer.prototype.checkVolumioKiosk = function () {
  var self = this;
  var port = self.config.get("port", 3339);
  try {
    if (!fs.existsSync(VOLUMIO_KIOSK_PATH)) {
      return { exists: false };
    }
    var content = fs.readFileSync(VOLUMIO_KIOSK_PATH, "utf8");
    if (content.indexOf("localhost:" + port) !== -1) {
      return { exists: true, display: "stylishPlayer" };
    }
    if (content.indexOf("localhost:3000") !== -1) {
      return { exists: true, display: "default" };
    }
    return { exists: true, display: "unknown" };
  } catch (error) {
    self.logger.error("Stylish Player: Error reading Volumio Kiosk script: " + error.message);
    return { exists: false };
  }
};

ControllerStylishPlayer.prototype.kioskSetToStylishPlayer = function () {
  var self = this;
  var port = self.config.get("port", 3339);
  try {
    if (!fs.existsSync(VOLUMIO_KIOSK_BAK_PATH)) {
      self.logger.info("Stylish Player: Backing up " + VOLUMIO_KIOSK_PATH + " to " + VOLUMIO_KIOSK_BAK_PATH);
      execSync("echo volumio | sudo -S mkdir -p \"" + require("path").dirname(VOLUMIO_KIOSK_BAK_PATH) + "\"");
      execSync("echo volumio | sudo -S cp \"" + VOLUMIO_KIOSK_PATH + "\" \"" + VOLUMIO_KIOSK_BAK_PATH + "\"");
    }
    execSync("echo volumio | sudo -S sed -i 's|localhost:3000|localhost:" + port + "|g' \"" + VOLUMIO_KIOSK_PATH + "\"");
    self.commandRouter.pushToastMessage("success", "Stylish Player", "Kiosk set to Stylish Player. The display will refresh shortly.");
    self.restartKioskService();
  } catch (error) {
    self.logger.error("Stylish Player: Error setting kiosk to Stylish Player: " + error.message);
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Failed to configure kiosk: " + error.message);
  }
  self.refreshUI();
  return libQ.resolve();
};

ControllerStylishPlayer.prototype.kioskRestoreDefault = function () {
  var self = this;
  var port = self.config.get("port", 3339);
  try {
    if (fs.existsSync(VOLUMIO_KIOSK_BAK_PATH)) {
      execSync("echo volumio | sudo -S cp \"" + VOLUMIO_KIOSK_BAK_PATH + "\" \"" + VOLUMIO_KIOSK_PATH + "\"");
    } else {
      execSync("echo volumio | sudo -S sed -i 's|localhost:" + port + "|localhost:3000|g' \"" + VOLUMIO_KIOSK_PATH + "\"");
    }
    self.commandRouter.pushToastMessage("success", "Stylish Player", "Kiosk restored to default. The display will refresh shortly.");
    self.restartKioskService();
  } catch (error) {
    self.logger.error("Stylish Player: Error restoring kiosk default: " + error.message);
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Failed to restore kiosk default: " + error.message);
  }
  self.refreshUI();
  return libQ.resolve();
};

ControllerStylishPlayer.prototype.kioskRestoreFromBackup = function () {
  var self = this;
  if (!fs.existsSync(VOLUMIO_KIOSK_BAK_PATH)) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Backup not found at " + VOLUMIO_KIOSK_BAK_PATH);
    self.refreshUI();
    return libQ.resolve();
  }
  try {
    execSync("echo volumio | sudo -S cp \"" + VOLUMIO_KIOSK_BAK_PATH + "\" \"" + VOLUMIO_KIOSK_PATH + "\"");
    self.commandRouter.pushToastMessage("success", "Stylish Player", "Kiosk restored from backup. The display will refresh shortly.");
    self.restartKioskService();
  } catch (error) {
    self.logger.error("Stylish Player: Error restoring kiosk from backup: " + error.message);
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Failed to restore from backup: " + error.message);
  }
  self.refreshUI();
  return libQ.resolve();
};

ControllerStylishPlayer.prototype.restartKioskService = function () {
  var self = this;
  try {
    // systemctl is-active --quiet exits 0 when active, non-zero otherwise (no sudo needed for status)
    execSync("systemctl is-active --quiet " + VOLUMIO_KIOSK_SERVICE_NAME);
    // If we reach here the service is active; restart it asynchronously
    self.commandRouter.pushToastMessage("info", "Stylish Player", "Restarting Volumio Kiosk service...");
    exec("/usr/bin/sudo /bin/systemctl restart " + VOLUMIO_KIOSK_SERVICE_NAME,
      { uid: 1000, gid: 1000 },
      function (error) {
        if (error) {
          self.logger.error("Stylish Player: Failed to restart kiosk service: " + error.message);
          self.commandRouter.pushToastMessage("error", "Stylish Player", "Failed to restart Volumio Kiosk service.");
        }
      }
    );
  } catch (e) {
    // Service is not active — nothing to restart
  }
};

ControllerStylishPlayer.prototype.configSaveIdleScreen = function (data) {
  var self = this;

  self.logger.info("Stylish Player: configSaveIdleScreen called with data: " + JSON.stringify(data));

  var idleScreen = data["idleScreen"] ? data["idleScreen"].value : "analogClock";
  var idleTimeout = parseInt(data["idleTimeout"], 10);

  if (isNaN(idleTimeout) || idleTimeout < 1) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Idle timeout must be at least 1 minute.");
    return;
  }

  self.config.set("idleScreen", idleScreen);
  self.config.set("idleTimeout", idleTimeout);
  self.config.set("externalUrl", (data["externalUrl"] || "").toString().trim());
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Idle screen settings saved.");

  self.broadcastConfig();
};

ControllerStylishPlayer.prototype.configSaveWallpaper = function (data) {
  var self = this;

  self.config.set("unsplashApiKey", (data["unsplashApiKey"] || "").toString().trim());
  self.config.set("wallpaperUrl", (data["wallpaperUrl"] || "").toString().trim());
  self.config.set("wallpaperShowTime", data["wallpaperShowTime"] !== false);
  self.config.set("wallpaperShowWeather", data["wallpaperShowWeather"] !== false);
  var slideshowInterval = parseInt(data["slideshowInterval"], 10);
  self.config.set("slideshowInterval", isNaN(slideshowInterval) || slideshowInterval < 5 ? 30 : slideshowInterval);
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Wallpaper settings saved.");

  self.broadcastConfig();
};

ControllerStylishPlayer.prototype.configSaveClock = function (data) {
  var self = this;

  self.config.set("use24Hour", data["use24Hour"] === true || data["use24Hour"] === "true");
  self.config.set("wallpaperShowSeconds", data["wallpaperShowSeconds"] === true || data["wallpaperShowSeconds"] === "true");
  self.config.set("showWeatherInClock", data["showWeatherInClock"] !== false);
  self.config.set("analogClockShowDate", data["analogClockShowDate"] !== false);
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Clock settings saved.");

  self.broadcastConfig();
};
