"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var config = new (require("v-conf"))();
const { execFile, execSync, exec } = require("child_process");

module.exports = cdplayer;

function runCdparanoiaQ() {
  return new Promise((resolve, reject) => {
    const opts = {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 15000,
    };
    execFile(
      "/usr/bin/cdparanoia",
      ["-Q", "/dev/sr0"],
      opts,
      (err, stdout, stderr) => {
        const out = stdout && stdout.trim() ? stdout : stderr || "";
        if (!out.trim() && err) return reject(err);
        resolve(out);
      }
    );
  });
}

function parseCdparanoiaQ(out) {
  const tracks = [];
  out.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*(\d+)\.\s+\d+/); // e.g. "  1.    23581 [05:14.31]"
    if (m) tracks.push(parseInt(m[1], 10));
  });
  return tracks;
}

function cdplayer(context) {
  var self = this;

  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
}

cdplayer.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(
    this.context,
    "config.json"
  );
  this.config = new (require("v-conf"))();
  this.config.loadFile(configFile);

  return libQ.resolve();
};

cdplayer.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  self.addToBrowseSources();
  self.commandRouter.pushToastMessage(
    "success",
    "OLE!",
    "Aye caramba! You have clicked on "
  );
  self.logger.info("[MATTEO]::onStart");

  // Once the Plugin has successfull started resolve the promise
  defer.resolve();

  return defer.promise;
};

cdplayer.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  self.removeToBrowseSources();

  // Once the Plugin has successfull stopped resolve the promise
  defer.resolve();

  return libQ.resolve();
};

cdplayer.prototype.onRestart = function () {
  var self = this;
  // Optional, use if you need it
};

// Configuration Methods -----------------------------------------------------------------------------

cdplayer.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;

  var lang_code = this.commandRouter.sharedVars.get("language_code");

  self.commandRouter
    .i18nJson(
      __dirname + "/i18n/strings_" + lang_code + ".json",
      __dirname + "/i18n/strings_en.json",
      __dirname + "/UIConfig.json"
    )
    .then(function (uiconf) {
      defer.resolve(uiconf);
    })
    .fail(function () {
      defer.reject(new Error());
    });

  return defer.promise;
};

cdplayer.prototype.getConfigurationFiles = function () {
  return ["config.json"];
};

cdplayer.prototype.setUIConfig = function (data) {
  var self = this;
  //Perform your installation tasks here
};

cdplayer.prototype.getConf = function (varName) {
  var self = this;
  //Perform your installation tasks here
};

cdplayer.prototype.setConf = function (varName, varValue) {
  var self = this;
  //Perform your installation tasks here
};

// Playback Controls ---------------------------------------------------------------------------------------
// If your plugin is not a music_sevice don't use this part and delete it

cdplayer.prototype.addToBrowseSources = function () {
  // Use this function to add your music service plugin to music sources
  this.logger.info("Adding CDPlayer to Browse Sources");
  var data = {
    name: "CDPlayer",
    uri: "cdplayer",
    plugin_type: "music_service",
    plugin_name: "cdplayer",
  };
  this.commandRouter.volumioAddToBrowseSources(data);
};

cdplayer.prototype.removeToBrowseSources = function () {
  // Use this function to remove your music service plugin from music sources
  this.logger.info("Removing CDPlayer from Browse Sources");
  this.commandRouter.volumioRemoveFromBrowseSources("CDPlayer");
};

