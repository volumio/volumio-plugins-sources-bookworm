"use strict";

var libQ = require("kew");
var fs = require("fs-extra");
var gpiox = require("@iiot2k/gpiox");
var exec = require("child_process").exec;
var net = require("net");

const PLUGIN_NAME = "IR Activity LED"; // this plugin name string used in messages.
const LIRC_SOCKET_PATH = "/var/run/lirc/lircd"; // default location of the lirc unix domain socket.
const LED_ROOT_PATH = "/sys/class/leds/"; // hardware LED files are kept here.

// single source of truth for default settings within this file.
// config.json and UIConfig.json hold their own copies of these same defaults (static JSON, cannot reference this
// constant) and must be kept in sync with it by hand.
const DEFAULT_SETTINGS = {
  ledOutput: "pwr",
  gpioPin: 21,
  blinkPeriodMs: 70,
  blinkCycles: 3,
};

// linux kernel v6.1 changed the names of the LEDs. Dictionary is easy to update in case of further changes.
// https://github.com/raspberrypi/linux/commit/ea14f14d81943f80847dc073edd5811591d6d106
const BUILTIN_LED_ALIASES = {
  act: ["ACT", "led0"],
  pwr: ["PWR", "led1"],
};

module.exports = IRActivityLEDController;

function IRActivityLEDController(context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self.lircConnection = undefined; // listener monitoring lircd unix domain socket.
  self.activeLed = undefined; // currently initialized LED resource.
  self.reconnectTimer = undefined; // pending lirc reconnect attempt.
  self.lifecycleGeneration = 0; // invalidates stale asynchronous startup work.
}

IRActivityLEDController.prototype.onVolumioStart = function () {
  var self = this;

  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context,
    "config.json",
  );
  self.config = new (require("v-conf"))(); // this needs to be here to load config, not in global var declarations.
  self.config.loadFile(configFile);
  self.log("Initialized");

  return libQ.resolve();
};

IRActivityLEDController.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();
  const generation = ++self.lifecycleGeneration;

  self.loadI18nStrings();

  self
    .initLed(undefined, generation)
    .then(() => {
      if (generation !== self.lifecycleGeneration)
        return libQ.reject("startup cancelled");
      self.lircConnection = new net.Socket();
      return self.socketConnect(0, generation);
    })
    .then(() => defer.resolve())
    .fail((err) => {
      self.log(err);
      if (generation !== self.lifecycleGeneration) {
        defer.reject(err);
        return;
      }
      // ENOENT = Error NO ENTry or Error NO ENTity = No such file or directory. 
	  // User friendly message on no lirc.
      var errorText = String(err);
      var msg =
        errorText.indexOf("ENOENT") > -1
          ? "lirc socket not found, is IR Remote Controller plugin installed and enabled?"
          : errorText;

      if (self.reconnectTimer) {
        clearTimeout(self.reconnectTimer);
        self.reconnectTimer = undefined;
      }
      if (self.lircConnection) {
        self.lircConnection.removeAllListeners();
        self.lircConnection.destroy();
        self.lircConnection = undefined;
      }

      self
        .releaseActiveLed()
        .then(() => {
          self.commandRouter.pushToastMessage(
            "error",
            self.getI18nString("ERROR_TITLE"),
            `${PLUGIN_NAME} plugin: ${msg}`,
          );
          defer.reject(err);
        })
        .fail((cleanupErr) => {
          self.commandRouter.pushToastMessage(
            "error",
            self.getI18nString("ERROR_TITLE"),
            `${PLUGIN_NAME} plugin: ${msg}; cleanup failed: ${cleanupErr}`,
          );
          defer.reject(err);
        });
    });
  return defer.promise;
};

