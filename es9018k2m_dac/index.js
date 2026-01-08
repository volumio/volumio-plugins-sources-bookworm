'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var io = require('socket.io-client');

module.exports = ControllerES9018K2M;

function ControllerES9018K2M(context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  // I2C configuration
  self.i2cBus = 1;
  self.i2cAddress = 0x48;

  // Device state
  self.deviceFound = false;

  // External volume device (Allo Relay Attenuator, pre-amp, receiver)
  self.externalVolume = false;

  // Volume mode: 'hardware' or 'software' (only used when externalVolume = false)
  self.volumeMode = 'hardware';
  self.cardNumber = -1;  // -1 = auto-detect
  self.volumeOverrideRegistered = false;

  // Startup volume settings (hardware mode only)
  self.startMuted = false;
  self.safeStartupEnabled = false;
  self.safeStartupVolume = 25;
  self.rememberLastVolume = false;
  self.lastSavedVolume = -1;  // -1 = not saved
  self.startupVolumeApplied = false;  // Flag to prevent saving during startup

  // Current volume/mute state for hardware mode
  self.currentVolume = 100;
  self.currentMute = false;

  // State tracking
  self.lastVolume = null;
  self.lastStatus = null;
  self.lastSeek = null;
  self.seekMuteMs = 150;
  self.debugLogging = false;

  // Graceful settings
  self.gracefulSteps = 3;
  self.gracefulTransitions = true;
  self.gracefulVolume = true;

  // Balance offsets
  self.lBal = 0;
  self.rBal = 0;

  // Register shadows
  self.reg7 = 0x80;   // General settings (mute, filters)
  self.reg12 = 0x5A;  // DPLL settings
  self.reg21 = 0x00;  // GPIO and OSF bypass

  // Timing constants
  self.I2C_THROTTLE_MS = 30;
  self.lastI2cWrite = 0;

  // Socket.io state
  self.volumioSocket = null;
  self.socketConnected = false;
  self.reconnectAttempts = 0;
  self.maxReconnectDelay = 30000;
  self.reconnectTimer = null;
  self.socketFailedSince = null;
  self.fallbackPoller = null;

  // Seek intercept state
  self.originalSeek = null;
  self.seekInterceptInstalled = false;
}

// ---------------------------------------------------------------------------
// Volumio Lifecycle
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.onVolumioStart = function() {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context, 'config.json'
  );

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);

  return libQ.resolve();
};

ControllerES9018K2M.prototype.onStart = function() {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('ES9018K2M: Starting plugin');

  self.loadI18nStrings();
  self.loadConfig();

  self.checkDevice()
    .then(function(found) {
      self.deviceFound = found;
      if (found) {
        self.initDevice();
        self.applySettings();
        self.installSeekIntercept();

        // Start appropriate volume control mode
        if (self.externalVolume) {
          // External device handles volume (Allo Relay Attenuator, pre-amp, receiver)
          // DAC features, seek mute, and graceful transitions still work
          self.startupVolumeApplied = true;  // No startup volume logic needed
          self.logger.info('ES9018K2M: External volume device enabled - plugin manages DAC features only');
        } else if (self.volumeMode === 'hardware') {
          self.registerVolumeOverride();
          self.applyStartupVolume();
        } else {
          // software mode - Volumio handles startup volume
          self.startupVolumeApplied = true;
          self.startVolumeSync();
        }

        self.startSocketConnection();
        var modeDesc = self.externalVolume ? 'external' : self.volumeMode;
        self.logger.info('ES9018K2M: Device initialized, volume mode: ' + modeDesc);
      } else {
        self.logger.warn('ES9018K2M: Device not found at address 0x' +
          self.i2cAddress.toString(16));
      }
      defer.resolve();
    })
    .fail(function(err) {
      self.logger.error('ES9018K2M: Startup failed: ' + err);
      defer.resolve();
    });

  return defer.promise;
};

ControllerES9018K2M.prototype.onStop = function() {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('ES9018K2M: Stopping plugin');

  // Save volume if remember enabled (hardware mode only)
  if (self.volumeMode === 'hardware' && self.rememberLastVolume) {
    if (self.currentVolume !== self.lastSavedVolume) {
      self.config.set('lastSavedVolume', self.currentVolume);
      self.lastSavedVolume = self.currentVolume;
      // Force flush to disk - config may not be saved before shutdown otherwise
      self.config.save();
      self.logger.info('ES9018K2M: Saved volume on stop: ' + self.currentVolume);
    }
  }

  // Remove seek intercept first
  self.removeSeekIntercept();

  // Stop socket connection
  self.stopSocketConnection();

  // Unregister volume override if active
  if (self.volumeOverrideRegistered) {
    self.unregisterVolumeOverride();
  }

  // Stop volume sync callback
  self.stopVolumeSync();

  // Mute DAC before stopping
  if (self.deviceFound) {
    self.setMuteSync(true);
  }

  defer.resolve();
  return defer.promise;
};

ControllerES9018K2M.prototype.onVolumioShutdown = function() {
  var self = this;

  // Save volume if remember enabled
  if (self.volumeMode === 'hardware' && self.rememberLastVolume) {
    if (self.currentVolume !== self.lastSavedVolume) {
      self.config.set('lastSavedVolume', self.currentVolume);
      self.config.save();
      self.logger.info('ES9018K2M: Saved volume on shutdown: ' + self.currentVolume);
    }
  }

  self.removeSeekIntercept();
  if (self.volumeOverrideRegistered) {
    self.unregisterVolumeOverride();
  }
  if (self.deviceFound) {
    self.setMuteSync(true);
  }
  return libQ.resolve();
};

ControllerES9018K2M.prototype.onVolumioReboot = function() {
  var self = this;

  // Save volume if remember enabled
  if (self.volumeMode === 'hardware' && self.rememberLastVolume) {
    if (self.currentVolume !== self.lastSavedVolume) {
      self.config.set('lastSavedVolume', self.currentVolume);
      self.config.save();
      self.logger.info('ES9018K2M: Saved volume on reboot: ' + self.currentVolume);
    }
  }

  self.removeSeekIntercept();
  if (self.volumeOverrideRegistered) {
    self.unregisterVolumeOverride();
  }
  if (self.deviceFound) {
    self.setMuteSync(true);
  }
  return libQ.resolve();
};

