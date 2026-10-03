'use strict';

const libQ = require('kew');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const http = require('http');

const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB
const VOLUMIO_HOST = 'localhost';
const VOLUMIO_PORT = 3000;

module.exports = SleepWakePlugin;

function SleepWakePlugin(context) {
  const self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self.logFile = path.join(__dirname, 'sleep-wake-plugin.log');

  // State flags + a monotonic token used to cancel any in-flight fade/ramp loop.
  // Bumping runToken invalidates the setTimeout chain of an older fade/ramp.
  self.isSleeping = false;
  self.isWaking = false;
  self.runToken = 0;

  // Timer handles
  self.sleepTimer = undefined; // schedules the next fade-out
  self.wakeTimer = undefined;  // schedules the next ramp-up
  self.fadeTimer = undefined;  // step timer while fading out
  self.rampTimer = undefined;  // step timer while ramping up
}

// ---------------------------------------------------------------------------
// Volumio lifecycle
// ---------------------------------------------------------------------------

SleepWakePlugin.prototype.onVolumioStart = function () {
  const self = this;

  self.logger.info('SleepWakePlugin - onVolumioStart');

  const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);

  self.writeLog('Plugin starting. Config file: ' + configFile);
  return libQ.resolve();
};

SleepWakePlugin.prototype.onStart = function () {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('SleepWakePlugin - onStart');
  self.manageLogSize();
  self.writeLog('Plugin started.');

  self.loadConfig();
  self.reschedule();

  defer.resolve();
  return defer.promise;
};

SleepWakePlugin.prototype.onStop = function () {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('SleepWakePlugin - onStop');
  self.writeLog('Plugin stopped.');

  self.stopAllActivity();

  defer.resolve();
  return defer.promise;
};

// ---------------------------------------------------------------------------
// UI configuration
// ---------------------------------------------------------------------------

SleepWakePlugin.prototype.getUIConfig = function () {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('SleepWakePlugin - getUIConfig');

  self.loadConfig();
  const uiconfPath = path.join(__dirname, 'UIConfig.json');

  fs.readJson(uiconfPath, function (err, uiconf) {
    if (err) {
      self.logger.error('SleepWakePlugin - Error reading UIConfig.json: ' + err);
      self.writeLog('Error reading UIConfig.json: ' + err);
      defer.reject(new Error('Unable to read UIConfig.json'));
      return;
    }

    try {
      // Night mode
      uiconf.sections[0].content[0].value = self.sleepTime_Mon_Fri;
      uiconf.sections[0].content[1].value = self.sleepTime_Sat;
      uiconf.sections[0].content[2].value = self.sleepTime_Sun;
      uiconf.sections[0].content[3].value = self.volumeDecrease;
      uiconf.sections[0].content[4].value = self.minutesFade;

      // Morning mode
      uiconf.sections[1].content[0].value = self.wakeTime_Mon_Fri;
      uiconf.sections[1].content[1].value = self.wakeTime_Sat;
      uiconf.sections[1].content[2].value = self.wakeTime_Sun;
      uiconf.sections[1].content[3].value = self.startVolume;
      uiconf.sections[1].content[5].value = self.volumeIncrease;
      uiconf.sections[1].content[6].value = self.minutesRamp;

      // Playlist dropdown is populated from the Volumio API.
      const currentPlaylist = self.config.get('playlist');

      // libQ (kew) promises use .then(onSuccess, onError).
      self.fetchPlaylists().then(
        function (playlists) {
          uiconf.sections[1].content[4].options = playlists;

          const selected = currentPlaylist && playlists.find(function (pl) { return pl.value === currentPlaylist; });
          if (selected) {
            uiconf.sections[1].content[4].value = selected;
            self.writeLog('Playlist found and set: ' + selected.value);
          } else {
            uiconf.sections[1].content[4].value = { value: '', label: 'Select a playlist' };
            self.writeLog('Saved playlist not found in options, showing placeholder.');
          }

          defer.resolve(uiconf);
        },
        function (fetchError) {
          self.logger.error('Error fetching playlists: ' + fetchError);
          self.writeLog('Error fetching playlists: ' + fetchError);
          defer.resolve(uiconf); // still show the form, just without playlist options
        }
      );
    } catch (parseError) {
      self.logger.error('SleepWakePlugin - Error building UIConfig: ' + parseError);
      self.writeLog('Error building UIConfig: ' + parseError);
      defer.reject(new Error('Unable to build UIConfig'));
    }
  });

  return defer.promise;
};

