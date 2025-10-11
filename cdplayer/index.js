"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var config = new (require("v-conf"))();
const { execFile } = require("child_process");

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

function parseDurationsFromQ(out) {
  // lines look like: "  1.     30253 [06:43.28]        0 [00:00.00] ..."
  const re = /^\s*(\d+)\.\s+(\d+)\s+\[/gm; // (trackNo). (lengthInSectors) [
  const durations = {};
  let m;
  while ((m = re.exec(out))) {
    const track = parseInt(m[1], 10);
    const sectors = parseInt(m[2], 10);
    // audio CD = 75 frames(sectors)/sec → round to whole seconds for Volumio UI
    durations[track] = Math.round(sectors / 75);
  }
  return durations;
}

function getItem(n, duration, uri, service) {
  return {
    album: "Audio CD",
    artist: "Unknown",
    trackType: "wav",
    type: "song",
    title: `Track ${n}`,
    service,
    uri,
    duration,
  };
}

function cdplayer(context) {
  var self = this;

  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  this._lastTrackNums = [];
  this._trackDurations = null;
}

cdplayer.prototype.log = function (msg) {
  var self = this;
  self.logger.info(`[CDPlayer]: ${msg}`);
};

cdplayer.prototype.error = function (err) {
  var self = this;
  self.logger.error(`[CDPlayer]: ${err}`);
};

cdplayer.prototype.onVolumioStart = function () {
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
  this.log("Adding CDPlayer to Browse Sources");
  var data = {
    name: "CDPlayer",
    uri: "cdplayer",
    plugin_type: "music_service",
    plugin_name: "cdplayer",
    albumart: "https://picsum.photos/512/512",
  };
  this.commandRouter.volumioAddToBrowseSources(data);
};

cdplayer.prototype.removeToBrowseSources = function () {
  this.log("Removing CDPlayer from Browse Sources");
  this.commandRouter.volumioRemoveFromBrowseSources("CDPlayer");
};

cdplayer.prototype.listCD = function () {
  const defer = libQ.defer();

  runCdparanoiaQ()
    .then((out) => {
      this.log(`Asked cdparanoia -Q, got ${out.length} bytes of output`);
      const trackNums = parseCdparanoiaQ(out);
      this.log(`Parsed tracks: ${JSON.stringify(trackNums)}`);

      this._lastTrackNums = trackNums;

      if (trackNums.length === 0) {
        this.error(`No audio tracks returned`);
        this.commandRouter.pushToastMessage(
          "error",
          "CD Player",
          "Please insert an audio CD (0)"
        );
        return defer.resolve({ navigation: { lists: [] } });
      }

      this._trackDurations = parseDurationsFromQ(out);
      this.log(JSON.stringify(this._trackDurations));

      const items = trackNums.map((n) =>
        getItem(
          n,
          this._trackDurations && this._trackDurations[n],
          `cdplayer/${n}`,
          "cdplayer"
        )
      );

      defer.resolve({
        navigation: {
          prev: { uri: "cdplayer" },
          lists: [
            {
              title: "CD Tracks",
              icon: "fa fa-music",
              availableListViews: ["list"],
              items,
            },
          ],
        },
      });
    })
    .catch((err) => {
      this.error(`cdparanoia -Q error: ${err.message || err}`);
      this.commandRouter.pushToastMessage(
        "error",
        "CD Player",
        "Please insert an audio CD (1)"
      );
      defer.resolve({ navigation: { lists: [] } });
    });

  return defer.promise;
};

cdplayer.prototype.handleBrowseUri = function (curUri) {
  var self = this;
  var response;
  self.log("handleBrowseUri: " + curUri);
  if (curUri === "cdplayer") {
    response = self.listCD();
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

// Explode Uri gets called at the beggining when all tracks load for some reason. When I click play, cdplayer::clearAddPlayTrack is called instread.
// It's probably time to start again from the playAll functionality in ChatGPT
cdplayer.prototype.explodeUri = function (uri) {
  const self = this;
  self.log("explodeUri called with " + uri);

  const defer = libQ.defer();
  self.log(JSON.stringify(this._trackDurations));

  // Match single track: cdplayer/1, cdplayer/2, ...
  const match = uri.match(/^cdplayer\/(\d+)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    self.log("track " + n + " duration: " + this._trackDurations[n]);
    const track = getItem(
      n,
      this._trackDurations && this._trackDurations[n],
      `http://127.0.0.1:8088/wav/track/${n}`,
      "mpd"
    );

    defer.resolve([track]);
    return defer.promise;
  }

  // Match "Play All" synthetic item
  // if (uri === "cdplayer/playall") {
  //   const tracks = (this._lastTrackNums || []).map((n) => ({
  //     service: "mpd",
  //     type: "song",
  //     title: `Track ${n}`,
  //     uri: `http://127.0.0.1:8088/wav/track/${n}?v=1`,
  //     duration: this._trackDurations && this._trackDurations[n], // ← NEW
  //     album: "Audio CD",
  //     artist: "Unknown",
  //     trackType: "wav",
  //   }));

  //   defer.resolve(tracks);
  //   return defer.promise;
  // }

  // Fallback
  self.log("explodeUri: unknown URI " + uri);
  defer.resolve([]);
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
