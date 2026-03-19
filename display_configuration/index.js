//display_configuration - balbuze October 2025
'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
const { exec } = require("child_process");

var execSync = require('child_process').execSync;
var spawn = require('child_process').spawn;
const io = require('socket.io-client');
const path = require("path");
const boot_screen_rotation = "/data/plugins/user_interface/display_configuration/rotation.cfg";
const logPrefix = "Display-configuration --- ";
// Define the display_configuration class
module.exports = display_configuration;


function display_configuration(context) {
   var self = this;
   self.context = context;
   self.commandRouter = self.context.coreCommand;
   self.logger = self.context.logger;
   self.configManager = self.context.configManager;
};

display_configuration.prototype.onVolumioStart = function () {
   var self = this;
   var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
   this.config = new (require('v-conf'))();
   this.config.loadFile(configFile);
   return libQ.resolve();
};

display_configuration.prototype.getConfigurationFiles = function () {
   var self = this;
   return ['config.json'];
};

// Safe config value extraction - handles various storage patterns
// Patterns: {value: {value: x}}, {value: x, label: y}, {type: t, value: x}, or direct value
display_configuration.prototype.getConfigValue = function (key, defaultValue) {
   const self = this;
   try {
      const raw = self.config.get(key);
      if (raw === undefined || raw === null) return defaultValue;

      // Direct primitive value
      if (typeof raw !== 'object') return raw;

      // Has .value property
      if (raw.value !== undefined) {
         // Nested: {value: {value: x, label: y}}
         if (typeof raw.value === 'object' && raw.value !== null && raw.value.value !== undefined) {
            return raw.value.value;
         }
         // Simple: {value: x} or {value: x, label: y}
         return raw.value;
      }

      return defaultValue;
   } catch (e) {
      return defaultValue;
   }
};

// Get config object with label (for select boxes)
display_configuration.prototype.getConfigSelect = function (key, defaultObj) {
   const self = this;
   try {
      const raw = self.config.get(key);
      if (raw === undefined || raw === null) return defaultObj;

      // Nested: {value: {value: x, label: y}}
      if (raw.value && typeof raw.value === 'object' && raw.value.value !== undefined) {
         return { value: raw.value.value, label: raw.value.label || raw.value.value };
      }

      // Simple: {value: x, label: y}
      if (raw.value !== undefined) {
         return { value: raw.value, label: raw.label || raw.value };
      }

      return defaultObj;
   } catch (e) {
      return defaultObj;
   }
};

display_configuration.prototype.onStop = function () {
   var self = this;
   var defer = libQ.defer();
   self.removeRotationConfig();
   defer.resolve();
   return defer.promise;
};

// Load i18n translation strings
display_configuration.prototype.loadI18nStrings = function () {
   var self = this;
   var lang_code = self.commandRouter.sharedVars.get('language_code') || 'en';
   var langFile = __dirname + '/i18n/strings_' + lang_code + '.json';
   var defaultFile = __dirname + '/i18n/strings_en.json';

   self.debugLog( 'loadI18nStrings: loading from ' + defaultFile);

   // Always load English as fallback
   try {
      self.i18nStringsDefault = fs.readJsonSync(defaultFile);
      self.debugLog( 'loadI18nStrings: loaded ' + Object.keys(self.i18nStringsDefault).length + ' keys');
   } catch (e) {
      self.logger.error(logPrefix + 'Failed to load English fallback strings: ' + e.message);
      self.i18nStringsDefault = {};
   }

   // Load requested language (or English if same)
   if (lang_code === 'en') {
      self.i18nStrings = self.i18nStringsDefault;
   } else {
      try {
         self.i18nStrings = fs.readJsonSync(langFile);
         self.debugLog( 'Loaded i18n strings for language: ' + lang_code);
      } catch (e) {
         self.logger.warn(logPrefix + 'Failed to load ' + lang_code + ' translations, using English');
         self.i18nStrings = self.i18nStringsDefault;
      }
   }
};

// Get translated string by key
display_configuration.prototype.getI18nString = function (key) {
   var self = this;

   // Try current language first
   if (self.i18nStrings && self.i18nStrings[key]) {
      return self.i18nStrings[key];
   }

   // Fallback to English
   if (self.i18nStringsDefault && self.i18nStringsDefault[key]) {
      return self.i18nStringsDefault[key];
   }

   // Last resort: return key itself
   self.logger.warn(logPrefix + 'getI18nString: key not found: ' + key + ', i18nStrings=' + (self.i18nStrings ? 'set' : 'null'));
   return key;
};

// Debug logging helper - only logs if debug_logging is enabled
display_configuration.prototype.debugLog = function (message) {
   var self = this;
   if (self.config.get('debug_logging')) {
      self.logger.info(logPrefix + message);
   }
};

// Toggle debug logging - immediate save on switch change
display_configuration.prototype.toggleDebugLogging = function (data) {
   var self = this;
   var defer = libQ.defer();

   var enabled = data && data.debug_logging !== undefined ? data.debug_logging : !self.config.get('debug_logging');
   self.config.set('debug_logging', enabled);

   self.commandRouter.pushToastMessage('success',
      self.getI18nString('PLUGIN_TITLE'),
      self.getI18nString(enabled ? 'DEBUG_LOGGING_ENABLED' : 'DEBUG_LOGGING_DISABLED'));

   defer.resolve();
   return defer.promise;
};

display_configuration.prototype.onStart = function () {
   const self = this;
   const defer = libQ.defer();

   self.socket = io.connect('http://localhost:3000');
   self.loadI18nStrings();
   self.fixXauthority();

   // Wait for X server to be ready before applying settings
   self.waitForXServer().then(() => {
      // Test if X is actually accessible
      return self.testXAccess();
   }).then((xAccessible) => {
      if (!xAccessible) {
         // X not accessible despite waiting - restart kiosk to get fresh X session
         self.debugLog( ' X server not accessible, restarting kiosk service...');
         return self.restartKioskAndWait();
      }
      return true;
   }).then(() => {
      self.checkIfPlay();
      self.applyscreensettingsboot();
      self.monitorLid();
      // Re-apply input settings after kiosk browser starts
      self.waitForKioskAndReapply();
   }).catch((err) => {
      self.logger.error(logPrefix + ' X server startup failed: ' + err.message);
      // Continue anyway - settings will apply when X becomes available
      self.checkIfPlay();
      self.monitorLid();
      self.waitForKioskAndReapply();
   });

   defer.resolve();
   return defer.promise;
};

// Test if X server is actually accessible (quick single check)
display_configuration.prototype.testXAccess = function () {
   const self = this;
   const display = self.getDisplaynumber();

   return new Promise((resolve) => {
      exec(`DISPLAY=${display} xset q`, { timeout: 3000 }, (err) => {
         resolve(!err);
      });
   });
};

// Restart kiosk service and wait for X to become accessible
display_configuration.prototype.restartKioskAndWait = function () {
   const self = this;

   return new Promise((resolve) => {
      exec('sudo systemctl restart volumio-kiosk.service', (err) => {
         if (err) {
            self.logger.warn(logPrefix + ' Failed to restart kiosk service: ' + err.message);
            resolve(false);
            return;
         }

         self.debugLog( ' Kiosk service restarted, waiting for X server...');

         // Wait a moment for kiosk to start
         setTimeout(() => {
            // Re-copy Xauthority after kiosk restart
            self.fixXauthority();

            // Wait for X with shorter timeout since kiosk just started
            let attempts = 0;
            const maxAttempts = 15;

            const checkX = () => {
               attempts++;
               self.testXAccess().then((accessible) => {
                  if (accessible) {
                     self.debugLog( ' X server accessible after kiosk restart');
                     resolve(true);
                  } else if (attempts >= maxAttempts) {
                     self.logger.warn(logPrefix + ' X server still not accessible after kiosk restart');
                     resolve(false);
                  } else {
                     setTimeout(checkX, 1000);
                  }
               });
            };

            checkX();
         }, 2000);
      });
   });
};

display_configuration.prototype.onRestart = function () {
   var self = this;
   //
};

display_configuration.prototype.onInstall = function () {
   var self = this;

   //Perform your installation tasks here
};

display_configuration.prototype.onUninstall = function () {
   var self = this;
   self.removeRotationConfig();

};