IRActivityLEDController.prototype.onStop = function () {
  var self = this;
  self.lifecycleGeneration++;

  if (self.reconnectTimer) {
    clearTimeout(self.reconnectTimer);
    self.reconnectTimer = undefined;
  }

  if (self.lircConnection) {
    self.lircConnection.removeAllListeners();
    self.lircConnection.destroy();
    // indicate to the connection callback the plugin is disabled. 
	// Otherwise connection attempts will continue.
    self.lircConnection = undefined;
  }

  return self.releaseActiveLed();
};

// Establish initial connection to the lircd socket or reconnect
// to previously closed one and hook up event listeners.
// Uses recursion to make several attempts to (re)connect.
// ir_controller takes a while to start, lirc is restarted in the process.
// When lirc is restarted socket closes.
// Number of attempts and delay between those are somewhat arbitrary,
// on Pi 4 lirc settle time is just below 2s.
IRActivityLEDController.prototype.socketConnect = function (
  attempt = 0,
  generation = this.lifecycleGeneration,
) {
  var self = this;
  var defer = libQ.defer();
  const maxAttempts = 20;

  if (
    generation !== self.lifecycleGeneration ||
    attempt >= maxAttempts ||
    !self.lircConnection
  ) {
    const msg = `Connecting to lirc socket failed after ${attempt} attempts`;
    self.log(msg);
    if (self.lircConnection) self.lircConnection.removeAllListeners();
    return defer.reject(msg);
  }

  const connection = self.lircConnection;
  connection.removeAllListeners();

  const errorHandler = function (err) {
    if (!self.lircConnection || self.lircConnection !== connection) {
      defer.reject("lirc reconnect cancelled");
      return;
    }
    self.log(err);
    connection.removeAllListeners();
    connection.destroy();
    self.lircConnection = new net.Socket();
    self.reconnectTimer = setTimeout(() => {
      self.reconnectTimer = undefined;
      if (self.lircConnection && generation === self.lifecycleGeneration) {
        defer.resolve(self.socketConnect(++attempt, generation));
      } else {
        defer.reject("lirc reconnect cancelled");
      }
    }, 300);
  };

  const connectHandler = function () {
    self.log("Connected to lirc socket");
    connection.on("error", (err) => self.log("lirc socket error: " + err));
    connection.off("error", errorHandler);
    connection.on("data", self.handleLircActivity.bind(self));
    connection.once("close", () => {
      self.log("lirc socket closed");
      if (
        self.lircConnection === connection &&
        generation === self.lifecycleGeneration
      ) {
        self.lircConnection = new net.Socket();
        self.socketConnect(0, generation);
      }
    });
    defer.resolve();
  };

  connection.once("error", errorHandler);
  self.log(`lirc socket connect: attempt ${attempt + 1} of ${maxAttempts}`);

  runCommand("/bin/systemctl is-active lircd")
    .then((data) => {
      self.log("lircd service status: " + data.trim());
      if (self.lircConnection === connection)
        connection.connect(LIRC_SOCKET_PATH, connectHandler);
    })
    .fail((err) =>
      errorHandler(
        "lircd service is inactive, skipping connection attempt. " + err,
      ),
    );

  return defer.promise;
};

// Fires on every raw lircd socket "data" event, without parsing its content
// (e.g. distinct keypress vs key-repeat vs other lircd notifications) - intentional,
// since the isBlinking guard below already throttles how often this can trigger a blink.
IRActivityLEDController.prototype.handleLircActivity = function () {
  var self = this;

  if (!self.activeLed || self.activeLed.isBlinking) return;
  const blinkingLed = self.activeLed;
  blinkingLed.isBlinking = true;

  blinkingLed
    .blink()
    .fail((err) => self.log(err))
    .fin(() =>
      setTimeout(() => {
        if (self.activeLed === blinkingLed) blinkingLed.isBlinking = false;
      }, 500),
    );
};