// ---------------------------------------------------------------------------
// Startup Volume Logic (Hardware Mode Only)
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.applyStartupVolume = function() {
  var self = this;

  // Check if any startup volume features are enabled
  var hasStartupFeatures = self.startMuted || self.rememberLastVolume || self.safeStartupEnabled;

  if (!hasStartupFeatures) {
    self.startupVolumeApplied = true;  // Allow volume saves immediately
    self.logger.info('ES9018K2M: No startup volume features enabled');
    return;
  }

  self.logger.info('ES9018K2M: Waiting for system ready state before applying startup volume');

  var pollingInterval = 1500;  // 1.5 seconds
  var maxAttempts = 60;        // 90 seconds max wait
  var attempts = 0;

  function checkSystemReady() {
    attempts++;

    var systemStatus = process.env.VOLUMIO_SYSTEM_STATUS;

    self.logDebug('ES9018K2M: Ready check #' + attempts + '/' + maxAttempts +
      ' - VOLUMIO_SYSTEM_STATUS=' + systemStatus);

    if (systemStatus === 'ready') {
      self.logger.info('ES9018K2M: System ready after ' + attempts + ' checks, applying startup volume');
      self.doApplyStartupVolume();

    } else if (attempts < maxAttempts) {
      // Not ready yet - check again
      setTimeout(checkSystemReady, pollingInterval);

    } else {
      // Timeout - apply anyway
      self.logger.warn('ES9018K2M: Timeout waiting for ready state, applying startup volume anyway');
      self.doApplyStartupVolume();
    }
  }

  // Start polling
  checkSystemReady();
};

