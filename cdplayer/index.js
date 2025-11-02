"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var config = new (require("v-conf"))();
const { listCD } = require("./lib/utils");
const { fetchCdMetadata } = require("./lib/metadata");

module.exports = cdplayer;
function cdplayer(context) {
  var self = this;

  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  /** @type {CdTrack[]|null} */
  this._items = null;
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
  // TODO: the background service should be enabled on plugin enablement, not in install.sh
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

cdplayer.prototype.addToBrowseSources = function (
  albumart = "/albumart?sourceicon=music_service/cdplayer/cdplayer.png"
) {
  this.log("Adding CDPlayer to Browse Sources");
  var data = {
    name: "CDPlayer",
    uri: "cdplayer",
    plugin_type: "music_service",
    plugin_name: "cdplayer",
    albumart,
  };
  this.commandRouter.volumioAddToBrowseSources(data);
};

cdplayer.prototype.removeToBrowseSources = function () {
  this.log("Removing CDPlayer from Browse Sources");
  this.commandRouter.volumioRemoveToBrowseSources("CDPlayer");
};

cdplayer.prototype.handleBrowseUri = function (curUri) {
  const self = this;

  if (curUri !== "cdplayer") {
    return libQ.resolve(null);
  }

  if (self._items) {
    return libQ.resolve({
      navigation: {
        prev: { uri: "cdplayer" },
        lists: [
          {
            title: self._items[0]?.album || "CD Tracks",
            icon: "fa fa-music",
            availableListViews: ["list"],
            items: self._items,
          },
        ],
      },
    });
  }

  const p = (async () => {
    try {
      const items = await listCD();

      if (items.length === 0) {
        self.error("No audio tracks returned");
        self.commandRouter.pushToastMessage(
          "error",
          "CD Player",
          "Please insert an audio CD"
        );
        return { navigation: { lists: [] } };
      }

      const meta = await fetchCdMetadata();

      let decoratedItems = items;
      if (meta) {
        // eg. https://coverartarchive.org/release/2174675c-2159-4405-a3af-3a4860106b58/front
        const albumart = `https://coverartarchive.org/release/${meta.releaseId}/front-500`;
        decoratedItems = items.map((item, index) => ({
          ...item,
          album: meta.album,
          artist: meta.artist,
          title: meta.tracks[index]?.title || item.title,
          albumart,
        }));

        self.removeToBrowseSources();
        self.addToBrowseSources(albumart);
      }

      self._items = decoratedItems;

      return {
        navigation: {
          prev: { uri: "cdplayer" },
          lists: [
            {
              title: meta?.album || "CD Tracks",
              icon: "fa fa-music",
              availableListViews: ["list"],
              items: decoratedItems,
            },
          ],
        },
      };
    } catch (err) {
      self.error(`Error while listing CD tracks`);
      console.log(err);
      self.commandRouter.pushToastMessage(
        "error",
        "CD Player",
        "Error while listing CD tracks"
      );
      return { navigation: { lists: [] } };
    }
  })();

  return toKew(p);
};

cdplayer.prototype.explodeUri = function (uri) {
  const self = this;
  const defer = libQ.defer();

  // Match single track: cdplayer/1, cdplayer/2, ...
  const match = uri.match(/^cdplayer\/(\d+)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const track = {
      ...self._items[n - 1],
      service: "mpd",
      uri: `http://127.0.0.1:8088/wav/track/${n}`,
    };

    defer.resolve([track]);
    return defer.promise;
  }

  defer.resolve([]);
  return defer.promise;
};

function toKew(promise) {
  const d = libQ.defer();
  let settled = false;
  Promise.resolve(promise)
    .then((val) => {
      if (!settled) {
        settled = true;
        d.resolve(val);
      }
    })
    .catch((err) => {
      if (!settled) {
        settled = true;
        d.reject(err);
      }
    });
  return d.promise;
}
