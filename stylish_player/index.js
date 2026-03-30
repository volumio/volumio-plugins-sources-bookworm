"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var http = require("http");
var path = require("path");
var os = require("os");
const { spawn, spawnSync, exec, execSync } = require('child_process');
var STREAM_PORT = 8000;
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
  const output = spawnSync(
    `lsof -i tcp:${port} | awk '{print $2}' |grep --invert PID`,
    { shell: true }
  )
  if (output.error) {
    self.logger.error('Stylish Player: ' + output.error)
    return
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

ControllerStylishPlayer.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, "config.json");
  this.config = new (require("v-conf"))();
  this.config.loadFile(configFile);

  return libQ.resolve();
};

ControllerStylishPlayer.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();
// 1. Update ALSA first (Synchronous or returns promise)
  self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'updateALSAConfigFile');
  self.loadalsastuff();
  self.streamOutViz();
  // 2. Start the sequence

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

// Server Management -------------------------------------------------------------------
ControllerStylishPlayer.prototype.loadalsastuff = function () {
  // execSync(`rm /tmp/stream.mp3 || true`, {
  //   uid: 1000,
  //   gid: 1000
  // });
  const self = this;
  var defer = libQ.defer();
  try {
    execSync(`/usr/bin/mkfifo -m 646 /tmp/stream.mp3`, {
      uid: 1000,
      gid: 1000
    });
    defer.resolve();
  } catch (err) {
    self.logger.error(' ----failed to create fifo :' + err);
    defer.reject(err);
  }
  return defer.promise;
};

/**
 * Self-contained logic to host an HTTP server and stream ALSA pipe data.
 */