display_configuration.prototype.getUIConfig = function () {
   var defer = libQ.defer();
   var self = this;

   var lang_code = this.commandRouter.sharedVars.get('language_code');

   self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
      __dirname + '/i18n/strings_en.json',
      __dirname + '/UIConfig.json')
      .then(async function (uiconf) {

         // Label migration: old -> new
         const migrateLabel = function(label) {
            const labelMap = {
               'None': 'System default',
               'Same as Device': 'Same as Screen',
               'Normal': 'Default'
            };
            return labelMap[label] || label;
         };

         // Section 0: Display Settings
         // [0] rotatescreen, [1] brightness
         var rvalue = self.getConfigSelect('rotatescreen', { value: "normal", label: "Default" });
         self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.value', rvalue.value);
         self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.label', migrateLabel(rvalue.label));

         var brightness = self.getConfigValue('brightness', 1);
         uiconf.sections[0].content[1].config.bars[0].value = brightness;

         // Section 1: Advanced Settings
         // [0] show_advanced, [1] touch_offset, [2] pointer_offset, [3] fbcon_offset, [4] plymouth_offset
         var showAdvanced = self.getConfigValue('show_advanced', false);
         uiconf.sections[1].content[0].value = showAdvanced;

         var touchOffset = self.getConfigSelect('touch_offset', { value: "0", label: "System default" });
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[1].value.value', touchOffset.value);
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[1].value.label', migrateLabel(touchOffset.label));

         // Hide touch_offset if no touch devices
         let touchDevices = await self.detectTouchscreen();
         if (!touchDevices || touchDevices.length === 0) {
            uiconf.sections[1].content[1].hidden = true;
         }

         var pointerOffset = self.getConfigSelect('pointer_offset', { value: "0", label: "System default" });
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[2].value.value', pointerOffset.value);
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[2].value.label', migrateLabel(pointerOffset.label));

         var fbconOffset = self.getConfigSelect('fbcon_offset', { value: "same", label: "Same as Screen" });
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[3].value.value', fbconOffset.value);
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[3].value.label', migrateLabel(fbconOffset.label));

         var plymouthOffset = self.getConfigSelect('plymouth_offset', { value: "same", label: "Same as Screen" });
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[4].value.value', plymouthOffset.value);
         self.configManager.setUIConfigParam(uiconf, 'sections[1].content[4].value.label', migrateLabel(plymouthOffset.label));

         // Section 2: Screensaver
         // [0] hidecursor, [1] screensavertype, [2] xscreensettings, [3] timeout, [4] noifplay
         var hidecursor = self.getConfigValue('hidecursor', false);
         uiconf.sections[2].content[0].value = hidecursor;

         var xsvalue = self.getConfigSelect('screensavertype', { value: "dpms", label: "Turn the screen off" });
         self.configManager.setUIConfigParam(uiconf, 'sections[2].content[1].value.value', xsvalue.value);
         self.configManager.setUIConfigParam(uiconf, 'sections[2].content[1].value.label', xsvalue.label);

         // [2] xscreensettings button - no value to set

         uiconf.sections[2].content[3].value = self.getConfigValue('timeout', 120);
         uiconf.sections[2].content[3].attributes = [
            {
               placeholder: 120,
               maxlength: 4,
               min: 0,
               max: 3600
            }
         ];

         uiconf.sections[2].content[4].value = self.getConfigValue('noifplay', true);

         // Section 3: Diagnostics
         // [0] debug_logging, [1] restart_kiosk button, [2] generate_diagnostics button
         uiconf.sections[3].content[0].value = self.getConfigValue('debug_logging', true);

         defer.resolve(uiconf);
      })
      .fail(function () {
         defer.reject(new Error());
      });

   return defer.promise;
};


display_configuration.prototype.refreshUI = function () {
   const self = this;

   setTimeout(function () {
      var respconfig = self.commandRouter.getUIConfigOnPlugin('user_interface', 'display_configuration', {});
      respconfig.then(function (config) {
         self.commandRouter.broadcastMessage('pushUiConfig', config);
      });
      self.commandRouter.closeModals();
   }, 100);
}

display_configuration.prototype.setUIConfig = function (data) {
   var self = this;
   //Perform your installation tasks here
};

display_configuration.prototype.getConf = function (varName) {
   var self = this;
   //Perform your installation tasks here
};

display_configuration.prototype.setConf = function (varName, varValue) {
   var self = this;
   //Perform your installation tasks here
};

// Define once
display_configuration.prototype.getDisplaynumber = function () {
   try {
      let display;

      if (process.env.DISPLAY) {
         display = process.env.DISPLAY;
      } else {
         const { execSync } = require("child_process");

         // Check Xorg processes
         let output = execSync("ps -ef | grep -m1 '[X]org' || true", { encoding: "utf8" });
         let match = output.match(/Xorg\s+(:\d+)/);
         if (match) {
            display = match[1];
         } else {
            // Try xdpyinfo if installed
            try {
               let xdpy = execSync("xdpyinfo 2>/dev/null | grep 'name of display'", { encoding: "utf8" });
               let xmatch = xdpy.match(/:([0-9]+)/);
               if (xmatch) {
                  display = ":" + xmatch[1];
               }
            } catch (e) {
               // ignore
            }
         }
      }

      // Default fallback
      if (!display) display = ":0";

      // Export to environment for all child processes
      process.env.DISPLAY = display;

      return display;
   } catch (err) {
      this.logger.error("detectDisplay() error: " + err);
      process.env.DISPLAY = ":0";
      return ":0";
   }
};

display_configuration.prototype.detectConnectedScreen = function () {
   const self = this;
   const display = self.getDisplaynumber();

   return new Promise((resolve) => {
      exec(`xrandr --display ${display} --query`, (error, stdout, stderr) => {
         if (error) {
            self.logger.warn(logPrefix + ` xrandr query failed: ${stderr || error.message}`);
            return resolve(null);
         }

         const lines = stdout.split("\n");

         const connected = lines
            .map(line => {
               const match = line.match(/^([A-Za-z0-9-]+)\s+connected/);
               return match ? match[1] : null;
            })
            .filter(Boolean);

         if (connected.length === 0) {
            self.logger.warn(logPrefix + " No connected screens detected");
            return resolve(null);
         }

         self.debugLog( " Connected screens: " + connected.join(", "));
         resolve(connected[0]);
      });
   });
};

display_configuration.prototype.writeRotationConfig = function (screen, plymouthDegrees, fbRotate) {
   const self = this;

   return new Promise((resolve, reject) => {
      // Validate parameters
      if (!screen || typeof screen !== 'string') {
         self.logger.error(logPrefix + " writeRotationConfig: invalid screen parameter");
         return reject(new Error("Invalid screen parameter"));
      }

      // Validate plymouth degrees
      const validPlymouth = [0, 90, 180, 270];
      if (!validPlymouth.includes(plymouthDegrees)) {
         self.logger.warn(logPrefix + ` writeRotationConfig: invalid plymouthDegrees '${plymouthDegrees}', using 0`);
         plymouthDegrees = 0;
      }

      const fbValue = parseInt(fbRotate, 10);
      if (isNaN(fbValue) || fbValue < 0 || fbValue > 3) {
         self.logger.warn(logPrefix + ` writeRotationConfig: invalid fbRotate '${fbRotate}', using 0`);
         fbRotate = 0;
      }

      // Use plymouth= for boot splash, fbcon= for TTY
      // NO panel_orientation - let xrandr handle X11 rotation properly
      // Variable name is 'screen' because that's what grub.cfg expects ($screen)
      const content =
         `set screen=plymouth=${plymouthDegrees}\n` +
         `set efifb=video=efifb\n` +
         `set fbcon=fbcon=rotate:${fbRotate}\n`;

      // Spawn tee to write into the file
      const child = spawn("tee", [boot_screen_rotation], { stdio: ["pipe", "ignore", "pipe"] });

      let stderr = "";
      child.stderr.on("data", chunk => {
         stderr += chunk.toString();
      });

      child.on("close", code => {
         if (code !== 0) {
            self.logger.error(logPrefix + ` tee exited with code ${code} stderr: ${stderr.trim()}`);
            return reject(new Error(stderr.trim() || `tee exit ${code}`));
         }
         self.debugLog(
            ` Rotation config saved for Grub: screen=${screen}, plymouth=${plymouthDegrees}, fbcon=${fbRotate}`
         );
         resolve();
      });

      // send the content into tee's stdin
      child.stdin.write(content);
      child.stdin.end();
   });
};