function blinkBuiltinLed(self, ledInstance, toggleIndex = 0, state) {
  if (!ledInstance || ledInstance.released || self.activeLed !== ledInstance)
    return libQ.resolve();
  if (toggleIndex == 0) state = ledInstance.defaultBrightness;
  var defer = libQ.defer();

  // ${foo} : DEBUGGING: simulate failure in the middle of the recursion
  //var foo = toggleIndex >= 4 ? 'brightness1' : 'brightness';

  (toggleIndex == 0
    ? writeFile(`${ledInstance.path}/trigger`, "none")
    : libQ.resolve()
  )
    .then(() =>
      // set trigger to none on first cycle
      ledInstance.released || self.activeLed !== ledInstance
        ? defer.resolve()
        : writeFile(
            `${ledInstance.path}/brightness`,
            (~state & 0xff).toString(),
          ),
    )
    .then(() =>
      // write inverted state
      ledInstance.released || self.activeLed !== ledInstance
        ? defer.resolve()
		// Calling resolve with a pending promise causes promise to wait on the passed promise
        : toggleIndex >= ledInstance.toggleCount
          ? defer.resolve(
              writeFile(
                `${ledInstance.path}/trigger`,
                ledInstance.defaultMode.toString(),
              ),
            ) // restore trigger on last run
          : setTimeout(
              () =>
                defer.resolve(
                  blinkBuiltinLed(
                    self,
                    ledInstance,
                    ++toggleIndex,
                    ~state & 0xff,
                  ),
                ),
              ledInstance.toggleDelayMs,
            ),
    ) // recursion
    .fail((err) => defer.reject(err));

  return defer.promise;
}

function blinkGpioLed(self, ledInstance, toggleIndex = 0, state) {
  if (!ledInstance || ledInstance.released || self.activeLed !== ledInstance)
    return libQ.resolve();
  var defer = libQ.defer();

  try {
    // gpiox reads and wrires synchronously, so no need to use promises here.
    // The gpiox library is a thin wrapper around the sysfs interface.
    if (toggleIndex == 0) state = gpiox.get_gpio(ledInstance.pin);
    state ^= 1;
    gpiox.set_gpio(ledInstance.pin, state);
    toggleIndex >= ledInstance.toggleCount
      ? defer.resolve()
      : setTimeout(
          () =>
            defer.resolve(
              blinkGpioLed(self, ledInstance, ++toggleIndex, state),
            ),
          ledInstance.toggleDelayMs,
        );
  } catch (err) {
    defer.reject(err);
  }

  return defer.promise;
}

// Translate built-in LED alias key to its current sysfs path
// (the kernel may use a different name across versions).
function getBuiltinLedPath(ledKey) {
  const ledNames = BUILTIN_LED_ALIASES[ledKey];
  if (!ledNames) return "";
  let name = ledNames.find(function (ledName) {
    return fs.existsSync(LED_ROOT_PATH + ledName);
  });

  // avoid exception, find returns undefined on no match.
  return name ? LED_ROOT_PATH + name : "";
}

function getConfigValue(config, key, legacyKey, defaultValue) {
  const value = config.get(key);
  return value !== undefined ? value : config.get(legacyKey, defaultValue);
}

// Range constraints for numeric settings, shared by saveSettings (validates user input) and initLed
// (sanitizes values already stored in config.json, e.g. from a manual edit or an older plugin version).
const SETTINGS_BOUNDS = {
  gpioPin: { min: 0, max: 200 },
  blinkPeriodMs: { min: 10, max: 500 },
  blinkCycles: { min: 1, max: 50 },
};