cdplayer.prototype.listCD = function () {
  const defer = libQ.defer();

  runCdparanoiaQ()
    .then((out) => {
      this.commandRouter.logger.info("[CDP] cdparanoia -Q (first lines):");
      this.commandRouter.logger.info(out.split("\n").slice(0, 8).join("\n"));

      const trackNums = parseCdparanoiaQ(out);
      this.commandRouter.logger.info(
        "[CDP] parsed tracks: " + JSON.stringify(trackNums)
      );

      if (trackNums.length === 0) {
        this.commandRouter.pushToastMessage(
          "error",
          "CD Player",
          "No disc or no audio tracks detected"
        );
        return defer.resolve({ navigation: { lists: [] } });
      }

      const items = trackNums.map((n) => ({
        service: "cdplayer",
        type: "song",
        title: `Track ${n}`,
        icon: "fa fa-music",
        uri: `cdplayer/${n}`,
      }));

      defer.resolve({
        navigation: {
          prev: { uri: "cdplayer" },
          lists: [{ availableListViews: ["list"], items }],
        },
      });
    })
    .catch((err) => {
      this.commandRouter.logger.error(
        "[CDP] cdparanoia -Q error: " + (err.message || err)
      );
      this.commandRouter.pushToastMessage(
        "error",
        "CD Player",
        "CD probe failed"
      );
      defer.resolve({ navigation: { lists: [] } });
    });

  return defer.promise;
};

cdplayer.prototype.handleBrowseUri = function (curUri) {
  var self = this;

  if (curUri === "cdplayer") {
    this.commandRouter.pushToastMessage("success", "test with this", `-`);
    return this.listCD();
  }

  return response;
};

// Define a method to clear, add, and play an array of tracks
cdplayer.prototype.clearAddPlayTrack = function (track) {
  var self = this;
  self.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::clearAddPlayTrack"
  );

  self.commandRouter.logger.info(JSON.stringify(track));

  return self.sendSpopCommand("uplay", [track.uri]);
};

cdplayer.prototype.seek = function (timepos) {
  this.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::seek to " + timepos
  );

  return this.sendSpopCommand("seek " + timepos, []);
};

// Stop
cdplayer.prototype.stop = function () {
  var self = this;
  self.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::stop"
  );
};

// Spop pause
cdplayer.prototype.pause = function () {
  var self = this;
  self.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::pause"
  );
};

// Get state
cdplayer.prototype.getState = function () {
  var self = this;
  self.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::getState"
  );
};

//Parse state
cdplayer.prototype.parseState = function (sState) {
  var self = this;
  self.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::parseState"
  );

  //Use this method to parse the state and eventually send it with the following function
};

// Announce updated State
cdplayer.prototype.pushState = function (state) {
  var self = this;
  self.commandRouter.pushConsoleMessage(
    "[" + Date.now() + "] " + "cdplayer::pushState"
  );

  return self.commandRouter.servicePushState(state, self.servicename);
};

cdplayer.prototype.explodeUri = function (uri) {
  var self = this;
  var defer = libQ.defer();

  // Mandatory: retrieve all info for a given URI

  return defer.promise;
};

cdplayer.prototype.getAlbumArt = function (data, path) {
  var artist, album;

  if (data != undefined && data.path != undefined) {
    path = data.path;
  }

  var web;

  if (data != undefined && data.artist != undefined) {
    artist = data.artist;
    if (data.album != undefined) album = data.album;
    else album = data.artist;

    web =
      "?web=" +
      nodetools.urlEncode(artist) +
      "/" +
      nodetools.urlEncode(album) +
      "/large";
  }

  var url = "/albumart";

  if (web != undefined) url = url + web;

  if (web != undefined && path != undefined) url = url + "&";
  else if (path != undefined) url = url + "?";

  if (path != undefined) url = url + "path=" + nodetools.urlEncode(path);

  return url;
};

cdplayer.prototype.search = function (query) {
  var self = this;
  var defer = libQ.defer();

  // Mandatory, search. You can divide the search in sections using following functions

  return defer.promise;
};

cdplayer.prototype._searchArtists = function (results) {};

cdplayer.prototype._searchAlbums = function (results) {};

cdplayer.prototype._searchPlaylists = function (results) {};

cdplayer.prototype._searchTracks = function (results) {};

cdplayer.prototype.goto = function (data) {
  var self = this;
  var defer = libQ.defer();

  // Handle go to artist and go to album function

  return defer.promise;
};