ControllerES9018K2M.prototype.doApplyStartupVolume = function() {
  var self = this;

  // Get current system volume (Volumio has now set its startup volume)
  var state = self.commandRouter.volumioGetState();
  var systemVolume = (state && typeof state.volume === 'number') ? state.volume : 100;

  self.logger.info('ES9018K2M: Startup volume logic - system=' + systemVolume +
    ', startMuted=' + self.startMuted +
    ', rememberLast=' + self.rememberLastVolume +
    ', lastSaved=' + self.lastSavedVolume +
    ', safeEnabled=' + self.safeStartupEnabled +
    ', safeLevel=' + self.safeStartupVolume);

  var targetVolume = systemVolume;
  var shouldMute = false;

  // Priority 1: Start muted
  if (self.startMuted) {
    shouldMute = true;
    // If rememberLastVolume also enabled, use that for slider position
    // Otherwise keep system volume for slider
    if (self.rememberLastVolume && self.lastSavedVolume >= 0) {
      targetVolume = self.lastSavedVolume;
      self.logger.info('ES9018K2M: Starting muted at remembered volume: ' + targetVolume);
    } else {
      targetVolume = systemVolume;
      self.logger.info('ES9018K2M: Starting muted at system volume: ' + targetVolume);
    }
  }
  // Priority 2: Remember last volume (only if we have a saved value)
  else if (self.rememberLastVolume && self.lastSavedVolume >= 0) {
    targetVolume = self.lastSavedVolume;
    self.logger.info('ES9018K2M: Restoring last volume: ' + targetVolume);
  }
  // Priority 3: Safe startup (cap down only)
  else if (self.safeStartupEnabled && systemVolume > self.safeStartupVolume) {
    targetVolume = self.safeStartupVolume;
    self.logger.info('ES9018K2M: Applying safe startup volume: ' + targetVolume +
      ' (was ' + systemVolume + ')');
  }

  // Apply to DAC directly (bypass alsavolume to avoid feedback loop)
  self.currentVolume = targetVolume;
  self.setVolumeImmediate(targetVolume);

  if (shouldMute) {
    self.setMuteSync(true);
    self.currentMute = true;
  }

  // Push state to Volumio so UI reflects our override
  self.commandRouter.volumioupdatevolume({
    vol: targetVolume,
    mute: shouldMute
  });

  // Mark startup complete - now safe to save volume changes
  self.startupVolumeApplied = true;

  self.logger.info('ES9018K2M: Startup volume applied: ' + targetVolume +
    (shouldMute ? ' (muted)' : ''));
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.getConfigurationFiles = function() {
  return ['config.json'];
};

ControllerES9018K2M.prototype.loadConfig = function() {
  var self = this;

  self.i2cBus = self.config.get('i2cBus', 1);
  self.i2cAddress = self.config.get('i2cAddress', 0x48);
  self.debugLogging = self.config.get('debugLogging', false);

  // External volume device
  self.externalVolume = self.config.get('externalVolume', false);

  // Volume mode settings
  self.volumeMode = self.config.get('volumeMode', 'hardware');

  // Migration: convert old 'passthrough' volumeMode to new externalVolume
  if (self.volumeMode === 'passthrough') {
    self.externalVolume = true;
    self.volumeMode = 'hardware';
    self.config.set('externalVolume', true);
    self.config.set('volumeMode', 'hardware');
    self.logger.info('ES9018K2M: Migrated passthrough mode to externalVolume');
  }

  self.cardNumber = self.config.get('cardNumber', -1);

  // Startup volume settings (hardware mode only)
  self.startMuted = self.config.get('startMuted', false);
  self.safeStartupEnabled = self.config.get('safeStartupEnabled', false);
  self.safeStartupVolume = self.config.get('safeStartupVolume', 25);
  self.rememberLastVolume = self.config.get('rememberLastVolume', false);
  self.lastSavedVolume = self.config.get('lastSavedVolume', -1);

  // Mute & transitions settings
  self.seekMuteMs = self.config.get('seekMuteMs', 150);
  self.gracefulSteps = self.config.get('gracefulSteps', 3);
  self.gracefulTransitions = self.config.get('gracefulTransitions', true);
  self.gracefulVolume = self.config.get('gracefulVolume', true);

  self.lBal = 0;
  self.rBal = 0;
  var balance = self.config.get('balance', 0);
  if (balance > 0) {
    self.lBal = balance;
  } else if (balance < 0) {
    self.rBal = -balance;
  }
};

ControllerES9018K2M.prototype.logDebug = function(msg) {
  var self = this;
  if (self.debugLogging) {
    self.logger.info(msg);
  }
};

ControllerES9018K2M.prototype.saveConfig = function() {
  var self = this;

  self.config.set('i2cBus', self.i2cBus);
  self.config.set('i2cAddress', self.i2cAddress);
  self.config.set('balance', self.config.get('balance', 0));
  self.config.set('fir', self.config.get('fir', 1));
  self.config.set('iir', self.config.get('iir', 0));
  self.config.set('deemphasis', self.config.get('deemphasis', 0x4A));
  self.config.set('i2sDpll', self.config.get('i2sDpll', 0x50));
  self.config.set('dsdDpll', self.config.get('dsdDpll', 0x0A));
};

ControllerES9018K2M.prototype.getUIConfig = function() {
  var self = this;
  var defer = libQ.defer();
  var langCode = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + langCode + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
  .then(function(uiconf) {
    // Section 0: Prerequisites (static text)

    // Section 1: Device Detection
    uiconf.sections[1].description = self.deviceFound
      ? self.getI18nString('DEVICE_FOUND')
      : self.getI18nString('DEVICE_NOT_FOUND');

    uiconf.sections[1].content[0].value = self.i2cBus;
    uiconf.sections[1].content[1].value = '0x' + self.i2cAddress.toString(16).toUpperCase();
    uiconf.sections[1].content[2].value = self.config.get('debugLogging', false);

    // Section 2: Volume Control (merged)
    // [0] externalVolume, [1] volumeMode, [2] cardNumber, [3] startMuted,
    // [4] safeStartupEnabled, [5] safeStartupVolume, [6] rememberLastVolume
    uiconf.sections[2].content[0].value = self.config.get('externalVolume', false);

    var volumeModeValue = self.config.get('volumeMode', 'hardware');
    var volumeModeLabel = (volumeModeValue === 'hardware')
      ? self.getI18nString('VOLUME_MODE_HARDWARE')
      : self.getI18nString('VOLUME_MODE_SOFTWARE');
    uiconf.sections[2].content[1].value = {
      value: volumeModeValue,
      label: volumeModeLabel
    };

    // Hardware-only fields - hide when software mode (in addition to visibleIf for externalVolume)
    var hideHardwareFields = (volumeModeValue !== 'hardware');

    // Card number - show auto-detected value or manual override
    var cardNum = self.config.get('cardNumber', -1);
    var detectedCard = self.getAutoDetectedCard();
    if (cardNum === -1) {
      uiconf.sections[2].content[2].value = 'auto (' + detectedCard + ')';
    } else {
      uiconf.sections[2].content[2].value = String(cardNum);
    }
    uiconf.sections[2].content[2].hidden = hideHardwareFields;

    // Start muted
    uiconf.sections[2].content[3].value = self.config.get('startMuted', false);
    uiconf.sections[2].content[3].hidden = hideHardwareFields;

    // Safe startup enabled
    uiconf.sections[2].content[4].value = self.config.get('safeStartupEnabled', false);
    uiconf.sections[2].content[4].hidden = hideHardwareFields;

    // Safe startup volume
    uiconf.sections[2].content[5].value = self.config.get('safeStartupVolume', 25);
    uiconf.sections[2].content[5].hidden = hideHardwareFields;

    // Remember last volume
    uiconf.sections[2].content[6].value = self.config.get('rememberLastVolume', false);
    uiconf.sections[2].content[6].hidden = hideHardwareFields;

    // Section 3: Mute & Transitions
    // [0] seekMuteMs, [1] gracefulSteps, [2] gracefulTransitions, [3] gracefulVolume
    uiconf.sections[3].content[0].value = self.config.get('seekMuteMs', 150);
    uiconf.sections[3].content[1].value = self.config.get('gracefulSteps', 3);
    uiconf.sections[3].content[2].value = self.config.get('gracefulTransitions', true);
    uiconf.sections[3].content[3].value = self.config.get('gracefulVolume', true);

    // Section 4: Channel Balance
    uiconf.sections[4].content[0].value = self.config.get('balance', 0);

    // Section 5: Digital Filters
    uiconf.sections[5].content[0].value = self.getFirOption(self.config.get('fir', 1));
    uiconf.sections[5].content[1].value = self.getIirOption(self.config.get('iir', 0));
    uiconf.sections[5].content[2].value = self.getDeemphasisOption(self.config.get('deemphasis', 0x4A));

    // Section 6: DPLL
    uiconf.sections[6].content[0].value = self.getDpllOption(self.config.get('i2sDpll', 0x50));
    uiconf.sections[6].content[1].value = self.getDpllOption(self.config.get('dsdDpll', 0x0A));

    defer.resolve(uiconf);
  })
  .fail(function(err) {
    self.logger.error('ES9018K2M: getUIConfig failed: ' + err);
    defer.reject(err);
  });

  return defer.promise;
};

// ---------------------------------------------------------------------------
// I2C Operations
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.i2cWriteSync = function(register, value) {
  var self = this;

  var cmd = 'i2cset -y ' + self.i2cBus + ' 0x' +
    self.i2cAddress.toString(16) + ' 0x' +
    register.toString(16) + ' 0x' +
    value.toString(16);

  try {
    execSync(cmd, { timeout: 100 });
    return true;
  } catch (err) {
    self.logger.error('ES9018K2M: I2C sync write failed: ' + err.message);
    return false;
  }
};

ControllerES9018K2M.prototype.i2cWrite = function(register, value) {
  var self = this;
  var defer = libQ.defer();

  var now = Date.now();
  var delay = Math.max(0, self.I2C_THROTTLE_MS - (now - self.lastI2cWrite));

  setTimeout(function() {
    var cmd = 'i2cset -y ' + self.i2cBus + ' 0x' +
      self.i2cAddress.toString(16) + ' 0x' +
      register.toString(16) + ' 0x' +
      value.toString(16);

    exec(cmd, function(error, stdout, stderr) {
      self.lastI2cWrite = Date.now();
      if (error) {
        self.logger.error('ES9018K2M: I2C write failed: ' + error);
        defer.reject(error);
      } else {
        defer.resolve();
      }
    });
  }, delay);

  return defer.promise;
};

ControllerES9018K2M.prototype.i2cRead = function(register) {
  var self = this;
  var defer = libQ.defer();

  var cmd = 'i2cget -y ' + self.i2cBus + ' 0x' +
    self.i2cAddress.toString(16) + ' 0x' +
    register.toString(16);

  exec(cmd, function(error, stdout, stderr) {
    if (error) {
      self.logger.error('ES9018K2M: I2C read failed: ' + error);
      defer.reject(error);
    } else {
      var value = parseInt(stdout.trim(), 16);
      defer.resolve(value);
    }
  });

  return defer.promise;
};

// ---------------------------------------------------------------------------
// Device Detection and Initialization
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.checkDevice = function() {
  var self = this;
  var defer = libQ.defer();

  self.i2cRead(64)
    .then(function(status) {
      var isES9018K2M = (status & 0x1C) === 0x10;
      if (isES9018K2M) {
        var revision = status & 0x03;
        self.logger.info('ES9018K2M: Found device (reg64=0x' +
          status.toString(16) + ', revision=' + revision + ')');
      }
      defer.resolve(isES9018K2M);
    })
    .fail(function(err) {
      self.logger.error('ES9018K2M: Device detection failed: ' + err);
      defer.resolve(false);
    });

  return defer.promise;
};

ControllerES9018K2M.prototype.initDevice = function() {
  var self = this;

  self.setMuteSync(true);

  // Register 0x00: System settings
  self.i2cWrite(0x00, 0x00);

  // Register 0x01: Input configuration (32-bit I2S, auto-detect)
  self.i2cWrite(0x01, 0xC4);

  // Register 0x04: Automute time
  self.i2cWrite(0x04, 0x10);

  // Register 0x05: Automute level (-104dB)
  self.i2cWrite(0x05, 0x68);

  // Register 0x06: De-emphasis and volume ramp rate
  self.i2cWrite(0x06, 0x47);

  // Register 0x08: GPIO configuration
  self.i2cWrite(0x08, 0x01);

  // Register 0x0C: DPLL/ASRC settings
  self.i2cWrite(0x0C, 0x5F);

  // Register 0x0E: Soft start - KEY FOR POP PREVENTION on format changes
  self.i2cWrite(0x0E, 0x8A);

  // Register 0x15: GPIO and oversampling filter bypass
  self.i2cWrite(0x15, 0x00);

  // Register 0x1B: ASRC and volume latch
  self.i2cWrite(0x1B, 0xD4);

  // Initialize volume to 100% (full scale, no attenuation)
  self.currentVolume = 100;
  self.setVolumeImmediate(100);

  self.setMuteSync(false);

  self.logger.info('ES9018K2M: Device initialized');
};

ControllerES9018K2M.prototype.applySettings = function() {
  var self = this;

  self.setFirFilter(self.config.get('fir', 1));
  self.setIirFilter(self.config.get('iir', 0));
  self.setDeemphasis(self.config.get('deemphasis', 0x4A));
  self.setDpll(
    self.config.get('i2sDpll', 0x50),
    self.config.get('dsdDpll', 0x0A)
  );
};

// ---------------------------------------------------------------------------
// Hardware Volume Override - Integration with alsa_controller
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.getAutoDetectedCard = function() {
  var self = this;

  try {
    var outputDevice = self.commandRouter.executeOnPlugin(
      'audio_interface',
      'alsa_controller',
      'getConfigParam',
      'outputdevice'
    );
    return outputDevice !== undefined ? outputDevice : 0;
  } catch (err) {
    self.logger.warn('ES9018K2M: Could not auto-detect card: ' + err.message);
    return 0;
  }
};

ControllerES9018K2M.prototype.getEffectiveCardNumber = function() {
  var self = this;

  if (self.cardNumber >= 0) {
    return self.cardNumber;
  }
  return self.getAutoDetectedCard();
};

ControllerES9018K2M.prototype.registerVolumeOverride = function() {
  var self = this;

  var effectiveCard = self.getEffectiveCardNumber();

  self.logger.info('ES9018K2M: Registering volume override for card ' + effectiveCard);

  try {
    self.commandRouter.executeOnPlugin(
      'audio_interface',
      'alsa_controller',
      'setDeviceVolumeOverride',
      {
        card: effectiveCard,
        pluginType: 'system_hardware',
        pluginName: 'es9018k2m',
        overrideMixerType: 'Hardware',
        overrideAvoidSoftwareMixer: true
      }
    );
    self.volumeOverrideRegistered = true;
    self.logger.info('ES9018K2M: Volume override registered successfully');
  } catch (err) {
    self.logger.error('ES9018K2M: Failed to register volume override: ' + err.message);
    self.volumeOverrideRegistered = false;
  }
};

ControllerES9018K2M.prototype.unregisterVolumeOverride = function() {
  var self = this;

  self.logger.info('ES9018K2M: Unregistering volume override');

  try {
    // Pass card: -1 to indicate clearing the override
    self.commandRouter.executeOnPlugin(
      'audio_interface',
      'alsa_controller',
      'setDeviceVolumeOverride',
      {
        card: -1,
        pluginType: '',
        pluginName: ''
      }
    );
    self.volumeOverrideRegistered = false;
    self.logger.info('ES9018K2M: Volume override unregistered');
  } catch (err) {
    self.logger.error('ES9018K2M: Failed to unregister volume override: ' + err.message);
  }
};

// Called by volumecontrol.js when user changes volume (hardware mode)
ControllerES9018K2M.prototype.alsavolume = function(VolumeInteger) {
  var self = this;

  self.logDebug('ES9018K2M: alsavolume called: ' + VolumeInteger);

  if (!self.deviceFound) {
    return libQ.resolve();
  }

  var newVolume = parseInt(VolumeInteger, 10);
  if (isNaN(newVolume)) {
    newVolume = 100;
  }
  newVolume = Math.max(0, Math.min(100, newVolume));

  var oldVolume = self.currentVolume;

  // Use graceful ramping if enabled and volume change is significant
  if (self.gracefulVolume && Math.abs(newVolume - oldVolume) > 5) {
    self.gracefulVolumeChangeSync(oldVolume, newVolume);
  } else {
    self.setVolumeImmediate(newVolume);
  }

  self.currentVolume = newVolume;
  self.lastVolume = newVolume;

  // Save immediately if rememberLastVolume enabled AND startup is complete
  // Don't save during startup - Volumio calls alsavolume before our startup logic runs
  if (self.rememberLastVolume && self.startupVolumeApplied) {
    self.config.set('lastSavedVolume', newVolume);
    self.config.save();
    self.lastSavedVolume = newVolume;
    self.logDebug('ES9018K2M: Volume saved: ' + newVolume);
  } else if (self.rememberLastVolume && !self.startupVolumeApplied) {
    self.logDebug('ES9018K2M: Volume change ignored during startup: ' + newVolume);
  }

  // Push state back to Volumio so UI reflects the change
  self.commandRouter.volumioupdatevolume({
    vol: newVolume,
    mute: self.currentMute
  });

  return libQ.resolve();
};

// Called to retrieve current volume state (hardware mode)
ControllerES9018K2M.prototype.retrievevolume = function() {
  var self = this;

  return libQ.resolve({
    vol: self.currentVolume,
    mute: self.currentMute
  });
};

// Called by Volumio when volume settings are updated (hardware mode)
ControllerES9018K2M.prototype.updateVolumeSettings = function(data) {
  var self = this;

  // Volumio calls this after volume override is registered
  // We acknowledge but don't need to act on it
  self.logDebug('ES9018K2M: updateVolumeSettings called');
  return libQ.resolve();
};

// ---------------------------------------------------------------------------
// Seek Intercept - Pre-emptive mute for pop-free seeks
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.installSeekIntercept = function() {
  var self = this;

  if (self.seekInterceptInstalled) {
    return;
  }

  if (typeof self.commandRouter.volumioSeek !== 'function') {
    self.logger.warn('ES9018K2M: volumioSeek not found, seek intercept disabled');
    return;
  }

  // Save original function
  self.originalSeek = self.commandRouter.volumioSeek.bind(self.commandRouter);

  // Install wrapper
  self.commandRouter.volumioSeek = function(position) {
    self.logDebug('ES9018K2M: Seek intercept - position=' + position);

    // Pre-emptive mute (synchronous - blocks until complete)
    if (self.deviceFound && self.seekMuteMs > 0) {
      // Always use graceful mute for seeks (this is the primary use case)
      self.gracefulMuteSync(true);
      self.logDebug('ES9018K2M: Pre-emptive graceful mute applied');
    }

    // Execute original seek
    var result = self.originalSeek(position);

    // Schedule unmute
    if (self.deviceFound && self.seekMuteMs > 0) {
      setTimeout(function() {
        // Check if we should unmute (not user-muted, still playing)
        var state = self.commandRouter.volumioGetState();
        if (state && state.status === 'play' && !state.mute) {
          self.gracefulMuteSync(false);
          self.logDebug('ES9018K2M: Graceful unmute after seek');
        }
      }, self.seekMuteMs);
    }

    return result;
  };

  self.seekInterceptInstalled = true;
  self.logger.info('ES9018K2M: Seek intercept installed');
};

ControllerES9018K2M.prototype.removeSeekIntercept = function() {
  var self = this;

  if (!self.seekInterceptInstalled || !self.originalSeek) {
    return;
  }

  // Restore original function
  self.commandRouter.volumioSeek = self.originalSeek;
  self.originalSeek = null;
  self.seekInterceptInstalled = false;

  self.logger.info('ES9018K2M: Seek intercept removed');
};

// ---------------------------------------------------------------------------
// Socket.io Connection - Event-driven state tracking
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.startSocketConnection = function() {
  var self = this;

  self.logDebug('ES9018K2M: Starting socket.io connection');

  self.connectSocket();
};

ControllerES9018K2M.prototype.connectSocket = function() {
  var self = this;

  // Clean up existing connection
  if (self.volumioSocket) {
    self.volumioSocket.removeAllListeners();
    self.volumioSocket.close();
    self.volumioSocket = null;
  }

  // Connect to local Volumio backend
  self.volumioSocket = io.connect('http://localhost:3000', {
    reconnection: false,  // We handle reconnection ourselves
    timeout: 5000
  });

  self.volumioSocket.on('connect', function() {
    self.socketConnected = true;
    self.reconnectAttempts = 0;
    self.socketFailedSince = null;

    self.logDebug('ES9018K2M: Socket connected');

    // Stop fallback poller if running
    self.stopFallbackPoller();

    // Request initial state
    self.volumioSocket.emit('getState', '');
  });

  self.volumioSocket.on('pushState', function(state) {
    self.logDebug('ES9018K2M: pushState received - status=' + state.status +
      ' volume=' + state.volume + ' seek=' + state.seek);

    self.handleStateChange(state);
  });

  self.volumioSocket.on('disconnect', function() {
    self.socketConnected = false;
    self.logDebug('ES9018K2M: Socket disconnected');
    self.scheduleReconnect();
  });

  self.volumioSocket.on('connect_error', function(err) {
    self.socketConnected = false;
    self.logDebug('ES9018K2M: Socket connect_error: ' + err.message);
    self.scheduleReconnect();
  });

  self.volumioSocket.on('error', function(err) {
    self.logDebug('ES9018K2M: Socket error: ' + err.message);
  });
};

ControllerES9018K2M.prototype.scheduleReconnect = function() {
  var self = this;

  if (self.reconnectTimer) {
    return;  // Already scheduled
  }

  self.reconnectAttempts++;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
  var delay = Math.min(
    1000 * Math.pow(2, self.reconnectAttempts - 1),
    self.maxReconnectDelay
  );

  self.logDebug('ES9018K2M: Scheduling reconnect in ' + delay + 'ms (attempt ' +
    self.reconnectAttempts + ')');

  // Track when socket first failed
  if (!self.socketFailedSince) {
    self.socketFailedSince = Date.now();
  }

  // Start fallback poller if socket has been down for >5 minutes
  if (Date.now() - self.socketFailedSince > 300000) {
    self.startFallbackPoller();
  }

  self.reconnectTimer = setTimeout(function() {
    self.reconnectTimer = null;
    self.connectSocket();
  }, delay);
};

ControllerES9018K2M.prototype.stopSocketConnection = function() {
  var self = this;

  if (self.reconnectTimer) {
    clearTimeout(self.reconnectTimer);
    self.reconnectTimer = null;
  }

  self.stopFallbackPoller();

  if (self.volumioSocket) {
    self.volumioSocket.removeAllListeners();
    self.volumioSocket.close();
    self.volumioSocket = null;
  }

  self.socketConnected = false;
  self.logger.info('ES9018K2M: Socket connection stopped');
};

// ---------------------------------------------------------------------------
// Fallback Poller - Only used if socket fails for extended period
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.startFallbackPoller = function() {
  var self = this;

  if (self.fallbackPoller) {
    return;  // Already running
  }

  self.logger.warn('ES9018K2M: Socket unavailable, starting fallback poller (60s interval)');

  self.fallbackPoller = setInterval(function() {
    var state = self.commandRouter.volumioGetState();
    if (state) {
      self.handleStateChange(state);
    }
  }, 60000);  // 60 seconds - minimal impact
};

ControllerES9018K2M.prototype.stopFallbackPoller = function() {
  var self = this;

  if (self.fallbackPoller) {
    clearInterval(self.fallbackPoller);
    self.fallbackPoller = null;
    self.logDebug('ES9018K2M: Fallback poller stopped');
  }
};

// ---------------------------------------------------------------------------
// Volume Sync - Software mode (callback-based)
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.startVolumeSync = function() {
  var self = this;

  // Get initial state
  var state = self.commandRouter.volumioGetState();
  if (state) {
    self.logDebug('ES9018K2M: Initial state - status=' + state.status +
      ' volume=' + state.volume);
    self.handleStateChange(state);
  }

  // Register callback for volume changes (most direct path)
  self.volumeCallback = function(volume) {
    self.logDebug('ES9018K2M: Volume callback: ' + JSON.stringify(volume));

    if (typeof volume === 'object' && typeof volume.vol === 'number') {
      if (volume.vol !== self.lastVolume) {
        // Use graceful volume change if enabled
        if (self.gracefulVolume && self.lastVolume !== null &&
            Math.abs(volume.vol - self.lastVolume) > 5) {
          self.gracefulVolumeChangeSync(self.lastVolume, volume.vol);
        } else {
          self.setVolumeImmediate(volume.vol);
        }
        self.lastVolume = volume.vol;
        self.currentVolume = volume.vol;
      }
      if (typeof volume.mute === 'boolean') {
        // Only apply mute if playing - don't override seek mute
        var state = self.commandRouter.volumioGetState();
        if (state && state.status === 'play') {
          if (self.gracefulTransitions) {
            self.gracefulMuteSync(volume.mute);
          } else {
            self.setMuteSync(volume.mute);
          }
          self.currentMute = volume.mute;
        }
      }
    }
  };

  self.commandRouter.addCallback('volumioupdatevolume', self.volumeCallback);
  self.logger.info('ES9018K2M: Volume sync started (software mode)');
};

ControllerES9018K2M.prototype.stopVolumeSync = function() {
  var self = this;

  // Note: Volumio doesn't have removeCallback, but setting to null prevents action
  self.volumeCallback = null;
  self.logger.info('ES9018K2M: Volume sync stopped');
};

// ---------------------------------------------------------------------------
// State Change Handler
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.handleStateChange = function(state) {
  var self = this;

  if (!self.deviceFound || !state) {
    return;
  }

  var status = state.status;
  var volume = state.volume;
  var mute = state.mute;

  // Status change handling
  if (status !== self.lastStatus) {
    self.logDebug('ES9018K2M: Status change: ' + self.lastStatus + ' -> ' + status);

    if (status === 'stop' || status === 'pause') {
      if (self.lastStatus === 'play') {
        // Use graceful mute for transitions if enabled
        if (self.gracefulTransitions) {
          self.gracefulMuteSync(true);
        } else {
          self.setMuteSync(true);
        }
        self.currentMute = true;
      }
    } else if (status === 'play') {
      if (self.lastStatus !== 'play' && !mute) {
        // Use graceful unmute for transitions if enabled
        if (self.gracefulTransitions) {
          self.gracefulMuteSync(false);
        } else {
          self.setMuteSync(false);
        }
        self.currentMute = false;
      }
    }
    self.lastStatus = status;
  }

  // Volume sync from state (backup path for software mode)
  if (self.volumeMode === 'software') {
    if (typeof volume === 'number' && volume !== self.lastVolume) {
      if (self.gracefulVolume && self.lastVolume !== null &&
          Math.abs(volume - self.lastVolume) > 5) {
        self.gracefulVolumeChangeSync(self.lastVolume, volume);
      } else {
        self.setVolumeImmediate(volume);
      }
      self.lastVolume = volume;
      self.currentVolume = volume;
    }
  }
};

// ---------------------------------------------------------------------------
// DAC Control Functions
// ---------------------------------------------------------------------------

// Convert Volumio volume (0-100) to register value (0x00-0x63)
ControllerES9018K2M.prototype.volumeToRegister = function(vol) {
  var DAC_MIN_GAIN = 0x63;  // -49.5dB
  var DAC_MUTE_GAIN = 0xFF;

  if (vol <= 0) {
    return DAC_MUTE_GAIN;
  }
  return Math.round(DAC_MIN_GAIN - (vol * DAC_MIN_GAIN / 100));
};

// Set volume immediately without ramping
ControllerES9018K2M.prototype.setVolumeImmediate = function(vol) {
  var self = this;

  var attenuation = self.volumeToRegister(vol);

  var leftAtten = Math.min(255, attenuation + self.lBal);
  self.i2cWriteSync(0x0F, leftAtten);

  var rightAtten = Math.min(255, attenuation + self.rBal);
  self.i2cWriteSync(0x10, rightAtten);
};

// Async version for non-critical paths
ControllerES9018K2M.prototype.setVolume = function(vol) {
  var self = this;

  var attenuation = self.volumeToRegister(vol);

  var leftAtten = Math.min(255, attenuation + self.lBal);
  self.i2cWrite(0x0F, leftAtten);

  var rightAtten = Math.min(255, attenuation + self.rBal);
  self.i2cWrite(0x10, rightAtten);
};

ControllerES9018K2M.prototype.setMute = function(mute) {
  var self = this;

  if (mute) {
    self.reg7 = self.reg7 | 0x01;
  } else {
    self.reg7 = self.reg7 & 0xFE;
  }

  self.i2cWrite(0x07, self.reg7);
};

ControllerES9018K2M.prototype.setMuteSync = function(mute) {
  var self = this;

  if (mute) {
    self.reg7 = self.reg7 | 0x01;
  } else {
    self.reg7 = self.reg7 & 0xFE;
  }

  self.i2cWriteSync(0x07, self.reg7);
};

// ---------------------------------------------------------------------------
// Graceful Volume/Mute - Volume ramping for smooth transitions
// ---------------------------------------------------------------------------

// Graceful volume change between two levels
ControllerES9018K2M.prototype.gracefulVolumeChangeSync = function(fromVol, toVol) {
  var self = this;

  var steps = self.gracefulSteps;

  // If steps is 0 or 1, just set directly
  if (steps <= 1) {
    self.setVolumeImmediate(toVol);
    return;
  }

  // Calculate intermediate volume levels
  var volDiff = toVol - fromVol;

  for (var i = 1; i <= steps; i++) {
    var ratio = i / steps;
    var stepVol;

    if (i === steps) {
      stepVol = toVol;  // Final step is exact target
    } else {
      stepVol = Math.round(fromVol + (volDiff * ratio));
    }

    var regVal = self.volumeToRegister(stepVol);
    var leftVal = Math.min(0xFF, regVal + self.lBal);
    var rightVal = Math.min(0xFF, regVal + self.rBal);

    self.i2cWriteSync(0x0F, leftVal);
    self.i2cWriteSync(0x10, rightVal);
  }
};

// Graceful mute/unmute using volume ramping
ControllerES9018K2M.prototype.gracefulMuteSync = function(mute) {
  var self = this;

  var steps = self.gracefulSteps;

  // If steps is 0 or 1, fall back to instant mute
  if (steps <= 1) {
    self.setMuteSync(mute);
    return;
  }

  // Get current volume register value based on last known volume
  var currentVol = self.currentVolume !== null ? self.currentVolume : 50;
  var targetReg = self.volumeToRegister(currentVol);
  var muteReg = 0xFF;

  // Calculate ramp values using linear interpolation
  var rampValues = [];

  if (mute) {
    // Ramp from current volume to mute
    for (var i = 1; i <= steps; i++) {
      var ratio = i / steps;
      if (i === steps) {
        // Final step is always full mute
        rampValues.push(muteReg);
      } else {
        // Linear interpolation from current to mute
        var stepReg = Math.round(targetReg + (muteReg - targetReg) * ratio);
        rampValues.push(Math.min(0xFF, stepReg));
      }
    }
  } else {
    // Ramp from mute to current volume
    for (var j = steps - 1; j >= 0; j--) {
      var ratio = j / steps;
      if (j === steps - 1) {
        // First step from mute - start at high attenuation
        var startReg = Math.round(targetReg + (muteReg - targetReg) * ratio);
        rampValues.push(Math.min(0xFF, startReg));
      } else if (j === 0) {
        // Final step is target volume
        rampValues.push(targetReg);
      } else {
        var stepReg = Math.round(targetReg + (muteReg - targetReg) * ratio);
        rampValues.push(Math.min(0xFF, stepReg));
      }
    }
  }

  // Execute ramp with balance applied
  for (var k = 0; k < rampValues.length; k++) {
    var regVal = rampValues[k];
    var leftVal = Math.min(0xFF, regVal + self.lBal);
    var rightVal = Math.min(0xFF, regVal + self.rBal);

    self.i2cWriteSync(0x0F, leftVal);
    self.i2cWriteSync(0x10, rightVal);
  }

  // For mute, also set hardware mute bit for complete silence
  // For unmute, clear hardware mute bit
  if (mute) {
    self.reg7 = self.reg7 | 0x01;
  } else {
    self.reg7 = self.reg7 & 0xFE;
  }
  self.i2cWriteSync(0x07, self.reg7);
};

// ---------------------------------------------------------------------------
// Balance Control
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.setBalance = function(balance) {
  var self = this;

  self.lBal = 0;
  self.rBal = 0;

  if (balance > 0) {
    self.lBal = Math.min(balance, 40);
  } else if (balance < 0) {
    self.rBal = Math.min(-balance, 40);
  }

  self.config.set('balance', balance);

  if (self.currentVolume !== null) {
    self.setVolumeImmediate(self.currentVolume);
  }
};

ControllerES9018K2M.prototype.setFirFilter = function(mode) {
  var self = this;

  self.reg7 = self.reg7 & 0x9F;
  self.reg21 = self.reg21 & 0xFE;

  switch (mode) {
    case 0:
      self.reg7 = self.reg7 | 0x20;
      break;
    case 1:
      break;
    case 2:
      self.reg7 = self.reg7 | 0x40;
      break;
    case 3:
      self.reg21 = self.reg21 | 0x01;
      break;
  }

  self.i2cWrite(0x07, self.reg7);
  self.i2cWrite(0x15, self.reg21);
  self.config.set('fir', mode);
};

ControllerES9018K2M.prototype.setIirFilter = function(mode) {
  var self = this;

  self.reg7 = self.reg7 & 0xF3;
  self.reg21 = self.reg21 & 0xFB;

  switch (mode) {
    case 0:
      break;
    case 1:
      self.reg7 = self.reg7 | 0x04;
      break;
    case 2:
      self.reg7 = self.reg7 | 0x08;
      break;
    case 3:
      self.reg7 = self.reg7 | 0x0C;
      break;
    case 4:
      self.reg21 = self.reg21 | 0x04;
      break;
  }

  self.i2cWrite(0x07, self.reg7);
  self.i2cWrite(0x15, self.reg21);
  self.config.set('iir', mode);
};

ControllerES9018K2M.prototype.setDeemphasis = function(mode) {
  var self = this;

  self.i2cWrite(0x06, mode);
  self.config.set('deemphasis', mode);
};

ControllerES9018K2M.prototype.setDpll = function(i2sValue, dsdValue) {
  var self = this;

  self.reg12 = (i2sValue & 0xF0) | (dsdValue & 0x0F);
  self.i2cWrite(0x0C, self.reg12);

  self.config.set('i2sDpll', i2sValue);
  self.config.set('dsdDpll', dsdValue);
};

// ---------------------------------------------------------------------------
// UI Action Handlers
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.checkDeviceStatus = function() {
  var self = this;

  self.checkDevice()
    .then(function(found) {
      self.deviceFound = found;
      if (found) {
        self.commandRouter.pushToastMessage('success',
          self.getI18nString('PLUGIN_NAME'),
          self.getI18nString('DEVICE_FOUND'));
      } else {
        self.commandRouter.pushToastMessage('warning',
          self.getI18nString('PLUGIN_NAME'),
          self.getI18nString('DEVICE_NOT_FOUND'));
      }
    });
};

ControllerES9018K2M.prototype.saveDeviceDetection = function(data) {
  var self = this;

  self.i2cBus = parseInt(data.i2cBus, 10) || 1;

  var addr = data.i2cAddress;
  if (typeof addr === 'string') {
    addr = addr.toLowerCase().startsWith('0x')
      ? parseInt(addr, 16)
      : parseInt(addr, 10);
  }
  self.i2cAddress = addr || 0x48;

  self.debugLogging = data.debugLogging || false;

  self.config.set('i2cBus', self.i2cBus);
  self.config.set('i2cAddress', self.i2cAddress);
  self.config.set('debugLogging', self.debugLogging);

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('SETTINGS_SAVED'));

  self.checkDeviceStatus();
};