function isWithinBounds(key, value) {
  const bounds = SETTINGS_BOUNDS[key];
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

function isValidLedOutput(ledOutput) {
  return ledOutput === "gpio" || !!getBuiltinLedPath(ledOutput);
}

// initialize LED selected in the config
IRActivityLEDController.prototype.initLed = function (
  settings,
  generation = this.lifecycleGeneration,
) {
  var self = this;
  var defer = libQ.defer();
  var pendingLed = {};
  var initGeneration = generation;
  var ledOutput = settings
    ? settings.ledOutput
    : getConfigValue(
        self.config,
        "ledOutput",
        "output",
        DEFAULT_SETTINGS.ledOutput,
      );
  var gpioPin = settings
    ? settings.gpioPin
    : getConfigValue(
        self.config,
        "gpioPin",
        "gpionum",
        DEFAULT_SETTINGS.gpioPin,
      );
  var blinkPeriodMs = settings
    ? settings.blinkPeriodMs
    : getConfigValue(
        self.config,
        "blinkPeriodMs",
        "interval",
        DEFAULT_SETTINGS.blinkPeriodMs,
      );
  var blinkCycles = settings
    ? settings.blinkCycles
    : getConfigValue(
        self.config,
        "blinkCycles",
        "cycles",
        DEFAULT_SETTINGS.blinkCycles,
      );

  // sanitize values that may have come from config.json (e.g. a manual edit or an older plugin version);
  // settings passed in directly from saveSettings are already validated there, but re-checking is harmless.
  if (!isValidLedOutput(ledOutput)) {
    self.log(
      `Stored LED output "${ledOutput}" is invalid, falling back to default "${DEFAULT_SETTINGS.ledOutput}"`,
    );
    ledOutput = DEFAULT_SETTINGS.ledOutput;
  }
  if (!isWithinBounds("gpioPin", gpioPin)) {
    self.log(
      `Stored GPIO pin ${gpioPin} is out of range, falling back to default ${DEFAULT_SETTINGS.gpioPin}`,
    );
    gpioPin = DEFAULT_SETTINGS.gpioPin;
  }
  if (!isWithinBounds("blinkPeriodMs", blinkPeriodMs)) {
    self.log(
      `Stored blink period ${blinkPeriodMs} is out of range, falling back to default ${DEFAULT_SETTINGS.blinkPeriodMs}`,
    );
    blinkPeriodMs = DEFAULT_SETTINGS.blinkPeriodMs;
  }
  if (!isWithinBounds("blinkCycles", blinkCycles)) {
    self.log(
      `Stored blink cycles ${blinkCycles} is out of range, falling back to default ${DEFAULT_SETTINGS.blinkCycles}`,
    );
    blinkCycles = DEFAULT_SETTINGS.blinkCycles;
  }

  if (ledOutput == "gpio") {
    self.log("initializing GPIO LED");
    pendingLed.pin = gpioPin;
    try {
      gpiox.init_gpio(pendingLed.pin, gpiox.GPIO_MODE_OUTPUT, 0);
    } catch (err) {
      self.activeLed = undefined;
      defer.reject(err);
      return defer.promise;
    }
    if (initGeneration !== self.lifecycleGeneration) {
      gpiox.deinit_gpio(pendingLed.pin);
      self.activeLed = undefined;
      defer.reject("startup cancelled");
      return defer.promise;
    }
    pendingLed.blink = () => blinkGpioLed(self, pendingLed);
  } else {
    self.log("initializing built-in LED");
    pendingLed.path = getBuiltinLedPath(ledOutput);
    if (!pendingLed.path) {
      self.log("built-in LED not found");
      self.activeLed = undefined;
      defer.reject("built-in LED not found");
      return defer.promise;
    }

    pendingLed.blink = () => blinkBuiltinLed(self, pendingLed);
    var permissionsChanged = false;
    // world-writable (a+rw) because the writing process is neither root nor in the group that
    // owns these sysfs files (normally root:root, 644). Narrowing this to ug+rw would need the
    // Volumio backend process to run as, or belong to the group of, the file owner.
    runCommand(
      `/usr/bin/sudo /bin/chmod a+rw ${pendingLed.path}/brightness ${pendingLed.path}/trigger`,
    ) // set permissions
      .then(() => {
        permissionsChanged = true;
        return readFile(`${pendingLed.path}/brightness`);
      }) // read default brightness value
      .then((value) => (pendingLed.defaultBrightness = value.trim())) // store default brightness (normally 255)
      .then(() => readFile(`${pendingLed.path}/trigger`)) // read default trigger (depends on LED)
      .then((value) => {
        const activeMode = value.match(/(?<=\[)[^\][]*(?=\])/);
        if (!activeMode) throw new Error("No active LED trigger mode found");
        pendingLed.defaultMode = activeMode[0];
      }) // get bracketed selection from trigger options
      .then(() => {
        if (initGeneration !== self.lifecycleGeneration)
          throw new Error("startup cancelled");
        // The built-in LED assignment must remain inside the final .then()
        // because activeLed should not be published until chmod, brightness reading, and trigger reading succeed.
        self.activeLed = pendingLed;
        defer.resolve();
      })
      .fail((err) => {
        var restorePermissions = permissionsChanged
          ? runCommand(
              `/usr/bin/sudo /bin/chmod u=rw,go=r ${pendingLed.path}/brightness ${pendingLed.path}/trigger`,
            )
          : libQ.resolve();
        restorePermissions
          .then(() => {
            self.activeLed = undefined;
            defer.reject(err);
          })
          .fail((restoreErr) => {
            self.log(
              `Failed to restore LED file permissions after init failure: ${restoreErr}`,
            );
            self.activeLed = undefined;
            defer.reject(err);
          });
      });
  }

  // common blinking parameters
  pendingLed.isBlinking = false; // indicate current blinking state to avoid overlapping calls
  pendingLed.toggleDelayMs = blinkPeriodMs / 2; // half blink period
  pendingLed.toggleCount = blinkCycles * 2 - 1; // number of flip state cycles, 2 per blink cycle
  if (ledOutput == "gpio") {
    self.activeLed = pendingLed;
    defer.resolve();
  }

  return defer.promise;
};

// unexport LED gpio or restore buit-in LED state and file permissions.
// If plugin is disabled while connecting to a socket or blinking (long async processes), 
// attempt is made to terminate those. One cycle can still execute after plugin disabling
// and a race condition may occur when restoring the default state.
IRActivityLEDController.prototype.releaseActiveLed = function () {
  var self = this;
  var defer = libQ.defer();

  if (!self.activeLed) return libQ.resolve();
  const releasedLed = self.activeLed;
  releasedLed.released = true;
  self.activeLed = undefined;

  // only GPIO LED has a pin
  if (releasedLed.pin !== undefined) {
    self.log("releasing GPIO LED");
    try {
      gpiox.deinit_gpio(releasedLed.pin);
      defer.resolve();
    } catch (err) {
      defer.reject(err);
    }
  } else {
    self.log("releasing built-in LED");
    writeFile(
      `${releasedLed.path}/brightness`,
      releasedLed.defaultBrightness.toString(),
    ) // if plugin is disabled during blinking, restore
      .then(() =>
        writeFile(
          `${releasedLed.path}/trigger`,
          releasedLed.defaultMode.toString(),
        ),
      )
      .then(() =>
        runCommand(
          `/usr/bin/sudo /bin/chmod u=rw,go=r ${releasedLed.path}/brightness ${releasedLed.path}/trigger`,
        ),
      ) // restore permissions (normally 644)
      .then(() => defer.resolve())
      .fail((err) => defer.reject(err));
  }
  return defer.promise;
};

// Promisified Helper Methods -----------------------------------------------------------------------------

// Execute shell command. Rejects on error in favor of stderr. stderr is not used or exposed.
function runCommand(cmd) {
  var defer = libQ.defer();

  // hardcoded uid=1000/gid=1000 assumed the "volumio" account;
  // dropped, exec() already inherits the calling process's uid/gid by default.
  exec(cmd, defer.makeNodeResolver());
  return defer.promise;
}

function readFile(file) {
  var defer = libQ.defer();
  fs.readFile(file, "utf8", defer.makeNodeResolver());
  return defer.promise;
}

function writeFile(file, data) {
  var defer = libQ.defer();
  fs.writeFile(file, data, "utf8", defer.makeNodeResolver());
  return defer.promise;
}

// Output to log. Everything is logged as info. TODO: log as errors too.
IRActivityLEDController.prototype.log = function (s) {
  var self = this;
  self.logger.info(`[${PLUGIN_NAME}] ${s}`);
};

// Settings Methods -----------------------------------------------------------------------------

IRActivityLEDController.prototype.saveSettings = function (data) {
  var self = this;

  try {
    // prevent wrong or non-existing selections from being saved
    const gpioPin = Number(data["gpioPin"]);
    const blinkPeriodMs = Number(data["blinkPeriodMs"]);
    const blinkCycles = Number(data["blinkCycles"]);
    if (!isWithinBounds("gpioPin", gpioPin)) {
      throw new Error(
        self.getI18nString("GPIO_PIN_LBL") +
          self.getI18nString("ERROR_OUT_OF_RANGE_TITLE") +
          ". " +
          self.getI18nString("ERROR_OUT_OF_RANGE_MESSAGE") +
          `${SETTINGS_BOUNDS.gpioPin.min} - ${SETTINGS_BOUNDS.gpioPin.max}`,
      );
    }

    if (!isValidLedOutput(data["ledOutput"]["value"])) {
      throw new Error(
        self.getI18nString("LED_OUTPUT_LBL") +
          self.getI18nString("ERROR_NOT_FOUND_TITLE"),
      );
    }

    if (!isWithinBounds("blinkPeriodMs", blinkPeriodMs)) {
      throw new Error(
        self.getI18nString("BLINK_PERIOD_LBL") +
          self.getI18nString("ERROR_OUT_OF_RANGE_TITLE") +
          ". " +
          self.getI18nString("ERROR_OUT_OF_RANGE_MESSAGE") +
          `${SETTINGS_BOUNDS.blinkPeriodMs.min} - ${SETTINGS_BOUNDS.blinkPeriodMs.max}`,
      );
    }

    if (!isWithinBounds("blinkCycles", blinkCycles)) {
      throw new Error(
        self.getI18nString("BLINK_CYCLES_LBL") +
          self.getI18nString("ERROR_OUT_OF_RANGE_TITLE") +
          ". " +
          self.getI18nString("ERROR_OUT_OF_RANGE_MESSAGE") +
          `${SETTINGS_BOUNDS.blinkCycles.min} - ${SETTINGS_BOUNDS.blinkCycles.max}`,
      );
    }

    const previousSettings = {
      ledOutput: getConfigValue(
        self.config,
        "ledOutput",
        "output",
        DEFAULT_SETTINGS.ledOutput,
      ),
      gpioPin: getConfigValue(
        self.config,
        "gpioPin",
        "gpionum",
        DEFAULT_SETTINGS.gpioPin,
      ),
      blinkPeriodMs: getConfigValue(
        self.config,
        "blinkPeriodMs",
        "interval",
        DEFAULT_SETTINGS.blinkPeriodMs,
      ),
      blinkCycles: getConfigValue(
        self.config,
        "blinkCycles",
        "cycles",
        DEFAULT_SETTINGS.blinkCycles,
      ),
    };
    const newSettings = {
      ledOutput: data["ledOutput"]["value"],
      gpioPin: gpioPin,
      blinkPeriodMs: blinkPeriodMs,
      blinkCycles: blinkCycles,
    };

    self
      .releaseActiveLed() // release LED before creating a new one
      .then(() => self.initLed(newSettings))
      .then(() => {
        self.config.set("ledOutput", newSettings.ledOutput);
        self.config.set("gpioPin", newSettings.gpioPin);
        self.config.set("blinkPeriodMs", newSettings.blinkPeriodMs);
        self.config.set("blinkCycles", newSettings.blinkCycles);
        return self.commandRouter.pushToastMessage(
          "success",
          self.getI18nString("SUCCESS_TITLE"),
          self.getI18nString("SUCCESS_MESSAGE"),
        );
      })
      .fail((err) =>
        self
          .initLed(previousSettings)
          .then(() => {
            self.updateUIConfig(); // revert displayed fields to the still-persisted previousSettings
            self.commandRouter.pushToastMessage(
              "error",
              self.getI18nString("ERROR_TITLE"),
              `${self.getI18nString("ERROR_MESSAGE")}: ${err.toString()}`,
            );
          })
          .fail((rollbackErr) => {
            self.updateUIConfig();
            self.commandRouter.pushToastMessage(
              "error",
              self.getI18nString("ERROR_TITLE"),
              `${self.getI18nString("ERROR_MESSAGE")}: ${err.toString()}; rollback failed: ${rollbackErr.toString()}`,
            );
          }),
      );
  } catch (err) {
    // some errors require toString() to be properly displayed by the toast msg.
    self.updateUIConfig(); // revert displayed fields, nothing was persisted or changed
    self.commandRouter.pushToastMessage(
      "error",
      self.getI18nString("ERROR_TITLE"),
      `${self.getI18nString("ERROR_MESSAGE")}: ${err.toString()}`,
    );
  }
};

IRActivityLEDController.prototype.loadI18nStrings = function () {
  var self = this;

  try {
    var language_code = this.commandRouter.sharedVars.get("language_code");
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

IRActivityLEDController.prototype.getI18nString = function (key) {
  var self = this;

  if (self.i18nStrings[key] !== undefined) return self.i18nStrings[key];
  else return self.i18nStringsDefaults[key];
};

// Configuration Methods -----------------------------------------------------------------------------

// helper method to get the option for specified key from UIConfig json options.
function getSelectedOption(options, key) {
  // possible undefined return here does not cause a problem in settings UI,
  // "Enter an address" is displayed.
  return options.find(function (obj) {
    return obj.value === key;
  });
}

IRActivityLEDController.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();

  const lang_code = this.commandRouter.sharedVars.get("language_code");

  self.commandRouter
    .i18nJson(
      __dirname + "/i18n/strings_" + lang_code + ".json",
      __dirname + "/i18n/strings_en.json",
      __dirname + "/UIConfig.json",
    )
    .then(function (uiconf) {
      // switch option is an object (dictionary).
	  // Set the whole object to a selected one instead of setting fields.
      uiconf.sections[0].content[0].value = getSelectedOption(
        uiconf.sections[0].content[0].options,
        getConfigValue(
          self.config,
          "ledOutput",
          "output",
          DEFAULT_SETTINGS.ledOutput,
        ),
      );

      uiconf.sections[0].content[1].value = getConfigValue(
        self.config,
        "gpioPin",
        "gpionum",
        DEFAULT_SETTINGS.gpioPin,
      );
      uiconf.sections[0].content[2].value = getConfigValue(
        self.config,
        "blinkPeriodMs",
        "interval",
        DEFAULT_SETTINGS.blinkPeriodMs,
      );
      uiconf.sections[0].content[3].value = getConfigValue(
        self.config,
        "blinkCycles",
        "cycles",
        DEFAULT_SETTINGS.blinkCycles,
      );
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

IRActivityLEDController.prototype.updateUIConfig = function () {
  var self = this;

  self.commandRouter
    .getUIConfigOnPlugin("system_hardware", "ir_activity_led", {})
    .then(function (uiconf) {
      self.commandRouter.broadcastMessage("pushUiConfig", uiconf);
    });
  self.commandRouter.broadcastMessage("pushUiConfig");
};

// Required Stubs -----------------------------------------------------------------------------

IRActivityLEDController.prototype.getConfigurationFiles = function () {
  return ["config.json"];
};