SleepWakePlugin.prototype.saveOptions = function (data) {
  const self = this;

  self.logger.info('SleepWakePlugin - saveOptions');
  self.writeLog('Saving options: ' + JSON.stringify(data));

  // Plain string/number settings -> store as given.
  const stringKeys = [
    'Mon_Fri_sleepTime', 'Sat_sleepTime', 'Sun_sleepTime',
    'Mon_Fri_wakeTime', 'Sat_wakeTime', 'Sun_wakeTime',
    'volumeDecrease', 'minutesFade', 'volumeIncrease', 'minutesRamp',
  ];
  stringKeys.forEach(function (key) {
    if (data[key] !== undefined) {
      self.config.set(key, data[key]);
    }
  });

  // startVolume needs to be a valid integer.
  if (data.startVolume !== undefined) {
    const volumeValue = parseInt(data.startVolume, 10);
    if (isNaN(volumeValue)) {
      self.logger.error('SleepWakePlugin - Invalid startVolume value: ' + JSON.stringify(data.startVolume));
      self.writeLog('Invalid startVolume value: ' + JSON.stringify(data.startVolume));
    } else {
      self.config.set('startVolume', volumeValue);
    }
  }

  // Playlist comes from a select element ({ value, label }) -> persist the value string.
  if (data.playlist !== undefined) {
    const playlistName = (typeof data.playlist === 'object' && data.playlist.value)
      ? data.playlist.value
      : data.playlist;
    self.config.set('playlist', playlistName);
  }

  self.config.save();
  self.writeLog('Configuration saved.');

  // Stop anything in progress, reload, and reschedule with the new settings.
  self.stopAllActivity();
  self.loadConfig();
  self.reschedule();

  self.commandRouter.pushToastMessage('success', 'Settings Saved', 'Your settings have been saved.');
  return libQ.resolve();
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

SleepWakePlugin.prototype.loadConfig = function () {
  const self = this;

  self.sleepTime_Mon_Fri = self.config.get('Mon_Fri_sleepTime') || '22:00';
  self.sleepTime_Sat = self.config.get('Sat_sleepTime') || '22:00';
  self.sleepTime_Sun = self.config.get('Sun_sleepTime') || '22:00';
  self.wakeTime_Mon_Fri = self.config.get('Mon_Fri_wakeTime') || '07:00';
  self.wakeTime_Sat = self.config.get('Sat_wakeTime') || '07:00';
  self.wakeTime_Sun = self.config.get('Sun_wakeTime') || '07:00';

  self.startVolume = parseInt(self.config.get('startVolume'), 10) || 20;

  const savedPlaylist = self.config.get('playlist');
  self.playlist = (typeof savedPlaylist === 'string') ? savedPlaylist : '';

  self.volumeDecrease = parseInt(self.config.get('volumeDecrease'), 10) || 10;
  self.minutesFade = parseInt(self.config.get('minutesFade'), 10) || 10;
  self.volumeIncrease = parseInt(self.config.get('volumeIncrease'), 10) || 10;
  self.minutesRamp = parseInt(self.config.get('minutesRamp'), 10) || 10;

  self.writeLog('Config loaded. Sleep(MF/Sat/Sun)=' +
    [self.sleepTime_Mon_Fri, self.sleepTime_Sat, self.sleepTime_Sun].join('/') +
    ' Wake(MF/Sat/Sun)=' +
    [self.wakeTime_Mon_Fri, self.wakeTime_Sat, self.wakeTime_Sun].join('/') +
    ' startVolume=' + self.startVolume + ' playlist=' + self.playlist +
    ' decrease=' + self.volumeDecrease + ' fadeMin=' + self.minutesFade +
    ' increase=' + self.volumeIncrease + ' rampMin=' + self.minutesRamp);
};

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

SleepWakePlugin.prototype.reschedule = function () {
  const self = this;
  self.scheduleSleep();
  self.scheduleWake();
};

// Parse a "HH:MM" string. Returns { h, m } or null if invalid.
SleepWakePlugin.prototype.parseHHMM = function (timeStr) {
  if (typeof timeStr !== 'string' || timeStr.indexOf(':') === -1) {
    return null;
  }
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return { h: h, m: m };
};

// Find the next future occurrence given a function that maps a day-of-week
// (0=Sun..6=Sat) to its configured "HH:MM" string. Walking day by day with the
// Date constructor handles month/year rollover correctly.
SleepWakePlugin.prototype.getNextOccurrence = function (timeForDay) {
  const self = this;
  const now = new Date();

  for (let i = 0; i <= 7; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const hhmm = self.parseHHMM(timeForDay(day.getDay()));
    if (!hhmm) {
      return null;
    }
    const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hhmm.h, hhmm.m, 0, 0);
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return null;
};

SleepWakePlugin.prototype.scheduleSleep = function () {
  const self = this;

  if (self.sleepTimer) {
    clearTimeout(self.sleepTimer);
    self.sleepTimer = undefined;
  }

  const sleepTime = self.getNextOccurrence(function (day) {
    if (day === 0) return self.sleepTime_Sun;
    if (day === 6) return self.sleepTime_Sat;
    return self.sleepTime_Mon_Fri;
  });

  if (!sleepTime) {
    self.logger.error('SleepWakePlugin - Invalid sleep time. Sleep will not be scheduled.');
    self.writeLog('Invalid sleep time. Sleep will not be scheduled.');
    return;
  }

  const delay = sleepTime.getTime() - Date.now();
  self.logger.info('SleepWakePlugin - Sleep scheduled in ' + delay + ' ms');
  self.writeLog('Sleep scheduled for ' + sleepTime + ' (in ' + delay + ' ms)');

  self.sleepTimer = setTimeout(function () {
    self.writeLog('Sleep timer triggered.');
    self.fadeOut();
  }, delay);
};

SleepWakePlugin.prototype.scheduleWake = function () {
  const self = this;

  if (self.wakeTimer) {
    clearTimeout(self.wakeTimer);
    self.wakeTimer = undefined;
  }

  const wakeTime = self.getNextOccurrence(function (day) {
    if (day === 0) return self.wakeTime_Sun;
    if (day === 6) return self.wakeTime_Sat;
    return self.wakeTime_Mon_Fri;
  });

  if (!wakeTime) {
    self.logger.error('SleepWakePlugin - Invalid wake time. Wake will not be scheduled.');
    self.writeLog('Invalid wake time. Wake will not be scheduled.');
    return;
  }

  const delay = wakeTime.getTime() - Date.now();
  self.logger.info('SleepWakePlugin - Wake scheduled in ' + delay + ' ms');
  self.writeLog('Wake scheduled for ' + wakeTime + ' (in ' + delay + ' ms)');

  self.wakeTimer = setTimeout(function () {
    self.writeLog('Wake timer triggered.');
    self.rampUp();
  }, delay);
};

// Cancel timers and in-flight fade/ramp loops, and clear state.
SleepWakePlugin.prototype.stopAllActivity = function () {
  const self = this;

  self.runToken++; // invalidate any running fade/ramp tick chain
  self.isSleeping = false;
  self.isWaking = false;

  ['sleepTimer', 'wakeTimer', 'fadeTimer', 'rampTimer'].forEach(function (name) {
    if (self[name]) {
      clearTimeout(self[name]);
      self[name] = undefined;
    }
  });
};

// ---------------------------------------------------------------------------
// Sleep (fade out) and Wake (ramp up)
// ---------------------------------------------------------------------------

// Fade the volume down by `volumeDecrease` steps over `minutesFade`, then stop
// playback. The fade intentionally does NOT go all the way to zero.
SleepWakePlugin.prototype.fadeOut = function () {
  const self = this;

  if (self.isWaking) {
    self.logger.warn('SleepWakePlugin - Cannot start sleep during wake-up process.');
    self.writeLog('Cannot start sleep during wake-up process.');
    return;
  }

  const token = ++self.runToken;
  self.isSleeping = true;
  self.logger.info('SleepWakePlugin - Starting fade out');
  self.writeLog('Starting fade out.');

  const steps = Math.max(1, Math.ceil(self.volumeDecrease));
  const interval = (self.minutesFade * 60 * 1000) / steps;

  self.getCurrentVolume(function (err, startVolume) {
    if (err) {
      self.logger.error('Error getting current volume: ' + err);
      self.writeLog('Error getting current volume: ' + err);
      self.isSleeping = false;
      return;
    }

    self.writeLog('Fade out from volume ' + startVolume + ' over ' + steps + ' steps.');
    let step = 1;

    function decreaseVolume() {
      // Abort if this fade was superseded or interrupted.
      if (token !== self.runToken || !self.isSleeping) {
        self.writeLog('Fade out interrupted.');
        return;
      }

      if (step > steps) {
        self.writeLog('Fade out complete. Stopping playback.');
        self.sendStop(function (stopErr) {
          if (stopErr) { self.writeLog('Error stopping playback: ' + stopErr); }
          if (token !== self.runToken) { return; }
          self.isSleeping = false;
          self.reschedule();
        });
        return;
      }

      const target = Math.max(startVolume - step, 0);
      self.setVolume(target, function (setErr) {
        if (setErr) { self.writeLog('Error setting volume: ' + setErr); }
        step++;
        self.fadeTimer = setTimeout(decreaseVolume, interval);
      });
    }

    decreaseVolume();
  });
};

// Set the start volume, start the playlist, then ramp the volume up by
// `volumeIncrease` steps over `minutesRamp`.
SleepWakePlugin.prototype.rampUp = function () {
  const self = this;

  // Never run two ramps at once (this is what drove the volume up indefinitely).
  if (self.isWaking) {
    self.logger.warn('SleepWakePlugin - Wake already in progress, ignoring duplicate trigger.');
    self.writeLog('Wake already in progress, ignoring duplicate trigger.');
    return;
  }

  // Wake takes priority over an in-progress fade.
  if (self.isSleeping) {
    self.writeLog('Interrupting sleep to start wake-up.');
    self.isSleeping = false;
    if (self.fadeTimer) {
      clearTimeout(self.fadeTimer);
      self.fadeTimer = undefined;
    }
  }

  const token = ++self.runToken;
  self.isWaking = true;
  self.logger.info('SleepWakePlugin - Starting wake-up');
  self.writeLog('Starting wake-up.');

  const steps = Math.max(1, Math.ceil(self.volumeIncrease));
  const interval = (self.minutesRamp * 60 * 1000) / steps;

  function abortWake(err) {
    self.logger.error('Error during wake-up: ' + err);
    self.writeLog('Error during wake-up: ' + err);
    self.isWaking = false;
    self.reschedule();
  }

  self.setVolume(self.startVolume, function (volErr) {
    if (volErr) { return abortWake(volErr); }
    if (token !== self.runToken || !self.isWaking) { return; }

    self.writeLog('Initial volume set to ' + self.startVolume + '. Starting playlist: ' + self.playlist);
    self.playPlaylist(self.playlist, function (plErr) {
      if (plErr) { return abortWake(plErr); }
      if (token !== self.runToken || !self.isWaking) { return; }

      let step = 1;

      function increaseVolume() {
        if (token !== self.runToken || !self.isWaking) {
          self.writeLog('Volume ramp-up interrupted.');
          return;
        }

        if (step > steps) {
          self.writeLog('Volume ramp-up complete.');
          self.isWaking = false;
          self.reschedule();
          return;
        }

        const target = Math.min(self.startVolume + step, 100);
        self.setVolume(target, function (setErr) {
          if (setErr) { self.writeLog('Error setting volume: ' + setErr); }
          step++;
          self.rampTimer = setTimeout(increaseVolume, interval);
        });
      }

      increaseVolume();
    });
  });
};

// ---------------------------------------------------------------------------
// Volumio REST helpers (callback-based)
//
// The HTTP layer and the fade/ramp step loops use plain err-first callbacks so
// the recursive setTimeout step chains stay easy to follow and cancel. libQ
// (kew) is used only for the methods Volumio awaits (onStart, onStop,
// getUIConfig, saveOptions, onVolumioStart) and for fetchPlaylists.
// ---------------------------------------------------------------------------

SleepWakePlugin.prototype.apiGet = function (apiPath, callback) {
  const self = this;
  const req = http.request({
    hostname: VOLUMIO_HOST,
    port: VOLUMIO_PORT,
    path: apiPath,
    method: 'GET',
  }, function (res) {
    res.setEncoding('utf8');
    let data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () { callback(null, data); });
  });

  req.on('error', function (e) {
    self.writeLog('REST request failed (' + apiPath + '): ' + e.message);
    callback(e);
  });

  req.end();
};