ControllerES9018K2M.prototype.saveVolumeControl = function(data) {
  var self = this;

  // External volume toggle
  var newExternalVolume = data.externalVolume || false;
  var externalVolumeChanged = (newExternalVolume !== self.externalVolume);

  // Volume mode - check if changed (only hardware or software now)
  var newVolumeMode = (data.volumeMode && data.volumeMode.value) || 'hardware';
  var volumeModeChanged = (newVolumeMode !== self.volumeMode);

  // Save external volume setting
  self.externalVolume = newExternalVolume;
  self.config.set('externalVolume', self.externalVolume);

  // Card number - parse 'auto' or numeric value
  var cardInput = data.cardNumber || 'auto';
  if (typeof cardInput === 'string') {
    cardInput = cardInput.toLowerCase().trim();
    if (cardInput.startsWith('auto')) {
      self.cardNumber = -1;
    } else {
      var parsed = parseInt(cardInput, 10);
      self.cardNumber = isNaN(parsed) ? -1 : parsed;
    }
  } else {
    self.cardNumber = parseInt(cardInput, 10) || -1;
  }
  self.config.set('cardNumber', self.cardNumber);

  // Start muted
  self.startMuted = data.startMuted || false;
  self.config.set('startMuted', self.startMuted);

  // Safe startup settings
  self.safeStartupEnabled = data.safeStartupEnabled || false;
  self.config.set('safeStartupEnabled', self.safeStartupEnabled);

  var safeVol = parseInt(data.safeStartupVolume, 10);
  self.safeStartupVolume = isNaN(safeVol) ? 25 : Math.max(0, Math.min(100, safeVol));
  self.config.set('safeStartupVolume', self.safeStartupVolume);

  // Remember last volume
  self.rememberLastVolume = data.rememberLastVolume || false;
  self.config.set('rememberLastVolume', self.rememberLastVolume);

  // Save volume mode
  self.volumeMode = newVolumeMode;
  self.config.set('volumeMode', self.volumeMode);

  // Handle changes
  if (self.deviceFound && (externalVolumeChanged || volumeModeChanged)) {
    // Clean up current volume control first
    if (self.volumeOverrideRegistered) {
      self.unregisterVolumeOverride();
    }
    self.stopVolumeSync();

    if (self.externalVolume) {
      // External volume enabled - plugin manages DAC features only
      self.commandRouter.pushToastMessage('info',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('EXTERNAL_VOLUME_CHANGED_ON'));
    } else if (self.volumeMode === 'hardware') {
      self.registerVolumeOverride();
      self.commandRouter.pushToastMessage('info',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('VOLUME_MODE_CHANGED_HW'));
    } else {
      self.startVolumeSync();
      self.commandRouter.pushToastMessage('info',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('VOLUME_MODE_CHANGED_SW'));
    }

    // Push updated UI config to refresh visibility states
    self.refreshUIConfig();
  } else {
    self.commandRouter.pushToastMessage('success',
      self.getI18nString('PLUGIN_NAME'),
      self.getI18nString('SETTINGS_SAVED'));
  }
};