display_configuration.prototype.removeRotationConfig = function () {
   const self = this;

   return new Promise((resolve, reject) => {
      fs.unlink(boot_screen_rotation, (err) => {
         if (err) {
            if (err.code === "ENOENT") {
               self.logger.warn(logPrefix + ` Rotation config not found: ${boot_screen_rotation}`);
               return resolve();
            }
            self.logger.error(logPrefix + ` Failed to remove rotation config: ${err.message}`);
            return reject(err);
         }

         self.debugLog( ` Rotation config removed: ${boot_screen_rotation}`);
         self.commandRouter.pushToastMessage(
            "error",
            "Plugin stopped!!!",
            "Please Reboot now!."
         );
         resolve();
      });
   });
};


display_configuration.prototype.fixXauthority = function () {
   const self = this;

   return new Promise((resolve, reject) => {
      const cmd = `if [ -f /root/.Xauthority ]; then cp /root/.Xauthority /home/volumio/ && chown volumio:volumio /home/volumio/.Xauthority; fi`;

      const fullCmd = `/bin/echo volumio | /usr/bin/sudo -S /bin/bash -c '${cmd}'`;

      exec(fullCmd, { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
         if (error) {
            self.logger.error(logPrefix + " fixXauthority failed: " + (stderr || error.message));
            return reject(error);
         }
         self.debugLog( " fixXauthority: /home/volumio/.Xauthority updated");
         resolve(stdout);
      });
   });
};

// Wait for X server to be ready with retries
display_configuration.prototype.waitForXServer = function () {
   const self = this;
   const maxRetries = 30;
   const retryDelay = 1000;

   return new Promise((resolve, reject) => {
      let attempt = 0;

      const tryConnect = () => {
         attempt++;
         const display = self.getDisplaynumber();

         // Test X server with xset command
         exec(`DISPLAY=${display} xset q`, { timeout: 3000 }, (err) => {
            if (!err) {
               self.debugLog( ` X server ready after ${attempt} attempt(s)`);
               resolve();
               return;
            }

            if (attempt >= maxRetries) {
               self.logger.warn(logPrefix + ` X server not ready after ${maxRetries} attempts, proceeding anyway`);
               resolve(); // resolve anyway to allow fallback behavior
               return;
            }

            self.debugLog( ` Waiting for X server (attempt ${attempt}/${maxRetries})...`);
            setTimeout(tryConnect, retryDelay);
         });
      };

      // Start first attempt after initial delay
      setTimeout(tryConnect, 500);
   });
};

// Wait for kiosk browser to start, then re-apply input settings
display_configuration.prototype.waitForKioskAndReapply = function () {
   const self = this;
   const maxChecks = 60;
   const checkInterval = 1000;
   let checkCount = 0;
   let kioskDetected = false;

   const checkKiosk = () => {
      checkCount++;

      exec("pgrep -f 'chromium|openbox'", (err, stdout) => {
         if (!err && stdout.trim() && !kioskDetected) {
            kioskDetected = true;
            self.debugLog( ` Kiosk browser detected after ${checkCount}s, re-applying input settings in 3s`);

            // Wait for browser to fully initialize before re-applying
            setTimeout(async () => {
               try {
                  await self.applyTouchCorrection();
                  await self.applyPointerCorrection();
                  self.debugLog( ' Input settings re-applied after kiosk start');
               } catch (e) {
                  self.logger.error(logPrefix + ' Failed to re-apply input settings: ' + e.message);
               }
            }, 3000);
            return;
         }

         if (checkCount >= maxChecks) {
            self.debugLog( ' Kiosk monitor timeout - browser may already be running or not in use');
            return;
         }

         setTimeout(checkKiosk, checkInterval);
      });
   };

   // Start checking after initial delay
   setTimeout(checkKiosk, 2000);
};

display_configuration.prototype.drmForcesOrientation = null;


// Function to check and store
display_configuration.prototype.checkDrmOrientation = async function (screen) {
   const self = this;

   try {
      const dmesgOutput = await new Promise((resolve) => {
         exec("dmesg | grep drm", (error, stdout) => {
            if (error) return resolve("");
            resolve(stdout);
         });
      });

      const drmLine = dmesgOutput.split("\n").find(line =>
         new RegExp(`\\[drm\\].*connector ${screen} panel_orientation to 1`).test(line)
      );

      self.drmForcesOrientation = !!drmLine; // store true/false
      if (self.drmForcesOrientation) {
         self.debugLog( ` Kernel forces orientation for ${screen} (line: "${drmLine.trim()}")`);
      } else {
         self.debugLog( ` No forced DRM orientation detected for ${screen}`);
      }

   } catch (err) {
      self.logger.error(logPrefix + " checkDrmOrientation error: " + err.message);
      self.drmForcesOrientation = false;
   }

   return self.drmForcesOrientation;
};


display_configuration.prototype.ensureXscreensaver = function () {
   const self = this;
   const display = self.getDisplaynumber();

   exec("pgrep xscreensaver", (err, stdout) => {
      if (stdout && stdout.trim().length > 0) {
         self.debugLog( " xscreensaver already running (pid " + stdout.trim() + ")");
      } else {
         exec(`DISPLAY=${display} xscreensaver -nosplash &`);
         self.debugLog( " xscreensaver started (using ~/.xscreensaver settings)");
      }
   });
};

display_configuration.prototype.monitorLid = function () {
   const self = this;
   const display = self.getDisplaynumber();

   // Detect all lid devices dynamically
   const lidPaths = [];
   const acpiPath = '/proc/acpi/button/lid/';
   if (fs.existsSync(acpiPath)) {
      const lids = fs.readdirSync(acpiPath);
      lids.forEach(lid => {
         const statePath = path.join(acpiPath, lid, 'state');
         if (fs.existsSync(statePath)) lidPaths.push(statePath);
      });
   }

   if (lidPaths.length === 0) {
      self.logger.warn(logPrefix + " No ACPI lid devices detected, lid monitoring disabled.");
      return;
   }

   self.debugLog( ` Monitoring lid(s): ${lidPaths.join(', ')}`);
   let lidClosed = false;

   setInterval(() => {
      try {
         let anyClosed = false;
         for (const lidFile of lidPaths) {
            const state = fs.readFileSync(lidFile, 'utf8').trim();
            if (state.toLowerCase().includes('closed')) anyClosed = true;
         }

         if (anyClosed && !lidClosed) {
            lidClosed = true;
            self.debugLog( " Lid closed - turning screen off via DPMS");
            exec(`/usr/bin/xset -display ${display} dpms force off`, (err) => {
               if (err) self.logger.warn(logPrefix + " DPMS force off failed: " + err.message);
            });
         } else if (!anyClosed && lidClosed) {
            lidClosed = false;
            self.debugLog( " Lid opened - turning screen on via DPMS");
            exec(`/usr/bin/xset -display ${display} dpms force on`, (err) => {
               if (err) self.logger.warn(logPrefix + " DPMS force on failed: " + err.message);
            });
         }
      } catch (err) {
         self.logger.error("Error reading lid state: " + err);
      }
   }, 1000); // check every 1 second
};



