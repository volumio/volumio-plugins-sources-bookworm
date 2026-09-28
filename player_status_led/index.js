"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var gpiox = require("@iiot2k/gpiox");
var io = require("socket.io-client");

const PLUGIN_NAME = "Player Status LED";
const DEFAULT_SETTINGS = {
  gpioPin: 22,
  activeState: 0,
  blinkPeriodMs: 1000,
};
const SETTINGS_BOUNDS = {
  gpioPin: { min: 2, max: 27 },
  activeState: { min: 0, max: 1 },
  // gpiox's native blink_gpio(pin, t) toggles every t ms (t is a half-cycle, not the full
  // on/off period), and its supported range for t is 100-2000ms. We expose the full period
  // to the user, so our bounds are double the library's: 200-4000ms. See blinkLed().
  blinkPeriodMs: { min: 200, max: 4000 },
};
const FIELD_LABEL_KEYS = {
  gpioPin: "GPIO_PIN_LBL",
  activeState: "ACTIVE_STATE_LBL",
  blinkPeriodMs: "BLINK_PERIOD_LBL",
};

module.exports = StatusLEDController;

function StatusLEDController(context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;
  self.socket = undefined;
  self.activeLed = undefined;
  self.lifecycleGeneration = 0;
  self.startupDefer = undefined;
}

StatusLEDController.prototype.onVolumioStart = function () {
  var self = this;

  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context,
    "config.json",
  );

  // this needs to be here to load config, not in global var declarations.
  self.config = new (require("v-conf"))();
  self.config.loadFile(configFile);
  self.log("Initialized");

  return libQ.resolve();
};

StatusLEDController.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();
  var generation = ++self.lifecycleGeneration;
  var settled = false;
  self.startupDefer = defer;

  self.loadI18nStrings();

  var sock;
  try {
    self.initLed(undefined);
    sock = self.socket = io.connect("http://localhost:3000");
  } catch (err) {
    self.startupDefer = undefined;
    self.releaseLed();
    return libQ.reject(err);
  }

  var failStart = function (err) {
    if (settled) {
      // A later reconnect attempt failed after startup already settled; log it instead of
      // silently dropping it so repeated connection trouble stays visible.
      self.log("websocket reconnect failed: " + String(err));
      return;
    }
    settled = true;
    self.startupDefer = undefined;
    if (generation !== self.lifecycleGeneration) {
      defer.reject("startup cancelled");
      return;
    }
    self.log("websocket connection error: " + String(err));
    self.cleanupSocket();
    self.releaseLed();
    defer.reject(err);
  };

  // Registered once per socket instance: the underlying socket auto-reconnects and re-fires
  // 'connect' on the same instance, so handlers added inside the 'connect' callback would
  // otherwise accumulate on every reconnect. connect_error uses .on (not .once) so every
  // failed reconnect attempt is logged, not just the first one ever seen.
  sock.on("connect_error", failStart);
  sock.on("error", (err) => self.log("websocket error: " + err));
  sock.on("pushState", self.statusChanged.bind(self));
  sock.on("connect", () => {
    if (generation !== self.lifecycleGeneration) return;
    self.log("connected to websocket");
    sock.emit("getState", "");
    if (!settled) {
      settled = true;
      self.startupDefer = undefined;
      defer.resolve();
    }
  });

  return defer.promise;
};

StatusLEDController.prototype.onStop = function () {
  var self = this;

  self.lifecycleGeneration++;
  if (self.startupDefer) {
    self.startupDefer.reject("startup cancelled");
    self.startupDefer = undefined;
  }

  self.cleanupSocket();
  return self.releaseLed();
};

StatusLEDController.prototype.cleanupSocket = function () {
  var self = this;
  if (!self.socket) return;
  self.socket.removeAllListeners();
  self.socket.disconnect();
  self.socket = undefined;
};

// Player status has changed (might not always be play or pause action)
StatusLEDController.prototype.statusChanged = function (state) {
  var self = this;
  var currentLed = self.activeLed;
  if (!currentLed || !state || typeof state.status !== "string") return;

  if (currentLed.playerState == state.status) {
    return;
  }

  self.log(`player state update: ${currentLed.playerState} -> ${state.status}`);

  switch (state.status) {
    case "play":
      //self.log("turning LED on");
      self.writeLed(currentLed, 1);
      break;
    case "pause":
      //self.log("starting to blink LED");
      self.blinkLed(currentLed);
      break;
    default:
      //self.log("turning LED off");
      self.writeLed(currentLed, 0);
  }

  currentLed.playerState = state.status;
};