// Push updated UI config to refresh field visibility
ControllerES9018K2M.prototype.refreshUIConfig = function() {
  var self = this;

  setTimeout(function() {
    self.getUIConfig()
      .then(function(uiconf) {
        self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
      })
      .fail(function(err) {
        self.logger.error('ES9018K2M: Failed to refresh UI config: ' + err);
      });
  }, 100);
};

ControllerES9018K2M.prototype.saveMuteSettings = function(data) {
  var self = this;

  // Seek mute duration
  var seekMuteMs = parseInt(data.seekMuteMs, 10) || 150;
  self.seekMuteMs = Math.max(0, Math.min(2000, seekMuteMs));
  self.config.set('seekMuteMs', self.seekMuteMs);

  // Graceful mute steps
  var gracefulSteps = parseInt(data.gracefulSteps, 10) || 3;
  self.gracefulSteps = Math.max(1, Math.min(5, gracefulSteps));
  self.config.set('gracefulSteps', self.gracefulSteps);

  // Graceful transitions toggle
  self.gracefulTransitions = data.gracefulTransitions !== false;
  self.config.set('gracefulTransitions', self.gracefulTransitions);

  // Graceful volume toggle
  self.gracefulVolume = data.gracefulVolume !== false;
  self.config.set('gracefulVolume', self.gracefulVolume);

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('SETTINGS_SAVED'));
};

