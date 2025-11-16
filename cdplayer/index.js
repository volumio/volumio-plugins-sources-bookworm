/// <reference path="./types.js" />
"use strict";
var libQ = require("kew");
const { listCD, pRetry, detectCdDevice } = require("./lib/utils");
const {
  fetchCdMetadata,
  decorateItems,
  getAlbumartUrl,
} = require("./lib/metadata");
const { createTrayWatcher } = require("./lib/tray-watcher");
const { promisify } = require("util");
const { exec } = require("child_process");
const execAsync = promisify(exec);

module.exports = cdplayer;

const SERVICE_FILE = "cdplayer_stream.service";
const CD_HTTP_BASE_URL = "http://127.0.0.1:8088/wav/track/";

function cdplayer(context) {
  var self = this;

  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  /** @type {CdTrack[]|null} */
  this._items = null;
  /** @type {TrayWatcher|null} */
  this._trayWatcher = null;
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

  execAsync(`sudo /bin/systemctl enable --now ${SERVICE_FILE}`)
    .then(() => self.log("Daemon service started"))
    .catch((err) => self.error("Failed to start Daemon: " + err.message))
    .finally(() => defer.resolve());

  try {
    if (!self._trayWatcher || !self._trayWatcher.isRunning()) {
      const device = detectCdDevice();
      const trayConfig = getTrayWatcherConfiguration(self, device);
      self._trayWatcher = createTrayWatcher(trayConfig);
      self._trayWatcher.start();
    }
  } catch (e) {
    self.error("Tray watcher failed to start: " + e.message);
  }

  return defer.promise;
};

cdplayer.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  self._items = null;
  self.removeToBrowseSources();

  execAsync(`sudo /bin/systemctl disable --now ${SERVICE_FILE}`)
    .then(() => self.log("Daemon service stopped"))
    .catch((err) => self.error("Failed to stop Daemon: " + err.message))
    .finally(() => defer.resolve());

  if (this._trayWatcher) {
    this._trayWatcher.stop();
  }
  return defer.promise;
};

cdplayer.prototype.onRestart = function () {
  var self = this;
  var defer = libQ.defer();

  execAsync(`sudo /bin/systemctl restart ${SERVICE_FILE}`)
    .then(() => self.log("Daemon service restarted"))
    .catch((err) => self.error("Failed to restart Daemon: " + err.message))
    .finally(() => defer.resolve());

  try {
    if (self._trayWatcher) {
      self._trayWatcher.stop();
    }
    const device = detectCdDevice();
    const trayConfig = getTrayWatcherConfiguration(self, device);
    self._trayWatcher = createTrayWatcher(trayConfig);
    self._trayWatcher.start();
    self.log("Tray watcher restarted");
  } catch (e) {
    self.error("Tray watcher failed to start: " + e.message);
  }

  return defer.promise;
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
    self.log("Using cached CD track list");
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
        const albumart = getAlbumartUrl(meta.releaseId);
        decoratedItems = decorateItems(items, meta, albumart);
        self.removeToBrowseSources();
        self.addToBrowseSources(albumart);
      } else {
        self.log("No CD metadata found, retrying in background");
        void retryFetchMetadata(items, self);
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
      uri: `${CD_HTTP_BASE_URL}${n}`,
    };

    defer.resolve([track]);
    return defer.promise;
  }

  defer.resolve([]);
  return defer.promise;
};

cdplayer.prototype.search = function (query) {
  const self = this;
  const defer = libQ.defer();

  if (!self._items) {
    defer.resolve(null);
    return defer.promise;
  }

  if (!query || !query.value) {
    defer.resolve(null);
    return defer.promise;
  }

  try {
    // TODO: WORKS fine bu needs to clear when serach is empty.
    self.log(JSON.stringify(query, null, 2));
    const resultItems = getResultItems(self._items, query.value);
    const list = [
      {
        type: "title",
        title: "Search results",
        availableListViews: ["list"],
        items: resultItems,
      },
    ];

    self.log(`Search results: ${JSON.stringify(list)}`);
    defer.resolve(list);
  } catch (err) {
    self.error(`[CDPlayer] Search error: ${err.message}`);
    defer.reject(err);
  }

  return defer.promise;
};

/**
 * Filters CD tracks based on a query string.
 * Matches are case-insensitive and partial (substring-based).
 *
 * @param {CdTrack[]} items - Array of track objects.
 * @param {string} query - The search query.
 * @returns {CdTrack[]} Filtered array of matching tracks.
 */
function getResultItems(items, query) {
  if (!items || !Array.isArray(items) || !query) return [];

  const q = query.trim().toLowerCase();

  return items.filter((item) => {
    const titleMatch = item.title?.toLowerCase().includes(q);
    const artistMatch = item.artist?.toLowerCase().includes(q);
    const albumMatch = item.album?.toLowerCase().includes(q);
    return titleMatch || artistMatch || albumMatch;
  });
}

function retryFetchMetadata(items, self) {
  void pRetry(
    async () => {
      const meta = await fetchCdMetadata();
      if (!meta) {
        throw new Error();
      }
      const albumart = getAlbumartUrl(meta.releaseId);
      const decoratedItems = decorateItems(items, meta, albumart);
      self.removeToBrowseSources();
      self.addToBrowseSources(albumart);
      self._items = decoratedItems;
    },
    {
      delay: 700,
      maxAttempts: 3,
      logger: self,
    }
  );
}

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

/**
 * Build configuration object for tray watcher.
 * Extracted to keep onStart concise.
 * @param {any} self Plugin instance (for logging & callbacks)
 * @param {string|null} device Detected device path
 * @returns {TrayWatcherOptions}
 */
function getTrayWatcherConfiguration(self, device) {
  return {
    logger: self,
    device,
    onEvent: function () {},
    onEject: function () {
      self.log("Eject detected ... ");
      // Drop CD track cache so next browse forces a re-scan
      self._items = null;

      try {
        const state = self.commandRouter.volumioGetState();
        self.log(`Current state: ${JSON.stringify(state)}`);

        const isCdStream =
          state &&
          state.service === "mpd" &&
          typeof state.uri === "string" &&
          state.uri.indexOf(CD_HTTP_BASE_URL) === 0;

        if (isCdStream) {
          self.log("Stopping CD playback due to eject event");
          self.commandRouter.volumioStop();
          self.commandRouter.volumioClearQueue();
        }
      } catch (e) {
        self.log("Error stopping playback on eject: " + e.message);
      }

      // Refresh browse source so albumart resets to the default icon
      try {
        self.removeToBrowseSources();
        self.addToBrowseSources();
      } catch (e) {
        self.log("Error refreshing browse sources after eject: " + e.message);
      }
    },
  };
}