display_configuration.prototype.checkIfPlay = function () {
   const self = this;
   const display = self.getDisplaynumber();

   // Disable DPMS at start
   exec(`/usr/bin/xset -display ${display} -dpms`, () => {
      self.debugLog( " DPMS disabled before playback state check");
   });

   // Kill any leftover xscreensaver instances (clean start)
   exec("pkill -9 xscreensaver || true", () => {
      self.debugLog( " xscreensaver cleaned up before starting");
   });

   // Start xscreensaver immediately if selected
   const screensavertype = self.getConfigValue("screensavertype", "dpms");
   if (screensavertype === "xscreensaver") {
      self.ensureXscreensaver();
   }

   // Listen for Volumio playback state
   self.socket.on("pushState", function (data) {
      const timeout = self.getConfigValue("timeout", 0);
      const noifplay = self.getConfigValue("noifplay", true);
      const screensavertype = self.getConfigValue("screensavertype", "dpms");

      self.debugLog(
         `Volumio status=${data.status} timeout=${timeout} noifplay=${noifplay} screensavertype=${screensavertype}`
      );

      // ---- Wake conditions ----
      if ((data.status === "play" && noifplay) || timeout === 0 && screensavertype === "dpms") {
         self.wakeupScreen();
         self.debugLog(` → Wakeup triggered`);
         return;
      }

      // ---- Sleep (DPMS) ----
      if (data.status !== "play" && timeout !== 0 && screensavertype === "dpms") {
         setTimeout(() => {
            if (self.lastState !== "play") {
               self.sleepScreen();
               self.debugLog(` → Sleep (DPMS) triggered after ${timeout}s`);
            }
         }, timeout * 1000);
         return;
      }

      // ---- Sleep (xscreensaver) ----
      if (data.status !== "play" && screensavertype === "xscreensaver") {
         self.sleepScreen();
         self.debugLog(` → Sleep (xscreensaver) triggered`);
         return;
      }

      self.debugLog(` → No action taken`);
   });
};
display_configuration.prototype.sleepScreen = function () {
   const self = this;
   const display = self.getDisplaynumber();
   const screensavertype = self.getConfigValue("screensavertype", "dpms");
   const timeout = self.getConfigValue("timeout", 120);

   try {
      if (screensavertype === "dpms") {
         // Put screen to sleep via DPMS
         exec(`/usr/bin/xset -display ${display} s 0 0 +dpms dpms 0 0 ${timeout}`, (err) => {
            if (err) {
               self.logger.error(logPrefix + " sleepScreen: DPMS command failed: " + err.message);
            } else {
               self.debugLog( " sleepScreen: DPMS - screen off in " + timeout + "s");
            }
         });

      } else if (screensavertype === "xscreensaver") {
         // stop keepalive when we want xscreensaver active
         if (self._xscreensaverInterval) {
            clearInterval(self._xscreensaverInterval);
            self._xscreensaverInterval = null;
         }

         // Ensure xscreensaver daemon is running
         exec(`pgrep xscreensaver || (DISPLAY=${display} xscreensaver -no-splash &)`, (error) => {
            if (error) {
               self.logger.error(logPrefix + " sleepScreen: failed to ensure xscreensaver is running → " + error);
            }
         });

         // Then activate the screensaver
         exec(`DISPLAY=${display} xscreensaver-command -activate`, (error) => {
            if (error) {
               self.logger.warn(logPrefix + " sleepScreen: xscreensaver not running or failed → " + error.message);
               return;
            }
            self.debugLog( " sleepScreen: xscreensaver activated (screen blanked)");
         });

      } else {
         self.logger.warn(logPrefix + " sleepScreen: Unknown screensaver type, doing nothing");
      }
   } catch (err) {
      self.logger.error(logPrefix + " sleepScreen error: " + err);
   }
};

display_configuration.prototype.wakeupScreen = function () {
   const self = this;
   const display = self.getDisplaynumber();
   const screensavertype = self.getConfigValue("screensavertype", "dpms");

   try {
      if (screensavertype === "dpms") {

         // Wake DPMS screen
         exec(`/usr/bin/xset -display ${display} -dpms`, (err) => {
            if (err) {
               self.logger.error(logPrefix + " wakeupScreen: DPMS command failed: " + err.message);
            } else {
               self.debugLog( " wakeupScreen: DPMS - screen on");
            }
         });

      } else if (screensavertype === "xscreensaver") {
         // tell xscreensaver to disable blanking (instead of killing)
         exec(`DISPLAY=${display} xscreensaver-command -deactivate`, (error) => {
            if (error) {
               self.logger.error(logPrefix + " wakeupScreen: Failed to deactivate xscreensaver → " + error);
            } else {
               self.debugLog( " wakeupScreen: xscreensaver deactivated (screen on)");
            }
         });

         // periodically deactivate xscreensaver to keep screen awake
         if (!self._xscreensaverInterval) {
            self._xscreensaverInterval = setInterval(() => {
               exec(`pgrep -x xscreensaver`, (checkErr, stdout) => {
                  if (checkErr || !stdout) {
                     // Not running → skip silently
                     self.logger.debug(logPrefix + " keepAlive: xscreensaver not running, skipping deactivate");
                     return;
                  }

                  exec(`DISPLAY=${display} xscreensaver-command -deactivate`, (error) => {
                     if (error) {
                        self.logger.warn(logPrefix + " keepAlive: xscreensaver deactivate failed → " + error.message);
                     } else {
                        self.logger.debug(logPrefix + " keepAlive: xscreensaver deactivated");
                     }
                  });
               });
            }, 2100); // every ~2s
         }


      } else {
         self.logger.warn(logPrefix + " wakeupScreen: Unknown screensaver type, doing nothing");
      }
   } catch (err) {
      self.logger.error(logPrefix + " wakeupScreen error: " + err);
   }
};

display_configuration.prototype.xscreensettings = function (data) {
   const self = this;
   const defer = libQ.defer();
   const display = self.getDisplaynumber();

   // 1. Kill any previous instances (daemon + settings GUI)
   exec("pkill -f xscreensaver-settings; pkill -f xscreensaver", (killErr) => {
      if (killErr) {
         self.logger.warn(logPrefix + " xscreensettings: no previous xscreensaver processes to kill");
      } else {
         self.debugLog( " xscreensettings: previous xscreensaver processes killed");
      }

      // 2. Start daemon cleanly
      exec(`DISPLAY=${display} xscreensaver -no-splash &`, { uid: 1000, gid: 1000 }, (error) => {
         if (error) {
            self.logger.error(logPrefix + ": Failed to start xscreensaver daemon: " + error);
         } else {
            self.debugLog( ": xscreensaver daemon started");
         }

         // 3. Deactivate so the screen is "on" when settings open
         exec(`DISPLAY=${display} xscreensaver-command -deactivate`, (error) => {
            if (error) {
               self.logger.warn(logPrefix + " xscreensettings: Failed to deactivate xscreensaver → " + error);
            } else {
               self.debugLog( " xscreensettings: xscreensaver deactivated (screen on)");
            }
         });

         // 4. Finally launch the settings GUI
         const cmd = `DISPLAY=${display} xscreensaver-settings`;
         exec(cmd, { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
            if (error) {
               self.logger.error(logPrefix + ": Failed to start xscreensaver-settings: " + error);
               defer.reject(error);
            } else {
               self.debugLog( `: xscreensaver-settings started on display ${display}`);
               defer.resolve();
            }
         });
      });
   });

   return defer.promise;
};


display_configuration.prototype.setBrightnessSoft = function () {
   const self = this;
   const display = self.getDisplaynumber();
   var value = self.getConfigValue('brightness', 1);
   // Clamp between 0.1 and 1.0 (xrandr rejects 0 or >1)
   const brightness = Math.max(0.1, Math.min(1.0, value));

   try {
      // Detect connected screen
      self.detectConnectedScreen().then((screen) => {
         if (!screen) {
            self.logger.error(logPrefix + " No connected screen found for brightness change");
            return;
         }

         exec(`DISPLAY=${display} xrandr --output ${screen} --brightness ${brightness}`, (err) => {
            if (err) {
               self.logger.error(logPrefix + " Failed to set brightness: " + err);
            } else {
               self.debugLog( ` Brightness set to ${brightness * 100}% for screen ${screen}`);
            }
         });
      });
   } catch (err) {
      self.logger.error(logPrefix + " setBrightness error: " + err);
   }
};

display_configuration.prototype.setBrightness = function () {

   const self = this;
   const backlightDir = "/sys/class/backlight";
   var percent = self.getConfigValue('brightness', 1) * 100;

   return new Promise((resolve, reject) => {
      fs.readdir(backlightDir, (err, devices) => {
         if (err || !devices || devices.length === 0) {
            self.logger.warn(logPrefix + " No backlight device found, brightness control unavailable. Falling back to Soft Brightness");
            self.setBrightnessSoft();
            return resolve(false);
         }

         // Pick the first device (can extend to handle multiple)
         const device = devices[0];
         const maxPath = path.join(backlightDir, device, "max_brightness");
         const curPath = path.join(backlightDir, device, "brightness");

         fs.readFile(maxPath, "utf8", (err, data) => {
            if (err) {
               self.logger.error(logPrefix + " Failed to read max_brightness: " + err);
               return reject(err);
            }

            const maxBrightness = parseInt(data.trim(), 10);
            if (isNaN(maxBrightness) || maxBrightness <= 0) {
               self.logger.error(logPrefix + " Invalid max_brightness value");
               return reject(new Error("Invalid max_brightness"));
            }

            // Clamp percent
            let pct = Math.max(0, Math.min(100, parseInt(percent, 10)));
            const newValue = Math.round((pct / 100) * maxBrightness);

            exec(`echo ${newValue} | sudo tee ${curPath}`, (error, stdout, stderr) => {
               if (error) {
                  self.logger.error(logPrefix + " Failed to set brightness: " + stderr || error.message);
                  return reject(error);
               }

               self.debugLog( ` Brightness set to ${pct}% (${newValue}/${maxBrightness}) on ${device}`);
               resolve(true);
            });
         });
      });
   });
};