SleepWakePlugin.prototype.getCurrentVolume = function (callback) {
  const self = this;
  self.apiGet('/api/v1/getState', function (err, responseData) {
    if (err) { return callback(err); }
    try {
      const data = JSON.parse(responseData);
      const currentVolume = parseInt(data.volume, 10);
      if (isNaN(currentVolume)) {
        return callback(new Error('State did not contain a numeric volume'));
      }
      self.writeLog('Current volume is ' + currentVolume);
      callback(null, currentVolume);
    } catch (e) {
      callback(e);
    }
  });
};

SleepWakePlugin.prototype.setVolume = function (volume, callback) {
  const self = this;
  self.apiGet('/api/v1/commands/?cmd=volume&volume=' + volume, function (err) {
    if (!err) { self.writeLog('Volume set to ' + volume); }
    if (callback) { callback(err); }
  });
};

SleepWakePlugin.prototype.sendStop = function (callback) {
  const self = this;
  self.apiGet('/api/v1/commands/?cmd=stop', function (err) {
    if (!err) { self.writeLog('Playback stopped.'); }
    if (callback) { callback(err); }
  });
};

SleepWakePlugin.prototype.playPlaylist = function (name, callback) {
  const self = this;
  self.apiGet('/api/v1/commands/?cmd=playplaylist&name=' + encodeURIComponent(name), function (err) {
    if (!err) { self.writeLog('Playlist "' + name + '" started.'); }
    if (callback) { callback(err); }
  });
};

