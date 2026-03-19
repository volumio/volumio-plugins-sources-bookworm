'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var os = require('os');
var express = require('express');
var bodyParser = require('body-parser');

module.exports = PiScreenSetup;

// Plugin banner for managed files
var VIDEOCONFIG_BANNER = '### pi_screen_setup managed - DO NOT EDIT ###';
var INCLUDE_LINE = 'include videoconfig.txt';

// Paths
var BOOT_PATH = '/boot';
var CONFIG_TXT = BOOT_PATH + '/config.txt';
var VIDEOCONFIG_TXT = BOOT_PATH + '/videoconfig.txt';
var VOLUMIOCONFIG_TXT = BOOT_PATH + '/volumioconfig.txt';
var USERCONFIG_TXT = BOOT_PATH + '/userconfig.txt';
var CMDLINE_TXT = BOOT_PATH + '/cmdline.txt';
var OVERLAYS_PATH = BOOT_PATH + '/overlays';
var OVERLAYS_README = OVERLAYS_PATH + '/README';

// Current config directory for OTA comparison
var CURRENT_CONFIG_DIR = '/data/plugins/system_hardware/pi_screen_setup/backups/current';

// Presets cache paths
var PRESETS_CACHE_DIR = '/data/plugins/system_hardware/pi_screen_setup/presets_cache';
var PRESETS_REMOTE_CACHE = PRESETS_CACHE_DIR + '/remote.json';
var PRESETS_DRAFT = PRESETS_CACHE_DIR + '/draft.json';
var PRESETS_METADATA = PRESETS_CACHE_DIR + '/metadata.json';