// Reads the current gpioPin/activeState/blinkPeriodMs settings
StatusLEDController.prototype.getCurrentSettings = function () {
  var self = this;
  return {
    gpioPin: self.config.get("gpioPin", DEFAULT_SETTINGS.gpioPin),
    activeState: self.config.get("activeState", DEFAULT_SETTINGS.activeState),
    blinkPeriodMs: self.config.get(
      "blinkPeriodMs",
      DEFAULT_SETTINGS.blinkPeriodMs,
    ),
  };
};

// gpiox reports failures (bad pin, chip error, busy, etc.) via a false return value rather than
// throwing, so every gpiox call below is wrapped with this to surface errors to our catch blocks.
StatusLEDController.prototype.checkGpioResult = function (ok) {
  if (!ok) throw new Error(gpiox.error_text());
};

// initialize LED gpio to the one stored in the config
StatusLEDController.prototype.initLed = function (settings) {
  var self = this;
  var config = settings || self.getCurrentSettings();
  var gpioPin = Number(config.gpioPin);
  var activeState = Number(config.activeState);
  var blinkPeriodMs = Number(config.blinkPeriodMs);
  if (!self.isValidSettings(gpioPin, activeState, blinkPeriodMs)) {
    gpioPin = DEFAULT_SETTINGS.gpioPin;
    activeState = DEFAULT_SETTINGS.activeState;
    blinkPeriodMs = DEFAULT_SETTINGS.blinkPeriodMs;
  }
  var pendingLed = {
    pin: gpioPin,
    activeState: Boolean(activeState),
    period: blinkPeriodMs,
    playerState: undefined,
    released: false,
  };

  self.log("initializing GPIO");
  try {
    self.checkGpioResult(
      gpiox.init_gpio(
        pendingLed.pin,
        gpiox.GPIO_MODE_OUTPUT,
        pendingLed.activeState ^ 1,
      ),
    );
  } catch (err) {
    self.activeLed = undefined;
    throw err;
  }
  self.activeLed = pendingLed;
};

// release the currently active LED gpio
StatusLEDController.prototype.releaseLed = function () {
  var self = this;
  var defer = libQ.defer();
  var releasedLed = self.activeLed;
  if (!releasedLed) {
    defer.resolve();
    return defer.promise;
  }
  releasedLed.released = true;
  self.activeLed = undefined;

  self.log("releasing GPIO");
  try {
    self.checkGpioResult(gpiox.deinit_gpio(releasedLed.pin));
    defer.resolve();
  } catch (err) {
    self.log("releasing GPIO: " + String(err));
    defer.reject(err);
  }
  return defer.promise;
};

StatusLEDController.prototype.writeLed = function (ledInstance, logicalState) {
  var self = this;
  if (!ledInstance || ledInstance.released || self.activeLed !== ledInstance)
    return;
  try {
    self.checkGpioResult(
      gpiox.set_gpio(
        ledInstance.pin,
        ledInstance.activeState ? logicalState : logicalState ^ 1,
      ),
    );
  } catch (err) {
    self.log("GPIO write failed: " + String(err));
  }
};

StatusLEDController.prototype.blinkLed = function (ledInstance) {
  var self = this;
  if (!ledInstance || ledInstance.released || self.activeLed !== ledInstance)
    return;
  try {
    // gpiox's blink_gpio toggles every given ms rather than completing a full on/off cycle in
    // that time, so halve our full-period value to get its half-cycle toggle interval.
    self.checkGpioResult(
      gpiox.blink_gpio(ledInstance.pin, Math.round(ledInstance.period / 2)),
    );
  } catch (err) {
    self.log("GPIO blink failed: " + String(err));
  }
};

StatusLEDController.prototype.isValidSettings = function (
  gpioPin,
  activeState,
  blinkPeriodMs,
) {
  var self = this;
  return (
    self.findInvalidSettingField({
      gpioPin: gpioPin,
      activeState: activeState,
      blinkPeriodMs: blinkPeriodMs,
    }) === undefined
  );
};

// Returns the name of the first setting outside its allowed range, or undefined if all are valid
StatusLEDController.prototype.findInvalidSettingField = function (settings) {
  for (var field in SETTINGS_BOUNDS) {
    var value = settings[field];
    var bounds = SETTINGS_BOUNDS[field];
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      return field;
    }
  }
  return undefined;
};

// Output to log
StatusLEDController.prototype.log = function (s) {
  var self = this;
  self.logger.info(`[${PLUGIN_NAME}] ${s}`);
};

// Settings Methods -----------------------------------------------------------------------------

