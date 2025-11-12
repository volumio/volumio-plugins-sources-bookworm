'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var express = require('express');
var bodyParser = require('body-parser');
var path = require('path');

module.exports = ControllerRtlsdrRadio;

function ControllerRtlsdrRadio(context) {
  var self = this;
  
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;
  
  self.decoderProcess = null;
  self.scanProcess = null;
  self.soxProcess = null;
  self.aplayProcess = null;
  self.currentStation = null;
  self.stationsDb = { fm: [], dab: [] };
  self.stationsDbFile = '/data/plugins/music_service/rtlsdr_radio/stations.json';
  self.dbLoadedAt = null; // Timestamp when database was loaded
  
  // Device state management
  self.deviceState = 'idle'; // idle, scanning_fm, scanning_dab, playing_fm, playing_dab
  self.operationQueue = []; // Queue of pending operations
  self.QUEUE_TIMEOUT = 60000; // 60 seconds
  
  // Express server for station management web interface
  self.expressApp = null;
  self.expressServer = null;
  self.managementPort = 3456;
  self.detectedHostname = null; // Actual hostname/IP from HTTP requests
}

ControllerRtlsdrRadio.prototype.onVolumioStart = function() {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context, 'config.json'
  );
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  
  return libQ.resolve();
};

ControllerRtlsdrRadio.prototype.onStart = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Starting plugin');
  
  // Load i18n strings
  self.loadI18nStrings()
    .then(function() {
      return self.loadAlsaLoopback();
    })
    .then(function() {
      return self.loadStations();
    })
    .then(function() {
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
  
  // Force terminate all processes
  self.stopAllProcesses('onStop', true);
  
  // Clear device state (process references already cleared by stopAllProcesses)
  self.deviceState = 'idle';
  
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
  
  self.logger.info('[RTL-SDR Radio] Plugin stopped');
  defer.resolve();
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.onUnload = function() {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Unloading plugin - final cleanup');
  
  // Force terminate all processes
  self.stopAllProcesses('onUnload', true);
  
  self.logger.info('[RTL-SDR Radio] Plugin unloaded');
  
  return libQ.resolve();
};

ControllerRtlsdrRadio.prototype.onInstall = function() {
  var self = this;
  self.logger.info('[RTL-SDR Radio] onInstall: Performing installation tasks');
  
  // Check if database exists from previous installation
  var stationsFile = '/data/plugins/music_service/rtlsdr_radio/stations.json';
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
    config: []
  };
  
  try {
    var stationsDir = '/data/rtlsdr_radio_backups/stations';
    var configDir = '/data/rtlsdr_radio_backups/config';
    
    if (fs.existsSync(stationsDir)) {
      var stationsFiles = fs.readdirSync(stationsDir);
      stationsFiles = stationsFiles.filter(function(f) {
        return f.endsWith('.json');
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
        return f.endsWith('.json');
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
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to list backups: ' + e);
  }
  
  return backups;
};

ControllerRtlsdrRadio.prototype.restoreStationsBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backupFile = '/data/rtlsdr_radio_backups/stations/stations-' + timestamp + '.json';
    var targetFile = self.stationsDbFile;
    
    if (fs.existsSync(backupFile)) {
      fs.copySync(backupFile, targetFile);
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

ControllerRtlsdrRadio.prototype.restoreConfigBackup = function(timestamp) {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var backupFile = '/data/rtlsdr_radio_backups/config/config-' + timestamp + '.json';
    var targetFile = '/data/configuration/music_service/rtlsdr_radio/config.json';
    
    if (fs.existsSync(backupFile)) {
      fs.copySync(backupFile, targetFile);
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
    var backupFile = '/data/rtlsdr_radio_backups/' + type + '/' + type + '-' + timestamp + '.json';
    
    if (fs.existsSync(backupFile)) {
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
      self.pruneBackups('stations');
      self.pruneBackups('config');
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
    
    if (backups.stations.length === 0 && backups.config.length === 0) {
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
        }, 2000);
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
  var execSync = require('child_process').execSync;
  
  try {
    var backupFile = '/data/rtlsdr_radio_backups/' + type + '/' + type + '-' + timestamp + '.json';
    var zipFile = '/tmp/' + type + '-' + timestamp + '.zip';
    
    if (!fs.existsSync(backupFile)) {
      res.status(404).json({ error: 'Backup file not found' });
      return;
    }
    
    execSync('cd /data/rtlsdr_radio_backups/' + type + ' && zip -q "' + zipFile + '" "' + type + '-' + timestamp + '.json"');
    
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
  var execSync = require('child_process').execSync;
  
  try {
    var extractDir = '/tmp/rtlsdr_restore_' + Date.now();
    fs.mkdirpSync(extractDir);
    
    execSync('unzip -q "' + zipPath + '" -d "' + extractDir + '"');
    
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
        
        if (!data.fm || !data.dab) {
          return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Update database
        self.stationsDb.fm = data.fm;
        self.stationsDb.dab = data.dab;
        
        // Save to disk (synchronous)
        self.saveStations();
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
        self.saveStations();
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
        self.saveStations();
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
        self.saveStations();
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
        
        res.json({ 
          deviceState: self.deviceState,
          fmStationsLoaded: fmCount,
          dabStationsLoaded: dabCount,
          dbLoadedAt: self.dbLoadedAt,
          dbVersion: self.stationsDb.version || 0,
          serverPort: self.managementPort,
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
        } else if (type === 'full') {
          self.createStationsBackup(timestamp)
            .then(function() { return self.createConfigBackup(timestamp); })
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
            }, 1000);
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
            var targetFile = result.info.type === 'stations' ? self.stationsDbFile : '/data/configuration/music_service/rtlsdr_radio/config.json';
            fs.copySync(result.jsonFile, targetFile);
            fs.removeSync(zipPath);
            fs.removeSync(result.extractDir);
            
            res.json({ success: true });
            
            setTimeout(function() {
              self.onStop()
                .then(function() {
                  return self.onStart();
                });
            }, 1000);
          })
          .fail(function(e) {
            fs.removeSync(zipPath);
            res.status(400).json({ error: e.toString() });
          });
      } catch (e) {
        res.status(500).json({ error: e.toString() });
      }
    });
    

    
    // Start server
    self.expressServer = self.expressApp.listen(self.managementPort, function() {
      self.logger.info('[RTL-SDR Radio] Management server started on port ' + self.managementPort);
      defer.resolve();
    });
    
    // Handle server errors
    self.expressServer.on('error', function(e) {
      if (e.code === 'EADDRINUSE') {
        self.logger.error('[RTL-SDR Radio] Port ' + self.managementPort + ' already in use');
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
  
  return 'http://' + hostname + ':' + self.managementPort;
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
  self.stopAllProcesses('onVolumioStop', true);
  
  // Clear device state (process references already cleared by stopAllProcesses)
  self.deviceState = 'idle';
  
  self.logger.info('[RTL-SDR Radio] Ready for Volumio restart');
  
  return libQ.resolve();
};

// Helper function to kill all RTL-SDR related processes
// caller: string identifying which function called this (for logging)
// Unified process termination function - single source of truth
// caller: string identifying which function called this (for logging)
// force: boolean - true for immediate cleanup, false for graceful 500ms delay
// NOTE: Always uses SIGKILL (-9) because RTL-SDR processes ignore SIGTERM
ControllerRtlsdrRadio.prototype.stopAllProcesses = function(caller, force) {
  var self = this;
  
  var method = force ? 'force terminating' : 'stopping';
  self.logger.info('[RTL-SDR Radio] ' + caller + ' - ' + method + ' all processes');
  
  // Set intentional stop flag
  self.intentionalStop = true;
  
  try {
    var execSync = require('child_process').execSync;
    
    // CRITICAL: Always use SIGKILL (-9) because RTL-SDR processes ignore SIGTERM
    // The 'force' parameter only affects cleanup timing, not kill signal
    execSync('sudo pkill -9 -f "rtl_fm"', { timeout: 2000 });
    execSync('sudo pkill -9 -f "rtl_power"', { timeout: 2000 });
    execSync('sudo pkill -9 -f "dab-rtlsdr-3"', { timeout: 2000 });
    execSync('sudo pkill -9 -f "dab-scanner-3"', { timeout: 2000 });
    execSync('sudo pkill -9 -f "sox"', { timeout: 2000 });
    execSync('sudo pkill -9 -f "aplay -D volumio"', { timeout: 2000 });
  } catch (e) {
    // pkill returns error if no processes found - this is OK
  }
  
  // Try to terminate process references with SIGKILL
  if (self.decoderProcess !== null) {
    try { self.decoderProcess.kill('SIGKILL'); } catch (e) {}
  }
  
  if (self.scanProcess !== null) {
    try { self.scanProcess.kill('SIGKILL'); } catch (e) {}
  }
  
  if (self.soxProcess !== null) {
    try { self.soxProcess.kill('SIGKILL'); } catch (e) {}
  }
  
  if (self.aplayProcess !== null) {
    try { self.aplayProcess.kill('SIGKILL'); } catch (e) {}
  }
  
  self.logger.info('[RTL-SDR Radio] ' + caller + ' - processes ' + (force ? 'terminated' : 'stopped'));
  
  // Handle reference cleanup based on force mode
  if (force) {
    // Immediate cleanup for forced termination
    self.decoderProcess = null;
    self.scanProcess = null;
    self.soxProcess = null;
    self.aplayProcess = null;
  } else {
    // Graceful cleanup with timeout - allows device to reset
    setTimeout(function() {
      self.decoderProcess = null;
      self.scanProcess = null;
      self.soxProcess = null;
      self.aplayProcess = null;
    }, 500);
  }
};

ControllerRtlsdrRadio.prototype.loadI18nStrings = function() {
  var self = this;
  var defer = libQ.defer();
  
  var lang_code = self.commandRouter.sharedVars.get('language_code') || 'en';
  self.current_language = lang_code;
  var langFile = __dirname + '/i18n/strings_' + lang_code + '.json';
  var defaultFile = __dirname + '/i18n/strings_en.json';
  
  try {
    self.i18nStrings = fs.readJsonSync(langFile);
    self.logger.info('[RTL-SDR Radio] Loaded i18n strings for language: ' + lang_code);
  } catch (e) {
    self.logger.warn('[RTL-SDR Radio] Failed to load ' + lang_code + ' translations, using English');
    self.i18nStrings = fs.readJsonSync(defaultFile);
  }
  
  defer.resolve();
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.getI18nString = function(key) {
  var self = this;
  
  if (self.i18nStrings && self.i18nStrings[key]) {
    return self.i18nStrings[key];
  }
  
  // Fallback to key if translation not found
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
  
  // SECTION 3: FM RADIO
  // ====================
  var fmSection = uiconf.sections[2];
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
  }
  
  // SECTION 4: DAB/DAB+ RADIO
  // ==========================
  var dabSection = uiconf.sections[3];
  if (dabSection) {
    var dabEnabled = findContentItem(dabSection, 'dab_enabled');
    if (dabEnabled) {
      dabEnabled.value = self.config.get('dab_enabled', false);
    }
    
    var dabGain = findContentItem(dabSection, 'dab_gain');
    if (dabGain) {
      dabGain.value = self.config.get('dab_gain', 80);
    }
  }
  
  // SECTION 5: DIAGNOSTICS
  // =======================
  var diagnosticsSection = uiconf.sections[4];
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

ControllerRtlsdrRadio.prototype.loadAlsaLoopback = function() {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var lsmod = execSync('lsmod | grep snd_aloop', { encoding: 'utf8' });
    if (lsmod.length > 0) {
      self.logger.info('[RTL-SDR Radio] snd-aloop already loaded');
      defer.resolve();
      return defer.promise;
    }
  } catch (e) {
    // Module not loaded
  }
  
  try {
    execSync('sudo modprobe snd-aloop', { encoding: 'utf8' });
    self.logger.info('[RTL-SDR Radio] Loaded snd-aloop module');
    defer.resolve();
  } catch (err) {
    self.logger.error('[RTL-SDR Radio] Failed to load snd-aloop: ' + err);
    defer.reject(err);
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

// ========== DEVICE STATE MANAGEMENT ==========

ControllerRtlsdrRadio.prototype.checkDeviceAvailable = function(requestedOperation, operationData) {
  var self = this;
  
  if (self.deviceState === 'idle') {
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
        // Wait for processes to fully terminate and release USB device
        // Processes need time for graceful shutdown (rtl_power finishes scan pass)
        // stopDecoder has 500ms timeout, add extra margin for graceful shutdown
        self.logger.info('[RTL-SDR Radio] Waiting for device cleanup...');
        setTimeout(function() {
          // Resolve the pending operation's defer to proceed
          operation.defer.resolve(true);
          // Remove from pending operations
          delete self.pendingOperations[operationType];
          defer.resolve();
        }, 1200);
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
    // Stop playback
    self.stop()
      .then(function() {
        self.setDeviceState('idle');
        defer.resolve();
      })
      .fail(function(e) {
        defer.reject(e);
      });
  } else if (self.deviceState.startsWith('scanning_')) {
    // Kill scan process
    self.stopDecoder();
    self.setDeviceState('idle');
    defer.resolve();
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
        albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
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
        albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
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
      if (!station.deleted) {
        var uri = 'rtlsdr://fm/' + station.frequency;
        items.push({
          service: 'rtlsdr_radio',
          type: 'song',
          title: station.customName || station.name,
          artist: station.frequency + ' MHz',
          album: self.getI18nString('FM_RADIO'),
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
          icon: station.favorite ? 'fa fa-star' : (station.hidden ? 'fa fa-eye-slash' : ''),
          uri: uri,
          menu: self.getStationContextMenu(uri, 'fm', false, station.hidden || false)
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
      if (!station.deleted && station.ensemble === ensembleName) {
        var uri = 'rtlsdr://dab/' + station.channel + '/' + encodeURIComponent(station.exactName);
        items.push({
          service: 'rtlsdr_radio',
          type: 'webradio',
          title: station.customName || station.name,
          artist: station.ensemble,
          album: 'Channel ' + station.channel,
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
          icon: station.favorite ? 'fa fa-star' : (station.hidden ? 'fa fa-eye-slash' : ''),
          uri: uri,
          menu: self.getStationContextMenu(uri, 'dab', false, station.hidden || false)
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
      if (!station.deleted) {
        var uri = 'rtlsdr://dab/' + station.channel + '/' + encodeURIComponent(station.exactName);
        items.push({
          service: 'rtlsdr_radio',
          type: 'webradio',
          title: station.customName || station.name,
          artist: station.ensemble,
          album: 'Channel ' + station.channel,
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
          icon: station.favorite ? 'fa fa-star' : (station.hidden ? 'fa fa-eye-slash' : ''),
          uri: uri,
          menu: self.getStationContextMenu(uri, 'dab', false, station.hidden || false)
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
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
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
          albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
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

ControllerRtlsdrRadio.prototype.clearAddPlayTrack = function(track) {
  var self = this;
  var defer = libQ.defer();
  
  self.logger.info('[RTL-SDR Radio] Play track: ' + JSON.stringify(track));
  
  // NOTE: Volumio always calls stop() before clearAddPlayTrack()
  // stop() already calls stopDecoder(), so we don't call it again here
  // Calling stopDecoder() twice causes pkill to kill the newly started process
  
  // Parse URI to determine type (FM or DAB)
  if (track.uri && track.uri.indexOf('rtlsdr://fm/') === 0) {
    // FM playback
    var frequency = track.uri.replace('rtlsdr://fm/', '');
    self.playFmStation(frequency, track.name || 'FM ' + frequency)
      .then(function() {
        defer.resolve();
      })
      .fail(function(e) {
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
  
  // Validate frequency (FM band: 88-108 MHz)
  var freq = parseFloat(frequency);
  if (isNaN(freq) || freq < 88 || freq > 108) {
    self.logger.error('[RTL-SDR Radio] Invalid FM frequency: ' + frequency);
    defer.reject(new Error('Invalid frequency'));
    return defer.promise;
  }
  
  // Check if station is deleted
  var station = self.stationsDb.fm ? self.stationsDb.fm.find(function(s) {
    return s.frequency === frequency;
  }) : null;
  
  if (station && station.deleted) {
    self.logger.error('[RTL-SDR Radio] Cannot play deleted station: ' + frequency);
    self.commandRouter.pushToastMessage('error', 'FM/DAB Radio', 
      self.getI18nString('TOAST_DELETED_STATION'));
    defer.reject(new Error('Station is deleted'));
    return defer.promise;
  }
  
  // Check device availability
  self.checkDeviceAvailable('play_fm', { frequency: freq, stationName: stationName })
    .then(function() {
      // Device is available, proceed with playback
      self.setDeviceState('playing_fm');
      
      // If decoder is still running, wait for cleanup to complete
      if (self.decoderProcess !== null) {
        self.logger.info('[RTL-SDR Radio] Waiting for previous station cleanup...');
        setTimeout(function() {
          self.startFmPlayback(freq, stationName, defer);
        }, 600); // Wait slightly longer than stopDecoder timeout (500ms)
      } else {
        self.startFmPlayback(freq, stationName, defer);
      }
    })
    .fail(function(e) {
      self.logger.info('[RTL-SDR Radio] FM playback cancelled or rejected: ' + e);
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.startFmPlayback = function(freq, stationName, defer) {
  var self = this;
  
  // Update play statistics
  var uri = 'rtlsdr://fm/' + freq;
  var stationInfo = self.getStationByUri(uri);
  if (stationInfo) {
    stationInfo.station.playCount = (stationInfo.station.playCount || 0) + 1;
    stationInfo.station.lastPlayed = new Date().toISOString();
    self.saveStations();
  }
  
  // Get gain from config
  var gain = self.config.get('fm_gain', 50);
  
  // Build rtl_fm command piped to aplay
  // rtl_fm: -f frequency, -M wfm (wideband FM), -s 180k sample rate, -r 48k resample, -g gain
  // aplay: -D volumio (Volumio's modular ALSA device), -f S16_LE (format), -r 48000 (rate), -c 1 (mono)
  var command = 'rtl_fm -f ' + freq + 'M -M wfm -s 180k -r 48k -g ' + gain + 
                ' | aplay -D volumio -f S16_LE -r 48000 -c 1';
  
  self.logger.info('[RTL-SDR Radio] Command: ' + command);
  
  // Start decoder process
  self.decoderProcess = exec(command, function(error, stdout, stderr) {
    if (error) {
      // Only log error if it wasn't an intentional stop
      if (!self.intentionalStop) {
        self.logger.error('[RTL-SDR Radio] Decoder error: ' + error);
      }
      self.decoderProcess = null;
    }
  });
  
  // Store current station for resume
  self.currentStation = {
    uri: 'rtlsdr://fm/' + freq,
    name: stationName,
    service: 'rtlsdr_radio'
  };
  
  // Update Volumio state machine
  self.commandRouter.stateMachine.setConsumeUpdateService('rtlsdr_radio');
  
  var state = {
    status: 'play',
    service: 'rtlsdr_radio',
    title: stationName,
    artist: 'FM ' + freq + ' MHz',
    album: self.getI18nString('FM_RADIO'),
    albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/fm.svg',
    uri: 'rtlsdr://fm/' + freq,
    trackType: 'fm',
    samplerate: '48 KHz',
    bitdepth: '16 bit',
    channels: 1,
    duration: 0,
    seek: 0
  };
  
  // Clear state to force state machine recognition of change
  // This mimics the stop() function behavior to ensure UI update
  self.commandRouter.stateMachine.setVolatile({
    service: 'rtlsdr_radio',
    status: 'stop',
    title: '',
    artist: '',
    album: '',
    uri: ''
  });
  
  self.commandRouter.servicePushState(state, 'rtlsdr_radio');
  
  // Force state machine update to trigger UI refresh
  // This ensures "Received an update from plugin" event fires
  setTimeout(function() {
    self.commandRouter.stateMachine.pushState(state);
  }, 500);
  
  defer.resolve();
};

ControllerRtlsdrRadio.prototype.stop = function() {
  var self = this;
  self.stopDecoder();
  
  // Reset device state to idle
  self.setDeviceState('idle');
  
  // Get current state and just change status to pause
  // Keep all track info for resume
  var currentState = self.commandRouter.stateMachine.getState();
  currentState.status = 'pause';
  self.commandRouter.servicePushState(currentState, 'rtlsdr_radio');
  self.commandRouter.stateMachine.setConsumeUpdateService('');
  // Push stopped state to UI
  self.commandRouter.stateMachine.setVolatile({
    service: 'rtlsdr_radio',
    status: 'pause',
    title: '',
    artist: '',
    album: '',
    uri: ''
  });
  return libQ.resolve();
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

ControllerRtlsdrRadio.prototype.stopDecoder = function() {
  var self = this;
  
  self.logger.info('[RTL-SDR Radio] Stopping all processes');
  self.intentionalStop = true;
  
  try {
    // Kill FM playback processes
    exec('sudo pkill -f "rtl_fm -f"');
    exec('sudo pkill -f "aplay -D volumio"');
    
    // Kill DAB playback processes
    exec('sudo pkill -f "dab-rtlsdr-3"');
    
    // Kill FM scan processes
    exec('sudo pkill -f "rtl_power"');
    
    // Kill DAB scan processes
    exec('sudo pkill -f "dab-scanner-3"');
    
    // Kill sox resampling process
    exec('sudo pkill -f "sox"');
    
    // Kill stored process reference if exists
    if (self.decoderProcess !== null) {
      self.decoderProcess.kill('SIGTERM');
    }
    
    // Kill scan process reference if exists
    if (self.scanProcess !== null) {
      self.scanProcess.kill('SIGTERM');
    }
    
    // Kill sox process reference if exists
    if (self.soxProcess !== null) {
      try {
        self.soxProcess.kill('SIGTERM');
      } catch (e) {}
    }
    
    // Kill aplay process reference if exists
    if (self.aplayProcess !== null) {
      try {
        self.aplayProcess.kill('SIGTERM');
      } catch (e) {}
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Error stopping processes: ' + e);
  }
  
  // Wait for processes to fully terminate
  setTimeout(function() {
    self.decoderProcess = null;
    self.scanProcess = null;
    self.soxProcess = null;
    self.aplayProcess = null;
    // DON'T clear currentStation - needed for resume
  }, 500);
};

ControllerRtlsdrRadio.prototype.testManualFm = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  // Try to get value from data parameter (current form value), fall back to config (saved value)
  var frequency = (data && data.manual_fm_frequency) || self.config.get('manual_fm_frequency', '98.8');
  
  self.logger.info('[RTL-SDR Radio] Testing manual FM: ' + frequency);
  
  // Validate frequency
  var freq = parseFloat(frequency);
  if (isNaN(freq) || freq < 88 || freq > 108) {
    self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
      self.getI18nString('TEST_FM_FAILED').replace('{0}', 'Invalid frequency. Enter 88.0 - 108.0 MHz'));
    defer.reject(new Error('Invalid frequency'));
    return defer.promise;
  }
  
  // Create track object
  var track = {
    uri: 'rtlsdr://fm/' + freq,
    name: 'FM ' + freq + ' (Test)',
    service: 'rtlsdr_radio'
  };
  
  // Play the station
  self.clearAddPlayTrack(track)
    .then(function() {
      self.commandRouter.pushToastMessage('success', self.getI18nString('FM_RADIO'), 
        self.getI18nString('TESTING_FM').replace('{0}', freq));
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
  
  self.logger.info('[RTL-SDR Radio] Testing manual DAB: ' + ensemble + '/' + serviceName + ' (gain: ' + testGain + ')');
  
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
  
  // Store current DAB gain
  var originalGain = self.config.get('dab_gain', 80);
  
  // Temporarily set test gain
  self.config.set('dab_gain', testGain);
  
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
      
      // Restore original gain after 3 seconds
      setTimeout(function() {
        self.config.set('dab_gain', originalGain);
        self.logger.info('[RTL-SDR Radio] Restored DAB gain to ' + originalGain);
      }, 3000);
      
      defer.resolve();
    })
    .fail(function(e) {
      // Restore original gain on failure
      self.config.set('dab_gain', originalGain);
      
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

ControllerRtlsdrRadio.prototype.loadStations = function() {
  var self = this;
  var stationsFile = '/data/plugins/music_service/rtlsdr_radio/stations.json';
  
  try {
    if (fs.existsSync(stationsFile)) {
      var data = fs.readJsonSync(stationsFile);
      var version = self.getDatabaseVersion(data);
      
      self.logger.info('[RTL-SDR Radio] Database version: ' + version);
      
      if (version < 2) {
        // Migration needed from v1 to v2
        self.logger.info('[RTL-SDR Radio] Migrating database from v' + version + ' to v2');
        self.stationsDb = self.migrateDatabase(data);
        
        if (self.stationsDb) {
          // Save migrated database
          self.saveStations();
          self.commandRouter.pushToastMessage('info', 'FM/DAB Radio', 
            self.getI18nString('TOAST_DB_UPGRADED'));
        } else {
          // Migration failed, create new
          self.logger.error('[RTL-SDR Radio] Migration failed, creating new database');
          self.stationsDb = self.createEmptyDatabaseV2();
        }
      } else if (version === 2) {
        // Validate v2 database
        var validation = self.validateDatabaseV2(data);
        if (validation.valid) {
          self.stationsDb = data;
          self.logger.info('[RTL-SDR Radio] Loaded v2 database successfully');
        } else {
          self.logger.error('[RTL-SDR Radio] Database validation failed: ' + 
            validation.errors.join(', '));
          // Try to load backup or create new
          var backupFile = stationsFile + '.backup';
          if (fs.existsSync(backupFile)) {
            self.logger.info('[RTL-SDR Radio] Loading from backup');
            self.stationsDb = fs.readJsonSync(backupFile);
          } else {
            self.logger.info('[RTL-SDR Radio] Creating new database');
            self.stationsDb = self.createEmptyDatabaseV2();
          }
        }
      } else {
        // Unsupported version
        self.logger.error('[RTL-SDR Radio] Unsupported database version: ' + version);
        self.stationsDb = self.createEmptyDatabaseV2();
      }
    } else {
      // No database file, create new v2
      self.logger.info('[RTL-SDR Radio] No stations database found, creating v2');
      self.stationsDb = self.createEmptyDatabaseV2();
    }
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Error loading stations: ' + e);
    self.stationsDb = self.createEmptyDatabaseV2();
  }
  
  // Record when database was loaded for diagnostics
  self.dbLoadedAt = new Date().toISOString();
  self.logger.info('[RTL-SDR Radio] Database loaded at: ' + self.dbLoadedAt);
  
  return libQ.resolve();
};

ControllerRtlsdrRadio.prototype.saveStations = function() {
  var self = this;
  var stationsFile = '/data/plugins/music_service/rtlsdr_radio/stations.json';
  
  try {
    // Validate before saving
    if (self.stationsDb.version === 2) {
      var validation = self.validateDatabaseV2(self.stationsDb);
      if (!validation.valid) {
        self.logger.error('[RTL-SDR Radio] Cannot save invalid database: ' + 
          validation.errors.join(', '));
        return;
      }
    }
    
    fs.writeJsonSync(stationsFile, self.stationsDb);
    self.logger.info('[RTL-SDR Radio] Saved stations database');
  } catch (e) {
    self.logger.error('[RTL-SDR Radio] Failed to save stations: ' + e);
  }
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
  var stationsFile = '/data/plugins/music_service/rtlsdr_radio/stations.json';
  
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
    
    for (var i = 0; i < self.stationsDb.fm.length; i++) {
      if (self.stationsDb.fm[i].frequency === frequency) {
        return {
          type: 'fm',
          station: self.stationsDb.fm[i],
          index: i
        };
      }
    }
  }
  
  // Parse DAB URI: rtlsdr://dab/<channel>/<serviceName>
  if (uri.indexOf('rtlsdr://dab/') === 0) {
    var dabParts = uri.replace('rtlsdr://dab/', '').split('/');
    if (dabParts.length >= 2) {
      var channel = dabParts[0];
      var serviceName = decodeURIComponent(dabParts[1]);
      
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
  
  // Check device availability
  self.checkDeviceAvailable('scan_fm', {})
    .then(function() {
      // Device is available, proceed with scan
      self.setDeviceState('scanning_fm');
      
      self.logger.info('[RTL-SDR Radio] Starting FM scan...');
      self.commandRouter.pushToastMessage('info', self.getI18nString('FM_RADIO'), self.getI18nString('TOAST_FM_SCANNING_UI'));
      
      // Generate unique temp file name
      var scanFile = '/tmp/fm_scan_' + Date.now() + '.csv';
      
      // rtl_power command:
      // -f 88M:108M:125k = Scan 88-108 MHz in 125kHz steps (160 bins)
      // -i 10 = Integrate for 10 seconds
      // -1 = Single-shot mode (exit after one scan)
      var command = 'rtl_power -f 88M:108M:125k -i 10 -1 ' + scanFile;
      
      self.logger.info('[RTL-SDR Radio] Scan command: ' + command);
      
      // Push progress update after 5 seconds
      setTimeout(function() {
        if (self.deviceState === 'scanning_fm') {
          self.commandRouter.pushToastMessage('info', self.getI18nString('FM_RADIO'), 
            self.getI18nString('TOAST_FM_SCANNING_PROGRESS'));
        }
      }, 5000);
      
      self.scanProcess = exec(command, { timeout: 30000 }, function(error, stdout, stderr) {
        if (error) {
          // Only log and show error if stop was not intentional
          if (!self.intentionalStop) {
            self.logger.error('[RTL-SDR Radio] Scan failed: ' + error);
            self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
              self.getI18nStringFormatted('TOAST_SCAN_FAILED', error.message));
          }
          self.setDeviceState('idle');
          self.scanProcess = null;
          defer.reject(error);
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
            
            self.setDeviceState('idle');
            self.scanProcess = null;
            defer.resolve(stations);
          })
          .fail(function(e) {
            self.logger.error('[RTL-SDR Radio] Failed to parse scan results: ' + e);
            self.commandRouter.pushToastMessage('error', self.getI18nString('FM_RADIO'), 
              self.getI18nString('TOAST_PARSE_FAILED'));
            self.setDeviceState('idle');
            self.scanProcess = null;
            defer.reject(e);
          });
      });
    })
    .fail(function(e) {
      self.logger.info('[RTL-SDR Radio] FM scan cancelled or rejected: ' + e);
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
          
          // Round to nearest 0.1 MHz for display
          var freqRounded = Math.round(current.freq * 10) / 10;
          
          stations.push({
            frequency: freqRounded.toFixed(1),
            name: 'FM ' + freqRounded.toFixed(1),
            signal_strength: current.power.toFixed(1),
            last_seen: new Date().toISOString()
          });
          
          self.logger.info('[RTL-SDR Radio] Found station: ' + freqRounded.toFixed(1) + 
                          ' MHz (' + current.power.toFixed(1) + ' dBm)');
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
  
  // Check device availability
  self.checkDeviceAvailable('scan_dab', {})
    .then(function() {
      // Device is available, proceed with scan
      self.setDeviceState('scanning_dab');
      
      self.logger.info('[RTL-SDR Radio] Starting DAB scan...');
      self.commandRouter.pushToastMessage('info', self.getI18nString('DAB_RADIO'), self.getI18nString('TOAST_DAB_SCANNING_UI'));
      
      // Generate unique temp file name
      var scanFile = '/tmp/dab_scan_' + Date.now() + '.json';
      
      // Get DAB gain from config
      var dabGain = self.config.get('dab_gain', 80);
      
      // dab-scanner-3 command:
      // -B BAND_III = Scan Band III (European DAB standard, 174-240 MHz)
      // -G <gain> = Tuner gain (0-49.6, higher = more sensitive)
      // -j = JSON output format
      var command = 'dab-scanner-3 -B BAND_III -G ' + dabGain + ' -j > ' + scanFile;
      
      self.logger.info('[RTL-SDR Radio] DAB scan command: ' + command);
      
      // Track scan start time for progress updates
      var scanStartTime = Date.now();
      
      // Push progress updates every 30 seconds
      var dabProgressInterval = setInterval(function() {
        if (self.deviceState === 'scanning_dab') {
          var elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
          var formattedTime = self.formatElapsedTime(elapsed);
          self.commandRouter.pushToastMessage('info', self.getI18nString('DAB_RADIO'), 
            self.formatString(self.getI18nString('TOAST_DAB_SCANNING_PROGRESS'), formattedTime));
        } else {
          clearInterval(dabProgressInterval);
        }
      }, 30000);
      
      self.scanProcess = exec(command, { timeout: 300000 }, function(error, stdout, stderr) {
        // Clear progress interval
        clearInterval(dabProgressInterval);
        
        // Check if scan file was created (scanner may return error code but still produce valid output)
        var scanFileExists = false;
        try {
          scanFileExists = fs.existsSync(scanFile) && fs.statSync(scanFile).size > 0;
        } catch (e) {
          scanFileExists = false;
        }
        
        if (error && !scanFileExists) {
          // Only reject if scan file was not created
          if (!self.intentionalStop) {
            self.logger.error('[RTL-SDR Radio] DAB scan failed: ' + error);
            self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
              self.getI18nStringFormatted('TOAST_SCAN_FAILED', error.message));
          }
          self.setDeviceState('idle');
          self.scanProcess = null;
          defer.reject(error);
          return;
        }
        
        // Log warning if error occurred but scan file exists
        if (error && scanFileExists) {
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
            
            var totalStations = self.stationsDb.dab.length;
            self.commandRouter.pushToastMessage('success', self.getI18nString('DAB_RADIO'), 
              self.formatString(self.getI18nString('TOAST_SCAN_COMPLETE'), stations.length, totalStations));
            
            self.setDeviceState('idle');
            self.scanProcess = null;
            defer.resolve(stations);
          })
          .fail(function(e) {
            self.logger.error('[RTL-SDR Radio] Failed to parse DAB scan results: ' + e);
            self.commandRouter.pushToastMessage('error', self.getI18nString('DAB_RADIO'), 
              self.getI18nString('TOAST_PARSE_FAILED'));
            self.setDeviceState('idle');
            self.scanProcess = null;
            defer.reject(e);
          });
      });
    })
    .fail(function(e) {
      self.logger.info('[RTL-SDR Radio] DAB scan cancelled or rejected: ' + e);
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
      // dab-scanner-3 outputs debug text before JSON
      // Extract only the JSON portion (starts with '{')
      var jsonStart = data.indexOf('{');
      if (jsonStart === -1) {
        self.logger.error('[RTL-SDR Radio] No JSON found in scan output');
        defer.reject(new Error('No JSON in scan output'));
        return;
      }
      
      var jsonData = data.substring(jsonStart);
      self.logger.info('[RTL-SDR Radio] Extracted JSON from position ' + jsonStart);
      
      // Parse JSON output from dab-scanner-3
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
  
  // Check device availability
  self.checkDeviceAvailable('play_dab', { channel: channel, serviceName: serviceName, stationTitle: stationTitle })
    .then(function() {
      // Device is available, proceed with playback
      self.setDeviceState('playing_dab');
      
      // If decoder is still running, wait for cleanup to complete
      if (self.decoderProcess !== null) {
        self.logger.info('[RTL-SDR Radio] Waiting for previous station cleanup...');
        setTimeout(function() {
          self.startDabPlayback(channel, serviceName, stationTitle, defer);
        }, 600); // Wait slightly longer than stopDecoder timeout (500ms)
      } else {
        self.startDabPlayback(channel, serviceName, stationTitle, defer);
      }
    })
    .fail(function(e) {
      self.logger.info('[RTL-SDR Radio] DAB playback cancelled or rejected: ' + e);
      defer.reject(e);
    });
  
  return defer.promise;
};

ControllerRtlsdrRadio.prototype.startDabPlayback = function(channel, serviceName, stationTitle, defer) {
  var self = this;
  
  // Update play statistics
  var uri = 'rtlsdr://dab/' + channel + '/' + encodeURIComponent(serviceName);
  var stationInfo = self.getStationByUri(uri);
  if (stationInfo) {
    stationInfo.station.playCount = (stationInfo.station.playCount || 0) + 1;
    stationInfo.station.lastPlayed = new Date().toISOString();
    self.saveStations();
  }
  
  // Get DAB gain from config
  var dabGain = self.config.get('dab_gain', 80);
  
  // Clear intentional stop flag when starting new playback
  self.intentionalStop = false;
  
  // Build dab-rtlsdr-3 command piped to aplay
  // -C <channel> = DAB channel (e.g., 12B)
  // -P "<service>" = Service name (must match exactly with spaces)
  // -G <gain> = Tuner gain
  // -D 30 = Detection timeout (30 seconds to find ensemble)
  // 2>/dev/null = Discard debug output to stderr
  // Pipe PCM audio to aplay with Volumio device
  var dabCommand = 'dab-rtlsdr-3 -C ' + channel + 
                   ' -P "' + serviceName.replace(/"/g, '\\"') + '"' +
                   ' -G ' + dabGain + 
                   ' -D 30';
  
  self.logger.info('[RTL-SDR Radio] Starting DAB decoder: ' + dabCommand);
  
  // Spawn dab-rtlsdr-3 process
  var spawn = require('child_process').spawn;
  var dabProcess = spawn('sh', ['-c', dabCommand]);
  
  var pcmDetected = false;
  var soxProcess = null;
  var aplayProcess = null;
  
  // Capture stderr to detect PCM format
  dabProcess.stderr.on('data', function(data) {
    var output = data.toString();
    
    // Look for PCM format line: "PCM: rate=32000 stereo=0 size=3840"
    var pcmMatch = output.match(/PCM: rate=(\d+) stereo=(\d+)/);
    if (pcmMatch && !pcmDetected) {
      pcmDetected = true;
      var sampleRate = parseInt(pcmMatch[1]);
      var stereoFlag = parseInt(pcmMatch[2]);
      
      // CRITICAL: stereo flag is buggy - always assume stereo=2 channels
      var channels = 2;
      
      self.logger.info('[RTL-SDR Radio] Detected PCM format: ' + sampleRate + ' Hz, ' + channels + ' channels');
      
      // Build sox command to resample to 48kHz stereo
      var soxCommand = 'sox -t raw -r ' + sampleRate + ' -c ' + channels + 
                      ' -e signed-integer -b 16 - -t raw -r 48000 -c 2 -';
      
      // Spawn sox process
      soxProcess = spawn('sh', ['-c', soxCommand]);
      
      // Pipe dab stdout to sox stdin
      dabProcess.stdout.pipe(soxProcess.stdin);
      
      // CRITICAL: Handle pipe errors to prevent EPIPE crashes
      dabProcess.stdout.on('error', function(err) {
        if (err.code !== 'EPIPE' && !self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] dab stdout error: ' + err);
        }
      });
      
      // CRITICAL: Handle stdin write errors to prevent EPIPE crashes
      soxProcess.stdin.on('error', function(err) {
        if (err.code !== 'EPIPE' && !self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] sox stdin error: ' + err);
        }
      });
      
      // Spawn aplay process
      aplayProcess = spawn('aplay', ['-D', 'volumio', '-f', 'S16_LE', '-r', '48000', '-c', '2']);
      
      // Pipe sox stdout to aplay stdin
      soxProcess.stdout.pipe(aplayProcess.stdin);
      
      // CRITICAL: Handle pipe errors to prevent EPIPE crashes
      soxProcess.stdout.on('error', function(err) {
        if (err.code !== 'EPIPE' && !self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] sox stdout error: ' + err);
        }
      });
      
      // CRITICAL: Handle stdin write errors to prevent EPIPE crashes
      aplayProcess.stdin.on('error', function(err) {
        if (err.code !== 'EPIPE' && !self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] aplay stdin error: ' + err);
        }
      });
      
      // Handle sox errors
      soxProcess.on('error', function(err) {
        if (!self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] sox error: ' + err);
        }
      });
      
      soxProcess.on('exit', function(code) {
        if (!self.intentionalStop && code !== null && code !== 0) {
          self.logger.error('[RTL-SDR Radio] sox exited with code: ' + code);
        }
      });
      
      // Handle aplay errors
      aplayProcess.on('error', function(err) {
        if (!self.intentionalStop) {
          self.logger.error('[RTL-SDR Radio] aplay error: ' + err);
        }
      });
      
      aplayProcess.on('exit', function(code) {
        if (!self.intentionalStop && code !== null && code !== 0) {
          self.logger.error('[RTL-SDR Radio] aplay exited with code: ' + code);
        }
      });
      
      // Store process references for cleanup
      self.soxProcess = soxProcess;
      self.aplayProcess = aplayProcess;
    }
  });
  
  // Handle dab process errors
  dabProcess.on('error', function(err) {
    if (!self.intentionalStop) {
      self.logger.error('[RTL-SDR Radio] DAB decoder error: ' + err);
    }
  });
  
  dabProcess.on('exit', function(code) {
    if (!self.intentionalStop && code !== null && code !== 0) {
      self.logger.error('[RTL-SDR Radio] DAB decoder exited with code: ' + code);
    }
    
    // Cleanup child processes
    if (soxProcess) {
      try { soxProcess.kill(); } catch(e) {}
    }
    if (aplayProcess) {
      try { aplayProcess.kill(); } catch(e) {}
    }
  });
  
  // Store processes for cleanup
  self.decoderProcess = dabProcess;
  
  // Store current station for resume
  self.currentStation = {
    uri: uri,
    name: stationTitle,
    service: 'rtlsdr_radio'
  };
  
  // Update Volumio state machine
  self.commandRouter.stateMachine.setConsumeUpdateService('rtlsdr_radio');
  
  var state = {
    status: 'play',
    service: 'rtlsdr_radio',
    title: stationTitle,
    artist: self.getI18nString('DAB_RADIO'),
    album: 'Channel ' + channel,
    albumart: '/albumart?sourceicon=music_service/rtlsdr_radio/assets/dab.svg',
    uri: uri,
    trackType: 'DAB',
    samplerate: '48 kHz',
    bitdepth: '16 bit',
    channels: 2,
    duration: 0,
    seek: 0
  };
  
  // Clear state to force state machine recognition of change
  // This mimics the stop() function behavior to ensure UI update
  self.commandRouter.stateMachine.setVolatile({
    service: 'rtlsdr_radio',
    status: 'stop',
    title: '',
    artist: '',
    album: '',
    uri: ''
  });
  
  self.commandRouter.servicePushState(state, 'rtlsdr_radio');
  
  // Force state machine update to trigger UI refresh
  // This ensures "Received an update from plugin" event fires
  setTimeout(function() {
    self.commandRouter.stateMachine.pushState(state);
  }, 500);
  
  defer.resolve();
};