display_configuration.prototype.saveDeviceRotation = function (data) {
   const self = this;

   if (!data) {
      self.logger.error(logPrefix + " saveDeviceRotation: no data received");
      return;
   }

   // Parse rotation
   let rotation = 'normal';
   let rotateLabel = 'Normal';

   if (data['rotatescreen'] && data['rotatescreen'].value) {
      rotation = data['rotatescreen'].value;
      rotateLabel = data['rotatescreen'].label || rotation;
   }

   self.config.set('rotatescreen', {
      value: rotation,
      label: rotateLabel
   });

   // Save brightness
   var brightness = data['brightness'] !== undefined ? data['brightness'] : 1;
   self.config.set('brightness', brightness);

   self.commandRouter.pushToastMessage("success", "Device Rotation", "Settings applied!");

   setTimeout(function () {
      self.refreshUI();
      self.applyscreensettings();
   }, 100);
};


display_configuration.prototype.saveCalibration = function (data) {
   const self = this;

   if (!data) {
      self.logger.error(logPrefix + " saveCalibration: no data received");
      return;
   }

   // Save show_advanced toggle state
   self.config.set('show_advanced', data['show_advanced'] || false);

   // Save touch_offset
   const touchOffsetValue = (data['touch_offset'] && data['touch_offset'].value) || '0';
   const touchOffsetLabel = (data['touch_offset'] && data['touch_offset'].label) || 'System default';
   self.config.set('touch_offset', {
      value: touchOffsetValue,
      label: touchOffsetLabel
   });

   // Save pointer_offset
   const pointerOffsetValue = (data['pointer_offset'] && data['pointer_offset'].value) || '0';
   const pointerOffsetLabel = (data['pointer_offset'] && data['pointer_offset'].label) || 'System default';
   self.config.set('pointer_offset', {
      value: pointerOffsetValue,
      label: pointerOffsetLabel
   });

   // Save fbcon_offset
   const fbconOffsetValue = (data['fbcon_offset'] && data['fbcon_offset'].value) || 'same';
   const fbconOffsetLabel = (data['fbcon_offset'] && data['fbcon_offset'].label) || 'Same as Screen';
   self.config.set('fbcon_offset', {
      value: fbconOffsetValue,
      label: fbconOffsetLabel
   });

   // Save plymouth_offset
   const plymouthOffsetValue = (data['plymouth_offset'] && data['plymouth_offset'].value) || 'same';
   const plymouthOffsetLabel = (data['plymouth_offset'] && data['plymouth_offset'].label) || 'Same as Screen';
   self.config.set('plymouth_offset', {
      value: plymouthOffsetValue,
      label: plymouthOffsetLabel
   });

   self.commandRouter.pushToastMessage("success", "Advanced Settings", "Settings applied! Console and Boot Logo changes take effect on reboot.");

   setTimeout(function () {
      self.refreshUI();
      self.applyscreensettings();
   }, 100);
};


display_configuration.prototype.saveScreensaver = function (data) {
   const self = this;

   if (!data) {
      self.logger.error(logPrefix + " saveScreensaver: no data received");
      return;
   }

   self.config.set('hidecursor', data['hidecursor'] || false);

   // Validate timeout
   let timeout = parseInt(data['timeout'], 10);
   if (isNaN(timeout)) {
      timeout = 120;
      self.config.set('timeout', timeout);
      self.commandRouter.pushToastMessage(
         'error',
         'Screensaver Timeout',
         'Invalid value entered. Reset to default (120 seconds).'
      );
   } else {
      if (timeout < 0) {
         timeout = 0;
         self.commandRouter.pushToastMessage(
            'error',
            'Screensaver Timeout',
            'Value cannot be negative. Clamped to 0.'
         );
      } else if (timeout > 3600) {
         timeout = 3600;
         self.commandRouter.pushToastMessage(
            'error',
            'Screensaver Timeout',
            'Value too high. Clamped to 3600.'
         );
      } else {
         self.commandRouter.pushToastMessage("success", "Screensaver", "Settings applied!");
      }
      self.config.set('timeout', timeout);
   }

   if (data['screensavertype'] && data['screensavertype'].value) {
      self.config.set('screensavertype', {
         value: data['screensavertype'].value,
         label: data['screensavertype'].label
      });
   }

   self.config.set('noifplay', data.noifplay);

   if (timeout === 0) {
      self.wakeupScreen();
   }

   setTimeout(function () {
      self.refreshUI();
      self.checkIfPlay();
      self.applyscreensettings();

      if (data['screensavertype'] && data['screensavertype'].value === 'dpms') {
         exec("pkill -f xscreensaver-settings || true");
         exec("pkill -f xscreensaver || true");
      }

      try {
         const state = self.commandRouter.volumioGetState();
         const timeout = self.getConfigValue('timeout', 120);
         const noifplay = self.getConfigValue('noifplay', true);

         if ((state.status === "play") && noifplay) {
            self.wakeupScreen();
         } else if (((state.status !== "play") && (timeout != 0)) || ((state.status === "play") && (!noifplay))) {
            self.sleepScreen();
         }
      } catch (err) {
         self.logger.error(logPrefix + " Failed to apply screensaver immediately: " + err);
      }
   }, 100);
};


// Legacy method for backward compatibility
display_configuration.prototype.savescreensettings = function (data) {
   const self = this;
   self.logger.warn(logPrefix + " savescreensettings called - using legacy compatibility mode");
   
   // Call all three save methods
   self.saveDeviceRotation(data);
   self.saveCalibration(data);
   self.saveScreensaver(data);
};


display_configuration.prototype.applyscreensettingsboot = async function () {
   const self = this;

   try {
      // detect screen before using it
      const screen = await this.detectConnectedScreen();

      if (!screen) {
         self.logger.warn(logPrefix + ' No screen detected or X server not accessible - skipping display settings');
         return;
      }

      // Check if old panel_orientation is still in effect from previous config
      await this.checkDrmOrientation(screen);

      if (this.drmForcesOrientation) {
         self.logger.warn(
            logPrefix + ` Old panel_orientation detected in kernel cmdline. ` +
            `Reboot required for proper xrandr rotation. Applying xrandr anyway (may double-rotate).`
         );
      }
      
      // Always apply xrandr rotation (new config uses plymouth= not panel_orientation)
      await this.applyRotation();
      self.debugLog( ` Panel Rotation applied via xrandr`);

      await this.applyTouchCorrection();
      await this.applyPointerCorrection();
      this.applyCursorSetting();
      self.setBrightness();
   } catch (err) {
      self.logger.error(logPrefix + ' applyscreensettingsboot error: ' + (err && err.message ? err.message : err));
   }
};


display_configuration.prototype.applyscreensettings = async function () {
   const self = this;

   try {
      await this.applyRotation();
      await this.applyTouchCorrection();
      await this.applyPointerCorrection();
      this.applyCursorSetting();
      self.setBrightness();
   } catch (err) {
      self.logger.error(logPrefix + ' applyscreensettings error: ' + (err && err.message ? err.message : err));
   }
};