// Returns a libQ (kew) promise resolving to [{ value, label }].
SleepWakePlugin.prototype.fetchPlaylists = function () {
  const self = this;
  const defer = libQ.defer();
  self.apiGet('/api/v1/browse?uri=playlists', function (err, data) {
    if (err) { return defer.reject(err); }
    try {
      const response = JSON.parse(data);
      const playlists = response.navigation.lists[0].items.map(function (item) {
        return { value: item.title, label: item.title };
      });
      defer.resolve(playlists);
    } catch (e) {
      defer.reject(e);
    }
  });
  return defer.promise;
};

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

SleepWakePlugin.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

SleepWakePlugin.prototype.getConf = function (varName) {
  return this.config.get(varName);
};

SleepWakePlugin.prototype.setConf = function (varName, varValue) {
  this.config.set(varName, varValue);
};

// Append a line to the log file (non-blocking).
SleepWakePlugin.prototype.writeLog = function (message) {
  const line = '[' + new Date().toISOString() + '] ' + message + os.EOL;
  fs.appendFile(this.logFile, line, function () { /* best effort */ });
};

// Delete the log file if it grew past MAX_LOG_SIZE.
SleepWakePlugin.prototype.manageLogSize = function () {
  const self = this;
  try {
    if (fs.existsSync(self.logFile) && fs.statSync(self.logFile).size > MAX_LOG_SIZE) {
      fs.unlinkSync(self.logFile);
      self.writeLog('Log file exceeded 2 MB. Old log deleted, new log started.');
    }
  } catch (error) {
    self.logger.error('Error managing log file size: ' + error);
    self.writeLog('Error managing log file size: ' + error);
  }
};
