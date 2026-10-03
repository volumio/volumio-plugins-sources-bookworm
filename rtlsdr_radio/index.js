'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var express = require('express');
var bodyParser = require('body-parser');
var path = require('path');
var metadata = require('./lib/metadata');
var storage = require('./lib/storage');
var Tuner = require('./lib/tuner');
var FmQuality = require('./lib/fmquality');
var Logos = require('./lib/logos');
var Updater = require('./lib/update');

module.exports = ControllerRtlsdrRadio;

function ControllerRtlsdrRadio(context) {
  var self = this;
  
  // Core Volumio context
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;
  
  // Process references
  self.decoderProcess = null;
  self.scanProcess = null;
  self.soxProcess = null;
  self.aplayProcess = null;
  self.redseaProcess = null;
  self.cleanupTimeout = null;
  
  // Station database
  self.currentStation = null;
  self.stationsDb = { fm: [], dab: [] };
  self.stationsDbFile = storage.file('stations');
  self.dbLoadedAt = null;
  
  // Device state management
  self.deviceState = 'idle'; // idle, scanning_fm, scanning_dab, playing_fm, playing_dab
  self.operationQueue = [];
  self.intentionalStop = false;
  
  // RDS state tracking
  self.rdsEnabled = true;
  self.currentRds = null;
  self.rdsBuffer = '';
  self.lastRdsState = null;
  self.lastRdsUpdate = 0;
  self.lastSignalLevel = undefined;
  self.lastTmcAlert = null;
  self.psHistory = [];      // Track PS name stability
  self.stablePs = null;     // Confirmed stable PS name
  
  // DAB DLS metadata state tracking
  self.currentDls = null;
  self.lastDlsLabel = '';
  self.lastRawLabel = null;
  self.lastDlsUpdate = 0;
  self.lastDabState = null;
  self.dlsMonitorInterval = null;
  self.dabMetadataDir = '/tmp/dab';
  self.currentDabStation = null;
  self.currentFmFrequency = null;
  self.lastValidAlbumart = null;  // Cached artwork URL
  self.lastValidArtist = null;    // Cached artist for artwork
  self.lastValidTitle = null;     // Cached title for artwork
  self.pendingArtworkLookup = null;  // Track key of in-progress lookup
  self.lastArtworkLogKey = null;     // Prevent duplicate cache log messages
  
  // Express server for station management web interface
  self.expressApp = null;
  self.expressServer = null;
  self.detectedHostname = null;
  
  // Timing constants (milliseconds)
  self.USB_RESET_DELAY = 600;        // Delay for USB dongle to reset after stopping
  
  // The one owner of the dongle's processes: playback, scans and the antenna tools
  // each run as a job of it, one at a time
  self.tuner = new Tuner({ logger: self.logger, settle: self.USB_RESET_DELAY });
  
  // Updates of the plugin itself, from the plugin store or the previews on GitHub
  self.updater = new Updater({
    dir: storage.BACKUP_DIR + '/update',
    version: require('./package.json').version,
    pluginPath: __dirname,
    logger: self.logger,
    channel: function() { return self.config ? self.config.get('update_channel', 'stable') : 'stable'; },
    plugin: {
      storeVersions: function() { return self.storeVersions(); },
      testMode: function() { return fs.existsSync('/data/testplugins'); },
      backup: function() { self.backupBeforeUpdate(); },
      apply: function(url) { return self.applyUpdate(url); },
      restart: function() { self.restartBackend(); }
    }
  });

  // Station logos, fetched from the broadcasters when the player is online
  self.logos = new Logos({
    logger: self.logger,
    stations: function() { return (self.stationsDb && self.stationsDb.dab) || []; },
    region: function() { return self.config ? self.config.get('fm_region', 'europe') : 'europe'; },
    onLogo: function() { self.logoArrived(); }
  });
  
  self.CLEANUP_TIMEOUT = 500;        // Wait for processes to fully terminate
  self.RESTART_DELAY = 2000;         // Delay before restarting plugin
  self.QUEUE_TIMEOUT = 60000;        // Operation queue timeout (60s)
  self.RDS_UPDATE_INTERVAL = 2000;   // Minimum between RDS state pushes
  self.SIGNAL_HOLD = 4000;           // A new tune level must hold this long before it is shown
  self.LOGOS_START_DELAY = 30000;    // Station logos are looked for this long after the plugin starts
  self.STORE_TIMEOUT = 15000;        // How long the plugin store is given to say which versions it has
  self.DLS_UPDATE_INTERVAL = 2000;   // Minimum between DLS state pushes
  self.DLS_POLL_INTERVAL = 2000;     // DLS file polling interval
  self.TMC_THROTTLE = 30000;         // Traffic alert throttle (30s)
  self.SPINNER_UPDATE = 1000;        // UI spinner update interval
  self.TOAST_DELAY = 1200;           // Delay before showing toast
  self.TEST_PLAYBACK_DURATION = 3000; // Manual test playback duration
  self.SCAN_PROGRESS_DELAY = 5000;   // Delay before showing scan progress toast
  
  // Scan timeouts (milliseconds)
  self.FM_SCAN_TIMEOUT = 30000;      // FM scan timeout (30s)
  self.DAB_SCAN_TIMEOUT = 300000;    // DAB scan timeout (5 minutes)
  self.DAB_DETECTION_TIMEOUT = 30000; // DAB ensemble detection timeout
  
  // Audio constants
  self.FM_SAMPLE_RATE = '171k';      // FM sample rate for RDS (multiple of 57kHz)
  self.OUTPUT_SAMPLE_RATE = 48000;   // Output sample rate for Volumio
  self.MANAGEMENT_PORT = 3456;       // Web interface port
  
  // CSV Import/Export constants
  self.CSV_FM_HEADERS = ['frequency', 'name', 'customName', 'favorite', 'hidden', 'notes'];
  self.CSV_DAB_HEADERS = ['channel', 'exactName', 'name', 'customName', 'ensemble', 'serviceId', 'favorite', 'hidden', 'notes'];
  self.CSV_MAX_FILE_SIZE = 1048576;  // 1MB
  self.CSV_FM_FREQ_MAX = 108.0;
  self.DAB_CHANNELS = [
    '5A', '5B', '5C', '5D', '6A', '6B', '6C', '6D',
    '7A', '7B', '7C', '7D', '8A', '8B', '8C', '8D',
    '9A', '9B', '9C', '9D', '10A', '10B', '10C', '10D',
    '11A', '11B', '11C', '11D', '12A', '12B', '12C', '12D',
    '13A', '13B', '13C', '13D', '13E', '13F'
  ];
}

ControllerRtlsdrRadio.prototype.onVolumioStart = function() {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context, 'config.json'
  );
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  
  // Load FM region data
  try {
    var regionFile = __dirname + '/region.json';
    self.regionData = require(regionFile);
    self.logger.info('[RTL-SDR Radio] Loaded FM region data');
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to load region.json: ' + e.message);
    // Fallback to default region data
    self.regionData = {
      default: 'europe',
      regions: {
        europe: { band_start: 87.5, band_end: 108.0, spacing_khz: 100, deemphasis_us: 50 }
      }
    };
  }
  
  return libQ.resolve();
};