display_configuration.prototype.detectTouchscreen = function () {
   const self = this;
   const display = self.getDisplaynumber();

   return new Promise((resolve) => {
      exec(`DISPLAY=${display} xinput list`, (error, stdout, stderr) => {
         if (error) {
            self.logger.warn(logPrefix + ` xinput list failed: ${stderr || error.message}`);
            return resolve([]);
         }

         const lines = stdout.split("\n");

         // Match all possible touchscreen or touchpad candidates
         // Note: Excludes "mouse" - mice should only get pointer correction, not touch correction
         // Filter to "slave pointer" only - excludes keyboard instances that cannot accept transformation
         const matches = lines.filter(line =>
            /touch|touchscreen|finger|multitouch|stylus|goodix|synp|elan|ft5406|maxtouch|wacom|ntrg|egalax|ilitek|touchpad/i.test(line) &&
            /slave\s+pointer/i.test(line)
         );

         if (matches.length === 0) {
            return resolve([]); // none found
         }

         // Extract IDs and names
         const devices = matches.map(line => {
            const idMatch = line.match(/id=(\d+)/);
            const id = idMatch ? idMatch[1] : null;
            const name = line.replace(/\s*id=\d+.*/, "").trim();
            return { id, name };
         }).filter(dev => dev.id);

         self.debugLog( " Touch-related devices detected: " + JSON.stringify(devices));
         resolve(devices); // return ALL devices
      });
   });
};

/**
 * Helper: find device id from xinput by name
 */
display_configuration.prototype.getDeviceId = async function (deviceName) {
   try {
      const { stdout } = await execAsync(`xinput list | grep -F '${deviceName}'`);
      const match = stdout.match(/id=(\d+)/);
      return match ? match[1] : null;
   } catch {
      return null;
   }
};

// 1. Rotate screen
display_configuration.prototype.applyRotation = async function () {
   const self = this;
   const display = self.getDisplaynumber();

   // Get rotation value from config
   let rotatescreen = self.getConfigValue("rotatescreen", "normal");
   let fbconOffset = self.getConfigValue("fbcon_offset", "same");
   let plymouthOffset = self.getConfigValue("plymouth_offset", "same");

   // Validate rotation value
   const validRotations = ['normal', 'inverted', 'left', 'right'];
   if (!validRotations.includes(rotatescreen)) {
      self.logger.warn(logPrefix + ` Invalid rotation value '${rotatescreen}', using 'normal'`);
      rotatescreen = "normal";
   }

   // Validate offsets
   const validOffsets = ['same', '0', '90', '180', '270'];
   if (!validOffsets.includes(fbconOffset)) {
      self.logger.warn(logPrefix + ` Invalid fbcon_offset '${fbconOffset}', using 'same'`);
      fbconOffset = "same";
   }
   if (!validOffsets.includes(plymouthOffset)) {
      self.logger.warn(logPrefix + ` Invalid plymouth_offset '${plymouthOffset}', using 'same'`);
      plymouthOffset = "same";
   }

   // Mapping from rotation to degrees
   const rotationToDegrees = {
      normal: 0,
      right: 90,
      inverted: 180,
      left: 270
   };

   // Mapping from degrees to fbconv values
   const degreesToFbconv = { 0: 0, 90: 1, 180: 2, 270: 3 };

   // Calculate display degrees
   let displayDegrees = rotationToDegrees[rotatescreen];

   // Calculate fbcon rotation (TTY)
   let fbconOffsetDegrees = (fbconOffset === "same") ? 0 : parseInt(fbconOffset, 10);
   let fbconDegrees = (displayDegrees + fbconOffsetDegrees) % 360;
   const fbconv = degreesToFbconv[fbconDegrees];

   // Calculate plymouth rotation (boot splash)
   let plymouthOffsetDegrees = (plymouthOffset === "same") ? 0 : parseInt(plymouthOffset, 10);
   let plymouthDegrees = (displayDegrees + plymouthOffsetDegrees) % 360;

   self.debugLog( ` TTY: display=${rotatescreen}(${displayDegrees}) + offset=${fbconOffset}(${fbconOffsetDegrees}) = ${fbconDegrees} deg (fbconv=${fbconv})`);
   self.debugLog( ` Plymouth: display=${rotatescreen}(${displayDegrees}) + offset=${plymouthOffset}(${plymouthOffsetDegrees}) = ${plymouthDegrees} deg`);

   const screen = await self.detectConnectedScreen();

   // Always update boot config with calculated values
   // Using plymouth= instead of panel_orientation so X11 works correctly
   try {
      await this.writeRotationConfig(screen, plymouthDegrees, fbconv);
   } catch (err) {
      self.logger.error(logPrefix + " applyRotation grub error: " + err);
   }

   //  Apply runtime rotation via xrandr
   if (!screen) {
      self.logger.error(logPrefix + " No connected screen detected, skipping rotation.");
      return;
   }


   exec(`DISPLAY=${display} xrandr --output ${screen} --rotate ${rotatescreen}`, (err, stdout, stderr) => {
      if (err) {
         self.logger.error(logPrefix + ` xrandr rotation failed: ${stderr || err.message}`);
      } else {
         self.debugLog( ` Runtime rotation applied: ${rotatescreen} | Boot config (plymouth=${plymouthDegrees}, fbconv=${fbconv})`);
      }
   });

   // Also attempt fbcon rotation for console
   self.applyFbconRotation(fbconv);
};

// Apply fbcon rotation for console display
display_configuration.prototype.applyFbconRotation = function (fbconValue) {
   const self = this;

   // fbcon rotate values: 0=normal, 1=90cw, 2=180, 3=90ccw
   const rotateAllPath = '/sys/class/graphics/fbcon/rotate_all';

   exec(`test -f ${rotateAllPath} && echo ${fbconValue} | sudo tee ${rotateAllPath}`, (err, stdout, stderr) => {
      if (err) {
         // This is expected on some hardware - not all systems support runtime fbcon rotation
         self.debugLog( ` fbcon rotation not available or failed (this is normal on some hardware)`);
      } else {
         self.debugLog( ` fbcon console rotation set to ${fbconValue}`);
      }
   });
};

// Run a shell command and return output
function runCommand(cmd) {
   return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
         if (error) return reject(new Error(stderr || error.message));
         resolve(stdout);
      });
   });
}

// Get screen resolution from xrandr
async function getScreenGeometry(screen) {
   try {
      const output = await runCommand(`xrandr | grep "^${screen}"`);
      const match = output.match(/(\d+)x(\d+)/);
      if (match) {
         return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
      }
   } catch {
      return { width: 0, height: 0 };
   }
   return { width: 0, height: 0 };
}

// Grab a single touch event (requires user tap)// helper: listen for N touch samples from xinput test-xi2 robustly
display_configuration.prototype.getTouchSamples = function (devId, count = 2, timeoutMs = 120000) {
  const self = this;
  return new Promise((resolve, reject) => {
    let samples = [];
    let current = { x: undefined, y: undefined };
    let finished = false;

    // spawn test-xi2 which reports valuator[0], valuator[1] typically
    const child = spawn('xinput', ['test-xi2', String(devId)]);
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill('SIGTERM');
        if (samples.length > 0) return resolve(samples); // return partial if any
        return reject(new Error('Timeout waiting for touch samples'));
      }
    }, timeoutMs);

    // accumulate text because events may be split across chunks
    let buffer = '';

    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      // split into lines and keep remainder
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop(); // remainder

      for (const line of lines) {
        if (!line) continue;

        // Example lines to parse:
        //   valuator[0]:  1234.00
        //   valuator[1]:  567.00
        // Or combined on same line depending on xinput version
        const mv = line.match(/valuator\[(\d+)\]\s*:\s*([0-9.+-]+)/i);
        if (mv) {
          const idx = Number(mv[1]);
          const val = parseFloat(mv[2]);
          if (idx === 0) current.x = val;
          if (idx === 1) current.y = val;
          // don't push yet: wait for an event line (below) or for both valuators present
        }

        // Look for an EVENT or Motion line indicating a finished sample
        if (/EVENT type:.*(XI_TouchBegin|XI_TouchUpdate|XI_Motion|XI_ButtonPress|XI_ButtonRelease)/i.test(line)
            || /TouchBegin|TouchUpdate|Motion|ButtonPress|ButtonRelease/i.test(line)) {
          if (typeof current.x === 'number' && typeof current.y === 'number') {
            samples.push({ x: current.x, y: current.y });
            current = { x: undefined, y: undefined };
          }
        }

        // fallback: if both x and y are present without an explicit EVENT line, accept them
        if (typeof current.x === 'number' && typeof current.y === 'number') {
          samples.push({ x: current.x, y: current.y });
          current = { x: undefined, y: undefined };
        }

        if (samples.length >= count && !finished) {
          finished = true;
          clearTimeout(timer);
          child.kill('SIGTERM');
          return resolve(samples);
        }
      } // for lines
    });

    child.stderr.on('data', data => {
      // many drivers print warnings on stderr — log but do not fail
      self.logger.debug(logPrefix + ' getTouchSamples stderr: ' + data.toString().trim());
    });

    child.on('error', err => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on('exit', (code, sig) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (samples.length > 0) return resolve(samples);
        return reject(new Error(`xinput exited early (code=${code} sig=${sig})`));
      }
    });
  });
};