StatusLEDController.prototype.saveSettings = function (data) {
  var self = this;
  var defer = libQ.defer();

  try {
    // Applying new settings tears down and reinitializes the GPIO, which cancels any in-progress
    // blink with no automatic resume, so reject the save outright while blinking is active.
    if (self.activeLed && self.activeLed.playerState === "pause") {
      var busyErr = new Error(self.getI18nString("ERROR_BLINKING_MESSAGE"));
      busyErr.toastTitle = self.getI18nString("ERROR_BLINKING_TITLE");
      busyErr.toastMessage = busyErr.message;
      throw busyErr;
    }
    var newSettings = {
      gpioPin: Number(data["gpioPin"]),
      activeState: Number(data["activeState"]),
      blinkPeriodMs: Number(data["blinkPeriodMs"]),
    };
    var invalidField = self.findInvalidSettingField(newSettings);
    if (invalidField) {
      var bounds = SETTINGS_BOUNDS[invalidField];
      var rangeErr = new Error(
        `${self.getI18nString("ERROR_OUT_OF_RANGE_MESSAGE")}${bounds.min} - ${bounds.max}`,
      );
      rangeErr.toastTitle = `${self.getI18nString(FIELD_LABEL_KEYS[invalidField])}${self.getI18nString("ERROR_OUT_OF_RANGE_TITLE")}`;
      rangeErr.toastMessage = rangeErr.message;
      throw rangeErr;
    }
    var previousSettings = self.getCurrentSettings();
    self
      .releaseLed()
      .then(() => {
        self.initLed(newSettings);
        self.config.set("gpioPin", newSettings.gpioPin);
        self.config.set("activeState", newSettings.activeState);
        self.config.set("blinkPeriodMs", newSettings.blinkPeriodMs);
        self.commandRouter.pushToastMessage(
          "success",
          self.getI18nString("SUCCESS_TITLE"),
          self.getI18nString("SUCCESS_MESSAGE"),
        );
      })
      .fail((err) => {
        try {
          self.initLed(previousSettings);
          self.updateUIConfig();
          self.commandRouter.pushToastMessage(
            "error",
            `${self.getI18nString("GPIO_PIN_LBL")}${self.getI18nString("ERROR_NOT_FOUND_TITLE")}`,
            `${self.getI18nString("ERROR_MESSAGE")}: ${String(err)}`,
          );
        } catch (rollbackErr) {
          self.updateUIConfig();
          self.commandRouter.pushToastMessage(
            "error",
            self.getI18nString("ERROR_TITLE"),
            `${self.getI18nString("ERROR_MESSAGE")}: ${String(err)}; rollback failed: ${String(rollbackErr)}`,
          );
        }
      });
  } catch (err) {
    self.updateUIConfig();
    self.commandRouter.pushToastMessage(
      "error",
      err.toastTitle || self.getI18nString("ERROR_TITLE"),
      err.toastMessage ||
        `${self.getI18nString("ERROR_MESSAGE")}: ${String(err)}`,
    );
  }

  defer.resolve();

  return defer.promise;
};

StatusLEDController.prototype.loadI18nStrings = function () {
  var self = this;

  try {
    var language_code = self.commandRouter.sharedVars.get("language_code");
    self.i18nStrings = fs.readJsonSync(
      __dirname + "/i18n/strings_" + language_code + ".json",
    );
  } catch {
    self.i18nStrings = fs.readJsonSync(__dirname + "/i18n/strings_en.json");
  }

  self.i18nStringsDefaults = fs.readJsonSync(
    __dirname + "/i18n/strings_en.json",
  );
};

StatusLEDController.prototype.getI18nString = function (key) {
  var self = this;

  if (self.i18nStrings[key] !== undefined) return self.i18nStrings[key];
  else return self.i18nStringsDefaults[key];
};

// Configuration Methods -----------------------------------------------------------------------------
StatusLEDController.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();

  const lang_code = self.commandRouter.sharedVars.get("language_code");

  self.commandRouter
    .i18nJson(
      __dirname + "/i18n/strings_" + lang_code + ".json",
      __dirname + "/i18n/strings_en.json",
      __dirname + "/UIConfig.json",
    )
    .then(function (uiconf) {
      var currentSettings = self.getCurrentSettings();
      uiconf.sections[0].content[0].value = currentSettings.gpioPin;
      uiconf.sections[0].content[1].value = currentSettings.activeState;
      uiconf.sections[0].content[2].value = currentSettings.blinkPeriodMs;
      defer.resolve(uiconf);
    })
    .fail(function (err) {
      self.logger.error(
        `Failed to parse UI Configuration page for plugin ${PLUGIN_NAME}: ${err}`,
      );
      defer.reject(err);
    });

  return defer.promise;
};

StatusLEDController.prototype.updateUIConfig = function () {
  var self = this;

  self.commandRouter
    .getUIConfigOnPlugin("system_hardware", "player_status_led", {})
    .then(function (uiconf) {
      self.commandRouter.broadcastMessage("pushUiConfig", uiconf);
    });
};

// Required stubs------------------------------------------------------------------------------

StatusLEDController.prototype.getConfigurationFiles = function () {
  return ["config.json"];
};