ControllerRtlsdrRadio.prototype.onStart = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Starting plugin');
  
  // Load i18n strings
  self.loadI18nStrings()
    .then(function() {
      return self.loadStations();
    })
    .then(function() {
      // Station logos that are due are fetched in the background, once the player is
      // done starting; a station listed or played before that is fetched at once
      self.logos.prepare();
      self.logosTimer = setTimeout(function() {
        self.logosTimer = null;
        self.fetchLogos();
      }, self.LOGOS_START_DELAY);
      self.logosTimer.unref();
      
      // Load artwork blocklist and set debug logging
      self.loadBlocklistOnStartup();
      metadata.setDebugLogging(self.config.get('artwork_debug_logging', false));
      return self.ensureBackupDirectory();
    })
    .then(function() {
      return self.startManagementServer();
    })
    .then(function() {
      // Setup manager integration options if enabled (Option 3)
      // DISABLED: Awaiting Volumio core support for dynamic menu items
      // if (self.config.get('manager_menu_item_enabled', false)) {
      //   self.pushManagerMenuItem();
      // }
      
      self.addToBrowseSources();
      self.logger.info('[RTL-SDR Radio] Plugin started successfully');
      defer.resolve();
    })
    .fail(function(e) {
      self.logger.error('[RTL-SDR Radio] Startup failed: ' + e);
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.onStop = function() {
  var self = this;
  var defer = libQ.defer();
  
  // Stop all processes; the stop is complete only when they are gone
  var stopped = self.stopAllProcesses('onStop');
  
  // Whatever follows the stop (an update, an uninstall), the lists are kept with the backups
  storage.keepLastGood('stations');
  storage.keepLastGood('blocklist');
  
  // Clear device state (process references already cleared by stopAllProcesses)
  self.deviceState = 'idle';
  
  // Logos not fetched yet are fetched after the next start
  clearTimeout(self.logosTimer);
  self.logosTimer = null;
  self.logos.stop();
  
  // Remove browse source
  self.commandRouter.volumioRemoveToBrowseSources('FM/DAB Radio');
  
  // Cleanup manager integration (Option 3)
  // DISABLED: Awaiting Volumio core support for dynamic menu items
  // if (self.config.get('manager_menu_item_enabled', false)) {
  //   self.removeManagerMenuItem();
  // }
  
  // Stop management server
  if (self.expressServer) {
    try {
      self.expressServer.close();
      self.expressApp = null;
      self.expressServer = null;
      self.logger.info('[RTL-SDR Radio] Management server stopped');
    } catch (e) {
      self.logger.error('[RTL-SDR Radio] Error stopping management server: ' + e);
    }
  }
  
  stopped.then(function() {
    self.logger.info('[RTL-SDR Radio] Plugin stopped');
    defer.resolve();
  });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.onUnload = function() {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Unloading plugin - final cleanup');
  
  // Force terminate all processes
  self.stopAllProcesses('onUnload');
  
  self.logger.info('[RTL-SDR Radio] Plugin unloaded');
  
  return libQ.resolve();
};

ControllerRtlsdrRadio.prototype.onInstall = function() {
  var self = this;
  self.logger.info('[RTL-SDR Radio] onInstall: Performing installation tasks');
  
  // Check if database exists from previous installation
  var stationsFile = self.stationsDbFile;
  if (fs.existsSync(stationsFile)) {
    try {
      var data = fs.readJsonSync(stationsFile);
      var fmCount = (data.fm && data.fm.length) || 0;
      var dabCount = (data.dab && data.dab.length) || 0;
      self.logger.info('[RTL-SDR Radio] onInstall: Found existing database with ' + 
                      fmCount + ' FM and ' + dabCount + ' DAB stations');
    } catch (e) {
      self.logger.warn('[RTL-SDR Radio] onInstall: Could not read existing database: ' + e);
    }
  } else {
    self.logger.info('[RTL-SDR Radio] onInstall: No existing database found (fresh install)');
  }
};

ControllerRtlsdrRadio.prototype.onUninstall = function() {
  var self = this;
  self.logger.info('[RTL-SDR Radio] onUninstall: Performing uninstallation tasks');
  
  var autoBackup = self.config.get('auto_backup_on_uninstall', false);
  if (autoBackup) {
    self.logger.info('[RTL-SDR Radio] Auto-backup enabled, creating backup...');
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      self.createStationsBackup(timestamp);
      self.createConfigBackup(timestamp);
      self.logger.info('[RTL-SDR Radio] Auto-backup completed');
    } catch (e) {
      self.logger.error('[RTL-SDR Radio] Auto-backup failed: ' + e);
    }
  }
  
  self.logger.info('[RTL-SDR Radio] onUninstall: Station database preserved in /data/');
};

// ===============================
// BACKUP AND RESTORE FUNCTIONS
// ===============================

ControllerRtlsdrRadio.prototype.ensureBackupDirectory = function() {
  var self = this;
  var backupDir = '/data/rtlsdr_radio_backups';
  
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirpSync(backupDir);
      fs.mkdirpSync(backupDir + '/stations');
      fs.mkdirpSync(backupDir + '/config');
      self.logger.info('[RTL-SDR Radio] Created backup directories');
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to create backup directories: ' + e);
  }
  
  return libQ.resolve();
};

ControllerRtlsdrRadio.prototype.createStationsBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    if (!timestamp) {
      timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    }
    
    var sourceFile = self.stationsDbFile;
    var backupFile = '/data/rtlsdr_radio_backups/stations/stations-' + timestamp + '.json';
    
    if (fs.existsSync(sourceFile)) {
      fs.copySync(sourceFile, backupFile);
      self.logger.info('[RTL-SDR Radio] Created stations backup: ' + backupFile);
      
      self.pruneBackups('stations');
      defer.resolve(backupFile);
    } else {
      defer.reject('Stations database file not found');
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to create stations backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.createConfigBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    if (!timestamp) {
      timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    }
    
    var sourceFile = '/data/configuration/music_service/rtlsdr_radio/config.json';
    var backupFile = '/data/rtlsdr_radio_backups/config/config-' + timestamp + '.json';
    
    if (fs.existsSync(sourceFile)) {
      fs.copySync(sourceFile, backupFile);
      self.logger.info('[RTL-SDR Radio] Created config backup: ' + backupFile);
      self.pruneBackups('config');
      defer.resolve(backupFile);
    } else {
      defer.reject('Config file not found');
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to create config backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.createBlocklistBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    if (!timestamp) {
      timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    }
    
    // Ensure blocklist backup directory exists
    var backupDir = '/data/rtlsdr_radio_backups/blocklist';
    fs.ensureDirSync(backupDir);
    
    var sourceFile = storage.file('blocklist');
    var backupFile = backupDir + '/blocklist-' + timestamp + '.json';
    
    if (fs.existsSync(sourceFile)) {
      fs.copySync(sourceFile, backupFile);
      self.logger.info('[RTL-SDR Radio] Created blocklist backup: ' + backupFile);
      self.pruneBackups('blocklist');
      defer.resolve(backupFile);
    } else {
      // No blocklist file exists - this is OK, just resolve with null
      self.logger.info('[RTL-SDR Radio] No blocklist file to backup');
      defer.resolve(null);
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to create blocklist backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.pruneBackups = function(type, keepCount) {
  var self = this;
  
  if (!keepCount) {
    keepCount = 5;
  }
  
  try {
    var backupDir = '/data/rtlsdr_radio_backups/' + type;
    if (!fs.existsSync(backupDir)) {
      return;
    }
    
    var files = fs.readdirSync(backupDir);
    files = files.filter(function(f) {
      return f.endsWith('.json');
    });
    
    if (files.length <= keepCount) {
      return;
    }
    
    files.sort().reverse();
    
    for (var i = keepCount; i < files.length; i++) {
      var oldFile = backupDir + '/' + files[i];
      fs.removeSync(oldFile);
      self.logger.info('[RTL-SDR Radio] Pruned old backup: ' + oldFile);
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to prune backups: ' + e);
  }
};

ControllerRtlsdrRadio.prototype.listAvailableBackups = function() {
  var self = this;
  var backups = {
    stations: [],
    config: [],
    blocklist: []
  };
  
  try {
    var stationsDir = '/data/rtlsdr_radio_backups/stations';
    var configDir = '/data/rtlsdr_radio_backups/config';
    var blocklistDir = '/data/rtlsdr_radio_backups/blocklist';
    
    if (fs.existsSync(stationsDir)) {
      var stationsFiles = fs.readdirSync(stationsDir);
      stationsFiles = stationsFiles.filter(function(f) {
        return f.startsWith('stations-') && f.endsWith('.json');
      });
      stationsFiles.sort().reverse();
      
      backups.stations = stationsFiles.map(function(f) {
        var filePath = stationsDir + '/' + f;
        var stats = fs.statSync(filePath);
        var timestamp = f.replace('stations-', '').replace('.json', '');
        return {
          filename: f,
          timestamp: timestamp,
          size: stats.size,
          date: stats.mtime
        };
      });
    }
    
    if (fs.existsSync(configDir)) {
      var configFiles = fs.readdirSync(configDir);
      configFiles = configFiles.filter(function(f) {
        return f.startsWith('config-') && f.endsWith('.json');
      });
      configFiles.sort().reverse();
      
      backups.config = configFiles.map(function(f) {
        var filePath = configDir + '/' + f;
        var stats = fs.statSync(filePath);
        var timestamp = f.replace('config-', '').replace('.json', '');
        return {
          filename: f,
          timestamp: timestamp,
          size: stats.size,
          date: stats.mtime
        };
      });
    }
    
    if (fs.existsSync(blocklistDir)) {
      var blocklistFiles = fs.readdirSync(blocklistDir);
      blocklistFiles = blocklistFiles.filter(function(f) {
        return f.startsWith('blocklist-') && f.endsWith('.json');
      });
      blocklistFiles.sort().reverse();
      
      backups.blocklist = blocklistFiles.map(function(f) {
        var filePath = blocklistDir + '/' + f;
        var stats = fs.statSync(filePath);
        var timestamp = f.replace('blocklist-', '').replace('.json', '');
        return {
          filename: f,
          timestamp: timestamp,
          size: stats.size,
          date: stats.mtime
        };
      });
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to list backups: ' + e);
  }
  
  return backups;
};

// The file of a backup, or null when the kind or the timestamp are not what backups
// are named with. Both arrive in requests and become part of a file name.
ControllerRtlsdrRadio.prototype.backupFile = function(type, timestamp) {
  if (['stations', 'config', 'blocklist'].indexOf(type) === -1) {
    return null;
  }
  if (typeof timestamp !== 'string' || !/^[0-9TZ-]{1,40}$/.test(timestamp)) {
    return null;
  }
  return '/data/rtlsdr_radio_backups/' + type + '/' + type + '-' + timestamp + '.json';
};

ControllerRtlsdrRadio.prototype.restoreStationsBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backupFile = self.backupFile('stations', timestamp);
    
    if (backupFile && fs.existsSync(backupFile)) {
      storage.write('stations', fs.readJsonSync(backupFile));
      self.logger.info('[RTL-SDR Radio] Restored stations from: ' + backupFile);
      defer.resolve();
    } else {
      defer.reject('Backup file not found: ' + timestamp);
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to restore stations backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.restoreBlocklistBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backupFile = self.backupFile('blocklist', timestamp);
    
    if (backupFile && fs.existsSync(backupFile)) {
      storage.write('blocklist', fs.readJsonSync(backupFile));
      self.logger.info('[RTL-SDR Radio] Restored blocklist from: ' + backupFile);
      // Reload blocklist into metadata module
      self.loadBlocklistOnStartup();
      defer.resolve();
    } else {
      defer.reject('Backup file not found: ' + timestamp);
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to restore blocklist backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.restoreConfigBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backupFile = self.backupFile('config', timestamp);
    var targetFile = '/data/configuration/music_service/rtlsdr_radio/config.json';
    
    if (backupFile && fs.existsSync(backupFile)) {
      fs.copySync(backupFile, targetFile);
      // The settings in memory must follow the file, or the next change writes the old ones back
      self.config.loadFile(targetFile);
      self.logger.info('[RTL-SDR Radio] Restored config from: ' + backupFile);
      defer.resolve();
    } else {
      defer.reject('Backup file not found: ' + timestamp);
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to restore config backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.deleteBackup = function(type, timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backupFile = self.backupFile(type, timestamp);
    
    if (backupFile && fs.existsSync(backupFile)) {
      fs.removeSync(backupFile);
      self.logger.info('[RTL-SDR Radio] Deleted backup: ' + backupFile);
      defer.resolve();
    } else {
      defer.reject('Backup file not found');
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to delete backup: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.createBackupFromUI = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.ensureBackupDirectory();
  
  self.createStationsBackup()
    .then(function() {
      return self.createConfigBackup();
    })
    .then(function() {
      return self.createBlocklistBackup();
    })
    .then(function() {
      self.pruneBackups('stations');
      self.pruneBackups('config');
      self.pruneBackups('blocklist');
      self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
        self.getI18nString('TOAST_BACKUP_CREATED'));
      defer.resolve();
    })
    .fail(function(e) {
      self.logger.error('[RTL-SDR Radio] UI backup failed: ' + e);
      self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
        self.getI18nString('TOAST_BACKUP_FAILED') + ': ' + e);
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.restoreLatestBackupFromUI = function() {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backups = self.listAvailableBackups();
    
    if (backups.stations.length === 0 && backups.config.length === 0 && backups.blocklist.length === 0) {
      self.commandRouter.pushToastMessage('warning', 'FM/DAB Radio', 
        self.getI18nString('TOAST_NO_BACKUPS'));
      defer.reject('No backups available');
      return defer.promise;
    }
    
    var promises = [];
    
    if (backups.stations.length > 0) {
      var latestStations = backups.stations[0].timestamp;
      promises.push(self.restoreStationsBackup(latestStations));
    }
    
    if (backups.config.length > 0) {
      var latestConfig = backups.config[0].timestamp;
      promises.push(self.restoreConfigBackup(latestConfig));
    }
    
    if (backups.blocklist.length > 0) {
      var latestBlocklist = backups.blocklist[0].timestamp;
      promises.push(self.restoreBlocklistBackup(latestBlocklist));
    }
    
    libQ.all(promises)
      .then(function() {
        self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
          self.getI18nString('TOAST_RESTORE_SUCCESS'));
        setTimeout(function() {
          self.onStop()
            .then(function() {
              return self.onStart();
            })
            .then(function() {
              defer.resolve();
            });
        }, self.RESTART_DELAY);
      })
      .fail(function(e) {
        self.logger.error('[RTL-SDR Radio] UI restore failed: ' + e);
        self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
          self.getI18nString('TOAST_RESTORE_FAILED_MSG') + ': ' + e);
        defer.reject(e);
      });
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] UI restore error: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('TOAST_RESTORE_FAILED_MSG') + ': ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.createZipBackup = function(type, timestamp, res) {
  var self = this;
  var execFileSync = require('child_process').execFileSync;
  
  try {
    var backupFile = self.backupFile(type, timestamp);
    
    if (!backupFile || !fs.existsSync(backupFile)) {
      res.status(404).json({ error: 'Backup file not found' });
      return;
    }
    
    var zipFile = '/tmp/' + type + '-' + timestamp + '.zip';
    fs.removeSync(zipFile);
    // -j: the file is stored under its own name, without its directories
    execFileSync('zip', ['-q', '-j', zipFile, backupFile]);
    
    res.download(zipFile, type + '-' + timestamp + '.zip', function(err) {
      if (fs.existsSync(zipFile)) {
        fs.removeSync(zipFile);
      }
      if (err) {
        self.logger.error('[RTL-SDR Radio] Download error: ' + err);
      }
    });
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to create zip: ' + e);
    res.status(500).json({ error: e.toString() });
  }
};

ControllerRtlsdrRadio.prototype.extractAndValidateZip = function(zipPath) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var extractDir = '/tmp/rtlsdr_restore_' + Date.now();
    fs.mkdirpSync(extractDir);
    
    require('child_process').execFileSync('unzip', ['-q', zipPath, '-d', extractDir]);
    
    var files = fs.readdirSync(extractDir);
    var jsonFile = files.find(function(f) {
      return f.endsWith('.json');
    });
    
    if (!jsonFile) {
      fs.removeSync(extractDir);
      defer.reject('No JSON file found in backup');
      return defer.promise;
    }
    
    var jsonPath = extractDir + '/' + jsonFile;
    var data = fs.readJsonSync(jsonPath);
    
    var isValid = false;
    var info = {};
    
    if (data.version && (data.fm || data.dab)) {
      isValid = true;
      info.type = 'stations';
      info.fmCount = data.fm ? data.fm.length : 0;
      info.dabCount = data.dab ? data.dab.length : 0;
    } else if (data.fm_gain !== undefined || data.dab_gain !== undefined) {
      isValid = true;
      info.type = 'config';
    } else if (Array.isArray(data.phrases)) {
      isValid = true;
      info.type = 'blocklist';
      info.phraseCount = data.phrases.length;
    }
    
    if (isValid) {
      defer.resolve({
        extractDir: extractDir,
        jsonFile: jsonPath,
        info: info
      });
    } else {
      fs.removeSync(extractDir);
      defer.reject('Invalid backup file format');
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to extract/validate zip: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};


// ========== CSV IMPORT/EXPORT HELPER FUNCTIONS ==========

// Parse a single CSV line handling quoted values with commas
ControllerRtlsdrRadio.prototype.parseCsvLine = function(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  
  for (var i = 0; i < line.length; i++) {
    var char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
};

// Escape a value for CSV output
ControllerRtlsdrRadio.prototype.escapeCsvValue = function(value) {
  if (value === null || value === undefined) {
    return '';
  }
  var str = String(value);
  if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

// Export stations to CSV string
ControllerRtlsdrRadio.prototype.exportStationsCsv = function(type) {
  var self = this;
  var lines = [];
  
  if (type === 'fm') {
    lines.push(self.CSV_FM_HEADERS.join(','));
    
    if (self.stationsDb.fm) {
      self.stationsDb.fm.forEach(function(station) {
        if (!station.deleted) {
          var row = [
            self.escapeCsvValue(station.frequency),
            self.escapeCsvValue(station.name || ''),
            self.escapeCsvValue(station.customName || ''),
            station.favorite ? 'true' : 'false',
            station.hidden ? 'true' : 'false',
            self.escapeCsvValue(station.notes || '')
          ];
          lines.push(row.join(','));
        }
      });
    }
  } else if (type === 'dab') {
    lines.push(self.CSV_DAB_HEADERS.join(','));
    
    if (self.stationsDb.dab) {
      self.stationsDb.dab.forEach(function(station) {
        if (!station.deleted) {
          var row = [
            self.escapeCsvValue(station.channel),
            self.escapeCsvValue(station.exactName),
            self.escapeCsvValue(station.name || ''),
            self.escapeCsvValue(station.customName || ''),
            self.escapeCsvValue(station.ensemble || ''),
            self.escapeCsvValue(station.serviceId || '0'),
            station.favorite ? 'true' : 'false',
            station.hidden ? 'true' : 'false',
            self.escapeCsvValue(station.notes || '')
          ];
          lines.push(row.join(','));
        }
      });
    }
  }
  
  return lines.join('\n');
};

// Validate CSV data and return parsed stations
ControllerRtlsdrRadio.prototype.validateCsvData = function(content, filename) {
  var self = this;
  var lines = content.split(/\r?\n/).filter(function(line) {
    return line.trim().length > 0;
  });
  
  if (lines.length < 1) {
    return { valid: false, errors: [{ line: 0, message: 'Empty file' }] };
  }
  
  // Detect type from headers
  var headerLine = lines[0].toLowerCase();
  var type = null;
  
  if (headerLine.indexOf('frequency') !== -1) {
    type = 'fm';
  } else if (headerLine.indexOf('channel') !== -1 && headerLine.indexOf('exactname') !== -1) {
    type = 'dab';
  } else {
    return { valid: false, errors: [{ line: 1, message: 'Invalid headers - cannot detect FM or DAB format' }] };
  }
  
  // Parse header to get column indices
  var headers = self.parseCsvLine(lines[0]).map(function(h) { return h.toLowerCase(); });
  var errors = [];
  var stations = [];
  
  // Get FM frequency limits from region settings
  var fmFreqMin = self.getRegionSettings().band_start;
  var fmFreqMax = self.CSV_FM_FREQ_MAX;
  
  // Process data rows
  for (var i = 1; i < lines.length; i++) {
    var lineNum = i + 1;
    var values = self.parseCsvLine(lines[i]);
    var station = {};
    
    // Map values to headers
    for (var j = 0; j < headers.length; j++) {
      station[headers[j]] = values[j] || '';
    }
    
    if (type === 'fm') {
      // Validate FM station
      var freq = parseFloat(station.frequency);
      if (isNaN(freq)) {
        errors.push({ line: lineNum, message: 'Invalid frequency "' + station.frequency + '"' });
        continue;
      }
      if (freq < fmFreqMin || freq > fmFreqMax) {
        errors.push({ line: lineNum, message: 'Frequency ' + freq + ' out of range (' + fmFreqMin + '-' + fmFreqMax + ')' });
        continue;
      }
      
      // Preserve precision (50kHz spacing needs 2 decimals)
      var hasSubDecimal = (freq * 100) % 10 !== 0;
      var freqStr = hasSubDecimal ? freq.toFixed(2) : freq.toFixed(1);
      
      stations.push({
        frequency: freqStr,
        name: station.name || 'FM ' + freqStr,
        customName: station.customname || '',
        favorite: self.parseCsvBoolean(station.favorite),
        hidden: self.parseCsvBoolean(station.hidden),
        notes: station.notes || ''
      });
    } else if (type === 'dab') {
      // Validate DAB station
      var channel = station.channel ? station.channel.toUpperCase() : '';
      if (!channel || self.DAB_CHANNELS.indexOf(channel) === -1) {
        errors.push({ line: lineNum, message: 'Invalid channel "' + station.channel + '"' });
        continue;
      }
      if (!station.exactname) {
        errors.push({ line: lineNum, message: 'Missing exactName (required)' });
        continue;
      }
      
      stations.push({
        channel: channel,
        exactName: station.exactname,  // Preserve case and spaces
        name: station.name || station.exactname,
        customName: station.customname || '',
        ensemble: station.ensemble || '',
        serviceId: station.serviceid || '0',
        favorite: self.parseCsvBoolean(station.favorite),
        hidden: self.parseCsvBoolean(station.hidden),
        notes: station.notes || ''
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    type: type,
    filename: filename,
    totalRows: lines.length - 1,
    validCount: stations.length,
    errors: errors,
    stations: stations
  };
};

// Parse boolean from CSV value
ControllerRtlsdrRadio.prototype.parseCsvBoolean = function(value) {
  if (!value) return false;
  var v = value.toString().toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes';
};

// Import CSV stations with specified operation
ControllerRtlsdrRadio.prototype.importCsvStations = function(type, stations, operation) {
  var self = this;
  var imported = 0;
  var updated = 0;
  var removed = 0;
  var skipped = 0;
  
  if (type === 'fm') {
    if (operation === 'replace') {
      // Clear all FM stations and import fresh
      self.stationsDb.fm = stations.map(function(s) {
        return {
          frequency: s.frequency,
          name: s.name,
          customName: s.customName,
          favorite: s.favorite,
          hidden: s.hidden,
          deleted: false,
          notes: s.notes,
          dateAdded: new Date().toISOString(),
          playCount: 0,
          lastPlayed: null
        };
      });
      imported = stations.length;
    } else {
      stations.forEach(function(csvStation) {
        var existingIndex = self.stationsDb.fm.findIndex(function(s) {
          return parseFloat(s.frequency) === parseFloat(csvStation.frequency);
        });
        
        if (operation === 'amend') {
          if (existingIndex !== -1) {
            // Update existing - preserve playCount, lastPlayed, dateAdded
            var existing = self.stationsDb.fm[existingIndex];
            existing.name = csvStation.name;
            existing.customName = csvStation.customName;
            existing.favorite = csvStation.favorite;
            existing.hidden = csvStation.hidden;
            existing.notes = csvStation.notes;
            existing.deleted = false;
            updated++;
          } else {
            skipped++;
          }
        } else if (operation === 'extend') {
          if (existingIndex === -1) {
            // Add new station
            self.stationsDb.fm.push({
              frequency: csvStation.frequency,
              name: csvStation.name,
              customName: csvStation.customName,
              favorite: csvStation.favorite,
              hidden: csvStation.hidden,
              deleted: false,
              notes: csvStation.notes,
              dateAdded: new Date().toISOString(),
              playCount: 0,
              lastPlayed: null
            });
            imported++;
          } else {
            skipped++;
          }
        } else if (operation === 'remove') {
          if (existingIndex !== -1) {
            self.stationsDb.fm[existingIndex].deleted = true;
            removed++;
          } else {
            skipped++;
          }
        }
      });
    }
  } else if (type === 'dab') {
    if (operation === 'replace') {
      // Clear all DAB stations and import fresh
      self.stationsDb.dab = stations.map(function(s) {
        return {
          channel: s.channel,
          exactName: s.exactName,
          name: s.name,
          customName: s.customName,
          ensemble: s.ensemble,
          serviceId: s.serviceId,
          favorite: s.favorite,
          hidden: s.hidden,
          deleted: false,
          notes: s.notes,
          dateAdded: new Date().toISOString(),
          playCount: 0,
          lastPlayed: null
        };
      });
      imported = stations.length;
    } else {
      stations.forEach(function(csvStation) {
        var existingIndex = self.stationsDb.dab.findIndex(function(s) {
          return s.channel === csvStation.channel && s.exactName === csvStation.exactName;
        });
        
        if (operation === 'amend') {
          if (existingIndex !== -1) {
            // Update existing - preserve playCount, lastPlayed, dateAdded, serviceId
            var existing = self.stationsDb.dab[existingIndex];
            existing.name = csvStation.name;
            existing.customName = csvStation.customName;
            existing.ensemble = csvStation.ensemble;
            existing.favorite = csvStation.favorite;
            existing.hidden = csvStation.hidden;
            existing.notes = csvStation.notes;
            existing.deleted = false;
            updated++;
          } else {
            skipped++;
          }
        } else if (operation === 'extend') {
          if (existingIndex === -1) {
            // Add new station
            self.stationsDb.dab.push({
              channel: csvStation.channel,
              exactName: csvStation.exactName,
              name: csvStation.name,
              customName: csvStation.customName,
              ensemble: csvStation.ensemble,
              serviceId: csvStation.serviceId,
              favorite: csvStation.favorite,
              hidden: csvStation.hidden,
              deleted: false,
              notes: csvStation.notes,
              dateAdded: new Date().toISOString(),
              playCount: 0,
              lastPlayed: null
            });
            imported++;
          } else {
            skipped++;
          }
        } else if (operation === 'remove') {
          if (existingIndex !== -1) {
            self.stationsDb.dab[existingIndex].deleted = true;
            removed++;
          } else {
            skipped++;
          }
        }
      });
    }
  }
  
  // Save changes
  if (!self.saveStations()) {
    return {
      success: false,
      error: 'The station list could not be saved',
      type: type,
      operation: operation
    };
  }
  
  return {
    success: true,
    type: type,
    operation: operation,
    imported: imported,
    updated: updated,
    removed: removed,
    skipped: skipped
  };
};


// ===============================
// STATION MANAGEMENT WEB SERVER
// ===============================

ControllerRtlsdrRadio.prototype.startManagementServer = function() {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Initialize Express app
    self.expressApp = express();
    self.expressApp.use(bodyParser.json());
    self.expressApp.use(bodyParser.urlencoded({ extended: true }));
    
    // Middleware: Detect actual hostname/IP from request
    self.expressApp.use(function(req, res, next) {
      if (req.headers.host) {
        // Extract hostname/IP without port
        var hostWithoutPort = req.headers.host.split(':')[0];
        
        // Only update if not localhost (which doesn't help)
        if (hostWithoutPort !== 'localhost' && hostWithoutPort !== '127.0.0.1') {
          self.detectedHostname = hostWithoutPort;
        }
      }
      next();
    });
    
    // Serve static HTML page
    self.expressApp.get('/', function(req, res) {
      res.sendFile(path.join(__dirname, 'manage.html'));
    });
    
    self.expressApp.get('/manage', function(req, res) {
      res.sendFile(path.join(__dirname, 'manage.html'));
    });
    
    // Serve antenna icon (for potential future use)
    self.expressApp.get('/icon', function(req, res) {
      res.sendFile(path.join(__dirname, 'assets', 'antenna.svg'));
    });
    
    // API: Get all stations
    self.expressApp.get('/api/stations', function(req, res) {
      try {
        res.json({
          fm: self.stationsDb.fm || [],
          dab: self.stationsDb.dab || []
        });
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error getting stations: ' + e);
        res.status(500).json({ error: 'Failed to get stations' });
      }
    });
    
    // API: Save stations
    self.expressApp.post('/api/stations', function(req, res) {
      try {
        var data = req.body;
        
        if (!Array.isArray(data.fm) || !Array.isArray(data.dab)) {
          return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Ensure FM frequencies are strings (fix for number input type)
        // Preserve precision - use 2 decimals if needed, otherwise 1
        data.fm.forEach(function(station) {
          if (typeof station.frequency === 'number') {
            var freq = station.frequency;
            var hasSubDecimal = (freq * 100) % 10 !== 0;
            station.frequency = hasSubDecimal ? freq.toFixed(2) : freq.toFixed(1);
          }
        });
        
        // Check the new list before it replaces the one in memory: a list that
        // cannot be saved must not become the list the plugin works with
        if (self.stationsDb.version === 2) {
          var candidate = Object.assign({}, self.stationsDb, { fm: data.fm, dab: data.dab });
          var validation = self.validateDatabaseV2(candidate);
          if (!validation.valid) {
            self.logger.error('[RTL-SDR Radio] Station update refused: ' + validation.errors.join(', '));
            return res.status(400).json({ error: 'Invalid station data', errors: validation.errors });
          }
        }
        
        // Update database
        self.stationsDb.fm = data.fm;
        self.stationsDb.dab = data.dab;
        
        // Save to disk (synchronous)
        if (!self.saveStations()) {
          return res.status(500).json({ error: 'The station list could not be saved' });
        }
        self.logger.info('[RTL-SDR Radio] Stations updated via web interface');
        res.json({ success: true });
        
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error processing station update: ' + e);
        res.status(500).json({ error: 'Failed to process update' });
      }
    });
    
    // API: Purge deleted stations permanently
    self.expressApp.post('/api/stations/purge', function(req, res) {
      try {
        // Remove all stations where deleted === true
        self.stationsDb.fm = self.stationsDb.fm.filter(function(station) {
          return !station.deleted;
        });
        
        self.stationsDb.dab = self.stationsDb.dab.filter(function(station) {
          return !station.deleted;
        });
        
        // Save to disk
        if (!self.saveStations()) {
          return res.status(500).json({ error: 'The station list could not be saved' });
        }
        self.logger.info('[RTL-SDR Radio] Purged deleted stations via web interface');
        res.json({ success: true });
        
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error purging stations: ' + e);
        res.status(500).json({ error: 'Failed to purge stations' });
      }
    });
    
    // API: Clear all FM stations (move to recycle bin)
    self.expressApp.post('/api/stations/clear-fm', function(req, res) {
      try {
        var clearedCount = 0;
        
        // Mark all FM stations as deleted
        self.stationsDb.fm.forEach(function(station) {
          if (!station.deleted) {
            station.deleted = true;
            clearedCount++;
          }
        });
        
        // Save to disk
        if (!self.saveStations()) {
          return res.status(500).json({ error: 'The station list could not be saved' });
        }
        self.logger.info('[RTL-SDR Radio] Cleared ' + clearedCount + ' FM stations via web interface');
        res.json({ success: true, count: clearedCount });
        
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error clearing FM stations: ' + e);
        res.status(500).json({ error: 'Failed to clear FM stations' });
      }
    });
    
    // API: Clear all DAB stations (move to recycle bin)
    self.expressApp.post('/api/stations/clear-dab', function(req, res) {
      try {
        var clearedCount = 0;
        
        // Mark all DAB stations as deleted
        self.stationsDb.dab.forEach(function(station) {
          if (!station.deleted) {
            station.deleted = true;
            clearedCount++;
          }
        });
        
        // Save to disk
        if (!self.saveStations()) {
          return res.status(500).json({ error: 'The station list could not be saved' });
        }
        self.logger.info('[RTL-SDR Radio] Cleared ' + clearedCount + ' DAB stations via web interface');
        res.json({ success: true, count: clearedCount });
        
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error clearing DAB stations: ' + e);
        res.status(500).json({ error: 'Failed to clear DAB stations' });
      }
    });
    
    // API: Scan for FM stations
    self.expressApp.post('/api/stations/scan-fm', function(req, res) {
      try {
        self.logger.info('[RTL-SDR Radio] FM scan triggered via web interface');
        self.scanFm();
        res.json({ success: true, message: 'FM scan started' });
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error starting FM scan: ' + e);
        res.status(500).json({ error: 'Failed to start FM scan' });
      }
    });
    
    // API: Scan for DAB stations
    self.expressApp.post('/api/stations/scan-dab', function(req, res) {
      try {
        self.logger.info('[RTL-SDR Radio] DAB scan triggered via web interface');
        self.scanDab();
        res.json({ success: true, message: 'DAB scan started' });
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Error starting DAB scan: ' + e);
        res.status(500).json({ error: 'Failed to start DAB scan' });
      }
    });
    
    // API: Get i18n translations
    self.expressApp.get('/api/i18n/:lang', function(req, res) {
      var lang = req.params.lang || 'en';
      var stringsFile = __dirname + '/i18n/strings_' + lang + '.json';
      
      fs.readFile(stringsFile, 'utf8', function(err, data) {
        if (err) {
          // Fallback to English
          self.logger.info('[RTL-SDR Radio] Translation file not found for ' + lang + ', using English');
          stringsFile = __dirname + '/i18n/strings_en.json';
          fs.readFile(stringsFile, 'utf8', function(err2, data2) {
            if (err2) {
              self.logger.error('[RTL-SDR Radio] Failed to load English translations: ' + err2);
              res.status(500).json({ error: 'Failed to load translations' });
            } else {
              try {
                res.json(JSON.parse(data2));
              } catch (e) {
                self.logger.error('[RTL-SDR Radio] Failed to parse English translations: ' + e);
                res.status(500).json({ error: 'Failed to parse translations' });
              }
            }
          });
        } else {
          try {
            res.json(JSON.parse(data));
          } catch (e) {
            self.logger.error('[RTL-SDR Radio] Failed to parse translations for ' + lang + ': ' + e);
            res.status(500).json({ error: 'Failed to parse translations' });
          }
        }
      });
    });
    
    // API: Get current Volumio language setting
    self.expressApp.get('/api/language', function(req, res) {
      try {
        var lang = self.commandRouter.sharedVars.get('language_code') || 'en';
        res.json({ language: lang });
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Failed to get language setting: ' + e);
        res.json({ language: 'en' });
      }
    });
    
    // API: Get device status
    self.expressApp.get('/api/status', function(req, res) {
      try {
        var fmCount = self.stationsDb.fm ? self.stationsDb.fm.filter(function(s) { 
          return !s.deleted; 
        }).length : 0;
        var dabCount = self.stationsDb.dab ? self.stationsDb.dab.filter(function(s) { 
          return !s.deleted; 
        }).length : 0;
        
        // Get current signal info
        var signalInfo = null;
        if (self.deviceState === 'playing_fm' && self.currentRds) {
          signalInfo = {
            type: 'fm',
            level: self.currentRds.signalLevel || 0,
            percent: self.currentRds.signalPercent || 0,
            frequency: self.currentFmFrequency || null
          };
        } else if (self.deviceState === 'playing_dab' && self.currentDabSignal) {
          signalInfo = {
            type: 'dab',
            level: self.currentDabSignal.level || 0,
            percent: self.currentDabSignal.percent || 0,
            station: self.currentDabStation || null
          };
        }
        
        res.json({ 
          deviceState: self.deviceState,
          fmStationsLoaded: fmCount,
          dabStationsLoaded: dabCount,
          dbLoadedAt: self.dbLoadedAt,
          dbVersion: self.stationsDb.version || 0,
          serverPort: self.MANAGEMENT_PORT,
          signal: signalInfo,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Failed to get status: ' + e);
        res.status(500).json({ error: e.toString() });
      }
    });
    
    
    // ===== MAINTENANCE API ENDPOINTS =====
    
    self.expressApp.get('/api/maintenance/settings', function(req, res) {
      try {
        var autoBackup = self.config.get('auto_backup_on_uninstall', false);
        res.json({ autoBackup: autoBackup });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.post('/api/maintenance/settings', function(req, res) {
      try {
        self.config.set('auto_backup_on_uninstall', req.body.autoBackup);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.get('/api/maintenance/backup/list', function(req, res) {
      try {
        res.json(self.listAvailableBackups());
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.post('/api/maintenance/backup/create', function(req, res) {
      try {
        var type = req.body.type;
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        if (type === 'stations') {
          self.createStationsBackup(timestamp)
            .then(function() { res.json({ success: true }); })
            .fail(function(e) { res.status(500).json({ error: e.toString() }); });
        } else if (type === 'config') {
          self.createConfigBackup(timestamp)
            .then(function() { res.json({ success: true }); })
            .fail(function(e) { res.status(500).json({ error: e.toString() }); });
        } else if (type === 'blocklist') {
          self.createBlocklistBackup(timestamp)
            .then(function() { res.json({ success: true }); })
            .fail(function(e) { res.status(500).json({ error: e.toString() }); });
        } else if (type === 'full') {
          self.createStationsBackup(timestamp)
            .then(function() { return self.createConfigBackup(timestamp); })
            .then(function() { return self.createBlocklistBackup(timestamp); })
            .then(function() { res.json({ success: true }); })
            .fail(function(e) { res.status(500).json({ error: e.toString() }); });
        } else {
          res.status(400).json({ error: 'Invalid backup type' });
        }
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.post('/api/maintenance/backup/restore', function(req, res) {
      try {
        var promises = [];
        if (req.body.stationsTimestamp) promises.push(self.restoreStationsBackup(req.body.stationsTimestamp));
        if (req.body.configTimestamp) promises.push(self.restoreConfigBackup(req.body.configTimestamp));
        if (req.body.blocklistTimestamp) promises.push(self.restoreBlocklistBackup(req.body.blocklistTimestamp));
        
        if (promises.length === 0) {
          res.status(400).json({ error: 'No backups specified' });
          return;
        }
        
        libQ.all(promises)
          .then(function() {
            res.json({ success: true });
            setTimeout(function() {
              self.onStop()
                .then(function() {
                  return self.onStart();
                });
            }, self.SPINNER_UPDATE);
          })
          .fail(function(e) { res.status(500).json({ error: e.toString() }); });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.delete('/api/maintenance/backup/delete', function(req, res) {
      try {
        self.deleteBackup(req.body.type, req.body.timestamp)
          .then(function() { res.json({ success: true }); })
          .fail(function(e) { res.status(500).json({ error: e.toString() }); });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.get('/api/maintenance/backup/download', function(req, res) {
      try {
        self.createZipBackup(req.query.type, req.query.timestamp, res);
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    var multer = require('multer');
    var upload = multer({ dest: '/tmp/' });
    
    self.expressApp.post('/api/maintenance/backup/upload', upload.single('file'), function(req, res) {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }
        
        var zipPath = req.file.path;
        
        self.extractAndValidateZip(zipPath)
          .then(function(result) {
            fs.removeSync(zipPath);
            fs.removeSync(result.extractDir);
            res.json({ success: true, info: result.info });
          })
          .fail(function(e) {
            fs.removeSync(zipPath);
            res.status(400).json({ error: e.toString() });
          });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    self.expressApp.post('/api/maintenance/backup/upload-restore', upload.single('file'), function(req, res) {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }
        
        var zipPath = req.file.path;
        
        self.extractAndValidateZip(zipPath)
          .then(function(result) {
            if (result.info.type === 'stations') {
              storage.write('stations', fs.readJsonSync(result.jsonFile));
            } else if (result.info.type === 'blocklist') {
              storage.write('blocklist', fs.readJsonSync(result.jsonFile));
            } else {
              var configFile = '/data/configuration/music_service/rtlsdr_radio/config.json';
              fs.copySync(result.jsonFile, configFile);
              self.config.loadFile(configFile);
            }
            fs.removeSync(zipPath);
            fs.removeSync(result.extractDir);
            
            res.json({ success: true });
            
            setTimeout(function() {
              self.onStop()
                .then(function() {
                  return self.onStart();
                });
            }, self.SPINNER_UPDATE);
          })
          .fail(function(e) {
            fs.removeSync(zipPath);
            res.status(400).json({ error: e.toString() });
          });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // ========== CSV IMPORT/EXPORT ENDPOINTS ==========
    
    // Download FM template
    self.expressApp.get('/api/csv/template/fm', function(req, res) {
      var content = self.CSV_FM_HEADERS.join(',') + '\n';
      content += '94.9,Example FM,My Radio,false,false,Optional notes\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="fm_template.csv"');
      res.send(content);
    });
    
    // Download DAB template
    self.expressApp.get('/api/csv/template/dab', function(req, res) {
      var content = self.CSV_DAB_HEADERS.join(',') + '\n';
      content += '12C,BBC Radio 1,BBC Radio 1,,London 1,0,true,false,Optional notes\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="dab_template.csv"');
      res.send(content);
    });
    
    // Export FM stations
    self.expressApp.get('/api/csv/export/fm', function(req, res) {
      try {
        var content = self.exportStationsCsv('fm');
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="stations_fm_' + timestamp + '.csv"');
        res.send(content);
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // Export DAB stations
    self.expressApp.get('/api/csv/export/dab', function(req, res) {
      try {
        var content = self.exportStationsCsv('dab');
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="stations_dab_' + timestamp + '.csv"');
        res.send(content);
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // Validate CSV file
    self.expressApp.post('/api/csv/validate', upload.single('file'), function(req, res) {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }
        
        var content = fs.readFileSync(req.file.path, 'utf8');
        fs.removeSync(req.file.path);
        
        if (content.length > self.CSV_MAX_FILE_SIZE) {
          res.status(400).json({ error: 'File too large (max 1MB)' });
          return;
        }
        
        var result = self.validateCsvData(content, req.file.originalname);
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // Import CSV file
    self.expressApp.post('/api/csv/import', upload.single('file'), function(req, res) {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }
        
        var content = fs.readFileSync(req.file.path, 'utf8');
        fs.removeSync(req.file.path);
        
        var operation = req.body.operation || 'extend';
        var validation = self.validateCsvData(content, req.file.originalname);
        
        if (!validation.valid) {
          res.status(400).json({ 
            error: 'Validation failed', 
            errors: validation.errors 
          });
          return;
        }
        
        var result = self.importCsvStations(validation.type, validation.stations, operation);
        if (result.success === false) {
          res.status(500).json(result);
          return;
        }
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // Antenna alignment tool - RF spectrum scan
    self.expressApp.post('/api/antenna/spectrum-scan', function(req, res) {
      self.acquireForTool('antenna_spectrum')
        .then(function(job) {
          var csvOutput = '';
          
          var rtlPower = job.run('fn-rtl_power', ['-f', '174M:240M:1M', '-i', '1', '-1'],
            { stdio: ['ignore', 'pipe', 'pipe'] }, function(entry) {
            if (entry.error) {
              res.status(500).json({ error: 'Failed to start fn-rtl_power: ' + entry.error.toString() });
              return;
            }
            if (entry.code !== 0) {
              res.status(500).json({ error: 'fn-rtl_power failed with ' +
                (entry.code !== null ? 'code ' + entry.code : entry.signal) });
              return;
            }
            
            // Parse CSV output
            var spectrum = [];
            var lines = csvOutput.trim().split('\n');
            lines.forEach(function(line) {
              var parts = line.split(',');
              if (parts.length >= 7) {
                var freqStart = parseInt(parts[2]) / 1000000; // Hz to MHz
                var power = parseFloat(parts[6]); // dBm
                spectrum.push({ freq: freqStart, power: power });
              }
            });
            
            res.json({ 
              success: true, 
              spectrum: spectrum, 
              timestamp: new Date().toISOString() 
            });
          });
          job.limit(self.FM_SCAN_TIMEOUT);
          
          if (rtlPower.stdout) {
            rtlPower.stdout.on('data', function(data) { 
              csvOutput += data.toString(); 
            });
          }
          if (rtlPower.stderr) {
            rtlPower.stderr.on('data', function(data) {
              self.logger.info('[RTL-SDR Radio] fn-rtl_power: ' + data.toString());
            });
          }
        })
        .fail(function(e) {
          res.status(e && e.superseded ? 409 : 500).json({ error: e.toString() });
        });
    });
    
    // Antenna alignment tool - DAB channel validation
    self.expressApp.post('/api/antenna/validate-dab', function(req, res) {
      var channels = self.dabChannelList(req.body && req.body.channels);
      if (!channels) {
        res.status(400).json({ error: 'Channels array required, each a DAB channel such as 12B' });
        return;
      }
      
      self.acquireForTool('antenna_validate', { keepOpen: true })
        .then(function(job) {
          // Set up Server-Sent Events
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
          res.flushHeaders();
          
          var channelIndex = 0;
          var totalChannels = channels.length;
          var over = false;
          
          // The tool ends when all channels are done, when the client goes away, or when
          // something else takes the tuner
          function finish() {
            if (!over) {
              over = true;
              job.stop('validation over');
            }
          }
          res.on('close', finish);
          
          // Send initial status
          res.write('data: ' + JSON.stringify({ 
            status: 'started', 
            total: totalChannels 
          }) + '\n\n');
          
          checkNextChannel();
          
          function checkNextChannel() {
            if (over || job.stopping) {
              res.end();
              return;
            }
            
            if (channelIndex >= totalChannels) {
              // All channels complete
              res.write('data: ' + JSON.stringify({ 
                status: 'complete',
                timestamp: new Date().toISOString() 
              }) + '\n\n');
              res.end();
              finish();
              return;
            }
            
            var targetChannel = channels[channelIndex];
            channelIndex++;
            
            self.logger.info('[RTL-SDR Radio] Validating DAB channel ' + targetChannel + ' (' + channelIndex + '/' + totalChannels + ')');
            
            // Get DAB settings from config
            var validationGain = self.numberSetting('dab_gain', 80);
            var validationPpm = self.numberSetting('dab_ppm', 0);
            
            // Use script to create pseudo-TTY, forcing line-buffered stdout
            // This ensures stdout data flushes immediately instead of being block-buffered.
            // script takes one command line; it is built from a channel of the fixed list
            // and two numbers, nothing else.
            var scanCommand = 'fn-dab-scanner -C ' + targetChannel + ' -G ' + validationGain +
                              (validationPpm !== 0 ? ' -p ' + validationPpm : '');
            var output = '';
            var targetChannelFound = false;
            var processKilled = false;
            var timeout = null;
            
            var scanner = job.run('script', ['-qec', scanCommand, '/dev/null'],
              { stdio: ['ignore', 'pipe', 'pipe'] }, function(entry) {
              clearTimeout(timeout);
              
              var result;
              if (entry.error) {
                self.logger.error('[RTL-SDR Radio] Channel ' + targetChannel + ' validation error: ' + entry.error.toString());
                result = {
                  channel: targetChannel,
                  sync: false,
                  services: 0,
                  quality: 'error',
                  error: entry.error.toString(),
                  progress: channelIndex,
                  total: totalChannels
                };
              } else {
                // Only what the scanner said while on the target channel counts
                var left = output.search(new RegExp('checking data in channel (?!' + targetChannel + '\\b)[A-Z0-9]+'));
                if (left !== -1) {
                  output = output.slice(0, left);
                }
                
                // Check for ensemble recognition (indicates successful sync)
                var syncDetected = /ensemble.*is \([A-Z0-9]+\) recognized/.test(output);
                
                // Count audio services
                var serviceMatches = output.match(/^audioservice;/gm);
                var serviceCount = serviceMatches ? serviceMatches.length : 0;
                
                var quality = 'none';
                if (syncDetected) {
                  if (serviceCount >= 10) quality = 'excellent';
                  else if (serviceCount >= 7) quality = 'strong';
                  else if (serviceCount >= 4) quality = 'good';
                  else if (serviceCount >= 2) quality = 'weak';
                  else if (serviceCount >= 1) quality = 'poor';
                }
                
                result = {
                  channel: targetChannel,
                  sync: syncDetected,
                  services: serviceCount,
                  quality: quality,
                  progress: channelIndex,
                  total: totalChannels
                };
                
                self.logger.info('[RTL-SDR Radio] Channel ' + targetChannel + ' results: ' + 
                               'sync=' + syncDetected + ', services=' + serviceCount + ', quality=' + quality);
              }
              
              // Send result immediately via SSE
              if (!over) {
                res.write('data: ' + JSON.stringify(result) + '\n\n');
              }
              
              // The scanner runs under script; make sure it has let the dongle go
              // before the next channel's scanner opens it
              job.settle().then(checkNextChannel);
            });
            
            function endScanner(why) {
              if (!processKilled) {
                processKilled = true;
                clearTimeout(timeout);
                self.logger.info('[RTL-SDR Radio] ' + why);
                try { scanner.kill('SIGTERM'); } catch (e) {}
              }
            }
            
            // Timeout safety - end after 30 seconds (allows high-capacity ensembles to complete)
            timeout = setTimeout(function() {
              endScanner('Validation timeout for channel ' + targetChannel);
            }, self.DAB_DETECTION_TIMEOUT);
            
            // The scanner runs under script, so what it writes to its two streams arrives
            // as one. Both signs are therefore looked for in everything received so far:
            // the summary line of the target channel, and the scanner moving on to another
            // channel (which it does at once when the target carries no ensemble).
            function inspect(data, visible) {
              var chunk = data.toString();
              output += chunk;
              
              chunk.split('\n').forEach(function(line) {
                if (line.trim() && !line.includes('No database available')) {
                  self.logger.info('[RTL-SDR Radio] fn-dab-scanner: ' + line);
                }
              });
              
              if (output.indexOf('; channel ' + targetChannel + ';') !== -1) {
                endScanner('Channel ' + targetChannel + ' validation complete, terminating scanner');
                return;
              }
              
              var checked = output.match(/checking data in channel [A-Z0-9]+/g) || [];
              var onTarget = 'checking data in channel ' + targetChannel;
              if (checked.indexOf(onTarget) !== -1) {
                if (!targetChannelFound) {
                  targetChannelFound = true;
                  self.logger.info('[RTL-SDR Radio] Started checking channel ' + targetChannel);
                }
                var latest = checked[checked.length - 1];
                if (latest !== onTarget) {
                  // Whether the target had a signal or not, the scanner has left it
                  endScanner('Scanner moved to ' + latest.replace('checking data in ', '') + ', terminating');
                }
              }
            }
            
            if (scanner.stdout) {
              scanner.stdout.on('data', inspect);
            }
            if (scanner.stderr) {
              scanner.stderr.on('data', inspect);
            }
          }
        })
        .fail(function(e) {
          if (!res.headersSent) {
            res.status(e && e.superseded ? 409 : 500).json({ error: e.toString() });
          } else {
            res.end();
          }
        });
    });
    
    // Antenna alignment tool - SNR measurement across gain settings
    self.expressApp.post('/api/antenna/snr-scan', function(req, res) {
      var body = req.body || {};
      var channels = self.dabChannelList(body.channels);
      if (!channels) {
        res.status(400).json({ error: 'Channels array required, each a DAB channel such as 12B' });
        return;
      }
      
      // Numbers within bounds, whatever was sent: a step of zero would never end
      function bounded(value, fallback, low, high) {
        var n = parseInt(value, 10);
        if (isNaN(n)) {
          n = fallback;
        }
        return Math.min(high, Math.max(low, n));
      }
      var gainStart = bounded(body.gainStart, -10, -10, 100);
      var gainStop = bounded(body.gainStop, 49, -10, 100);
      var gainStep = bounded(body.gainStep, 5, 1, 50);
      var integration = bounded(body.integration, 2, 1, 30);
      if (gainStop < gainStart) {
        var swap = gainStart;
        gainStart = gainStop;
        gainStop = swap;
      }
      
      self.acquireForTool('antenna_snr', { keepOpen: true })
        .then(function(job) {
          // Set up Server-Sent Events for progress updates
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
          
          var over = false;
          function finish() {
            if (!over) {
              over = true;
              job.stop('measurement over');
            }
          }
          res.on('close', finish);
          
          // Send initial status
          res.write('data: ' + JSON.stringify({ 
            status: 'started',
            channels: channels,
            gainRange: { start: gainStart, stop: gainStop, step: gainStep }
          }) + '\n\n');
          
          var snrModule = require('./lib/snr');
          
          snrModule.runSnrScan({
            channels: channels,
            gainStart: gainStart,
            gainStop: gainStop,
            gainStep: gainStep,
            integration: integration,
            logger: self.logger,
            spawn: function(command, args) {
              return job.spawn(command, args);
            },
            onProgress: function(gain, results, current, total) {
              if (!over) {
                res.write('data: ' + JSON.stringify({
                  status: 'progress',
                  gain: gain,
                  results: results,
                  progress: current,
                  total: total
                }) + '\n\n');
              }
            }
          })
          .then(function(data) {
            if (!over) {
              res.write('data: ' + JSON.stringify({
                status: 'complete',
                measurements: data.measurements,
                summary: data.summary,
                channels: data.channels,
                timestamp: data.timestamp
              }) + '\n\n');
            }
            res.end();
            finish();
          })
          .fail(function(err) {
            if (!over) {
              res.write('data: ' + JSON.stringify({
                status: 'error',
                error: err.toString()
              }) + '\n\n');
            }
            res.end();
            finish();
          });
        })
        .fail(function(e) {
          if (!res.headersSent) {
            res.status(e && e.superseded ? 409 : 500).json({ error: e.toString() });
          } else {
            res.end();
          }
        });
    });
    
    // ===== ARTWORK BLOCK LIST API ENDPOINTS =====
    
    // Get blocklist phrases
    self.expressApp.get('/api/blocklist', function(req, res) {
      try {
        var phrases = self.getBlocklistPhrases();
        res.json({ phrases: phrases });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // Save blocklist phrases
    self.expressApp.post('/api/blocklist', function(req, res) {
      try {
        var phrases = req.body.phrases || [];
        self.saveBlocklistPhrases(phrases);
        res.json({ success: true, count: phrases.length });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // Reset blocklist to defaults
    self.expressApp.post('/api/blocklist/reset', function(req, res) {
      try {
        var phrases = self.resetBlocklistPhrases();
        res.json({ success: true, phrases: phrases });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    
    // API: Plugin update - what is installed, what the chosen channel offers, how an
    // update under way is doing
    self.expressApp.get('/api/update', function(req, res) {
      self.updater.check(false).then(function(view) {
        res.json(view);
      }, function(e) {
        res.json(Object.assign(self.updater.view(), { error: { code: 'failed', message: String(e && e.message || e) } }));
      });
    });
    
    // API: Plugin update - look again now
    self.expressApp.post('/api/update/check', function(req, res) {
      self.updater.check(true).then(function(view) {
        res.json(view);
      });
    });
    
    // API: Plugin update - choose the channel: stable, beta or preview
    self.expressApp.post('/api/update/channel', function(req, res) {
      var channel = req.body && req.body.channel;
      if (Updater.CHANNELS.indexOf(channel) === -1) {
        return res.status(400).json({ error: { code: 'bad-channel', message: 'the channel is one of ' + Updater.CHANNELS.join(', ') } });
      }
      self.config.set('update_channel', channel);
      self.logger.info('[RTL-SDR Radio] Update: channel set to ' + channel);
      self.updater.check(true).then(function(view) {
        res.json(view);
      });
    });
    
    // API: Plugin update - install the version offered, or put back the one before
    ['install', 'rollback'].forEach(function(action) {
      self.expressApp.post('/api/update/' + action, function(req, res) {
        self.updater[action]().then(function(view) {
          res.json(view);
        }, function(e) {
          res.status(409).json(Object.assign(self.updater.view(), { error: { code: e && e.code || 'failed', message: String(e && e.message || e) } }));
        });
      });
    });
    
    // API: Station logos - how many stations have one, and whether fetching is under way
    self.expressApp.get('/api/logos/status', function(req, res) {
      res.json(self.logos.status());
    });
    
    // API: Station logos - fetch the missing ones again, then check the kept ones for newer versions
    self.expressApp.post('/api/logos/refresh', function(req, res) {
      self.logger.info('[RTL-SDR Radio] Logos: refresh asked for');
      res.json(self.logos.refresh());
    });
    
    // Start server
    self.expressServer = self.expressApp.listen(self.MANAGEMENT_PORT, function() {
      self.logger.info('[RTL-SDR Radio] Management server started on port ' + self.MANAGEMENT_PORT);
      defer.resolve();
    });
    
    // Handle server errors
    self.expressServer.on('error', function(e) {
      if (e.code === 'EADDRINUSE') {
        self.logger.error('[RTL-SDR Radio] Port ' + self.MANAGEMENT_PORT + ' already in use');
        defer.reject(new Error('Management server port already in use'));
      } else {
        self.logger.error('[RTL-SDR Radio] Management server error: ' + e);
        defer.reject(e);
      }
    });
    
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to start management server: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.getManagementUrl = function() {
  var self = this;
  
  // Priority: 1) User-configured override, 2) MDNS hostname
  var hostname;
  var override = self.config.get('hostname_override', '');
  
  if (override && override.trim() !== '') {
    // User specified IP or hostname
    hostname = override.trim();
  } else {
    // Fallback to MDNS hostname
    var systemName = self.commandRouter.sharedVars.get('system.name') || 'volumio';
    hostname = systemName + '.local';
  }
  
  return 'http://' + hostname + ':' + self.MANAGEMENT_PORT;
};

// Manager Integration Methods (v0.2.5 Testing)
// DISABLED: Awaiting Volumio core support for dynamic menu items
// These methods will be re-enabled if/when Volumio adds volumioAddToMenuItems API

/*
ControllerRtlsdrRadio.prototype.pushManagerMenuItem = function() {
  var self = this;
  
  try {
    self.commandRouter.pushMenuItems([{
      id: 'iframe-page',
      parent: 'settings',
      params: {
        url: self.getManagementUrl()
      },
      name: self.getI18nString('MENU_MANAGER'),
      icon: 'fa fa-signal'
    }]);
    
    self.logger.info('[RTL-SDR Radio] Manager menu item added');
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to push manager menu item: ' + e);
  }
};

ControllerRtlsdrRadio.prototype.removeManagerMenuItem = function() {
  var self = this;
  
  try {
    // Note: Volumio doesn't have a removeMenuItem API
    // Item will be removed on next restart when not re-pushed
    self.logger.info('[RTL-SDR Radio] Manager menu item will be removed on next restart');
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Error removing manager menu item: ' + e);
  }
};
*/

ControllerRtlsdrRadio.prototype.onVolumioStop = function() {
  var self = this;
  
  // Force terminate all processes
  self.stopAllProcesses('onVolumioStop');
  
  // Clear device state (process references already cleared by stopAllProcesses)
  self.deviceState = 'idle';
  
  self.logger.info('[RTL-SDR Radio] Ready for Volumio restart');
  
  return libQ.resolve();
};

// Helper function to kill all RTL-SDR related processes
// caller: string identifying which function called this (for logging)
// Unified process termination function - single source of truth
// caller: string identifying which function called this (for logging)
// Stop everything that uses the tuner and forget what the session kept.
// Returns a promise resolved when the processes are gone.
ControllerRtlsdrRadio.prototype.stopAllProcesses = function(caller) {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] ' + caller + ' - stopping all processes');
  return self.stopDecoder();
};

ControllerRtlsdrRadio.prototype.loadI18nStrings = function() {
  var self = this;
  var defer = libQ.defer();
  
  var lang_code = self.commandRouter.sharedVars.get('language_code') || 'en';
  self.current_language = lang_code;
  var langFile = __dirname + '/i18n/strings_' + lang_code + '.json';
  var defaultFile = __dirname + '/i18n/strings_en.json';
  
  // Always load English as fallback
  try {
    self.i18nStringsDefault = fs.readJsonSync(defaultFile);
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to load English fallback strings');
    self.i18nStringsDefault = {};
  }
  
  // Load requested language (or English if same)
  if (lang_code === 'en') {
    self.i18nStrings = self.i18nStringsDefault;
    self.logger.info('[RTL-SDR Radio] Loaded i18n strings for language: en');
  } else {
    try {
      self.i18nStrings = fs.readJsonSync(langFile);
      self.logger.info('[RTL-SDR Radio] Loaded i18n strings for language: ' + lang_code);
    } catch (e) {
      self.logger.warn('[RTL-SDR Radio] Failed to load ' + lang_code + ' translations, using English');
      self.i18nStrings = self.i18nStringsDefault;
    }
  }
  
  defer.resolve();
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.getI18nString = function(key) {
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
  self.logger.warn('[RTL-SDR Radio] Missing translation for key: ' + key);
  return key;
};

ControllerRtlsdrRadio.prototype.getI18nStringFormatted = function(key, ...args) {
  var self = this;
  var str = self.getI18nString(key);
  
  // Replace {0}, {1}, etc. with provided arguments
  for (var i = 0; i < args.length; i++) {
    str = str.replace('{' + i + '}', args[i]);
  }
  
  return str;
};

// Alias for convenience
ControllerRtlsdrRadio.prototype.formatString = function(str, ...args) {
  // Replace {0}, {1}, etc. with provided arguments
  for (var i = 0; i < args.length; i++) {
    str = str.replace('{' + i + '}', args[i]);
  }
  
  return str;
};

ControllerRtlsdrRadio.prototype.formatElapsedTime = function(seconds) {
  // Format elapsed time as "Xm Ys" or "Xs"
  if (seconds < 60) {
    return seconds + 's';
  }
  var minutes = Math.floor(seconds / 60);
  var remainingSeconds = seconds % 60;
  return minutes + 'm ' + remainingSeconds + 's';
};

ControllerRtlsdrRadio.prototype.getConfigurationFiles = function() {
  return ['config.json'];
};

ControllerRtlsdrRadio.prototype.getUIConfig = function() {
  var self = this;
  var defer = libQ.defer();
  
  var lang_code = self.commandRouter.sharedVars.get('language_code') || 'en';
  
  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
  .then(function(uiconf) {
    // Populate dynamic values into the translated UI config
    self.populateUIConfig(uiconf);
    defer.resolve(uiconf);
  })
  .fail(function(e) {
    self.logger.error('[RTL-SDR Radio] Failed to load UI config: ' + e);
    defer.reject(e);
  });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.populateUIConfig = function(uiconf) {
  var self = this;
  
  // Helper function to find content item by id in a section
  var findContentItem = function(section, itemId) {
    if (!section.content) return null;
    for (var i = 0; i < section.content.length; i++) {
      if (section.content[i].id === itemId) {
        return section.content[i];
      }
    }
    return null;
  };
  
  // SECTION 1: WEB STATION MANAGEMENT
  // ==================================
  var webManagementSection = uiconf.sections[0];
  if (webManagementSection) {
    var showWebMgmt = findContentItem(webManagementSection, 'show_web_management');
    if (showWebMgmt) {
      showWebMgmt.value = self.config.get('show_web_management', true);
    }
    
    var managementUrl = self.getManagementUrl();
    
    var openCurrentBtn = findContentItem(webManagementSection, 'open_current_button');
    if (openCurrentBtn && openCurrentBtn.onClick) {
      // Web manager fetches language from /api/language, no URL parameter needed
      openCurrentBtn.onClick.url = '/iframe-page/' + managementUrl.replace(/\//g, '~2F');
    }
    
    var openTabBtn = findContentItem(webManagementSection, 'open_tab_button');
    if (openTabBtn && openTabBtn.onClick) {
      openTabBtn.onClick.url = managementUrl;
    }
  }
  
  // SECTION 2: WEB STATION MANAGEMENT CONFIGURATION
  // ================================================
  var managementConfigSection = uiconf.sections[1];
  if (managementConfigSection) {
    var showMgmtConfig = findContentItem(managementConfigSection, 'show_management_config');
    if (showMgmtConfig) {
      showMgmtConfig.value = self.config.get('show_management_config', false);
    }
    
    var hostnameOverride = findContentItem(managementConfigSection, 'hostname_override');
    if (hostnameOverride) {
      hostnameOverride.value = self.config.get('hostname_override', '');
    }
  }
  
  // SECTION 3: FM REGION
  // ====================
  var fmRegionSection = uiconf.sections[2];
  if (fmRegionSection) {
    var showFmRegion = findContentItem(fmRegionSection, 'show_fm_region');
    if (showFmRegion) {
      showFmRegion.value = self.config.get('show_fm_region', false);
    }
    
    var fmRegion = findContentItem(fmRegionSection, 'fm_region');
    if (fmRegion) {
      var regionValue = self.config.get('fm_region', 'europe');
      fmRegion.value = {
        value: regionValue,
        label: self.getFmRegionLabel(regionValue)
      };
    }
    
    var fmScanOffset = findContentItem(fmRegionSection, 'fm_scan_offset');
    if (fmScanOffset) {
      var offsetValue = self.config.get('fm_scan_offset', '0');
      fmScanOffset.value = {
        value: offsetValue,
        label: self.getFmScanOffsetLabel(offsetValue)
      };
    }
    
    var fmLowerFreq = findContentItem(fmRegionSection, 'fm_lower_freq');
    if (fmLowerFreq) {
      var lowerFreqValue = self.config.get('fm_lower_freq', '87.5');
      fmLowerFreq.value = {
        value: lowerFreqValue,
        label: self.getLowerFreqLabel(lowerFreqValue)
      };
    }
    
    var fmUpperFreq = findContentItem(fmRegionSection, 'fm_upper_freq');
    if (fmUpperFreq) {
      var upperFreqValue = self.config.get('fm_upper_freq', '108.0');
      fmUpperFreq.value = {
        value: upperFreqValue,
        label: upperFreqValue + ' MHz'
      };
    }
    
    var fmChannelSpacing = findContentItem(fmRegionSection, 'fm_channel_spacing');
    if (fmChannelSpacing) {
      var spacingValue = self.config.get('fm_channel_spacing', '100k');
      fmChannelSpacing.value = {
        value: spacingValue,
        label: self.getFmChannelSpacingLabel(spacingValue)
      };
    }
    
    var fmDeemphasis = findContentItem(fmRegionSection, 'fm_deemphasis');
    if (fmDeemphasis) {
      fmDeemphasis.value = self.config.get('fm_deemphasis', false);
    }
    
    // Hide override fields when region is not 'custom'
    // These fields only apply when user wants manual control
    var currentRegion = self.config.get('fm_region', 'europe');
    if (currentRegion !== 'custom') {
      // Remove override fields from content array - they're not applicable
      var overrideFields = ['fm_lower_freq', 'fm_upper_freq', 'fm_channel_spacing', 'fm_deemphasis'];
      fmRegionSection.content = fmRegionSection.content.filter(function(item) {
        return overrideFields.indexOf(item.id) === -1;
      });
      // Also remove from saveButton data array
      if (fmRegionSection.saveButton && fmRegionSection.saveButton.data) {
        fmRegionSection.saveButton.data = fmRegionSection.saveButton.data.filter(function(field) {
          return overrideFields.indexOf(field) === -1;
        });
      }
    }
  }
  
  // SECTION 4: FM RADIO SETTINGS
  // ============================
  var fmSection = uiconf.sections[3];
  if (fmSection) {
    var fmEnabled = findContentItem(fmSection, 'fm_enabled');
    if (fmEnabled) {
      fmEnabled.value = self.config.get('fm_enabled', false);
    }
    
    var fmGain = findContentItem(fmSection, 'fm_gain');
    if (fmGain) {
      fmGain.value = self.config.get('fm_gain', 50);
    }
    
    var scanSensitivity = findContentItem(fmSection, 'scan_sensitivity');
    if (scanSensitivity) {
      var sensitivityValue = self.config.get('scan_sensitivity', 8);
      scanSensitivity.value = {
        value: sensitivityValue,
        label: self.getSensitivityLabel(sensitivityValue)
      };
    }
    
    var fmOversampling = findContentItem(fmSection, 'fm_oversampling');
    if (fmOversampling) {
      fmOversampling.value = self.config.get('fm_oversampling', false);
    }
    
    var fmSampleRate = findContentItem(fmSection, 'fm_sample_rate');
    if (fmSampleRate) {
      var sampleRateValue = self.config.get('fm_sample_rate', '171k');
      fmSampleRate.value = {
        value: sampleRateValue,
        label: self.getFmSampleRateLabel(sampleRateValue)
      };
    }
  }
  
  // SECTION 5: DAB/DAB+ RADIO
  // ==========================
  var dabSection = uiconf.sections[4];
  if (dabSection) {
    var dabEnabled = findContentItem(dabSection, 'dab_enabled');
    if (dabEnabled) {
      dabEnabled.value = self.config.get('dab_enabled', false);
    }
    
    var dabGain = findContentItem(dabSection, 'dab_gain');
    if (dabGain) {
      dabGain.value = self.config.get('dab_gain', 80);
    }
    
    var dabPpm = findContentItem(dabSection, 'dab_ppm');
    if (dabPpm) {
      dabPpm.value = self.config.get('dab_ppm', 0);
    }
  }
  
  // SECTION 6: ARTWORK SETTINGS
  // ============================
  var artworkSection = uiconf.sections[5];
  if (artworkSection) {
    var showArtworkSettings = findContentItem(artworkSection, 'show_artwork_settings');
    if (showArtworkSettings) {
      showArtworkSettings.value = self.config.get('show_artwork_settings', false);
    }
    
    var bestEffortArtwork = findContentItem(artworkSection, 'best_effort_artwork');
    if (bestEffortArtwork) {
      bestEffortArtwork.value = self.config.get('best_effort_artwork', true);
    }
    
    var artworkThreshold = findContentItem(artworkSection, 'artwork_threshold');
    if (artworkThreshold) {
      var thresholdValue = self.config.get('artwork_threshold', 60);
      artworkThreshold.value = {
        value: String(thresholdValue),
        label: thresholdValue + '%' + (thresholdValue === 60 ? ' (Default)' : '')
      };
    }
    
    var artworkPersistence = findContentItem(artworkSection, 'artwork_persistence');
    if (artworkPersistence) {
      var persistValue = self.config.get('artwork_persistence', 'artist');
      var persistLabels = {
        'artist': self.getI18nString('ARTWORK_PERSIST_ARTIST') || 'Keep until artist changes',
        'track': self.getI18nString('ARTWORK_PERSIST_TRACK') || 'Keep until track changes',
        'always': self.getI18nString('ARTWORK_PERSIST_ALWAYS') || 'Always refresh'
      };
      artworkPersistence.value = {
        value: persistValue,
        label: persistLabels[persistValue] || persistLabels['artist']
      };
    }
    
    var artworkTtl = findContentItem(artworkSection, 'artwork_ttl');
    if (artworkTtl) {
      var ttlValue = self.config.get('artwork_ttl', 0);
      var ttlLabels = {
        0: self.getI18nString('ARTWORK_TTL_DISABLED') || 'Disabled',
        2: self.getI18nString('ARTWORK_TTL_2MIN') || '2 minutes',
        5: self.getI18nString('ARTWORK_TTL_5MIN') || '5 minutes',
        10: self.getI18nString('ARTWORK_TTL_10MIN') || '10 minutes',
        15: self.getI18nString('ARTWORK_TTL_15MIN') || '15 minutes',
        30: self.getI18nString('ARTWORK_TTL_30MIN') || '30 minutes'
      };
      artworkTtl.value = {
        value: String(ttlValue),
        label: ttlLabels[ttlValue] || ttlLabels[0]
      };
    }
    
    var artworkDebugLogging = findContentItem(artworkSection, 'artwork_debug_logging');
    if (artworkDebugLogging) {
      artworkDebugLogging.value = self.config.get('artwork_debug_logging', false);
    }
  }
  
  // SECTION 7: DIAGNOSTICS
  // =======================
  var diagnosticsSection = uiconf.sections[6];
  if (diagnosticsSection) {
    var showDiagnostics = findContentItem(diagnosticsSection, 'show_diagnostics');
    if (showDiagnostics) {
      showDiagnostics.value = self.config.get('show_diagnostics', false);
    }
    
    var manualFmFreq = findContentItem(diagnosticsSection, 'manual_fm_frequency');
    if (manualFmFreq) {
      manualFmFreq.value = self.config.get('manual_fm_frequency', '94.9');
    }
    
    var manualDabEnsemble = findContentItem(diagnosticsSection, 'manual_dab_ensemble');
    if (manualDabEnsemble) {
      manualDabEnsemble.value = self.config.get('manual_dab_ensemble', '12B');
    }
    
    var manualDabService = findContentItem(diagnosticsSection, 'manual_dab_service');
    if (manualDabService) {
      manualDabService.value = self.config.get('manual_dab_service', 'BBC Radio1');
    }
    
    var manualDabGain = findContentItem(diagnosticsSection, 'manual_dab_gain');
    if (manualDabGain) {
      manualDabGain.value = self.config.get('manual_dab_gain', 20);
    }
    
    var manualDabPpm = findContentItem(diagnosticsSection, 'manual_dab_ppm');
    if (manualDabPpm) {
      manualDabPpm.value = self.config.get('manual_dab_ppm', 0);
    }
  }
};

ControllerRtlsdrRadio.prototype.getSensitivityLabel = function(value) {
  var labels = {
    15: 'Conservative (+15 dB) - Very strong signals only',
    10: 'Moderate (+10 dB) - Strong signals',
    8: 'Balanced (+8 dB) - Good signals (recommended)',
    5: 'Sensitive (+5 dB) - All reasonable signals',
    3: 'Very Sensitive (+3 dB) - Weaker signals, may include noise'
  };
  return labels[value] || labels[8];
};

ControllerRtlsdrRadio.prototype.getLowerFreqLabel = function(value) {
  var labels = {
    '76.0': '76.0 MHz (Japan)',
    '87.0': '87.0 MHz (Italy)',
    '87.5': '87.5 MHz (Europe/Default)',
    '88.0': '88.0 MHz (Americas)'
  };
  return labels[value] || '87.5 MHz (Europe/Default)';
};

ControllerRtlsdrRadio.prototype.getFmSampleRateLabel = function(value) {
  var self = this;
  var labels = {
    '171k': self.getI18nString('FM_SAMPLE_RATE_171K') || '171 kHz (RDS Optimal)',
    '200k': self.getI18nString('FM_SAMPLE_RATE_200K') || '200 kHz (Audio Quality)',
    '240k': self.getI18nString('FM_SAMPLE_RATE_240K') || '240 kHz (Audio Quality+)',
    '300k': self.getI18nString('FM_SAMPLE_RATE_300K') || '300 kHz (Best Audio)'
  };
  return labels[value] || '171 kHz (RDS Optimal)';
};

// Get FM region settings - returns effective settings based on region or custom overrides
ControllerRtlsdrRadio.prototype.getRegionSettings = function() {
  var self = this;
  var regionKey = self.config.get('fm_region', 'europe');
  
  // Scan offset applies to all regions (kHz, e.g. 0, 50, 100)
  var scanOffsetKhz = parseInt(self.config.get('fm_scan_offset', '0'), 10) || 0;
  
  if (regionKey === 'custom') {
    // Use manual override settings
    var spacingStr = self.config.get('fm_channel_spacing', '100k');
    var spacingKhz = parseInt(spacingStr.replace('k', ''), 10) || 100;
    return {
      band_start: parseFloat(self.config.get('fm_lower_freq', '87.5')),
      band_end: parseFloat(self.config.get('fm_upper_freq', '108.0')),
      spacing_khz: spacingKhz,
      deemphasis_us: self.config.get('fm_deemphasis', false) ? 50 : 0,
      scan_offset_khz: scanOffsetKhz
    };
  }
  
  // Use preset region settings (copy to avoid mutating cached regionData)
  if (self.regionData && self.regionData.regions && self.regionData.regions[regionKey]) {
    var preset = self.regionData.regions[regionKey];
    return {
      band_start: preset.band_start,
      band_end: preset.band_end,
      spacing_khz: preset.spacing_khz,
      deemphasis_us: preset.deemphasis_us,
      scan_offset_khz: scanOffsetKhz
    };
  }
  
  // Fallback to Europe defaults
  return { band_start: 87.5, band_end: 108.0, spacing_khz: 100, deemphasis_us: 50, scan_offset_khz: scanOffsetKhz };
};

// Get label for FM region
ControllerRtlsdrRadio.prototype.getFmRegionLabel = function(value) {
  var self = this;
  var labels = {
    'europe': self.getI18nString('FM_REGION_EUROPE') || 'Europe (87.5-108 MHz, 100kHz, 50us)',
    'americas': self.getI18nString('FM_REGION_AMERICAS') || 'Americas (88-108 MHz, 200kHz, 75us)',
    'japan': self.getI18nString('FM_REGION_JAPAN') || 'Japan (76-95 MHz, 100kHz, 50us)',
    'east_asia': self.getI18nString('FM_REGION_EAST_ASIA') || 'East Asia (88-108 MHz, 200kHz, 50us)',
    'australia': self.getI18nString('FM_REGION_AUSTRALIA') || 'Australia/Oceania (87.5-108 MHz, 200kHz, 50us)',
    'italy': self.getI18nString('FM_REGION_ITALY') || 'Italy (87-108 MHz, 50kHz, 50us)',
    'oirt': self.getI18nString('FM_REGION_OIRT') || 'OIRT/Russia (65.8-74 MHz, 30kHz, 50us)',
    'custom': self.getI18nString('FM_REGION_CUSTOM') || 'Custom (Manual Settings)'
  };
  return labels[value] || labels['europe'];
};

// Get label for FM channel spacing
ControllerRtlsdrRadio.prototype.getFmChannelSpacingLabel = function(value) {
  var self = this;
  var labels = {
    '30k': self.getI18nString('FM_CHANNEL_SPACING_30K') || '30 kHz (OIRT)',
    '50k': self.getI18nString('FM_CHANNEL_SPACING_50K') || '50 kHz (Italy)',
    '100k': self.getI18nString('FM_CHANNEL_SPACING_100K') || '100 kHz (Europe/Japan)',
    '200k': self.getI18nString('FM_CHANNEL_SPACING_200K') || '200 kHz (Americas/Asia/Australia)'
  };
  return labels[value] || labels['100k'];
};

// Get label for FM scan offset
ControllerRtlsdrRadio.prototype.getFmScanOffsetLabel = function(value) {
  var self = this;
  var labels = {
    '0': self.getI18nString('FM_SCAN_OFFSET_0') || '0 kHz (Default)',
    '50': self.getI18nString('FM_SCAN_OFFSET_50') || '50 kHz',
    '100': self.getI18nString('FM_SCAN_OFFSET_100') || '100 kHz'
  };
  return labels[value] || labels['0'];
};

ControllerRtlsdrRadio.prototype.saveWebManagerSettings = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var needsRestart = false;
    
    // Save show/hide toggle for management config section
    if (data.show_management_config !== undefined) {
      self.config.set('show_management_config', data.show_management_config);
    }
    
    // Save hostname override (if provided)
    if (data.hostname_override !== undefined) {
      self.config.set('hostname_override', data.hostname_override);
    }
    
    // Save menu item enable state (Option 3)
    // DISABLED: Awaiting Volumio core support for dynamic menu items
    /*
    if (data.enable_menu_item !== undefined) {
      var oldValue = self.config.get('manager_menu_item_enabled', false);
      var newValue = data.enable_menu_item;
      
      self.config.set('manager_menu_item_enabled', newValue);
      
      if (oldValue !== newValue) {
        needsRestart = true;
        if (newValue) {
          self.pushManagerMenuItem();
        } else {
          self.removeManagerMenuItem();
        }
      }
    }
    */
    
    if (needsRestart) {
      self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
        self.getI18nString('TOAST_RESTART_REQUIRED'));
    } else {
      self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
        self.getI18nString('SAVE_SUCCESS'));
    }
    
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save web manager settings: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

// Save FM Region settings - handles region selection and custom override fields
ControllerRtlsdrRadio.prototype.saveFmRegion = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Save show_fm_region toggle
    if (data.show_fm_region !== undefined) {
      self.config.set('show_fm_region', data.show_fm_region);
    }
    
    // Save FM region
    var regionValue = null;
    if (data.fm_region !== undefined) {
      regionValue = data.fm_region.value || data.fm_region;
      var validRegions = ['europe', 'americas', 'japan', 'east_asia', 'australia', 'italy', 'oirt', 'custom'];
      if (validRegions.indexOf(regionValue) !== -1) {
        self.config.set('fm_region', regionValue);
      }
    }
    
    // Save FM scan offset (applies to all regions)
    if (data.fm_scan_offset !== undefined) {
      var offsetValue = data.fm_scan_offset.value || data.fm_scan_offset;
      var validOffsets = ['0', '50', '100'];
      if (validOffsets.indexOf(offsetValue) !== -1) {
        self.config.set('fm_scan_offset', offsetValue);
      }
    }
    
    // Save custom override fields (only if region is custom)
    if (regionValue === 'custom') {
      // Save FM lower frequency
      if (data.fm_lower_freq !== undefined) {
        var lowerFreqValue = data.fm_lower_freq.value || data.fm_lower_freq;
        var validValues = ['76.0', '87.0', '87.5', '88.0'];
        if (validValues.indexOf(lowerFreqValue) !== -1) {
          self.config.set('fm_lower_freq', lowerFreqValue);
        }
      }
      
      // Save FM upper frequency
      if (data.fm_upper_freq !== undefined) {
        var upperFreqValue = data.fm_upper_freq.value || data.fm_upper_freq;
        var validUpperValues = ['74.0', '95.0', '108.0'];
        if (validUpperValues.indexOf(upperFreqValue) !== -1) {
          self.config.set('fm_upper_freq', upperFreqValue);
        }
      }
      
      // Save FM channel spacing
      if (data.fm_channel_spacing !== undefined) {
        var spacingValue = data.fm_channel_spacing.value || data.fm_channel_spacing;
        var validSpacings = ['30k', '50k', '100k', '200k'];
        if (validSpacings.indexOf(spacingValue) !== -1) {
          self.config.set('fm_channel_spacing', spacingValue);
        }
      }
      
      // Save FM de-emphasis
      if (data.fm_deemphasis !== undefined) {
        self.config.set('fm_deemphasis', data.fm_deemphasis);
      }
    }
    
    // Show modal prompting user to refresh page
    var regionLabel = self.getFmRegionLabel(regionValue || self.config.get('fm_region', 'europe'));
    var modalData = {
      title: self.getI18nString('FM_REGION') || 'FM Region',
      message: (self.getI18nString('FM_REGION_SAVED') || 'Region saved') + ': ' + regionLabel + '. ' + 
               (self.getI18nString('FM_REGION_REFRESH_PROMPT') || 'Please refresh the page to see updated fields.'),
      size: 'md',
      buttons: [
        {
          name: self.getI18nString('COMMON_OK') || 'OK',
          class: 'btn btn-info',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };
    
    self.commandRouter.broadcastMessage('openModal', modalData);
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] saveFmRegion error: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.saveFmSettings = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Save FM enabled state
    if (data.fm_enabled !== undefined) {
      self.config.set('fm_enabled', data.fm_enabled);
    }
    
    // Save FM gain
    if (data.fm_gain !== undefined) {
      var fmGain = parseInt(data.fm_gain);
      if (!isNaN(fmGain) && fmGain >= 0 && fmGain <= 100) {
        self.config.set('fm_gain', fmGain);
      }
    }
    
    // Save scan sensitivity
    if (data.scan_sensitivity !== undefined) {
      var sensitivityValue = data.scan_sensitivity.value || data.scan_sensitivity;
      var sensitivity = parseInt(sensitivityValue);
      if (!isNaN(sensitivity)) {
        self.config.set('scan_sensitivity', sensitivity);
      }
    }
    
    // Save FM oversampling
    if (data.fm_oversampling !== undefined) {
      self.config.set('fm_oversampling', data.fm_oversampling);
    }
    
    // Save FM sample rate
    if (data.fm_sample_rate !== undefined) {
      var sampleRateValue = data.fm_sample_rate.value || data.fm_sample_rate;
      var validRates = ['171k', '200k', '240k', '300k'];
      if (validRates.indexOf(sampleRateValue) !== -1) {
        self.config.set('fm_sample_rate', sampleRateValue);
      }
    }
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
      self.getI18nString('SAVE_SUCCESS'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save FM settings: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.saveDabSettings = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Save DAB enabled state
    if (data.dab_enabled !== undefined) {
      self.config.set('dab_enabled', data.dab_enabled);
    }
    
    // Save DAB gain
    if (data.dab_gain !== undefined) {
      var dabGain = parseInt(data.dab_gain);
      if (!isNaN(dabGain) && dabGain >= 0 && dabGain <= 100) {
        self.config.set('dab_gain', dabGain);
      }
    }
    
    // Save DAB PPM correction
    if (data.dab_ppm !== undefined) {
      var dabPpm = parseInt(data.dab_ppm);
      if (!isNaN(dabPpm) && dabPpm >= -200 && dabPpm <= 200) {
        self.config.set('dab_ppm', dabPpm);
      }
    }
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
      self.getI18nString('SAVE_SUCCESS'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save DAB settings: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.saveWebManagementToggle = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Save show/hide toggle
    if (data.show_web_management !== undefined) {
      self.config.set('show_web_management', data.show_web_management);
    }
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
      self.getI18nString('SAVE_SUCCESS'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save web management toggle: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.saveArtworkSettings = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    if (data.show_artwork_settings !== undefined) {
      self.config.set('show_artwork_settings', data.show_artwork_settings);
    }
    if (data.best_effort_artwork !== undefined) {
      self.config.set('best_effort_artwork', data.best_effort_artwork);
    }
    if (data.artwork_threshold !== undefined) {
      var threshold = data.artwork_threshold.value || data.artwork_threshold;
      self.config.set('artwork_threshold', parseInt(threshold, 10));
    }
    if (data.artwork_persistence !== undefined) {
      var persistence = data.artwork_persistence.value || data.artwork_persistence;
      self.config.set('artwork_persistence', persistence);
    }
    if (data.artwork_ttl !== undefined) {
      var ttl = data.artwork_ttl.value || data.artwork_ttl;
      self.config.set('artwork_ttl', parseInt(ttl, 10));
    }
    if (data.artwork_debug_logging !== undefined) {
      self.config.set('artwork_debug_logging', data.artwork_debug_logging);
      metadata.setDebugLogging(data.artwork_debug_logging);
    }
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
      self.getI18nString('SAVE_SUCCESS'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save artwork settings: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.saveDiagnosticsSettings = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Save show/hide toggle
    if (data.show_diagnostics !== undefined) {
      self.config.set('show_diagnostics', data.show_diagnostics);
    }
    
    // Save manual test values for next time
    if (data.manual_fm_frequency !== undefined) {
      self.config.set('manual_fm_frequency', data.manual_fm_frequency);
    }
    if (data.manual_dab_ensemble !== undefined) {
      self.config.set('manual_dab_ensemble', data.manual_dab_ensemble);
    }
    if (data.manual_dab_service !== undefined) {
      self.config.set('manual_dab_service', data.manual_dab_service);
    }
    if (data.manual_dab_gain !== undefined) {
      self.config.set('manual_dab_gain', data.manual_dab_gain);
    }
    if (data.manual_dab_ppm !== undefined) {
      self.config.set('manual_dab_ppm', data.manual_dab_ppm);
    }
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
      self.getI18nString('SAVE_SUCCESS'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save diagnostics settings: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('SAVE_ERROR'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.addToBrowseSources = function() {
  var self = this;
  
  var data = {
    name: 'FM/DAB Radio',
    uri: 'rtlsdr',
    plugin_type: 'music_service',
    plugin_name: 'rtlsdr_radio',
    albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/radio.svg'
  };
  
  self.commandRouter.volumioAddToBrowseSources(data);
};

// The antenna tools take the tuner for themselves: what this plugin was playing is
// stopped, and the tool gets a job of its own. Resolves with the job.
ControllerRtlsdrRadio.prototype.acquireForTool = function(name, options) {
  var self = this;
  var wasPlaying = self.deviceState.indexOf('playing_') === 0;
  
  // Our own playback is stopped through Volumio, so that the player shows it as
  // stopped; another service's playback is left alone
  if (wasPlaying) {
    self.commandRouter.stateMachine.stop();
  }
  self.stopDecoder();
  self.setDeviceState('idle');
  
  return self.tuner.acquire(name, options);
};

// A list of DAB channels as sent by a client: each one of the channels there are,
// in capitals, or null when the list is not usable.
ControllerRtlsdrRadio.prototype.dabChannelList = function(channels) {
  var self = this;
  if (!Array.isArray(channels) || channels.length === 0 || channels.length > self.DAB_CHANNELS.length) {
    return null;
  }
  var list = [];
  for (var i = 0; i < channels.length; i++) {
    var channel = String(channels[i]).toUpperCase();
    if (self.DAB_CHANNELS.indexOf(channel) === -1) {
      return null;
    }
    list.push(channel);
  }
  return list;
};

// ========== DEVICE STATE MANAGEMENT ==========

ControllerRtlsdrRadio.prototype.checkDeviceAvailable = function(requestedOperation, operationData) {
  var self = this;
  
  if (self.deviceState === 'idle') {
    return libQ.resolve(true);
  }
  
  // One station replacing another needs no question: the tuner changes over
  if (requestedOperation.indexOf('play_') === 0 && self.deviceState.indexOf('playing_') === 0) {
    return libQ.resolve(true);
  }
  
  // Device is busy - show modal and handle user choice
  var defer = libQ.defer();
  
  var stateKeys = {
    'scanning_fm': 'DEVICE_STATE_SCANNING_FM',
    'scanning_dab': 'DEVICE_STATE_SCANNING_DAB',
    'playing_fm': 'DEVICE_STATE_PLAYING_FM',
    'playing_dab': 'DEVICE_STATE_PLAYING_DAB'
  };
  
  var currentActivity = self.getI18nString(stateKeys[self.deviceState] || 'DEVICE_STATE_SCANNING_FM');
  
  self.logger.info('[RTL-SDR Radio] Device conflict: currently ' + currentActivity + ', requested: ' + requestedOperation);
  
  // Store the pending operation internally (cannot pass defer through modal)
  if (!self.pendingOperations) {
    self.pendingOperations = {};
  }
  
  self.pendingOperations[requestedOperation] = {
    type: requestedOperation,
    data: operationData,
    timestamp: Date.now(),
    defer: defer
  };
  
  // Show modal to user (pass only operation type, not defer object)
  self.showDeviceConflictModal(currentActivity, requestedOperation);
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.showDeviceConflictModal = function(currentActivity, requestedOperation) {
  var self = this;
  
  // Get translated operation name
  var operationKeys = {
    'scan_fm': 'OPERATION_SCAN_FM',
    'scan_dab': 'OPERATION_SCAN_DAB',
    'play_fm': 'OPERATION_PLAY_FM',
    'play_dab': 'OPERATION_PLAY_DAB'
  };
  
  var requestedName = self.getI18nString(operationKeys[requestedOperation] || 'OPERATION_SCAN_FM');
  
  // Capitalize first letter for button
  var capitalizedOperation = requestedName.charAt(0).toUpperCase() + requestedName.slice(1);
  
  var modalData = {
    title: self.getI18nString('DEVICE_BUSY_TITLE'),
    message: self.getI18nStringFormatted('DEVICE_BUSY_MESSAGE', currentActivity),
    size: 'md',
    buttons: [
      {
        name: self.getI18nStringFormatted('MODAL_BTN_CANCEL_AND', capitalizedOperation),
        class: 'btn btn-warning',
        emit: 'callMethod',
        payload: {
          endpoint: 'music_service/rtlsdr_radio',
          method: 'handleDeviceConflict',
          data: {
            action: 'cancel',
            operationType: requestedOperation
          }
        }
      },
      {
        name: self.getI18nString('MODAL_BTN_QUEUE'),
        class: 'btn btn-info',
        emit: 'callMethod',
        payload: {
          endpoint: 'music_service/rtlsdr_radio',
          method: 'handleDeviceConflict',
          data: {
            action: 'queue',
            operationType: requestedOperation
          }
        }
      },
      {
        name: self.getI18nString('MODAL_BTN_CANCEL_REQUEST'),
        class: 'btn btn-default',
        emit: 'callMethod',
        payload: {
          endpoint: 'music_service/rtlsdr_radio',
          method: 'handleDeviceConflict',
          data: {
            action: 'reject',
            operationType: requestedOperation
          }
        }
      }
    ]
  };
  
  self.commandRouter.broadcastMessage('openModal', modalData);
};

ControllerRtlsdrRadio.prototype.handleDeviceConflict = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  var action = data.action;
  var operationType = data.operationType;
  
  // Look up the pending operation
  var operation = self.pendingOperations[operationType];
  
  if (!operation) {
    self.logger.error('[RTL-SDR Radio] No pending operation found for type: ' + operationType);
    defer.reject(new Error('No pending operation found'));
    return defer.promise;
  }
  
  self.logger.info('[RTL-SDR Radio] Device conflict resolution: ' + action + ' for ' + operationType);
  
  if (action === 'cancel') {
    // User explicitly chose to cancel - clear queue to prevent old operations from executing
    self.operationQueue = [];
    self.logger.info('[RTL-SDR Radio] Queue cleared due to explicit cancel');
    
    // Inform user that we're stopping the current operation
    self.commandRouter.pushToastMessage(
      'info',
      self.getI18nString('PLUGIN_NAME'),
      self.getI18nString('TOAST_STOPPING_OPERATION')
    );
    
    // Cancel current operation and proceed with new one
    self.stopCurrentOperation()
      .then(function() {
        // The current operation's processes are gone; the tuner gives the dongle
        // its moment before the next one starts
        operation.defer.resolve(true);
        delete self.pendingOperations[operationType];
        defer.resolve();
      })
      .fail(function(e) {
        operation.defer.reject(e);
        delete self.pendingOperations[operationType];
        defer.reject(e);
      });
  } else if (action === 'queue') {
    // Add to queue
    self.operationQueue.push(operation);
    // Remove from pending operations (now in queue)
    delete self.pendingOperations[operationType];
    self.logger.info('[RTL-SDR Radio] Operation queued: ' + operation.type);
    
    self.commandRouter.pushToastMessage(
      'info',
      self.getI18nString('TOAST_OPERATION_QUEUED'),
      self.getI18nString('TOAST_OPERATION_QUEUED_MSG')
    );
    defer.resolve();
  } else {
    // Reject request
    operation.defer.reject(new Error('User cancelled operation'));
    delete self.pendingOperations[operationType];
    defer.resolve();
  }
  
  // Close modal
  self.commandRouter.broadcastMessage('closeAllModals', '');
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.stopCurrentOperation = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Stopping current operation: ' + self.deviceState);
  
  if (self.deviceState.startsWith('playing_')) {
    // Stop playback, through Volumio so that the player's state follows
    self.commandRouter.stateMachine.stop();
    self.stop()
      .then(function() {
        self.setDeviceState('idle');
        defer.resolve();
      })
      .fail(function(e) {
        defer.reject(e);
      });
  } else if (self.deviceState.startsWith('scanning_')) {
    // Stop the scan and wait for it to let the dongle go
    self.stopDecoder().then(function() {
      self.setDeviceState('idle');
      defer.resolve();
    });
  } else {
    // Already idle
    defer.resolve();
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.setDeviceState = function(newState) {
  var self = this;
  
  var oldState = self.deviceState;
  self.deviceState = newState;
  
  self.logger.info('[RTL-SDR Radio] Device state: ' + oldState + ' -> ' + newState);
  
  // If device became idle, process queue
  if (newState === 'idle' && self.operationQueue.length > 0) {
    self.processOperationQueue();
  }
};

ControllerRtlsdrRadio.prototype.processOperationQueue = function() {
  var self = this;
  
  if (self.operationQueue.length === 0) {
    return;
  }
  
  // Remove expired operations
  var now = Date.now();
  self.operationQueue = self.operationQueue.filter(function(op) {
    var isExpired = (now - op.timestamp) > self.QUEUE_TIMEOUT;
    if (isExpired) {
      self.logger.info('[RTL-SDR Radio] Operation expired: ' + op.type);
      op.defer.reject(new Error('Operation timed out in queue'));
    }
    return !isExpired;
  });
  
  if (self.operationQueue.length === 0) {
    return;
  }
  
  // Process first operation (FIFO)
  var nextOp = self.operationQueue.shift();
  
  self.logger.info('[RTL-SDR Radio] Processing queued operation: ' + nextOp.type);
  
  self.commandRouter.pushToastMessage(
    'info',
    self.getI18nString('TOAST_STARTING_QUEUED'),
    self.getI18nString('TOAST_DEVICE_AVAILABLE')
  );
  
  // Resolve the defer to allow operation to proceed
  nextOp.defer.resolve(true);
};

ControllerRtlsdrRadio.prototype.handleBrowseUri = function(curUri) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Browse URI: ' + curUri);
  
  // Reload i18n strings if language changed
  var current_lang = self.commandRouter.sharedVars.get('language_code') || 'en';
  if (!self.current_language || self.current_language !== current_lang) {
    self.current_language = current_lang;
    var langFile = __dirname + '/i18n/strings_' + current_lang + '.json';
    var defaultFile = __dirname + '/i18n/strings_en.json';
    
    try {
      self.i18nStrings = fs.readJsonSync(langFile);
      self.logger.info('[RTL-SDR Radio] Reloaded i18n strings for language: ' + current_lang);
    } catch (e) {
      self.logger.warn('[RTL-SDR Radio] Failed to load ' + current_lang + ' translations, using English');
      self.i18nStrings = fs.readJsonSync(defaultFile);
    }
  }
  
  // Handle rescan triggers (legacy compatibility)
  if (curUri === 'rtlsdr://rescan') {
    self.scanFm()
      .then(function() {
        return self.handleBrowseUri('rtlsdr');
      })
      .then(function(response) {
        defer.resolve(response);
      })
      .fail(function(e) {
        if (!self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] Rescan failed: ' + e);
          defer.reject(e);
        } else {
          self.handleBrowseUri('rtlsdr')
            .then(function(response) {
              defer.resolve(response);
            })
            .fail(function(err) {
              defer.reject(err);
            });
        }
      });
    return defer.promise;
  }
  
  if (curUri === 'rtlsdr://rescan-dab') {
    self.scanDab()
      .then(function() {
        return self.handleBrowseUri('rtlsdr');
      })
      .then(function(response) {
        defer.resolve(response);
      })
      .fail(function(e) {
        if (!self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] DAB rescan failed: ' + e);
          defer.reject(e);
        } else {
          self.handleBrowseUri('rtlsdr')
            .then(function(response) {
              defer.resolve(response);
            })
            .fail(function(err) {
              defer.reject(err);
            });
        }
      });
    return defer.promise;
  }
  
  // Route to appropriate view
  if (curUri === 'rtlsdr' || curUri === 'rtlsdr://') {
    defer.resolve(self.showMainOrganizedView());
  } else if (curUri === 'rtlsdr://favorites') {
    defer.resolve(self.showFavoritesView());
  } else if (curUri === 'rtlsdr://recent') {
    defer.resolve(self.showRecentView());
  } else if (curUri === 'rtlsdr://fm') {
    defer.resolve(self.showFmView());
  } else if (curUri === 'rtlsdr://dab') {
    defer.resolve(self.showDabByEnsembleView());
  } else if (curUri.indexOf('rtlsdr://dab/ensemble/') === 0) {
    var ensembleName = decodeURIComponent(curUri.replace('rtlsdr://dab/ensemble/', ''));
    defer.resolve(self.showDabEnsembleStations(ensembleName));
  } else if (curUri === 'rtlsdr://dab?view=flat') {
    defer.resolve(self.showDabFlatView());
  } else if (curUri === 'rtlsdr://deleted') {
    defer.resolve(self.showDeletedView());
  } else if (curUri === 'rtlsdr://deleted/fm') {
    defer.resolve(self.showDeletedFmView());
  } else if (curUri === 'rtlsdr://deleted/dab') {
    defer.resolve(self.showDeletedDabView());
  } else if (curUri === 'rtlsdr://hidden') {
    defer.resolve(self.showHiddenView());
  } else if (curUri === 'rtlsdr://purge-all-deleted') {
    self.purgeDeletedStations()
      .then(function() {
        return self.handleBrowseUri('rtlsdr://deleted');
      })
      .then(function(response) {
        defer.resolve(response);
      })
      .fail(function(e) {
        self.logger.error('[RTL-SDR Radio] Purge failed: ' + e);
        defer.resolve(self.showDeletedView());
      });
    return defer.promise;
  } else {
    // Unknown URI
    self.logger.warn('[RTL-SDR Radio] Unknown URI: ' + curUri);
    defer.resolve(self.showMainOrganizedView());
  }
  
  return defer.promise;
};

// ========== HIERARCHICAL BROWSE VIEW FUNCTIONS ==========

ControllerRtlsdrRadio.prototype.showMainOrganizedView = function() {
  var self = this;
  
  var favorites = self.getFavoriteStations();
  var recent = self.getRecentStations();
  
  // Count visible stations
  var fmCount = 0;
  var dabCount = 0;
  var deletedCount = 0;
  var hiddenCount = 0;
  
  if (self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (station.deleted) {
        deletedCount++;
      } else if (station.hidden) {
        hiddenCount++;
      } else {
        fmCount++;
      }
    });
  }
  
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (station.deleted) {
        deletedCount++;
      } else if (station.hidden) {
        hiddenCount++;
      } else {
        dabCount++;
      }
    });
  }
  
  var lists = [];
  
  // Quick Access section
  var quickAccessItems = [];
  
  if (favorites.length > 0) {
    quickAccessItems.push({
      service: 'rtlsdr_radio',
      type: 'folder',
      title: self.getI18nString('FAVORITES'),
      artist: favorites.length + ' ' + self.getI18nString(favorites.length !== 1 ? 'STATIONS' : 'STATION'),
      album: '',
      icon: 'fa fa-star',
      uri: 'rtlsdr://favorites'
    });
  }
  
  if (recent.length > 0) {
    quickAccessItems.push({
      service: 'rtlsdr_radio',
      type: 'folder',
      title: self.getI18nString('BROWSE_RECENTLY_PLAYED'),
      artist: recent.length + ' ' + self.getI18nString(recent.length !== 1 ? 'STATIONS' : 'STATION'),
      album: '',
      icon: 'fa fa-history',
      uri: 'rtlsdr://recent'
    });
  }
  
  if (quickAccessItems.length > 0) {
    lists.push({
      title: self.getI18nString('BROWSE_QUICK_ACCESS'),
      icon: 'fa fa-bolt',
      availableListViews: ['list', 'grid'],
      items: quickAccessItems
    });
  }
  
  // Radio Sources section
  var radioSourcesItems = [];
  
  radioSourcesItems.push({
    service: 'rtlsdr_radio',
    type: 'folder',
    title: self.getI18nString('FM_RADIO'),
    artist: fmCount + ' ' + self.getI18nString(fmCount !== 1 ? 'STATIONS' : 'STATION'),
    album: '',
    icon: 'fa fa-signal',
    uri: 'rtlsdr://fm'
  });
  
  radioSourcesItems.push({
    service: 'rtlsdr_radio',
    type: 'folder',
    title: self.getI18nString('DAB_RADIO'),
    artist: dabCount + ' ' + self.getI18nString(dabCount !== 1 ? 'SERVICES' : 'SERVICE'),
    album: '',
    icon: 'fa fa-rss',
    uri: 'rtlsdr://dab'
  });
  
  lists.push({
    title: self.getI18nString('BROWSE_RADIO_SOURCES'),
    icon: 'fa fa-radio',
    availableListViews: ['list'],
    items: radioSourcesItems
  });
  
  // Management section
  if (deletedCount > 0 || hiddenCount > 0) {
    var managementItems = [];
    
    if (deletedCount > 0) {
      managementItems.push({
        service: 'rtlsdr_radio',
        type: 'folder',
        title: self.getI18nString('BROWSE_DELETED_STATIONS'),
        artist: deletedCount + ' ' + self.getI18nString(deletedCount !== 1 ? 'STATIONS' : 'STATION'),
        album: '',
        icon: 'fa fa-trash',
        uri: 'rtlsdr://deleted'
      });
    }
    
    if (hiddenCount > 0) {
      managementItems.push({
        service: 'rtlsdr_radio',
        type: 'folder',
        title: self.getI18nString('BROWSE_HIDDEN_STATIONS'),
        artist: hiddenCount + ' ' + self.getI18nString(hiddenCount !== 1 ? 'STATIONS' : 'STATION'),
        album: '',
        icon: 'fa fa-eye-slash',
        uri: 'rtlsdr://hidden'
      });
    }
    
    lists.push({
      title: self.getI18nString('BROWSE_MANAGEMENT'),
      icon: 'fa fa-cog',
      availableListViews: ['list'],
      items: managementItems
    });
  }
  
  return {
    navigation: {
      lists: lists
    }
  };
};

// ========== CONTEXT MENU HELPER ==========

ControllerRtlsdrRadio.prototype.getStationContextMenu = function(uri, stationType, isDeleted, isHidden) {
  var self = this;
  var menu = [];
  
  if (isDeleted) {
    // Deleted stations: Restore or Purge
    menu.push({
      name: 'Restore Station',
      method: 'callMethod',
      data: {
        endpoint: 'music_service/rtlsdr_radio',
        method: 'restoreStation',
        data: { uri: uri }
      }
    });
    menu.push({
      name: 'Purge Station Permanently',
      method: 'callMethod',
      data: {
        endpoint: 'music_service/rtlsdr_radio',
        method: 'purgeStation',
        data: { uri: uri }
      }
    });
  } else {
    // Regular stations: No context menu (use web manager for all editing)
    // Leave menu empty - context menu won't appear
  }
  
  return menu;
};

ControllerRtlsdrRadio.prototype.showFavoritesView = function() {
  var self = this;
  
  var favorites = self.getFavoriteStations();
  var items = [];
  
  favorites.forEach(function(fav) {
    if (fav.type === 'fm') {
      var uri = 'rtlsdr://fm/' + fav.station.frequency;
      items.push({
        service: 'rtlsdr_radio',
        type: 'song',
        title: fav.station.customName || fav.station.name,
        artist: fav.station.frequency + ' MHz',
        album: self.getI18nString('FAVORITES'),
        albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
        icon: 'fa fa-star',
        uri: uri,
        menu: self.getStationContextMenu(uri, 'fm', false, fav.station.hidden || false)
      });
    } else if (fav.type === 'dab') {
      var uri = 'rtlsdr://dab/' + fav.station.channel + '/' + encodeURIComponent(fav.station.exactName);
      items.push({
        service: 'rtlsdr_radio',
        type: 'webradio',
        title: fav.station.customName || fav.station.name,
        artist: fav.station.ensemble,
        album: self.getI18nString('FAVORITES'),
        albumart: '/albumart?sourceicon=' + self.dabIcon(fav.station),
        icon: 'fa fa-star',
        uri: uri,
        menu: self.getStationContextMenu(uri, 'dab', false, fav.station.hidden || false)
      });
    }
  });
  
  if (items.length === 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_FAVORITES'),
      artist: self.getI18nString('BROWSE_NO_FAVORITES_DESC'),
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://' },
      lists: [{
        title: self.formatString(self.getI18nString('BROWSE_FAVORITES_COUNT'), favorites.length),
        icon: 'fa fa-star',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showRecentView = function() {
  var self = this;
  
  var recent = self.getRecentStations();
  var items = [];
  
  recent.forEach(function(rec) {
    if (rec.type === 'fm') {
      var uri = 'rtlsdr://fm/' + rec.station.frequency;
      items.push({
        service: 'rtlsdr_radio',
        type: 'song',
        title: rec.station.customName || rec.station.name,
        artist: rec.station.frequency + ' MHz',
        album: self.getI18nString('RECENTLY_PLAYED'),
        albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
        uri: uri,
        menu: self.getStationContextMenu(uri, 'fm', false, rec.station.hidden || false)
      });
    } else if (rec.type === 'dab') {
      var uri = 'rtlsdr://dab/' + rec.station.channel + '/' + encodeURIComponent(rec.station.exactName);
      items.push({
        service: 'rtlsdr_radio',
        type: 'webradio',
        title: rec.station.customName || rec.station.name,
        artist: rec.station.ensemble,
        album: self.getI18nString('RECENTLY_PLAYED'),
        albumart: '/albumart?sourceicon=' + self.dabIcon(rec.station),
        uri: uri,
        menu: self.getStationContextMenu(uri, 'dab', false, rec.station.hidden || false)
      });
    }
  });
  
  if (items.length === 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_RECENT'),
      artist: self.getI18nString('BROWSE_NO_RECENT_DESC'),
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://' },
      lists: [{
        title: self.getI18nString('BROWSE_RECENTLY_PLAYED'),
        icon: 'fa fa-history',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showFmView = function() {
  var self = this;
  
  var items = [];
  
  if (self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (!station.deleted && !station.hidden) {
        var uri = 'rtlsdr://fm/' + station.frequency;
        items.push({
          service: 'rtlsdr_radio',
          type: 'song',
          title: station.customName || station.name,
          artist: station.frequency + ' MHz',
          album: self.getI18nString('FM_RADIO'),
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
          icon: station.favorite ? 'fa fa-star' : '',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'fm', false, false)
        });
      }
    });
  }
  
  if (items.length === 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_FM'),
      artist: self.getI18nString('BROWSE_NO_FM_DESC'),
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  // Add rescan button
  items.push({
    service: 'rtlsdr_radio',
    type: 'streaming-category',
    title: self.getI18nString('BROWSE_RESCAN_FM'),
    artist: self.getI18nString('BROWSE_RESCAN_FM_DESC'),
    album: '',
    icon: 'fa fa-refresh',
    uri: 'rtlsdr://rescan'
  });
  
  // Add information about station management
  items.push({
    service: 'rtlsdr_radio',
    type: 'streaming-category',
    title: self.getI18nString('BROWSE_EDIT_INFO'),
    artist: '',
    album: '',
    icon: 'fa fa-info-circle',
    uri: ''
  });
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://' },
      lists: [{
        title: self.formatString(self.getI18nString('BROWSE_FM_COUNT'), items.length - 1),
        icon: 'fa fa-signal',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showDabByEnsembleView = function() {
  var self = this;
  
  var ensembles = self.getStationsByEnsemble();
  var items = [];
  
  // Create folder for each ensemble
  ensembles.forEach(function(ensemble) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'folder',
      title: ensemble.name,
      artist: ensemble.stations.length + ' ' + self.getI18nString(ensemble.stations.length !== 1 ? 'SERVICES' : 'SERVICE') + 
              ' on Ch ' + ensemble.channel,
      album: 'DAB Ensembles',
      icon: 'fa fa-list',
      uri: 'rtlsdr://dab/ensemble/' + encodeURIComponent(ensemble.name)
    });
  });
  
  if (items.length > 0) {
    // Add flat view option
    items.push({
      service: 'rtlsdr_radio',
      type: 'folder',
      title: self.getI18nString('BROWSE_DAB_FLAT'),
      artist: self.stationsDb.dab.filter(function(s) { return !s.deleted && !s.hidden; }).length + ' services',
      album: '',
      icon: 'fa fa-th-list',
      uri: 'rtlsdr://dab?view=flat'
    });
  } else {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_DAB'),
      artist: self.getI18nString('BROWSE_NO_FM_DESC'),
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  // Add rescan button
  items.push({
    service: 'rtlsdr_radio',
      type: 'streaming-category',
    title: self.getI18nString('BROWSE_RESCAN_DAB'),
    artist: self.getI18nString('BROWSE_RESCAN_DAB_DESC'),
    album: '',
    icon: 'fa fa-refresh',
    uri: 'rtlsdr://rescan-dab'
  });
  
  // Add information about station management
  items.push({
    service: 'rtlsdr_radio',
    type: 'streaming-category',
    title: self.getI18nString('BROWSE_EDIT_INFO'),
    artist: '',
    album: '',
    icon: 'fa fa-info-circle',
    uri: ''
  });
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://' },
      lists: [{
        title: self.getI18nString('DAB_RADIO'),
        icon: 'fa fa-rss',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showDabEnsembleStations = function(ensembleName) {
  var self = this;
  
  var items = [];
  
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (!station.deleted && !station.hidden && station.ensemble === ensembleName) {
        var uri = 'rtlsdr://dab/' + station.channel + '/' + encodeURIComponent(station.exactName);
        items.push({
          service: 'rtlsdr_radio',
          type: 'webradio',
          title: station.customName || station.name,
          artist: station.ensemble,
          album: 'Channel ' + station.channel,
          albumart: '/albumart?sourceicon=' + self.dabIcon(station),
          icon: station.favorite ? 'fa fa-star' : '',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'dab', false, false)
        });
      }
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://dab' },
      lists: [{
        title: ensembleName + ' (' + self.formatString(self.getI18nString('BROWSE_DAB_SERVICES_COUNT'), items.length) + ')',
        icon: 'fa fa-list',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showDabFlatView = function() {
  var self = this;
  
  var items = [];
  
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (!station.deleted && !station.hidden) {
        var uri = 'rtlsdr://dab/' + station.channel + '/' + encodeURIComponent(station.exactName);
        items.push({
          service: 'rtlsdr_radio',
          type: 'webradio',
          title: station.customName || station.name,
          artist: station.ensemble,
          album: 'Channel ' + station.channel,
          albumart: '/albumart?sourceicon=' + self.dabIcon(station),
          icon: station.favorite ? 'fa fa-star' : '',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'dab', false, false)
        });
      }
    });
  }
  
  if (items.length === 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_DAB'),
      artist: self.getI18nString('BROWSE_NO_FM_DESC'),
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  // Add rescan button
  items.push({
    service: 'rtlsdr_radio',
    type: 'streaming-category',
    title: self.getI18nString('BROWSE_RESCAN_DAB'),
    artist: self.getI18nString('BROWSE_RESCAN_DAB_DESC'),
    album: '',
    icon: 'fa fa-refresh',
    uri: 'rtlsdr://rescan-dab'
  });
  
  // Add information about station management
  items.push({
    service: 'rtlsdr_radio',
    type: 'streaming-category',
    title: self.getI18nString('BROWSE_EDIT_INFO'),
    artist: '',
    album: '',
    icon: 'fa fa-info-circle',
    uri: ''
  });
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://dab' },
      lists: [{
        title: self.getI18nString('BROWSE_DAB_ALL'),
        icon: 'fa fa-th-list',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showDeletedView = function() {
  var self = this;
  
  var fmDeleted = 0;
  var dabDeleted = 0;
  
  if (self.stationsDb.fm) {
    fmDeleted = self.stationsDb.fm.filter(function(s) { return s.deleted; }).length;
  }
  
  if (self.stationsDb.dab) {
    dabDeleted = self.stationsDb.dab.filter(function(s) { return s.deleted; }).length;
  }
  
  var items = [];
  
  if (fmDeleted > 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'folder',
      title: self.getI18nString('BROWSE_FM_DELETED'),
      artist: fmDeleted + ' ' + self.getI18nString(fmDeleted !== 1 ? 'STATIONS' : 'STATION'),
      album: '',
      icon: 'fa fa-signal',
      uri: 'rtlsdr://deleted/fm'
    });
  }
  
  if (dabDeleted > 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'folder',
      title: self.getI18nString('BROWSE_DAB_DELETED'),
      artist: dabDeleted + ' ' + self.getI18nString(dabDeleted !== 1 ? 'SERVICES' : 'SERVICE'),
      album: '',
      icon: 'fa fa-rss',
      uri: 'rtlsdr://deleted/dab'
    });
  }
  
  if (items.length > 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_PURGE_ALL'),
      artist: self.getI18nString('BROWSE_PURGE_ALL_DESC'),
      album: '',
      icon: 'fa fa-trash-o',
      uri: 'rtlsdr://purge-all-deleted'
    });
  } else {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_DELETED'),
      artist: '',
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://' },
      lists: [{
        title: self.formatString(self.getI18nString('BROWSE_DELETED_COUNT'), fmDeleted + dabDeleted),
        icon: 'fa fa-trash',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showDeletedFmView = function() {
  var self = this;
  
  var items = [];
  
  if (self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (station.deleted) {
        var artist = 'Deleted';
        if (station.availableAgain) {
          artist = 'Deleted - Available again in scan';
        }
        
        var uri = 'rtlsdr://fm/' + station.frequency;
        items.push({
          service: 'rtlsdr_radio',
          type: 'song',
          title: station.customName || station.name,
          artist: artist,
          album: 'FM Deleted',
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
          icon: 'fa fa-undo',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'fm', true, false)
        });
      }
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://deleted' },
      lists: [{
        title: self.formatString(self.getI18nString('BROWSE_FM_DELETED_COUNT'), items.length),
        icon: 'fa fa-signal',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showDeletedDabView = function() {
  var self = this;
  
  var items = [];
  
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (station.deleted) {
        var artist = 'Deleted';
        if (station.availableAgain) {
          artist = 'Deleted - Available again in scan';
        }
        
        var uri = 'rtlsdr://dab/' + station.channel + '/' + encodeURIComponent(station.exactName);
        items.push({
          service: 'rtlsdr_radio',
          type: 'webradio',
          title: station.customName || station.name,
          artist: artist,
          album: 'DAB Deleted',
          albumart: '/albumart?sourceicon=' + self.dabIcon(station),
          icon: 'fa fa-undo',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'dab', true, false)
        });
      }
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://deleted' },
      lists: [{
        title: self.formatString(self.getI18nString('BROWSE_DAB_DELETED_COUNT'), items.length),
        icon: 'fa fa-rss',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

ControllerRtlsdrRadio.prototype.showHiddenView = function() {
  var self = this;
  
  var items = [];
  
  if (self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (station.hidden && !station.deleted) {
        var uri = 'rtlsdr://fm/' + station.frequency;
        items.push({
          service: 'rtlsdr_radio',
          type: 'song',
          title: station.customName || station.name,
          artist: station.frequency + ' MHz',
          album: 'FM Hidden',
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
          icon: 'fa fa-eye-slash',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'fm', false, true)
        });
      }
    });
  }
  
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (station.hidden && !station.deleted) {
        var uri = 'rtlsdr://dab/' + station.channel + '/' + encodeURIComponent(station.exactName);
        items.push({
          service: 'rtlsdr_radio',
          type: 'webradio',
          title: station.customName || station.name,
          artist: station.ensemble,
          album: 'DAB Hidden',
          albumart: '/albumart?sourceicon=' + self.dabIcon(station),
          icon: 'fa fa-eye-slash',
          uri: uri,
          menu: self.getStationContextMenu(uri, 'dab', false, true)
        });
      }
    });
  }
  
  if (items.length === 0) {
    items.push({
      service: 'rtlsdr_radio',
      type: 'streaming-category',
      title: self.getI18nString('BROWSE_NO_HIDDEN'),
      artist: '',
      album: '',
      icon: 'fa fa-info-circle',
      uri: ''
    });
  }
  
  return {
    navigation: {
      prev: { uri: 'rtlsdr://' },
      lists: [{
        title: self.formatString(self.getI18nString('BROWSE_HIDDEN_COUNT'), items.length),
        icon: 'fa fa-eye-slash',
        availableListViews: ['list'],
        items: items
      }]
    }
  };
};

// Required by Volumio for favorites/queue system
ControllerRtlsdrRadio.prototype.explodeUri = function(uri) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] explodeUri: ' + uri);
  
  if (!uri || typeof uri !== 'string') {
    defer.resolve([]);
    return defer.promise;
  }
  
  // Parse FM URI: rtlsdr://fm/100.0
  if (uri.indexOf('rtlsdr://fm/') === 0) {
    var frequency = uri.replace('rtlsdr://fm/', '');
    
    // Validate frequency is numeric but preserve original precision
    var freq = parseFloat(frequency);
    if (!isNaN(freq)) {
      // Keep original string if valid, just trim whitespace
      frequency = frequency.trim();
    }
    
    // Look up station in database (compare as numbers to handle precision differences)
    var station = null;
    if (self.stationsDb.fm) {
      station = self.stationsDb.fm.find(function(s) {
        return parseFloat(s.frequency) === freq;
      });
    }
    
    var track = {
      service: 'rtlsdr_radio',
      type: 'song',
      title: station ? (station.customName || station.name) : ('FM ' + frequency),
      artist: frequency + ' MHz',
      album: self.getI18nString('FM_RADIO') || 'FM Radio',
      albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
      uri: 'rtlsdr://fm/' + frequency
    };
    
    defer.resolve([track]);
    return defer.promise;
  }
  
  // Parse DAB URI: rtlsdr://dab/<channel>/<serviceName>
  if (uri.indexOf('rtlsdr://dab/') === 0) {
    var dabParts = uri.replace('rtlsdr://dab/', '').split('/');
    if (dabParts.length >= 2) {
      var channel = dabParts[0];
      var serviceName = decodeURIComponent(dabParts[1]);
      
      // Look up station in database
      var station = null;
      if (self.stationsDb.dab) {
        station = self.stationsDb.dab.find(function(s) {
          return s.channel === channel && s.exactName === serviceName;
        });
      }
      
      var track = {
        service: 'rtlsdr_radio',
        type: 'webradio',
        title: station ? (station.customName || station.name) : serviceName,
        artist: station ? station.ensemble : channel,
        album: self.getI18nString('DAB_RADIO') || 'DAB+ Radio',
        albumart: '/albumart?sourceicon=' + self.dabIcon(station),
        uri: uri
      };
      
      defer.resolve([track]);
      return defer.promise;
    }
  }
  
  // Unknown URI format
  defer.resolve([]);
  return defer.promise;
};

// Sync Volumio favorites with Station Manager
// Called when user clicks heart icon to add to favorites
ControllerRtlsdrRadio.prototype.addToFavourites = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  if (!data || !data.uri) {
    defer.resolve();
    return defer.promise;
  }
  
  // Keep FM URI as-is, preserve original precision
  var uri = data.uri;
  
  // Check if station exists in our database first
  var stationInfo = self.getStationByUri(uri);
  if (!stationInfo) {
    // Station not in our database - that's fine, Volumio favorites still work
    defer.resolve();
    return defer.promise;
  }
  
  // Update station favorite flag in stations.json
  stationInfo.station.favorite = true;
  self.saveStations();
  self.logger.info('[RTL-SDR Radio] Station marked as favorite: ' + uri);
  defer.resolve();
  
  return defer.promise;
};

// Called when user removes from Volumio favorites
ControllerRtlsdrRadio.prototype.removeFromFavourites = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  if (!data || !data.uri) {
    defer.resolve();
    return defer.promise;
  }
  
  // Keep FM URI as-is, preserve original precision
  var uri = data.uri;
  
  // Check if station exists in our database first
  var stationInfo = self.getStationByUri(uri);
  if (!stationInfo) {
    // Station not in our database - that's fine, Volumio favorites still work
    defer.resolve();
    return defer.promise;
  }
  
  // Update station favorite flag in stations.json
  stationInfo.station.favorite = false;
  self.saveStations();
  self.logger.info('[RTL-SDR Radio] Station removed from favorites: ' + uri);
  defer.resolve();
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.clearAddPlayTrack = function(track) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Play track: ' + JSON.stringify(track));
  
  // Volumio calls stop() before clearAddPlayTrack(). Whether it did or not, the tuner
  // frees the dongle before the new station's processes start.
  
  // Parse URI to determine type (FM or DAB)
  if (track.uri && track.uri.indexOf('rtlsdr://fm/') === 0) {
    // FM playback
    var frequency = track.uri.replace('rtlsdr://fm/', '');
    self.playFmStation(frequency, track.name || 'FM ' + frequency)
      .then(function() {
        defer.resolve();
      })
      .fail(function(e) {
        if (e && e.superseded) {
          defer.resolve();
          return;
        }
        self.logger.error('[RTL-SDR Radio] FM playback failed: ' + e);
        self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), self.formatString(self.getI18nString('TOAST_PLAY_FAILED'), e));
        defer.reject(e);
      });
  } else if (track.uri && track.uri.indexOf('rtlsdr://dab/') === 0) {
    // DAB playback - parse URI: rtlsdr://dab/<channel>/<serviceName>
    var dabParts = track.uri.replace('rtlsdr://dab/', '').split('/');
    if (dabParts.length < 2) {
      self.logger.error('[RTL-SDR Radio] Invalid DAB URI: ' + track.uri);
      defer.reject(new Error('Invalid DAB URI'));
      return defer.promise;
    }
    
    var channel = dabParts[0];
    var serviceName = decodeURIComponent(dabParts[1]);
    
    self.playDabStation(channel, serviceName, track.title || serviceName)
      .then(function() {
        defer.resolve();
      })
      .fail(function(e) {
        if (e && e.superseded) {
          defer.resolve();
          return;
        }
        self.logger.error('[RTL-SDR Radio] DAB playback failed: ' + e);
        self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), self.formatString(self.getI18nString('TOAST_PLAY_FAILED'), e));
        defer.reject(e);
      });
  } else {
    self.logger.error('[RTL-SDR Radio] Invalid URI: ' + track.uri);
    defer.reject(new Error('Invalid URI'));
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.playFmStation = function(frequency, stationName) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Playing FM station: ' + frequency + ' MHz');
  
  // Reset artwork state when changing stations
  self.lastValidArtwork = null;
  self.artworkTimestamp = null;
  self.albumLookupCache = {};
  self.lastArtworkLogKey = null;
  
  // Validate frequency (FM band: region lower bound to 108 MHz)
  var freq = parseFloat(frequency);
  var lowerFreq = self.getRegionSettings().band_start;
  if (isNaN(freq) || freq < lowerFreq || freq > 108) {
    self.logger.error('[RTL-SDR Radio] Invalid FM frequency: ' + frequency);
    defer.reject(new Error('Invalid frequency'));
    return defer.promise;
  }
  
  // Check if station is deleted
  var station = self.stationsDb.fm ? self.stationsDb.fm.find(function(s) {
    return parseFloat(s.frequency) === freq;
  }) : null;
  
  if (station && station.deleted) {
    self.logger.error('[RTL-SDR Radio] Cannot play deleted station: ' + frequency);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('TOAST_DELETED_STATION'));
    defer.reject(new Error('Station is deleted'));
    return defer.promise;
  }
  
  // Use customName from database if available (overrides track.name)
  if (station && station.customName) {
    stationName = station.customName;
  }
  
  // Check device availability, then take the tuner: whatever held it is stopped and
  // gone, and the dongle has settled, before this station's processes start
  self.checkDeviceAvailable('play_fm', { frequency: freq, stationName: stationName })
    .then(function() {
      return self.tuner.acquire('playing_fm');
    })
    .then(function(job) {
      self.setDeviceState('playing_fm');
      self.startFmPlayback(job, freq, stationName, defer);
    })
    .fail(function(e) {
      if (e && e.superseded) {
        self.logger.info('[RTL-SDR Radio] FM ' + freq + ' MHz not started: a later request took its place');
      } else {
        self.logger.info('[RTL-SDR Radio] FM playback cancelled or rejected: ' + e);
      }
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.startFmPlayback = function(job, freq, stationName, defer) {
  var self = this;
  
  self.intentionalStop = false;
  
  // Update play statistics
  // Preserve frequency precision (50kHz spacing needs 2 decimals)
  var hasSubDecimal = (freq * 100) % 10 !== 0;
  var freqStr = hasSubDecimal ? freq.toFixed(2) : freq.toFixed(1);
  var uri = 'rtlsdr://fm/' + freqStr;
  var stationInfo = self.getStationByUri(uri);
  if (stationInfo) {
    stationInfo.station.playCount = (stationInfo.station.playCount || 0) + 1;
    stationInfo.station.lastPlayed = new Date().toISOString();
    self.saveStations();
  }
  
  // Get settings from config
  var gain = self.config.get('fm_gain', 50);
  var fmOversampling = self.config.get('fm_oversampling', false);
  var fmSampleRate = self.config.get('fm_sample_rate', '171k');
  var fmDeemphasis = self.config.get('fm_deemphasis', false);
  
  // Get region settings for de-emphasis
  var regionSettings = self.getRegionSettings();
  var regionKey = self.config.get('fm_region', 'europe');
  
  // Reset RDS state
  self.currentRds = null;
  self.rdsBuffer = '';
  self.lastRdsState = null;
  self.lastRdsUpdate = 0;
  self.lastSignalLevel = undefined;
  self.psHistory = [];
  self.stablePs = null;
  self.currentFmFrequency = freq;
  
  // Build fn-rtl_fm command for RDS-compatible output
  // -M fm: FM mode without stereo decode (outputs MPX baseband for RDS)
  // -s: Sample rate (171k optimal for RDS, 200k for audio quality)
  // -o 4: Oversampling (reduces distortion in strong signal areas, may reduce RDS quality)
  // -l 0: Squelch off
  // -A std: Standard audio
  // -F 9: FIR filter size
  var rtlArgs = ['-f', freq + 'M', '-M', 'fm', '-s', fmSampleRate, '-l', '0', '-A', 'std', '-g', gain.toString(), '-F', '9'];
  
  // Add oversampling if enabled (helps with strong signals, may reduce RDS quality)
  if (fmOversampling) {
    rtlArgs.splice(6, 0, '-o', '4');
  }
  
  // Apply de-emphasis based on region settings
  // In custom mode, use manual toggle; otherwise use region's de-emphasis
  var applyDeemphasis = (regionKey === 'custom') ? fmDeemphasis : (regionSettings.deemphasis_us > 0);
  var deemphasisUs = (regionKey === 'custom') ? (fmDeemphasis ? 50 : 0) : regionSettings.deemphasis_us;
  
  if (applyDeemphasis) {
    // Note: rtl_fm -E deemp provides 50us de-emphasis (Europe/Asia/Australia standard)
    // Americas uses 75us but rtl_fm only supports 50us natively
    // For Americas, we apply 50us which is close enough for most listening
    rtlArgs.push('-E', 'deemp');
    self.logger.info('[RTL-SDR Radio] De-emphasis enabled (' + deemphasisUs + 'us, region: ' + regionKey + ')');
  }
  
  self.logger.info('[RTL-SDR Radio] Starting FM with RDS: fn-rtl_fm ' + rtlArgs.join(' '));
  
  // The FM chain: fn-rtl_fm feeds the RDS decoder and, through sox, the audio output.
  // The processes belong to the tuner's job, which stops them and absorbs the errors
  // of their pipes.
  var rtlProcess = job.spawn('fn-rtl_fm', rtlArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  self.decoderProcess = rtlProcess;
  
  // fn-redsea for RDS decoding
  // -E flag enables BLER (Block Error Rate) output for signal quality
  var redseaProcess = job.spawn('fn-redsea', ['-r', fmSampleRate, '--show-partial', '-E'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  self.redseaProcess = redseaProcess;
  
  // sox for resampling: FM sample rate mono -> output rate stereo
  var soxArgs = ['-t', 'raw', '-r', fmSampleRate, '-e', 'signed', '-b', '16', '-c', '1', '-',
                 '-t', 'raw', '-r', String(self.OUTPUT_SAMPLE_RATE), '-e', 'signed', '-b', '16', '-c', '2', '-'];
  var soxProcess = job.spawn('sox', soxArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  self.soxProcess = soxProcess;
  
  // aplay for audio output
  var aplayProcess = job.spawn('aplay',
    ['-D', 'volumio', '-f', 'S16_LE', '-r', String(self.OUTPUT_SAMPLE_RATE), '-c', '2'],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  self.aplayProcess = aplayProcess;
  
  // Pipe sox -> aplay
  soxProcess.stdout.pipe(aplayProcess.stdin);
  
  // The reception is measured on the same signal, once a second
  var meter = null;
  var meterRate = FmQuality.parseRate(fmSampleRate);
  if (meterRate) {
    meter = new FmQuality(meterRate, {
      deemphasis: applyDeemphasis,
      onReading: function(db) {
        if (self.tuner.current === job && !job.stopping) {
          self.considerFmLevel(db, freqStr, stationName);
        }
      }
    });
  }
  
  // Split rtl_fm output to both redsea and sox
  rtlProcess.stdout.on('data', function(chunk) {
    if (meter) {
      meter.feed(chunk);
    }
    // Write to redsea for RDS decoding
    if (redseaProcess.stdin.writable) {
      try {
        redseaProcess.stdin.write(chunk);
      } catch (e) {
        // Ignore write errors
      }
    }
    // Write to sox for audio
    if (soxProcess.stdin.writable) {
      try {
        soxProcess.stdin.write(chunk);
      } catch (e) {
        // Ignore write errors
      }
    }
  });
  
  // Handle rtl_fm end
  rtlProcess.stdout.on('end', function() {
    if (redseaProcess.stdin.writable) {
      try { redseaProcess.stdin.end(); } catch (e) {}
    }
    if (soxProcess.stdin.writable) {
      try { soxProcess.stdin.end(); } catch (e) {}
    }
  });
  
  // Parse RDS JSON from fn-redsea stdout
  redseaProcess.stdout.on('data', function(data) {
    self.rdsBuffer += data.toString();
    var lines = self.rdsBuffer.split('\n');
    
    // Process complete lines, keep incomplete last line in buffer
    self.rdsBuffer = lines.pop();
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) {
        try {
          var rds = JSON.parse(line);
          self.handleRdsUpdate(rds, freqStr, stationName);
        } catch (e) {
          // Incomplete or invalid JSON - ignore
        }
      }
    }
  });
  
  // A process ending by itself: without the RDS decoder the station plays on and only
  // loses its text; without any of the others there is no sound
  job.onUnexpectedExit(function(entry) {
    if (entry.command === 'fn-redsea') {
      self.logger.error('[RTL-SDR Radio] RDS decoder ended (' +
        (entry.error ? entry.error.code : 'code ' + entry.code + ', signal ' + entry.signal) +
        '); playing on without RDS');
      self.redseaProcess = null;
      return;
    }
    self.playbackEnded(job, entry);
  });
  
  // Store current station for resume
  self.currentStation = {
    uri: 'rtlsdr://fm/' + freqStr,
    name: stationName,
    service: 'rtlsdr_radio'
  };
  
  // Update Volumio state machine
  self.commandRouter.stateMachine.setConsumeUpdateService('rtlsdr_radio');
  
  var state = {
    status: 'play',
    service: 'rtlsdr_radio',
    title: stationName,
    artist: 'FM ' + freqStr + ' MHz',
    album: self.getI18nString('FM_RADIO'),
    albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
    uri: 'rtlsdr://fm/' + freqStr,
    trackType: 'FM ' + self.getSignalBars(0),
    samplerate: '48 KHz',
    bitdepth: '16 bit',
    channels: 2,
    duration: 0,
    seek: 0
  };
  
  // Volumio takes this station's state from the plugin (text, artwork, signal). The
  // first push starts the playback in Volumio's eyes; the second, a moment later, is
  // taken as an update and carries the details the first cannot.
  self.playingJob = job;
  self.pushPlayingState(state);
  setTimeout(function() {
    self.pushPlayingState(state);
  }, self.CLEANUP_TIMEOUT);
  
  defer.resolve();
};

// ===============================
// RDS HANDLING FUNCTIONS
// ===============================

// Parse RadioText for artist/title information
// Handles formats like "Now playing: Artist - Title" and "Artist - Title"
ControllerRtlsdrRadio.prototype.parseRadioText = function(radiotext) {
  var self = this;
  var artworkDebugLogging = self.config.get('artwork_debug_logging', false);
  
  // Use enhanced metadata extraction (LAYER 2)
  // Priority: NLP > Dash > Pipe > Colon > Slash > Word patterns
  // Returns { artist, title, confidence, method }
  
  if (artworkDebugLogging) {
    self.logger.info('[RTL-SDR Radio] parseRadioText input: ' + (radiotext ? radiotext.substring(0, 60) : 'null'));
  }
  
  var result = metadata.extract(radiotext);
  
  if (artworkDebugLogging) {
    self.logger.info('[RTL-SDR Radio] parseRadioText result: artist=' + result.artist + ', title=' + result.title + ', conf=' + result.confidence);
  }
  
  // For backward compatibility, return simple object
  // Confidence and method available for logging/debugging
  if (result.artist && result.title && artworkDebugLogging) {
    self.logger.info('[RTL-SDR Radio] Parsed: ' + result.artist + ' - ' + result.title + 
                     ' (' + result.confidence + '% via ' + result.method + ')');
  }
  
  return { 
    artist: result.artist, 
    title: result.title,
    album: result.album || null,
    confidence: result.confidence,
    method: result.method
  };
};

// Handle RDS data update from fn-redsea
ControllerRtlsdrRadio.prototype.handleRdsUpdate = function(rds, freq, stationName) {
  var self = this;
  
  // Merge new RDS data with existing
  if (!self.currentRds) {
    self.currentRds = {};
  }
  
  // Extract BLER for signal quality (from -E flag)
  if (rds.bler !== undefined) {
    self.currentRds.bler = rds.bler;
    // The error rate says how well RDS decodes, which is not how well the station is
    // received: it is zero long before reception is good. It is kept, smoothed, as the
    // fallback for stations whose reception cannot be measured (considerFmLevel), and
    // counts for three dots at most.
    var bler = self.currentRds.blerSmoothed === undefined ?
      rds.bler : (self.currentRds.blerSmoothed * 0.8 + rds.bler * 0.2);
    self.currentRds.blerSmoothed = bler;
    self.currentRds.blerLevel = bler < 10 ? 3 : (bler < 30 ? 2 : 1);
  }
  
  // Initialize PS stability tracking
  if (!self.psHistory) {
    self.psHistory = [];
    self.stablePs = null;
  }
  
  // Sanitize and validate PS name before use
  var sanitizedPs = null;
  if (rds.ps) {
    sanitizedPs = self.sanitizeRdsText(rds.ps);
    
    // Track PS history for stability (require 3 identical readings)
    if (sanitizedPs) {
      self.psHistory.push(sanitizedPs);
      if (self.psHistory.length > 5) {
        self.psHistory.shift(); // Keep last 5
      }
      
      // Check if last 3 are identical
      if (self.psHistory.length >= 3) {
        var last3 = self.psHistory.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          self.stablePs = last3[0];
        }
      }
    }
  }
  
  // Sanitize radiotext
  var sanitizedRt = rds.radiotext ? self.sanitizeRdsText(rds.radiotext) : null;
  
  // Track if meaningful data changed (use stable PS, not raw)
  var psChanged = self.stablePs && self.stablePs !== self.currentRds.stablePs;
  var rtChanged = sanitizedRt && sanitizedRt !== self.currentRds.radiotext;
  var rtPlusChanged = rds.radiotext_plus && JSON.stringify(rds.radiotext_plus) !== JSON.stringify(self.currentRds.radiotext_plus);
  
  // Copy sanitized fields
  if (self.stablePs) {
    self.currentRds.ps = self.stablePs;
    self.currentRds.stablePs = self.stablePs;
  }
  if (sanitizedRt) {
    self.currentRds.radiotext = sanitizedRt;
  }
  if (rds.radiotext_plus) {
    self.currentRds.radiotext_plus = rds.radiotext_plus;
  }
  if (rds.prog_type) {
    self.currentRds.prog_type = rds.prog_type;
  }
  if (rds.di) {
    self.currentRds.di = rds.di;
  }
  if (rds.tmc) {
    self.currentRds.tmc = rds.tmc;
  }
  
  // Handle TMC traffic alerts (separate from state updates)
  if (rds.tmc && rds.tmc.message && rds.tmc.message.description) {
    self.handleTmcAlert(rds.tmc);
  }
  
  // Only push state if meaningful data changed
  if (psChanged || rtChanged || rtPlusChanged) {
    // Log significant changes including signal quality
    var sigInfo = self.currentRds.signalLevel !== undefined ? 
      ' Signal=' + self.currentRds.signalLevel + '/5 (' + self.currentRds.signalPercent + '%)' : '';
    self.logger.info('[RTL-SDR Radio] RDS: PS=' + (self.currentRds.ps || '?') + 
                    ', RT=' + (self.currentRds.radiotext || '?').substring(0, 40) + sigInfo);
    
    // Attempt to push updated state (will be throttled internally)
    self.pushRdsState(freq, stationName);
  }
};

// Sanitize RDS text - remove invalid characters and validate
ControllerRtlsdrRadio.prototype.sanitizeRdsText = function(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // Remove control characters and non-printable chars (keep ASCII 32-126)
  var sanitized = '';
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      sanitized += text.charAt(i);
    }
  }
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Reject if too short or mostly garbage
  if (sanitized.length < 2) {
    return null;
  }
  
  // Reject if more than 50% non-alphanumeric (likely corrupted)
  var alphaNum = sanitized.replace(/[^a-zA-Z0-9 ]/g, '');
  if (alphaNum.length < sanitized.length * 0.5) {
    return null;
  }
  
  return sanitized;
};

// Generate signal strength bars using Unicode block characters
// Level 0-5 returns centered circle visualization with empty placeholders
ControllerRtlsdrRadio.prototype.getSignalBars = function(level) {
  // Centered circles: ◦ (empty U+25E6) and ● (filled U+25CF)
  var empty = '\u25E6';
  var filled = '\u25CF';
  
  var idx = Math.max(0, Math.min(5, level || 0));
  var result = '';
  for (var i = 0; i < 5; i++) {
    result += (i < idx) ? filled : empty;
  }
  return result;
};

// Lookup album artwork from MusicBrainz/Cover Art Archive
// Async - updates state when artwork is found
// Get albumart URL using Volumio's albumart plugin
// Uses the same method as MPD and other core services
ControllerRtlsdrRadio.prototype.getAlbumArt = function(data, path, icon) {
  var self = this;
  
  // Initialize albumart plugin reference (cached after first call)
  if (self.albumArtPlugin === undefined) {
    self.albumArtPlugin = self.commandRouter.pluginManager.getPlugin('miscellanea', 'albumart');
  }
  
  if (self.albumArtPlugin) {
    return self.albumArtPlugin.getAlbumArt(data, path, icon);
  } else {
    // Fallback if albumart plugin not available
    return '/albumart';
  }
};

// Build artwork URL for artist/album using Volumio's albumart service
// sourceicon parameter provides fallback to our plugin's SVG if Last.fm lookup fails
ControllerRtlsdrRadio.prototype.buildArtworkUrl = function(artist, album, fallbackIcon) {
  var self = this;
  
  if (!artist || !album) {
    return '/albumart?sourceicon=' + fallbackIcon;
  }
  
  var artworkDebugLogging = self.config.get('artwork_debug_logging', false);
  
  // Build URL directly - don't use getAlbumArt() as it may add icon parameter
  // Format: /albumart?web=artist/album/size&sourceicon=fallback
  var url = '/albumart?web=' + encodeURIComponent(artist) + '/' + 
            encodeURIComponent(album) + '/extralarge' +
            '&sourceicon=' + fallbackIcon;
  
  if (artworkDebugLogging) {
    self.logger.info('[RTL-SDR Radio] Built artwork URL: ' + url);
  }
  return url;
};

// Lookup artwork from Last.fm using track.getInfo API (PRIMARY METHOD)
// This is much more reliable than MusicBrainz because:
// 1. Last.fm returns album name AND artwork in one call
// 2. Has autocorrect for misspelled artist/track names
// 3. Returns the album that Last.fm users most commonly associate with the track
// 4. No complex compilation filtering needed
//
// Falls back to Open Opus for classical composers when Last.fm has no artwork
//
// Returns { artist, title, album, artworkUrl } if found, null otherwise
ControllerRtlsdrRadio.prototype.lookupAlbum = function(artist, title, callback) {
  var self = this;
  
  if (!artist || !title) {
    return callback(null, null);
  }
  
  var artworkDebugLogging = self.config.get('artwork_debug_logging', false);
  
  // Check cache first
  var cacheKey = artist.toLowerCase() + '|' + title.toLowerCase();
  if (self.albumLookupCache && self.albumLookupCache[cacheKey] !== undefined) {
    return callback(null, self.albumLookupCache[cacheKey]);
  }
  
  // Use Last.fm track.getInfo - returns album AND artwork directly
  metadata.lastfmLookup(artist, title, function(err, result) {
    if (err) {
      if (artworkDebugLogging) {
        self.logger.warn('[RTL-SDR Radio] Last.fm error: ' + err.message);
      }
      // Try Open Opus fallback for classical
      return self.tryClassicalFallback(artist, title, cacheKey, artworkDebugLogging, callback);
    }
    
    if (result && result.found && result.album) {
      // Last.fm found the track - check if it has artwork
      if (result.albumArtwork) {
        var lookupResult = {
          artist: result.artist || artist,
          title: result.title || title,
          album: result.album,
          artworkUrl: result.albumArtwork  // Direct artwork URL from Last.fm
        };
        
        // Cache the result
        if (!self.albumLookupCache) {
          self.albumLookupCache = {};
        }
        self.albumLookupCache[cacheKey] = lookupResult;
        
        if (artworkDebugLogging) {
          self.logger.info('[RTL-SDR Radio] Last.fm: ' + lookupResult.artist + ' - ' + 
                           lookupResult.title + ' [' + lookupResult.album + ']' +
                           (lookupResult.artworkUrl ? ' (artwork)' : ''));
        }
        callback(null, lookupResult);
      } else {
        // Last.fm found track but no artwork - try classical fallback
        if (artworkDebugLogging) {
          self.logger.info('[RTL-SDR Radio] Last.fm: ' + result.artist + ' - ' + 
                           result.title + ' [' + result.album + '] (no artwork, trying classical)');
        }
        self.tryClassicalFallback(artist, title, cacheKey, artworkDebugLogging, callback);
      }
    } else {
      // Last.fm didn't find the track - try classical fallback
      self.tryClassicalFallback(artist, title, cacheKey, artworkDebugLogging, callback);
    }
  });
};

// Try Open Opus lookup for classical composer portraits
// Used as fallback when Last.fm has no artwork
ControllerRtlsdrRadio.prototype.tryClassicalFallback = function(artist, title, cacheKey, debug, callback) {
  var self = this;
  
  // Check if this looks like a classical composer
  if (!metadata.isLikelyClassicalComposer(artist)) {
    // Not classical - cache negative result and return
    if (!self.albumLookupCache) {
      self.albumLookupCache = {};
    }
    self.albumLookupCache[cacheKey] = null;
    return callback(null, null);
  }
  
  if (debug) {
    self.logger.info('[RTL-SDR Radio] Trying Open Opus for classical: ' + artist);
  }
  
  // Look up composer portrait from Open Opus
  metadata.openOpusLookup(artist, function(err, result) {
    if (err) {
      if (debug) {
        self.logger.warn('[RTL-SDR Radio] Open Opus error: ' + err.message);
      }
      if (!self.albumLookupCache) {
        self.albumLookupCache = {};
      }
      self.albumLookupCache[cacheKey] = null;
      return callback(null, null);
    }
    
    if (result && result.found && result.portrait) {
      var lookupResult = {
        artist: result.completeName || artist,
        title: title,
        album: result.epoch || 'Classical',  // Use epoch as pseudo-album
        artworkUrl: result.portrait,         // Composer portrait
        isComposerPortrait: true             // Flag to indicate this is a portrait, not album art
      };
      
      // Cache the result
      if (!self.albumLookupCache) {
        self.albumLookupCache = {};
      }
      self.albumLookupCache[cacheKey] = lookupResult;
      
      if (debug) {
        self.logger.info('[RTL-SDR Radio] Open Opus: ' + result.completeName + 
                         ' (' + result.epoch + ') - portrait found');
      }
      callback(null, lookupResult);
    } else {
      // Cache negative result
      if (!self.albumLookupCache) {
        self.albumLookupCache = {};
      }
      self.albumLookupCache[cacheKey] = null;
      callback(null, null);
    }
  });
};

// Push updated state to Volumio with RDS metadata
// Throttled and only pushes when state actually changes
ControllerRtlsdrRadio.prototype.pushRdsState = function(freq, stationName) {
  var self = this;
  var rds = self.currentRds;
  
  if (!rds) return;
  
  // Parse RadioText for artist/title BEFORE throttle check
  // This ensures we always have latest metadata even if state push is throttled
  var parsed = self.parseRadioText(rds.radiotext);
  
  // Prefer RT+ tags if available
  var artist = null;
  var title = null;
  if (rds.radiotext_plus && rds.radiotext_plus.tags) {
    for (var i = 0; i < rds.radiotext_plus.tags.length; i++) {
      var tag = rds.radiotext_plus.tags[i];
      if (tag['content-type'] === 'item.artist') artist = tag.data;
      if (tag['content-type'] === 'item.title') title = tag.data;
    }
  }
  if (!artist) artist = parsed.artist;
  if (!title) title = parsed.title;
  
  // Throttle updates - minimum interval between pushes
  // Exception: Signal level changes bypass throttle for responsive UI
  var now = Date.now();
  var sigLevel = rds.signalLevel || 0;
  var signalChanged = (self.lastSignalLevel !== undefined && self.lastSignalLevel !== sigLevel);
  
  if (!signalChanged && (now - self.lastRdsUpdate) < self.RDS_UPDATE_INTERVAL) {
    return;
  }
  
  // Display name priority: customName > RDS PS > stationName (default)
  var displayName = stationName;
  var freqNum = parseFloat(freq);
  var station = self.stationsDb.fm ? self.stationsDb.fm.find(function(s) {
    return parseFloat(s.frequency) === freqNum;
  }) : null;
  
  if (station && station.customName) {
    // User set custom name - highest priority
    displayName = station.customName;
  } else if (rds.ps) {
    // RDS PS name - second priority
    displayName = rds.ps.trim();
  }
  
  // Determine stereo from RDS DI flags
  var channels = 2; // Default stereo for RDS mode
  if (rds.di && rds.di.stereo === false) {
    channels = 1;
  }
  
  // Build state key fields for comparison (include signal level for UI updates)
  // Must match actual state values to detect changes correctly
  // Note: sigLevel already defined above for throttle bypass
  var stateKey = displayName + '|' + (artist || rds.radiotext || '') + '|' + (title || rds.prog_type || '') + '|' + sigLevel;
  
  // Skip if state hasn't changed
  if (self.lastRdsState === stateKey) {
    return;
  }
  
  // Update tracking
  self.lastRdsState = stateKey;
  self.lastRdsUpdate = now;
  self.lastSignalLevel = sigLevel;
  
  // Get artwork settings
  var bestEffortArtwork = self.config.get('best_effort_artwork', true);
  var artworkThreshold = self.config.get('artwork_threshold', 60);
  
  // Default artwork is always our FM icon - NEVER Volumio placeholder
  var fallbackIcon = 'music_service/rtlsdr_radio/assets/fm.svg';
  var albumart = '/albumart?sourceicon=' + fallbackIcon;
  
  // If best effort artwork is disabled, skip all parsing and lookups
  if (!bestEffortArtwork) {
    artist = null;
    title = null;
  }
  
  // Artwork persistence: Keep last valid artwork when no metadata is parsed
  // This prevents flicker when station shows promos between songs
  var artworkPersistence = self.config.get('artwork_persistence', 'track');
  var artworkTtl = self.config.get('artwork_ttl', 0);  // 0 = disabled, else minutes
  var artworkDebugLogging = self.config.get('artwork_debug_logging', false);
  var usePersistedArtwork = false;
  
  // Check TTL expiration (only if TTL is enabled)
  if (artworkTtl > 0 && self.lastValidArtwork && self.artworkTimestamp) {
    var ttlMs = artworkTtl * 60 * 1000;  // Convert minutes to ms
    var age = Date.now() - self.artworkTimestamp;
    if (age > ttlMs) {
      // TTL expired - clear artwork
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Artwork TTL expired (' + artworkTtl + ' min) - clearing');
      }
      self.lastValidArtwork = null;
      self.artworkTimestamp = null;
    }
  }
  
  if (!artist && !title) {
    // No new metadata - check if we should persist previous artwork
    if (self.lastValidArtwork && self.lastValidArtwork.url) {
      if (artworkPersistence === 'artist' || artworkPersistence === 'track') {
        albumart = self.lastValidArtwork.url;
        usePersistedArtwork = true;
        if (artworkDebugLogging) {
          self.logger.info('[RTL-SDR Radio] Using persisted artwork: ' + self.lastValidArtwork.artist);
        }
      }
    }
  } else if (artist && self.lastValidArtwork && self.lastValidArtwork.artist) {
    // New metadata arrived - check if artist changed (resets TTL)
    if (artist.toLowerCase() !== self.lastValidArtwork.artist.toLowerCase()) {
      // Artist changed - TTL will be reset when new artwork is saved
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Artist changed: ' + self.lastValidArtwork.artist + ' -> ' + artist);
      }
    }
  }
  
  // Helper function to push state
  var pushFmState = function(artUrl) {
    var state = {
      status: 'play',
      service: 'rtlsdr_radio',
      title: displayName,
      artist: artist || rds.radiotext || 'FM ' + freq + ' MHz',
      album: title || rds.prog_type || self.getI18nString('FM_RADIO'),
      albumart: artUrl,
      uri: 'rtlsdr://fm/' + freq,
      trackType: 'FM ' + self.getSignalBars(rds.signalLevel),
      samplerate: '48 KHz',
      bitdepth: '16 bit',
      channels: channels,
      seek: 0,
      duration: 0,
      isStreaming: true,
      volatile: true
    };
    
    self.pushPlayingState(state);
  };
  
  // If we have valid metadata above threshold, do Last.fm lookup for album name
  // Check blocklist to avoid lookups for station idents/promos
  var artistBlocked = metadata.fuzzyBlocklistMatch(artist);
  var titleBlocked = metadata.fuzzyBlocklistMatch(title);
  
  if (artistBlocked || titleBlocked) {
    if (artworkDebugLogging) {
      self.logger.info('[RTL-SDR Radio] Artwork blocked: ' + artist + ' - ' + title + 
                       ' (artist=' + artistBlocked + ', title=' + titleBlocked + ')');
    }
  }
  
  if (bestEffortArtwork && artist && title && parsed.confidence >= artworkThreshold && !artistBlocked && !titleBlocked) {
    var lookupKey = artist.toLowerCase() + '|' + title.toLowerCase();
    
    if (artworkDebugLogging) {
      self.logger.info('[RTL-SDR Radio] Artwork lookup: ' + artist + ' - ' + title + 
                       ' (confidence ' + parsed.confidence + '% >= ' + artworkThreshold + '%)');
    }
    
    // Check if we already have cached album info
    if (self.albumLookupCache && self.albumLookupCache[lookupKey]) {
      var cached = self.albumLookupCache[lookupKey];
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Cache HIT: ' + lookupKey);
      }
      if (cached && (cached.album || cached.artworkUrl)) {
        if (cached.isComposerPortrait && cached.artworkUrl) {
          // Direct URL from Open Opus - use as-is
          albumart = cached.artworkUrl;
        } else {
          albumart = self.buildArtworkUrl(cached.artist, cached.album, fallbackIcon);
        }
        // Save as last valid artwork for persistence and reset TTL
        self.lastValidArtwork = {
          url: albumart,
          artist: cached.artist,
          title: title
        };
        self.artworkTimestamp = Date.now();
      }
      // Cache hit - push state once with correct artwork
      pushFmState(albumart);
    } else {
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Cache MISS: ' + lookupKey);
      }
      // No cache - push state with persisted/default icon, then update after lookup
      pushFmState(albumart);
      
      // Async Last.fm lookup for album name (falls back to Open Opus for classical)
      self.lookupAlbum(artist, title, function(err, result) {
        if (result && (result.album || result.artworkUrl)) {
          var artUrl;
          if (result.isComposerPortrait && result.artworkUrl) {
            // Direct URL from Open Opus - use as-is
            artUrl = result.artworkUrl;
            if (artworkDebugLogging) {
              self.logger.info('[RTL-SDR Radio] Using composer portrait: ' + result.artist);
            }
          } else {
            // Last.fm result - build Volumio albumart URL
            artUrl = self.buildArtworkUrl(result.artist, result.album, fallbackIcon);
          }
          // Save as last valid artwork for persistence and reset TTL
          self.lastValidArtwork = {
            url: artUrl,
            artist: result.artist,
            title: title
          };
          self.artworkTimestamp = Date.now();
          // Push updated state with proper artwork URL
          pushFmState(artUrl);
        }
      });
    }
  } else {
    // No metadata or below threshold - push with persisted or default artwork
    pushFmState(albumart);
  }
};

// Handle TMC traffic alerts with toast notifications
ControllerRtlsdrRadio.prototype.handleTmcAlert = function(tmc) {
  var self = this;
  
  if (!tmc || !tmc.message || !tmc.message.description) return;
  
  // Throttle TMC alerts - max one per configured interval
  var now = Date.now();
  if (self.lastTmcAlert && (now - self.lastTmcAlert) < self.TMC_THROTTLE) {
    return;
  }
  self.lastTmcAlert = now;
  
  var urgency = tmc.message.urgency || 'none';
  var type = (urgency === 'U') ? 'warning' : 'info';
  
  self.commandRouter.pushToastMessage(
    type,
    self.getI18nString('TRAFFIC_ALERT') || 'Traffic Alert',
    tmc.message.description
  );
};

// ============================================
// DAB DLS METADATA FUNCTIONS
// ============================================

// Setup metadata directory for fn-dab output
ControllerRtlsdrRadio.prototype.setupDabMetadataDir = function() {
  var self = this;
  
  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(self.dabMetadataDir)) {
      fs.mkdirpSync(self.dabMetadataDir);
      self.logger.info('[RTL-SDR Radio] Created DAB metadata directory: ' + self.dabMetadataDir);
    }
    
    // Clean any existing files
    self.cleanupDabMetadataDir();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to setup DAB metadata directory: ' + e);
  }
};

// Cleanup metadata directory
ControllerRtlsdrRadio.prototype.cleanupDabMetadataDir = function() {
  var self = this;
  
  try {
    if (fs.existsSync(self.dabMetadataDir)) {
      var files = fs.readdirSync(self.dabMetadataDir);
      files.forEach(function(file) {
        try {
          fs.unlinkSync(path.join(self.dabMetadataDir, file));
        } catch (e) {
          // Ignore individual file errors
        }
      });
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to cleanup DAB metadata directory: ' + e);
  }
};

// Start DLS file monitor
ControllerRtlsdrRadio.prototype.startDabDlsMonitor = function() {
  var self = this;
  
  // Clear any existing monitor
  self.stopDabDlsMonitor();
  
  // Reset DLS state
  self.currentDls = null;
  self.lastDlsLabel = '';
  self.lastRawLabel = null;
  self.lastDlsUpdate = 0;
  self.lastDabState = null;
  self.currentDabSignal = null;
  
  var dlsPath = path.join(self.dabMetadataDir, 'DABlabel.txt');
  var dlPlusPath = path.join(self.dabMetadataDir, 'DABdlplus.txt');
  var signalPath = path.join(self.dabMetadataDir, 'DABsignal.txt');
  
  self.logger.info('[RTL-SDR Radio] Starting DLS monitor: ' + dlsPath);
  
  self.dlsMonitorInterval = setInterval(function() {
    try {
      // Read signal quality file (written by fn-dab every 2 seconds)
      if (fs.existsSync(signalPath)) {
        var sigContent = fs.readFileSync(signalPath, 'utf8');
        var sigLines = sigContent.split('\n');
        var sigData = {};
        for (var j = 0; j < sigLines.length; j++) {
          var sigLine = sigLines[j].trim();
          var eqPos = sigLine.indexOf('=');
          if (eqPos > 0) {
            sigData[sigLine.substring(0, eqPos)] = sigLine.substring(eqPos + 1);
          }
        }
        if (sigData.signal_level !== undefined) {
          self.currentDabSignal = {
            level: parseInt(sigData.signal_level) || 0,
            percent: parseInt(sigData.signal_percent) || 0,
            fibQuality: parseInt(sigData.fib_quality) || 0,
            audioOk: parseInt(sigData.audio_ok) || 0,
            snr: parseInt(sigData.snr) || 0
          };
        }
      }
      
      // First check for DL Plus file (has semantic tags)
      var dlPlusData = null;
      if (fs.existsSync(dlPlusPath)) {
        var dlPlusContent = fs.readFileSync(dlPlusPath, 'utf8');
        dlPlusData = self.parseDlPlusFile(dlPlusContent);
      }
      
      // Also read basic DLS label
      var label = '';
      if (fs.existsSync(dlsPath)) {
        var content = fs.readFileSync(dlsPath, 'utf8');
        var lines = content.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('label=') === 0) {
            label = line.substring(6);
            break;
          }
        }
      }
      
      // Build state key for change detection (include signal for UI updates)
      var sigLevel = self.currentDabSignal ? self.currentDabSignal.level : 0;
      var stateKey = label + '|' + (dlPlusData ? dlPlusData.artist + '|' + dlPlusData.title : '') + '|' + sigLevel;
      
      // Only process if changed
      if (stateKey !== self.lastDlsLabel) {
        self.lastDlsLabel = stateKey;
        self.handleDabDls(label, dlPlusData);
      }
    } catch (e) {
      // File may be mid-write, ignore
    }
  }, self.DLS_POLL_INTERVAL);
};

// Stop DLS file monitor
ControllerRtlsdrRadio.prototype.stopDabDlsMonitor = function() {
  var self = this;
  
  if (self.dlsMonitorInterval) {
    clearInterval(self.dlsMonitorInterval);
    self.dlsMonitorInterval = null;
  }
};

// Parse DL Plus file content
// Returns { artist, title, itemRunning } or null if no music tags
ControllerRtlsdrRadio.prototype.parseDlPlusFile = function(content) {
  var self = this;
  
  if (!content) return null;
  
  var lines = content.split('\n');
  var data = {};
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var eqPos = line.indexOf('=');
    if (eqPos > 0) {
      var key = line.substring(0, eqPos);
      var value = line.substring(eqPos + 1);
      data[key] = value;
    }
  }
  
  // Check if we have ITEM.ARTIST and ITEM.TITLE
  var artist = data['ITEM.ARTIST'];
  var title = data['ITEM.TITLE'];
  var itemRunning = data['itemRunning'] === '1';
  
  if (artist && title) {
    self.logger.info('[RTL-SDR Radio] DL+ music detected: ' + artist + ' - ' + title);
    return {
      artist: artist,
      title: title,
      itemRunning: itemRunning
    };
  }
  
  return null;
};

// Handle DLS label update
// TEXT: Always display raw label (could be emergency, song info, promo, anything)
// ARTWORK: DL Plus first, then text parsing fallback, then MOT
ControllerRtlsdrRadio.prototype.handleDabDls = function(label, dlPlusData) {
  var self = this;
  var artworkDebugLogging = self.config.get('artwork_debug_logging', false);
  
  // Always store raw label for display (never parse, could be emergency broadcast)
  var rawLabel = label || '';
  
  // Check if label changed
  if (rawLabel === self.lastRawLabel) {
    // Same text. The monitor calls this for a change of the tune level too, which is
    // shown as it changes, not only with the next text.
    if (self.currentDls) {
      self.pushDabState();
    }
    return;
  }
  self.lastRawLabel = rawLabel;
  
  // Log with signal quality if available
  var sigInfo = '';
  if (self.currentDabSignal && self.currentDabSignal.level !== undefined) {
    sigInfo = ' Signal=' + self.currentDabSignal.level + '/5 (' + self.currentDabSignal.percent + '%)';
  }
  self.logger.info('[RTL-SDR Radio] DLS: ' + rawLabel.substring(0, 50) + sigInfo);
  
  // Artwork source 1: DL Plus semantic tags (broadcaster-provided, language-agnostic)
  var artworkArtist = null;
  var artworkTitle = null;
  var artworkAlbum = null;
  
  if (dlPlusData && dlPlusData.artist && dlPlusData.title) {
    artworkArtist = dlPlusData.artist;
    artworkTitle = dlPlusData.title;
    if (artworkDebugLogging) {
      self.logger.info('[RTL-SDR Radio] DL+ metadata: ' + artworkArtist + ' - ' + artworkTitle);
    }
  } else if (rawLabel) {
    // Artwork source 2: Text parsing fallback (LAYER 2 metadata extraction)
    // Strip signal info suffix if present (fn-dab appends "Signal=X/5 (Y%)")
    var labelForParsing = rawLabel.replace(/\s*Signal=\d+\/\d+\s*\(\d+%\)\s*$/, '');
    var parsed = self.parseRadioText(labelForParsing);
    if (parsed.artist && parsed.title) {
      // Always store parsed data - threshold check happens in pushDabState
      artworkArtist = parsed.artist;
      artworkTitle = parsed.title;
      artworkAlbum = parsed.album;  // From soundtrack pattern (e.g., "Album - Track by Artist")
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Parsed: ' + artworkArtist + ' - ' + artworkTitle + 
                         (artworkAlbum ? ' [' + artworkAlbum + ']' : '') +
                         ' (' + parsed.confidence + '% via ' + parsed.method + ')');
      }
    }
  }
  
  // Artwork source 3: MOT slideshow image (checked in pushDabState)
  // No action here - file existence checked when pushing state
  
  // Store current state
  self.currentDls = {
    rawLabel: rawLabel,           // Always display this
    artworkArtist: artworkArtist, // For Cover Art Archive
    artworkTitle: artworkTitle,   // For Cover Art Archive
    artworkAlbum: artworkAlbum,   // From soundtrack pattern - skip Last.fm if present
    parsedConfidence: (dlPlusData && dlPlusData.artist) ? 100 : (parsed ? parsed.confidence : 0)
  };
  
  // Push updated state
  self.pushDabState();
};

// Push DAB state with DLS metadata to Volumio
// TEXT: Always show raw label (could be emergency broadcast, song info, anything)
// ARTWORK: Only from DL Plus or MOT, never from text parsing
ControllerRtlsdrRadio.prototype.pushDabState = function() {
  var self = this;
  var fs = require('fs');
  var path = require('path');
  
  if (!self.currentDabStation) {
    return;
  }
  
  var dls = self.currentDls || {};
  var dabStation = self.currentDabStation;
  
  // Get station from database for customName and ensemble
  var station = self.stationsDb.dab ? self.stationsDb.dab.find(function(s) {
    return s.channel === dabStation.channel && s.exactName === dabStation.serviceName;
  }) : null;
  
  // Station name priority: customName > station.name > stationTitle
  var stationName = dabStation.stationTitle;
  if (station && station.customName) {
    stationName = station.customName;
  } else if (station && station.name) {
    stationName = station.name;
  }
  
  // Ensemble with channel ID, e.g., "London 1 (12C)"
  var ensembleName = station && station.ensemble ? station.ensemble : '';
  var channelId = dabStation.channel || '';
  var ensembleDisplay = ensembleName ? 
    ensembleName + ' (' + channelId + ')' : 
    'DAB Channel ' + channelId;
  
  // DLS text - always show raw label, could be emergency broadcast
  var dlsText = dls.rawLabel || self.getI18nString('DAB_RADIO');
  
  // Get artwork settings
  var bestEffortArtwork = self.config.get('best_effort_artwork', true);
  var artworkThreshold = self.config.get('artwork_threshold', 60);
  var artworkPersistence = self.config.get('artwork_persistence', 'track');
  var artworkTtl = self.config.get('artwork_ttl', 0);  // 0 = disabled, else minutes
  var artworkDebugLogging = self.config.get('artwork_debug_logging', false);
  
  // Default artwork is always our DAB icon - NEVER Volumio placeholder
  var playingDab = self.currentDabStation;
  var fallbackIcon = self.dabIcon(playingDab ? self.findDabStation(playingDab.channel, playingDab.exactName) : null);
  var albumartUrl = '/albumart?sourceicon=' + fallbackIcon;
  
  // If best effort artwork is disabled, skip all parsing and lookups
  if (!bestEffortArtwork) {
    dls.artworkArtist = null;
    dls.artworkTitle = null;
  }
  
  // Check for MOT slideshow first (broadcaster-provided image)
  var motImage = null;
  if (!dls.artworkArtist || !dls.artworkTitle) {
    var dabDir = '/tmp/dab';
    try {
      var files = fs.readdirSync(dabDir);
      motImage = files.find(function(f) {
        return f.startsWith('slide_') && (f.endsWith('.jpg') || f.endsWith('.png'));
      });
      if (motImage) {
        albumartUrl = 'file://' + path.join(dabDir, motImage);
        if (artworkDebugLogging) {
          self.logger.info('[RTL-SDR Radio] Artwork from MOT: ' + motImage);
        }
      }
    } catch (e) {
      // No MOT images
    }
  }
  
  // Check TTL expiration (only if TTL is enabled)
  if (artworkTtl > 0 && self.lastValidArtwork && self.artworkTimestamp) {
    var ttlMs = artworkTtl * 60 * 1000;  // Convert minutes to ms
    var age = Date.now() - self.artworkTimestamp;
    if (age > ttlMs) {
      // TTL expired - clear artwork
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Artwork TTL expired (' + artworkTtl + ' min) - clearing');
      }
      self.lastValidArtwork = null;
      self.artworkTimestamp = null;
    }
  }
  
  // Artwork persistence: Keep last valid artwork when no metadata is parsed
  // This prevents flicker when station shows promos between songs
  var usePersistedArtwork = false;
  if (!dls.artworkArtist && !dls.artworkTitle && !motImage) {
    // No new metadata and no MOT - check if we should persist previous artwork
    if (self.lastValidArtwork && self.lastValidArtwork.url) {
      if (artworkPersistence === 'artist') {
        // Keep artwork until artist changes - always persist when no new data
        albumartUrl = self.lastValidArtwork.url;
        usePersistedArtwork = true;
        if (artworkDebugLogging) {
          self.logger.info('[RTL-SDR Radio] Using persisted artwork: ' + self.lastValidArtwork.artist);
        }
      } else if (artworkPersistence === 'track') {
        // Keep artwork until track changes - persist when no new data
        albumartUrl = self.lastValidArtwork.url;
        usePersistedArtwork = true;
        if (artworkDebugLogging) {
          self.logger.info('[RTL-SDR Radio] Using persisted artwork: ' + self.lastValidArtwork.artist);
        }
      }
      // 'none' = don't persist, use default icon
    }
  } else if (dls.artworkArtist && self.lastValidArtwork && self.lastValidArtwork.artist) {
    // New metadata arrived - check if artist changed (resets TTL)
    if (dls.artworkArtist.toLowerCase() !== self.lastValidArtwork.artist.toLowerCase()) {
      // Artist changed - TTL will be reset when new artwork is saved
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Artist changed: ' + self.lastValidArtwork.artist + ' -> ' + dls.artworkArtist);
      }
    }
  }
  
  // Helper function to push state
  var pushState = function(artUrl) {
    var sigLevel = self.currentDabSignal ? self.currentDabSignal.level : 0;
    var stateKey = stationName + '|' + dlsText + '|' + artUrl + '|' + sigLevel;
    if (self.lastDabState === stateKey) {
      return;
    }
    self.lastDabState = stateKey;
    
    var state = {
      status: 'play',
      service: 'rtlsdr_radio',
      title: stationName,
      artist: dlsText,
      album: ensembleDisplay,
      albumart: artUrl,
      uri: dabStation.uri,
      trackType: 'DAB ' + self.getSignalBars(sigLevel),
      samplerate: '48 kHz',
      bitdepth: '16 bit',
      channels: 2,
      seek: 0,
      duration: 0,
      isStreaming: true,
      volatile: true
    };
    
    self.pushPlayingState(state);
  };
  
  // If we have parsed metadata above threshold, do Last.fm lookup for album name
  // Check blocklist to avoid lookups for station idents/promos
  var artistBlocked = dls.artworkArtist ? metadata.fuzzyBlocklistMatch(dls.artworkArtist) : false;
  var titleBlocked = dls.artworkTitle ? metadata.fuzzyBlocklistMatch(dls.artworkTitle) : false;
  
  if (artistBlocked || titleBlocked) {
    if (artworkDebugLogging) {
      self.logger.info('[RTL-SDR Radio] Artwork blocked: ' + dls.artworkArtist + ' - ' + dls.artworkTitle + 
                       ' (artist=' + artistBlocked + ', title=' + titleBlocked + ')');
    }
  }
  
  if (bestEffortArtwork && dls.artworkArtist && dls.artworkTitle && dls.parsedConfidence >= artworkThreshold && !artistBlocked && !titleBlocked) {
    var lookupKey = dls.artworkArtist + '|' + dls.artworkTitle;
    
    // Only log and lookup once per track
    if (self.lastArtworkLogKey !== lookupKey) {
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Artwork lookup: ' + dls.artworkArtist + ' - ' + dls.artworkTitle +
                         (dls.artworkAlbum ? ' [' + dls.artworkAlbum + ']' : '') +
                         ' (confidence ' + dls.parsedConfidence + '% >= ' + artworkThreshold + '%)');
      }
      self.lastArtworkLogKey = lookupKey;
    }
    
    // If album was extracted from DLS (soundtrack pattern), use it directly - no Last.fm needed
    if (dls.artworkAlbum) {
      albumartUrl = self.buildArtworkUrl(dls.artworkArtist, dls.artworkAlbum, fallbackIcon);
      // Save as last valid artwork for persistence and reset TTL
      self.lastValidArtwork = {
        url: albumartUrl,
        artist: dls.artworkArtist,
        title: dls.artworkTitle
      };
      self.artworkTimestamp = Date.now();
      if (artworkDebugLogging) {
        self.logger.info('[RTL-SDR Radio] Using album from DLS: ' + dls.artworkAlbum);
      }
      pushState(albumartUrl);
    }
    // Check if we already have cached album info
    else if (self.albumLookupCache && self.albumLookupCache[lookupKey]) {
      var cached = self.albumLookupCache[lookupKey];
      if (cached && (cached.album || cached.artworkUrl)) {
        if (cached.isComposerPortrait && cached.artworkUrl) {
          // Direct URL from Open Opus - use as-is
          albumartUrl = cached.artworkUrl;
        } else {
          albumartUrl = self.buildArtworkUrl(cached.artist, cached.album, fallbackIcon);
        }
        // Save as last valid artwork for persistence and reset TTL
        self.lastValidArtwork = {
          url: albumartUrl,
          artist: cached.artist,
          title: dls.artworkTitle
        };
        self.artworkTimestamp = Date.now();
      }
      pushState(albumartUrl);
    } else {
      // Push state immediately with persisted or default icon, then update after lookup
      pushState(albumartUrl);
      
      // Async Last.fm lookup for album name (falls back to Open Opus for classical)
      self.lookupAlbum(dls.artworkArtist, dls.artworkTitle, function(err, result) {
        if (result && (result.album || result.artworkUrl)) {
          var artUrl;
          if (result.isComposerPortrait && result.artworkUrl) {
            // Direct URL from Open Opus - use as-is
            artUrl = result.artworkUrl;
          } else {
            artUrl = self.buildArtworkUrl(result.artist, result.album, fallbackIcon);
          }
          // Save as last valid artwork for persistence and reset TTL
          self.lastValidArtwork = {
            url: artUrl,
            artist: result.artist,
            title: dls.artworkTitle
          };
          self.artworkTimestamp = Date.now();
          // Push updated state with proper artwork URL
          self.lastDabState = null; // Force state update
          pushState(artUrl);
        }
      });
    }
  } else if (!usePersistedArtwork) {
    // No metadata or below threshold, and not using persisted artwork
    // Push with default/MOT artwork
    pushState(albumartUrl);
  } else {
    // Using persisted artwork - still need to push state with updated DLS text
    pushState(albumartUrl);
  }
};

ControllerRtlsdrRadio.prototype.stop = function() {
  var self = this;
  var stopped = self.stopDecoder();
  
  // Reset device state to idle
  self.setDeviceState('idle');
  
  // Volumio no longer takes its state from this plugin. The station stays the current
  // item of its queue, so "play" starts it again.
  self.playingJob = null;
  self.restoreQueueItem();
  self.commandRouter.stateMachine.setConsumeUpdateService(undefined);
  
  // Resolved when the processes are gone and the dongle is free
  return stopped;
};

// Tell Volumio what plays. Nothing is pushed once the station is no longer the one
// playing: a lookup that answers late must not bring a stopped station back to "playing".
ControllerRtlsdrRadio.prototype.pushPlayingState = function(state) {
  var self = this;
  var job = self.playingJob;
  if (!job || self.tuner.current !== job || job.stopping || job.finished) {
    return;
  }
  // Volumio relabels any consumed state whose duration is zero as a generic web radio
  // and blanks its track type and sample rate, which is where the signal indicator
  // lives. A station has no duration; it is left out rather than given as zero.
  var pushed = Object.assign({}, state);
  delete pushed.duration;
  self.showOnQueueItem(pushed);
  self.commandRouter.servicePushState(pushed, 'rtlsdr_radio');
};

// Volumio shows the artwork of the queue item, not that of the state it is given. The
// item of the station being played is therefore given the artwork of the moment, as
// other radio plugins do, and its own icon back when the station stops.
ControllerRtlsdrRadio.prototype.showOnQueueItem = function(state) {
  var self = this;
  var item = null;
  try {
    var machine = self.commandRouter.stateMachine;
    item = machine.playQueue.arrayQueue[machine.currentPosition];
  } catch (e) {
    // No queue to be found: the state alone has to do
  }
  if (!item || item.service !== 'rtlsdr_radio' || item.uri !== state.uri || !state.albumart) {
    return;
  }
  if (self.shownOn && self.shownOn.item !== item) {
    self.restoreQueueItem();
  }
  if (!self.shownOn) {
    self.shownOn = { item: item, albumart: item.albumart };
  }
  item.albumart = state.albumart;
};

ControllerRtlsdrRadio.prototype.restoreQueueItem = function() {
  var self = this;
  var shown = self.shownOn;
  self.shownOn = null;
  if (!shown) {
    return;
  }
  // A DAB station's logo may have arrived while the station played
  var icon = null;
  var dab = /^rtlsdr:\/\/dab\/([^\/]+)\/(.+)$/.exec(String(shown.item.uri));
  if (dab) {
    try {
      icon = self.logos.icon(self.findDabStation(dab[1], decodeURIComponent(dab[2])));
    } catch (e) {
      // not a name that can be read back: the artwork the item came with
    }
  }
  shown.item.albumart = icon ? '/albumart?sourceicon=' + icon : shown.albumart;
};

ControllerRtlsdrRadio.prototype.pause = function() {
  var self = this;
  return self.stop();
};

ControllerRtlsdrRadio.prototype.resume = function() {
  var self = this;
  
  if (self.currentStation) {
    return self.clearAddPlayTrack(self.currentStation);
  }
  
  return libQ.resolve();
};

// Stop whatever uses the tuner (playback, a scan, an antenna tool) and reset what the
// session kept. Returns a promise resolved when the processes are gone. Safe to call
// at any time and more than once: only the processes this plugin started are stopped,
// by their own ids, and a job started afterwards is never reached.
ControllerRtlsdrRadio.prototype.stopDecoder = function() {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Stopping all processes');
  self.intentionalStop = true;
  
  // Stop DLS monitor
  self.stopDabDlsMonitor();
  
  // Forget the session. The processes belong to the tuner's job, not to these fields.
  self.decoderProcess = null;
  self.scanProcess = null;
  self.soxProcess = null;
  self.aplayProcess = null;
  self.redseaProcess = null;
  self.currentRds = null;
  self.rdsBuffer = '';
  self.lastRdsState = null;
  self.lastRdsUpdate = 0;
  self.lastSignalLevel = undefined;
  self.psHistory = [];
  self.stablePs = null;
  self.currentDls = null;
  self.lastDlsLabel = '';
  self.lastRawLabel = null;
  self.lastDabState = null;
  self.currentDabStation = null;
  self.lastValidAlbumart = null;
  self.lastValidArtist = null;
  self.lastValidTitle = null;
  // DON'T clear currentStation - needed for resume
  
  return self.tuner.stop('stop').then(function() {
    // Cleanup metadata directory, now that nothing writes to it
    if (!self.tuner.busy()) {
      self.cleanupDabMetadataDir();
    }
  });
};

// A process the playback cannot do without has ended by itself: the dongle was pulled
// out, the DAB service was not found, the audio device refused. Stop and say so,
// instead of showing "playing" over silence.
ControllerRtlsdrRadio.prototype.playbackEnded = function(job, entry) {
  var self = this;
  
  if (job.reported || self.tuner.current !== job) {
    return;
  }
  job.reported = true;
  
  var what = entry.command;
  if (entry.error) {
    what += ' could not be started (' + (entry.error.code || entry.error) + ')';
  } else if (entry.code !== null) {
    what += ' ended with code ' + entry.code;
  } else {
    what += ' ended by ' + entry.signal;
  }
  self.logger.error('[RTL-SDR Radio] Playback stopped: ' + what);
  var said = (entry.said || '').trim().split('\n').pop();
  if (said) {
    self.logger.error('[RTL-SDR Radio] ' + entry.command + ' said: ' + said.slice(0, 300));
  }
  
  // Through Volumio, so that the player shows the station as stopped
  self.commandRouter.stateMachine.stop();
  self.stop().then(function() {
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio',
      self.formatString(self.getI18nString('TOAST_PLAY_FAILED'), what));
  });
};

// The FM tune level, from a reading of the reception (lib/fmquality.js, once a second).
// A station without a pilot gives no reading; then what RDS tells is all there is.
// A new level is shown when it has held for a few seconds, the first one at once.
ControllerRtlsdrRadio.prototype.considerFmLevel = function(db, freq, stationName) {
  var self = this;
  if (!self.currentRds) {
    self.currentRds = {};
  }
  var rds = self.currentRds;
  
  var level = FmQuality.level(db);
  if (level !== null) {
    rds.signalPercent = Math.max(0, Math.min(100, Math.round(db * 2)));
  } else {
    level = rds.blerLevel || 0;
    rds.signalPercent = rds.blerSmoothed !== undefined ? Math.max(0, Math.round(100 - rds.blerSmoothed)) : 0;
  }
  rds.receptionDb = Math.round(db * 10) / 10;
  
  var now = Date.now();
  if (rds.signalLevel === undefined) {
    rds.signalLevel = level;
  } else if (level === rds.signalLevel) {
    rds.pendingLevel = undefined;
    return;
  } else if (rds.pendingLevel !== level) {
    rds.pendingLevel = level;
    rds.pendingSince = now;
    return;
  } else if (now - rds.pendingSince < self.SIGNAL_HOLD) {
    return;
  } else {
    rds.signalLevel = level;
    rds.pendingLevel = undefined;
  }
  
  self.logger.info('[RTL-SDR Radio] FM reception: ' + rds.receptionDb + ' dB, level ' + rds.signalLevel + '/5');
  self.pushRdsState(freq, stationName);
};

// The picture for a DAB station that has no artwork of its own at the moment: the
// station's logo, failing that its broadcaster's, the DAB icon otherwise. A station shown
// without a logo of its own has one fetched, if there is one to be had.
// now: the station is being played, so its logo goes before all others.
ControllerRtlsdrRadio.prototype.dabIcon = function(station, now) {
  if (station) {
    this.logos.want(station, { now: !!now });
  }
  return this.logos.icon(station) || 'music_service/rtlsdr_radio/assets/dab.svg';
};

ControllerRtlsdrRadio.prototype.findDabStation = function(channel, exactName) {
  var list = (this.stationsDb && this.stationsDb.dab) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].channel === channel && list[i].exactName === exactName) {
      return list[i];
    }
  }
  return null;
};

// Fetch, in the background, the logos that are due for the station list.
ControllerRtlsdrRadio.prototype.fetchLogos = function() {
  this.logos.sweep();
};

// A logo has arrived: if a DAB station is playing, show it where the station's icon is.
ControllerRtlsdrRadio.prototype.logoArrived = function() {
  var self = this;
  if (!self.currentDabStation || !self.playingJob) {
    return;
  }
  if (self.currentDls) {
    // Pushes only if what the screen shows has changed
    self.pushDabState();
    return;
  }
  // No text from the station yet: the state it started with, with the logo
  var first = self.dabFirstState;
  if (first && first.uri === self.currentDabStation.uri) {
    var playing = self.currentDabStation;
    var icon = '/albumart?sourceicon=' + self.dabIcon(self.findDabStation(playing.channel, playing.exactName));
    if (first.albumart !== icon) {
      first.albumart = icon;
      self.pushPlayingState(first);
    }
  }
};

// --- what the updater (lib/update.js) asks of the plugin --------------------------------

// The versions of this plugin the Volumio plugin store offers this player:
// [{ version, channel, url }]. The store answers only players signed in to MyVolumio,
// and names beta versions only to players in plugin test mode; both are the player's
// own rules, so the player's plugin manager is asked rather than the store itself.
ControllerRtlsdrRadio.prototype.storeVersions = function() {
  var self = this;

  function coded(code, message) {
    return Object.assign(new Error(message), { code: code });
  }

  function signedIn() {
    return new Promise(function(resolve) {
      try {
        Promise.resolve(self.commandRouter.getMyVolumioStatus()).then(function(status) {
          resolve(!!(status && status.loggedIn));
        }, function() { resolve(false); });
      } catch (e) {
        resolve(false);
      }
    });
  }

  return signedIn().then(function(yes) {
    if (!yes) {
      throw coded('store-login', 'the player is not signed in to MyVolumio');
    }
    return new Promise(function(resolve, reject) {
      // The plugin manager gives no answer at all when the store gives it none
      var timer = setTimeout(function() {
        reject(coded('store', 'no answer from the plugin store'));
      }, self.STORE_TIMEOUT);
      var asked;
      try {
        asked = self.commandRouter.getPluginDetails({ name: 'rtlsdr_radio' });
      } catch (e) {
        clearTimeout(timer);
        reject(coded('store', e.message));
        return;
      }
      Promise.resolve(asked).then(function(details) {
        clearTimeout(timer);
        var versions = [];
        ((details && details.buttons) || []).forEach(function(button) {
          var url = String((button && button.payload && button.payload.url) || '');
          var found = /\/pluginsv2\/download\/rtlsdr_radio\/([^\/]+)\//.exec(url);
          var channel = /\((stable|beta)\)\s*$/.exec(String((button && button.name) || ''));
          if (found) {
            // A version whose channel is not said is not passed off as stable
            versions.push({ version: found[1], channel: channel ? channel[1] : 'beta', url: url });
          }
        });
        resolve(versions);
      }, function(e) {
        clearTimeout(timer);
        reject(coded('store', e && e.message || String(e)));
      });
    });
  });
};

// Settings and lists backed up before an update replaces the plugin
ControllerRtlsdrRadio.prototype.backupBeforeUpdate = function() {
  var self = this;
  var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  ['createStationsBackup', 'createConfigBackup', 'createBlocklistBackup'].forEach(function(make) {
    self[make](timestamp).fail(function(e) {
      self.logger.info('[RTL-SDR Radio] Update: ' + make + ': ' + e);
    });
  });
};

// The player's plugin manager installs the zip at the given address, as it installs
// any update of a plugin: it stops this plugin, replaces its folder, runs the
// installer and enables the plugin again.
ControllerRtlsdrRadio.prototype.applyUpdate = function(url) {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.commandRouter.updatePlugin({ url: url, category: 'music_service', name: 'rtlsdr_radio' }).then(function() {
      // The plugin manager writes "enabled" a moment after it says it is done; a
      // restart that lands before that brings the plugin back installed and off
      self.enabledInRegistry().then(resolve);
    }, function(e) {
      reject(e instanceof Error ? e : new Error(String(e || 'the plugin manager refused the update')));
    });
  });
};

// Resolves when the player's list of plugins shows this one enabled, or after six
// seconds whatever it shows.
ControllerRtlsdrRadio.prototype.enabledInRegistry = function() {
  var self = this;

  function enabled() {
    try {
      var entry = fs.readJsonSync('/data/configuration/plugins.json').music_service.rtlsdr_radio;
      return entry.enabled.value === true;
    } catch (e) {
      return false;
    }
  }

  return new Promise(function(resolve) {
    var tries = 0;
    (function look() {
      if (enabled()) {
        resolve();
        return;
      }
      if (tries === 2) {
        try {
          var registry = self.commandRouter.pluginManager.config;
          registry.set('music_service.rtlsdr_radio.enabled', true);
          registry.set('music_service.rtlsdr_radio.status', 'STARTED');
          self.logger.info('[RTL-SDR Radio] Update: the plugin was not shown as enabled; set');
        } catch (e) {
          self.logger.info('[RTL-SDR Radio] Update: the list of plugins could not be set: ' + e.message);
        }
      }
      if (++tries > 12) {
        self.logger.info('[RTL-SDR Radio] Update: the plugin is still not shown as enabled; restarting anyway');
        resolve();
        return;
      }
      setTimeout(look, 500);
    })();
  });
};

// Restart the player's backend a moment from now, so that the new code is loaded: Node
// keeps a plugin's code in memory until the backend ends. The request goes to systemd
// as one restart job; a stop followed by a start from inside the service would end with
// the stop, which takes the process waiting to start it again with it.
ControllerRtlsdrRadio.prototype.restartBackend = function() {
  var self = this;
  self.logger.info('[RTL-SDR Radio] Update: restarting the backend');
  try {
    var child = require('child_process').spawn('/bin/sh', ['-c', 'sleep 3; sudo -n /bin/systemctl --no-block restart volumio'],
      { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Update: the backend could not be restarted: ' + e.message);
  }
};

// A number from the configuration, whatever type it was stored as.
ControllerRtlsdrRadio.prototype.numberSetting = function(key, fallback) {
  var value = Number(this.config.get(key, fallback));
  return isFinite(value) ? value : fallback;
};

ControllerRtlsdrRadio.prototype.testManualFm = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  // Try to get value from data parameter (current form value), fall back to config (saved value)
  var frequency = (data && data.manual_fm_frequency) || self.config.get('manual_fm_frequency', '98.8');
  
  self.logger.info('[RTL-SDR Radio] Testing manual FM: ' + frequency);
  
  // Validate frequency
  var freq = parseFloat(frequency);
  var regionSettings = self.getRegionSettings();
  var lowerFreq = regionSettings.band_start;
  if (isNaN(freq) || freq < lowerFreq || freq > 108) {
    self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
      self.getI18nString('TEST_FM_FAILED').replace('{0}', 'Invalid frequency. Enter ' + lowerFreq + ' - 108.0 MHz'));
    defer.reject(new Error('Invalid frequency'));
    return defer.promise;
  }
  
  // Ensure consistent decimal format - preserve precision for 50kHz spacing
  var hasSubDecimal = (freq * 100) % 10 !== 0;
  var freqStr = hasSubDecimal ? freq.toFixed(2) : freq.toFixed(1);
  
  // Create track object
  var track = {
    uri: 'rtlsdr://fm/' + freqStr,
    name: 'FM ' + freqStr + ' (Test)',
    service: 'rtlsdr_radio'
  };
  
  // Play the station
  self.clearAddPlayTrack(track)
    .then(function() {
      self.commandRouter.pushToastMessage('success', self.getI18nString('FM_RADIO'), 
        self.getI18nString('TESTING_FM').replace('{0}', freqStr));
      defer.resolve();
    })
    .fail(function(e) {
      self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
        self.getI18nString('TEST_FM_FAILED').replace('{0}', e.message || e));
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.testManualDab = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  // Try to get values from data parameter (current form values), fall back to config (saved values)
  var ensemble = (data && data.manual_dab_ensemble) || self.config.get('manual_dab_ensemble', '12B');
  var serviceName = (data && data.manual_dab_service) || self.config.get('manual_dab_service', '');
  var testGain = parseInt((data && data.manual_dab_gain) || self.config.get('manual_dab_gain', 80));
  var testPpm = parseInt((data && data.manual_dab_ppm) || self.config.get('manual_dab_ppm', 0));
  
  self.logger.info('[RTL-SDR Radio] Testing manual DAB: ' + ensemble + '/' + serviceName + ' (gain: ' + testGain + ', ppm: ' + testPpm + ')');
  
  // Validate inputs
  if (!ensemble || ensemble.trim() === '') {
    self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
      self.getI18nString('TEST_DAB_FAILED').replace('{0}', 'Ensemble required'));
    defer.reject(new Error('Ensemble required'));
    return defer.promise;
  }
  
  if (!serviceName || serviceName.trim() === '') {
    self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
      self.getI18nString('TEST_DAB_FAILED').replace('{0}', 'Service name required'));
    defer.reject(new Error('Service name required'));
    return defer.promise;
  }
  
  // Store current DAB settings
  var originalGain = self.config.get('dab_gain', 80);
  var originalPpm = self.config.get('dab_ppm', 0);
  
  // Temporarily set test values
  self.config.set('dab_gain', testGain);
  self.config.set('dab_ppm', testPpm);
  
  // Create track object (DAB URI format: rtlsdr://dab/{ensemble}/{serviceName})
  var track = {
    uri: 'rtlsdr://dab/' + encodeURIComponent(ensemble) + '/' + encodeURIComponent(serviceName),
    name: serviceName + ' (Test)',
    service: 'rtlsdr_radio'
  };
  
  // Play the station
  self.clearAddPlayTrack(track)
    .then(function() {
      self.commandRouter.pushToastMessage('success', self.getI18nString('DAB_RADIO'), 
        self.getI18nString('TESTING_DAB').replace('{0}', serviceName));
      
      // Restore original settings after test duration
      setTimeout(function() {
        self.config.set('dab_gain', originalGain);
        self.config.set('dab_ppm', originalPpm);
        self.logger.info('[RTL-SDR Radio] Restored DAB settings (gain: ' + originalGain + ', ppm: ' + originalPpm + ')');
      }, self.TEST_PLAYBACK_DURATION);
      
      defer.resolve();
    })
    .fail(function(e) {
      // Restore original settings on failure
      self.config.set('dab_gain', originalGain);
      self.config.set('dab_ppm', originalPpm);
      
      self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
        self.getI18nString('TEST_DAB_FAILED').replace('{0}', e.message || e));
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.saveConfig = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Saving configuration');
  
  // Save configuration values
  if (data.fm_enabled !== undefined) {
    self.config.set('fm_enabled', data.fm_enabled);
  }
  if (data.dab_enabled !== undefined) {
    self.config.set('dab_enabled', data.dab_enabled);
  }
  if (data.fm_gain !== undefined) {
    var fmGain = parseInt(data.fm_gain);
    if (!isNaN(fmGain) && fmGain >= 0 && fmGain <= 100) {
      self.config.set('fm_gain', fmGain);
    }
  }
  if (data.dab_gain !== undefined) {
    var dabGain = parseInt(data.dab_gain);
    if (!isNaN(dabGain) && dabGain >= 0 && dabGain <= 100) {
      self.config.set('dab_gain', dabGain);
    }
  }
  if (data.scan_sensitivity !== undefined) {
    // Dropdown sends {value: X, label: "..."} object, extract value
    var sensitivityValue = data.scan_sensitivity.value || data.scan_sensitivity;
    var sensitivity = parseInt(sensitivityValue);
    if (!isNaN(sensitivity)) {
      self.config.set('scan_sensitivity', sensitivity);
      self.logger.info('[RTL-SDR Radio] Scan sensitivity set to +' + sensitivity + ' dB');
    }
  }
  
  self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', self.getI18nString('TOAST_CONFIG_SAVED'));
  defer.resolve();
  
  return defer.promise;
};

// Turn what was read from a file into a database this version can use.
// Returns { db: <database>, migrated: <boolean> } or null.
ControllerRtlsdrRadio.prototype.prepareDatabase = function(data, source) {
  var self = this;
  var version = self.getDatabaseVersion(data);
  
  if (version < 2) {
    self.logger.info('[RTL-SDR Radio] Migrating database from v' + version + ' to v2 (' + source + ')');
    var migrated = self.migrateDatabase(data);
    if (migrated) {
      return { db: migrated, migrated: true };
    }
    self.logger.error('[RTL-SDR Radio] Migration failed (' + source + ')');
    return null;
  }
  
  if (version === 2) {
    var validation = self.validateDatabaseV2(data);
    if (validation.valid) {
      return { db: data, migrated: false };
    }
    self.logger.error('[RTL-SDR Radio] Database validation failed (' + source + '): ' +
      validation.errors.join(', '));
    return null;
  }
  
  self.logger.error('[RTL-SDR Radio] Unsupported database version ' + version + ' (' + source + ')');
  return null;
};

ControllerRtlsdrRadio.prototype.loadStations = function() {
  var self = this;
  var stationsFile = self.stationsDbFile;
  
  // Earlier versions kept the list in the plugin's own folder, which Volumio
  // removes on every update
  var broughtOver = false;
  try {
    broughtOver = storage.migrateLegacy('stations');
    if (broughtOver) {
      self.logger.info('[RTL-SDR Radio] Moved the station list to ' + stationsFile);
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Could not move the station list: ' + e);
  }
  
  var prepared = null;
  var restoredFrom = null;
  var result = storage.read('stations');
  
  if (result.data) {
    prepared = self.prepareDatabase(result.data, stationsFile);
    // During an update the earlier version may be started once more in the new folder
    // and leave an empty list there. An empty list brought over from the plugin folder
    // does not stand in the way of a backup that has stations.
    if (prepared && broughtOver &&
        (prepared.db.fm || []).length === 0 && (prepared.db.dab || []).length === 0) {
      self.logger.info('[RTL-SDR Radio] The list brought over is empty; looking for a backup');
      prepared = null;
      try { fs.removeSync(stationsFile); } catch (e) {}
    } else if (!prepared) {
      // Set aside what is there: the next save must not overwrite it
      var aside = stationsFile + '.invalid-' + new Date().toISOString().replace(/[:.]/g, '-');
      try {
        fs.moveSync(stationsFile, aside, { overwrite: true });
        self.logger.info('[RTL-SDR Radio] Kept the unusable station list as ' + aside);
      } catch (e) {
        self.logger.error('[RTL-SDR Radio] Could not set the unusable station list aside: ' + e);
      }
    }
  } else if (result.unreadable) {
    self.logger.error('[RTL-SDR Radio] Station list unreadable (' + result.error + '), kept as ' + result.movedTo);
  } else {
    self.logger.info('[RTL-SDR Radio] No station list found');
  }
  
  if (!prepared) {
    // Missing, unreadable or unusable: the last good copy or the newest backup
    var candidate = storage.fallback('stations', function(data) {
      return self.prepareDatabase(data, 'backup');
    });
    if (candidate) {
      prepared = candidate.accepted;
      restoredFrom = candidate.from;
    }
  }
  
  if (prepared) {
    self.stationsDb = prepared.db;
    self.logger.info('[RTL-SDR Radio] Loaded v2 database successfully');
    if (prepared.migrated || restoredFrom) {
      self.saveStations();
    }
    if (prepared.migrated) {
      self.commandRouter.pushToastMessage('info', 'FM/DAB Radio',
        self.getI18nString('TOAST_DB_UPGRADED'));
    }
    if (restoredFrom) {
      self.logger.info('[RTL-SDR Radio] Station list restored from ' + restoredFrom);
      self.commandRouter.pushToastMessage('info', 'FM/DAB Radio',
        self.getI18nString('TOAST_DB_RESTORED'));
    }
  } else {
    self.logger.info('[RTL-SDR Radio] Starting with an empty station list');
    self.stationsDb = self.createEmptyDatabaseV2();
  }
  
  // Record when database was loaded for diagnostics
  self.dbLoadedAt = new Date().toISOString();
  self.logger.info('[RTL-SDR Radio] Database loaded at: ' + self.dbLoadedAt);
  
  // Repair FM frequencies that were saved as numbers instead of strings
  // Preserve original precision (50kHz spacing needs 2 decimals)
  var repaired = 0;
  if (self.stationsDb && self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (typeof station.frequency === 'number') {
        // Preserve precision - use 2 decimals if needed, otherwise 1
        var freq = station.frequency;
        var hasSubDecimal = (freq * 100) % 10 !== 0;
        station.frequency = hasSubDecimal ? freq.toFixed(2) : freq.toFixed(1);
        repaired++;
      }
    });
    if (repaired > 0) {
      self.logger.info('[RTL-SDR Radio] Repaired ' + repaired + ' FM frequency values (number->string)');
      self.saveStations();
    }
  }
  
  return libQ.resolve();
};

// Save the station list. Returns true when it is on disk and false when it is not;
// a failure is logged and shown, at most once a minute.
ControllerRtlsdrRadio.prototype.saveStations = function() {
  var self = this;
  var problem = null;
  
  try {
    // Validate before saving
    if (self.stationsDb.version === 2) {
      var validation = self.validateDatabaseV2(self.stationsDb);
      if (!validation.valid) {
        problem = 'invalid database: ' + validation.errors.join(', ');
      }
    }
    
    if (!problem) {
      storage.write('stations', self.stationsDb);
      self.logger.info('[RTL-SDR Radio] Saved stations database');
      return true;
    }
  } catch (e) {
    problem = e.toString();
  }
  
  self.logger.error('[RTL-SDR Radio] Failed to save stations: ' + problem);
  var now = Date.now();
  if (!self.lastSaveFailureToast || now - self.lastSaveFailureToast > 60000) {
    self.lastSaveFailureToast = now;
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio',
      self.getI18nString('TOAST_DB_SAVE_FAILED'));
  }
  return false;
};

// ========== ARTWORK BLOCK LIST FUNCTIONS ==========

ControllerRtlsdrRadio.prototype.getDefaultBlocklistPhrases = function() {
  // Default phrases that should NOT trigger artwork lookup
  // These are station slogans, show names, promotional messages
  return [
    'We love pop',
    'We love music',
    'We love hits',
    'We love rock',
    'We play the hits',
    'We play the best',
    'The best hits',
    'The best music',
    'The home of',
    'More music',
    'More hits',
    'All the hits',
    'Non-stop music',
    'Non-stop hits',
    'Feel good music',
    'Feel good hits',
    'at Breakfast with',
    'at Drivetime with',
    'at Lunch with',
    'Greatest Hits Radio',
    'when you wake up'
  ];
};

ControllerRtlsdrRadio.prototype.getBlocklistPhrases = function() {
  var self = this;
  
  try {
    storage.migrateLegacy('blocklist');
    var result = storage.read('blocklist');
    if (result.unreadable) {
      self.logger.error('[RTL-SDR Radio] Blocklist unreadable (' + result.error + '), kept as ' + result.movedTo);
    }
    if (!result.data) {
      // Missing or unreadable: the last good copy or the newest backup
      var candidate = storage.fallback('blocklist', function(data) {
        return Array.isArray(data.phrases);
      });
      if (candidate) {
        self.logger.info('[RTL-SDR Radio] Blocklist restored from ' + candidate.from);
        storage.write('blocklist', candidate.data);
        result = { data: candidate.data };
      }
    }
    if (result.data) {
      return result.data.phrases || [];
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Error loading blocklist: ' + e);
  }
  
  // Return defaults if file doesn't exist or error
  return self.getDefaultBlocklistPhrases();
};

ControllerRtlsdrRadio.prototype.saveBlocklistPhrases = function(phrases) {
  var self = this;
  
  try {
    storage.write('blocklist', { 
      phrases: phrases,
      updated: new Date().toISOString()
    });
    self.logger.info('[RTL-SDR Radio] Saved blocklist with ' + phrases.length + ' phrases');
    
    // Update metadata module with new phrases
    self.updateMetadataBlocklist(phrases);
    
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save blocklist: ' + e);
    throw e;
  }
};

ControllerRtlsdrRadio.prototype.resetBlocklistPhrases = function() {
  var self = this;
  var phrases = self.getDefaultBlocklistPhrases();
  self.saveBlocklistPhrases(phrases);
  return phrases;
};

ControllerRtlsdrRadio.prototype.updateMetadataBlocklist = function(phrases) {
  var self = this;
  
  // Update the metadata module with user phrases
  if (typeof metadata !== 'undefined' && metadata.setUserPhrases) {
    metadata.setUserPhrases(phrases);
    self.logger.info('[RTL-SDR Radio] Updated metadata blocklist');
  }
};

ControllerRtlsdrRadio.prototype.loadBlocklistOnStartup = function() {
  var self = this;
  
  // Load user blocklist and apply to metadata module
  self.logger.info('[RTL-SDR Radio] Loading blocklist from: ' + storage.file('blocklist'));
  
  var phrases = self.getBlocklistPhrases();
  self.logger.info('[RTL-SDR Radio] Got ' + phrases.length + ' phrases from file');
  
  self.updateMetadataBlocklist(phrases);
  
  // Verify it was set
  var loaded = metadata.getUserPhrases();
  self.logger.info('[RTL-SDR Radio] Metadata module now has ' + loaded.length + ' phrases');
};

// ========== DATABASE V2 FUNCTIONS ==========

ControllerRtlsdrRadio.prototype.getDatabaseVersion = function(db) {
  var self = this;
  
  if (!db || typeof db !== 'object') {
    return 1;
  }
  
  // Check for version field
  if (db.version && typeof db.version === 'number') {
    return db.version;
  }
  
  // Check for v2 structure (groups and settings objects)
  if (db.groups && db.settings) {
    return 2;
  }
  
  // Default to v1
  return 1;
};

ControllerRtlsdrRadio.prototype.createEmptyDatabaseV2 = function() {
  var self = this;
  
  return {
    version: 2,
    fm: [],
    dab: [],
    groups: self.createBuiltinGroups(),
    settings: self.createDefaultSettings()
  };
};

ControllerRtlsdrRadio.prototype.createBuiltinGroups = function() {
  var self = this;
  
  return {
    favorites: {
      id: 'favorites',
      name: self.getI18nString('FAVORITES'),
      icon: 'fa fa-star',
      order: 0,
      builtin: true,
      type: 'both',
      description: 'Your favorite stations'
    },
    recent: {
      id: 'recent',
      name: self.getI18nString('RECENTLY_PLAYED'),
      icon: 'fa fa-history',
      order: 1,
      builtin: true,
      type: 'both',
      description: 'Last 10 played stations'
    },
    all_fm: {
      id: 'all_fm',
      name: 'All FM Stations',
      icon: 'fa fa-signal',
      order: 100,
      builtin: true,
      type: 'fm',
      description: 'All scanned FM stations'
    },
    all_dab: {
      id: 'all_dab',
      name: 'All DAB Stations',
      icon: 'fa fa-rss',
      order: 101,
      builtin: true,
      type: 'dab',
      description: 'All scanned DAB stations'
    }
  };
};

ControllerRtlsdrRadio.prototype.createDefaultSettings = function() {
  var self = this;
  
  return {
    showHidden: false,
    defaultView: 'grouped',
    sortStations: 'frequency',
    recentlyPlayedCount: 10,
    autoHideWeakSignals: false,
    signalThreshold: -40
  };
};

ControllerRtlsdrRadio.prototype.transformStationToV2 = function(station, type) {
  var self = this;
  var now = new Date().toISOString();
  
  // Base v2 fields
  var v2Station = {
    customName: null,
    hidden: false,
    favorite: false,
    groups: [],
    notes: '',
    playCount: 0,
    lastPlayed: null,
    dateAdded: station.last_seen || now,
    userCreated: false,
    deleted: false,
    availableAgain: false
  };
  
  // Merge with existing station data
  for (var key in station) {
    if (station.hasOwnProperty(key)) {
      v2Station[key] = station[key];
    }
  }
  
  return v2Station;
};

ControllerRtlsdrRadio.prototype.backupDatabase = function(suffix) {
  var self = this;
  var stationsFile = self.stationsDbFile;
  
  try {
    if (!fs.existsSync(stationsFile)) {
      return null;
    }
    
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    var backupFile = stationsFile + '.' + suffix + '.' + timestamp + '.backup';
    
    fs.copySync(stationsFile, backupFile);
    self.logger.info('[RTL-SDR Radio] Created backup: ' + backupFile);
    
    return backupFile;
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to create backup: ' + e);
    return null;
  }
};

ControllerRtlsdrRadio.prototype.migrateDatabase = function(oldDb) {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Starting database migration to v2');
  
  try {
    // Create backup before migration
    var backupFile = self.backupDatabase('v1');
    if (backupFile) {
      self.logger.info('[RTL-SDR Radio] Backup created: ' + backupFile);
    }
    
    // Create new v2 structure
    var newDb = self.createEmptyDatabaseV2();
    
    // Migrate FM stations
    if (oldDb.fm && Array.isArray(oldDb.fm)) {
      newDb.fm = oldDb.fm.map(function(station) {
        return self.transformStationToV2(station, 'fm');
      });
      self.logger.info('[RTL-SDR Radio] Migrated ' + newDb.fm.length + ' FM stations');
    }
    
    // Migrate DAB stations
    if (oldDb.dab && Array.isArray(oldDb.dab)) {
      newDb.dab = oldDb.dab.map(function(station) {
        return self.transformStationToV2(station, 'dab');
      });
      self.logger.info('[RTL-SDR Radio] Migrated ' + newDb.dab.length + ' DAB stations');
    }
    
    // Validate migrated database
    var validation = self.validateDatabaseV2(newDb);
    if (!validation.valid) {
      self.logger.error('[RTL-SDR Radio] Migration produced invalid database: ' + 
        validation.errors.join(', '));
      return null;
    }
    
    self.logger.info('[RTL-SDR Radio] Migration completed successfully');
    return newDb;
    
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Migration failed: ' + e);
    return null;
  }
};

ControllerRtlsdrRadio.prototype.validateDatabaseV2 = function(db) {
  var self = this;
  var errors = [];
  
  // Check version
  if (!db.version || db.version !== 2) {
    errors.push('Missing or invalid version field');
  }
  
  // Check fm array
  if (!db.fm || !Array.isArray(db.fm)) {
    errors.push('Missing or invalid fm array');
  }
  
  // Check dab array
  if (!db.dab || !Array.isArray(db.dab)) {
    errors.push('Missing or invalid dab array');
  }
  
  // Check groups object
  if (!db.groups || typeof db.groups !== 'object') {
    errors.push('Missing or invalid groups object');
  } else {
    // Check for required builtin groups
    var requiredGroups = ['favorites', 'recent', 'all_fm', 'all_dab'];
    requiredGroups.forEach(function(groupId) {
      if (!db.groups[groupId]) {
        errors.push('Missing builtin group: ' + groupId);
      }
    });
  }
  
  // Check settings object
  if (!db.settings || typeof db.settings !== 'object') {
    errors.push('Missing or invalid settings object');
  }
  
  // Validate FM stations have required fields
  if (db.fm && Array.isArray(db.fm)) {
    db.fm.forEach(function(station, index) {
      if (!station.frequency) {
        errors.push('FM station ' + index + ' missing frequency');
      }
      if (typeof station.hidden !== 'boolean') {
        errors.push('FM station ' + index + ' missing hidden flag');
      }
      if (typeof station.favorite !== 'boolean') {
        errors.push('FM station ' + index + ' missing favorite flag');
      }
    });
  }
  
  // Validate DAB stations have required fields
  if (db.dab && Array.isArray(db.dab)) {
    db.dab.forEach(function(station, index) {
      if (!station.channel) {
        errors.push('DAB station ' + index + ' missing channel');
      }
      if (!station.serviceId) {
        errors.push('DAB station ' + index + ' missing serviceId');
      }
      if (typeof station.hidden !== 'boolean') {
        errors.push('DAB station ' + index + ' missing hidden flag');
      }
      if (typeof station.favorite !== 'boolean') {
        errors.push('DAB station ' + index + ' missing favorite flag');
      }
    });
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
};

ControllerRtlsdrRadio.prototype.getStationByUri = function(uri) {
  var self = this;
  
  if (!uri || typeof uri !== 'string') {
    return null;
  }
  
  // Parse FM URI: rtlsdr://fm/95.0
  if (uri.indexOf('rtlsdr://fm/') === 0) {
    var frequency = uri.replace('rtlsdr://fm/', '');
    var freqNum = parseFloat(frequency);
    
    if (self.stationsDb && self.stationsDb.fm && !isNaN(freqNum)) {
      for (var i = 0; i < self.stationsDb.fm.length; i++) {
        // Compare as numbers to handle precision differences (95.75 vs 95.8)
        if (parseFloat(self.stationsDb.fm[i].frequency) === freqNum) {
          return {
            type: 'fm',
            station: self.stationsDb.fm[i],
            index: i
          };
        }
      }
    }
  }
  
  // Parse DAB URI: rtlsdr://dab/<channel>/<serviceName>
  if (uri.indexOf('rtlsdr://dab/') === 0) {
    var dabParts = uri.replace('rtlsdr://dab/', '').split('/');
    if (dabParts.length >= 2) {
      var channel = dabParts[0];
      var serviceName = decodeURIComponent(dabParts[1]);
      
      if (self.stationsDb && self.stationsDb.dab) {
        for (var i = 0; i < self.stationsDb.dab.length; i++) {
          var station = self.stationsDb.dab[i];
          if (station.channel === channel && station.exactName === serviceName) {
            return {
              type: 'dab',
              station: station,
              index: i
            };
          }
        }
      }
    }
  }
  
  return null;
};

ControllerRtlsdrRadio.prototype.updateStation = function(uri, updates) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var stationInfo = self.getStationByUri(uri);
    
    if (!stationInfo) {
      self.logger.error('[RTL-SDR Radio] Station not found: ' + uri);
      defer.reject(new Error(self.getI18nString('TOAST_STATION_NOT_FOUND')));
      return defer.promise;
    }
    
    // Apply updates
    for (var key in updates) {
      if (updates.hasOwnProperty(key)) {
        stationInfo.station[key] = updates[key];
      }
    }
    
    // Save database
    self.saveStations();
    
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to update station: ' + e);
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.getFavoriteStations = function() {
  var self = this;
  var favorites = [];
  
  // Get FM favorites
  if (self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (station.favorite && !station.deleted && !station.hidden) {
        favorites.push({
          type: 'fm',
          station: station
        });
      }
    });
  }
  
  // Get DAB favorites
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (station.favorite && !station.deleted && !station.hidden) {
        favorites.push({
          type: 'dab',
          station: station
        });
      }
    });
  }
  
  return favorites;
};

ControllerRtlsdrRadio.prototype.getRecentStations = function(count) {
  var self = this;
  var recent = [];
  count = count || self.stationsDb.settings.recentlyPlayedCount || 10;
  
  // Combine FM and DAB stations
  var allStations = [];
  
  if (self.stationsDb.fm) {
    self.stationsDb.fm.forEach(function(station) {
      if (!station.deleted && !station.hidden && station.lastPlayed) {
        allStations.push({
          type: 'fm',
          station: station,
          lastPlayed: new Date(station.lastPlayed).getTime()
        });
      }
    });
  }
  
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (!station.deleted && !station.hidden && station.lastPlayed) {
        allStations.push({
          type: 'dab',
          station: station,
          lastPlayed: new Date(station.lastPlayed).getTime()
        });
      }
    });
  }
  
  // Sort by lastPlayed descending
  allStations.sort(function(a, b) {
    return b.lastPlayed - a.lastPlayed;
  });
  
  // Return top N
  return allStations.slice(0, count);
};

ControllerRtlsdrRadio.prototype.getStationsByEnsemble = function() {
  var self = this;
  var ensembles = {};
  
  // Group DAB stations by ensemble
  if (self.stationsDb.dab) {
    self.stationsDb.dab.forEach(function(station) {
      if (station.deleted || station.hidden) {
        return;
      }
      
      var ensembleName = station.ensemble;
      if (!ensembles[ensembleName]) {
        ensembles[ensembleName] = {
          name: ensembleName,
          channel: station.channel,
          stations: []
        };
      }
      ensembles[ensembleName].stations.push(station);
    });
  }
  
  // Convert to sorted array
  var ensembleArray = Object.keys(ensembles).map(function(key) {
    return ensembles[key];
  }).sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });
  
  return ensembleArray;
};

ControllerRtlsdrRadio.prototype.renameStation = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  var uri = data.uri;
  var customName = data.customName || null;
  
  self.logger.info('[RTL-SDR Radio] Rename station: ' + uri + ' to ' + customName);
  
  self.updateStation(uri, { customName: customName })
    .then(function() {
      self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', self.getI18nString('TOAST_STATION_RENAMED'));
      defer.resolve();
    })
    .fail(function(e) {
      self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', self.getI18nString('TOAST_RENAME_FAILED'));
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.restoreStation = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  var uri = data.uri;
  
  self.logger.info('[RTL-SDR Radio] Restore station: ' + uri);
  
  self.updateStation(uri, { deleted: false, availableAgain: false })
    .then(function() {
      self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', self.getI18nString('TOAST_RESTORED'));
      defer.resolve();
    })
    .fail(function(e) {
      self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', self.getI18nString('TOAST_RESTORE_FAILED'));
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.purgeStation = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  var uri = data.uri;
  
  self.logger.info('[RTL-SDR Radio] Purge station: ' + uri);
  
  try {
    var stationInfo = self.getStationByUri(uri);
    
    if (!stationInfo) {
      self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', self.getI18nString('TOAST_STATION_NOT_FOUND'));
      defer.reject(new Error(self.getI18nString('TOAST_STATION_NOT_FOUND')));
      return defer.promise;
    }
    
    // Remove from array
    if (stationInfo.type === 'fm') {
      self.stationsDb.fm.splice(stationInfo.index, 1);
    } else if (stationInfo.type === 'dab') {
      self.stationsDb.dab.splice(stationInfo.index, 1);
    }
    
    // Save database
    self.saveStations();
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', self.getI18nString('TOAST_PURGED'));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to purge station: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', self.getI18nString('TOAST_PURGE_FAILED'));
    defer.reject(e);
  }
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.purgeDeletedStations = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Purge all deleted stations');
  
  try {
    var count = 0;
    
    // Filter out deleted FM stations
    if (self.stationsDb.fm) {
      var originalLength = self.stationsDb.fm.length;
      self.stationsDb.fm = self.stationsDb.fm.filter(function(station) {
        return !station.deleted;
      });
      count += originalLength - self.stationsDb.fm.length;
    }
    
    // Filter out deleted DAB stations
    if (self.stationsDb.dab) {
      var originalLength = self.stationsDb.dab.length;
      self.stationsDb.dab = self.stationsDb.dab.filter(function(station) {
        return !station.deleted;
      });
      count += originalLength - self.stationsDb.dab.length;
    }
    
    // Save database
    self.saveStations();
    
    self.commandRouter.pushToastMessage('success', 'FM/DAB Radio', 
      self.formatString(self.getI18nString('TOAST_PURGED_COUNT'), count));
    defer.resolve();
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to purge deleted stations: ' + e);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', self.getI18nString('TOAST_PURGE_ALL_FAILED'));
    defer.reject(e);
  }
  
  return defer.promise;
};

// ========== RESCAN MERGE LOGIC - Phase 5.5 ==========

ControllerRtlsdrRadio.prototype.mergeFmScanResults = function(newStations) {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Merging FM scan results with existing database');
  
  var mergedStations = [];
  var existingMap = {};
  var reappearedCount = 0;
  
  // Create map of existing stations by frequency
  if (self.stationsDb.fm && self.stationsDb.fm.length > 0) {
    self.stationsDb.fm.forEach(function(station) {
      existingMap[station.frequency] = station;
    });
  }
  
  // Process each scanned station
  newStations.forEach(function(newStation) {
    var frequency = newStation.frequency;
    var existingStation = existingMap[frequency];
    
    if (existingStation) {
      // Station exists - merge data
      var mergedStation = self.mergeStationData(existingStation, newStation, 'fm');
      
      // Check if deleted station reappeared
      if (existingStation.deleted && !existingStation.availableAgain) {
        mergedStation.availableAgain = true;
        reappearedCount++;
        self.logger.info('[RTL-SDR Radio] Deleted FM station reappeared: ' + frequency + ' MHz');
      }
      
      mergedStations.push(mergedStation);
      
      // Mark as processed
      delete existingMap[frequency];
    } else {
      // New station - add with default v2 fields
      var newStationV2 = self.transformStationToV2(newStation, 'fm');
      mergedStations.push(newStationV2);
      self.logger.info('[RTL-SDR Radio] New FM station discovered: ' + frequency + ' MHz');
    }
  });
  
  // Add remaining existing stations that weren't in scan
  // (Keep user-deleted stations, manual entries, etc.)
  for (var frequency in existingMap) {
    if (existingMap.hasOwnProperty(frequency)) {
      mergedStations.push(existingMap[frequency]);
      self.logger.info('[RTL-SDR Radio] Keeping existing FM station not in scan: ' + frequency + ' MHz');
    }
  }
  
  // Sort by frequency
  mergedStations.sort(function(a, b) {
    return parseFloat(a.frequency) - parseFloat(b.frequency);
  });
  
  self.logger.info('[RTL-SDR Radio] FM merge complete: ' + newStations.length + ' scanned, ' + 
                  mergedStations.length + ' total, ' + reappearedCount + ' reappeared');
  
  if (reappearedCount > 0) {
    self.commandRouter.pushToastMessage('info', self.getI18nString('FM_RADIO'), 
      self.formatString(self.getI18nString('TOAST_FM_REAPPEARED'), reappearedCount));
  }
  
  return mergedStations;
};

ControllerRtlsdrRadio.prototype.mergeDabScanResults = function(newStations) {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Merging DAB scan results with existing database');
  
  var mergedStations = [];
  var existingMap = {};
  var reappearedCount = 0;
  
  // Create map of existing stations by channel + serviceId
  if (self.stationsDb.dab && self.stationsDb.dab.length > 0) {
    self.stationsDb.dab.forEach(function(station) {
      var key = station.channel + '|' + station.serviceId;
      existingMap[key] = station;
    });
  }
  
  // Process each scanned station
  newStations.forEach(function(newStation) {
    var key = newStation.channel + '|' + newStation.serviceId;
    var existingStation = existingMap[key];
    
    if (existingStation) {
      // Station exists - merge data
      var mergedStation = self.mergeStationData(existingStation, newStation, 'dab');
      
      // Check if deleted station reappeared
      if (existingStation.deleted && !existingStation.availableAgain) {
        mergedStation.availableAgain = true;
        reappearedCount++;
        self.logger.info('[RTL-SDR Radio] Deleted DAB station reappeared: ' + 
                        newStation.name + ' on ' + newStation.channel);
      }
      
      mergedStations.push(mergedStation);
      
      // Mark as processed
      delete existingMap[key];
    } else {
      // New station - add with default v2 fields
      var newStationV2 = self.transformStationToV2(newStation, 'dab');
      mergedStations.push(newStationV2);
      self.logger.info('[RTL-SDR Radio] New DAB station discovered: ' + 
                      newStation.name + ' on ' + newStation.channel);
    }
  });
  
  // Add remaining existing stations that weren't in scan
  // (Keep user-deleted stations, manual entries, etc.)
  for (var key in existingMap) {
    if (existingMap.hasOwnProperty(key)) {
      var station = existingMap[key];
      mergedStations.push(station);
      self.logger.info('[RTL-SDR Radio] Keeping existing DAB station not in scan: ' + 
                      station.name + ' on ' + station.channel);
    }
  }
  
  // Sort alphabetically by name
  mergedStations.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });
  
  self.logger.info('[RTL-SDR Radio] DAB merge complete: ' + newStations.length + ' scanned, ' + 
                  mergedStations.length + ' total, ' + reappearedCount + ' reappeared');
  
  if (reappearedCount > 0) {
    self.commandRouter.pushToastMessage('info', self.getI18nString('DAB_RADIO'), 
      self.formatString(self.getI18nString('TOAST_DAB_REAPPEARED'), reappearedCount));
  }
  
  return mergedStations;
};

ControllerRtlsdrRadio.prototype.mergeStationData = function(existingStation, newStation, type) {
  var self = this;
  
  // Start with existing station (preserves all user data)
  var merged = {};
  for (var key in existingStation) {
    if (existingStation.hasOwnProperty(key)) {
      merged[key] = existingStation[key];
    }
  }
  
  // Update scan-related fields from new station
  if (type === 'fm') {
    // FM: Update name, signal_strength, last_seen
    merged.name = newStation.name;
    merged.signal_strength = newStation.signal_strength;
    merged.last_seen = newStation.last_seen;
    merged.frequency = newStation.frequency; // Ensure frequency stays correct
  } else if (type === 'dab') {
    // DAB: Update name, exactName, ensemble, bitrate, audioType, last_seen
    merged.name = newStation.name;
    merged.exactName = newStation.exactName;
    merged.ensemble = newStation.ensemble;
    merged.channel = newStation.channel;
    merged.serviceId = newStation.serviceId;
    merged.ensembleId = newStation.ensembleId;
    merged.bitrate = newStation.bitrate;
    merged.audioType = newStation.audioType;
    merged.last_seen = newStation.last_seen;
  }
  
  // User fields are preserved from existingStation:
  // - customName
  // - favorite
  // - hidden
  // - deleted
  // - groups
  // - notes
  // - playCount
  // - lastPlayed
  // - dateAdded
  // - userCreated
  // - availableAgain
  
  return merged;
};

// FM SCANNING METHODS - Phase 3 Implementation
// ============================================

ControllerRtlsdrRadio.prototype.scanFm = function() {
  var self = this;
  var defer = libQ.defer();
  
  // Check device availability, then take the tuner
  self.checkDeviceAvailable('scan_fm', {})
    .then(function() {
      return self.tuner.acquire('scanning_fm');
    })
    .then(function(job) {
      self.intentionalStop = false;
      self.setDeviceState('scanning_fm');
      
      self.logger.info('[RTL-SDR Radio] Starting FM scan...');
      self.commandRouter.pushToastMessage('info', self.getI18nString('FM_RADIO'), self.getI18nString('TOAST_FM_SCANNING_UI'));
      
      // Generate unique temp file name
      var scanFile = '/tmp/fm_scan_' + Date.now() + '.csv';
      
      // fn-rtl_power:
      // -f [lower]M:[upper]M:[spacing]k = Scan configured range with regional spacing
      // -i 10 = Integrate for 10 seconds
      // -1 = Single-shot mode (exit after one scan)
      var regionSettings = self.getRegionSettings();
      var effectiveStart = regionSettings.band_start + (regionSettings.scan_offset_khz / 1000);
      var lowerFreq = effectiveStart.toFixed(2);
      var upperFreq = regionSettings.band_end;
      var spacing = regionSettings.spacing_khz + 'k';
      var scanArgs = ['-f', lowerFreq + 'M:' + upperFreq + 'M:' + spacing, '-i', '10', '-1', scanFile];
      
      self.logger.info('[RTL-SDR Radio] Scan command: fn-rtl_power ' + scanArgs.join(' ') +
        ' (region spacing: ' + spacing + ', offset: ' + regionSettings.scan_offset_khz + ' kHz)');
      
      // Push progress update after delay
      setTimeout(function() {
        if (self.deviceState === 'scanning_fm' && self.tuner.current === job) {
          self.commandRouter.pushToastMessage('info', self.getI18nString('FM_RADIO'), 
            self.getI18nString('TOAST_FM_SCANNING_PROGRESS'));
        }
      }, self.SCAN_PROGRESS_DELAY);
      
      // The device goes back to idle only if this scan still is what the device is doing
      function scanOver() {
        self.scanProcess = null;
        if (self.deviceState === 'scanning_fm' && !self.tuner.busy()) {
          self.setDeviceState('idle');
        }
      }
      
      self.scanProcess = job.run('fn-rtl_power', scanArgs, { stdio: 'ignore' }, function(entry) {
        if (entry.error || entry.code !== 0) {
          var reason = job.timedOut ? 'timed out' :
            (entry.error ? String(entry.error.code || entry.error) : 'fn-rtl_power ended with ' +
              (entry.code !== null ? 'code ' + entry.code : entry.signal));
          // A scan stopped on purpose is no failure to report
          if (!job.stopping || job.timedOut) {
            self.logger.error('[RTL-SDR Radio] Scan failed: ' + reason);
            self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
              self.getI18nStringFormatted('TOAST_SCAN_FAILED', reason));
          }
          scanOver();
          defer.reject(new Error(reason));
          return;
        }
        
        self.logger.info('[RTL-SDR Radio] Scan complete, parsing results...');
        
        // Parse scan results
        self.parseScanResults(scanFile)
          .then(function(stations) {
            self.logger.info('[RTL-SDR Radio] Found ' + stations.length + ' FM stations');
            
            // Merge with existing database (preserves user data)
            self.stationsDb.fm = self.mergeFmScanResults(stations);
            self.saveStations();
            
            var totalStations = self.stationsDb.fm.length;
            self.commandRouter.pushToastMessage('success', self.getI18nString('FM_RADIO'), 
              self.formatString(self.getI18nString('TOAST_SCAN_COMPLETE'), stations.length, totalStations));
            
            scanOver();
            defer.resolve(stations);
          })
          .fail(function(e) {
            self.logger.error('[RTL-SDR Radio] Failed to parse scan results: ' + e);
            self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
              self.getI18nString('TOAST_PARSE_FAILED'));
            scanOver();
            defer.reject(e);
          });
      });
      job.limit(self.FM_SCAN_TIMEOUT);
    })
    .fail(function(e) {
      self.logger.info('[RTL-SDR Radio] FM scan not run: ' + (e && e.superseded ? 'a later request took its place' : e));
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.parseScanResults = function(scanFile) {
  var self = this;
  var defer = libQ.defer();
  
  fs.readFile(scanFile, 'utf8', function(err, data) {
    if (err) {
      self.logger.error('[RTL-SDR Radio] Failed to read scan file: ' + err);
      defer.reject(err);
      return;
    }
    
    try {
      var lines = data.trim().split('\n');
      if (lines.length === 0) {
        self.logger.error('[RTL-SDR Radio] Empty scan file');
        defer.reject(new Error('Empty scan file'));
        return;
      }
      
      self.logger.info('[RTL-SDR Radio] Processing ' + lines.length + ' frequency hops');
      
      // Build frequency map by combining all hops
      var freqMap = {}; // frequency -> power
      
      // Process each line (frequency hop)
      for (var lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        var line = lines[lineIdx];
        var values = line.split(',').map(function(v) { return v.trim(); });
        
        // CSV format: date, time, Hz_low, Hz_high, Hz_step, samples, dBm_values...
        if (values.length < 7) {
          continue; // Skip invalid lines
        }
        
        var startFreq = parseFloat(values[2]) / 1000000; // Hz to MHz
        var step = parseFloat(values[4]) / 1000000;
        
        // Extract power values (skip first 6 metadata fields)
        var powerValues = values.slice(6);
        
        // Map each bin to its frequency
        for (var i = 0; i < powerValues.length; i++) {
          var power = parseFloat(powerValues[i]);
          
          // Skip NaN values
          if (isNaN(power)) {
            continue;
          }
          
          var freq = startFreq + (i * step);
          var freqKey = freq.toFixed(6); // Use high precision key
          
          // Store power value for this frequency
          freqMap[freqKey] = power;
        }
      }
      
      // Convert frequency map to sorted array
      var freqArray = [];
      for (var freqKey in freqMap) {
        freqArray.push({
          freq: parseFloat(freqKey),
          power: freqMap[freqKey]
        });
      }
      
      // Sort by frequency
      freqArray.sort(function(a, b) {
        return a.freq - b.freq;
      });
      
      if (freqArray.length === 0) {
        self.logger.error('[RTL-SDR Radio] No valid power values found');
        defer.reject(new Error('No valid data'));
        return;
      }
      
      self.logger.info('[RTL-SDR Radio] Combined spectrum: ' + freqArray.length + ' valid bins');
      
      // Calculate average power for threshold (skip NaN already filtered)
      var sum = 0;
      for (var i = 0; i < freqArray.length; i++) {
        sum += freqArray[i].power;
      }
      var avgPower = sum / freqArray.length;
      
      // Get threshold from config (default: +8 dB for balanced detection)
      var thresholdOffset = self.config.get('scan_sensitivity', 8);
      var threshold = avgPower + thresholdOffset;
      
      self.logger.info('[RTL-SDR Radio] Average power: ' + avgPower.toFixed(1) + 
                      ' dBm, threshold: ' + threshold.toFixed(1) + ' dBm (+' + thresholdOffset + ' dB)');
      
      // Find peaks (local maxima above threshold)
      var stations = [];
      for (var i = 1; i < freqArray.length - 1; i++) {
        var current = freqArray[i];
        var prev = freqArray[i - 1];
        var next = freqArray[i + 1];
        
        // Check if this is a peak above threshold
        if (current.power > threshold && 
            current.power > prev.power && 
            current.power > next.power) {
          
          // Round to nearest channel based on regional spacing and scan offset
          var regionSettings = self.getRegionSettings();
          var spacingMHz = regionSettings.spacing_khz / 1000;
          var effectiveStart = regionSettings.band_start + (regionSettings.scan_offset_khz / 1000);
          var freqRounded = Math.round((current.freq - effectiveStart) / spacingMHz) * spacingMHz + effectiveStart;
          // Format to appropriate decimal places based on spacing and offset
          // 50kHz offset produces frequencies like 88.05, 88.25 needing 2 decimal places
          var decimalPlaces = (spacingMHz < 0.1 || regionSettings.scan_offset_khz % 100 !== 0) ? 2 : 1;
          var freqFormatted = freqRounded.toFixed(decimalPlaces);
          
          stations.push({
            frequency: freqFormatted,
            name: 'FM ' + freqFormatted,
            signal_strength: current.power.toFixed(1),
            last_seen: new Date().toISOString()
          });
          
          self.logger.info('[RTL-SDR Radio] Found station: ' + freqFormatted + 
                          ' MHz (' + current.power.toFixed(1) + ' dBm, spacing: ' + regionSettings.spacing_khz + 'kHz)');
        }
      }
      
      // Sort stations by frequency
      stations.sort(function(a, b) {
        return parseFloat(a.frequency) - parseFloat(b.frequency);
      });
      
      // Cleanup temp file
      fs.unlink(scanFile, function() {});
      
      defer.resolve(stations);
      
    } catch (e) {
      self.logger.error('[RTL-SDR Radio] Error parsing scan data: ' + e);
      defer.reject(e);
    }
  });
  
  return defer.promise;
};

// ============================================
// DAB Radio Functions
// ============================================

ControllerRtlsdrRadio.prototype.scanDab = function() {
  var self = this;
  var defer = libQ.defer();
  
  // Check device availability, then take the tuner
  self.checkDeviceAvailable('scan_dab', {})
    .then(function() {
      return self.tuner.acquire('scanning_dab');
    })
    .then(function(job) {
      self.intentionalStop = false;
      self.setDeviceState('scanning_dab');
      
      self.logger.info('[RTL-SDR Radio] Starting DAB scan...');
      self.commandRouter.pushToastMessage('info', self.getI18nString('DAB_RADIO'), self.getI18nString('TOAST_DAB_SCANNING_UI'));
      
      // Generate unique temp file name
      var scanFile = '/tmp/dab_scan_' + Date.now() + '.json';
      
      // Get DAB settings from config
      var dabGain = self.numberSetting('dab_gain', 80);
      var dabPpm = self.numberSetting('dab_ppm', 0);
      
      // fn-dab-scanner:
      // -B BAND_III = Scan Band III (European DAB standard, 174-240 MHz)
      // -G <gain> = Tuner gain (0-49.6, higher = more sensitive)
      // -p <ppm> = Frequency correction for cheap dongles
      // -j = JSON output format, written to the scan file through the scanner's stdout
      var scanArgs = ['-B', 'BAND_III', '-G', String(dabGain)];
      if (dabPpm !== 0) {
        scanArgs.push('-p', String(dabPpm));
      }
      scanArgs.push('-j');
      
      self.logger.info('[RTL-SDR Radio] DAB scan command: fn-dab-scanner ' + scanArgs.join(' ') + ' > ' + scanFile);
      
      // Track scan start time for progress updates
      var scanStartTime = Date.now();
      
      // Push progress updates every 30 seconds
      var dabProgressInterval = setInterval(function() {
        if (self.deviceState === 'scanning_dab' && self.tuner.current === job) {
          var elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
          var formattedTime = self.formatElapsedTime(elapsed);
          self.commandRouter.pushToastMessage('info', self.getI18nString('DAB_RADIO'), 
            self.formatString(self.getI18nString('TOAST_DAB_SCANNING_PROGRESS'), formattedTime));
        } else {
          clearInterval(dabProgressInterval);
        }
      }, self.DAB_DETECTION_TIMEOUT);
      
      // The device goes back to idle only if this scan still is what the device is doing
      function scanOver() {
        self.scanProcess = null;
        if (self.deviceState === 'scanning_dab' && !self.tuner.busy()) {
          self.setDeviceState('idle');
        }
      }
      
      var scanOutput = fs.openSync(scanFile, 'w');
      try {
        self.scanProcess = job.run('fn-dab-scanner', scanArgs, { stdio: ['ignore', scanOutput, 'ignore'] }, scanEnded);
      } finally {
        fs.closeSync(scanOutput);
      }
      job.limit(self.DAB_SCAN_TIMEOUT);
      
      function scanEnded(entry) {
        // Clear progress interval
        clearInterval(dabProgressInterval);
        
        var failed = !!entry.error || entry.code !== 0;
        var stoppedOnPurpose = job.stopping && !job.timedOut;
        
        // Check if scan file was created (scanner may return error code but still produce valid output)
        var scanFileExists = false;
        try {
          scanFileExists = fs.existsSync(scanFile) && fs.statSync(scanFile).size > 0;
        } catch (e) {
          scanFileExists = false;
        }
        
        if (stoppedOnPurpose || (failed && !scanFileExists)) {
          var reason = stoppedOnPurpose ? 'stopped' : (job.timedOut ? 'timed out' :
            (entry.error ? String(entry.error.code || entry.error) : 'fn-dab-scanner ended with ' +
              (entry.code !== null ? 'code ' + entry.code : entry.signal)));
          // A scan stopped on purpose is no failure to report
          if (!stoppedOnPurpose) {
            self.logger.error('[RTL-SDR Radio] DAB scan failed: ' + reason);
            self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
              self.getI18nStringFormatted('TOAST_SCAN_FAILED', reason));
          }
          scanOver();
          defer.reject(new Error(reason));
          return;
        }
        
        // Log warning if error occurred but scan file exists
        if (failed) {
          self.logger.info('[RTL-SDR Radio] DAB scanner completed with warnings (non-zero exit code), but scan file created successfully');
        } else {
          self.logger.info('[RTL-SDR Radio] DAB scan complete, parsing results...');
        }
        
        // Parse scan results (whether error occurred or not, as long as file exists)
        self.parseDabScanResults(scanFile)
          .then(function(stations) {
            self.logger.info('[RTL-SDR Radio] Found ' + stations.length + ' DAB services');
            
            // Merge with existing database (preserves user data)
            self.stationsDb.dab = self.mergeDabScanResults(stations);
            self.saveStations();
            self.fetchLogos();
            
            var totalStations = self.stationsDb.dab.length;
            self.commandRouter.pushToastMessage('success', self.getI18nString('DAB_RADIO'), 
              self.formatString(self.getI18nString('TOAST_SCAN_COMPLETE'), stations.length, totalStations));
            
            scanOver();
            defer.resolve(stations);
          })
          .fail(function(e) {
            self.logger.error('[RTL-SDR Radio] Failed to parse DAB scan results: ' + e);
            self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
              self.getI18nString('TOAST_PARSE_FAILED'));
            scanOver();
            defer.reject(e);
          });
      }
    })
    .fail(function(e) {
      self.logger.info('[RTL-SDR Radio] DAB scan not run: ' + (e && e.superseded ? 'a later request took its place' : e));
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.parseDabScanResults = function(scanFile) {
  var self = this;
  var defer = libQ.defer();
  
  fs.readFile(scanFile, 'utf8', function(err, data) {
    if (err) {
      self.logger.error('[RTL-SDR Radio] Failed to read DAB scan file: ' + err);
      defer.reject(err);
      return;
    }
    
    try {
      // fn-dab-scanner outputs debug text before JSON
      // Extract only the JSON portion (starts with '{')
      var jsonStart = data.indexOf('{');
      if (jsonStart === -1) {
        self.logger.error('[RTL-SDR Radio] No JSON found in scan output');
        defer.reject(new Error('No JSON in scan output'));
        return;
      }
      
      var jsonData = data.substring(jsonStart);
      self.logger.info('[RTL-SDR Radio] Extracted JSON from position ' + jsonStart);
      
      // Parse JSON output from fn-dab-scanner
      var scanData = JSON.parse(jsonData);
      
      // Scanner returns ensembles as object with ensemble IDs as keys
      var ensembleIds = Object.keys(scanData);
      
      if (ensembleIds.length === 0) {
        self.logger.info('[RTL-SDR Radio] No DAB ensembles found');
        defer.resolve([]);
        return;
      }
      
      self.logger.info('[RTL-SDR Radio] Found ' + ensembleIds.length + ' DAB ensembles');
      
      // Flatten ensemble/service structure into service list
      var services = [];
      
      ensembleIds.forEach(function(ensembleId) {
        var ensemble = scanData[ensembleId];
        
        if (!ensemble.services) {
          return;
        }
        
        // Services are also an object with service IDs as keys
        var serviceIds = Object.keys(ensemble.services);
        
        serviceIds.forEach(function(serviceId) {
          var service = ensemble.services[serviceId];
          
          // Only include services with audio field (exclude data services)
          if (!service.audio) {
            return;
          }
          
          // Store both trimmed name for display and exact name for playback
          var trimmedName = service.name.trim();
          var exactName = service.name;  // Preserve trailing spaces
          
          services.push({
            name: trimmedName,              // For display in UI
            exactName: exactName,            // For playback command (with spaces)
            ensemble: ensemble.name.trim(),
            channel: ensemble.channel,
            serviceId: serviceId,
            ensembleId: ensembleId,
            bitrate: service.bitRate,
            audioType: service.audio,
            last_seen: new Date().toISOString()
          });
          
          self.logger.info('[RTL-SDR Radio] Found DAB service: ' + trimmedName + 
                          ' (' + service.bitRate + 'kbps ' + service.audio + ') on ' + 
                          ensemble.name.trim() + ' (Ch ' + ensemble.channel + ')');
        });
      });
      
      // Sort services alphabetically by name
      services.sort(function(a, b) {
        return a.name.localeCompare(b.name);
      });
      
      // Cleanup temp file
      fs.unlink(scanFile, function() {});
      
      defer.resolve(services);
      
    } catch (e) {
      self.logger.error('[RTL-SDR Radio] Error parsing DAB scan data: ' + e);
      defer.reject(e);
    }
  });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.playDabStation = function(channel, serviceName, stationTitle) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Playing DAB station: ' + serviceName + ' on channel ' + channel);
  
  // The channel is one of the DAB channels, or it is not played
  channel = String(channel).toUpperCase();
  if (self.DAB_CHANNELS.indexOf(channel) === -1) {
    self.logger.error('[RTL-SDR Radio] Invalid DAB channel: ' + channel);
    defer.reject(new Error('Invalid DAB channel'));
    return defer.promise;
  }
  
  // Reset artwork state when changing stations
  self.lastValidArtwork = null;
  self.artworkTimestamp = null;
  self.albumLookupCache = {};
  self.lastArtworkLogKey = null;
  
  // Check if station is deleted
  var station = self.stationsDb.dab ? self.stationsDb.dab.find(function(s) {
    return s.channel === channel && s.exactName === serviceName;
  }) : null;
  
  if (station && station.deleted) {
    self.logger.error('[RTL-SDR Radio] Cannot play deleted station: ' + serviceName);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('TOAST_DELETED_STATION'));
    defer.reject(new Error('Station is deleted'));
    return defer.promise;
  }
  
  // Use customName from database if available (overrides track.title)
  if (station && station.customName) {
    stationTitle = station.customName;
  }
  
  // Check device availability, then take the tuner: whatever held it is stopped and
  // gone, and the dongle has settled, before this station's processes start
  self.checkDeviceAvailable('play_dab', { channel: channel, serviceName: serviceName, stationTitle: stationTitle })
    .then(function() {
      return self.tuner.acquire('playing_dab');
    })
    .then(function(job) {
      self.setDeviceState('playing_dab');
      self.startDabPlayback(job, channel, serviceName, stationTitle, defer);
    })
    .fail(function(e) {
      if (e && e.superseded) {
        self.logger.info('[RTL-SDR Radio] DAB ' + channel + ' ' + serviceName.trim() + ' not started: a later request took its place');
      } else {
        self.logger.info('[RTL-SDR Radio] DAB playback cancelled or rejected: ' + e);
      }
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.startDabPlayback = function(job, channel, serviceName, stationTitle, defer) {
  var self = this;
  
  // Update play statistics
  var uri = 'rtlsdr://dab/' + channel + '/' + encodeURIComponent(serviceName);
  var stationInfo = self.getStationByUri(uri);
  if (stationInfo) {
    stationInfo.station.playCount = (stationInfo.station.playCount || 0) + 1;
    stationInfo.station.lastPlayed = new Date().toISOString();
    self.saveStations();
  }
  
  // Get DAB settings from config
  var dabGain = self.numberSetting('dab_gain', 80);
  var dabPpm = self.numberSetting('dab_ppm', 0);
  
  // Clear intentional stop flag when starting new playback
  self.intentionalStop = false;
  
  // Setup metadata directory for DLS output
  self.setupDabMetadataDir();
  
  // fn-dab writes PCM audio to its stdout and reports on its stderr.
  // -C <channel> = DAB channel (e.g., 12B)
  // -P <service> = Service name (must match exactly, trailing spaces included)
  // -G <gain> = Tuner gain
  // -p <ppm> = Frequency correction for cheap dongles
  // -D 30 = Detection timeout (30 seconds to find ensemble)
  // -i <dir> = Metadata output directory (DLS text)
  // The arguments are handed over as they are, with no shell in between, so the
  // service name reaches the decoder exactly as it was broadcast.
  var dabArgs = ['-C', channel, '-P', serviceName, '-G', String(dabGain)];
  if (dabPpm !== 0) {
    dabArgs.push('-p', String(dabPpm));
  }
  dabArgs.push('-D', '30', '-i', self.dabMetadataDir + '/');
  
  self.logger.info('[RTL-SDR Radio] Starting DAB decoder: fn-dab ' + JSON.stringify(dabArgs));
  
  var dabProcess = job.spawn('fn-dab', dabArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  
  var pcmDetected = false;
  
  // Store station info for DLS updates
  self.currentDabStation = {
    channel: channel,
    serviceName: serviceName,
    exactName: serviceName,  // For station manager matching
    stationTitle: stationTitle,
    uri: uri
  };
  
  // Capture stderr to detect PCM format
  dabProcess.stderr.on('data', function(data) {
    var output = data.toString();
    
    // Look for PCM format line: "PCM: rate=32000 stereo=0 size=3840"
    var pcmMatch = output.match(/PCM: rate=(\d+) stereo=(\d+)/);
    if (pcmMatch && !pcmDetected && !job.stopping && !job.finished) {
      pcmDetected = true;
      var sampleRate = parseInt(pcmMatch[1], 10);
      
      // CRITICAL: stereo flag is buggy - always assume stereo=2 channels
      var channels = 2;
      
      self.logger.info('[RTL-SDR Radio] Detected PCM format: ' + sampleRate + ' Hz, ' + channels + ' channels');
      
      // sox resamples to the output rate, aplay plays into Volumio's device
      var soxProcess = job.spawn('sox',
        ['-t', 'raw', '-r', String(sampleRate), '-c', String(channels), '-e', 'signed-integer', '-b', '16', '-',
         '-t', 'raw', '-r', String(self.OUTPUT_SAMPLE_RATE), '-c', '2', '-'],
        { stdio: ['pipe', 'pipe', 'pipe'] });
      var aplayProcess = job.spawn('aplay',
        ['-D', 'volumio', '-f', 'S16_LE', '-r', String(self.OUTPUT_SAMPLE_RATE), '-c', '2'],
        { stdio: ['pipe', 'ignore', 'pipe'] });
      
      dabProcess.stdout.pipe(soxProcess.stdin);
      soxProcess.stdout.pipe(aplayProcess.stdin);
      
      self.soxProcess = soxProcess;
      self.aplayProcess = aplayProcess;
      
      // Start DLS metadata monitor after audio pipeline established
      self.startDabDlsMonitor();
    }
  });
  
  // Any of the three ending by itself ends the playback: the service was not found
  // in time, the dongle went away, the audio device refused
  job.onUnexpectedExit(function(entry) {
    self.playbackEnded(job, entry);
  });
  
  self.decoderProcess = dabProcess;
  
  // Store current station for resume
  self.currentStation = {
    uri: uri,
    name: stationTitle,
    service: 'rtlsdr_radio'
  };
  
  // Update Volumio state machine
  self.commandRouter.stateMachine.setConsumeUpdateService('rtlsdr_radio');
  
  // Get station from database for customName and ensemble
  var station = self.stationsDb.dab ? self.stationsDb.dab.find(function(s) {
    return s.channel === channel && s.exactName === serviceName;
  }) : null;
  
  // Display name priority: customName > station.name > stationTitle
  var displayName = stationTitle;
  if (station && station.customName) {
    displayName = station.customName;
  } else if (station && station.name) {
    displayName = station.name;
  }
  
  var ensemble = station ? station.ensemble : ('Channel ' + channel);
  
  var state = {
    status: 'play',
    service: 'rtlsdr_radio',
    title: displayName,
    artist: ensemble,
    album: self.getI18nString('DAB_RADIO'),
    albumart: '/albumart?sourceicon=' + self.dabIcon(station, true),
    uri: uri,
    trackType: 'DAB ' + self.getSignalBars(0),
    samplerate: '48 kHz',
    bitdepth: '16 bit',
    channels: 2,
    duration: 0,
    seek: 0
  };
  self.dabFirstState = state;
  
  // Volumio takes this station's state from the plugin (text, artwork, signal). The
  // first push starts the playback in Volumio's eyes; the second, a moment later, is
  // taken as an update and carries the details the first cannot.
  self.playingJob = job;
  self.pushPlayingState(state);
  setTimeout(function() {
    self.pushPlayingState(state);
  }, self.CLEANUP_TIMEOUT);
  
  defer.resolve();
};