// Hardware definitions
var PI_MODELS = {
  'Pi 2': { socs: ['bcm2836', 'bcm2837'], hdmi_ports: 1, dsi_ports: ['dsi0'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d' },
  'Pi 3': { socs: ['bcm2837'], hdmi_ports: 1, dsi_ports: ['dsi0'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d' },
  'Pi 4': { socs: ['bcm2711'], hdmi_ports: 2, dsi_ports: ['dsi0', 'dsi1'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d-pi4' },
  'Pi 400': { socs: ['bcm2711'], hdmi_ports: 2, dsi_ports: [], has_composite: false, kms_supported: true, kms_overlay: 'vc4-kms-v3d-pi4' },
  'Pi 5': { socs: ['bcm2712'], hdmi_ports: 2, dsi_ports: ['dsi0', 'dsi1'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d-pi5' },
  'Pi 500': { socs: ['bcm2712'], hdmi_ports: 2, dsi_ports: [], has_composite: false, kms_supported: true, kms_overlay: 'vc4-kms-v3d-pi5' },
  'Pi Zero 2 W': { socs: ['bcm2710'], hdmi_ports: 1, dsi_ports: [], has_composite: true, kms_supported: false, kms_overlay: null },
  'CM3': { socs: ['bcm2837'], hdmi_ports: 1, dsi_ports: ['dsi0'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d' },
  'CM4': { socs: ['bcm2711'], hdmi_ports: 2, dsi_ports: ['dsi0', 'dsi1'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d-pi4' },
  'CM5': { socs: ['bcm2712'], hdmi_ports: 2, dsi_ports: ['dsi0', 'dsi1'], has_composite: true, kms_supported: true, kms_overlay: 'vc4-kms-v3d-pi5' }
};

// Resolution presets
var HDMI_RESOLUTIONS = {
  'auto': { label: 'Auto Detect', group: 0, mode: 0 },
  '720p50': { label: '720p 50Hz', group: 1, mode: 19 },
  '720p60': { label: '720p 60Hz', group: 1, mode: 4 },
  '1080i50': { label: '1080i 50Hz', group: 1, mode: 20 },
  '1080i60': { label: '1080i 60Hz', group: 1, mode: 5 },
  '1080p50': { label: '1080p 50Hz', group: 1, mode: 31 },
  '1080p60': { label: '1080p 60Hz', group: 1, mode: 16 },
  '2160p30': { label: '4K 30Hz', group: 1, mode: 95 },
  '2160p60': { label: '4K 60Hz (Pi 4/5 only)', group: 1, mode: 97 },
  '480p': { label: '480p 60Hz', group: 1, mode: 2 },
  '576p': { label: '576p 50Hz', group: 1, mode: 17 },
  'vga': { label: 'VGA 640x480', group: 2, mode: 4 },
  'svga': { label: 'SVGA 800x600', group: 2, mode: 9 },
  'xga': { label: 'XGA 1024x768', group: 2, mode: 16 },
  'sxga': { label: 'SXGA 1280x1024', group: 2, mode: 35 },
  'wxga': { label: 'WXGA 1280x800', group: 2, mode: 28 },
  'wsxga': { label: 'WSXGA+ 1680x1050', group: 2, mode: 58 },
  'fhd': { label: 'FHD 1920x1080', group: 2, mode: 82 },
  'wuxga': { label: 'WUXGA 1920x1200', group: 2, mode: 69 },
  'custom': { label: 'Custom (CVT)', group: 0, mode: 0 }
};

// NOTE: DSI and DPI presets are loaded from display_presets.json
// No hardcoded overlays - database is the single source of truth

// Composite modes (these are standard Pi values, not display-specific)
var COMPOSITE_MODES = {
  'pal': { label: 'PAL (Europe/Australia)', mode: 2 },
  'ntsc': { label: 'NTSC (Americas/Japan)', mode: 0 },
  'pal-m': { label: 'PAL-M (Brazil)', mode: 64 },
  'pal-n': { label: 'PAL-N (Argentina)', mode: 66 }
};

// CMA size options
var CMA_OPTIONS = {
  'default': { label: 'Default (64MB)', value: 64 },
  'low': { label: 'Low (32MB)', value: 32 },
  'medium': { label: 'Medium (128MB)', value: 128 },
  'high': { label: 'High (256MB)', value: 256 },
  'max': { label: 'Maximum (512MB)', value: 512 },
  'custom': { label: 'Custom', value: 0 }
};

// Migration detection patterns - must match install.sh patterns
var MIGRATION_PATTERNS = [
  /^dtoverlay=vc4-kms-v3d/m,
  /^dtoverlay=vc4-fkms-v3d/m,
  /^dtoverlay=.*dsi/im,
  /^dtoverlay=.*dpi/im,
  /^dtoverlay=.*hyperpixel/im,
  /^dtoverlay=.*vga666/im,
  /^hdmi_/m,                       // Match ANY hdmi_ setting
  /^display_auto_detect/m,         // Auto-detect setting (ours)
  /^display_default_lcd/m,         // LCD default setting (ours)
  // NOTE: display_rotate, display_lcd_rotate, display_hdmi_rotate belong to Touch Display plugin - DO NOT MIGRATE
  /^sdtv_/m,                       // Match ANY sdtv_ setting
  /^framebuffer_/m,                // Match ANY framebuffer_ setting
  /^enable_tvout/m                 // Composite enable
];

/**
 * Natural sort comparator for display preset names
 * Handles numeric values properly: "2.8 inch" < "10.1 inch"
 * Also handles: 8" = 8.0", version numbers, resolutions
 */
function naturalSortCompare(a, b) {
  // Split strings into chunks of numbers and non-numbers
  var reChunk = /(\d+\.?\d*|\D+)/g;
  var chunksA = (a || '').toLowerCase().match(reChunk) || [];
  var chunksB = (b || '').toLowerCase().match(reChunk) || [];
  
  var len = Math.max(chunksA.length, chunksB.length);
  for (var i = 0; i < len; i++) {
    var chunkA = chunksA[i] || '';
    var chunkB = chunksB[i] || '';
    
    // Check if both chunks are numeric
    var numA = parseFloat(chunkA);
    var numB = parseFloat(chunkB);
    var isNumA = !isNaN(numA);
    var isNumB = !isNaN(numB);
    
    if (isNumA && isNumB) {
      // Compare as numbers
      if (numA !== numB) {
        return numA - numB;
      }
    } else if (isNumA) {
      // Numbers come before non-numbers
      return -1;
    } else if (isNumB) {
      return 1;
    } else {
      // Compare as strings
      var cmp = chunkA.localeCompare(chunkB);
      if (cmp !== 0) {
        return cmp;
      }
    }
  }
  return 0;
}


function PiScreenSetup(context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self.pluginName = 'pi_screen_setup';
  self.pluginType = 'system_hardware';
  self.pluginDir = __dirname;
  self.backupDir = path.join('/data/plugins', self.pluginType, self.pluginName, 'backups');
  self.factoryDir = path.join(self.backupDir, 'factory');
  self.restorePointsDir = path.join(self.backupDir, 'restore_points');

  // Hardware info cache
  self.hardwareInfo = null;

  // i18n strings cache
  self.i18nStrings = null;
  self.i18nStringsDefaults = null;
  
  // Migration state (use instance variable for immediate access)
  self.migrationStateCache = null;
  
  // Migration data cache (bypass v-conf timing issues)
  self.migrationRawLinesCache = null;
  self.migrationParsedCache = null;
  
  // Wizard step cache (bypass v-conf timing issues)
  self.wizardStepCache = null;
  
  // Wizard complete cache (bypass v-conf timing issues)
  self.wizardCompleteCache = null;
  
  // Primary output cache (bypass v-conf timing issues)
  self.primaryOutputCache = null;
  
  // Step 2 audio section flag (shows audio section after primary non-HDMI config is saved)
  self.step2ShowAudioCache = false;
  
  // Wizard data cache - stores ALL config values set during wizard (bypass v-conf timing issues)
  self.wizardDataCache = {};
  
  // Display presets cache
  self.displayPresets = null;
  self.displayPresetsVersion = null;
  self.displayPresetsDate = null;
  
  // Database update state
  self.presetsMetadata = null;
  self.presetsCacheDir = path.join('/data/plugins', self.pluginType, self.pluginName, 'presets_cache');
  
  // Admin working copy
  self.draftPresets = null;
  
  // Ephemeral UI state (not persisted, resets on page load)
  self.showDatabaseSettingsUI = false;
  self.showAdvancedSettingsUI = false;
  self.showAdminUI = false;
  self.adminLoadedPreset = null;
  self.adminSelectedPresetId = null;
  
  // Express server for preset management web interface
  self.expressApp = null;
  self.expressServer = null;
  self.MANAGEMENT_PORT = 4567;
  
  // Backups directory
  self.presetsBackupDir = path.join(self.presetsCacheDir, 'backups');
  
  // Drift detection state (for OTA recovery)
  self.driftDetected = false;
  self.driftErrors = [];
  
  // Restore point selection (for UI)
  self.selectedRestorePoint = null;
}

// Helper to get config value - checks cache first, then v-conf, then default
PiScreenSetup.prototype.getConfigValue = function(key, defaultValue) {
  var self = this;
  
  // Check wizard data cache first
  if (self.wizardDataCache && self.wizardDataCache.hasOwnProperty(key)) {
    return self.wizardDataCache[key];
  }
  
  // Try v-conf
  var value = self.config.get(key);
  if (value !== undefined && value !== null) {
    return value;
  }
  
  // Return default
  return defaultValue;
};

// Helper to set config value - sets both v-conf and cache
PiScreenSetup.prototype.setConfigValue = function(key, value) {
  var self = this;
  
  // Set in v-conf
  self.config.set(key, value);
  
  // Set in cache for immediate access
  if (!self.wizardDataCache) {
    self.wizardDataCache = {};
  }
  self.wizardDataCache[key] = value;
};


// ============================================================================
// LIFECYCLE METHODS
// ============================================================================

PiScreenSetup.prototype.onVolumioStart = function() {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);

  return libQ.resolve();
};

PiScreenSetup.prototype.onStart = function() {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('pi_screen_setup: Starting plugin');

  // Load i18n strings
  self.loadI18n();

  // Load display presets
  self.loadDisplayPresets();

  // Ensure backup directory exists
  fs.ensureDirSync(self.backupDir);
  
  // Ensure presets backup directory exists
  fs.ensureDirSync(self.presetsBackupDir);

  // Detect hardware
  self.detectHardware()
    .then(function(hwInfo) {
      self.hardwareInfo = hwInfo;
      self.config.set('hardware.model', hwInfo.model);
      self.config.set('hardware.soc', hwInfo.soc);
      self.config.set('hardware.ram_mb', hwInfo.ram_mb);
      self.config.set('hardware.detected', true);

      // Perform boot validation
      return self.validateBootConfig();
    })
    .then(function(validationResult) {
      if (validationResult.drift_detected) {
        self.handleConfigDrift(validationResult);
      }
      
      // Start management server
      return self.startManagementServer();
    })
    .then(function() {
      // Check for database updates if auto_check enabled
      if (self.config.get('database.auto_check', true)) {
        var lastCheck = self.config.get('database.last_check', '');
        var checkInterval = self.config.get('database.check_interval_hours', 24);
        var shouldCheck = true;
        
        if (lastCheck) {
          var lastCheckDate = new Date(lastCheck);
          var hoursSince = (Date.now() - lastCheckDate.getTime()) / (1000 * 60 * 60);
          shouldCheck = hoursSince >= checkInterval;
        }
        
        if (shouldCheck) {
          self.checkDatabaseUpdate()
            .then(function(result) {
              if (result.available) {
                self.logger.info('pi_screen_setup: Database update available - v' + result.remote_version);
              }
            })
            .fail(function(err) {
              self.logger.warn('pi_screen_setup: Auto-check failed - ' + err);
            });
        }
      }
      
      defer.resolve();
    })
    .fail(function(err) {
      self.logger.error('pi_screen_setup: Failed to start - ' + err);
      defer.resolve(); // Resolve anyway to not block boot
    });

  return defer.promise;
};

PiScreenSetup.prototype.onStop = function() {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('pi_screen_setup: Stopping plugin');
  
  // Stop management server
  if (self.expressServer) {
    try {
      self.expressServer.close();
      self.expressApp = null;
      self.expressServer = null;
      self.logger.info('pi_screen_setup: Management server stopped');
    } catch (e) {
      self.logger.error('pi_screen_setup: Error stopping management server - ' + e);
    }
  }
  
  defer.resolve();

  return defer.promise;
};

PiScreenSetup.prototype.onRestart = function() {
  var self = this;
  self.logger.info('pi_screen_setup: Restarting plugin');
};

PiScreenSetup.prototype.onVolumioReboot = function() {
  var self = this;
  self.logger.info('pi_screen_setup: System rebooting');
  return libQ.resolve();
};

PiScreenSetup.prototype.onVolumioShutdown = function() {
  var self = this;
  self.logger.info('pi_screen_setup: System shutting down');
  return libQ.resolve();
};

PiScreenSetup.prototype.getConfigurationFiles = function() {
  return ['config.json'];
};

// ============================================================================
// MANAGEMENT SERVER
// ============================================================================

PiScreenSetup.prototype.startManagementServer = function() {
  var self = this;
  var defer = libQ.defer();
  
  try {
    // Initialize Express app
    self.expressApp = express();
    self.expressApp.use(bodyParser.json({ limit: '10mb' }));
    self.expressApp.use(bodyParser.urlencoded({ extended: true }));
    
    // CORS headers for local access
    self.expressApp.use(function(req, res, next) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
    
    // Serve HTML page
    self.expressApp.get('/', function(req, res) {
      res.sendFile(path.join(__dirname, 'presets_admin.html'));
    });
    
    // ========================================
    // API: Language (for i18n)
    // ========================================
    self.expressApp.get('/api/language', function(req, res) {
      try {
        // Use Volumio's shared vars - same method as rtlsdr_radio plugin
        var lang = self.commandRouter.sharedVars.get('language_code') || 'en';
        res.json({ language: lang });
      } catch (e) {
        self.logger.error('pi_screen_setup: Failed to get language setting: ' + e);
        res.json({ language: 'en' });
      }
    });
    
    // ========================================
    // API: i18n Translations
    // ========================================
    self.expressApp.get('/api/i18n/:lang', function(req, res) {
      var lang = req.params.lang || 'en';
      var stringsFile = path.join(__dirname, 'i18n', 'strings_' + lang + '.json');
      
      fs.readFile(stringsFile, 'utf8', function(err, data) {
        if (err) {
          // Fallback to English
          self.logger.info('pi_screen_setup: Translation file not found for ' + lang + ', using English');
          stringsFile = path.join(__dirname, 'i18n', 'strings_en.json');
          fs.readFile(stringsFile, 'utf8', function(err2, data2) {
            if (err2) {
              self.logger.error('pi_screen_setup: Failed to load English translations: ' + err2);
              res.status(500).json({ error: 'Failed to load translations' });
            } else {
              try {
                var translations = JSON.parse(data2);
                // Unwrap PI_SCREEN_SETUP if present
                var keys = Object.keys(translations);
                if (keys.length === 1 && typeof translations[keys[0]] === 'object') {
                  res.json(translations[keys[0]]);
                } else {
                  res.json(translations);
                }
              } catch (e) {
                self.logger.error('pi_screen_setup: Failed to parse English translations: ' + e);
                res.status(500).json({ error: 'Failed to parse translations' });
              }
            }
          });
        } else {
          try {
            var translations = JSON.parse(data);
            // Unwrap PI_SCREEN_SETUP if present
            var keys = Object.keys(translations);
            if (keys.length === 1 && typeof translations[keys[0]] === 'object') {
              res.json(translations[keys[0]]);
            } else {
              res.json(translations);
            }
          } catch (e) {
            self.logger.error('pi_screen_setup: Failed to parse translations for ' + lang + ': ' + e);
            res.status(500).json({ error: 'Failed to parse translations' });
          }
        }
      });
    });
    
    // ========================================
    // API: Database Info
    // ========================================
    self.expressApp.get('/api/database/info', function(req, res) {
      try {
        var remoteVersion = '-';
        if (self.presetsMetadata && self.presetsMetadata.remote_version) {
          remoteVersion = self.presetsMetadata.remote_version;
        }
        
        res.json({
          localVersion: self.displayPresetsVersion || '-',
          remoteVersion: remoteVersion,
          presetCount: Object.keys(self.displayPresets || {}).length,
          source: self.config.get('database.active_source', 'bundled')
        });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (database/info) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Get All Presets
    // ========================================
    self.expressApp.get('/api/presets', function(req, res) {
      try {
        // Initialize draft if not exists
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        res.json({
          version: self.draftPresets ? self.draftPresets.version : self.displayPresetsVersion,
          presets: self.draftPresets ? self.draftPresets.presets : self.displayPresets
        });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (presets) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Get Single Preset
    // ========================================
    self.expressApp.get('/api/presets/:id', function(req, res) {
      try {
        var id = req.params.id;
        
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        var preset = self.draftPresets.presets[id];
        if (!preset) {
          return res.status(404).json({ error: 'Preset not found' });
        }
        
        res.json({ id: id, preset: preset });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (presets/:id) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Add New Preset
    // ========================================
    self.expressApp.post('/api/presets', function(req, res) {
      try {
        var data = req.body;
        
        if (!data.id || !data.name) {
          return res.status(400).json({ error: 'ID and name are required' });
        }
        
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        // Check for duplicate ID
        if (self.draftPresets.presets[data.id]) {
          return res.status(409).json({ error: 'Preset ID already exists' });
        }
        
        // Add preset
        self.draftPresets.presets[data.id] = {
          name: data.name,
          type: data.type || 'hdmi',
          description: data.description || '',
          config: data.config || {}
        };
        
        // Update version if provided
        if (data.version) {
          self.draftPresets.version = data.version;
        }
        
        // Save draft
        self.saveDraftPresets();
        self.config.set('admin.draft_dirty', true);
        
        // Auto-publish to working copy
        self.displayPresets = JSON.parse(JSON.stringify(self.draftPresets.presets));
        self.displayPresetsVersion = self.draftPresets.version;
        
        res.json({ success: true, id: data.id });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (POST presets) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Update Preset
    // ========================================
    self.expressApp.post('/api/presets/:id', function(req, res) {
      try {
        var id = req.params.id;
        var data = req.body;
        
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        if (!self.draftPresets.presets[id]) {
          return res.status(404).json({ error: 'Preset not found' });
        }
        
        // Update preset
        self.draftPresets.presets[id] = {
          name: data.name || self.draftPresets.presets[id].name,
          type: data.type || self.draftPresets.presets[id].type,
          description: data.description !== undefined ? data.description : self.draftPresets.presets[id].description,
          config: data.config || self.draftPresets.presets[id].config
        };
        
        // Update version if provided
        if (data.version) {
          self.draftPresets.version = data.version;
        }
        
        // Save draft
        self.saveDraftPresets();
        self.config.set('admin.draft_dirty', true);
        
        // Auto-publish to working copy
        self.displayPresets = JSON.parse(JSON.stringify(self.draftPresets.presets));
        self.displayPresetsVersion = self.draftPresets.version;
        
        res.json({ success: true, id: id });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (POST presets/:id) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Delete Preset
    // ========================================
    self.expressApp.delete('/api/presets/:id', function(req, res) {
      try {
        var id = req.params.id;
        var version = req.query.version;
        
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        if (!self.draftPresets.presets[id]) {
          return res.status(404).json({ error: 'Preset not found' });
        }
        
        // Delete preset
        delete self.draftPresets.presets[id];
        
        // Update version if provided
        if (version) {
          self.draftPresets.version = version;
        }
        
        // Save draft
        self.saveDraftPresets();
        self.config.set('admin.draft_dirty', true);
        
        // Auto-publish to working copy
        self.displayPresets = JSON.parse(JSON.stringify(self.draftPresets.presets));
        self.displayPresetsVersion = self.draftPresets.version;
        
        res.json({ success: true });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (DELETE presets/:id) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Import from URL
    // ========================================
    self.expressApp.post('/api/database/import-url', function(req, res) {
      var url = req.body.url;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }
      
      self.fetchRemoteDatabase(url)
        .then(function(data) {
          if (!data.presets) {
            throw new Error('Invalid database format');
          }
          
          self.draftPresets = data;
          self.saveDraftPresets();
          self.config.set('admin.draft_dirty', true);
          
          // Auto-publish
          self.displayPresets = JSON.parse(JSON.stringify(data.presets));
          self.displayPresetsVersion = data.version;
          
          res.json({ success: true, version: data.version, count: Object.keys(data.presets).length });
        })
        .fail(function(err) {
          res.status(500).json({ error: err.message || 'Failed to fetch URL' });
        });
    });
    
    // ========================================
    // API: Import from Path
    // ========================================
    self.expressApp.post('/api/database/import-path', function(req, res) {
      try {
        var filePath = req.body.path;
        if (!filePath) {
          return res.status(400).json({ error: 'Path is required' });
        }
        
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'File not found' });
        }
        
        var data = fs.readJsonSync(filePath);
        if (!data.presets) {
          return res.status(400).json({ error: 'Invalid database format' });
        }
        
        self.draftPresets = data;
        self.saveDraftPresets();
        self.config.set('admin.draft_dirty', true);
        
        // Auto-publish
        self.displayPresets = JSON.parse(JSON.stringify(data.presets));
        self.displayPresetsVersion = data.version;
        
        res.json({ success: true, version: data.version, count: Object.keys(data.presets).length });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (import-path) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Import from Upload Data
    // ========================================
    self.expressApp.post('/api/database/import-data', function(req, res) {
      try {
        var data = req.body;
        if (!data.presets) {
          return res.status(400).json({ error: 'Invalid database format' });
        }
        
        self.draftPresets = data;
        self.saveDraftPresets();
        self.config.set('admin.draft_dirty', true);
        
        // Auto-publish
        self.displayPresets = JSON.parse(JSON.stringify(data.presets));
        self.displayPresetsVersion = data.version;
        
        res.json({ success: true, version: data.version, count: Object.keys(data.presets).length });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (import-data) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Export/Download Database
    // ========================================
    self.expressApp.get('/api/database/export', function(req, res) {
      try {
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        var exportData = {
          version: self.draftPresets.version || self.displayPresetsVersion,
          date: new Date().toISOString().split('T')[0],
          presets: self.draftPresets.presets || self.displayPresets
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=display_presets.json');
        res.send(JSON.stringify(exportData, null, 2));
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (export) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Export for GitHub PR
    // ========================================
    self.expressApp.post('/api/database/export-pr', function(req, res) {
      try {
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        var exportData = {
          version: self.draftPresets.version || self.displayPresetsVersion,
          date: new Date().toISOString().split('T')[0],
          presets: self.draftPresets.presets || self.displayPresets
        };
        
        var exportPath = path.join(self.presetsCacheDir, 'display_presets_export.json');
        fs.writeJsonSync(exportPath, exportData, { spaces: 2 });
        
        res.json({ success: true, path: exportPath });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (export-pr) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Publish to Cache
    // ========================================
    self.expressApp.post('/api/database/publish', function(req, res) {
      try {
        if (!self.draftPresets) {
          return res.status(400).json({ error: 'No draft to publish' });
        }
        
        // Save to cache location
        fs.ensureDirSync(self.presetsCacheDir);
        fs.writeJsonSync(PRESETS_REMOTE_CACHE, self.draftPresets, { spaces: 2 });
        
        // Update config
        self.config.set('database.active_source', 'cached');
        self.config.set('admin.draft_dirty', false);
        
        // Update working copy
        self.displayPresets = JSON.parse(JSON.stringify(self.draftPresets.presets));
        self.displayPresetsVersion = self.draftPresets.version;
        
        res.json({ success: true, version: self.draftPresets.version });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (publish) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Revert to Bundled
    // ========================================
    self.expressApp.post('/api/database/revert', function(req, res) {
      try {
        // Load bundled presets
        var bundledPath = path.join(__dirname, 'display_presets.json');
        var bundled = fs.readJsonSync(bundledPath);
        
        // Update working copy
        self.displayPresets = bundled.presets;
        self.displayPresetsVersion = bundled.version;
        self.displayPresetsDate = bundled.date;
        
        // Reset draft
        self.draftPresets = JSON.parse(JSON.stringify(bundled));
        self.saveDraftPresets();
        
        // Update config
        self.config.set('database.active_source', 'bundled');
        self.config.set('admin.draft_dirty', false);
        
        res.json({ success: true, version: bundled.version });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (revert) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Reload from Cache
    // ========================================
    self.expressApp.post('/api/database/reload-cache', function(req, res) {
      try {
        if (!fs.existsSync(PRESETS_REMOTE_CACHE)) {
          return res.status(404).json({ error: 'No cached database found' });
        }
        
        var cached = fs.readJsonSync(PRESETS_REMOTE_CACHE);
        
        // Update working copy
        self.displayPresets = cached.presets;
        self.displayPresetsVersion = cached.version;
        
        // Reset draft
        self.draftPresets = JSON.parse(JSON.stringify(cached));
        
        // Update config
        self.config.set('database.active_source', 'cached');
        self.config.set('admin.draft_dirty', false);
        
        res.json({ success: true, version: cached.version });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (reload-cache) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: List Backups
    // ========================================
    self.expressApp.get('/api/backups', function(req, res) {
      try {
        fs.ensureDirSync(self.presetsBackupDir);
        
        var files = fs.readdirSync(self.presetsBackupDir)
          .filter(function(f) { return f.endsWith('.json'); })
          .map(function(f) {
            var stat = fs.statSync(path.join(self.presetsBackupDir, f));
            return {
              name: f,
              date: stat.mtime.toISOString()
            };
          })
          .sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        
        res.json({ backups: files });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (backups) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Create Backup
    // ========================================
    self.expressApp.post('/api/backups', function(req, res) {
      try {
        fs.ensureDirSync(self.presetsBackupDir);
        
        if (!self.draftPresets) {
          self.initDraftPresets();
        }
        
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        var backupName = 'presets_backup_' + timestamp + '.json';
        var backupPath = path.join(self.presetsBackupDir, backupName);
        
        fs.writeJsonSync(backupPath, self.draftPresets, { spaces: 2 });
        
        res.json({ success: true, name: backupName });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (create backup) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Download Backup
    // ========================================
    self.expressApp.get('/api/backups/:name', function(req, res) {
      try {
        var backupPath = path.join(self.presetsBackupDir, req.params.name);
        
        if (!fs.existsSync(backupPath)) {
          return res.status(404).json({ error: 'Backup not found' });
        }
        
        res.download(backupPath);
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (download backup) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Delete Backup
    // ========================================
    self.expressApp.delete('/api/backups/:name', function(req, res) {
      try {
        var backupPath = path.join(self.presetsBackupDir, req.params.name);
        
        if (!fs.existsSync(backupPath)) {
          return res.status(404).json({ error: 'Backup not found' });
        }
        
        fs.unlinkSync(backupPath);
        
        res.json({ success: true });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (delete backup) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Upload Backup
    // ========================================
    self.expressApp.post('/api/backups/upload', function(req, res) {
      try {
        var data = req.body.data;
        var name = req.body.name || ('uploaded_' + Date.now() + '.json');
        
        if (!data || !data.presets) {
          return res.status(400).json({ error: 'Invalid backup data' });
        }
        
        fs.ensureDirSync(self.presetsBackupDir);
        var backupPath = path.join(self.presetsBackupDir, name);
        
        fs.writeJsonSync(backupPath, data, { spaces: 2 });
        
        res.json({ success: true, name: name });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (upload backup) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // API: Restore Backup
    // ========================================
    self.expressApp.post('/api/backups/restore', function(req, res) {
      try {
        var name = req.body.name;
        var backupPath = path.join(self.presetsBackupDir, name);
        
        if (!fs.existsSync(backupPath)) {
          return res.status(404).json({ error: 'Backup not found' });
        }
        
        var data = fs.readJsonSync(backupPath);
        
        if (!data.presets) {
          return res.status(400).json({ error: 'Invalid backup format' });
        }
        
        // Restore to draft and working copy
        self.draftPresets = data;
        self.saveDraftPresets();
        
        self.displayPresets = JSON.parse(JSON.stringify(data.presets));
        self.displayPresetsVersion = data.version;
        
        self.config.set('admin.draft_dirty', false);
        
        res.json({ success: true, version: data.version });
      } catch (e) {
        self.logger.error('pi_screen_setup: API error (restore backup) - ' + e);
        res.status(500).json({ error: e.message });
      }
    });
    
    // Start server
    self.expressServer = self.expressApp.listen(self.MANAGEMENT_PORT, function() {
      self.logger.info('pi_screen_setup: Management server started on port ' + self.MANAGEMENT_PORT);
      defer.resolve();
    });
    
    // Handle server errors
    self.expressServer.on('error', function(e) {
      if (e.code === 'EADDRINUSE') {
        self.logger.error('pi_screen_setup: Port ' + self.MANAGEMENT_PORT + ' already in use');
        defer.resolve(); // Don't fail plugin start
      } else {
        self.logger.error('pi_screen_setup: Management server error - ' + e);
        defer.resolve();
      }
    });
    
  } catch (e) {
    self.logger.error('pi_screen_setup: Failed to start management server - ' + e);
    defer.resolve(); // Don't fail plugin start
  }
  
  return defer.promise;
};

PiScreenSetup.prototype.getManagementUrl = function() {
  var self = this;
  
  // Priority: 1) User-configured override, 2) MDNS hostname
  var hostname;
  var override = self.config.get('database.hostname_override', '');
  
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


// ============================================================================
// HARDWARE DETECTION
// ============================================================================

PiScreenSetup.prototype.detectHardware = function() {
  var self = this;
  var defer = libQ.defer();

  var hwInfo = {
    model: 'Unknown',
    model_raw: '',
    soc: 'unknown',
    ram_mb: 0,
    hdmi_ports: 0,
    dsi_ports: [],
    has_composite: false,
    kms_supported: false,
    kms_overlay: null,
    is_pi: false
  };

  try {
    // Read model from device-tree
    if (fs.existsSync('/proc/device-tree/model')) {
      hwInfo.model_raw = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
      self.logger.info('pi_screen_setup: Detected model: ' + hwInfo.model_raw);
    }

    // Read SoC from device-tree compatible
    if (fs.existsSync('/proc/device-tree/compatible')) {
      var compatible = fs.readFileSync('/proc/device-tree/compatible', 'utf8').replace(/\0/g, ',');
      var socMatch = compatible.match(/bcm2[0-9]+/);
      if (socMatch) {
        hwInfo.soc = socMatch[0];
        self.logger.info('pi_screen_setup: Detected SoC: ' + hwInfo.soc);
      }
    }

    // Read RAM from meminfo
    if (fs.existsSync('/proc/meminfo')) {
      var meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      var memMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
      if (memMatch) {
        hwInfo.ram_mb = Math.round(parseInt(memMatch[1], 10) / 1024);
        self.logger.info('pi_screen_setup: Detected RAM: ' + hwInfo.ram_mb + ' MB');
      }
    }

    // Match to known Pi model
    hwInfo.is_pi = hwInfo.model_raw.toLowerCase().indexOf('raspberry pi') !== -1;

    if (hwInfo.is_pi) {
      // Determine specific model
      for (var modelName in PI_MODELS) {
        var modelDef = PI_MODELS[modelName];
        if (modelDef.socs.indexOf(hwInfo.soc) !== -1) {
          // Check model name match for disambiguation
          var modelLower = hwInfo.model_raw.toLowerCase();
          var matchName = modelName.toLowerCase();

          if (modelLower.indexOf('zero 2') !== -1 && matchName === 'pi zero 2 w') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('400') !== -1 && matchName === 'pi 400') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('500') !== -1 && matchName === 'pi 500') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('compute module 3') !== -1 && matchName === 'cm3') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('compute module 4') !== -1 && matchName === 'cm4') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('compute module 5') !== -1 && matchName === 'cm5') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('pi 5') !== -1 && matchName === 'pi 5') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('pi 4') !== -1 && matchName === 'pi 4') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('pi 3') !== -1 && matchName === 'pi 3') {
            hwInfo.model = modelName;
            break;
          } else if (modelLower.indexOf('pi 2') !== -1 && matchName === 'pi 2') {
            hwInfo.model = modelName;
            break;
          }
        }
      }

      // Apply model capabilities
      if (PI_MODELS[hwInfo.model]) {
        var caps = PI_MODELS[hwInfo.model];
        hwInfo.hdmi_ports = caps.hdmi_ports;
        hwInfo.dsi_ports = caps.dsi_ports;
        hwInfo.has_composite = caps.has_composite;
        hwInfo.kms_supported = caps.kms_supported;
        hwInfo.kms_overlay = caps.kms_overlay;
      }
    }

    self.logger.info('pi_screen_setup: Hardware detection complete - ' + JSON.stringify(hwInfo));
    defer.resolve(hwInfo);

  } catch (err) {
    self.logger.error('pi_screen_setup: Hardware detection error - ' + err);
    defer.resolve(hwInfo); // Return partial info
  }

  return defer.promise;
};

PiScreenSetup.prototype.getHardwareCapabilities = function() {
  var self = this;

  if (!self.hardwareInfo) {
    return {
      outputs: [],
      kms_supported: false,
      warnings: ['Hardware not yet detected']
    };
  }

  var hw = self.hardwareInfo;
  var outputs = [];
  var warnings = [];

  // HDMI outputs
  if (hw.hdmi_ports >= 1) {
    outputs.push({ id: 'hdmi0', label: hw.hdmi_ports > 1 ? 'HDMI 0 (Primary)' : 'HDMI', type: 'hdmi' });
  }
  if (hw.hdmi_ports >= 2) {
    outputs.push({ id: 'hdmi1', label: 'HDMI 1 (Secondary)', type: 'hdmi' });
  }

  // DSI outputs
  if (hw.dsi_ports.indexOf('dsi0') !== -1) {
    outputs.push({ id: 'dsi0', label: hw.dsi_ports.length > 1 ? 'DSI 0' : 'DSI', type: 'dsi' });
  }
  if (hw.dsi_ports.indexOf('dsi1') !== -1) {
    outputs.push({ id: 'dsi1', label: 'DSI 1', type: 'dsi' });
  }

  // DPI always available on Pi (uses GPIO)
  if (hw.is_pi) {
    outputs.push({ id: 'dpi', label: 'DPI (GPIO)', type: 'dpi' });
  }

  // Composite
  if (hw.has_composite) {
    outputs.push({ id: 'composite', label: 'Composite (RCA)', type: 'composite' });
    if (hw.hdmi_ports > 1) {
      warnings.push(self.getI18n('COMPOSITE_DISABLES_HDMI'));
    }
  }

  // Custom overlay
  outputs.push({ id: 'custom', label: self.getI18n('CUSTOM_OVERLAY'), type: 'custom' });

  // Headless
  outputs.push({ id: 'headless', label: self.getI18n('HEADLESS_MODE'), type: 'headless' });

  // KMS warnings
  if (!hw.kms_supported) {
    warnings.push(self.getI18n('KMS_NOT_SUPPORTED'));
  }

  // RAM warnings
  if (hw.ram_mb > 0 && hw.ram_mb < 1024) {
    warnings.push(self.getI18n('LOW_RAM_WARNING'));
  }

  return {
    outputs: outputs,
    kms_supported: hw.kms_supported,
    kms_overlay: hw.kms_overlay,
    warnings: warnings
  };
};


// ============================================================================
// I18N METHODS
// ============================================================================

PiScreenSetup.prototype.loadI18n = function() {
  var self = this;
  var langCode = self.commandRouter.sharedVars.get('language_code');

  try {
    var langFile = path.join(self.pluginDir, 'i18n', 'strings_' + langCode + '.json');
    if (fs.existsSync(langFile)) {
      self.i18nStrings = fs.readJsonSync(langFile);
    }
  } catch (e) {
    self.logger.info('pi_screen_setup: Language file not found for ' + langCode);
  }

  try {
    self.i18nStringsDefaults = fs.readJsonSync(path.join(self.pluginDir, 'i18n', 'strings_en.json'));
  } catch (e) {
    self.logger.error('pi_screen_setup: Could not load default language file');
    self.i18nStringsDefaults = {};
  }
};

PiScreenSetup.prototype.getI18n = function(key) {
  var self = this;

  if (self.i18nStrings && self.i18nStrings.PI_SCREEN_SETUP && self.i18nStrings.PI_SCREEN_SETUP[key]) {
    return self.i18nStrings.PI_SCREEN_SETUP[key];
  }
  if (self.i18nStringsDefaults && self.i18nStringsDefaults.PI_SCREEN_SETUP && self.i18nStringsDefaults.PI_SCREEN_SETUP[key]) {
    return self.i18nStringsDefaults.PI_SCREEN_SETUP[key];
  }
  return key;
};

PiScreenSetup.prototype.loadDisplayPresets = function() {
  var self = this;

  // Use the enhanced cache-aware loading
  self.loadDisplayPresetsWithCache();
};

// ============================================================================
// DATABASE UPDATE SYSTEM
// ============================================================================

/**
 * Initialize presets cache directory and metadata
 */
PiScreenSetup.prototype.initPresetsCache = function() {
  var self = this;
  
  fs.ensureDirSync(self.presetsCacheDir);
  
  // Load or create metadata
  var metadataFile = path.join(self.presetsCacheDir, 'metadata.json');
  if (fs.existsSync(metadataFile)) {
    try {
      self.presetsMetadata = fs.readJsonSync(metadataFile);
    } catch (e) {
      self.logger.warn('pi_screen_setup: Failed to load presets metadata - ' + e);
      self.presetsMetadata = self.createDefaultMetadata();
    }
  } else {
    self.presetsMetadata = self.createDefaultMetadata();
    self.savePresetsMetadata();
  }
  
  // Record bundled version
  var bundledFile = path.join(self.pluginDir, 'display_presets.json');
  if (fs.existsSync(bundledFile)) {
    try {
      var bundled = fs.readJsonSync(bundledFile);
      self.presetsMetadata.bundled_version = bundled.version || 'unknown';
      self.config.set('database.bundled_version', self.presetsMetadata.bundled_version);
    } catch (e) {
      self.logger.warn('pi_screen_setup: Failed to read bundled version - ' + e);
    }
  }
};

/**
 * Create default metadata structure
 */
PiScreenSetup.prototype.createDefaultMetadata = function() {
  var self = this;
  return {
    bundled_version: '',
    cached_version: '',
    cached_date: '',
    draft_version: '',
    draft_dirty: false,
    last_check: '',
    remote_url: self.config.get('database.remote_url') || 
      'https://raw.githubusercontent.com/foonerd/pi_screen_setup/refs/heads/main/display_presets.json'
  };
};

/**
 * Save presets metadata to disk
 */
PiScreenSetup.prototype.savePresetsMetadata = function() {
  var self = this;
  var metadataFile = path.join(self.presetsCacheDir, 'metadata.json');
  try {
    fs.writeJsonSync(metadataFile, self.presetsMetadata, { spaces: 2 });
  } catch (e) {
    self.logger.error('pi_screen_setup: Failed to save presets metadata - ' + e);
  }
};

/**
 * Load display presets with priority: cached > bundled
 */
PiScreenSetup.prototype.loadDisplayPresetsWithCache = function() {
  var self = this;
  
  self.initPresetsCache();
  
  var cachedFile = path.join(self.presetsCacheDir, 'remote.json');
  var bundledFile = path.join(self.pluginDir, 'display_presets.json');
  var activeSource = 'bundled';
  var presetsData = null;
  
  // Try cached first
  if (fs.existsSync(cachedFile)) {
    try {
      presetsData = fs.readJsonSync(cachedFile);
      activeSource = 'cached';
      self.logger.info('pi_screen_setup: Loaded cached presets v' + (presetsData.version || 'unknown'));
    } catch (e) {
      self.logger.warn('pi_screen_setup: Failed to load cached presets - ' + e);
      presetsData = null;
    }
  }
  
  // Fall back to bundled
  if (!presetsData && fs.existsSync(bundledFile)) {
    try {
      presetsData = fs.readJsonSync(bundledFile);
      activeSource = 'bundled';
      self.logger.info('pi_screen_setup: Loaded bundled presets v' + (presetsData.version || 'unknown'));
    } catch (e) {
      self.logger.error('pi_screen_setup: Failed to load bundled presets - ' + e);
      presetsData = { presets: {} };
    }
  }
  
  self.displayPresets = presetsData.presets || {};
  self.displayPresetsVersion = presetsData.version || 'unknown';
  self.displayPresetsDate = presetsData.last_updated || '';
  self.config.set('database.active_source', activeSource);
  
  self.logger.info('pi_screen_setup: Active presets source: ' + activeSource + 
    ', ' + Object.keys(self.displayPresets).length + ' presets loaded');
};

/**
 * Check remote for database updates
 * Returns promise with { available: bool, remote_version: string, current_version: string }
 */
PiScreenSetup.prototype.checkDatabaseUpdate = function() {
  var self = this;
  var defer = libQ.defer();
  
  var DEFAULT_REMOTE_URL = 'https://raw.githubusercontent.com/foonerd/pi_screen_setup/refs/heads/main/display_presets.json';
  
  var remoteUrl = self.config.get('database.remote_url');
  if (!remoteUrl || remoteUrl === '' || remoteUrl === 'undefined') {
    remoteUrl = DEFAULT_REMOTE_URL;
  }
  
  self.logger.info('pi_screen_setup: Checking for database update from ' + remoteUrl);
  
  // Use https or http module based on URL
  var httpModule = remoteUrl.startsWith('https') ? require('https') : require('http');
  
  var request = httpModule.get(remoteUrl, function(response) {
    if (response.statusCode !== 200) {
      defer.reject(new Error('HTTP ' + response.statusCode));
      return;
    }
    
    var data = '';
    response.on('data', function(chunk) {
      data += chunk;
    });
    
    response.on('end', function() {
      try {
        var remoteData = JSON.parse(data);
        var remoteVersion = remoteData.version || 'unknown';
        var currentVersion = self.displayPresetsVersion || 'unknown';
        
        // Update last check time
        var now = new Date().toISOString();
        self.config.set('database.last_check', now);
        self.presetsMetadata.last_check = now;
        self.savePresetsMetadata();
        
        // Compare versions (simple string compare - assumes semver-like format)
        var updateAvailable = self.compareVersions(remoteVersion, currentVersion) > 0;
        
        defer.resolve({
          available: updateAvailable,
          remote_version: remoteVersion,
          remote_date: remoteData.last_updated || '',
          remote_preset_count: Object.keys(remoteData.presets || {}).length,
          current_version: currentVersion,
          current_source: self.config.get('database.active_source', 'bundled')
        });
      } catch (e) {
        defer.reject(new Error('Invalid JSON: ' + e.message));
      }
    });
  });
  
  request.on('error', function(e) {
    defer.reject(new Error('Network error: ' + e.message));
  });
  
  request.setTimeout(10000, function() {
    request.destroy();
    defer.reject(new Error('Request timeout'));
  });
  
  return defer.promise;
};

/**
 * Download and cache remote database
 * Returns promise with { success: bool, version: string, preset_count: number }
 */
PiScreenSetup.prototype.downloadDatabaseUpdate = function() {
  var self = this;
  var defer = libQ.defer();
  
  var DEFAULT_REMOTE_URL = 'https://raw.githubusercontent.com/foonerd/pi_screen_setup/refs/heads/main/display_presets.json';
  
  var remoteUrl = self.config.get('database.remote_url');
  if (!remoteUrl || remoteUrl === '' || remoteUrl === 'undefined') {
    remoteUrl = DEFAULT_REMOTE_URL;
  }
  
  self.logger.info('pi_screen_setup: Downloading database update from ' + remoteUrl);
  
  var httpModule = remoteUrl.startsWith('https') ? require('https') : require('http');
  
  var request = httpModule.get(remoteUrl, function(response) {
    if (response.statusCode !== 200) {
      defer.reject(new Error('HTTP ' + response.statusCode));
      return;
    }
    
    var data = '';
    response.on('data', function(chunk) {
      data += chunk;
    });
    
    response.on('end', function() {
      try {
        var remoteData = JSON.parse(data);
        
        // Validate structure
        if (!remoteData.presets || typeof remoteData.presets !== 'object') {
          defer.reject(new Error('Invalid database structure: missing presets object'));
          return;
        }
        
        // Save to cache
        var cachedFile = path.join(self.presetsCacheDir, 'remote.json');
        fs.writeJsonSync(cachedFile, remoteData, { spaces: 2 });
        
        // Update metadata
        var now = new Date().toISOString();
        self.presetsMetadata.cached_version = remoteData.version || 'unknown';
        self.presetsMetadata.cached_date = now;
        self.config.set('database.cached_version', remoteData.version || 'unknown');
        self.config.set('database.last_update', now);
        self.savePresetsMetadata();
        
        // Reload active presets
        self.displayPresets = remoteData.presets;
        self.displayPresetsVersion = remoteData.version || 'unknown';
        self.displayPresetsDate = remoteData.last_updated || '';
        self.config.set('database.active_source', 'cached');
        
        var presetCount = Object.keys(remoteData.presets).length;
        self.logger.info('pi_screen_setup: Database updated to v' + remoteData.version + 
          ' with ' + presetCount + ' presets');
        
        defer.resolve({
          success: true,
          version: remoteData.version || 'unknown',
          preset_count: presetCount
        });
      } catch (e) {
        defer.reject(new Error('Failed to process update: ' + e.message));
      }
    });
  });
  
  request.on('error', function(e) {
    defer.reject(new Error('Network error: ' + e.message));
  });
  
  request.setTimeout(30000, function() {
    request.destroy();
    defer.reject(new Error('Download timeout'));
  });
  
  return defer.promise;
};

/**
 * Compare version strings (semver-like)
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
PiScreenSetup.prototype.compareVersions = function(a, b) {
  if (a === b) return 0;
  if (a === 'unknown') return -1;
  if (b === 'unknown') return 1;
  
  var partsA = a.split('.').map(function(x) { return parseInt(x, 10) || 0; });
  var partsB = b.split('.').map(function(x) { return parseInt(x, 10) || 0; });
  
  var maxLen = Math.max(partsA.length, partsB.length);
  for (var i = 0; i < maxLen; i++) {
    var numA = partsA[i] || 0;
    var numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
};

/**
 * Revert to bundled database (delete cache)
 */
PiScreenSetup.prototype.revertToBundledDatabase = function() {
  var self = this;
  var defer = libQ.defer();
  
  try {
    var cachedFile = path.join(self.presetsCacheDir, 'remote.json');
    if (fs.existsSync(cachedFile)) {
      fs.unlinkSync(cachedFile);
    }
    
    // Reload from bundled
    self.loadDisplayPresetsWithCache();
    
    self.presetsMetadata.cached_version = '';
    self.presetsMetadata.cached_date = '';
    self.config.set('database.cached_version', '');
    self.config.set('database.active_source', 'bundled');
    self.savePresetsMetadata();
    
    self.logger.info('pi_screen_setup: Reverted to bundled database');
    defer.resolve({ success: true });
  } catch (e) {
    defer.reject(new Error('Failed to revert: ' + e.message));
  }
  
  return defer.promise;
};

// ============================================================================
// UI ENDPOINTS - DATABASE UPDATE
// ============================================================================

/**
 * UI endpoint: Check for database updates
 */
PiScreenSetup.prototype.checkForDatabaseUpdate = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.checkDatabaseUpdate()
    .then(function(result) {
      if (result.available) {
        // Show update available modal
        var modalData = {
          title: self.getI18n('DB_UPDATE_AVAILABLE') || 'Database Update Available',
          message: (self.getI18n('DB_UPDATE_MESSAGE') || 
            'A newer display presets database is available.\n\nCurrent: v{current}\nAvailable: v{remote}\n\nThe new version contains {count} display presets.')
            .replace('{current}', result.current_version)
            .replace('{remote}', result.remote_version)
            .replace('{count}', result.remote_preset_count),
          size: 'md',
          buttons: [
            {
              name: self.getI18n('DB_UPDATE_NOW') || 'Update Now',
              class: 'btn btn-success',
              emit: 'callMethod',
              payload: {
                endpoint: 'system_hardware/pi_screen_setup',
                method: 'applyDatabaseUpdate'
              }
            },
            {
              name: self.getI18n('DB_UPDATE_LATER') || 'Later',
              class: 'btn btn-default',
              emit: 'closeModals',
              payload: ''
            }
          ]
        };
        self.commandRouter.broadcastMessage('openModal', modalData);
      } else {
        self.commandRouter.pushToastMessage('info', 'Pi Screen Setup',
          (self.getI18n('DB_UP_TO_DATE') || 'Database is up to date (v{version})')
            .replace('{version}', result.current_version));
      }
      defer.resolve({});
    })
    .fail(function(err) {
      self.logger.error('pi_screen_setup: Database check failed - ' + err);
      self.commandRouter.pushToastMessage('warning', 'Pi Screen Setup',
        (self.getI18n('DB_CHECK_FAILED') || 'Could not check for updates: {error}')
          .replace('{error}', err.message || err));
      defer.resolve({});
    });
  
  return defer.promise;
};

/**
 * UI endpoint: Apply database update
 */
PiScreenSetup.prototype.applyDatabaseUpdate = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.commandRouter.pushToastMessage('info', 'Pi Screen Setup',
    self.getI18n('DB_DOWNLOADING') || 'Downloading database update...');
  
  self.downloadDatabaseUpdate()
    .then(function(result) {
      self.commandRouter.pushToastMessage('success', 'Pi Screen Setup',
        (self.getI18n('DB_UPDATE_SUCCESS') || 'Database updated to v{version} ({count} presets)')
          .replace('{version}', result.version)
          .replace('{count}', result.preset_count));
      
      // Refresh UI to show new presets in dropdowns
      self.refreshUIConfig();
      defer.resolve({});
    })
    .fail(function(err) {
      self.logger.error('pi_screen_setup: Database update failed - ' + err);
      self.commandRouter.pushToastMessage('error', 'Pi Screen Setup',
        (self.getI18n('DB_UPDATE_FAILED') || 'Update failed: {error}')
          .replace('{error}', err.message || err));
      defer.resolve({});
    });
  
  return defer.promise;
};

/**
 * UI endpoint: Revert to bundled database
 */
PiScreenSetup.prototype.revertDatabase = function() {
  var self = this;
  var defer = libQ.defer();
  
  self.revertToBundledDatabase()
    .then(function() {
      self.commandRouter.pushToastMessage('success', 'Pi Screen Setup',
        self.getI18n('DB_REVERTED') || 'Reverted to bundled database');
      self.refreshUIConfig();
      defer.resolve({});
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error', 'Pi Screen Setup',
        (self.getI18n('DB_REVERT_FAILED') || 'Revert failed: {error}')
          .replace('{error}', err.message || err));
      defer.resolve({});
    });
  
  return defer.promise;
};

/**
 * UI endpoint: Save database settings
 */
PiScreenSetup.prototype.saveDatabaseSettings = function(data) {
  var self = this;
  
  if (data.db_remote_url !== undefined) {
    self.config.set('database.remote_url', data.db_remote_url);
    self.presetsMetadata.remote_url = data.db_remote_url;
  }
  if (data.db_auto_check !== undefined) {
    self.config.set('database.auto_check', data.db_auto_check);
  }
  
  self.savePresetsMetadata();
  
  self.commandRouter.pushToastMessage('success', 'Pi Screen Setup',
    self.getI18n('SETTINGS_SAVED') || 'Settings saved');
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Save hostname override for Preset Manager URL
 */
PiScreenSetup.prototype.saveHostnameOverride = function(data) {
  var self = this;
  
  if (data.db_hostname_override !== undefined) {
    self.config.set('database.hostname_override', data.db_hostname_override);
  }
  
  self.commandRouter.pushToastMessage('success', 'Pi Screen Setup',
    self.getI18n('DB_HOSTNAME_SAVED') || 'Hostname override saved');
  
  // Refresh UI to update the button URL
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

// ============================================================================
// ADMIN ENTRIES MANAGER
// ============================================================================

/**
 * Initialize draft presets (copy from active)
 */
PiScreenSetup.prototype.initDraftPresets = function() {
  var self = this;
  
  var draftFile = path.join(self.presetsCacheDir, 'draft.json');
  
  if (fs.existsSync(draftFile)) {
    try {
      var draftData = fs.readJsonSync(draftFile);
      self.draftPresets = draftData;
      self.logger.info('pi_screen_setup: Loaded draft presets v' + (draftData.version || 'unknown'));
      return;
    } catch (e) {
      self.logger.warn('pi_screen_setup: Failed to load draft - ' + e);
    }
  }
  
  // Create new draft from active
  self.draftPresets = {
    version: self.displayPresetsVersion || '0.0.0',
    last_updated: new Date().toISOString().split('T')[0],
    presets: JSON.parse(JSON.stringify(self.displayPresets || {}))
  };
  self.saveDraftPresets();
};

/**
 * Save draft presets to disk
 */
PiScreenSetup.prototype.saveDraftPresets = function() {
  var self = this;
  
  var draftFile = path.join(self.presetsCacheDir, 'draft.json');
  try {
    fs.writeJsonSync(draftFile, self.draftPresets, { spaces: 2 });
    self.presetsMetadata.draft_version = self.draftPresets.version;
    self.savePresetsMetadata();
  } catch (e) {
    self.logger.error('pi_screen_setup: Failed to save draft - ' + e);
  }
};

/**
 * Get list of presets for admin table
 */
PiScreenSetup.prototype.getAdminPresetList = function() {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  var list = [];
  for (var presetId in self.draftPresets.presets) {
    if (presetId.startsWith('_comment')) continue;
    var preset = self.draftPresets.presets[presetId];
    list.push({
      id: presetId,
      name: preset.name || presetId,
      type: preset.type || 'unknown',
      description: preset.description || ''
    });
  }
  
  // Sort by type then name (natural sort for numeric values)
  list.sort(function(a, b) {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return naturalSortCompare(a.name, b.name);
  });
  
  return list;
};

/**
 * UI endpoint: Get preset for editing
 */
PiScreenSetup.prototype.adminGetPreset = function(data) {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  var presetId = data.preset_id;
  var preset = self.draftPresets.presets[presetId];
  
  if (!preset) {
    return libQ.resolve({ success: false, error: 'Preset not found' });
  }
  
  return libQ.resolve({
    success: true,
    preset_id: presetId,
    preset: preset
  });
};

/**
 * UI endpoint: Add new preset
 */
PiScreenSetup.prototype.adminAddPreset = function(data) {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  var presetId = data.admin_preset_id;
  
  // Validate ID
  if (!presetId || typeof presetId !== 'string' || presetId.trim() === '') {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      self.getI18n('ADMIN_ERROR_INVALID_ID') || 'Invalid preset ID');
    return libQ.resolve({});
  }
  
  presetId = presetId.trim().toLowerCase().replace(/\s+/g, '-');
  
  // Check for duplicates
  if (self.draftPresets.presets[presetId]) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_ERROR_DUPLICATE') || 'Preset ID already exists: {id}').replace('{id}', presetId));
    return libQ.resolve({});
  }
  
  // Parse config JSON
  var configObj = {};
  try {
    if (data.admin_preset_config && data.admin_preset_config.trim() !== '') {
      configObj = JSON.parse(data.admin_preset_config);
    }
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_ERROR_INVALID_JSON') || 'Invalid JSON in config: {error}').replace('{error}', e.message));
    return libQ.resolve({});
  }
  
  // Build preset object
  var preset = {
    name: data.admin_preset_name || presetId,
    type: data.admin_preset_type || 'hdmi',
    description: data.admin_preset_desc || '',
    config: configObj
  };
  
  // Validate preset data
  var validation = self.validatePresetData(preset);
  if (!validation.valid) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', validation.error);
    return libQ.resolve({});
  }
  
  self.draftPresets.presets[presetId] = preset;
  self.config.set('admin.draft_dirty', true);
  self.saveDraftPresets();
  
  self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
    (self.getI18n('ADMIN_PRESET_ADDED') || 'Added preset: {name}').replace('{name}', preset.name));
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Update existing preset
 */
PiScreenSetup.prototype.adminUpdatePreset = function(data) {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  var presetId = data.admin_preset_id;
  
  if (!presetId || !self.draftPresets.presets[presetId]) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      self.getI18n('ADMIN_ERROR_NOT_FOUND') || 'Preset not found');
    return libQ.resolve({});
  }
  
  // Parse config JSON
  var configObj = {};
  try {
    if (data.admin_preset_config && data.admin_preset_config.trim() !== '') {
      configObj = JSON.parse(data.admin_preset_config);
    }
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_ERROR_INVALID_JSON') || 'Invalid JSON in config: {error}').replace('{error}', e.message));
    return libQ.resolve({});
  }
  
  // Build preset object
  var preset = {
    name: data.admin_preset_name || presetId,
    type: data.admin_preset_type || 'hdmi',
    description: data.admin_preset_desc || '',
    config: configObj
  };
  
  // Validate preset data
  var validation = self.validatePresetData(preset);
  if (!validation.valid) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', validation.error);
    return libQ.resolve({});
  }
  
  self.draftPresets.presets[presetId] = preset;
  self.config.set('admin.draft_dirty', true);
  self.saveDraftPresets();
  
  self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
    (self.getI18n('ADMIN_PRESET_UPDATED') || 'Updated preset: {name}').replace('{name}', preset.name));
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Delete preset
 */
PiScreenSetup.prototype.adminDeletePreset = function(data) {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  var presetId = data.admin_preset_id;
  
  if (!presetId || !self.draftPresets.presets[presetId]) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      self.getI18n('ADMIN_ERROR_NOT_FOUND') || 'Preset not found');
    return libQ.resolve({});
  }
  
  var presetName = self.draftPresets.presets[presetId].name || presetId;
  delete self.draftPresets.presets[presetId];
  self.config.set('admin.draft_dirty', true);
  self.saveDraftPresets();
  
  self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
    (self.getI18n('ADMIN_PRESET_DELETED') || 'Deleted preset: {name}').replace('{name}', presetName));
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * Validate preset data structure
 */
PiScreenSetup.prototype.validatePresetData = function(preset) {
  var self = this;
  
  if (!preset || typeof preset !== 'object') {
    return { valid: false, error: self.getI18n('ADMIN_ERROR_INVALID_DATA') || 'Invalid preset data' };
  }
  
  if (!preset.name || typeof preset.name !== 'string' || preset.name.trim() === '') {
    return { valid: false, error: self.getI18n('ADMIN_ERROR_NO_NAME') || 'Preset must have a name' };
  }
  
  var validTypes = ['hdmi', 'dsi', 'dpi', 'composite'];
  if (!preset.type || validTypes.indexOf(preset.type) === -1) {
    return { valid: false, error: self.getI18n('ADMIN_ERROR_INVALID_TYPE') || 'Invalid type. Must be: hdmi, dsi, dpi, or composite' };
  }
  
  if (!preset.config || typeof preset.config !== 'object') {
    return { valid: false, error: self.getI18n('ADMIN_ERROR_NO_CONFIG') || 'Preset must have a config object' };
  }
  
  return { valid: true };
};

/**
 * UI endpoint: Publish draft to active
 */
PiScreenSetup.prototype.adminPublishDraft = function() {
  var self = this;
  
  if (!self.draftPresets) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      self.getI18n('ADMIN_ERROR_NO_DRAFT') || 'No draft to publish');
    return libQ.resolve({});
  }
  
  // Save draft as cached/active
  var cachedFile = path.join(self.presetsCacheDir, 'remote.json');
  try {
    fs.writeJsonSync(cachedFile, self.draftPresets, { spaces: 2 });
    
    // Reload active presets
    self.displayPresets = self.draftPresets.presets;
    self.displayPresetsVersion = self.draftPresets.version;
    self.displayPresetsDate = self.draftPresets.last_updated;
    self.config.set('database.active_source', 'cached');
    self.config.set('database.cached_version', self.draftPresets.version);
    self.config.set('admin.draft_dirty', false);
    
    self.presetsMetadata.cached_version = self.draftPresets.version;
    self.presetsMetadata.cached_date = new Date().toISOString();
    self.presetsMetadata.draft_dirty = false;
    self.savePresetsMetadata();
    
    self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
      self.getI18n('ADMIN_DRAFT_PUBLISHED') || 'Draft published as active database');
    self.refreshUIConfig();
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_PUBLISH_FAILED') || 'Publish failed: {error}').replace('{error}', e.message));
  }
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Discard draft changes
 */
PiScreenSetup.prototype.adminDiscardDraft = function() {
  var self = this;
  
  var draftFile = path.join(self.presetsCacheDir, 'draft.json');
  if (fs.existsSync(draftFile)) {
    fs.unlinkSync(draftFile);
  }
  
  self.draftPresets = null;
  self.config.set('admin.draft_dirty', false);
  self.presetsMetadata.draft_dirty = false;
  self.savePresetsMetadata();
  
  self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', 
    self.getI18n('ADMIN_DRAFT_DISCARDED') || 'Draft discarded');
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Import from URL into draft
 */
PiScreenSetup.prototype.adminImportFromUrl = function(data) {
  var self = this;
  var defer = libQ.defer();
  
  var importUrl = data.admin_import_url;
  if (!importUrl || importUrl.trim() === '') {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      self.getI18n('ADMIN_ERROR_NO_URL') || 'No URL provided');
    return libQ.resolve({});
  }
  
  importUrl = importUrl.trim();
  self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', 
    self.getI18n('ADMIN_IMPORTING') || 'Importing from URL...');
  
  var httpModule = importUrl.startsWith('https') ? require('https') : require('http');
  
  var request = httpModule.get(importUrl, function(response) {
    if (response.statusCode !== 200) {
      self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
        'HTTP error: ' + response.statusCode);
      defer.resolve({});
      return;
    }
    
    var responseData = '';
    response.on('data', function(chunk) {
      responseData += chunk;
    });
    
    response.on('end', function() {
      try {
        var importData = JSON.parse(responseData);
        
        // Validate structure
        if (!importData.presets || typeof importData.presets !== 'object') {
          self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
            self.getI18n('ADMIN_ERROR_INVALID_STRUCTURE') || 'Invalid database structure');
          defer.resolve({});
          return;
        }
        
        // Replace draft
        self.draftPresets = importData;
        self.config.set('admin.draft_dirty', true);
        self.saveDraftPresets();
        
        var presetCount = Object.keys(importData.presets).length;
        self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
          (self.getI18n('ADMIN_IMPORT_SUCCESS') || 'Imported v{version} ({count} presets) into draft')
            .replace('{version}', importData.version || 'unknown')
            .replace('{count}', presetCount));
        self.refreshUIConfig();
        defer.resolve({});
      } catch (e) {
        self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
          (self.getI18n('ADMIN_ERROR_INVALID_JSON') || 'Invalid JSON: {error}').replace('{error}', e.message));
        defer.resolve({});
      }
    });
  });
  
  request.on('error', function(e) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      'Network error: ' + e.message);
    defer.resolve({});
  });
  
  request.setTimeout(30000, function() {
    request.destroy();
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 'Request timeout');
    defer.resolve({});
  });
  
  return defer.promise;
};

/**
 * UI endpoint: Export draft to downloadable file
 */
PiScreenSetup.prototype.adminExportDraft = function() {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  // Update timestamp
  self.draftPresets.last_updated = new Date().toISOString().split('T')[0];
  
  // Write to export location
  var exportFile = path.join(self.presetsCacheDir, 'display_presets_export.json');
  try {
    fs.writeJsonSync(exportFile, self.draftPresets, { spaces: 2 });
    
    self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_EXPORT_SUCCESS') || 'Exported to: {path}').replace('{path}', exportFile));
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_EXPORT_FAILED') || 'Export failed: {error}').replace('{error}', e.message));
  }
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Update draft version
 */
PiScreenSetup.prototype.adminUpdateVersion = function(data) {
  var self = this;
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  var newVersion = data.admin_draft_version;
  if (newVersion && newVersion.trim() !== '') {
    self.draftPresets.version = newVersion.trim();
    self.config.set('admin.draft_dirty', true);
    self.saveDraftPresets();
    
    self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_VERSION_UPDATED') || 'Version updated to: {version}').replace('{version}', newVersion));
    self.refreshUIConfig();
  }
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Toggle admin mode (ephemeral)
 */
PiScreenSetup.prototype.toggleAdminMode = function() {
  var self = this;
  
  self.showAdminUI = !self.showAdminUI;
  
  if (self.showAdminUI) {
    // Enabling admin - initialize draft
    self.initDraftPresets();
  }
  
  self.refreshUIConfig();
  
  self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', 
    (self.getI18n('ADMIN_MODE_TOGGLED') || 'Admin mode {state}')
      .replace('{state}', self.showAdminUI ? 
        (self.getI18n('ENABLED') || 'enabled') : 
        (self.getI18n('DISABLED') || 'disabled')));
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Show database settings section (ephemeral)
 */
PiScreenSetup.prototype.showDatabaseSettings = function() {
  var self = this;
  
  self.showDatabaseSettingsUI = true;
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Hide database settings section (closes everything)
 */
PiScreenSetup.prototype.hideDatabaseSettings = function() {
  var self = this;
  
  // Close all maintenance sections
  self.showDatabaseSettingsUI = false;
  self.showAdvancedSettingsUI = false;
  self.showAdminUI = false;
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Show advanced settings (URL config, admin toggle)
 */
PiScreenSetup.prototype.showAdvancedSettings = function() {
  var self = this;
  
  self.showAdvancedSettingsUI = true;
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Hide advanced settings (and admin)
 */
PiScreenSetup.prototype.hideAdvancedSettings = function() {
  var self = this;
  
  self.showAdvancedSettingsUI = false;
  self.showAdminUI = false;
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Store selected preset ID from dropdown onChange
 * (Keep for potential future use)
 */
PiScreenSetup.prototype.adminStoreSelection = function(data) {
  var self = this;
  
  self.logger.info('pi_screen_setup: adminStoreSelection called with data: ' + JSON.stringify(data));
  
  var presetId = null;
  if (typeof data === 'string') {
    presetId = data;
  } else if (data && data.value) {
    presetId = data.value;
  }
  
  self.adminSelectedPresetId = presetId;
  self.logger.info('pi_screen_setup: adminStoreSelection stored: ' + presetId);
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Load selected preset into form fields
 * Called directly from select onChange - handles various data formats
 */
PiScreenSetup.prototype.adminLoadPreset = function(data) {
  var self = this;
  
  self.logger.info('pi_screen_setup: adminLoadPreset called with data type: ' + typeof data);
  self.logger.info('pi_screen_setup: adminLoadPreset data: ' + JSON.stringify(data));
  
  if (!self.draftPresets) {
    self.initDraftPresets();
  }
  
  // Extract preset ID from various possible formats Volumio might send
  var presetId = null;
  
  if (typeof data === 'string' && data !== '') {
    // Direct string value
    presetId = data;
  } else if (data && typeof data === 'object') {
    // Object format - try various keys
    if (data.value && data.value !== '') {
      presetId = data.value;
    } else if (data.admin_preset_list && data.admin_preset_list !== '') {
      presetId = data.admin_preset_list;
    } else if (data.selected && data.selected !== '') {
      presetId = data.selected;
    } else {
      // Try first non-empty value in the object
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) {
        var val = data[keys[i]];
        if (typeof val === 'string' && val !== '' && val !== keys[i]) {
          presetId = val;
          break;
        }
      }
    }
  }
  
  self.logger.info('pi_screen_setup: adminLoadPreset resolved presetId: ' + presetId);
  
  // Skip if empty or placeholder selection
  if (!presetId || presetId === '' || presetId === '--') {
    self.logger.info('pi_screen_setup: adminLoadPreset - no valid preset selected, skipping');
    return libQ.resolve({});
  }
  
  var preset = self.draftPresets.presets[presetId];
  
  if (!preset) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_ERROR_NOT_FOUND') || 'Preset not found') + ': ' + presetId);
    return libQ.resolve({});
  }
  
  // Store loaded preset data in cache for UI population
  self.adminLoadedPreset = {
    id: presetId,
    name: preset.name || '',
    type: preset.type || 'hdmi',
    description: preset.description || '',
    config: JSON.stringify(preset.config || {}, null, 2)
  };
  
  // Also store as selected for other operations
  self.adminSelectedPresetId = presetId;
  
  self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
    (self.getI18n('ADMIN_PRESET_LOADED') || 'Loaded preset: {name}').replace('{name}', preset.name || presetId));
  
  self.refreshUIConfig();
  
  return libQ.resolve({});
};

/**
 * UI endpoint: Import from local file path
 */
PiScreenSetup.prototype.adminImportFromFile = function(data) {
  var self = this;
  
  var filePath = data.admin_import_file;
  if (!filePath || filePath.trim() === '') {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      self.getI18n('ADMIN_ERROR_NO_PATH') || 'No file path provided');
    return libQ.resolve({});
  }
  
  filePath = filePath.trim();
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_ERROR_FILE_NOT_FOUND') || 'File not found: {path}').replace('{path}', filePath));
    return libQ.resolve({});
  }
  
  try {
    var importData = fs.readJsonSync(filePath);
    
    // Validate structure
    if (!importData.presets || typeof importData.presets !== 'object') {
      self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
        self.getI18n('ADMIN_ERROR_INVALID_STRUCTURE') || 'Invalid database structure');
      return libQ.resolve({});
    }
    
    // Replace draft
    self.draftPresets = importData;
    self.config.set('admin.draft_dirty', true);
    self.saveDraftPresets();
    
    var presetCount = Object.keys(importData.presets).length;
    self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_IMPORT_SUCCESS') || 'Imported v{version} ({count} presets) into draft')
        .replace('{version}', importData.version || 'unknown')
        .replace('{count}', presetCount));
    self.refreshUIConfig();
  } catch (e) {
    self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 
      (self.getI18n('ADMIN_ERROR_INVALID_JSON') || 'Invalid JSON: {error}').replace('{error}', e.message));
  }
  
  return libQ.resolve({});
};

PiScreenSetup.prototype.getDisplayPreset = function(presetId) {
  var self = this;
  
  if (self.displayPresets && self.displayPresets[presetId]) {
    return self.displayPresets[presetId];
  }
  return null;
};

// Lookup preset by dtoverlay name (for migration - finds human-readable name from database)
PiScreenSetup.prototype.getPresetNameByOverlay = function(overlayName) {
  var self = this;
  
  if (!self.displayPresets || !overlayName) {
    return overlayName;
  }
  
  // Search through presets for matching dtoverlay
  for (var presetId in self.displayPresets) {
    if (presetId.startsWith('_comment')) continue;
    var preset = self.displayPresets[presetId];
    if (preset.config && preset.config.dtoverlay === overlayName) {
      return preset.name;
    }
  }
  
  // Not found in database - return overlay name as-is
  return overlayName;
};

// Match HDMI config to a preset from the database (for migration)
// Returns { presetId: string, presetName: string } or null if no match
PiScreenSetup.prototype.matchHdmiConfigToPreset = function(hdmiConfig) {
  var self = this;
  
  if (!self.displayPresets || !hdmiConfig) {
    return null;
  }
  
  // Search through HDMI presets for matching config
  for (var presetId in self.displayPresets) {
    if (presetId.startsWith('_comment')) continue;
    var preset = self.displayPresets[presetId];
    
    // Only check HDMI presets
    if (preset.type !== 'hdmi') continue;
    
    // Skip auto preset
    if (presetId === 'auto') continue;
    
    var config = preset.config;
    if (!config) continue;
    
    // Match by hdmi_timings (most specific)
    if (hdmiConfig.timings && config.hdmi_timings) {
      // Normalize whitespace for comparison
      var parsedTimings = hdmiConfig.timings.replace(/\s+/g, ' ').trim();
      var presetTimings = config.hdmi_timings.replace(/\s+/g, ' ').trim();
      if (parsedTimings === presetTimings) {
        return { presetId: presetId, presetName: preset.name };
      }
    }
    
    // Match by hdmi_cvt (second most specific)
    if (hdmiConfig.cvt && config.hdmi_cvt) {
      var parsedCvt = hdmiConfig.cvt.replace(/\s+/g, ' ').trim();
      var presetCvt = config.hdmi_cvt.replace(/\s+/g, ' ').trim();
      if (parsedCvt === presetCvt) {
        return { presetId: presetId, presetName: preset.name };
      }
    }
    
    // Match by hdmi_group + hdmi_mode (less specific but still valid)
    if (hdmiConfig.group && hdmiConfig.mode && config.hdmi_group && config.hdmi_mode) {
      if (hdmiConfig.group === config.hdmi_group && hdmiConfig.mode === config.hdmi_mode) {
        // Only match if no custom timings involved
        if (!hdmiConfig.timings && !hdmiConfig.cvt && !config.hdmi_timings && !config.hdmi_cvt) {
          return { presetId: presetId, presetName: preset.name };
        }
      }
    }
  }
  
  return null;
};

// Find DSI preset ID by dtoverlay name (for migration)
// Returns preset ID or the overlay name if not found
PiScreenSetup.prototype.findDsiPresetByOverlay = function(overlayName) {
  var self = this;
  
  if (!self.displayPresets || !overlayName) {
    return overlayName;
  }
  
  // Search through DSI presets for matching dtoverlay
  for (var presetId in self.displayPresets) {
    if (presetId.startsWith('_comment')) continue;
    var preset = self.displayPresets[presetId];
    if (preset.type === 'dsi' && preset.config && preset.config.dtoverlay === overlayName) {
      return presetId;
    }
  }
  
  // Not found - return overlay name (will be treated as custom)
  return overlayName;
};


// ============================================================================
// FILE MANAGEMENT - BACKUP
// ============================================================================

PiScreenSetup.prototype.createBackup = function(filePath) {
  var self = this;
  var defer = libQ.defer();

  if (!fs.existsSync(filePath)) {
    defer.resolve(null);
    return defer.promise;
  }

  try {
    var fileName = path.basename(filePath);
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    var backupName = fileName + '.' + timestamp + '.bak';
    var backupPath = path.join(self.backupDir, backupName);

    fs.copySync(filePath, backupPath);
    self.logger.info('pi_screen_setup: Created backup ' + backupPath);

    // Clean old backups (keep last 10 per file type)
    self.cleanOldBackups(fileName);

    defer.resolve(backupPath);
  } catch (err) {
    self.logger.error('pi_screen_setup: Backup failed for ' + filePath + ' - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

PiScreenSetup.prototype.cleanOldBackups = function(filePrefix) {
  var self = this;

  try {
    var files = fs.readdirSync(self.backupDir);
    var matchingFiles = files.filter(function(f) {
      return f.startsWith(filePrefix + '.') && f.endsWith('.bak');
    });

    matchingFiles.sort().reverse();

    // Remove files beyond the 10 most recent
    for (var i = 10; i < matchingFiles.length; i++) {
      var toRemove = path.join(self.backupDir, matchingFiles[i]);
      fs.unlinkSync(toRemove);
      self.logger.info('pi_screen_setup: Removed old backup ' + toRemove);
    }
  } catch (err) {
    self.logger.error('pi_screen_setup: Error cleaning old backups - ' + err);
  }
};

PiScreenSetup.prototype.getLatestBackup = function(filePrefix) {
  var self = this;

  try {
    var files = fs.readdirSync(self.backupDir);
    var matchingFiles = files.filter(function(f) {
      return f.startsWith(filePrefix + '.') && f.endsWith('.bak');
    });

    if (matchingFiles.length === 0) {
      return null;
    }

    matchingFiles.sort().reverse();
    return path.join(self.backupDir, matchingFiles[0]);
  } catch (err) {
    self.logger.error('pi_screen_setup: Error finding backups - ' + err);
    return null;
  }
};

PiScreenSetup.prototype.restoreFromBackup = function(backupPath, targetPath) {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(backupPath)) {
      defer.reject(new Error('Backup file not found'));
      return defer.promise;
    }

    // Use sudo helper for /boot partition
    if (targetPath.startsWith('/boot')) {
      if (self.copyToBootFile(backupPath, targetPath)) {
        self.logger.info('pi_screen_setup: Restored ' + targetPath + ' from ' + backupPath);
        defer.resolve();
      } else {
        defer.reject(new Error('Failed to restore ' + targetPath));
      }
    } else {
      fs.copySync(backupPath, targetPath);
      self.logger.info('pi_screen_setup: Restored ' + targetPath + ' from ' + backupPath);
      defer.resolve();
    }
  } catch (err) {
    self.logger.error('pi_screen_setup: Restore failed - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// Helper to write file to /boot partition (requires sudo)
PiScreenSetup.prototype.writeBootFile = function(filePath, content) {
  var self = this;
  
  try {
    // Write to temp file first
    var tempFile = '/tmp/pi_screen_setup_' + path.basename(filePath);
    fs.writeFileSync(tempFile, content, 'utf8');
    
    // Copy to boot partition with sudo
    execSync('sudo cp "' + tempFile + '" "' + filePath + '"');
    execSync('sudo chmod 644 "' + filePath + '"');
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    self.logger.info('pi_screen_setup: Written ' + filePath);
    return true;
  } catch (err) {
    self.logger.error('pi_screen_setup: Failed to write ' + filePath + ' - ' + err);
    return false;
  }
};

// Helper to copy file to /boot partition (requires sudo)
PiScreenSetup.prototype.copyToBootFile = function(sourcePath, destPath) {
  var self = this;
  
  try {
    execSync('sudo cp "' + sourcePath + '" "' + destPath + '"');
    execSync('sudo chmod 644 "' + destPath + '"');
    self.logger.info('pi_screen_setup: Copied ' + sourcePath + ' to ' + destPath);
    return true;
  } catch (err) {
    self.logger.error('pi_screen_setup: Failed to copy to ' + destPath + ' - ' + err);
    return false;
  }
};

// Helper to remove file from /boot partition (requires sudo)
PiScreenSetup.prototype.removeBootFile = function(filePath) {
  var self = this;
  
  try {
    if (fs.existsSync(filePath)) {
      execSync('sudo rm "' + filePath + '"');
      self.logger.info('pi_screen_setup: Removed ' + filePath);
    }
    return true;
  } catch (err) {
    self.logger.error('pi_screen_setup: Failed to remove ' + filePath + ' - ' + err);
    return false;
  }
};


// ============================================================================
// RESTORE POINT MANAGEMENT
// ============================================================================

// Create a restore point before applying configuration
PiScreenSetup.prototype.createRestorePoint = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    // Create timestamp-based directory
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    var pointDir = path.join(self.restorePointsDir, timestamp);
    
    fs.ensureDirSync(pointDir);
    
    // Copy current boot files to restore point
    var filesCopied = 0;
    
    if (fs.existsSync(VIDEOCONFIG_TXT)) {
      fs.copySync(VIDEOCONFIG_TXT, path.join(pointDir, 'videoconfig.txt'));
      filesCopied++;
    }
    
    if (fs.existsSync(CONFIG_TXT)) {
      fs.copySync(CONFIG_TXT, path.join(pointDir, 'config.txt'));
      filesCopied++;
    }
    
    if (fs.existsSync(CMDLINE_TXT)) {
      fs.copySync(CMDLINE_TXT, path.join(pointDir, 'cmdline.txt'));
      filesCopied++;
    }
    
    // Save metadata
    var metadata = {
      created: new Date().toISOString(),
      files: filesCopied,
      primary_output: self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0'),
      description: self.generateConfigSummary()
    };
    fs.writeJsonSync(path.join(pointDir, 'metadata.json'), metadata);
    
    self.logger.info('pi_screen_setup: Created restore point ' + timestamp + ' with ' + filesCopied + ' files');
    
    // Clean old restore points (keep last 10)
    self.cleanOldRestorePoints();
    
    defer.resolve(timestamp);
  } catch (err) {
    self.logger.error('pi_screen_setup: Failed to create restore point - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// Save current configuration files for OTA comparison
PiScreenSetup.prototype.saveCurrentConfig = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    fs.ensureDirSync(CURRENT_CONFIG_DIR);
    
    // Save copies of all managed boot files
    if (fs.existsSync(VIDEOCONFIG_TXT)) {
      fs.copySync(VIDEOCONFIG_TXT, path.join(CURRENT_CONFIG_DIR, 'videoconfig.txt'));
    }
    
    if (fs.existsSync(CONFIG_TXT)) {
      fs.copySync(CONFIG_TXT, path.join(CURRENT_CONFIG_DIR, 'config.txt'));
    }
    
    if (fs.existsSync(VOLUMIOCONFIG_TXT)) {
      fs.copySync(VOLUMIOCONFIG_TXT, path.join(CURRENT_CONFIG_DIR, 'volumioconfig.txt'));
    }
    
    if (fs.existsSync(CMDLINE_TXT)) {
      fs.copySync(CMDLINE_TXT, path.join(CURRENT_CONFIG_DIR, 'cmdline.txt'));
    }
    
    // Save metadata
    var metadata = {
      saved: new Date().toISOString(),
      primary_output: self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0'),
      description: self.generateConfigSummary()
    };
    fs.writeJsonSync(path.join(CURRENT_CONFIG_DIR, 'metadata.json'), metadata);
    
    self.logger.info('pi_screen_setup: Saved current config to ' + CURRENT_CONFIG_DIR);
    defer.resolve();
  } catch (err) {
    self.logger.error('pi_screen_setup: Failed to save current config - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// Clean old restore points (keep last 10)
PiScreenSetup.prototype.cleanOldRestorePoints = function() {
  var self = this;

  try {
    if (!fs.existsSync(self.restorePointsDir)) {
      return;
    }
    
    var dirs = fs.readdirSync(self.restorePointsDir).filter(function(f) {
      return fs.statSync(path.join(self.restorePointsDir, f)).isDirectory();
    });
    
    dirs.sort().reverse();
    
    // Remove directories beyond the 10 most recent
    for (var i = 10; i < dirs.length; i++) {
      var toRemove = path.join(self.restorePointsDir, dirs[i]);
      fs.removeSync(toRemove);
      self.logger.info('pi_screen_setup: Removed old restore point ' + dirs[i]);
    }
  } catch (err) {
    self.logger.error('pi_screen_setup: Error cleaning old restore points - ' + err);
  }
};

// List available restore points
PiScreenSetup.prototype.listRestorePoints = function() {
  var self = this;
  var points = [];

  try {
    if (!fs.existsSync(self.restorePointsDir)) {
      return points;
    }
    
    var dirs = fs.readdirSync(self.restorePointsDir).filter(function(f) {
      return fs.statSync(path.join(self.restorePointsDir, f)).isDirectory();
    });
    
    dirs.sort().reverse();
    
    for (var i = 0; i < dirs.length; i++) {
      var pointDir = path.join(self.restorePointsDir, dirs[i]);
      var metadataFile = path.join(pointDir, 'metadata.json');
      
      var point = {
        id: dirs[i],
        created: dirs[i],
        description: ''
      };
      
      if (fs.existsSync(metadataFile)) {
        try {
          var metadata = fs.readJsonSync(metadataFile);
          point.created = metadata.created || dirs[i];
          point.description = metadata.description || '';
        } catch (e) {
          // Ignore metadata errors
        }
      }
      
      points.push(point);
    }
  } catch (err) {
    self.logger.error('pi_screen_setup: Error listing restore points - ' + err);
  }

  return points;
};

// Restore from a specific restore point
PiScreenSetup.prototype.restoreFromPoint = function(pointId) {
  var self = this;
  var defer = libQ.defer();

  try {
    var pointDir = path.join(self.restorePointsDir, pointId);
    
    if (!fs.existsSync(pointDir)) {
      defer.reject(new Error('Restore point not found: ' + pointId));
      return defer.promise;
    }
    
    self.logger.info('pi_screen_setup: Restoring from point ' + pointId);
    
    var restored = 0;
    
    // Restore videoconfig.txt
    var videoConfigBackup = path.join(pointDir, 'videoconfig.txt');
    if (fs.existsSync(videoConfigBackup)) {
      if (self.copyToBootFile(videoConfigBackup, VIDEOCONFIG_TXT)) {
        restored++;
      }
    }
    
    // Restore config.txt
    var configBackup = path.join(pointDir, 'config.txt');
    if (fs.existsSync(configBackup)) {
      if (self.copyToBootFile(configBackup, CONFIG_TXT)) {
        restored++;
      }
    }
    
    // Restore cmdline.txt
    var cmdlineBackup = path.join(pointDir, 'cmdline.txt');
    if (fs.existsSync(cmdlineBackup)) {
      if (self.copyToBootFile(cmdlineBackup, CMDLINE_TXT)) {
        restored++;
      }
    }
    
    self.logger.info('pi_screen_setup: Restored ' + restored + ' files from point ' + pointId);
    
    self.commandRouter.pushToastMessage('success',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('RESTORE_SUCCESS'));
    
    defer.resolve(restored);
  } catch (err) {
    self.logger.error('pi_screen_setup: Restore from point failed - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// Restore factory defaults (from install-time backup)
PiScreenSetup.prototype.restoreFactoryDefaults = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(self.factoryDir)) {
      defer.reject(new Error('Factory backups not found'));
      return defer.promise;
    }
    
    self.logger.info('pi_screen_setup: Restoring factory defaults');
    
    var restored = 0;
    
    // Restore config.txt (this also removes include line)
    var configBackup = path.join(self.factoryDir, 'config.txt');
    if (fs.existsSync(configBackup)) {
      if (self.copyToBootFile(configBackup, CONFIG_TXT)) {
        restored++;
      }
    }
    
    // Restore cmdline.txt
    var cmdlineBackup = path.join(self.factoryDir, 'cmdline.txt');
    if (fs.existsSync(cmdlineBackup)) {
      if (self.copyToBootFile(cmdlineBackup, CMDLINE_TXT)) {
        restored++;
      }
    }
    
    // Remove videoconfig.txt (plugin-created file)
    if (fs.existsSync(VIDEOCONFIG_TXT)) {
      self.removeBootFile(VIDEOCONFIG_TXT);
    }
    
    // Reset wizard state
    self.config.set('wizard_complete', false);
    self.config.set('wizard_step', 0);
    self.config.set('migration_state', 'none');
    self.wizardCompleteCache = false;
    self.wizardStepCache = 0;
    self.wizardDataCache = {};
    
    self.logger.info('pi_screen_setup: Factory defaults restored - ' + restored + ' files');
    
    self.commandRouter.pushToastMessage('success',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('FACTORY_RESTORE_SUCCESS'));
    
    defer.resolve(restored);
  } catch (err) {
    self.logger.error('pi_screen_setup: Factory restore failed - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// Check if factory backups exist
PiScreenSetup.prototype.hasFactoryBackup = function() {
  var self = this;
  return fs.existsSync(path.join(self.factoryDir, 'config.txt'));
};


// ============================================================================
// FILE MANAGEMENT - VIDEOCONFIG.TXT
// ============================================================================

PiScreenSetup.prototype.generateVideoConfig = function() {
  var self = this;
  var lines = [];

  lines.push(VIDEOCONFIG_BANNER);
  lines.push('# Generated: ' + new Date().toISOString());
  
  // Get model from hardwareInfo (instance variable) not config (v-conf has issues)
  var model = self.hardwareInfo ? self.hardwareInfo.model_raw : null;
  if (!model) {
    model = self.getConfigValue('hardware.model', 'Unknown');
  }
  lines.push('# Model: ' + model);
  lines.push('');

  var primaryOutput = self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0');

  // KMS overlay (if supported and not Pi Zero 2 W)
  if (self.hardwareInfo && self.hardwareInfo.kms_supported) {
    var kmsEnabled = self.getConfigValue('kms.enabled', true);
    if (kmsEnabled) {
      var kmsOverlay = self.hardwareInfo.kms_overlay || 'vc4-kms-v3d';
      var cmaOption = self.getConfigValue('kms.cma_option', 'default');
      var cmaValue = CMA_OPTIONS[cmaOption] ? CMA_OPTIONS[cmaOption].value : 64;

      if (cmaOption === 'custom') {
        cmaValue = self.getConfigValue('kms.cma_custom_mb', 256);
      }

      lines.push('# KMS Display Driver');
      lines.push('dtoverlay=' + kmsOverlay + ',cma-' + cmaValue);
      lines.push('');
    }
  }

  // HDMI0 configuration
  if (primaryOutput === 'hdmi0' || self.getConfigValue('hdmi0.enabled', false)) {
    var hdmi0Lines = self.generateHDMIConfig(0);
    if (hdmi0Lines.length > 0) {
      lines.push('# HDMI0 Configuration');
      lines = lines.concat(hdmi0Lines);
      lines.push('');
    }
  }

  // HDMI1 configuration (Pi 4/5 only)
  if (self.hardwareInfo && self.hardwareInfo.hdmi_ports > 1) {
    if (primaryOutput === 'hdmi1' || self.getConfigValue('hdmi1.enabled', false)) {
      var hdmi1Lines = self.generateHDMIConfig(1);
      if (hdmi1Lines.length > 0) {
        lines.push('# HDMI1 Configuration');
        lines = lines.concat(hdmi1Lines);
        lines.push('');
      }
    }
  }

  // DSI configuration
  if (primaryOutput === 'dsi0' || self.getConfigValue('dsi0.enabled', false)) {
    var dsi0PresetId = self.getConfigValue('dsi0.overlay', '');
    if (dsi0PresetId && dsi0PresetId !== 'custom') {
      lines.push('# DSI0 Configuration');
      var dsi0Preset = self.getDisplayPreset(dsi0PresetId);
      var dsi0Overlay = '';
      if (dsi0Preset && dsi0Preset.config && dsi0Preset.config.dtoverlay) {
        dsi0Overlay = dsi0Preset.config.dtoverlay;
      } else {
        // Fallback: assume preset ID is the overlay name (backward compat)
        dsi0Overlay = dsi0PresetId;
      }
      var dsi0Params = self.getConfigValue('dsi0.custom_params', '');
      var dsi0Rotation = self.getConfigValue('dsi0.rotation', 0);
      var dsi0Line = 'dtoverlay=' + dsi0Overlay;
      // Only add rotation to overlay if it supports the rotation parameter
      if (dsi0Rotation !== 0 && dsi0Preset && dsi0Preset.overlay_rotation_param === true) {
        dsi0Line += ',rotation=' + dsi0Rotation;
      }
      if (dsi0Params) {
        dsi0Line += ',' + dsi0Params;
      }
      lines.push(dsi0Line);
      lines.push('');
    } else if (dsi0PresetId === 'custom') {
      // Custom overlay - use custom_params as the full overlay line
      var customLine = self.getConfigValue('dsi0.custom_params', '');
      if (customLine) {
        lines.push('# DSI0 Custom Configuration');
        lines.push('dtoverlay=' + customLine);
        lines.push('');
      }
    }
  }

  if (primaryOutput === 'dsi1' || self.getConfigValue('dsi1.enabled', false)) {
    var dsi1PresetId = self.getConfigValue('dsi1.overlay', '');
    if (dsi1PresetId && dsi1PresetId !== 'custom') {
      lines.push('# DSI1 Configuration');
      var dsi1Preset = self.getDisplayPreset(dsi1PresetId);
      var dsi1Overlay = '';
      if (dsi1Preset && dsi1Preset.config && dsi1Preset.config.dtoverlay) {
        dsi1Overlay = dsi1Preset.config.dtoverlay;
      } else {
        // Fallback: assume preset ID is the overlay name (backward compat)
        dsi1Overlay = dsi1PresetId;
      }
      var dsi1Params = self.getConfigValue('dsi1.custom_params', '');
      var dsi1Rotation = self.getConfigValue('dsi1.rotation', 0);
      var dsi1Line = 'dtoverlay=' + dsi1Overlay;
      // Only add rotation to overlay if it supports the rotation parameter
      if (dsi1Rotation !== 0 && dsi1Preset && dsi1Preset.overlay_rotation_param === true) {
        dsi1Line += ',rotation=' + dsi1Rotation;
      }
      if (dsi1Params) {
        dsi1Line += ',' + dsi1Params;
      }
      lines.push(dsi1Line);
      lines.push('');
    } else if (dsi1PresetId === 'custom') {
      // Custom overlay - use custom_params as the full overlay line
      var customLine1 = self.getConfigValue('dsi1.custom_params', '');
      if (customLine1) {
        lines.push('# DSI1 Custom Configuration');
        lines.push('dtoverlay=' + customLine1);
        lines.push('');
      }
    }
  }

  // DPI configuration
  if (primaryOutput === 'dpi' || self.getConfigValue('dpi.enabled', false)) {
    var dpiPresetId = self.getConfigValue('dpi.overlay', '');
    if (dpiPresetId && dpiPresetId !== 'custom') {
      lines.push('# DPI Configuration');
      var dpiPreset = self.getDisplayPreset(dpiPresetId);
      var dpiRotation = self.getConfigValue('dpi.rotation', 0);
      
      if (dpiPreset && dpiPreset.config) {
        // Write primary dtoverlay
        if (dpiPreset.config.dtoverlay) {
          var dpiLine = 'dtoverlay=' + dpiPreset.config.dtoverlay;
          if (dpiRotation !== 0) {
            dpiLine += ',rotate=' + dpiRotation;
          }
          lines.push(dpiLine);
        }
        
        // Write additional overlays (dtoverlay_2, dtoverlay_3, etc.)
        for (var i = 2; i <= 10; i++) {
          var overlayKey = 'dtoverlay_' + i;
          if (dpiPreset.config[overlayKey]) {
            lines.push('dtoverlay=' + dpiPreset.config[overlayKey]);
          } else {
            break; // Stop at first missing numbered overlay
          }
        }
      } else {
        // Fallback: assume preset ID is the overlay name (backward compat)
        var dpiLine = 'dtoverlay=' + dpiPresetId;
        if (dpiRotation !== 0) {
          dpiLine += ',rotate=' + dpiRotation;
        }
        lines.push(dpiLine);
      }
      
      // Custom timing parameters
      var dpiTiming = self.getConfigValue('dpi.custom_timing', '');
      if (dpiTiming) {
        lines.push(dpiTiming);
      }
      lines.push('');
    } else if (dpiPresetId === 'custom') {
      // Custom overlay - use custom_timing as the full overlay specification
      var customDpiLine = self.getConfigValue('dpi.custom_timing', '');
      if (customDpiLine) {
        lines.push('# DPI Custom Configuration');
        lines.push('dtoverlay=' + customDpiLine);
        lines.push('');
      }
    }
  }

  // Composite configuration
  if (primaryOutput === 'composite' || self.getConfigValue('composite.enabled', false)) {
    lines.push('# Composite Output Configuration');
    lines.push('enable_tvout=1');
    var compMode = self.getConfigValue('composite.mode', 'pal');
    var compAspect = self.getConfigValue('composite.aspect', '4:3');
    if (COMPOSITE_MODES[compMode]) {
      lines.push('sdtv_mode=' + COMPOSITE_MODES[compMode].mode);
    }
    lines.push('sdtv_aspect=' + (compAspect === '16:9' ? '3' : '1'));
    lines.push('');
  }

  // Custom overlay
  if (primaryOutput === 'custom' || self.getConfigValue('custom_overlay.enabled', false)) {
    var customLine = self.getConfigValue('custom_overlay.line', '');
    if (customLine) {
      lines.push('# Custom Overlay');
      lines.push(customLine);
      lines.push('');
    }
  }

  // Headless - no display config needed
  if (primaryOutput === 'headless') {
    lines.push('# Headless Mode - No display output configured');
    lines.push('');
  }

  return lines.join(os.EOL);
};

PiScreenSetup.prototype.generateHDMIConfig = function(port) {
  var self = this;
  var lines = [];
  var prefix = 'hdmi' + port;
  var portSuffix = port > 0 ? ':' + port : '';

  var enabled = self.getConfigValue(prefix + '.enabled', port === 0);
  if (!enabled) {
    return lines;
  }

  var mode = self.getConfigValue(prefix + '.mode', 'screen_audio');
  
  // If mode is 'none', port is disabled - return empty
  if (mode === 'none') {
    return [];
  }

  var displayPreset = self.getConfigValue(prefix + '.display_preset', 'auto');
  var forceHotplug = self.getConfigValue(prefix + '.force_hotplug', false);
  var ignoreEdid = self.getConfigValue(prefix + '.ignore_edid', false);
  var boost = self.getConfigValue(prefix + '.boost', 0);

  // Force hotplug (needed for audio-only mode as well)
  if (forceHotplug || mode === 'audio') {
    lines.push('hdmi_force_hotplug' + portSuffix + '=1');
  }

  // Ignore EDID
  if (ignoreEdid) {
    lines.push('hdmi_ignore_edid' + portSuffix + '=0xa5000080');
  }

  // HDMI boost (only if user explicitly set it AND preset doesn't override)
  var preset = self.getDisplayPreset(displayPreset);
  var presetHasBoost = preset && preset.config && preset.config.config_hdmi_boost !== undefined;
  if (boost > 0 && !presetHasBoost) {
    lines.push('config_hdmi_boost' + portSuffix + '=' + boost);
  }

  // Apply display preset configuration (only for modes with video)
  if (mode !== 'audio' && displayPreset && displayPreset !== 'auto') {
    var preset = self.getDisplayPreset(displayPreset);
    
    if (preset && preset.config) {
      var config = preset.config;
      
      // hdmi_group and hdmi_mode
      if (config.hdmi_group !== undefined) {
        lines.push('hdmi_group' + portSuffix + '=' + config.hdmi_group);
      }
      if (config.hdmi_mode !== undefined) {
        lines.push('hdmi_mode' + portSuffix + '=' + config.hdmi_mode);
      }
      
      // hdmi_timings (raw timing string for displays without EDID)
      if (config.hdmi_timings) {
        lines.push('hdmi_timings' + portSuffix + '=' + config.hdmi_timings);
      }
      
      // hdmi_cvt (calculated timing)
      if (config.hdmi_cvt) {
        lines.push('hdmi_cvt' + portSuffix + '=' + config.hdmi_cvt);
      }
      
      // max_framebuffer_height (needed for tall portrait displays)
      if (config.max_framebuffer_height) {
        lines.push('max_framebuffer_height=' + config.max_framebuffer_height);
      }
      
      // hdmi_enable_4kp60 (for 4K 60Hz support)
      if (config.hdmi_enable_4kp60) {
        lines.push('hdmi_enable_4kp60=1');
      }
      
      // config_hdmi_boost from preset (overrides user setting if present)
      if (config.config_hdmi_boost !== undefined) {
        lines.push('config_hdmi_boost' + portSuffix + '=' + config.config_hdmi_boost);
      }
      
      // gpu_mem (global setting, no port suffix)
      if (config.gpu_mem !== undefined) {
        lines.push('gpu_mem=' + config.gpu_mem);
      }
      
      // hdmi_pixel_freq_limit (global setting for high-res displays)
      if (config.hdmi_pixel_freq_limit !== undefined) {
        lines.push('hdmi_pixel_freq_limit=' + config.hdmi_pixel_freq_limit);
      }
    } else if (displayPreset === 'custom' || displayPreset === 'custom-hdmi') {
      // Custom timings entered by user
      var customTimings = self.getConfigValue(prefix + '.custom_timings', '');
      var customParams = self.getConfigValue(prefix + '.custom_params', '');
      
      if (customTimings) {
        // Detect if user entered hdmi_timings or hdmi_cvt format
        // hdmi_timings has 17 values, hdmi_cvt has 3-7 values
        var values = customTimings.trim().split(/\s+/);
        if (values.length >= 10) {
          // Likely hdmi_timings format
          lines.push('hdmi_group' + portSuffix + '=2');
          lines.push('hdmi_mode' + portSuffix + '=87');
          lines.push('hdmi_timings' + portSuffix + '=' + customTimings);
        } else {
          // Likely hdmi_cvt format
          lines.push('hdmi_group' + portSuffix + '=2');
          lines.push('hdmi_mode' + portSuffix + '=87');
          lines.push('hdmi_cvt' + portSuffix + '=' + customTimings);
        }
      }
      
      // Additional custom parameters (one per line)
      if (customParams) {
        var paramLines = customParams.split('\n');
        for (var i = 0; i < paramLines.length; i++) {
          var line = paramLines[i].trim();
          if (line && !line.startsWith('#')) {
            lines.push(line);
          }
        }
      }
    }
  }

  // Drive mode: 1=DVI (no audio), 2=HDMI (with audio)
  if (mode === 'screen') {
    // Screen only - DVI mode, no audio
    lines.push('hdmi_drive' + portSuffix + '=1');
  } else if (mode === 'screen_audio' || mode === 'audio') {
    // Screen+Audio or Audio only - HDMI mode with audio
    lines.push('hdmi_drive' + portSuffix + '=2');
  }

  return lines;
};

PiScreenSetup.prototype.generateConfigSummary = function() {
  var self = this;
  var parts = [];
  
  var primaryOutput = self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0');
  self.logger.info('pi_screen_setup: generateConfigSummary - primaryOutput=' + primaryOutput + ' (cache=' + self.primaryOutputCache + ')');
  
  // Output type
  if (primaryOutput === 'hdmi0' || primaryOutput === 'hdmi1') {
    var displayPreset = self.getConfigValue(primaryOutput + '.display_preset', 'auto');
    self.logger.info('pi_screen_setup: generateConfigSummary - displayPreset=' + displayPreset);
    var presetLabel = 'Auto Detect';
    var preset = self.getDisplayPreset(displayPreset);
    if (preset && preset.name) {
      presetLabel = preset.name;
    }
    parts.push('HDMI' + (primaryOutput === 'hdmi1' ? '1' : '0') + ': ' + presetLabel);
  } else if (primaryOutput === 'dsi0' || primaryOutput === 'dsi1') {
    var dsiPresetId = self.getConfigValue(primaryOutput + '.overlay', '');
    var dsiPreset = self.getDisplayPreset(dsiPresetId);
    var dsiLabel = dsiPreset && dsiPreset.name ? dsiPreset.name : dsiPresetId;
    parts.push('DSI: ' + dsiLabel);
  } else if (primaryOutput === 'dpi') {
    var dpiPresetId = self.getConfigValue('dpi.overlay', '');
    var dpiPreset = self.getDisplayPreset(dpiPresetId);
    var dpiLabel = dpiPreset && dpiPreset.name ? dpiPreset.name : dpiPresetId;
    parts.push('DPI: ' + dpiLabel);
  } else if (primaryOutput === 'composite') {
    var compMode = self.getConfigValue('composite.mode', 'pal');
    parts.push('Composite: ' + compMode.toUpperCase());
  } else if (primaryOutput === 'custom') {
    parts.push('Custom overlay');
  } else if (primaryOutput === 'headless') {
    parts.push('Headless (no display)');
  }
  
  // Rotation
  var rotation = 0;
  if (primaryOutput.startsWith('hdmi')) {
    rotation = self.getConfigValue(primaryOutput + '.rotation', 0);
  } else if (primaryOutput.startsWith('dsi')) {
    rotation = self.getConfigValue(primaryOutput + '.rotation', 0);
  } else if (primaryOutput === 'dpi') {
    rotation = self.getConfigValue('dpi.rotation', 0);
  }
  self.logger.info('pi_screen_setup: generateConfigSummary - rotation=' + rotation);
  self.logger.info('pi_screen_setup: generateConfigSummary - wizardDataCache=' + JSON.stringify(self.wizardDataCache || {}));
  if (rotation !== 0) {
    parts.push(self.getI18n('ROTATION') + ': ' + rotation + self.getI18n('DEGREES'));
  }
  
  // KMS
  if (self.hardwareInfo && self.hardwareInfo.kms_supported) {
    var cmaOption = self.getConfigValue('kms.cma_option', 'default');
    self.logger.info('pi_screen_setup: generateConfigSummary - cmaOption=' + cmaOption);
    var cmaValue = CMA_OPTIONS[cmaOption] ? CMA_OPTIONS[cmaOption].value : 64;
    if (cmaOption === 'custom') {
      cmaValue = self.getConfigValue('kms.cma_custom_mb', 256);
    }
    parts.push('KMS CMA: ' + cmaValue + 'MB');
  }
  
  return parts.join(', ');
};

PiScreenSetup.prototype.writeVideoConfig = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    var content = self.generateVideoConfig();

    // Create backup of existing file
    self.createBackup(VIDEOCONFIG_TXT)
      .then(function() {
        if (self.writeBootFile(VIDEOCONFIG_TXT, content)) {
          defer.resolve();
        } else {
          defer.reject(new Error('Failed to write videoconfig.txt'));
        }
      })
      .fail(function(err) {
        defer.reject(err);
      });
  } catch (err) {
    self.logger.error('pi_screen_setup: Error writing videoconfig.txt - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};


// Write migrated config directly from raw lines (for migration flow)
PiScreenSetup.prototype.writeMigratedConfig = function(rawLines) {
  var self = this;
  var defer = libQ.defer();

  try {
    // Build content from raw lines
    var lines = [];
    lines.push(VIDEOCONFIG_BANNER);
    lines.push('# Generated: ' + new Date().toISOString());
    lines.push('# Model: ' + (self.hardwareInfo ? self.hardwareInfo.model_raw : 'Unknown'));
    lines.push('# Source: Migrated from existing configuration');
    lines.push('');
    
    // Group lines by source for clarity
    var volumioLines = [];
    var userLines = [];
    
    for (var i = 0; i < rawLines.length; i++) {
      var lineObj = rawLines[i];
      if (lineObj.source === 'volumioconfig.txt') {
        volumioLines.push(lineObj.line);
      } else {
        userLines.push(lineObj.line);
      }
    }
    
    // Write KMS overlays first (from volumioconfig.txt)
    var kmsWritten = false;
    for (var j = 0; j < volumioLines.length; j++) {
      var vLine = volumioLines[j];
      if (vLine.match(/^dtoverlay=vc4-[fk]?kms-v3d/)) {
        if (!kmsWritten) {
          lines.push('# KMS Display Driver');
          lines.push(vLine);
          lines.push('');
          kmsWritten = true;
        }
        // Skip duplicate KMS overlays from different [piX] sections
      } else {
        lines.push(vLine);
      }
    }
    
    // Write user settings
    if (userLines.length > 0) {
      lines.push('# User Display Configuration');
      for (var k = 0; k < userLines.length; k++) {
        lines.push(userLines[k]);
      }
      lines.push('');
    }
    
    var content = lines.join('\n');
    self.logger.info('pi_screen_setup: writeMigratedConfig - content length: ' + content.length);
    self.logger.info('pi_screen_setup: writeMigratedConfig - lines: ' + lines.length);
    
    // Create backup of existing file
    self.createBackup(VIDEOCONFIG_TXT)
      .then(function() {
        if (self.writeBootFile(VIDEOCONFIG_TXT, content)) {
          self.logger.info('pi_screen_setup: Written migrated config to ' + VIDEOCONFIG_TXT);
          defer.resolve();
        } else {
          defer.reject(new Error('Failed to write migrated config'));
        }
      })
      .fail(function(err) {
        // If no existing file to backup, still write
        if (self.writeBootFile(VIDEOCONFIG_TXT, content)) {
          self.logger.info('pi_screen_setup: Written migrated config to ' + VIDEOCONFIG_TXT + ' (no backup needed)');
          defer.resolve();
        } else {
          defer.reject(new Error('Failed to write migrated config'));
        }
      });
  } catch (err) {
    self.logger.error('pi_screen_setup: Error writing migrated config - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};


// ============================================================================
// FILE MANAGEMENT - CONFIG.TXT INCLUDE
// ============================================================================

PiScreenSetup.prototype.ensureConfigInclude = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(CONFIG_TXT)) {
      defer.reject(new Error('config.txt not found'));
      return defer.promise;
    }

    var content = fs.readFileSync(CONFIG_TXT, 'utf8');

    // Check if include already exists
    if (content.indexOf(INCLUDE_LINE) !== -1) {
      self.logger.info('pi_screen_setup: Include line already present in config.txt');
      defer.resolve();
      return defer.promise;
    }

    // Find the right position to insert (after volumioconfig.txt, before userconfig.txt)
    var lines = content.split(/\r?\n/);
    var insertIndex = -1;
    var volumioIncludeIndex = -1;
    var userIncludeIndex = -1;

    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('include volumioconfig.txt') !== -1) {
        volumioIncludeIndex = i;
      }
      if (lines[i].indexOf('include userconfig.txt') !== -1) {
        userIncludeIndex = i;
      }
    }

    if (userIncludeIndex !== -1) {
      insertIndex = userIncludeIndex;
    } else if (volumioIncludeIndex !== -1) {
      insertIndex = volumioIncludeIndex + 1;
    } else {
      insertIndex = lines.length;
    }

    // Backup and insert
    self.createBackup(CONFIG_TXT)
      .then(function() {
        lines.splice(insertIndex, 0, INCLUDE_LINE);
        var newContent = lines.join(os.EOL);
        if (self.writeBootFile(CONFIG_TXT, newContent)) {
          self.logger.info('pi_screen_setup: Added include line to config.txt at position ' + insertIndex);
          defer.resolve();
        } else {
          defer.reject(new Error('Failed to write config.txt'));
        }
      })
      .fail(function(err) {
        defer.reject(err);
      });

  } catch (err) {
    self.logger.error('pi_screen_setup: Error modifying config.txt - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

PiScreenSetup.prototype.removeConfigInclude = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(CONFIG_TXT)) {
      defer.resolve();
      return defer.promise;
    }

    var content = fs.readFileSync(CONFIG_TXT, 'utf8');

    if (content.indexOf(INCLUDE_LINE) === -1) {
      defer.resolve();
      return defer.promise;
    }

    self.createBackup(CONFIG_TXT)
      .then(function() {
        var newContent = content.replace(new RegExp('^' + INCLUDE_LINE + '\\r?\\n?', 'm'), '');
        if (self.writeBootFile(CONFIG_TXT, newContent)) {
          self.logger.info('pi_screen_setup: Removed include line from config.txt');
          defer.resolve();
        } else {
          defer.reject(new Error('Failed to write config.txt'));
        }
      })
      .fail(function(err) {
        defer.reject(err);
      });

  } catch (err) {
    self.logger.error('pi_screen_setup: Error modifying config.txt - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};


// ============================================================================
// FILE MANAGEMENT - CMDLINE.TXT
// ============================================================================

PiScreenSetup.prototype.updateCmdline = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(CMDLINE_TXT)) {
      self.logger.warn('pi_screen_setup: cmdline.txt not found');
      defer.resolve();
      return defer.promise;
    }

    var content = fs.readFileSync(CMDLINE_TXT, 'utf8').trim();
    var originalContent = content;

    // Get primary output from cache first
    var primaryOutput = self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0');
    self.logger.info('pi_screen_setup: updateCmdline - primaryOutput=' + primaryOutput);

    // Determine rotation based on primary output
    var rotation = 0;
    var displayPreset = 'auto';
    if (primaryOutput === 'hdmi0') {
      rotation = self.getConfigValue('hdmi0.rotation', 0);
      displayPreset = self.getConfigValue('hdmi0.display_preset', 'auto');
    } else if (primaryOutput === 'hdmi1') {
      rotation = self.getConfigValue('hdmi1.rotation', 0);
      displayPreset = self.getConfigValue('hdmi1.display_preset', 'auto');
    } else if (primaryOutput === 'dsi0') {
      rotation = self.getConfigValue('dsi0.rotation', 0);
    } else if (primaryOutput === 'dsi1') {
      rotation = self.getConfigValue('dsi1.rotation', 0);
    } else if (primaryOutput === 'dpi') {
      rotation = self.getConfigValue('dpi.rotation', 0);
    }
    self.logger.info('pi_screen_setup: updateCmdline - rotation=' + rotation + ', displayPreset=' + displayPreset);

    // Get cmdline rotation options (default all true)
    var applyCmdlineVideo = self.getConfigValue('cmdline_rotation.video', true);
    var applyCmdlineFbcon = self.getConfigValue('cmdline_rotation.fbcon', true);
    var applyCmdlinePlymouth = self.getConfigValue('cmdline_rotation.plymouth', true);

    // Check if DSI overlay handles rotation internally
    var overlayHandlesRotation = false;
    if (primaryOutput.startsWith('dsi')) {
      var dsiPresetId = self.getConfigValue(primaryOutput + '.overlay', '');
      var dsiPreset = self.getDisplayPreset(dsiPresetId);
      if (dsiPreset && dsiPreset.overlay_rotation_param === true) {
        overlayHandlesRotation = true;
        self.logger.info('pi_screen_setup: DSI overlay handles rotation internally');
      }
    }

    // Get video_mode from display preset if available
    var videoMode = null;
    if (displayPreset && displayPreset !== 'auto') {
      var preset = self.getDisplayPreset(displayPreset);
      if (preset && preset.video_mode) {
        videoMode = preset.video_mode;
      }
    }

    // Remove existing video, plymouth rotation, and fbcon parameters
    // NOTE: Do NOT remove plymouth.ignore-serial-consoles - it's needed for graphical boot splash
    content = content.replace(/\s*video=[^\s]*/g, '');
    content = content.replace(/\s*plymouth=[0-9]+/g, '');
    content = content.replace(/\s*fbcon=rotate:[0-3]/g, '');

    // Ensure plymouth.ignore-serial-consoles is present (needed for boot splash on screen)
    if (content.indexOf('plymouth.ignore-serial-consoles') === -1) {
      content += ' plymouth.ignore-serial-consoles';
    }

    // Map degrees to fbcon/video values: 0=0, 90=1, 180=2, 270=3
    var rotateMap = { 0: 0, 90: 1, 180: 2, 270: 3 };
    var rotateValue = rotateMap[rotation] || 0;

    // Determine DRM connector name based on primary output and Pi model
    // Pi 0-4: DSI1 (standard DISPLAY port) -> DSI-1
    // Pi 5: DSI0 (DISP0/left) -> DSI-1, DSI1 (DISP1/right) -> DSI-2
    var connectorName = 'HDMI-A-1';
    if (primaryOutput === 'hdmi1') {
      connectorName = 'HDMI-A-2';
    } else if (primaryOutput === 'dsi0') {
      connectorName = 'DSI-1';  // DSI0 always maps to DSI-1
    } else if (primaryOutput === 'dsi1') {
      // Check if Pi 5 (has dual DSI exposed)
      var isPi5 = self.hardwareInfo && self.hardwareInfo.soc === 'BCM2712';
      connectorName = isPi5 ? 'DSI-2' : 'DSI-1';
    } else if (primaryOutput === 'dpi') {
      connectorName = 'DPI-1';
    }

    // Only add cmdline rotation params if overlay doesn't handle it
    if (!overlayHandlesRotation) {
      // Build video parameter
      // Format: video=CONNECTOR:WIDTHxHEIGHTM@REFRESH,rotate=DEGREES
      // Or: video=CONNECTOR:rotate=DEGREES (if no video_mode)
      if (applyCmdlineVideo && (videoMode || rotation !== 0)) {
        var videoParam = 'video=' + connectorName + ':';
        if (videoMode) {
          videoParam += videoMode;
          if (rotation !== 0) {
            videoParam += ',rotate=' + rotation;
          }
        } else if (rotation !== 0) {
          videoParam += 'rotate=' + rotation;
        }
        content += ' ' + videoParam;
      }

      // Add plymouth parameter for boot splash rotation (used by volumio-adaptive theme)
      if (applyCmdlinePlymouth && rotation !== 0) {
        content += ' plymouth=' + rotation;
      }

      // Add fbcon rotation
      if (applyCmdlineFbcon) {
        content += ' fbcon=rotate:' + rotateValue;
      }
    } else {
      self.logger.info('pi_screen_setup: Skipping cmdline rotation - overlay handles it');
    }

    // Clean up multiple spaces
    content = content.replace(/\s+/g, ' ').trim();

    self.logger.info('pi_screen_setup: updateCmdline - new cmdline: ' + content.substring(content.length - 100));

    if (content !== originalContent) {
      self.createBackup(CMDLINE_TXT)
        .then(function() {
          if (self.writeBootFile(CMDLINE_TXT, content)) {
            self.logger.info('pi_screen_setup: Updated cmdline.txt');
            defer.resolve();
          } else {
            defer.reject(new Error('Failed to write cmdline.txt'));
          }
        })
        .fail(function(err) {
          defer.reject(err);
        });
    } else {
      defer.resolve();
    }

  } catch (err) {
    self.logger.error('pi_screen_setup: Error updating cmdline.txt - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};


// ============================================================================
// MIGRATION DETECTION AND EXECUTION
// ============================================================================

PiScreenSetup.prototype.detectMigration = function() {
  var self = this;
  var defer = libQ.defer();

  var result = {
    migration_needed: false,
    sources: [],
    lines: []
  };

  try {
    self.logger.info('pi_screen_setup: Starting migration detection...');
    
    // Check volumioconfig.txt
    if (fs.existsSync(VOLUMIOCONFIG_TXT)) {
      var volumioContent = fs.readFileSync(VOLUMIOCONFIG_TXT, 'utf8');
      self.logger.info('pi_screen_setup: volumioconfig.txt content length: ' + volumioContent.length);
      var volumioLines = self.findMigrationLines(volumioContent);
      self.logger.info('pi_screen_setup: Found ' + volumioLines.length + ' lines in volumioconfig.txt');
      if (volumioLines.length > 0) {
        result.migration_needed = true;
        result.sources.push('volumioconfig.txt');
        result.lines = result.lines.concat(volumioLines.map(function(l) {
          return { source: 'volumioconfig.txt', line: l };
        }));
      }
    } else {
      self.logger.info('pi_screen_setup: volumioconfig.txt does not exist');
    }

    // Check userconfig.txt
    if (fs.existsSync(USERCONFIG_TXT)) {
      var userContent = fs.readFileSync(USERCONFIG_TXT, 'utf8');
      self.logger.info('pi_screen_setup: userconfig.txt content length: ' + userContent.length);
      var userLines = self.findMigrationLines(userContent);
      self.logger.info('pi_screen_setup: Found ' + userLines.length + ' lines in userconfig.txt: ' + JSON.stringify(userLines));
      if (userLines.length > 0) {
        result.migration_needed = true;
        result.sources.push('userconfig.txt');
        result.lines = result.lines.concat(userLines.map(function(l) {
          return { source: 'userconfig.txt', line: l };
        }));
      }
    } else {
      self.logger.info('pi_screen_setup: userconfig.txt does not exist');
    }

    self.logger.info('pi_screen_setup: Migration detection complete - needed: ' + result.migration_needed + ', lines: ' + result.lines.length);
    defer.resolve(result);

  } catch (err) {
    self.logger.error('pi_screen_setup: Migration detection error - ' + err);
    defer.resolve(result);
  }

  return defer.promise;
};

PiScreenSetup.prototype.findMigrationLines = function(content) {
  var lines = [];
  var contentLines = content.split(/\r?\n/);

  for (var i = 0; i < contentLines.length; i++) {
    var line = contentLines[i].trim();
    if (line.startsWith('#') || line === '') {
      continue;
    }

    for (var j = 0; j < MIGRATION_PATTERNS.length; j++) {
      if (MIGRATION_PATTERNS[j].test(line)) {
        lines.push(line);
        break;
      }
    }
  }

  return lines;
};

PiScreenSetup.prototype.executeMigration = function() {
  var self = this;
  var defer = libQ.defer();

  self.detectMigration()
    .then(function(migrationInfo) {
      if (!migrationInfo.migration_needed) {
        defer.resolve({ success: true, message: 'No migration needed' });
        return;
      }

      var promises = [];

      // Backup and clean volumioconfig.txt
      if (migrationInfo.sources.indexOf('volumioconfig.txt') !== -1) {
        promises.push(self.removeLinesFromFile(VOLUMIOCONFIG_TXT, MIGRATION_PATTERNS));
      }

      // Backup and clean userconfig.txt
      if (migrationInfo.sources.indexOf('userconfig.txt') !== -1) {
        promises.push(self.removeLinesFromFile(USERCONFIG_TXT, MIGRATION_PATTERNS));
      }

      libQ.all(promises)
        .then(function() {
          self.config.set('migration_pending', false);
          self.config.set('migration_source', '');
          self.logger.info('pi_screen_setup: Migration completed');
          defer.resolve({ success: true, message: 'Migration completed' });
        })
        .fail(function(err) {
          defer.reject(err);
        });
    })
    .fail(function(err) {
      defer.reject(err);
    });

  return defer.promise;
};

PiScreenSetup.prototype.removeLinesFromFile = function(filePath, patterns) {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(filePath)) {
      defer.resolve();
      return defer.promise;
    }

    var content = fs.readFileSync(filePath, 'utf8');
    var lines = content.split(/\r?\n/);
    var newLines = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var shouldRemove = false;

      for (var j = 0; j < patterns.length; j++) {
        if (patterns[j].test(line.trim())) {
          shouldRemove = true;
          break;
        }
      }

      if (!shouldRemove) {
        newLines.push(line);
      }
    }

    self.createBackup(filePath)
      .then(function() {
        var newContent = newLines.join(os.EOL);
        // Use sudo helper for /boot partition
        if (filePath.startsWith('/boot')) {
          if (self.writeBootFile(filePath, newContent)) {
            self.logger.info('pi_screen_setup: Cleaned migration lines from ' + filePath);
            defer.resolve();
          } else {
            defer.reject(new Error('Failed to write ' + filePath));
          }
        } else {
          fs.writeFileSync(filePath, newContent, 'utf8');
          self.logger.info('pi_screen_setup: Cleaned migration lines from ' + filePath);
          defer.resolve();
        }
      })
      .fail(function(err) {
        defer.reject(err);
      });

  } catch (err) {
    self.logger.error('pi_screen_setup: Error cleaning file - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// ============================================================================
// MIGRATION PARSING AND IMPORT
// ============================================================================

// HDMI mode lookup table (CEA modes - group 1)
var HDMI_MODE_CEA = {
  1: 'VGA (640x480)',
  2: '480p 60Hz',
  3: '480p 60Hz 16:9',
  4: '720p 60Hz',
  5: '1080i 60Hz',
  16: '1080p 60Hz',
  17: '576p 50Hz',
  18: '576p 50Hz 16:9',
  19: '720p 50Hz',
  20: '1080i 50Hz',
  31: '1080p 50Hz',
  32: '1080p 24Hz',
  33: '1080p 25Hz',
  34: '1080p 30Hz',
  95: '2160p 30Hz',
  97: '2160p 60Hz',
  107: '2160p 60Hz (4:2:0)'
};

// HDMI mode lookup table (DMT modes - group 2)
var HDMI_MODE_DMT = {
  4: '640x480 60Hz',
  9: '800x600 60Hz',
  16: '1024x768 60Hz',
  35: '1280x1024 60Hz',
  51: '1600x1200 60Hz',
  58: '1680x1050 60Hz',
  82: '1920x1080 60Hz',
  85: '1280x720 60Hz',
  87: 'Custom (hdmi_cvt)'
};

// Composite mode lookup
var COMPOSITE_MODE_LOOKUP = {
  0: 'NTSC',
  1: 'NTSC-J',
  2: 'PAL',
  3: 'PAL-M',
  64: 'PAL-M',
  66: 'PAL-N'
};

// NOTE: DSI and DPI overlay names are now looked up from display_presets.json
// using self.getPresetNameByOverlay() instead of hardcoded tables

PiScreenSetup.prototype.parseExistingConfig = function(rawLines) {
  var self = this;
  var parsed = {
    primary_output: null,
    kms_overlay: null,
    kms_cma: null,
    hdmi: {
      group: null,
      mode: null,
      force_hotplug: false,
      ignore_edid: false,
      boost: null,
      cvt: null,
      timings: null
    },
    dsi: {
      overlay: null,
      rotation: null,
      params: null
    },
    dpi: {
      overlay: null,
      rotation: null
    },
    composite: {
      mode: null,
      aspect: null
    },
    rotation: null,
    unknown: []
  };
  
  var recognized = [];
  var unknown = [];
  
  for (var i = 0; i < rawLines.length; i++) {
    var lineObj = rawLines[i];
    var line = lineObj.line.trim();
    var isRecognized = false;
    
    // KMS overlay
    var kmsMatch = line.match(/^dtoverlay=(vc4-[fk]?kms-v3d[^,]*)(,cma-(\d+))?/);
    if (kmsMatch) {
      parsed.kms_overlay = kmsMatch[1];
      if (kmsMatch[3]) {
        parsed.kms_cma = parseInt(kmsMatch[3], 10);
      }
      recognized.push({ line: line, meaning: 'KMS Driver: ' + kmsMatch[1] + (kmsMatch[3] ? ' (CMA: ' + kmsMatch[3] + 'MB)' : '') });
      isRecognized = true;
    }
    
    // DSI overlay
    var dsiMatch = line.match(/^dtoverlay=([^,]*dsi[^,]*)(,rotation=(\d+))?(,(.*))?/i);
    if (dsiMatch && !isRecognized) {
      parsed.dsi.overlay = dsiMatch[1];
      parsed.primary_output = 'dsi0';
      if (dsiMatch[3]) {
        parsed.dsi.rotation = parseInt(dsiMatch[3], 10);
        parsed.rotation = parsed.dsi.rotation;
      }
      if (dsiMatch[5]) {
        parsed.dsi.params = dsiMatch[5];
      }
      var dsiName = self.getPresetNameByOverlay(dsiMatch[1]);
      recognized.push({ line: line, meaning: 'DSI Display: ' + dsiName + (dsiMatch[3] ? ', Rotation: ' + dsiMatch[3] + ' degrees' : '') });
      isRecognized = true;
    }
    
    // DPI overlay
    var dpiMatch = line.match(/^dtoverlay=([^,]*dpi[^,]*|[^,]*hyperpixel[^,]*|[^,]*vga666[^,]*)(,rotation=(\d+))?/i);
    if (dpiMatch && !isRecognized) {
      parsed.dpi.overlay = dpiMatch[1];
      parsed.primary_output = 'dpi';
      if (dpiMatch[3]) {
        parsed.dpi.rotation = parseInt(dpiMatch[3], 10);
        parsed.rotation = parsed.dpi.rotation;
      }
      var dpiName = self.getPresetNameByOverlay(dpiMatch[1]);
      recognized.push({ line: line, meaning: 'DPI Display: ' + dpiName });
      isRecognized = true;
    }
    
    // HDMI group
    var groupMatch = line.match(/^hdmi_group(:(\d))?=(\d+)/);
    if (groupMatch && !isRecognized) {
      parsed.hdmi.group = parseInt(groupMatch[3], 10);
      if (!parsed.primary_output) parsed.primary_output = 'hdmi0';
      recognized.push({ line: line, meaning: 'HDMI Group: ' + (groupMatch[3] === '1' ? 'CEA (TV)' : 'DMT (Monitor)') });
      isRecognized = true;
    }
    
    // HDMI mode
    var modeMatch = line.match(/^hdmi_mode(:(\d))?=(\d+)/);
    if (modeMatch && !isRecognized) {
      var modeNum = parseInt(modeMatch[3], 10);
      parsed.hdmi.mode = modeNum;
      if (!parsed.primary_output) parsed.primary_output = 'hdmi0';
      var modeName = 'Mode ' + modeNum;
      if (parsed.hdmi.group === 1 && HDMI_MODE_CEA[modeNum]) {
        modeName = HDMI_MODE_CEA[modeNum];
      } else if (parsed.hdmi.group === 2 && HDMI_MODE_DMT[modeNum]) {
        modeName = HDMI_MODE_DMT[modeNum];
      }
      recognized.push({ line: line, meaning: 'HDMI Resolution: ' + modeName });
      isRecognized = true;
    }
    
    // HDMI force hotplug
    var hotplugMatch = line.match(/^hdmi_force_hotplug(:(\d))?=(\d)/);
    if (hotplugMatch && !isRecognized) {
      parsed.hdmi.force_hotplug = (hotplugMatch[3] === '1');
      recognized.push({ line: line, meaning: 'HDMI Force Hotplug: ' + (hotplugMatch[3] === '1' ? 'Enabled' : 'Disabled') });
      isRecognized = true;
    }
    
    // HDMI ignore EDID
    var edidMatch = line.match(/^hdmi_ignore_edid(:(\d))?=(.+)/);
    if (edidMatch && !isRecognized) {
      parsed.hdmi.ignore_edid = true;
      recognized.push({ line: line, meaning: 'HDMI Ignore EDID: Enabled' });
      isRecognized = true;
    }
    
    // HDMI boost
    var boostMatch = line.match(/^config_hdmi_boost(:(\d))?=(\d+)/);
    if (boostMatch && !isRecognized) {
      parsed.hdmi.boost = parseInt(boostMatch[3], 10);
      recognized.push({ line: line, meaning: 'HDMI Signal Boost: ' + boostMatch[3] });
      isRecognized = true;
    }
    
    // HDMI CVT
    var cvtMatch = line.match(/^hdmi_cvt(:(\d))?=(.+)/);
    if (cvtMatch && !isRecognized) {
      parsed.hdmi.cvt = cvtMatch[3];
      recognized.push({ line: line, meaning: 'HDMI Custom Resolution (CVT): ' + cvtMatch[3] });
      isRecognized = true;
    }
    
    // HDMI Timings
    var timingsMatch = line.match(/^hdmi_timings(:(\d))?=(.+)/);
    if (timingsMatch && !isRecognized) {
      parsed.hdmi.timings = timingsMatch[3];
      recognized.push({ line: line, meaning: 'HDMI Custom Timings: ' + timingsMatch[3] });
      isRecognized = true;
    }
    
    // Composite mode
    var compModeMatch = line.match(/^sdtv_mode=(\d+)/);
    if (compModeMatch && !isRecognized) {
      var compMode = parseInt(compModeMatch[1], 10);
      parsed.composite.mode = compMode;
      parsed.primary_output = 'composite';
      var compName = COMPOSITE_MODE_LOOKUP[compMode] || 'Mode ' + compMode;
      recognized.push({ line: line, meaning: 'Composite Output: ' + compName });
      isRecognized = true;
    }
    
    // Composite aspect
    var compAspectMatch = line.match(/^sdtv_aspect=(\d)/);
    if (compAspectMatch && !isRecognized) {
      var aspects = { 1: '4:3', 2: '14:9', 3: '16:9' };
      parsed.composite.aspect = compAspectMatch[1];
      recognized.push({ line: line, meaning: 'Composite Aspect Ratio: ' + (aspects[compAspectMatch[1]] || compAspectMatch[1]) });
      isRecognized = true;
    }
    
    // NOTE: display_lcd_rotate and display_hdmi_rotate belong to Touch Display plugin
    // We do NOT parse or migrate these settings
    
    // Framebuffer settings
    var fbMatch = line.match(/^framebuffer_(\w+)=(.+)/);
    if (fbMatch && !isRecognized) {
      recognized.push({ line: line, meaning: 'Framebuffer ' + fbMatch[1] + ': ' + fbMatch[2] });
      isRecognized = true;
    }
    
    // display_auto_detect
    var autoMatch = line.match(/^display_auto_detect=(\d)/);
    if (autoMatch && !isRecognized) {
      recognized.push({ line: line, meaning: 'Display Auto-Detect: ' + (autoMatch[1] === '1' ? 'Enabled' : 'Disabled') });
      isRecognized = true;
    }
    
    if (!isRecognized) {
      unknown.push({ line: line, source: lineObj.source });
    }
  }
  
  return {
    parsed: parsed,
    recognized: recognized,
    unknown: unknown
  };
};

PiScreenSetup.prototype.interpretConfigToHuman = function(parseResult) {
  var self = this;
  var lines = [];
  var parsed = parseResult.parsed;
  
  // Primary output
  if (parsed.primary_output) {
    var outputNames = {
      'hdmi0': 'HDMI 0',
      'hdmi1': 'HDMI 1',
      'dsi0': 'DSI (Display Serial Interface)',
      'dpi': 'DPI (GPIO Parallel Display)',
      'composite': 'Composite Video (RCA)'
    };
    lines.push('Primary Output: ' + (outputNames[parsed.primary_output] || parsed.primary_output));
  }
  
  // KMS driver
  if (parsed.kms_overlay) {
    lines.push('KMS Driver: ' + parsed.kms_overlay + (parsed.kms_cma ? ' (CMA: ' + parsed.kms_cma + 'MB)' : ''));
  }
  
  // DSI details
  if (parsed.dsi.overlay) {
    var dsiName = self.getPresetNameByOverlay(parsed.dsi.overlay);
    lines.push('DSI Panel: ' + dsiName);
  }
  
  // DPI details
  if (parsed.dpi.overlay) {
    var dpiName = self.getPresetNameByOverlay(parsed.dpi.overlay);
    lines.push('DPI Panel: ' + dpiName);
  }
  
  // HDMI details - try to match to a known preset first
  if (parsed.hdmi.mode !== null || parsed.hdmi.timings || parsed.hdmi.cvt) {
    var hdmiPresetMatch = self.matchHdmiConfigToPreset(parsed.hdmi);
    if (hdmiPresetMatch) {
      lines.push('HDMI Display: ' + hdmiPresetMatch.presetName);
    } else {
      // No preset match - show raw settings
      var modeName = 'Mode ' + parsed.hdmi.mode;
      if (parsed.hdmi.group === 1 && HDMI_MODE_CEA[parsed.hdmi.mode]) {
        modeName = HDMI_MODE_CEA[parsed.hdmi.mode];
      } else if (parsed.hdmi.group === 2 && HDMI_MODE_DMT[parsed.hdmi.mode]) {
        modeName = HDMI_MODE_DMT[parsed.hdmi.mode];
      }
      lines.push('HDMI Resolution: ' + modeName);
      if (parsed.hdmi.timings) {
        lines.push('HDMI Custom Timings: ' + parsed.hdmi.timings);
      }
      if (parsed.hdmi.cvt) {
        lines.push('HDMI Custom CVT: ' + parsed.hdmi.cvt);
      }
    }
  }
  
  if (parsed.hdmi.force_hotplug) {
    lines.push('HDMI Force Hotplug: Enabled');
  }
  
  if (parsed.hdmi.ignore_edid) {
    lines.push('HDMI Ignore EDID: Enabled');
  }
  
  if (parsed.hdmi.boost) {
    lines.push('HDMI Signal Boost: Level ' + parsed.hdmi.boost);
  }
  
  // Composite details
  if (parsed.composite.mode !== null) {
    var compName = COMPOSITE_MODE_LOOKUP[parsed.composite.mode] || 'Mode ' + parsed.composite.mode;
    lines.push('Composite Standard: ' + compName);
  }
  
  // Rotation
  if (parsed.rotation !== null && parsed.rotation !== 0) {
    lines.push('Rotation: ' + parsed.rotation + ' degrees');
  }
  
  return lines;
};

PiScreenSetup.prototype.applyParsedConfigToSettings = function(parseResult) {
  var self = this;
  var parsed = parseResult.parsed;
  
  // Set primary output
  if (parsed.primary_output) {
    self.config.set('primary_output', parsed.primary_output);
  }
  
  // KMS settings
  if (parsed.kms_overlay) {
    self.config.set('kms.enabled', true);
    if (parsed.kms_cma) {
      // Map CMA value to option
      var cmaMap = { 32: 'low', 64: 'default', 128: 'medium', 256: 'high', 512: 'max' };
      var cmaOption = cmaMap[parsed.kms_cma] || 'custom';
      self.config.set('kms.cma_option', cmaOption);
      if (cmaOption === 'custom') {
        self.config.set('kms.cma_custom_mb', parsed.kms_cma);
      }
    }
  }
  
  // HDMI settings
  if (parsed.primary_output === 'hdmi0' || parsed.primary_output === 'hdmi1') {
    var hdmiPrefix = parsed.primary_output;
    self.config.set(hdmiPrefix + '.enabled', true);
    self.config.set(hdmiPrefix + '.mode', 'screen');
    
    // Try to match HDMI config to a known preset
    var hdmiPresetMatch = self.matchHdmiConfigToPreset(parsed.hdmi);
    if (hdmiPresetMatch) {
      self.config.set(hdmiPrefix + '.display_preset', hdmiPresetMatch.presetId);
      self.logger.info('pi_screen_setup: Migration matched HDMI config to preset: ' + hdmiPresetMatch.presetName);
    } else {
      // No preset match - use custom settings
      if (parsed.hdmi.timings || parsed.hdmi.cvt) {
        self.config.set(hdmiPrefix + '.display_preset', 'custom-hdmi');
        if (parsed.hdmi.timings) {
          self.config.set(hdmiPrefix + '.custom_timings', parsed.hdmi.timings);
        }
        if (parsed.hdmi.cvt) {
          self.config.set(hdmiPrefix + '.custom_timings', parsed.hdmi.cvt);
        }
      } else {
        self.config.set(hdmiPrefix + '.display_preset', 'auto');
      }
    }
    
    self.config.set(hdmiPrefix + '.force_hotplug', parsed.hdmi.force_hotplug);
    self.config.set(hdmiPrefix + '.ignore_edid', parsed.hdmi.ignore_edid);
    
    if (parsed.hdmi.boost !== null) {
      self.config.set(hdmiPrefix + '.boost', parsed.hdmi.boost);
    }
    
    if (parsed.rotation !== null) {
      self.config.set(hdmiPrefix + '.rotation', parsed.rotation);
    }
  }
  
  // DSI settings
  if (parsed.primary_output === 'dsi0') {
    self.config.set('dsi0.enabled', true);
    if (parsed.dsi.overlay) {
      // Find preset ID by overlay name
      var dsiPresetId = self.findDsiPresetByOverlay(parsed.dsi.overlay);
      self.config.set('dsi0.overlay', dsiPresetId);
      self.logger.info('pi_screen_setup: Migration matched DSI overlay ' + parsed.dsi.overlay + ' to preset: ' + dsiPresetId);
    }
    if (parsed.dsi.rotation !== null) {
      self.config.set('dsi0.rotation', parsed.dsi.rotation);
    }
    if (parsed.dsi.params) {
      self.config.set('dsi0.custom_params', parsed.dsi.params);
    }
  }
  
  // DPI settings
  if (parsed.primary_output === 'dpi') {
    self.config.set('dpi.enabled', true);
    if (parsed.dpi.overlay) {
      // Find preset ID by overlay name
      var dpiPresetId = self.findDsiPresetByOverlay(parsed.dpi.overlay);
      self.config.set('dpi.overlay', dpiPresetId);
    }
    if (parsed.dpi.rotation !== null) {
      self.config.set('dpi.rotation', parsed.dpi.rotation);
    }
  }
  
  // Composite settings
  if (parsed.primary_output === 'composite') {
    self.config.set('composite.enabled', true);
    if (parsed.composite.mode !== null) {
      var compModes = { 0: 'ntsc', 2: 'pal', 64: 'pal-m', 66: 'pal-n' };
      self.config.set('composite.mode', compModes[parsed.composite.mode] || 'pal');
    }
    if (parsed.composite.aspect) {
      var aspects = { 1: '4:3', 2: '14:9', 3: '16:9' };
      self.config.set('composite.aspect', aspects[parsed.composite.aspect] || '4:3');
    }
  }
  
  // Global rotation
  if (parsed.rotation !== null) {
    self.config.set('plymouth.rotation', parsed.rotation);
    self.config.set('fbcon.rotation', Math.floor(parsed.rotation / 90));
  }
};

// Migration UI handlers
PiScreenSetup.prototype.migrateValidate = function() {
  var self = this;
  var defer = libQ.defer();
  
  // Set state to 'processing' immediately to prevent race condition
  self.config.set('migration_state', 'processing');
  self.migrationStateCache = 'processing';
  self.logger.info('pi_screen_setup: migrateValidate - set state to processing');
  
  self.detectMigration()
    .then(function(migrationInfo) {
      if (!migrationInfo.migration_needed) {
        self.config.set('migration_state', 'none');
        self.migrationStateCache = 'none';
        self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', self.getI18n('NO_MIGRATION_NEEDED') || 'No settings to migrate');
        defer.resolve();
        return;
      }
      
      // Parse the existing config
      var parseResult = self.parseExistingConfig(migrationInfo.lines);
      self.logger.info('pi_screen_setup: migrateValidate - parsed ' + parseResult.recognized.length + ' recognized, ' + parseResult.unknown.length + ' unknown');
      
      // Store raw lines and parsed results (both config and cache)
      self.config.set('migration_raw_lines', migrationInfo.lines);
      self.config.set('migration_parsed', parseResult);
      self.migrationRawLinesCache = migrationInfo.lines;
      self.migrationParsedCache = parseResult;
      
      // Check for validation issues
      var validation = [];
      if (parseResult.unknown.length > 0) {
        validation.push({
          type: 'warning',
          message: self.getI18n('UNKNOWN_PARAMS') + ': ' + parseResult.unknown.map(function(u) { return u.line; }).join(', ')
        });
      }
      self.config.set('migration_validation', validation);
      
      // Apply parsed values to config
      self.applyParsedConfigToSettings(parseResult);
      
      // Set state to review
      self.config.set('migration_state', 'review');
      self.migrationStateCache = 'review';
      self.logger.info('pi_screen_setup: migrateValidate - set state to review, cache=' + self.migrationStateCache);
      
      self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', self.getI18n('SETTINGS_PARSED') || 'Settings parsed - please review');
      
      // Use setTimeout to ensure state is committed before UI refresh
      setTimeout(function() {
        self.refreshUIConfig();
      }, 100);
      
      defer.resolve();
    })
    .fail(function(err) {
      self.config.set('migration_state', 'detected');
      self.migrationStateCache = 'detected';
      self.logger.error('pi_screen_setup: Migration validation failed - ' + err);
      self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 'Migration failed: ' + err);
      defer.reject(err);
    });
  
  return defer.promise;
};

PiScreenSetup.prototype.migrateAsIs = function() {
  var self = this;
  var defer = libQ.defer();
  
  // Set state to 'processing' immediately to prevent race condition
  self.config.set('migration_state', 'processing');
  self.migrationStateCache = 'processing';
  self.logger.info('pi_screen_setup: migrateAsIs - set state to processing');
  
  self.detectMigration()
    .then(function(migrationInfo) {
      if (!migrationInfo.migration_needed) {
        self.config.set('migration_state', 'none');
        self.migrationStateCache = 'none';
        self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', 'No settings to migrate');
        defer.resolve();
        return;
      }
      
      // Parse the existing config (for display only)
      var parseResult = self.parseExistingConfig(migrationInfo.lines);
      
      // Store raw lines (both config and cache)
      self.config.set('migration_raw_lines', migrationInfo.lines);
      self.config.set('migration_parsed', parseResult);
      self.config.set('migration_validation', [{ type: 'info', message: 'Expert mode - settings will be used as-is' }]);
      self.migrationRawLinesCache = migrationInfo.lines;
      self.migrationParsedCache = parseResult;
      
      // Set state to review
      self.config.set('migration_state', 'review');
      self.migrationStateCache = 'review';
      self.logger.info('pi_screen_setup: migrateAsIs - set state to review, cache=' + self.migrationStateCache);
      
      self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', 'Settings loaded - please review');
      
      // Use setTimeout to ensure state is committed before UI refresh
      setTimeout(function() {
        self.refreshUIConfig();
      }, 100);
      
      defer.resolve();
    })
    .fail(function(err) {
      self.config.set('migration_state', 'detected');
      self.migrationStateCache = 'detected';
      self.logger.error('pi_screen_setup: Migration as-is failed - ' + err);
      defer.reject(err);
    });
  
  return defer.promise;
};

PiScreenSetup.prototype.migrateSkip = function() {
  var self = this;
  
  // Clear migration state (both config and cache)
  self.config.set('migration_state', 'none');
  self.migrationStateCache = 'none';
  self.config.set('migration_raw_lines', []);
  self.config.set('migration_parsed', {});
  self.config.set('migration_validation', []);
  self.migrationRawLinesCache = null;
  self.migrationParsedCache = null;
  
  // Start fresh wizard
  self.config.set('wizard_step', 1);
  self.wizardStepCache = 1;
  self.logger.info('pi_screen_setup: migrateSkip - cleared state, starting wizard');
  
  self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', self.getI18n('STEP1_TITLE') || 'Step 1 of 7');
  
  // Use setTimeout to ensure state is committed before UI refresh
  setTimeout(function() {
    self.refreshUIConfig();
  }, 100);
  
  return libQ.resolve();
};

PiScreenSetup.prototype.migrateAccept = function() {
  var self = this;
  var defer = libQ.defer();
  
  // Set state to processing to prevent race conditions
  self.config.set('migration_state', 'processing');
  self.migrationStateCache = 'processing';
  self.logger.info('pi_screen_setup: migrateAccept - set state to processing');
  
  // Get the raw lines for writing to videoconfig.txt
  var rawLines = self.migrationRawLinesCache || self.config.get('migration_raw_lines') || [];
  self.logger.info('pi_screen_setup: migrateAccept - raw lines count: ' + rawLines.length);
  
  // Write migrated config directly from raw lines (bypass v-conf timing issues)
  self.writeMigratedConfig(rawLines)
    .then(function() {
      return self.ensureConfigInclude();
    })
    .then(function() {
      return self.executeMigration();
    })
    .then(function() {
      // Mark complete
      self.config.set('wizard_complete', true);
      self.wizardCompleteCache = true;
      self.config.set('wizard_step', 7);
      self.wizardStepCache = 7;
      self.config.set('migration_state', 'none');
      self.migrationStateCache = 'none';
      self.config.set('applied_date', new Date().toISOString());
      self.logger.info('pi_screen_setup: migrateAccept - migration complete');
      
      self.commandRouter.pushToastMessage('success', 'Pi Screen Setup', self.getI18n('CONFIG_APPLIED') || 'Configuration applied');
      
      // Show reboot modal
      var modalData = {
        title: self.getI18n('REBOOT_REQUIRED') || 'Reboot Required',
        message: self.getI18n('REBOOT_MESSAGE') || 'Display configuration has been applied. A reboot is required for changes to take effect.',
        size: 'md',
        buttons: [
          {
            name: self.getI18n('REBOOT_NOW') || 'Reboot Now',
            class: 'btn btn-warning',
            emit: 'reboot',
            payload: ''
          },
          {
            name: self.getI18n('REBOOT_LATER') || 'Later',
            class: 'btn btn-info',
            emit: 'closeModals',
            payload: ''
          }
        ]
      };
      
      self.commandRouter.broadcastMessage('openModal', modalData);
      
      // Use setTimeout to ensure state is committed before UI refresh
      setTimeout(function() {
        self.refreshUIConfig();
      }, 100);
      
      defer.resolve();
    })
    .fail(function(err) {
      self.config.set('migration_state', 'review');
      self.migrationStateCache = 'review';
      self.logger.error('pi_screen_setup: Migration accept failed - ' + err);
      self.commandRouter.pushToastMessage('error', 'Pi Screen Setup', 'Failed to apply: ' + err);
      defer.reject(err);
    });
  
  return defer.promise;
};

PiScreenSetup.prototype.migrateReconfigure = function() {
  var self = this;
  
  // Clear migration state (both config and cache)
  self.config.set('migration_state', 'none');
  self.migrationStateCache = 'none';
  self.config.set('migration_raw_lines', []);
  self.config.set('migration_parsed', {});
  self.config.set('migration_validation', []);
  self.migrationRawLinesCache = null;
  self.migrationParsedCache = null;
  
  // Start wizard from step 1
  self.config.set('wizard_step', 1);
  self.wizardStepCache = 1;
  self.logger.info('pi_screen_setup: migrateReconfigure - cleared state, starting wizard');
  
  self.commandRouter.pushToastMessage('info', 'Pi Screen Setup', self.getI18n('STEP1_TITLE') || 'Step 1 of 7');
  
  // Use setTimeout to ensure state is committed before UI refresh
  setTimeout(function() {
    self.refreshUIConfig();
  }, 100);
  
  return libQ.resolve();
};


// ============================================================================
// BOOT VALIDATION
// ============================================================================

PiScreenSetup.prototype.validateBootConfig = function() {
  var self = this;
  var defer = libQ.defer();

  var result = {
    valid: true,
    drift_detected: false,
    missing_videoconfig: false,
    missing_include: false,
    config_mismatch: false,
    volumioconfig_mismatch: false,
    errors: []
  };

  try {
    var wizardComplete = self.config.get('wizard_complete', false);
    
    // Check for evidence of prior configuration even if wizard_complete is false
    // This handles cases where config.json was reset but backups/boot files remain
    if (!wizardComplete) {
      var hasCurrentBackup = fs.existsSync(path.join(CURRENT_CONFIG_DIR, 'metadata.json'));
      var hasVideoconfig = fs.existsSync(VIDEOCONFIG_TXT);
      var hasOurBanner = false;
      
      if (hasVideoconfig) {
        try {
          var vcContent = fs.readFileSync(VIDEOCONFIG_TXT, 'utf8');
          hasOurBanner = vcContent.indexOf(VIDEOCONFIG_BANNER) !== -1;
        } catch (e) {
          // Ignore read errors
        }
      }
      
      if (hasCurrentBackup || hasOurBanner) {
        // Evidence of prior configuration found - restore wizard_complete
        self.logger.info('pi_screen_setup: Detected prior configuration (backup=' + hasCurrentBackup + ', banner=' + hasOurBanner + ') - restoring wizard_complete');
        self.config.set('wizard_complete', true);
        self.wizardCompleteCache = true;
        wizardComplete = true;
        
        // Try to restore applied_date from metadata if available
        if (hasCurrentBackup) {
          try {
            var metadata = fs.readJsonSync(path.join(CURRENT_CONFIG_DIR, 'metadata.json'));
            if (metadata.saved && !self.config.get('applied_date')) {
              self.config.set('applied_date', metadata.saved);
            }
          } catch (e) {
            // Ignore metadata read errors
          }
        }
      }
    }
    
    // If still not configured, nothing to validate
    if (!wizardComplete) {
      result.valid = true;
      defer.resolve(result);
      return defer.promise;
    }

    // Check videoconfig.txt exists
    if (!fs.existsSync(VIDEOCONFIG_TXT)) {
      result.drift_detected = true;
      result.missing_videoconfig = true;
      result.errors.push('ERR_VIDEOCONFIG_MISSING');
    } else {
      // Check if it has our banner
      var content = fs.readFileSync(VIDEOCONFIG_TXT, 'utf8');
      if (content.indexOf(VIDEOCONFIG_BANNER) === -1) {
        result.drift_detected = true;
        result.errors.push('ERR_VIDEOCONFIG_MODIFIED');
      }
    }

    // Check config.txt has include line
    if (fs.existsSync(CONFIG_TXT)) {
      var configContent = fs.readFileSync(CONFIG_TXT, 'utf8');
      if (configContent.indexOf(INCLUDE_LINE) === -1) {
        result.drift_detected = true;
        result.missing_include = true;
        result.errors.push('ERR_INCLUDE_MISSING');
      }
      
      // Compare against saved current config
      var savedConfigPath = path.join(CURRENT_CONFIG_DIR, 'config.txt');
      if (fs.existsSync(savedConfigPath)) {
        var savedConfig = fs.readFileSync(savedConfigPath, 'utf8');
        if (configContent !== savedConfig) {
          result.drift_detected = true;
          result.config_mismatch = true;
          result.errors.push('ERR_CONFIG_MISMATCH');
        }
      }
    }

    // Check volumioconfig.txt against saved version
    if (fs.existsSync(VOLUMIOCONFIG_TXT)) {
      var savedVolumioPath = path.join(CURRENT_CONFIG_DIR, 'volumioconfig.txt');
      if (fs.existsSync(savedVolumioPath)) {
        var volumioContent = fs.readFileSync(VOLUMIOCONFIG_TXT, 'utf8');
        var savedVolumio = fs.readFileSync(savedVolumioPath, 'utf8');
        if (volumioContent !== savedVolumio) {
          result.drift_detected = true;
          result.volumioconfig_mismatch = true;
          result.errors.push('ERR_VOLUMIOCONFIG_MISMATCH');
        }
      }
    }

    if (result.errors.length > 0) {
      result.valid = false;
    }
    
    // Store drift state for UI
    self.driftDetected = result.drift_detected;
    self.driftErrors = result.errors;

    self.logger.info('pi_screen_setup: Boot validation - ' + JSON.stringify(result));
    defer.resolve(result);

  } catch (err) {
    self.logger.error('pi_screen_setup: Boot validation error - ' + err);
    result.valid = false;
    result.errors.push(err.message);
    defer.resolve(result);
  }

  return defer.promise;
};

PiScreenSetup.prototype.handleConfigDrift = function(validationResult) {
  var self = this;

  var otaBehavior = self.config.get('ota_behavior', 'notify');

  if (otaBehavior === 'silent') {
    // Silently restore then show reboot modal
    self.restoreConfiguration()
      .then(function() {
        self.showRebootRequiredModal();
      });
  } else if (otaBehavior === 'notify') {
    // Notify and restore
    self.commandRouter.pushToastMessage('warning',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('CONFIG_DRIFT_DETECTED'));
    self.restoreConfiguration()
      .then(function() {
        self.showRebootRequiredModal();
      });
  } else if (otaBehavior === 'ask') {
    // Show modal asking user - reboot handled after user confirms
    var modalData = {
      title: self.getI18n('CONFIG_DRIFT_TITLE'),
      message: self.getI18n('CONFIG_DRIFT_MESSAGE'),
      size: 'lg',
      buttons: [
        {
          name: self.getI18n('RESTORE_AND_REBOOT'),
          class: 'btn btn-warning',
          emit: 'callMethod',
          payload: {
            'endpoint': 'system_hardware/pi_screen_setup',
            'method': 'restoreAndReboot',
            'data': ''
          }
        },
        {
          name: self.getI18n('KEEP_CURRENT'),
          class: 'btn btn-default',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };
    self.commandRouter.broadcastMessage('openModal', modalData);
  }
};

// Helper to show reboot required modal after OTA restore
PiScreenSetup.prototype.showRebootRequiredModal = function() {
  var self = this;
  
  var modalData = {
    title: self.getI18n('REBOOT_REQUIRED'),
    message: self.getI18n('OTA_REBOOT_MESSAGE'),
    size: 'lg',
    buttons: [
      {
        name: self.getI18n('REBOOT_NOW'),
        class: 'btn btn-warning',
        emit: 'reboot',
        payload: ''
      },
      {
        name: self.getI18n('REBOOT_LATER'),
        class: 'btn btn-default',
        emit: 'closeModals',
        payload: ''
      }
    ]
  };
  self.commandRouter.broadcastMessage('openModal', modalData);
};

// Restore and reboot (for 'ask' mode and UI button)
// Restore and show reboot modal (for 'ask' mode and UI button)
PiScreenSetup.prototype.restoreAndReboot = function() {
  var self = this;
  
  self.restoreConfiguration()
    .then(function() {
      // Clear drift state
      self.driftDetected = false;
      self.driftErrors = [];
      
      // Show reboot modal - let user choose when to reboot
      self.showRebootRequiredModal();
      
      // Refresh UI to hide drift section
      self.refreshUIConfig();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('RESTORE_FAILED') + ': ' + err);
    });
};

// Clean KMS overlays from volumioconfig.txt (for OTA restore)
// Clean display-related lines from volumioconfig.txt (for OTA restore)
// Uses same MIGRATION_PATTERNS as import/wizard for consistency
PiScreenSetup.prototype.cleanVolumioConfig = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    if (!fs.existsSync(VOLUMIOCONFIG_TXT)) {
      defer.resolve();
      return defer.promise;
    }

    var content = fs.readFileSync(VOLUMIOCONFIG_TXT, 'utf8');
    var lines = content.split('\n');
    var newLines = [];
    var removed = [];
    var currentSection = '[all]';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // Track section headers
      if (trimmed.match(/^\[pi[0-9]*\]$/) || trimmed.match(/^\[cm[0-9]*\]$/) || trimmed === '[all]') {
        currentSection = trimmed;
        newLines.push(line);
        continue;
      }

      // Check against all migration patterns (same as import/wizard)
      var shouldRemove = false;
      for (var p = 0; p < MIGRATION_PATTERNS.length; p++) {
        if (MIGRATION_PATTERNS[p].test(trimmed)) {
          shouldRemove = true;
          break;
        }
      }
      
      if (shouldRemove) {
        removed.push(currentSection + ': ' + trimmed);
        continue;
      }

      newLines.push(line);
    }

    if (removed.length > 0) {
      // Create backup before modifying
      self.createBackup(VOLUMIOCONFIG_TXT)
        .then(function() {
          var newContent = newLines.join('\n');
          if (self.writeBootFile(VOLUMIOCONFIG_TXT, newContent)) {
            self.logger.info('pi_screen_setup: Cleaned display lines from volumioconfig.txt: ' + removed.join(', '));
            defer.resolve();
          } else {
            defer.reject(new Error('Failed to write volumioconfig.txt'));
          }
        })
        .fail(function(err) {
          defer.reject(err);
        });
    } else {
      self.logger.info('pi_screen_setup: No display lines to clean from volumioconfig.txt');
      defer.resolve();
    }

  } catch (err) {
    self.logger.error('pi_screen_setup: Error cleaning volumioconfig.txt - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

// Restore boot files from current/ backup (for OTA restore)
PiScreenSetup.prototype.restoreFromCurrentBackup = function() {
  var self = this;
  var defer = libQ.defer();

  try {
    var restored = [];
    
    // Copy videoconfig.txt from backup
    var savedVideoconfig = path.join(CURRENT_CONFIG_DIR, 'videoconfig.txt');
    if (fs.existsSync(savedVideoconfig)) {
      var content = fs.readFileSync(savedVideoconfig, 'utf8');
      if (self.writeBootFile(VIDEOCONFIG_TXT, content)) {
        restored.push('videoconfig.txt');
      } else {
        defer.reject(new Error('Failed to restore videoconfig.txt'));
        return defer.promise;
      }
    } else {
      defer.reject(new Error('No videoconfig.txt backup found'));
      return defer.promise;
    }
    
    // Copy cmdline.txt from backup
    var savedCmdline = path.join(CURRENT_CONFIG_DIR, 'cmdline.txt');
    if (fs.existsSync(savedCmdline)) {
      var cmdlineContent = fs.readFileSync(savedCmdline, 'utf8');
      if (self.writeBootFile(CMDLINE_TXT, cmdlineContent)) {
        restored.push('cmdline.txt');
      } else {
        self.logger.warn('pi_screen_setup: Failed to restore cmdline.txt');
      }
    }
    
    self.logger.info('pi_screen_setup: Restored from backup: ' + restored.join(', '));
    defer.resolve(restored);
    
  } catch (err) {
    self.logger.error('pi_screen_setup: Error restoring from backup - ' + err);
    defer.reject(err);
  }

  return defer.promise;
};

PiScreenSetup.prototype.restoreConfiguration = function() {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('pi_screen_setup: Restoring configuration from backup');

  // Copy files from current/ backup (not regenerate)
  self.restoreFromCurrentBackup()
    .then(function() {
      return self.ensureConfigInclude();
    })
    .then(function() {
      return self.cleanVolumioConfig();
    })
    .then(function() {
      // Save cleaned state for future OTA comparison
      return self.saveCurrentConfig();
    })
    .then(function() {
      self.commandRouter.pushToastMessage('success',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('CONFIG_RESTORED'));
      defer.resolve();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('RESTORE_FAILED') + ': ' + err);
      defer.reject(err);
    });

  return defer.promise;
};


// ============================================================================
// UI CONFIGURATION
// ============================================================================

PiScreenSetup.prototype.getUIConfig = function() {
  var self = this;
  var defer = libQ.defer();
  var langCode = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    path.join(self.pluginDir, 'i18n', 'strings_' + langCode + '.json'),
    path.join(self.pluginDir, 'i18n', 'strings_en.json'),
    path.join(self.pluginDir, 'UIConfig.json')
  )
  .then(function(uiconf) {
    // Use cache first for immediate state, fall back to config
    var wizardStep = self.wizardStepCache;
    if (wizardStep === null || wizardStep === undefined) {
      wizardStep = self.config.get('wizard_step');
    }
    
    var wizardComplete = self.wizardCompleteCache;
    if (wizardComplete === null || wizardComplete === undefined) {
      wizardComplete = self.config.get('wizard_complete');
    }
    
    var migrationState = self.migrationStateCache;
    if (migrationState === null || migrationState === undefined) {
      migrationState = self.config.get('migration_state');
    }
    
    // Handle undefined/missing values with explicit defaults
    if (wizardStep === undefined || wizardStep === null) {
      wizardStep = 0;
      self.config.set('wizard_step', 0);
      self.wizardStepCache = 0;
    } else {
      // Ensure wizardStep is a number (v-conf may return string)
      wizardStep = parseInt(wizardStep, 10) || 0;
    }
    if (wizardComplete === undefined || wizardComplete === null) {
      wizardComplete = false;
      self.config.set('wizard_complete', false);
      self.wizardCompleteCache = false;
    }
    if (migrationState === undefined || migrationState === null || migrationState === '') {
      migrationState = 'none';
      self.config.set('migration_state', 'none');
      self.migrationStateCache = 'none';
    }

    self.logger.info('pi_screen_setup: getUIConfig - wizardStep=' + wizardStep + 
      ', wizardComplete=' + wizardComplete + ', migrationState=' + migrationState + 
      ' (cache=' + self.migrationStateCache + ', stepCache=' + self.wizardStepCache + ')');

    // Ensure hardware is detected
    if (!self.hardwareInfo) {
      self.hardwareInfo = {
        model: self.config.get('hardware.model', 'Unknown'),
        soc: self.config.get('hardware.soc', 'unknown'),
        ram_mb: self.config.get('hardware.ram_mb', 0),
        hdmi_ports: 1,
        dsi_ports: [],
        has_composite: true,
        kms_supported: true,
        is_pi: true
      };
    }

    var capabilities = self.getHardwareCapabilities();
    
    // Check for migration if wizard not started and not complete
    var migrationInfo = null;
    var checkMigration = (wizardStep === 0 && !wizardComplete && migrationState === 'none');
    self.logger.info('pi_screen_setup: getUIConfig - checkMigration=' + checkMigration);
    
    // If processing, don't do anything special - just show detected section
    if (migrationState === 'processing') {
      self.logger.info('pi_screen_setup: getUIConfig - in processing state, showing detected section');
      checkMigration = false;
    }

    // ========================================
    // SECTION 0: Hardware Info (always visible)
    // ========================================
    var hwSection = uiconf.sections[0];
    if (hwSection) {
      // Model
      var hwModelItem = self.findContentItem(hwSection, 'hw_model');
      if (hwModelItem) {
        hwModelItem.value = self.hardwareInfo.model_raw || self.hardwareInfo.model || 'Unknown';
      }
      
      // SoC
      var hwSocItem = self.findContentItem(hwSection, 'hw_soc');
      if (hwSocItem) {
        hwSocItem.value = self.hardwareInfo.soc || 'Unknown';
      }
      
      // RAM
      var hwRamItem = self.findContentItem(hwSection, 'hw_ram');
      if (hwRamItem) {
        hwRamItem.value = (self.hardwareInfo.ram_mb || 0) + ' MB';
      }
      
      // Available outputs
      var hwOutputsItem = self.findContentItem(hwSection, 'hw_outputs');
      if (hwOutputsItem) {
        var outputLabels = capabilities.outputs.map(function(o) { return o.label; });
        hwOutputsItem.value = outputLabels.slice(0, -2).join(', '); // Exclude custom and headless
      }
      
      // KMS status
      var hwKmsItem = self.findContentItem(hwSection, 'hw_kms');
      if (hwKmsItem) {
        hwKmsItem.value = capabilities.kms_supported ?
          self.getI18n('KMS_SUPPORTED') + ' (' + self.hardwareInfo.kms_overlay + ')' : 
          self.getI18n('KMS_NOT_SUPPORTED');
      }
      
      // Warnings (only show if there are warnings)
      var hwWarningsItem = self.findContentItem(hwSection, 'hw_warnings');
      if (hwWarningsItem) {
        if (capabilities.warnings.length > 0) {
          hwWarningsItem.value = capabilities.warnings.join('; ');
          hwWarningsItem.hidden = false;
        } else {
          hwWarningsItem.hidden = true;
        }
      }
    }

    // ========================================
    // DATABASE STATUS SECTION (populate early - before any early returns)
    // Only show on Step 0 (initial) or when wizard is complete
    // Hide during active wizard configuration (steps 1+)
    // ========================================
    var showDatabaseSections = (wizardStep === 0) || wizardComplete;
    
    var dbSection = self.findSection(uiconf, 'section_database');
    if (dbSection) {
      dbSection.hidden = !showDatabaseSections;
      
      if (showDatabaseSections) {
        // Populate values
        self.setUIValue(dbSection, 'db_active_version', self.displayPresetsVersion || 'unknown');
        self.setUIValue(dbSection, 'db_preset_count', Object.keys(self.displayPresets || {}).length.toString());
        
        // Control Revert button visibility - only show when NOT using bundled
        var activeSource = self.config.get('database.active_source', 'bundled');
        var revertBtn = self.findContentItem(dbSection, 'db_revert_btn');
        if (revertBtn) {
          revertBtn.hidden = (activeSource === 'bundled');
        }
      }
    }
    
    // ========================================
    // PRESET MANAGER SECTION
    // ========================================
    var pmSection = self.findSection(uiconf, 'section_preset_manager');
    if (pmSection) {
      pmSection.hidden = !showDatabaseSections;
      
      if (showDatabaseSections) {
        // Set the URL for the Open Preset Manager button
        var openManagerBtn = self.findContentItem(pmSection, 'db_open_manager_btn');
        if (openManagerBtn && openManagerBtn.onClick) {
          openManagerBtn.onClick.url = self.getManagementUrl();
        }
        
        // Populate hostname override field
        self.setUIValue(pmSection, 'db_hostname_override', self.config.get('database.hostname_override', ''));
      }
    }

    // ========================================
    // SECTION 1: OTA Drift Warning
    // ========================================
    var driftSection = uiconf.sections[1];
    if (driftSection) {
      // Show only when drift is detected and wizard is complete
      var showDrift = self.driftDetected && wizardComplete;
      driftSection.hidden = !showDrift;
      self.logger.info('pi_screen_setup: OTA drift section hidden=' + driftSection.hidden + ' (driftDetected=' + self.driftDetected + ', wizardComplete=' + wizardComplete + ')');
      
      if (showDrift) {
        var driftStatusItem = self.findContentItem(driftSection, 'drift_status');
        if (driftStatusItem) {
          driftStatusItem.value = self.getI18n('DRIFT_STATUS_DETECTED');
        }
        
        var driftErrorsItem = self.findContentItem(driftSection, 'drift_errors');
        if (driftErrorsItem && self.driftErrors) {
          var translatedErrors = self.driftErrors.map(function(code) {
            return self.getI18n(code) || code;
          });
          driftErrorsItem.value = translatedErrors.join(' | ');
        }
      }
    }

    // ========================================
    // SECTION 2: Migration Detected
    // ========================================
    var migrationDetectedSection = uiconf.sections[2];
    if (migrationDetectedSection) {
      migrationDetectedSection.hidden = true; // Default hidden
      self.logger.info('pi_screen_setup: Section 1 - default hidden, checkMigration=' + checkMigration + ', migrationState=' + migrationState);
      
      if (checkMigration) {
        self.logger.info('pi_screen_setup: Checking for migration...');
        // Check for migration synchronously for initial display
        self.detectMigration()
          .then(function(info) {
            self.logger.info('pi_screen_setup: Migration check result - needed=' + info.migration_needed + ', lines=' + info.lines.length);
            migrationInfo = info;
            if (info.migration_needed) {
              self.logger.info('pi_screen_setup: Migration needed - showing migration section');
              migrationDetectedSection.hidden = false;
              self.config.set('migration_state', 'detected');
              self.migrationStateCache = 'detected';
              self.config.set('migration_raw_lines', info.lines);
              
              // Populate raw lines display
              var rawItem = self.findContentItem(migrationDetectedSection, 'migration_raw_display');
              if (rawItem) {
                var linesText = info.lines.map(function(l) {
                  return l.source + ': ' + l.line;
                }).join(' | ');
                rawItem.value = linesText;
                self.logger.info('pi_screen_setup: Migration display text: ' + linesText);
              }
              
              // Hide wizard sections when migration detected
              for (var i = 4; i <= 15; i++) {
                if (uiconf.sections[i]) {
                  uiconf.sections[i].hidden = true;
                }
              }
              
              self.logger.info('pi_screen_setup: Resolving uiconf with migration section visible');
              defer.resolve(uiconf);
            } else {
              self.logger.info('pi_screen_setup: No migration needed - showing wizard step 1');
              // No migration needed, show wizard step 1
              self.config.set('wizard_step', 1);
  self.wizardStepCache = 1;
              self.populateWizardSections(uiconf, 1, false, capabilities);
              defer.resolve(uiconf);
            }
          })
          .fail(function(err) {
            self.logger.error('pi_screen_setup: Migration check failed - ' + err);
            defer.resolve(uiconf);
          });
        return; // Early return - promise resolved in callback
      } else if (migrationState === 'detected' || migrationState === 'processing') {
        self.logger.info('pi_screen_setup: In detected/processing state - showing migration section');
        // Already in detected or processing state
        migrationDetectedSection.hidden = false;
        var rawLines = self.config.get('migration_raw_lines', []);
        var rawItem = self.findContentItem(migrationDetectedSection, 'migration_raw_display');
        if (rawItem && rawLines.length > 0) {
          var linesText = rawLines.map(function(l) {
            return l.source + ': ' + l.line;
          }).join(' | ');
          rawItem.value = linesText;
        }
        
        // Hide wizard sections
        for (var i = 3; i <= 14; i++) {
          if (uiconf.sections[i]) {
            uiconf.sections[i].hidden = true;
          }
        }
        
        defer.resolve(uiconf);
        return; // Early return
      }
    }

    // ========================================
    // SECTION 2: Migration Review
    // ========================================
    var migrationReviewSection = uiconf.sections[3];
    if (migrationReviewSection) {
      migrationReviewSection.hidden = (migrationState !== 'review');
      
      if (migrationState === 'review') {
        self.logger.info('pi_screen_setup: In review state - showing review section');
        
        // IMPORTANT: Hide the detected section (section 1)
        if (migrationDetectedSection) {
          migrationDetectedSection.hidden = true;
        }
        
        var rawLines = self.config.get('migration_raw_lines', []);
        var parseResult = self.config.get('migration_parsed', {});
        var validation = self.config.get('migration_validation', []);
        
        self.logger.info('pi_screen_setup: Review - rawLines count: ' + rawLines.length + ', parseResult keys: ' + Object.keys(parseResult).join(','));
        
        // Raw lines display
        var reviewRawItem = self.findContentItem(migrationReviewSection, 'review_raw_lines');
        if (reviewRawItem && rawLines.length > 0) {
          reviewRawItem.value = rawLines.map(function(l) { return l.line; }).join(' | ');
        }
        
        // Interpreted settings
        var reviewInterpretedItem = self.findContentItem(migrationReviewSection, 'review_interpreted');
        if (reviewInterpretedItem && parseResult.parsed) {
          var humanReadable = self.interpretConfigToHuman(parseResult);
          reviewInterpretedItem.value = humanReadable.join(' | ');
          self.logger.info('pi_screen_setup: Review - interpreted: ' + humanReadable.join(' | '));
        }
        
        // Validation status
        var reviewValidationItem = self.findContentItem(migrationReviewSection, 'review_validation');
        if (reviewValidationItem) {
          if (parseResult.unknown && parseResult.unknown.length > 0) {
            reviewValidationItem.value = self.getI18n('VALIDATION_WARNINGS') + ': ' + 
              parseResult.unknown.map(function(u) { return u.line; }).join(', ');
          } else {
            reviewValidationItem.value = self.getI18n('VALIDATION_OK');
          }
        }
        
        // Hide all wizard sections during review
        for (var i = 4; i <= 15; i++) {
          if (uiconf.sections[i]) {
            uiconf.sections[i].hidden = true;
          }
        }
        
        self.logger.info('pi_screen_setup: Resolving uiconf with review section visible');
        defer.resolve(uiconf);
        return;
      }
    }

    // If not in migration flow, populate wizard sections
    if (migrationState === 'none' || migrationState === undefined) {
      self.populateWizardSections(uiconf, wizardStep, wizardComplete, capabilities);
    }

    defer.resolve(uiconf);
  })
  .fail(function(err) {
    self.logger.error('pi_screen_setup: Failed to load UI config - ' + err);
    defer.reject(new Error());
  });

  return defer.promise;
};

// Helper to populate wizard sections (extracted from getUIConfig)
PiScreenSetup.prototype.populateWizardSections = function(uiconf, wizardStep, wizardComplete, capabilities) {
  var self = this;

    self.logger.info('pi_screen_setup: populateWizardSections - wizardStep=' + wizardStep + ', wizardComplete=' + wizardComplete);

    // Get primary output from cache first, then config, then default
    var primaryOutput = self.primaryOutputCache || self.config.get('primary_output') || 'hdmi0';
    self.logger.info('pi_screen_setup: populateWizardSections - primaryOutput=' + primaryOutput + ' (cache=' + self.primaryOutputCache + ')');

    // ========================================
    // SECTION 4: Step 0 - Detection Choice
    // ========================================
    var step0Section = uiconf.sections[4];
    if (step0Section) {
      // Show only when wizard_step=0 and no migration state
      var migrationState = self.migrationStateCache || self.config.get('migration_state');
      var showStep0 = (wizardStep === 0) && !migrationState;
      step0Section.hidden = wizardComplete || !showStep0;
      self.logger.info('pi_screen_setup: Step 0 section hidden=' + step0Section.hidden + ' (wizardStep=' + wizardStep + ', migrationState=' + migrationState + ')');

      if (showStep0) {
        var detectSelect = self.findContentItem(step0Section, 'detect_mode');
        if (detectSelect) {
          var detectOptions = [
            { value: 'auto', label: self.getI18n('DETECT_AUTO') },
            { value: 'manual', label: self.getI18n('DETECT_MANUAL') }
          ];
          detectSelect.options = detectOptions;
          detectSelect.value = detectOptions[0];
        }
      }
    }

    // ========================================
    // SECTION 5: Step 1 - Output Selection
    // ========================================
    var step1Section = uiconf.sections[5];
    if (step1Section) {
      // Show Step 1 when wizard_step=1
      step1Section.hidden = wizardComplete || wizardStep !== 1;
      self.logger.info('pi_screen_setup: Step 1 section hidden=' + step1Section.hidden + ' (wizardStep=' + wizardStep + ')');

      // Build output options
      var outputSelect = self.findContentItem(step1Section, 'primary_output');
      if (outputSelect) {
        var outputOptions = capabilities.outputs.map(function(o) {
          return { value: o.id, label: o.label };
        });
        outputSelect.options = outputOptions;

        var selectedOption = outputOptions.find(function(o) { return o.value === primaryOutput; });
        outputSelect.value = selectedOption || outputOptions[0];
      }
    }

    // ========================================
    // SECTION 6: Step 2 - HDMI Configuration
    // ========================================
    var step2Section = uiconf.sections[6];
    if (step2Section) {
      // Show only when on step 2 AND output is HDMI
      var showHdmi = (wizardStep === 2) && (primaryOutput === 'hdmi0' || primaryOutput === 'hdmi1');
      step2Section.hidden = wizardComplete || !showHdmi;
      self.logger.info('pi_screen_setup: Step 2 HDMI section hidden=' + step2Section.hidden + ' (showHdmi=' + showHdmi + ', primaryOutput=' + primaryOutput + ')');

      if (showHdmi) {
        var hdmiPrefix = primaryOutput;
        var secondaryHdmi = (primaryOutput === 'hdmi0') ? 'hdmi1' : 'hdmi0';
        var hasDualHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 1;

        // Primary label
        var primaryLabel = self.findContentItem(step2Section, 'hdmi_primary_label');
        if (primaryLabel) {
          primaryLabel.value = (primaryOutput === 'hdmi0') ? self.getI18n('OUTPUT_HDMI0') : self.getI18n('OUTPUT_HDMI1');
        }

        // HDMI mode
        var modeOptions = [
          { value: 'screen_audio', label: self.getI18n('MODE_SCREEN_AUDIO') },
          { value: 'screen', label: self.getI18n('MODE_SCREEN_ONLY') },
          { value: 'audio', label: self.getI18n('MODE_AUDIO_ONLY') },
          { value: 'none', label: self.getI18n('MODE_DISABLED') }
        ];

        var modeSelect = self.findContentItem(step2Section, 'hdmi_mode');
        if (modeSelect) {
          modeSelect.options = modeOptions;
          var currentMode = self.getConfigValue(hdmiPrefix + '.mode', 'screen_audio');
          modeSelect.value = modeOptions.find(function(o) { return o.value === currentMode; }) || modeOptions[0];
        }

        // Display preset selector - filter by type === 'hdmi'
        var presetSelect = self.findContentItem(step2Section, 'hdmi_display_preset');
        if (presetSelect) {
          var presetOptions = [];
          if (self.displayPresets) {
            for (var presetKey in self.displayPresets) {
              var preset = self.displayPresets[presetKey];
              // Skip comment entries and non-HDMI presets
              if (presetKey.startsWith('_comment') || preset.type !== 'hdmi') {
                continue;
              }
              presetOptions.push({ value: presetKey, label: preset.name });
            }
          }
          // Sort using natural sort (handles numeric values properly)
          presetOptions.sort(function(a, b) {
            return naturalSortCompare(a.label, b.label);
          });
          // Add Auto Detect at start and Off at end
          presetOptions.unshift({ value: 'auto', label: 'Auto Detect (EDID)' });
          presetOptions.push({ value: 'off', label: 'Off' });
          
          presetSelect.options = presetOptions;
          var currentPreset = self.getConfigValue(hdmiPrefix + '.display_preset', 'auto');
          presetSelect.value = presetOptions.find(function(o) { return o.value === currentPreset; }) || presetOptions[0];
        }

        // Custom timings (shown only when preset is 'custom')
        var customTimings = self.findContentItem(step2Section, 'hdmi_custom_timings');
        if (customTimings) {
          var currentTimings = self.getConfigValue(hdmiPrefix + '.custom_timings', '');
          customTimings.value = currentTimings;
          var isCustom = self.getConfigValue(hdmiPrefix + '.display_preset', 'auto') === 'custom';
          customTimings.hidden = !isCustom;
        }

        // Custom params (shown only when preset is 'custom')
        var customParams = self.findContentItem(step2Section, 'hdmi_custom_params');
        if (customParams) {
          var currentParams = self.getConfigValue(hdmiPrefix + '.custom_params', '');
          customParams.value = currentParams;
          var isCustom2 = self.getConfigValue(hdmiPrefix + '.display_preset', 'auto') === 'custom';
          customParams.hidden = !isCustom2;
        }

        // Force hotplug
        var hotplugSwitch = self.findContentItem(step2Section, 'hdmi_force_hotplug');
        if (hotplugSwitch) {
          var hotplugVal = self.getConfigValue(hdmiPrefix + '.force_hotplug', false);
          hotplugSwitch.value = (hotplugVal === true || hotplugVal === 'true') ? true : false;
        }

        // Ignore EDID
        var edidSwitch = self.findContentItem(step2Section, 'hdmi_ignore_edid');
        if (edidSwitch) {
          var edidVal = self.getConfigValue(hdmiPrefix + '.ignore_edid', false);
          edidSwitch.value = (edidVal === true || edidVal === 'true') ? true : false;
        }

        // Signal boost
        var boostOptions = [
          { value: 0, label: self.getI18n('BOOST_OFF') },
          { value: 1, label: '1' },
          { value: 2, label: '2' },
          { value: 3, label: '3' },
          { value: 4, label: '4 (' + self.getI18n('BOOST_DEFAULT') + ')' },
          { value: 5, label: '5' },
          { value: 6, label: '6' },
          { value: 7, label: '7 (' + self.getI18n('BOOST_MAX') + ')' }
        ];

        var boostSelect = self.findContentItem(step2Section, 'hdmi_boost');
        if (boostSelect) {
          boostSelect.options = boostOptions;
          var currentBoost = self.getConfigValue(hdmiPrefix + '.boost', 0);
          boostSelect.value = boostOptions.find(function(o) { return o.value === currentBoost; }) || boostOptions[0];
        }

        // ========================================
        // SECONDARY HDMI (dual-port boards only)
        // ========================================
        var secondaryLabel = self.findContentItem(step2Section, 'hdmi_secondary_label');
        var secondaryMode = self.findContentItem(step2Section, 'hdmi_secondary_mode');
        var secondaryPreset = self.findContentItem(step2Section, 'hdmi_secondary_display_preset');
        var secondaryHotplug = self.findContentItem(step2Section, 'hdmi_secondary_force_hotplug');
        var secondaryEdid = self.findContentItem(step2Section, 'hdmi_secondary_ignore_edid');
        var secondaryBoost = self.findContentItem(step2Section, 'hdmi_secondary_boost');

        if (hasDualHdmi) {
          // Show secondary fields
          if (secondaryLabel) {
            secondaryLabel.hidden = false;
            secondaryLabel.value = (secondaryHdmi === 'hdmi0') ? self.getI18n('OUTPUT_HDMI0') : self.getI18n('OUTPUT_HDMI1');
          }
          if (secondaryMode) {
            secondaryMode.hidden = false;
            secondaryMode.options = modeOptions;
            var secMode = self.getConfigValue(secondaryHdmi + '.mode', 'none');
            secondaryMode.value = modeOptions.find(function(o) { return o.value === secMode; }) || modeOptions[3]; // Default to 'none'
          }
          if (secondaryPreset) {
            secondaryPreset.hidden = false;
            secondaryPreset.options = presetOptions;
            var secPreset = self.getConfigValue(secondaryHdmi + '.display_preset', 'auto');
            secondaryPreset.value = presetOptions.find(function(o) { return o.value === secPreset; }) || presetOptions[0];
          }
          if (secondaryHotplug) {
            secondaryHotplug.hidden = false;
            var secHotplug = self.getConfigValue(secondaryHdmi + '.force_hotplug', false);
            secondaryHotplug.value = (secHotplug === true || secHotplug === 'true') ? true : false;
          }
          if (secondaryEdid) {
            secondaryEdid.hidden = false;
            var secEdid = self.getConfigValue(secondaryHdmi + '.ignore_edid', false);
            secondaryEdid.value = (secEdid === true || secEdid === 'true') ? true : false;
          }
          if (secondaryBoost) {
            secondaryBoost.hidden = false;
            secondaryBoost.options = boostOptions;
            var secBoost = self.getConfigValue(secondaryHdmi + '.boost', 0);
            secondaryBoost.value = boostOptions.find(function(o) { return o.value === secBoost; }) || boostOptions[0];
          }
        } else {
          // Hide secondary fields for single-HDMI boards
          if (secondaryLabel) secondaryLabel.hidden = true;
          if (secondaryMode) secondaryMode.hidden = true;
          if (secondaryPreset) secondaryPreset.hidden = true;
          if (secondaryHotplug) secondaryHotplug.hidden = true;
          if (secondaryEdid) secondaryEdid.hidden = true;
          if (secondaryBoost) secondaryBoost.hidden = true;
        }
      }
    }

    // ========================================
    // SECTION 7: Step 2 - DSI Configuration
    // ========================================
    var step3Section = uiconf.sections[7];
    if (step3Section) {
      // Show only when on step 2 AND output is DSI AND not showing audio section
      var showDsi = (wizardStep === 2) && (primaryOutput === 'dsi0' || primaryOutput === 'dsi1') && !self.step2ShowAudioCache;
      step3Section.hidden = wizardComplete || !showDsi;

      if (showDsi) {
        var dsiPrefix = primaryOutput;

        // DSI overlay - read from display_presets.json filtered by type === 'dsi'
        var overlaySelect = self.findContentItem(step3Section, 'dsi_overlay');
        if (overlaySelect) {
          var dsiOptions = [];
          if (self.displayPresets) {
            for (var presetKey in self.displayPresets) {
              var preset = self.displayPresets[presetKey];
              // Skip comment entries and non-DSI presets
              if (presetKey.startsWith('_comment') || preset.type !== 'dsi') {
                continue;
              }
              dsiOptions.push({ value: presetKey, label: preset.name });
            }
          }
          // Sort using natural sort (handles numeric values properly)
          dsiOptions.sort(function(a, b) {
            return naturalSortCompare(a.label, b.label);
          });
          // Log warning if no presets loaded (database issue)
          if (dsiOptions.length === 0) {
            self.logger.warn('pi_screen_setup: No DSI presets found in database');
          }
          dsiOptions.push({ value: 'custom', label: self.getI18n('CUSTOM_OVERLAY') });
          overlaySelect.options = dsiOptions;
          var currentOverlay = self.getConfigValue(dsiPrefix + '.overlay', 'rpi-touch-7inch');
          overlaySelect.value = dsiOptions.find(function(o) { return o.value === currentOverlay; }) || dsiOptions[0];
        }

        // Custom params
        var paramsInput = self.findContentItem(step3Section, 'dsi_custom_params');
        if (paramsInput) {
          paramsInput.value = self.getConfigValue(dsiPrefix + '.custom_params', '');
        }
      }
    }

    // ========================================
    // SECTION 8: Step 2 - DPI Configuration
    // ========================================
    var step4Section = uiconf.sections[8];
    if (step4Section) {
      var showDpi = (wizardStep === 2) && (primaryOutput === 'dpi') && !self.step2ShowAudioCache;
      step4Section.hidden = wizardComplete || !showDpi;

      if (showDpi) {
        // DPI overlay - read from display_presets.json filtered by type === 'dpi'
        var dpiOverlaySelect = self.findContentItem(step4Section, 'dpi_overlay');
        if (dpiOverlaySelect) {
          var dpiOptions = [];
          if (self.displayPresets) {
            for (var presetKey in self.displayPresets) {
              var preset = self.displayPresets[presetKey];
              // Skip comment entries and non-DPI presets
              if (presetKey.startsWith('_comment') || preset.type !== 'dpi') {
                continue;
              }
              dpiOptions.push({ value: presetKey, label: preset.name });
            }
          }
          // Sort using natural sort (handles numeric values properly)
          dpiOptions.sort(function(a, b) {
            return naturalSortCompare(a.label, b.label);
          });
          // Log warning if no presets loaded (database issue)
          if (dpiOptions.length === 0) {
            self.logger.warn('pi_screen_setup: No DPI presets found in database');
          }
          dpiOptions.push({ value: 'custom', label: self.getI18n('CUSTOM_OVERLAY') });
          dpiOverlaySelect.options = dpiOptions;
          var currentDpiOverlay = self.getConfigValue('dpi.overlay', '');
          dpiOverlaySelect.value = dpiOptions.find(function(o) { return o.value === currentDpiOverlay; }) || dpiOptions[0];
        }

        // Custom timing
        var timingInput = self.findContentItem(step4Section, 'dpi_custom_timing');
        if (timingInput) {
          timingInput.value = self.getConfigValue('dpi.custom_timing', '');
        }
      }
    }

    // ========================================
    // SECTION 9: Step 2 - Composite Configuration
    // ========================================
    var step5Section = uiconf.sections[9];
    if (step5Section) {
      var showComposite = (wizardStep === 2) && (primaryOutput === 'composite') && !self.step2ShowAudioCache;
      step5Section.hidden = wizardComplete || !showComposite;

      if (showComposite) {
        // Composite mode
        var compModeSelect = self.findContentItem(step5Section, 'composite_mode');
        if (compModeSelect) {
          var compOptions = [];
          for (var compKey in COMPOSITE_MODES) {
            compOptions.push({ value: compKey, label: COMPOSITE_MODES[compKey].label });
          }
          compModeSelect.options = compOptions;
          var currentCompMode = self.getConfigValue('composite.mode', 'pal');
          compModeSelect.value = compOptions.find(function(o) { return o.value === currentCompMode; }) || compOptions[0];
        }

        // Aspect ratio
        var aspectSelect = self.findContentItem(step5Section, 'composite_aspect');
        if (aspectSelect) {
          var aspectOptions = [
            { value: '4:3', label: '4:3' },
            { value: '16:9', label: '16:9' }
          ];
          aspectSelect.options = aspectOptions;
          var currentAspect = self.getConfigValue('composite.aspect', '4:3');
          aspectSelect.value = aspectOptions.find(function(o) { return o.value === currentAspect; }) || aspectOptions[0];
        }
      }
    }

    // ========================================
    // SECTION 10: Step 2 - Custom Overlay
    // ========================================
    var step6Section = uiconf.sections[10];
    if (step6Section) {
      var showCustom = (wizardStep === 2) && (primaryOutput === 'custom') && !self.step2ShowAudioCache;
      step6Section.hidden = wizardComplete || !showCustom;

      if (showCustom) {
        var customLineInput = self.findContentItem(step6Section, 'custom_overlay_line');
        if (customLineInput) {
          customLineInput.value = self.getConfigValue('custom_overlay.line', '');
        }
      }
    }

    // ========================================
    // SECTION 11: Step 2 - Audio Output (HDMI for non-HDMI primary)
    // ========================================
    var audioSection = uiconf.sections[11];
    if (audioSection) {
      // Show when primary is non-HDMI, we have HDMI ports, AND audio flag is set
      var isNonHdmiPrimary = (primaryOutput === 'dsi0' || primaryOutput === 'dsi1' || 
                              primaryOutput === 'dpi' || primaryOutput === 'composite' || 
                              primaryOutput === 'custom');
      var hasHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 0;
      var showAudio = (wizardStep === 2) && isNonHdmiPrimary && hasHdmi && self.step2ShowAudioCache;
      audioSection.hidden = wizardComplete || !showAudio;

      if (showAudio) {
        var audioModeOptions = [
          { value: 'none', label: self.getI18n('MODE_DISABLED') },
          { value: 'audio', label: self.getI18n('MODE_AUDIO_ONLY') }
        ];
        var hasDualHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 1;

        // HDMI0 audio mode
        var hdmi0Label = self.findContentItem(audioSection, 'audio_hdmi0_label');
        var hdmi0Mode = self.findContentItem(audioSection, 'audio_hdmi0_mode');
        if (hdmi0Label) {
          hdmi0Label.value = self.getI18n('OUTPUT_HDMI0');
        }
        if (hdmi0Mode) {
          hdmi0Mode.options = audioModeOptions;
          var h0Mode = self.getConfigValue('hdmi0.mode', 'none');
          hdmi0Mode.value = audioModeOptions.find(function(o) { return o.value === h0Mode; }) || audioModeOptions[0];
        }

        // HDMI1 audio mode (dual-port boards only)
        var hdmi1Label = self.findContentItem(audioSection, 'audio_hdmi1_label');
        var hdmi1Mode = self.findContentItem(audioSection, 'audio_hdmi1_mode');
        if (hasDualHdmi) {
          if (hdmi1Label) {
            hdmi1Label.hidden = false;
            hdmi1Label.value = self.getI18n('OUTPUT_HDMI1');
          }
          if (hdmi1Mode) {
            hdmi1Mode.hidden = false;
            hdmi1Mode.options = audioModeOptions;
            var h1Mode = self.getConfigValue('hdmi1.mode', 'none');
            hdmi1Mode.value = audioModeOptions.find(function(o) { return o.value === h1Mode; }) || audioModeOptions[0];
          }
        } else {
          if (hdmi1Label) hdmi1Label.hidden = true;
          if (hdmi1Mode) hdmi1Mode.hidden = true;
        }
      }
    }

    // ========================================
    // SECTION 12: Step 3 - Rotation
    // ========================================
    var step7Section = uiconf.sections[12];
    if (step7Section) {
      var showRotation = (wizardStep === 3) && (primaryOutput !== 'headless');
      step7Section.hidden = wizardComplete || !showRotation;

      if (showRotation) {
        var rotationSelect = self.findContentItem(step7Section, 'rotation');
        if (rotationSelect) {
          var rotOptions = [
            { value: 0, label: '0' + self.getI18n('DEGREES') },
            { value: 90, label: '90' + self.getI18n('DEGREES') },
            { value: 180, label: '180' + self.getI18n('DEGREES') },
            { value: 270, label: '270' + self.getI18n('DEGREES') }
          ];
          rotationSelect.options = rotOptions;

          var rotPrefix = primaryOutput.startsWith('hdmi') ? primaryOutput : primaryOutput;
          var currentRot = self.getConfigValue(rotPrefix + '.rotation', 0);
          rotationSelect.value = rotOptions.find(function(o) { return o.value === currentRot; }) || rotOptions[0];
        }

        // Determine if cmdline rotation options should be shown
        // Show for: HDMI (always), DSI (when overlay doesn't handle rotation), DPI, custom
        var showCmdlineOptions = false;
        var cmdlineHeaderItem = self.findContentItem(step7Section, 'cmdline_rotation_header');
        var cmdlineVideoSwitch = self.findContentItem(step7Section, 'cmdline_video');
        var cmdlineFbconSwitch = self.findContentItem(step7Section, 'cmdline_fbcon');
        var cmdlinePlymouthSwitch = self.findContentItem(step7Section, 'cmdline_plymouth');

        if (primaryOutput.startsWith('hdmi') || primaryOutput === 'dpi' || primaryOutput === 'composite' || primaryOutput === 'custom') {
          // HDMI, DPI, composite, custom always need cmdline rotation
          showCmdlineOptions = true;
        } else if (primaryOutput.startsWith('dsi')) {
          // DSI - check if overlay handles rotation
          var dsiPrefix = primaryOutput;
          var dsiPresetId = self.getConfigValue(dsiPrefix + '.overlay', '');
          var dsiPreset = self.getDisplayPreset(dsiPresetId);
          
          if (dsiPreset && dsiPreset.overlay_rotation_param === true) {
            // Overlay handles rotation - no cmdline needed
            showCmdlineOptions = false;
          } else {
            // Overlay doesn't handle rotation or unknown - show cmdline options
            showCmdlineOptions = true;
          }
        }

        // Show/hide cmdline rotation options
        if (cmdlineHeaderItem) cmdlineHeaderItem.hidden = !showCmdlineOptions;
        if (cmdlineVideoSwitch) {
          cmdlineVideoSwitch.hidden = !showCmdlineOptions;
          if (showCmdlineOptions) {
            cmdlineVideoSwitch.value = self.getConfigValue('cmdline_rotation.video', true);
          }
        }
        if (cmdlineFbconSwitch) {
          cmdlineFbconSwitch.hidden = !showCmdlineOptions;
          if (showCmdlineOptions) {
            cmdlineFbconSwitch.value = self.getConfigValue('cmdline_rotation.fbcon', true);
          }
        }
        if (cmdlinePlymouthSwitch) {
          cmdlinePlymouthSwitch.hidden = !showCmdlineOptions;
          if (showCmdlineOptions) {
            cmdlinePlymouthSwitch.value = self.getConfigValue('cmdline_rotation.plymouth', true);
          }
        }
      }
    }

    // ========================================
    // SECTION 13: Step 4 - KMS/CMA
    // ========================================
    var step8Section = uiconf.sections[13];
    if (step8Section) {
      var showKms = (wizardStep === 4) && capabilities.kms_supported;
      step8Section.hidden = wizardComplete || !showKms;

      if (showKms) {
        // CMA option
        var cmaSelect = self.findContentItem(step8Section, 'cma_option');
        if (cmaSelect) {
          var cmaOptions = [];
          for (var cmaKey in CMA_OPTIONS) {
            // Filter based on RAM
            var cmaVal = CMA_OPTIONS[cmaKey].value;
            if (self.hardwareInfo.ram_mb < 1024 && cmaVal > 128) {
              continue; // Skip large CMA for low RAM
            }
            cmaOptions.push({ value: cmaKey, label: CMA_OPTIONS[cmaKey].label });
          }
          cmaSelect.options = cmaOptions;
          var currentCma = self.config.get('kms.cma_option', 'default');
          cmaSelect.value = cmaOptions.find(function(o) { return o.value === currentCma; }) || cmaOptions[0];
        }

        // Custom CMA value
        var cmaCustomInput = self.findContentItem(step8Section, 'cma_custom_mb');
        if (cmaCustomInput) {
          var cmaCustomVal = self.config.get('kms.cma_custom_mb');
          cmaCustomInput.value = (cmaCustomVal !== undefined && cmaCustomVal !== null) ? cmaCustomVal : 256;
        }
      }
    }

    // ========================================
    // SECTION 14: Step 5 - OTA Behavior
    // ========================================
    var step9Section = uiconf.sections[14];
    if (step9Section) {
      var showOta = (wizardStep === 5);
      step9Section.hidden = wizardComplete || !showOta;

      if (showOta) {
        var otaSelect = self.findContentItem(step9Section, 'ota_behavior');
        if (otaSelect) {
          var otaOptions = [
            { value: 'silent', label: self.getI18n('OTA_SILENT') },
            { value: 'notify', label: self.getI18n('OTA_NOTIFY') },
            { value: 'ask', label: self.getI18n('OTA_ASK') }
          ];
          otaSelect.options = otaOptions;
          var currentOta = self.getConfigValue('ota_behavior', 'notify');
          otaSelect.value = otaOptions.find(function(o) { return o.value === currentOta; }) || otaOptions[1];
        }
      }
    }

    // ========================================
    // SECTION 15: Step 6 - Preview
    // ========================================
    var step10Section = uiconf.sections[15];
    if (step10Section) {
      var showPreview = (wizardStep === 6);
      step10Section.hidden = wizardComplete || !showPreview;

      if (showPreview) {
        // Generate config summary for preview
        var previewSummary = self.generateConfigSummary();
        var previewSummaryItem = self.findContentItem(step10Section, 'preview_summary');
        if (previewSummaryItem) {
          previewSummaryItem.value = previewSummary;
        }
        
        var previewFileItem = self.findContentItem(step10Section, 'preview_file');
        if (previewFileItem) {
          previewFileItem.value = VIDEOCONFIG_TXT;
        }
      }
    }

    // ========================================
    // SECTION 16: Current Configuration (shown when wizard complete)
    // ========================================
    var configSection = uiconf.sections[16];
    if (configSection) {
      configSection.hidden = !wizardComplete;

      if (wizardComplete) {
        // Config summary
        var currentSummary = self.generateConfigSummary();
        var currentSummaryItem = self.findContentItem(configSection, 'current_summary');
        if (currentSummaryItem) {
          currentSummaryItem.value = currentSummary;
        }
        
        // Config file path
        var currentFileItem = self.findContentItem(configSection, 'current_file');
        if (currentFileItem) {
          currentFileItem.value = VIDEOCONFIG_TXT;
        }
        
        // Applied date
        var appliedDateItem = self.findContentItem(configSection, 'applied_date');
        if (appliedDateItem) {
          var dateStr = self.getConfigValue('applied_date', '');
          if (dateStr) {
            try {
              var d = new Date(dateStr);
              appliedDateItem.value = d.toLocaleString();
            } catch (e) {
              appliedDateItem.value = dateStr;
            }
          } else {
            appliedDateItem.value = self.getI18n('NOT_AVAILABLE');
          }
        }

        // OTA behavior (also shown after wizard complete for editing)
        var otaEditSelect = self.findContentItem(configSection, 'ota_behavior_edit');
        if (otaEditSelect) {
          var otaEditOptions = [
            { value: 'silent', label: self.getI18n('OTA_SILENT') },
            { value: 'notify', label: self.getI18n('OTA_NOTIFY') },
            { value: 'ask', label: self.getI18n('OTA_ASK') }
          ];
          otaEditSelect.options = otaEditOptions;
          var currentOtaEdit = self.config.get('ota_behavior', 'notify');
          otaEditSelect.value = otaEditOptions.find(function(o) { return o.value === currentOtaEdit; }) || otaEditOptions[1];
        }

        // Restore points dropdown
        var restorePointSelect = self.findContentItem(configSection, 'restore_point');
        if (restorePointSelect) {
          var restorePoints = self.listRestorePoints();
          var restoreOptions = [];
          
          if (restorePoints.length === 0) {
            restoreOptions.push({ value: '', label: self.getI18n('NO_RESTORE_POINTS') });
          } else {
            for (var rp = 0; rp < restorePoints.length; rp++) {
              var point = restorePoints[rp];
              var label = point.created;
              try {
                var d = new Date(point.created);
                label = d.toLocaleString();
              } catch (e) {
                // Keep original label
              }
              if (point.description) {
                label += ' - ' + point.description;
              }
              restoreOptions.push({ value: point.id, label: label });
            }
          }
          restorePointSelect.options = restoreOptions;
          restorePointSelect.value = restoreOptions[0] || { value: '', label: '' };
          
          // Initialize stored selection to first option
          if (restoreOptions.length > 0 && restoreOptions[0].value) {
            self.selectedRestorePoint = restoreOptions[0].value;
          }
        }

        // Hide factory restore if no factory backup exists
        var restoreFactoryBtn = self.findContentItem(configSection, 'restore_factory_btn');
        if (restoreFactoryBtn) {
          restoreFactoryBtn.hidden = !self.hasFactoryBackup();
        }
      }
    }

    // ========================================
    // SECTION 17: Old Migration (deprecated - hidden)
    // ========================================
    var migrationSection = uiconf.sections[17];
    if (migrationSection) {
      // This old migration section is now replaced by sections 1 and 2
      // Keep it hidden always
      migrationSection.hidden = true;
    }
};

PiScreenSetup.prototype.findContentItem = function(section, id) {
  if (!section || !section.content) {
    return null;
  }

  for (var i = 0; i < section.content.length; i++) {
    if (section.content[i].id === id) {
      return section.content[i];
    }
  }

  return null;
};

PiScreenSetup.prototype.findSection = function(uiconf, sectionId) {
  if (!uiconf || !uiconf.sections) {
    return null;
  }

  for (var i = 0; i < uiconf.sections.length; i++) {
    if (uiconf.sections[i].id === sectionId) {
      return uiconf.sections[i];
    }
  }

  return null;
};

PiScreenSetup.prototype.setUIValue = function(section, itemId, value) {
  var self = this;
  var item = self.findContentItem(section, itemId);
  if (item) {
    item.value = value;
  }
};

PiScreenSetup.prototype.refreshUIConfig = function() {
  var self = this;

  self.logger.info('pi_screen_setup: refreshUIConfig called, will trigger after 100ms');
  
  setTimeout(function() {
    self.logger.info('pi_screen_setup: refreshUIConfig timeout - calling getUIConfig');
    self.getUIConfig()
      .then(function(uiconf) {
        self.logger.info('pi_screen_setup: refreshUIConfig - broadcasting pushUiConfig');
        self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
      })
      .fail(function(err) {
        self.logger.error('pi_screen_setup: Failed to refresh UI config - ' + err);
      });
  }, 100);
};


// ============================================================================
// SAVE METHODS - WIZARD STEPS
// ============================================================================

PiScreenSetup.prototype.saveStep0 = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 0 - ' + JSON.stringify(data));

  var detectMode = data.detect_mode ? data.detect_mode.value : 'manual';
  
  if (detectMode === 'auto') {
    // Auto-detect: scan current display state and pre-populate settings
    self.logger.info('pi_screen_setup: Auto-detect mode selected');
    
    // TODO: Implement actual display detection
    // For now, default to HDMI0 with screen_audio mode
    self.setConfigValue('primary_output', 'hdmi0');
    self.primaryOutputCache = 'hdmi0';
    self.setConfigValue('hdmi0.enabled', true);
    self.setConfigValue('hdmi0.mode', 'screen_audio');
    self.setConfigValue('hdmi0.resolution', 'auto');
  } else {
    // Manual mode: just proceed to Step 1
    self.logger.info('pi_screen_setup: Manual configuration mode selected');
  }

  // Advance wizard to Step 1
  self.config.set('wizard_step', 1);
  self.wizardStepCache = 1;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '1').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep1 = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 1 - ' + JSON.stringify(data));

  var primaryOutput = data.primary_output ? data.primary_output.value : 'hdmi0';
  self.setConfigValue('primary_output', primaryOutput);
  self.primaryOutputCache = primaryOutput;

  // Enable the selected output
  if (primaryOutput === 'hdmi0') {
    self.setConfigValue('hdmi0.enabled', true);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', false);
  } else if (primaryOutput === 'hdmi1') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', true);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', false);
  } else if (primaryOutput === 'dsi0') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', true);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', false);
  } else if (primaryOutput === 'dsi1') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', true);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', false);
  } else if (primaryOutput === 'dpi') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', true);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', false);
  } else if (primaryOutput === 'composite') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', true);
    self.setConfigValue('custom_overlay.enabled', false);
  } else if (primaryOutput === 'custom') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', true);
  } else if (primaryOutput === 'headless') {
    self.setConfigValue('hdmi0.enabled', false);
    self.setConfigValue('hdmi1.enabled', false);
    self.setConfigValue('dsi0.enabled', false);
    self.setConfigValue('dsi1.enabled', false);
    self.setConfigValue('dpi.enabled', false);
    self.setConfigValue('composite.enabled', false);
    self.setConfigValue('custom_overlay.enabled', false);
  }

  // Advance wizard - skip to step 5 for headless (no output config, rotation, or KMS needed)
  var nextStep = 2;
  if (primaryOutput === 'headless') {
    nextStep = 5;
  }
  
  self.config.set('wizard_step', nextStep);
  self.wizardStepCache = nextStep;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', String(nextStep)).replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep2Hdmi = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 HDMI - ' + JSON.stringify(data));

  var primaryOutput = self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0');
  var hdmiPrefix = primaryOutput;
  var secondaryHdmi = (primaryOutput === 'hdmi0') ? 'hdmi1' : 'hdmi0';
  var hasDualHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 1;

  // Save primary HDMI configuration
  self.setConfigValue(hdmiPrefix + '.enabled', true);
  self.setConfigValue(hdmiPrefix + '.mode', data.hdmi_mode ? data.hdmi_mode.value : 'screen_audio');
  self.setConfigValue(hdmiPrefix + '.display_preset', data.hdmi_display_preset ? data.hdmi_display_preset.value : 'auto');
  self.setConfigValue(hdmiPrefix + '.custom_timings', data.hdmi_custom_timings || '');
  self.setConfigValue(hdmiPrefix + '.custom_params', data.hdmi_custom_params || '');
  self.setConfigValue(hdmiPrefix + '.force_hotplug', data.hdmi_force_hotplug || false);
  self.setConfigValue(hdmiPrefix + '.ignore_edid', data.hdmi_ignore_edid || false);
  self.setConfigValue(hdmiPrefix + '.boost', data.hdmi_boost ? data.hdmi_boost.value : 0);

  // Check if preset has recommended rotation
  var presetId = data.hdmi_display_preset ? data.hdmi_display_preset.value : 'auto';
  var preset = self.getDisplayPreset(presetId);
  if (preset && preset.recommended_rotation !== undefined && preset.recommended_rotation !== 0) {
    // Store recommended rotation for use in Step 3
    self.setConfigValue(hdmiPrefix + '.recommended_rotation', preset.recommended_rotation);
  }

  // Save secondary HDMI configuration (dual-port boards only)
  if (hasDualHdmi) {
    var secMode = data.hdmi_secondary_mode ? data.hdmi_secondary_mode.value : 'none';
    self.setConfigValue(secondaryHdmi + '.enabled', secMode !== 'none');
    self.setConfigValue(secondaryHdmi + '.mode', secMode);
    self.setConfigValue(secondaryHdmi + '.display_preset', data.hdmi_secondary_display_preset ? data.hdmi_secondary_display_preset.value : 'auto');
    self.setConfigValue(secondaryHdmi + '.force_hotplug', data.hdmi_secondary_force_hotplug || false);
    self.setConfigValue(secondaryHdmi + '.ignore_edid', data.hdmi_secondary_ignore_edid || false);
    self.setConfigValue(secondaryHdmi + '.boost', data.hdmi_secondary_boost ? data.hdmi_secondary_boost.value : 0);
  }

  // Advance wizard to rotation step
  self.config.set('wizard_step', 3);
  self.wizardStepCache = 3;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '3').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep2Dsi = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 DSI - ' + JSON.stringify(data));

  var primaryOutput = self.primaryOutputCache || self.getConfigValue('primary_output', 'dsi0');
  var dsiPrefix = primaryOutput;

  self.setConfigValue(dsiPrefix + '.overlay', data.dsi_overlay ? data.dsi_overlay.value : 'vc4-kms-dsi-7inch');
  self.setConfigValue(dsiPrefix + '.custom_params', data.dsi_custom_params || '');

  // Check if HDMI is available for audio output
  var hasHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 0;
  if (hasHdmi) {
    // Show audio section for HDMI audio configuration
    self.step2ShowAudioCache = true;
    self.refreshUIConfig();
  } else {
    // No HDMI available, advance to rotation
    self.config.set('wizard_step', 3);
    self.wizardStepCache = 3;

    self.commandRouter.pushToastMessage('info',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('STEP_N_OF_M').replace('{n}', '3').replace('{m}', '7'));

    self.refreshUIConfig();
  }
};

PiScreenSetup.prototype.saveStep2Dpi = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 DPI - ' + JSON.stringify(data));

  self.setConfigValue('dpi.overlay', data.dpi_overlay ? data.dpi_overlay.value : '');
  self.setConfigValue('dpi.custom_timing', data.dpi_custom_timing || '');

  // Check if HDMI is available for audio output
  var hasHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 0;
  if (hasHdmi) {
    // Show audio section for HDMI audio configuration
    self.step2ShowAudioCache = true;
    self.refreshUIConfig();
  } else {
    // No HDMI available, advance to rotation
    self.config.set('wizard_step', 3);
    self.wizardStepCache = 3;

    self.commandRouter.pushToastMessage('info',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('STEP_N_OF_M').replace('{n}', '3').replace('{m}', '7'));

    self.refreshUIConfig();
  }
};

PiScreenSetup.prototype.saveStep2Composite = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 Composite - ' + JSON.stringify(data));

  self.setConfigValue('composite.mode', data.composite_mode ? data.composite_mode.value : 'pal');
  self.setConfigValue('composite.aspect', data.composite_aspect ? data.composite_aspect.value : '4:3');

  // Note: Composite disables HDMI on Pi 4/5, so no audio section needed
  // Advance directly to rotation
  self.config.set('wizard_step', 3);
  self.wizardStepCache = 3;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '3').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep2Custom = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 Custom - ' + JSON.stringify(data));

  self.setConfigValue('custom_overlay.line', data.custom_overlay_line || '');

  // Validate overlay file exists if it's a dtoverlay line
  var line = data.custom_overlay_line || '';
  if (line.startsWith('dtoverlay=')) {
    var overlayName = line.split('=')[1].split(',')[0];
    var overlayPath = path.join(OVERLAYS_PATH, overlayName + '.dtbo');
    if (!fs.existsSync(overlayPath)) {
      self.commandRouter.pushToastMessage('warning',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('OVERLAY_NOT_FOUND').replace('{name}', overlayName));
    }
  }

  // Check if HDMI is available for audio output
  var hasHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 0;
  if (hasHdmi) {
    // Show audio section for HDMI audio configuration
    self.step2ShowAudioCache = true;
    self.refreshUIConfig();
  } else {
    // No HDMI available, advance to rotation
    self.config.set('wizard_step', 3);
    self.wizardStepCache = 3;

    self.commandRouter.pushToastMessage('info',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('STEP_N_OF_M').replace('{n}', '3').replace('{m}', '7'));

    self.refreshUIConfig();
  }
};

PiScreenSetup.prototype.saveStep2Audio = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 Audio - ' + JSON.stringify(data));

  // Save HDMI0 audio mode
  var hdmi0Mode = data.audio_hdmi0_mode ? data.audio_hdmi0_mode.value : 'none';
  self.setConfigValue('hdmi0.enabled', hdmi0Mode !== 'none');
  self.setConfigValue('hdmi0.mode', hdmi0Mode);

  // Save HDMI1 audio mode (if dual-port)
  var hasDualHdmi = self.hardwareInfo && self.hardwareInfo.hdmi_ports > 1;
  if (hasDualHdmi) {
    var hdmi1Mode = data.audio_hdmi1_mode ? data.audio_hdmi1_mode.value : 'none';
    self.setConfigValue('hdmi1.enabled', hdmi1Mode !== 'none');
    self.setConfigValue('hdmi1.mode', hdmi1Mode);
  }

  // Clear audio flag and advance to rotation
  self.step2ShowAudioCache = false;
  self.config.set('wizard_step', 3);
  self.wizardStepCache = 3;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '3').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep2Headless = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 2 Headless');

  // Skip to step 5 (OTA), skipping rotation and KMS for headless
  self.config.set('wizard_step', 5);
  self.wizardStepCache = 5;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '5').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep3 = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 3 Rotation - ' + JSON.stringify(data));

  var rotation = data.rotation ? data.rotation.value : 0;
  var primaryOutput = self.primaryOutputCache || self.getConfigValue('primary_output', 'hdmi0');

  // Set rotation on the primary output
  if (primaryOutput.startsWith('hdmi')) {
    self.setConfigValue(primaryOutput + '.rotation', rotation);
  } else if (primaryOutput.startsWith('dsi')) {
    self.setConfigValue(primaryOutput + '.rotation', rotation);
  } else if (primaryOutput === 'dpi') {
    self.setConfigValue('dpi.rotation', rotation);
  }

  // Save cmdline rotation options (if present in data)
  if (data.cmdline_video !== undefined) {
    self.setConfigValue('cmdline_rotation.video', data.cmdline_video);
  }
  if (data.cmdline_fbcon !== undefined) {
    self.setConfigValue('cmdline_rotation.fbcon', data.cmdline_fbcon);
  }
  if (data.cmdline_plymouth !== undefined) {
    self.setConfigValue('cmdline_rotation.plymouth', data.cmdline_plymouth);
  }

  // Advance wizard - skip step 4 (KMS) if not supported
  var nextStep = 4;
  if (self.hardwareInfo && !self.hardwareInfo.kms_supported) {
    nextStep = 5;  // Skip to OTA
  }
  
  self.config.set('wizard_step', nextStep);
  self.wizardStepCache = nextStep;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', String(nextStep)).replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep4 = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 4 KMS - ' + JSON.stringify(data));

  self.setConfigValue('kms.cma_option', data.cma_option ? data.cma_option.value : 'default');
  self.setConfigValue('kms.cma_custom_mb', parseInt(data.cma_custom_mb, 10) || 256);

  // Advance wizard
  self.config.set('wizard_step', 5);
  self.wizardStepCache = 5;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '5').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveStep5 = function(data) {
  var self = this;

  self.logger.info('pi_screen_setup: Saving Step 5 OTA - ' + JSON.stringify(data));

  self.setConfigValue('ota_behavior', data.ota_behavior ? data.ota_behavior.value : 'notify');

  // Advance wizard
  self.config.set('wizard_step', 6);
  self.wizardStepCache = 6;

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('STEP_N_OF_M').replace('{n}', '6').replace('{m}', '7'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.applyConfiguration = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('pi_screen_setup: Applying configuration');

  // Create restore point BEFORE making changes
  self.createRestorePoint()
    .then(function(pointId) {
      self.logger.info('pi_screen_setup: Created restore point ' + pointId + ' before applying changes');
      // Write videoconfig.txt
      return self.writeVideoConfig();
    })
    .fail(function(err) {
      // Continue even if restore point fails
      self.logger.warn('pi_screen_setup: Could not create restore point - ' + err);
      return self.writeVideoConfig();
    })
    .then(function() {
      // Ensure config.txt has include line
      return self.ensureConfigInclude();
    })
    .then(function() {
      // Update cmdline.txt
      return self.updateCmdline();
    })
    .then(function() {
      // Migrate if needed
      return self.executeMigration();
    })
    .then(function() {
      // Save current config for OTA comparison
      return self.saveCurrentConfig();
    })
    .then(function() {
      // Mark wizard complete
      self.config.set('wizard_complete', true);
      self.wizardCompleteCache = true;
      self.config.set('wizard_step', 7);
      self.wizardStepCache = 7;
      self.config.set('applied_date', new Date().toISOString());
      
      // Clear any drift state
      self.driftDetected = false;
      self.driftErrors = [];

      // Get kernel version
      try {
        var kernelVersion = execSync('uname -r', { encoding: 'utf8' }).trim();
        self.config.set('kernel_version', kernelVersion);
      } catch (e) {
        self.logger.error('pi_screen_setup: Could not get kernel version');
      }

      self.commandRouter.pushToastMessage('success',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('CONFIG_APPLIED'));

      // Show reboot modal
      var modalData = {
        title: self.getI18n('REBOOT_REQUIRED'),
        message: self.getI18n('REBOOT_MESSAGE'),
        size: 'lg',
        buttons: [
          {
            name: self.getI18n('REBOOT_NOW'),
            class: 'btn btn-warning',
            emit: 'reboot',
            payload: ''
          },
          {
            name: self.getI18n('REBOOT_LATER'),
            class: 'btn btn-default',
            emit: 'closeModals',
            payload: ''
          }
        ]
      };
      self.commandRouter.broadcastMessage('openModal', modalData);

      self.refreshUIConfig();
      defer.resolve();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('APPLY_FAILED') + ': ' + err);
      defer.reject(err);
    });

  return defer.promise;
};

PiScreenSetup.prototype.goBack = function(data) {
  var self = this;

  var currentStep = self.wizardStepCache || self.config.get('wizard_step') || 1;
  if (currentStep > 1) {
    var newStep = currentStep - 1;
    
    // Skip step 4 (KMS) if going back and KMS is not supported
    if (newStep === 4 && self.hardwareInfo && !self.hardwareInfo.kms_supported) {
      newStep = 3;
    }
    
    self.config.set('wizard_step', newStep);
    self.wizardStepCache = newStep;
    self.refreshUIConfig();
  }
};

PiScreenSetup.prototype.resetWizard = function(data) {
  var self = this;

  self.config.set('wizard_step', 1);
  self.wizardStepCache = 1;
  self.config.set('wizard_complete', false);
  self.wizardCompleteCache = false;
  self.primaryOutputCache = null;  // Clear output selection too

  self.commandRouter.pushToastMessage('info',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('WIZARD_RESET'));

  self.refreshUIConfig();
};

PiScreenSetup.prototype.saveOtaBehavior = function(data) {
  var self = this;

  self.config.set('ota_behavior', data.ota_behavior_edit ? data.ota_behavior_edit.value : 'notify');

  self.commandRouter.pushToastMessage('success',
    self.getI18n('PLUGIN_NAME'),
    self.getI18n('SETTINGS_SAVED'));
};

PiScreenSetup.prototype.performMigration = function(data) {
  var self = this;

  self.executeMigration()
    .then(function() {
      self.commandRouter.pushToastMessage('success',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('MIGRATION_COMPLETE'));
      self.refreshUIConfig();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('MIGRATION_FAILED') + ': ' + err);
    });
};

// UI Handler: Restore from selected restore point
// UI Handler: Save restore point selection when dropdown changes
PiScreenSetup.prototype.saveRestorePointSelection = function(data) {
  var self = this;
  
  // data contains the selected value directly
  var pointId = data && data.value ? data.value : '';
  self.selectedRestorePoint = pointId;
  self.logger.info('pi_screen_setup: Saved restore point selection: ' + pointId);
};

// UI Handler: Restore from selected restore point
PiScreenSetup.prototype.restoreSelectedPoint = function(data) {
  var self = this;

  // Use stored selection instead of unreliable data parameter
  var pointId = self.selectedRestorePoint || null;
  
  self.logger.info('pi_screen_setup: restoreSelectedPoint pointId=' + pointId);
  
  if (!pointId) {
    self.commandRouter.pushToastMessage('warning',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('SELECT_RESTORE_POINT'));
    return;
  }
  
  self.restoreFromPoint(pointId)
    .then(function() {
      // Show reboot modal
      self.showRebootRequiredModal();
      self.refreshUIConfig();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('RESTORE_FAILED') + ': ' + err);
    });
};

// UI Handler: Restore factory defaults
PiScreenSetup.prototype.restoreFactory = function(data) {
  var self = this;

  // Show confirmation modal
  var modalData = {
    title: self.getI18n('FACTORY_RESTORE_TITLE'),
    message: self.getI18n('FACTORY_RESTORE_CONFIRM'),
    size: 'lg',
    buttons: [
      {
        name: self.getI18n('CONFIRM_RESTORE'),
        class: 'btn btn-danger',
        emit: 'callMethod',
        payload: {
          endpoint: 'system_hardware/pi_screen_setup',
          method: 'executeFactoryRestore'
        }
      },
      {
        name: self.getI18n('CANCEL'),
        class: 'btn btn-default',
        emit: 'closeModals',
        payload: ''
      }
    ]
  };
  self.commandRouter.broadcastMessage('openModal', modalData);
};

// UI Handler: Execute factory restore (called after confirmation)
PiScreenSetup.prototype.executeFactoryRestore = function(data) {
  var self = this;

  self.restoreFactoryDefaults()
    .then(function() {
      // Show reboot modal
      var modalData = {
        title: self.getI18n('REBOOT_REQUIRED'),
        message: self.getI18n('FACTORY_REBOOT_MESSAGE'),
        size: 'lg',
        buttons: [
          {
            name: self.getI18n('REBOOT_NOW'),
            class: 'btn btn-warning',
            emit: 'reboot',
            payload: ''
          },
          {
            name: self.getI18n('REBOOT_LATER'),
            class: 'btn btn-default',
            emit: 'closeModals',
            payload: ''
          }
        ]
      };
      self.commandRouter.broadcastMessage('openModal', modalData);
      
      self.refreshUIConfig();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage('error',
        self.getI18n('PLUGIN_NAME'),
        self.getI18n('FACTORY_RESTORE_FAILED') + ': ' + err);
    });
};

// Legacy: Restore from latest backup (kept for compatibility)
PiScreenSetup.prototype.restoreBackup = function(data) {
  var self = this;

  var videoBackup = self.getLatestBackup('videoconfig.txt');
  if (videoBackup) {
    self.restoreFromBackup(videoBackup, VIDEOCONFIG_TXT)
      .then(function() {
        self.commandRouter.pushToastMessage('success',
          self.getI18n('PLUGIN_NAME'),
          self.getI18n('BACKUP_RESTORED'));
      })
      .fail(function(err) {
        self.commandRouter.pushToastMessage('error',
          self.getI18n('PLUGIN_NAME'),
          self.getI18n('RESTORE_FAILED') + ': ' + err);
      });
  } else {
    self.commandRouter.pushToastMessage('warning',
      self.getI18n('PLUGIN_NAME'),
      self.getI18n('NO_BACKUP_FOUND'));
  }
};