// helper: prompt user and capture two touches (top-left then bottom-right)
display_configuration.prototype.detectTouchInversion = async function (devId, screen, deviceName) {
  const self = this;

  // get geometry (use existing getScreenGeometry function)
  const geom = await getScreenGeometry(screen);
  if (!geom || !geom.width || !geom.height) {
    self.logger.warn(logPrefix + " Could not detect inversion (no geometry).");
    return { invertX: false, invertY: false };
  }

  try {
    // ask user to tap top-left
    self.debugLog(` Please touch TOP LEFT corner on ${deviceName || 'touch device'} (${screen})`);
    const samples1 = await self.getTouchSamples(devId, 1, 20000); // wait up to 120s for first touch
    if (!samples1 || samples1.length === 0) {
      throw new Error('No top-left touch sample captured');
    }
    const topLeft = samples1[0];

    // ask user to tap bottom-right
    self.debugLog(` Please touch BOTTOM RIGHT corner on ${deviceName || 'touch device'} (${screen})`);
    const samples2 = await self.getTouchSamples(devId, 1, 20000); // wait up to 120s for second touch
    if (!samples2 || samples2.length === 0) {
      throw new Error('No bottom-right touch sample captured');
    }
    const bottomRight = samples2[0];

    // Decide inversion:
    // If user touched left but reported x is near width (i.e. large value) → invert X
    // If user touched top but reported y is near height (i.e. large value) → invert Y
    let invertX = false;
    let invertY = false;

    // topLeft.x expected near 0 (left). If > 80% of width -> inverted
    if (typeof topLeft.x === 'number' && topLeft.x > geom.width * 0.8) invertX = true;
    // topLeft.y expected near 0 (top). If > 80% of height -> inverted
    if (typeof topLeft.y === 'number' && topLeft.y > geom.height * 0.8) invertY = true;

    // secondary check using bottomRight values (robustness)
    if (typeof bottomRight.x === 'number') {
      if (!invertX && bottomRight.x < geom.width * 0.2) invertX = true; // bottom-right reported near left -> inverted
    }
    if (typeof bottomRight.y === 'number') {
      if (!invertY && bottomRight.y < geom.height * 0.2) invertY = true; // bottom-right reported near top -> inverted
    }

    self.debugLog( ` Inversion detected for ${deviceName || devId}: invertX=${invertX}, invertY=${invertY}`);
    return { invertX, invertY };
  } catch (err) {
    self.logger.error(logPrefix + ` Touch inversion detection failed: ${err.message}`);
    return { invertX: false, invertY: false };
  }
};


display_configuration.prototype.applyPointerCorrection = async function () {
  const self = this;
  const display = self.getDisplaynumber();

  // Get pointer_offset - default is "0" (none/identity)
  let pointerOffset = self.getConfigValue("pointer_offset", "0");
  
  self.debugLog(` applyPointerCorrection: pointer_offset=${pointerOffset}`);

  // xrandr handles mouse transformation automatically for relative devices
  // Only apply explicit offset if set
  if (pointerOffset === "0" || pointerOffset === "none") {
    self.debugLog(` Pointer correction: none (xrandr handles relative devices)`);
    return;
  }

  // Explicit offset requested - apply it
  const offsetMatrices = {
    "90":  "0 1 0  -1 0 1  0 0 1",
    "180": "-1 0 1  0 -1 1  0 0 1",
    "270": "0 -1 1  1 0 0  0 0 1"
  };

  const matrix = offsetMatrices[pointerOffset];
  if (!matrix) {
    self.logger.warn(`${logPrefix} Invalid pointer_offset '${pointerOffset}', skipping`);
    return;
  }

  const logMsg = `offset ${pointerOffset}`;

  const execCmd = (cmd) =>
    new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          self.logger.error(`${logPrefix} exec error: ${stderr || error.message}`);
          return reject(error);
        }
        resolve(stdout.trim());
      });
    });

  try {
    const pointerDevices = await execCmd(`DISPLAY=${display} xinput list --name-only | grep -i mouse || true`);
    if (!pointerDevices) {
      self.debugLog(` No pointer (mouse) devices detected.`);
      return;
    }

    const deviceNames = pointerDevices.split("\n").filter(Boolean);
    for (const name of deviceNames) {
      try {
        const idMatch = await execCmd(`DISPLAY=${display} xinput list | grep -F "${name}" | grep -o "id=[0-9]*"`);
        const id = idMatch.replace("id=", "").trim();

        await execCmd(`DISPLAY=${display} xinput set-prop ${id} "Coordinate Transformation Matrix" ${matrix}`);
        self.debugLog(` Pointer correction applied to ${name} (id=${id}) - ${logMsg}`);
      } catch (err) {
        self.logger.warn(`${logPrefix} Failed to correct pointer ${name}: ${err.message}`);
      }
    }
  } catch (err) {
    self.logger.error(`${logPrefix} applyPointerCorrection error: ${err.message}`);
  }
};

// 2. Apply touch correction based on display rotation + touch offset
display_configuration.prototype.applyTouchCorrection = async function () {
   const self = this;
   const display = self.getDisplaynumber();
   const screen = await self.detectConnectedScreen();

   // Get config values
   let rotatescreen = self.getConfigValue("rotatescreen", "normal");
   let touchOffset = self.getConfigValue("touch_offset", "0");

   // Validate rotatescreen
   const validRotations = ['normal', 'inverted', 'left', 'right'];
   if (!validRotations.includes(rotatescreen)) {
      self.logger.warn(logPrefix + ` Invalid rotatescreen value '${rotatescreen}', using 'normal'`);
      rotatescreen = "normal";
   }

   // Validate touch_offset (degrees as string)
   const validOffsets = ['0', '90', '180', '270'];
   if (!validOffsets.includes(touchOffset)) {
      self.logger.warn(logPrefix + ` Invalid touch_offset value '${touchOffset}', using '0'`);
      touchOffset = "0";
   }

   // Inline helper
   const runCommand = (cmd) =>
      new Promise((resolve, reject) => {
         exec(cmd, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve(stdout);
         });
      });

   // Rotation matrices for display
   const rotationMatrices = {
      normal:   [ [1,0,0], [0,1,0], [0,0,1] ],
      inverted: [ [-1,0,1], [0,-1,1], [0,0,1] ],
      left:     [ [0,-1,1], [1,0,0], [0,0,1] ],
      right:    [ [0,1,0], [-1,0,1], [0,0,1] ]
   };

   // Offset matrices (additional rotation to compensate for hardware)
   const offsetMatrices = {
      "0":   [ [1,0,0], [0,1,0], [0,0,1] ],
      "90":  [ [0,1,0], [-1,0,1], [0,0,1] ],
      "180": [ [-1,0,1], [0,-1,1], [0,0,1] ],
      "270": [ [0,-1,1], [1,0,0], [0,0,1] ]
   };

   // Matrix multiplication
   function multiplyMatrix(A, B) {
      const R = [[0,0,0],[0,0,0],[0,0,0]];
      for (let i=0;i<3;i++) {
         for (let j=0;j<3;j++) {
            let s = 0;
            for (let k=0;k<3;k++) s += A[i][k] * B[k][j];
            R[i][j] = s;
         }
      }
      return R;
   }

   function matrixToString(m) {
      return `${m[0][0]} ${m[0][1]} ${m[0][2]}  ${m[1][0]} ${m[1][1]} ${m[1][2]}  ${m[2][0]} ${m[2][1]} ${m[2][2]}`;
   }

   try {
      const touchDevices = await self.detectTouchscreen();
      if (!touchDevices || touchDevices.length === 0) {
         self.debugLog( " No touchscreen detected, skipping correction.");
         return;
      }

      // Compute final matrix: display rotation * touch offset
      const rotMatrix = rotationMatrices[rotatescreen];
      const offsetMatrix = offsetMatrices[touchOffset];
      const finalMatrix = multiplyMatrix(rotMatrix, offsetMatrix);
      const matrixStr = matrixToString(finalMatrix);

      self.debugLog(` Touch matrix: display=${rotatescreen}, offset=${touchOffset}, matrix=${matrixStr}`);

      for (let dev of touchDevices) {
         try {
            // Check if device supports Coordinate Transformation Matrix
            const propsOutput = await runCommand(`DISPLAY=${display} xinput list-props ${dev.id}`);
            if (!propsOutput.includes("Coordinate Transformation Matrix")) {
               self.debugLog(` Skipping ${dev.name} (id=${dev.id}) - no transformation matrix support (likely stylus/pen)`);
               continue;
            }

            // Map device to output
            await runCommand(`DISPLAY=${display} xinput --map-to-output ${dev.id} ${screen}`);

            // Apply transformation matrix
            await runCommand(`DISPLAY=${display} xinput set-prop ${dev.id} "Coordinate Transformation Matrix" ${matrixStr}`);
            self.debugLog(` Touch correction applied to ${dev.name} (id=${dev.id})`);

         } catch (err) {
            self.logger.error(`${logPrefix} Failed to apply touch correction to ${dev.name} (id=${dev.id}): ${err.message}`);
         }
      }
   } catch (err) {
      self.logger.error(logPrefix + " applyTouchCorrection error: " + (err && err.message ? err.message : err));
   }
};