ControllerStylishPlayer.prototype.streamOutViz = function () {
  var self = this;


  this.pipePath = '/tmp/stream.mp3';

  if (self.audioServer) return;

  self.audioServer = http.createServer(function (req, res) {
    self.logger.info('Stylish Player: Received request for ' + req.url);
    if (req.url === '/stream' || req.url === '/') {

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache, no-store'
      });

      var ffmpeg;
      var isConnected = true;

      // Function to spawn (and re-spawn) FFmpeg
      var startFfmpeg = function () {
        if (!isConnected) return;

        self.logger.info("Stylish Player: Starting FFmpeg instance");

        ffmpeg = spawn('ffmpeg', [
          '-f', 's16le', '-ar', '44100', '-ac', '2',
          '-i', self.pipePath,
          '-codec:a', 'libmp3lame', '-b:a', '128k',
          '-f', 'mp3', 'pipe:1'
        ]);

        // Push data chunks to the HTTP response
        ffmpeg.stdout.on('data', function (chunk) {
          self.logger.info('Stylish Player: FFmpeg output chunk of size ' + chunk.length);
          if (isConnected) res.write(chunk);
        });

        // Restart logic: if FFmpeg exits, wait 1 second and try again
        ffmpeg.on('exit', function (code) {
          self.logger.info("Stylish Player: FFmpeg exited with code " + code + ". Restarting...");
          if (isConnected) {
            setTimeout(startFfmpeg, 1000);
          }
        });

        ffmpeg.on('error', function (err) {
          self.logger.error("Stylish Player: FFmpeg error: " + err);
        });
      };

      // Initial start
      startFfmpeg();

      // Stop everything when the browser/client disconnects
      req.on('close', function () {
        self.logger.info("Stylish Player: Stream client disconnected");
        isConnected = false;
        if (ffmpeg) ffmpeg.kill('SIGTERM');
        res.end();
      });

    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  const pid = self.checkPort(STREAM_PORT);
  if (pid) {
    self.logger.info("Stylish Player: Audio server already running on port " + STREAM_PORT + " (pid " + pid + ")");
    defer.resolve();
  } else {
    self.logger.info("Stylish Player: Starting audio server on port " + STREAM_PORT);
    self.audioServer.on('error', function (err) {
      self.logger.error("Stylish Player: Audio server error: " + err);
      defer.reject(err);
    });
    self.audioServer.listen(STREAM_PORT, function () {
      self.logger.info("Stylish Player: Resilient Audio Streamer on port " + STREAM_PORT);
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
  };

  self.server = http.createServer(function (req, res) {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse the URL and resolve to prevent directory traversal
    var urlPath = new URL(req.url, "http://localhost").pathname;

    // API endpoint: return saved plugin config as JSON
    if (urlPath === "/api/config") {
      var configData = {
        playerType: self.config.get("playerType", "albumArt"),
        theme: self.config.get("theme", "skeuomorphic"),
        showPlayerControls: self.config.get("showPlayerControls", true),
        vizType: self.config.get("vizType", "spectrum"),
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
      };
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(configData));
      return;
    }

    var safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    var filePath = path.join(distPath, safePath);

    // Ensure the resolved path is within distPath
    if (!filePath.startsWith(distPath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Default to index.html for SPA routing
    if (safePath === "/" || safePath === "") {
      filePath = path.join(distPath, "index.html");
    }

    fs.stat(filePath, function (err, stats) {
      if (err || !stats.isFile()) {
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

      fs.readFile(filePath, function (readErr, data) {
        if (readErr) {
          res.writeHead(500);
          res.end("Internal Server Error");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType });
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

  if (self.audioServer) {
    self.audioServer.close();
    self.audioServer = null;
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
    vizType: self.config.get("vizType", "spectrum"),
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
  };
  self.commandRouter.broadcastMessage("pushStylishPlayerConfig", configData);
  self.logger.info("Stylish Player: Broadcasted config update: " + JSON.stringify(configData));
};

// Configuration Methods ----------------------------------------------------------------

ControllerStylishPlayer.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;

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

      // Populate viz type select (Index 3)
      var vizType = self.config.get("vizType", "spectrum");
      var vizTypeOptions = uiconf.sections[2].content[3].options;
      var matchVizType = vizTypeOptions.find(function (opt) {
        return opt.value === vizType;
      });
      if (matchVizType) {
        uiconf.sections[2].content[3].value = matchVizType;
      }

      // Populate location section (index 3)
      uiconf.sections[3].content[0].value = self.config.get("latitude", "");
      uiconf.sections[3].content[1].value = self.config.get("longitude", "");

      // Populate weather section (index 4)
      uiconf.sections[4].content[0].value = self.config.get("weatherApiKey", "");
      var unitSystem = self.config.get("unitSystem", "metric");
      var unitSystemOptions = uiconf.sections[4].content[1].options;
      var matchUnitSystem = unitSystemOptions.find(function (opt) {
        return opt.value === unitSystem;
      });
      if (matchUnitSystem) {
        uiconf.sections[4].content[1].value = matchUnitSystem;
      }

      // Populate idle screen section (index 5)
      var idleScreen = self.config.get("idleScreen", "analogClock");
      var idleScreenOptions = uiconf.sections[5].content[0].options;
      var matchIdleScreen = idleScreenOptions.find(function (opt) {
        return opt.value === idleScreen;
      });
      if (matchIdleScreen) {
        uiconf.sections[5].content[0].value = matchIdleScreen;
      }
      uiconf.sections[5].content[1].value = self.config.get("externalUrl", "");
      uiconf.sections[5].content[2].value = self.config.get("idleTimeout", 5);
      uiconf.sections[5].content[3].value = self.config.get("showWeatherInClock", true);
      uiconf.sections[5].content[4].value = self.config.get("analogClockShowDate", true);
      uiconf.sections[5].content[5].value = self.config.get("unsplashApiKey", "");
      uiconf.sections[5].content[6].value = self.config.get("wallpaperUrl", "");
      uiconf.sections[5].content[7].value = self.config.get("wallpaperShowTime", true);
      uiconf.sections[5].content[8].value = self.config.get("wallpaperShowSeconds", false);
      uiconf.sections[5].content[9].value = self.config.get("wallpaperShowWeather", true);
      uiconf.sections[5].content[10].value = self.config.get("slideshowInterval", 30);
      uiconf.sections[5].content[11].value = self.config.get("use24Hour", false);

      // Populate kiosk section (index 6) — content is built dynamically based on current kiosk state
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
      uiconf.sections[6].description = kioskDesc;
      if (kioskButton) {
        uiconf.sections[6].content = [kioskButton];
      }

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
  var vizType = data["vizType"] ? data["vizType"].value : "spectrum";

  self.config.set("theme", theme);
  self.config.set("playerType", playerType);
  self.config.set("showPlayerControls", showPlayerControls);
  self.config.set("vizType", vizType);
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Player configuration saved.");

  self.broadcastConfig();
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

  var apiKey = (data["weatherApiKey"] || "").toString().trim();
  var unitSystem = data["unitSystem"] ? data["unitSystem"].value : "metric";

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

  if (isNaN(idleTimeout) || idleTimeout < 0) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Idle timeout must be 0 or greater.");
    return;
  }

  self.config.set("idleScreen", idleScreen);
  self.config.set("idleTimeout", idleTimeout);
  self.config.set("showWeatherInClock", data["showWeatherInClock"] !== false);
  self.config.set("analogClockShowDate", data["analogClockShowDate"] !== false);
  self.config.set("unsplashApiKey", (data["unsplashApiKey"] || "").toString().trim());
  self.config.set("wallpaperUrl", (data["wallpaperUrl"] || "").toString().trim());
  self.config.set("wallpaperShowTime", data["wallpaperShowTime"] !== false);
  self.config.set("wallpaperShowSeconds", data["wallpaperShowSeconds"] === true || data["wallpaperShowSeconds"] === "true");
  self.config.set("wallpaperShowWeather", data["wallpaperShowWeather"] !== false);
  self.config.set("externalUrl", (data["externalUrl"] || "").toString().trim());
  var slideshowInterval = parseInt(data["slideshowInterval"], 10);
  self.config.set("slideshowInterval", isNaN(slideshowInterval) || slideshowInterval < 5 ? 30 : slideshowInterval);
  self.config.set("use24Hour", data["use24Hour"] === true || data["use24Hour"] === "true");
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Idle screen settings saved.");

  self.broadcastConfig();
};