ControllerES9018K2M.prototype.saveBalanceSettings = function(data) {
  var self = this;

  var balance = parseInt(data.balance, 10) || 0;
  self.setBalance(balance);

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('SETTINGS_SAVED'));
};

ControllerES9018K2M.prototype.resetBalance = function() {
  var self = this;

  self.setBalance(0);

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('BALANCE_RESET'));
};

ControllerES9018K2M.prototype.saveFilterSettings = function(data) {
  var self = this;

  if (data.fir && data.fir.value !== undefined) {
    self.setFirFilter(data.fir.value);
  }
  if (data.iir && data.iir.value !== undefined) {
    self.setIirFilter(data.iir.value);
  }
  if (data.deemphasis && data.deemphasis.value !== undefined) {
    self.setDeemphasis(data.deemphasis.value);
  }

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('SETTINGS_SAVED'));
};

ControllerES9018K2M.prototype.saveDpllSettings = function(data) {
  var self = this;

  var i2sValue = (data.i2sDpll && data.i2sDpll.value) || 0x50;
  var dsdValue = (data.dsdDpll && data.dsdDpll.value) || 0x0A;

  self.setDpll(i2sValue, dsdValue);

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('SETTINGS_SAVED'));
};

ControllerES9018K2M.prototype.resetDevice = function() {
  var self = this;

  if (!self.deviceFound) {
    self.commandRouter.pushToastMessage('warning',
      self.getI18nString('PLUGIN_NAME'),
      self.getI18nString('DEVICE_NOT_FOUND'));
    return;
  }

  // Reset all settings to defaults
  self.config.set('volumeMode', 'software');
  self.config.set('cardNumber', -1);
  self.config.set('startMuted', false);
  self.config.set('safeStartupEnabled', false);
  self.config.set('safeStartupVolume', 25);
  self.config.set('rememberLastVolume', false);
  self.config.set('lastSavedVolume', -1);
  self.config.set('balance', 0);
  self.config.set('fir', 1);
  self.config.set('iir', 0);
  self.config.set('deemphasis', 0x4A);
  self.config.set('i2sDpll', 0x50);
  self.config.set('dsdDpll', 0x0A);
  self.config.set('seekMuteMs', 150);
  self.config.set('gracefulSteps', 3);
  self.config.set('gracefulTransitions', true);
  self.config.set('gracefulVolume', true);
  self.config.set('debugLogging', false);

  // Unregister volume override if active
  if (self.volumeOverrideRegistered) {
    self.unregisterVolumeOverride();
  }

  self.loadConfig();
  self.initDevice();
  self.applySettings();

  // Start software mode volume sync
  self.startVolumeSync();

  self.commandRouter.pushToastMessage('success',
    self.getI18nString('PLUGIN_NAME'),
    self.getI18nString('DEVICE_RESET'));
};