// 3. Handle cursor hiding
display_configuration.prototype.applyCursorSetting = function () {
   const self = this;
   const display = self.getDisplaynumber();
   const hidecursor = self.getConfigValue("hidecursor", false);

   try {
      // Stop any existing unclutter processes first
      exec("/bin/echo volumio | /usr/bin/sudo -S pkill -9 -f unclutter", { uid: 1000, gid: 1000 }, (err) => {
         if (err) self.debugLog( " No unclutter process to stop");

         if (hidecursor) {
            // Start unclutter as volumio user
            exec(`/bin/echo volumio | /usr/bin/sudo -S DISPLAY=${display} unclutter-xfixes -idle 3`, { uid: 1000, gid: 1000 }, (err2) => {
               if (err2) {
                  self.logger.error(logPrefix + " Error starting unclutter: " + err2);
               } else {
                  self.debugLog( " unclutter started as volumio user");
               }
            });
         } else {
            self.debugLog( " unclutter stopped");
         }
      });

   } catch (err) {
      self.logger.error(logPrefix + " applyCursorSetting error: " + err);
   }
};

// Restart kiosk service to refresh X session - callable from UI
display_configuration.prototype.restartKiosk = function() {
   const self = this;
   const defer = libQ.defer();

   self.commandRouter.pushToastMessage('info', 
      self.getI18nString('PLUGIN_TITLE'),
      self.getI18nString('RESTARTING_DISPLAY'));

   exec('sudo systemctl restart volumio-kiosk.service', (err) => {
      if (err) {
         self.logger.error(logPrefix + ' Failed to restart kiosk: ' + err.message);
         self.commandRouter.pushToastMessage('error',
            self.getI18nString('PLUGIN_TITLE'),
            self.getI18nString('RESTART_FAILED'));
         defer.reject(err);
         return;
      }

      self.debugLog( ' Kiosk service restarted by user');

      // Wait for X to come back up, then re-apply settings
      setTimeout(() => {
         self.fixXauthority();

         setTimeout(() => {
            self.testXAccess().then((accessible) => {
               if (accessible) {
                  self.applyscreensettingsboot();
                  self.commandRouter.pushToastMessage('success',
                     self.getI18nString('PLUGIN_TITLE'),
                     self.getI18nString('RESTART_SUCCESS'));
               } else {
                  self.commandRouter.pushToastMessage('warning',
                     self.getI18nString('PLUGIN_TITLE'),
                     self.getI18nString('RESTART_PARTIAL'));
               }
               defer.resolve();
            });
         }, 3000);
      }, 2000);
   });

   return defer.promise;
};

display_configuration.prototype.generateDiagnostics = function() {
  const self = this;
  const defer = libQ.defer();

  const diagnosticFile = '/tmp/volumio-display-diagnostics.txt';

  const script = `
    echo "=== VOLUMIO DISPLAY DIAGNOSTICS ==="
    echo "Generated: $(date)"
    echo ""
    echo "=== SYSTEM INFO ==="
    echo "Vendor: $(cat /sys/class/dmi/id/sys_vendor 2>&1 || echo N/A)"
    echo "Product: $(cat /sys/class/dmi/id/product_name 2>&1 || echo N/A)"
    echo "Kernel: $(uname -r)"
    echo ""
    echo "=== KERNEL CMDLINE ==="
    cat /proc/cmdline
    echo ""
    echo "=== DRM CONNECTORS ==="
    for conn in /sys/class/drm/card*/card*/status; do echo "$conn: $(cat $conn 2>&1)"; done
    echo ""
    echo "=== PANEL ORIENTATION ==="
    for orient in /sys/class/drm/*/panel_orientation; do [ -f "$orient" ] && echo "$orient: $(cat $orient 2>&1)"; done || echo "No panel_orientation found"
    echo ""
    echo "=== FBCON ROTATE ==="
    cat /sys/class/graphics/fbcon/rotate 2>&1 || echo "fbcon not available"
    echo ""
    echo "=== XRANDR OUTPUT ==="
    DISPLAY=:0 xrandr --verbose 2>&1 || echo "xrandr failed"
    echo ""
    echo "=== INPUT DEVICES ==="
    DISPLAY=:0 xinput list 2>&1 || echo "xinput failed"
    echo ""
    echo "=== INPUT DEVICE PROPERTIES (first 3 devices) ==="
    DISPLAY=:0 xinput list | grep -o "id=[0-9]*" | head -3 | while read id; do devid=$(echo $id | cut -d= -f2); echo "--- Device $devid ---"; DISPLAY=:0 xinput list-props $devid 2>&1; done || echo "xinput props failed"
    echo ""
    echo "=== DMESG ROTATION/DRM ==="
    dmesg | grep -iE "panel_orientation|drm.*orientation|video=|fbcon" | tail -20
    echo ""
    echo "=== PLUGIN CONFIG ==="
    cat /data/configuration/user_interface/display_configuration/config.json 2>&1 || echo "Config not found"
    echo ""
    echo "=== ROTATION CFG ==="
    cat /data/plugins/user_interface/display_configuration/rotation.cfg 2>&1 || echo "rotation.cfg not found"
    echo ""
    echo "=== GRUB CONFIG CHECK ==="
    grep -A5 -B5 volumio /boot/grub/grub.cfg 2>&1 || echo "No volumio entries in grub.cfg"
    echo ""
    echo "=== X11 CONFIG FILES ==="
    ls -la /etc/X11/xorg.conf.d/*volumio* 2>&1 || echo "No volumio xorg configs found"
    echo ""
    echo "=== END DIAGNOSTICS ==="
  `;

  const outFd = fs.openSync(diagnosticFile, 'w');
  const proc = spawn('bash', ['-c', script], {
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, DISPLAY: ':0' },
  });

  proc.on('exit', (code) => {
    fs.closeSync(outFd);
    if (code === 0) {
      self.debugLog(` Diagnostics saved to ${diagnosticFile}`);
      self.commandRouter.pushToastMessage('success', 'Diagnostics Generated',
        `Report saved to ${diagnosticFile}`);
      defer.resolve();
    } else {
      self.logger.error(`${logPrefix} Diagnostics failed with exit code ${code}`);
      self.commandRouter.pushToastMessage('error', 'Diagnostic Failed',
        'Error during diagnostic generation');
      defer.reject(new Error(`Diagnostics failed with code ${code}`));
    }
  });

  proc.on('error', (err) => {
    fs.closeSync(outFd);
    self.logger.error(`${logPrefix} Failed to spawn diagnostics: ${err.message}`);
    self.commandRouter.pushToastMessage('error', 'Diagnostic Failed',
      'Could not spawn diagnostics process');
    defer.reject(err);
  });

  return defer.promise;
};
