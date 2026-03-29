"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var http = require("http");
var path = require("path");
var os = require("os");
var execSync = require("child_process").execSync;

// Kiosk constants
var VOLUMIO_KIOSK_PATH = "/opt/volumiokiosk.sh";
var VOLUMIO_KIOSK_BAK_PATH = "/opt/volumiokiosk.sh.bak";
var VOLUMIO_KIOSK_SERVICE_NAME = "volumio-kiosk";

module.exports = ControllerStylishPlayer;

function ControllerStylishPlayer(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  this.server = null;
}

ControllerStylishPlayer.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, "config.json");
  this.config = new (require("v-conf"))();
  this.config.loadFile(configFile);

  return libQ.resolve();
};

ControllerStylishPlayer.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

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

  return libQ.resolve();
};

ControllerStylishPlayer.prototype.onRestart = function () {
  // Optional
};

// Server Management -------------------------------------------------------------------

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

      // Populate kiosk section (index 6)
      uiconf.sections[6].content[0].value = self.config.get("kioskEnabled", false);

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

  self.config.set("port", port);

  self.logger.info("Stylish Player: Port saved. Old: " + oldPort + ", New: " + port);

  self.commandRouter.pushToastMessage("success", "Stylish Player", "Settings saved.");

  if (oldPort !== port) {
    self.stopServer();
    self.startServer();
    // If kiosk mode is active, update the kiosk script with the new port
    if (self.config.get("kioskEnabled", false)) {
      try {
        execSync("sudo sed -i 's|localhost:" + oldPort + "|localhost:" + port + "|g' " + VOLUMIO_KIOSK_PATH);
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
    if (content.indexOf("localhost:3000") !== -1) {
      return { exists: true, display: "default" };
    }
    if (content.indexOf("localhost:" + port) !== -1) {
      return { exists: true, display: "stylishPlayer" };
    }
    return { exists: true, display: "unknown" };
  } catch (error) {
    self.logger.error("Stylish Player: Error reading Volumio Kiosk script: " + error.message);
    return { exists: false };
  }
};

ControllerStylishPlayer.prototype.configureKiosk = function (enable) {
  var self = this;
  var port = self.config.get("port", 3339);
  try {
    if (enable) {
      if (!fs.existsSync(VOLUMIO_KIOSK_BAK_PATH)) {
        self.logger.info("Stylish Player: Backing up " + VOLUMIO_KIOSK_PATH + " to " + VOLUMIO_KIOSK_BAK_PATH);
        execSync("sudo cp " + VOLUMIO_KIOSK_PATH + " " + VOLUMIO_KIOSK_BAK_PATH);
      }
      execSync("sudo sed -i 's|localhost:3000|localhost:" + port + "|g' " + VOLUMIO_KIOSK_PATH);
      self.commandRouter.pushToastMessage("success", "Stylish Player", "Kiosk mode enabled.");
    } else {
      if (fs.existsSync(VOLUMIO_KIOSK_BAK_PATH)) {
        execSync("sudo cp " + VOLUMIO_KIOSK_BAK_PATH + " " + VOLUMIO_KIOSK_PATH);
      } else {
        execSync("sudo sed -i 's|localhost:" + port + "|localhost:3000|g' " + VOLUMIO_KIOSK_PATH);
      }
      self.commandRouter.pushToastMessage("success", "Stylish Player", "Kiosk mode disabled.");
    }
    self.restartKioskService();
  } catch (error) {
    self.logger.error("Stylish Player: Error configuring kiosk: " + error.message);
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Failed to configure kiosk mode.");
    throw error;
  }
};

ControllerStylishPlayer.prototype.restartKioskService = function () {
  var self = this;
  try {
    var result = execSync("systemctl is-active " + VOLUMIO_KIOSK_SERVICE_NAME).toString().trim();
    if (result === "active") {
      self.commandRouter.pushToastMessage("info", "Stylish Player", "Restarting Volumio Kiosk service...");
      execSync("sudo systemctl restart " + VOLUMIO_KIOSK_SERVICE_NAME);
    }
  } catch (e) {
    // systemctl is-active exits non-zero when the service is inactive; that is expected and not an error
  }
};

ControllerStylishPlayer.prototype.configSaveKiosk = function (data) {
  var self = this;
  var kioskEnabled = data["kioskEnabled"] === true;
  var currentlyEnabled = self.config.get("kioskEnabled", false);

  var kiosk = self.checkVolumioKiosk();
  if (!kiosk.exists) {
    self.commandRouter.pushToastMessage("error", "Stylish Player", "Volumio Kiosk script not found. Is the kiosk service installed?");
    return;
  }

  self.config.set("kioskEnabled", kioskEnabled);

  if (kioskEnabled !== currentlyEnabled) {
    try {
      self.configureKiosk(kioskEnabled);
    } catch (e) {
      // Error already toasted inside configureKiosk
    }
  } else {
    self.commandRouter.pushToastMessage("success", "Stylish Player", "Kiosk settings saved.");
  }

  self.refreshUI();
};

ControllerStylishPlayer.prototype.configSaveIdleScreen = function (data) {
  var self = this;

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
  self.config.set("wallpaperShowSeconds", data["wallpaperShowSeconds"] === true);
  self.config.set("wallpaperShowWeather", data["wallpaperShowWeather"] !== false);
  self.config.set("externalUrl", (data["externalUrl"] || "").toString().trim());
  var slideshowInterval = parseInt(data["slideshowInterval"], 10);
  self.config.set("slideshowInterval", isNaN(slideshowInterval) || slideshowInterval < 5 ? 30 : slideshowInterval);
  self.commandRouter.pushToastMessage("success", "Stylish Player", "Idle screen settings saved.");

  self.broadcastConfig();
};