// ---------------------------------------------------------------------------
// Option Helpers for UI
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.getFirOption = function(value) {
  var options = [
    { value: 0, label: 'Slow Roll-Off' },
    { value: 1, label: 'Fast Roll-Off' },
    { value: 2, label: 'Minimum Phase' },
    { value: 3, label: 'Bypass' }
  ];
  return options.find(function(o) { return o.value === value; }) || options[1];
};

ControllerES9018K2M.prototype.getIirOption = function(value) {
  var options = [
    { value: 0, label: '47K (PCM)' },
    { value: 1, label: '50K (DSD)' },
    { value: 2, label: '60K (DSD)' },
    { value: 3, label: '70K (DSD)' },
    { value: 4, label: 'Bypass' }
  ];
  return options.find(function(o) { return o.value === value; }) || options[0];
};

ControllerES9018K2M.prototype.getDeemphasisOption = function(value) {
  var options = [
    { value: 0x4A, label: 'Off' },
    { value: 0x0A, label: '32 kHz' },
    { value: 0x1A, label: '44.1 kHz' },
    { value: 0x2A, label: '48 kHz' }
  ];
  return options.find(function(o) { return o.value === value; }) || options[0];
};

ControllerES9018K2M.prototype.getDpllOption = function(value) {
  var level = (value >= 0x10) ? (value >> 4) : value;
  var labels = ['Off', '1', '2', '3', '4', '5', '6', '7',
                '8', '9', '10', '11', '12', '13', '14', '15'];
  return { value: value, label: labels[level] || 'Unknown' };
};

// ---------------------------------------------------------------------------
// I18n
// ---------------------------------------------------------------------------

ControllerES9018K2M.prototype.loadI18nStrings = function() {
  var self = this;
  var langCode = self.commandRouter.sharedVars.get('language_code');

  try {
    self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + langCode + '.json');
  } catch (e) {
    self.i18nStrings = {};
  }

  try {
    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
  } catch (e) {
    self.i18nStringsDefaults = {};
  }
};

ControllerES9018K2M.prototype.getI18nString = function(key) {
  var self = this;

  if (self.i18nStrings && self.i18nStrings[key] !== undefined) {
    return self.i18nStrings[key];
  }
  if (self.i18nStringsDefaults && self.i18nStringsDefaults[key] !== undefined) {
    return self.i18nStringsDefaults[key];
  }
  return key;
};
