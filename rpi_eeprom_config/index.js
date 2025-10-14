'use strict';

const libQ = require('kew');
const fs = require('fs-extra');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const path = require('path');

module.exports = RpiEepromConfig;

function RpiEepromConfig(context) {
  const self = this;
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;
}

RpiEepromConfig.prototype.onVolumioStart = function() {
  const self = this;
  const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  
  // Set up dynamic paths based on plugin context
  self.pluginDataDir = self.commandRouter.pluginManager.getConfigurationFile(self.context, '');
  self.backupDir = path.join(self.pluginDataDir, 'backup');
  self.backupFile = path.join(self.backupDir, 'eeprom-backup.conf');
  
  // Load hardware capabilities
  try {
    const capabilitiesPath = path.join(__dirname, 'hardware_capabilities.json');
    self.hardwareCapabilities = fs.readJsonSync(capabilitiesPath);
    self.logger.info('[RpiEepromConfig] Hardware capabilities loaded');
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to load hardware capabilities: ' + error);
    self.hardwareCapabilities = {};
  }
  
  return libQ.resolve();
};

RpiEepromConfig.prototype.onStart = function() {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Starting Raspberry Pi EEPROM Configuration Manager');

  // Detect hardware and load capabilities
  const detectionResult = self.detectHardware();
  
  if (!detectionResult.compatible) {
    self.logger.error('[RpiEepromConfig] Incompatible hardware detected');
    self.commandRouter.pushToastMessage('error', 'Incompatible Hardware', 'This plugin requires a compatible Raspberry Pi model (4/400/5/500/500+/CM4/CM5)');
    defer.reject(new Error('Incompatible hardware'));
    return defer.promise;
  }

  self.detectedModel = detectionResult.model;
  self.modelCapabilities = detectionResult.capabilities;
  
  self.logger.info('[RpiEepromConfig] Detected model: ' + self.detectedModel);
  self.logger.info('[RpiEepromConfig] Boot modes: ' + self.modelCapabilities.boot_modes.join(', '));

  // Check for required tools
  if (!self.checkRequiredTools()) {
    self.logger.error('[RpiEepromConfig] Required tools not found');
    self.commandRouter.pushToastMessage('error', 'Missing Tools', 'Required EEPROM tools are not installed. Please ensure rpi-eeprom package is installed.');
    defer.reject(new Error('Missing required tools'));
    return defer.promise;
  }

  // Ensure backup directory exists
  self.ensureBackupDirectory();

  self.logger.info('[RpiEepromConfig] Plugin started successfully');
  defer.resolve();
  return defer.promise;
};

RpiEepromConfig.prototype.onStop = function() {
  const self = this;
  const defer = libQ.defer();
  self.logger.info('[RpiEepromConfig] Stopping Raspberry Pi EEPROM Configuration Manager');
  defer.resolve();
  return defer.promise;
};

RpiEepromConfig.prototype.getConfigurationFiles = function() {
  return ['config.json'];
};

// Hardware Detection
RpiEepromConfig.prototype.detectHardware = function() {
  const self = this;
  
  try {
    // Check if rpi-eeprom-config tool exists
    if (!fs.existsSync('/usr/bin/rpi-eeprom-config')) {
      self.logger.error('[RpiEepromConfig] rpi-eeprom-config tool not found');
      return { compatible: false, model: null, capabilities: null };
    }

    // Check CPU model from /proc/cpuinfo
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const modelMatch = cpuinfo.match(/Model\s*:\s*Raspberry Pi (.+)/);
    
    if (!modelMatch) {
      self.logger.error('[RpiEepromConfig] Not a Raspberry Pi');
      return { compatible: false, model: null, capabilities: null };
    }

    const fullModel = 'Raspberry Pi ' + modelMatch[1].trim();
    self.logger.info('[RpiEepromConfig] Detected full model string: ' + fullModel);

    // Look up model in capabilities
    let capabilities = null;
    let detectedModel = null;

    // Try exact match first
    if (self.hardwareCapabilities[fullModel]) {
      detectedModel = fullModel;
      capabilities = self.hardwareCapabilities[fullModel];
    } else {
      // Try partial matches for variations
      for (const model in self.hardwareCapabilities) {
        if (fullModel.includes(model.replace('Raspberry Pi ', ''))) {
          detectedModel = model;
          capabilities = self.hardwareCapabilities[model];
          self.logger.info('[RpiEepromConfig] Matched to capability profile: ' + model);
          break;
        }
      }
    }

    if (!capabilities) {
      self.logger.error('[RpiEepromConfig] Model not found in capabilities: ' + fullModel);
      return { compatible: false, model: fullModel, capabilities: null };
    }

    return { 
      compatible: true, 
      model: detectedModel, 
      capabilities: capabilities 
    };

  } catch (error) {
    self.logger.error('[RpiEepromConfig] Error detecting hardware: ' + error);
    return { compatible: false, model: null, capabilities: null };
  }
};

RpiEepromConfig.prototype.checkRequiredTools = function() {
  const self = this;
  
  const requiredTools = [
    '/usr/bin/rpi-eeprom-config',
    '/usr/bin/vcgencmd'
  ];

  for (const tool of requiredTools) {
    if (!fs.existsSync(tool)) {
      self.logger.error('[RpiEepromConfig] Required tool not found: ' + tool);
      return false;
    }
  }

  return true;
};

RpiEepromConfig.prototype.ensureBackupDirectory = function() {
  const self = this;
  
  try {
    fs.ensureDirSync(self.backupDir);
    self.logger.info('[RpiEepromConfig] Backup directory ensured: ' + self.backupDir);
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to create backup directory: ' + error);
  }
};

// Get available boot orders based on hardware capabilities
RpiEepromConfig.prototype.getAvailableBootOrders = function() {
  const self = this;
  
  if (!self.modelCapabilities) {
    self.logger.error('[RpiEepromConfig] No model capabilities available');
    return [];
  }

  const bootModes = self.modelCapabilities.boot_modes;

  // Define all possible boot orders with their required modes
  const allBootOrders = [
    {
      value: '0xf41',
      label: 'SD Card -> USB',
      modes: ['sd', 'usb']
    },
    {
      value: '0xf14',
      label: 'USB -> SD Card',
      modes: ['usb', 'sd']
    },
    {
      value: '0xf641',
      label: 'SD Card -> USB -> NVMe',
      modes: ['sd', 'usb', 'nvme']
    },
    {
      value: '0xf461',
      label: 'SD Card -> NVMe -> USB',
      modes: ['sd', 'usb', 'nvme']
    },
    {
      value: '0xf416',
      label: 'NVMe -> SD Card -> USB',
      modes: ['sd', 'usb', 'nvme']
    },
    {
      value: '0xf146',
      label: 'USB -> NVMe -> SD Card',
      modes: ['usb', 'nvme', 'sd']
    },
    {
      value: '0xf614',
      label: 'USB -> SD Card -> NVMe',
      modes: ['usb', 'sd', 'nvme']
    },
    {
      value: '0xf164',
      label: 'NVMe -> USB -> SD Card',
      modes: ['nvme', 'usb', 'sd']
    }
  ];

  // Filter boot orders based on hardware capabilities
  const availableBootOrders = allBootOrders.filter(function(order) {
    // Check if all required modes are available
    return order.modes.every(function(mode) {
      return bootModes.includes(mode);
    });
  });

  self.logger.info('[RpiEepromConfig] Available boot orders: ' + availableBootOrders.length);
  return availableBootOrders;
};

RpiEepromConfig.prototype.parameterValidation = {
  // Basic Settings - Required, will use defaults if missing/invalid
  BOOT_ORDER: {
    validate: function(value, model) {
      if (!model || !model.boot_modes) return false;
      const availableOrders = this.getAvailableBootOrders(model);
      return availableOrders.some(function(o) { return o.value === value; });
    },
    sanitize: function(value, model) {
      return model.default_boot_order;
    },
    required: true,
    section: 'basic'
  },
  
  PSU_MAX_CURRENT: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 3000 && num <= 5000;
    },
    sanitize: function() {
      return '5000';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(5000, Math.max(3000, isNaN(num) ? 5000 : num)));
    },
    required: false,
    section: 'basic',
    models: ['pi5', 'pi500', 'pi500plus']
  },
  
  POWER_OFF_ON_HALT: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '0';
    },
    required: false,
    section: 'basic'
  },
  
  WAKE_ON_GPIO: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '1';
    },
    required: false,
    section: 'basic'
  },
  
  PCIE_PROBE: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '1';
    },
    required: false,
    section: 'basic'
  },
  
  BOOT_UART: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '0';
    },
    required: false,
    section: 'basic'
  },
  
  UART_BAUD: {
    validate: function(value) {
      const validBauds = ['115200', '921600', '1500000'];
      return validBauds.indexOf(value) !== -1;
    },
    sanitize: function() {
      return '115200';
    },
    required: false,
    section: 'basic',
    models: ['pi5', 'pi500', 'pi500plus']
  },
  
  // Advanced Settings - Optional, sanitize but don't populate if missing
  USB_MSD_DISCOVER_TIMEOUT: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 5000 && num <= 60000;
    },
    sanitize: function() {
      return '20000';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(60000, Math.max(5000, isNaN(num) ? 20000 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  USB_MSD_LUN_TIMEOUT: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 100 && num <= 10000;
    },
    sanitize: function() {
      return '2000';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(10000, Math.max(100, isNaN(num) ? 2000 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  USB_MSD_PWR_OFF_TIME: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 5000;
    },
    sanitize: function() {
      return '1000';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(5000, Math.max(0, isNaN(num) ? 1000 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  USB_MSD_STARTUP_DELAY: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 30000;
    },
    sanitize: function() {
      return '0';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(30000, Math.max(0, isNaN(num) ? 0 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  USB_MSD_BOOT_MAX_RETRIES: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 9;
    },
    sanitize: function() {
      return '1';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(9, Math.max(0, isNaN(num) ? 1 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  SD_BOOT_MAX_RETRIES: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 9;
    },
    sanitize: function() {
      return '3';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(9, Math.max(0, isNaN(num) ? 3 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  ENABLE_SELF_UPDATE: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '0';
    },
    required: false,
    section: 'advanced'
  },
  
  FREEZE_VERSION: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '0';
    },
    required: false,
    section: 'advanced'
  },
  
  VL805: {
    validate: function(value) {
      // Empty is valid (auto-detect)
      if (!value || value === '') return true;
      // Must be 8-character hex
      return /^[0-9a-fA-F]{8}$/.test(value);
    },
    sanitize: function() {
      return '';
    },
    required: false,
    section: 'advanced',
    models: ['cm4']
  },
  
  PARTITION: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 255;
    },
    sanitize: function() {
      return '0';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(255, Math.max(0, isNaN(num) ? 0 : num)));
    },
    required: false,
    section: 'advanced'
  },
  
  // Debug Settings - Optional, sanitize but don't populate if missing
  DISABLE_HDMI: {
    validate: function(value) {
      return value === '0' || value === '1';
    },
    sanitize: function() {
      return '0';
    },
    required: false,
    section: 'debug'
  },
  
  HDMI_DELAY: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 0 && num <= 10;
    },
    sanitize: function() {
      return '5';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(10, Math.max(0, isNaN(num) ? 5 : num)));
    },
    required: false,
    section: 'debug'
  },
  
  NETCONSOLE: {
    validate: function(value) {
      // Empty is valid (disabled)
      if (!value || value === '') return true;
      // Basic format check: should contain commas for ip,port,gateway
      // Full validation is complex, so just check length and basic structure
      return value.length <= 32 && value.split(',').length >= 2;
    },
    sanitize: function() {
      return '';
    },
    required: false,
    section: 'debug'
  },
  
  DHCP_TIMEOUT: {
    validate: function(value) {
      const num = parseInt(value, 10);
      return !isNaN(num) && num >= 5000 && num <= 90000;
    },
    sanitize: function() {
      return '45000';
    },
    clamp: function(value) {
      const num = parseInt(value, 10);
      return String(Math.min(90000, Math.max(5000, isNaN(num) ? 45000 : num)));
    },
    required: false,
    section: 'debug'
  }
};

RpiEepromConfig.prototype.validateAndSanitizeConfig = function(rawConfig) {
  const self = this;
  const sanitized = {};
  const warnings = [];
  
  self.logger.info('[RpiEepromConfig] Validating and sanitizing configuration');
  
  // Get model-specific info for validation
  const model = self.modelCapabilities;
  const modelId = model ? model.id : null;
  
  // Process each parameter in raw config
  for (const key in rawConfig) {
    if (!rawConfig.hasOwnProperty(key)) continue;
    
    const value = rawConfig[key];
    const validation = self.parameterValidation[key];
    
    // Unknown parameter - pass through unchanged
    if (!validation) {
      sanitized[key] = value;
      self.logger.info('[RpiEepromConfig] Unknown parameter ' + key + '=' + value + ' (pass through)');
      continue;
    }
    
    // Check if parameter is applicable to this model
    if (validation.models && modelId && validation.models.indexOf(modelId) === -1) {
      self.logger.info('[RpiEepromConfig] Parameter ' + key + ' not applicable to ' + modelId + ' (skipped)');
      continue;
    }
    
    // Validate the value
    const isValid = validation.validate.call(self, value, model);
    
    if (isValid) {
      // Value is valid, keep it
      sanitized[key] = value;
      self.logger.info('[RpiEepromConfig] Parameter ' + key + '=' + value + ' (valid)');
    } else {
      // Value is invalid
      if (validation.clamp) {
        // Try to clamp to valid range
        const clamped = validation.clamp.call(self, value);
        sanitized[key] = clamped;
        warnings.push('Parameter ' + key + ' value "' + value + '" out of range, clamped to ' + clamped);
        self.logger.warn('[RpiEepromConfig] Parameter ' + key + '=' + value + ' invalid, clamped to ' + clamped);
      } else {
        // Use default sanitized value
        const defaultValue = validation.sanitize.call(self, value, model);
        sanitized[key] = defaultValue;
        warnings.push('Parameter ' + key + ' value "' + value + '" invalid, reset to default ' + defaultValue);
        self.logger.warn('[RpiEepromConfig] Parameter ' + key + '=' + value + ' invalid, sanitized to ' + defaultValue);
      }
    }
  }
  
  // Add required parameters that are missing (Basic settings only)
  for (const key in self.parameterValidation) {
    if (!self.parameterValidation.hasOwnProperty(key)) continue;
    
    const validation = self.parameterValidation[key];
    
    // Skip if not required (advanced/debug settings)
    if (!validation.required) continue;
    
    // Skip if parameter already exists
    if (sanitized.hasOwnProperty(key)) continue;
    
    // Check if parameter is applicable to this model
    if (validation.models && modelId && validation.models.indexOf(modelId) === -1) {
      continue;
    }
    
    // Add missing required parameter with default value
    const defaultValue = validation.sanitize.call(self, undefined, model);
    sanitized[key] = defaultValue;
    warnings.push('Required parameter ' + key + ' was missing, added with default value ' + defaultValue);
    self.logger.warn('[RpiEepromConfig] Required parameter ' + key + ' missing, added default ' + defaultValue);
  }
  
  return {
    config: sanitized,
    warnings: warnings
  };
};

// UI Configuration
RpiEepromConfig.prototype.getUIConfig = function() {
  const self = this;
  const defer = libQ.defer();

  const lang_code = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    path.join(__dirname, 'i18n', 'strings_' + lang_code + '.json'),
    path.join(__dirname, 'i18n', 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json')
  )
  .then(function(uiconf) {
    // Get current EEPROM configuration
    return self.getCurrentEepromConfig()
      .then(function(currentConfig) {
        // Populate UI with current values
        self.populateUIConfig(uiconf, currentConfig);
        defer.resolve(uiconf);
      })
      .fail(function(error) {
        self.logger.error('[RpiEepromConfig] Failed to get current EEPROM config: ' + error);
        defer.resolve(uiconf);
      });
  })
  .fail(function(error) {
    self.logger.error('[RpiEepromConfig] Failed to load UI config: ' + error);
    defer.reject(error);
  });

  return defer.promise;
};

RpiEepromConfig.prototype.getCurrentEepromConfig = function() {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Reading current EEPROM configuration');

  exec('vcgencmd bootloader_config', function(error, stdout, stderr) {
    if (error) {
      self.logger.error('[RpiEepromConfig] Failed to read EEPROM config: ' + error);
      defer.reject(error);
      return;
    }

    const config = {};
    const lines = stdout.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && line.indexOf('=') > 0) {
        const parts = line.split('=');
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        config[key] = value;
      }
    }

    self.logger.info('[RpiEepromConfig] Raw EEPROM config read: ' + JSON.stringify(config));
    
    // Validate and sanitize the configuration
    const validated = self.validateAndSanitizeConfig(config);
    
    // Show warnings to user if any
    if (validated.warnings.length > 0) {
      self.logger.warn('[RpiEepromConfig] Configuration issues detected: ' + validated.warnings.length);
      validated.warnings.forEach(function(warning) {
        self.commandRouter.pushToastMessage('warning', 'EEPROM Configuration Issue', warning);
      });
    }
    
    defer.resolve(validated.config);
  });

  return defer.promise;
};

RpiEepromConfig.prototype.populateUIConfig = function(uiconf, currentConfig) {
  const self = this;

  try {
    // Validate uiconf structure
    if (!uiconf || !uiconf.sections || !Array.isArray(uiconf.sections)) {
      self.logger.error('[RpiEepromConfig] Invalid uiconf structure');
      return;
    }

    // Section 0: Basic Settings
    if (!uiconf.sections[0] || !uiconf.sections[0].content) {
      self.logger.error('[RpiEepromConfig] Basic settings section not found');
      return;
    }

    const basicSection = uiconf.sections[0].content;

    // Hardware-based field filtering (Pi 5+ only fields)
    const supportedModels = ['Raspberry Pi 5', 'Raspberry Pi 500+', 'Compute Module 5'];
    const isPi5Plus = supportedModels.includes(self.detectedModel);
    
    if (!isPi5Plus) {
      uiconf.sections[0].content = basicSection.filter(function(item) {
        return item.id !== 'psu_max_current_enable' && item.id !== 'psu_max_current';
      });
      uiconf.sections[0].saveButton.data = uiconf.sections[0].saveButton.data.filter(function(id) {
        return id !== 'psu_max_current_enable' && id !== 'psu_max_current';
      });
      self.logger.info('[RpiEepromConfig] Removed Pi 5+ fields for ' + self.detectedModel);
    }

    // Boot Order - dynamically populate based on hardware capabilities
    const bootOrder = currentConfig.BOOT_ORDER || (self.modelCapabilities ? self.modelCapabilities.default_boot_order : '0xf41');
    const bootOrderIndex = basicSection.findIndex(function(item) {
      return item.id === 'boot_order';
    });
    
    if (bootOrderIndex !== -1) {
      const bootOrderSelect = basicSection[bootOrderIndex];
      
      // Get hardware-specific boot orders
      const availableBootOrders = self.getAvailableBootOrders();
      
      if (availableBootOrders && availableBootOrders.length > 0) {
        // Replace placeholder options with hardware-specific options
        bootOrderSelect.options = availableBootOrders.map(function(order) {
          return {
            value: order.value,
            label: order.label
          };
        });
        
        self.logger.info('[RpiEepromConfig] Populated ' + bootOrderSelect.options.length + ' boot order options');

        // Set current value from EEPROM config
        const matchingOption = bootOrderSelect.options.find(function(opt) {
          return opt.value === bootOrder;
        });
        
        if (matchingOption) {
          bootOrderSelect.value = matchingOption;
          self.logger.info('[RpiEepromConfig] Current boot order: ' + bootOrder);
        } else {
          // Current boot order not available for this hardware, use default
          const defaultBootOrder = self.modelCapabilities.default_boot_order;
          const defaultOption = bootOrderSelect.options.find(function(opt) {
            return opt.value === defaultBootOrder;
          });
          
          if (defaultOption) {
            bootOrderSelect.value = defaultOption;
            self.logger.warn('[RpiEepromConfig] Current boot order ' + bootOrder + ' not available, using default: ' + defaultBootOrder);
          } else if (bootOrderSelect.options.length > 0) {
            // Fallback to first option
            bootOrderSelect.value = bootOrderSelect.options[0];
            self.logger.warn('[RpiEepromConfig] Using first available boot order: ' + bootOrderSelect.options[0].value);
          }
        }
      } else {
        self.logger.error('[RpiEepromConfig] No boot orders available for this hardware');
      }
    }

    // Power Off on Halt
    const powerOffIndex = basicSection.findIndex(function(item) {
      return item.id === 'power_off_on_halt';
    });
    if (powerOffIndex !== -1) {
      basicSection[powerOffIndex].value = (currentConfig.POWER_OFF_ON_HALT === '1');
    }

    // Wake on GPIO
    const wakeGpioIndex = basicSection.findIndex(function(item) {
      return item.id === 'wake_on_gpio';
    });
    if (wakeGpioIndex !== -1) {
      basicSection[wakeGpioIndex].value = (currentConfig.WAKE_ON_GPIO === '1');
    }

    // PCIe Probe
    const pcieIndex = basicSection.findIndex(function(item) {
      return item.id === 'pcie_probe';
    });
    if (pcieIndex !== -1) {
      basicSection[pcieIndex].value = (currentConfig.PCIE_PROBE === '1');
    }

    // Boot UART
    const uartIndex = basicSection.findIndex(function(item) {
      return item.id === 'boot_uart';
    });
    if (uartIndex !== -1) {
      basicSection[uartIndex].value = (currentConfig.BOOT_UART === '1');
    }

    // UART Baud Rate (Pi 5+ only)
    const baudIndex = basicSection.findIndex(function(item) {
      return item.id === 'uart_baud';
    });
    if (baudIndex !== -1 && basicSection[baudIndex].options) {
      const baudValue = currentConfig.UART_BAUD || '115200';
      const baudOption = basicSection[baudIndex].options.find(function(opt) {
        return opt.value === parseInt(baudValue, 10);
      });
      if (baudOption) {
        basicSection[baudIndex].value = baudOption;
      }
    }

    // PSU Max Current Enable/Value (Pi 5+ only)
    const psuEnableIndex = basicSection.findIndex(function(item) {
      return item.id === 'psu_max_current_enable';
    });
    const psuCurrentIndex = basicSection.findIndex(function(item) {
      return item.id === 'psu_max_current';
    });
    
    if (psuEnableIndex !== -1 && psuCurrentIndex !== -1) {
      if (currentConfig.PSU_MAX_CURRENT) {
        basicSection[psuEnableIndex].value = true;
        basicSection[psuCurrentIndex].value = parseInt(currentConfig.PSU_MAX_CURRENT, 10);
      } else {
        basicSection[psuEnableIndex].value = false;
        basicSection[psuCurrentIndex].value = 5000;
      }
    }

    // Section 1: Advanced Settings
    if (!uiconf.sections[1] || !uiconf.sections[1].content) {
      self.logger.warn('[RpiEepromConfig] Advanced settings section not found');
    } else {
      const advancedSection = uiconf.sections[1].content;

      // USB settings
      const usbDiscoverIndex = advancedSection.findIndex(function(item) {
        return item.id === 'usb_msd_discover_timeout';
      });
      if (usbDiscoverIndex !== -1) {
        advancedSection[usbDiscoverIndex].value = parseInt(currentConfig.USB_MSD_DISCOVER_TIMEOUT || '20000', 10);
      }

      const usbLunIndex = advancedSection.findIndex(function(item) {
        return item.id === 'usb_msd_lun_timeout';
      });
      if (usbLunIndex !== -1) {
        advancedSection[usbLunIndex].value = parseInt(currentConfig.USB_MSD_LUN_TIMEOUT || '2000', 10);
      }

      const usbPwrOffIndex = advancedSection.findIndex(function(item) {
        return item.id === 'usb_msd_pwr_off_time';
      });
      if (usbPwrOffIndex !== -1) {
        advancedSection[usbPwrOffIndex].value = parseInt(currentConfig.USB_MSD_PWR_OFF_TIME || '1000', 10);
      }

      const usbStartupIndex = advancedSection.findIndex(function(item) {
        return item.id === 'usb_msd_startup_delay';
      });
      if (usbStartupIndex !== -1) {
        advancedSection[usbStartupIndex].value = parseInt(currentConfig.USB_MSD_STARTUP_DELAY || '0', 10);
      }

      const usbRetriesIndex = advancedSection.findIndex(function(item) {
        return item.id === 'usb_msd_boot_max_retries';
      });
      if (usbRetriesIndex !== -1) {
        advancedSection[usbRetriesIndex].value = parseInt(currentConfig.USB_MSD_BOOT_MAX_RETRIES || '1', 10);
      }

      // SD card retries
      const sdRetriesIndex = advancedSection.findIndex(function(item) {
        return item.id === 'sd_boot_max_retries';
      });
      if (sdRetriesIndex !== -1) {
        advancedSection[sdRetriesIndex].value = parseInt(currentConfig.SD_BOOT_MAX_RETRIES || '3', 10);
      }

      // Self update
      const selfUpdateIndex = advancedSection.findIndex(function(item) {
        return item.id === 'enable_self_update';
      });
      if (selfUpdateIndex !== -1) {
        advancedSection[selfUpdateIndex].value = (currentConfig.ENABLE_SELF_UPDATE === '1');
      }

      // Freeze version
      const freezeIndex = advancedSection.findIndex(function(item) {
        return item.id === 'freeze_version';
      });
      if (freezeIndex !== -1) {
        advancedSection[freezeIndex].value = (currentConfig.FREEZE_VERSION === '1');
      }

      // VL805 (CM4 only)
      const vl805Index = advancedSection.findIndex(function(item) {
        return item.id === 'vl805';
      });
      if (vl805Index !== -1) {
        advancedSection[vl805Index].value = currentConfig.VL805 || '';
      }

      // Partition
      const partitionIndex = advancedSection.findIndex(function(item) {
        return item.id === 'partition';
      });
      if (partitionIndex !== -1) {
        advancedSection[partitionIndex].value = parseInt(currentConfig.PARTITION || '0', 10);
      }
    }

    // Section 2: Debug Settings
    if (!uiconf.sections[2] || !uiconf.sections[2].content) {
      self.logger.warn('[RpiEepromConfig] Debug settings section not found');
    } else {
      const debugSection = uiconf.sections[2].content;

      // Disable HDMI
      const hdmiIndex = debugSection.findIndex(function(item) {
        return item.id === 'disable_hdmi';
      });
      if (hdmiIndex !== -1) {
        debugSection[hdmiIndex].value = (currentConfig.DISABLE_HDMI === '1');
      }

      // HDMI Delay
      const hdmiDelayIndex = debugSection.findIndex(function(item) {
        return item.id === 'hdmi_delay';
      });
      if (hdmiDelayIndex !== -1) {
        debugSection[hdmiDelayIndex].value = parseInt(currentConfig.HDMI_DELAY || '5', 10);
      }

      // Net console
      const netConsoleIndex = debugSection.findIndex(function(item) {
        return item.id === 'netconsole';
      });
      if (netConsoleIndex !== -1) {
        debugSection[netConsoleIndex].value = currentConfig.NETCONSOLE || '';
      }

      // DHCP Timeout
      const dhcpIndex = debugSection.findIndex(function(item) {
        return item.id === 'dhcp_timeout';
      });
      if (dhcpIndex !== -1) {
        debugSection[dhcpIndex].value = parseInt(currentConfig.DHCP_TIMEOUT || '45000', 10);
      }
    }

    self.logger.info('[RpiEepromConfig] UI config populated successfully');

  } catch (error) {
    self.logger.error('[RpiEepromConfig] Error populating UI config: ' + error.message);
    self.logger.error('[RpiEepromConfig] Stack: ' + error.stack);
  }
};

// Save Configuration
RpiEepromConfig.prototype.saveEepromConfig = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.warn('[RpiEepromConfig] saveEepromConfig called - this method is deprecated. Use staged confirmation workflow.');
  self.commandRouter.pushToastMessage('info', 'Use Staged Workflow', 'Please use the "Confirm" buttons in each section, then "Apply Configuration & Reboot".');
  
  defer.reject(new Error('Use staged confirmation workflow'));
  return defer.promise;
};

// Staged Configuration Methods

RpiEepromConfig.prototype.confirmBasicSettings = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Confirming basic settings: ' + JSON.stringify(data));

  try {
    // Normalize select field objects to primitive values
    const normalizedData = {
      boot_order: (typeof data.boot_order === 'object' && data.boot_order.value) ? data.boot_order.value : data.boot_order,
      power_off_on_halt: data.power_off_on_halt,
      wake_on_gpio: data.wake_on_gpio,
      pcie_probe: data.pcie_probe,
      boot_uart: data.boot_uart,
      uart_baud: (typeof data.uart_baud === 'object' && data.uart_baud.value) ? data.uart_baud.value : data.uart_baud,
      psu_max_current_enable: data.psu_max_current_enable,
      psu_max_current: data.psu_max_current
    };

    // Store as JSON string to avoid v-conf object type issues
    self.config.set('temp_basic_json', JSON.stringify(normalizedData));
    
    self.logger.info('[RpiEepromConfig] Basic settings staged successfully: ' + JSON.stringify(normalizedData));
    self.commandRouter.pushToastMessage('success', 'Basic Settings Confirmed', 'Basic settings have been staged. Configure other sections or apply changes.');
    
    defer.resolve();
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to stage basic settings: ' + error);
    self.commandRouter.pushToastMessage('error', 'Configuration Error', 'Failed to stage basic settings: ' + error);
    defer.reject(error);
  }

  return defer.promise;
};

RpiEepromConfig.prototype.confirmAdvancedSettings = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Confirming advanced settings: ' + JSON.stringify(data));

  try {
    // All advanced fields are primitive types (no select objects to normalize)
    const normalizedData = {
      show_advanced: data.show_advanced,
      usb_msd_discover_timeout: data.usb_msd_discover_timeout,
      usb_msd_lun_timeout: data.usb_msd_lun_timeout,
      usb_msd_pwr_off_time: data.usb_msd_pwr_off_time,
      usb_msd_startup_delay: data.usb_msd_startup_delay,
      usb_msd_boot_max_retries: data.usb_msd_boot_max_retries,
      sd_boot_max_retries: data.sd_boot_max_retries,
      enable_self_update: data.enable_self_update,
      freeze_version: data.freeze_version,
      vl805: data.vl805,
      partition: data.partition
    };

    // Store as JSON string to avoid v-conf object type issues
    self.config.set('temp_advanced_json', JSON.stringify(normalizedData));
    
    self.logger.info('[RpiEepromConfig] Advanced settings staged successfully: ' + JSON.stringify(normalizedData));
    self.commandRouter.pushToastMessage('success', 'Advanced Settings Confirmed', 'Advanced settings have been staged. Configure other sections or apply changes.');
    
    defer.resolve();
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to stage advanced settings: ' + error);
    self.commandRouter.pushToastMessage('error', 'Configuration Error', 'Failed to stage advanced settings: ' + error);
    defer.reject(error);
  }

  return defer.promise;
};

RpiEepromConfig.prototype.confirmDebugSettings = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Confirming debug settings: ' + JSON.stringify(data));

  try {
    // All debug fields are primitive types (no select objects to normalize)
    const normalizedData = {
      show_debug: data.show_debug,
      disable_hdmi: data.disable_hdmi,
      hdmi_delay: data.hdmi_delay,
      netconsole: data.netconsole,
      dhcp_timeout: data.dhcp_timeout
    };

    // Store as JSON string to avoid v-conf object type issues
    self.config.set('temp_debug_json', JSON.stringify(normalizedData));
    
    self.logger.info('[RpiEepromConfig] Debug settings staged successfully: ' + JSON.stringify(normalizedData));
    self.commandRouter.pushToastMessage('success', 'Debug Settings Confirmed', 'Debug settings have been staged. Configure other sections or apply changes.');
    
    defer.resolve();
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to stage debug settings: ' + error);
    self.commandRouter.pushToastMessage('error', 'Configuration Error', 'Failed to stage debug settings: ' + error);
    defer.reject(error);
  }

  return defer.promise;
};

RpiEepromConfig.prototype.applyConfiguration = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Applying configuration with data: ' + JSON.stringify(data));

  // Check risk acknowledgment
  if (!data.risk_acknowledged) {
    self.commandRouter.pushToastMessage('error', 'Risk Not Acknowledged', 'You must acknowledge the risks before applying changes.');
    defer.reject(new Error('Risk not acknowledged'));
    return defer.promise;
  }

  // Retrieve staged settings from temp storage (stored as JSON strings)
  let tempBasic = {};
  let tempAdvanced = {};
  let tempDebug = {};

  try {
    const basicJson = self.config.get('temp_basic_json', '{}');
    tempBasic = JSON.parse(basicJson);
    self.logger.info('[RpiEepromConfig] Retrieved temp_basic: ' + JSON.stringify(tempBasic));
  } catch (e) {
    self.logger.warn('[RpiEepromConfig] Failed to parse temp_basic_json: ' + e);
  }

  try {
    const advancedJson = self.config.get('temp_advanced_json', '{}');
    tempAdvanced = JSON.parse(advancedJson);
    self.logger.info('[RpiEepromConfig] Retrieved temp_advanced: ' + JSON.stringify(tempAdvanced));
  } catch (e) {
    self.logger.warn('[RpiEepromConfig] Failed to parse temp_advanced_json: ' + e);
  }

  try {
    const debugJson = self.config.get('temp_debug_json', '{}');
    tempDebug = JSON.parse(debugJson);
    self.logger.info('[RpiEepromConfig] Retrieved temp_debug: ' + JSON.stringify(tempDebug));
  } catch (e) {
    self.logger.warn('[RpiEepromConfig] Failed to parse temp_debug_json: ' + e);
  }

  // Merge all staged settings with factory defaults
  const mergedConfig = self.mergeWithDefaults(tempBasic, tempAdvanced, tempDebug);

  self.logger.info('[RpiEepromConfig] Merged configuration: ' + JSON.stringify(mergedConfig));
  
  // Store current config for safety validation
  self.currentEepromConfig = mergedConfig;
  
  self.logger.info('[RpiEepromConfig] Applying EEPROM configuration');

  // Create backup before applying changes
  self.createBackup()
    .then(function() {
      // Build new EEPROM configuration
      return self.buildEepromConfig(mergedConfig);
    })
    .then(function(newConfig) {
      // Apply new configuration
      return self.applyEepromConfig(newConfig);
    })
    .then(function() {
      // Clear temp storage after successful apply
      self.config.delete('temp_basic_json');
      self.config.delete('temp_advanced_json');
      self.config.delete('temp_debug_json');
      
      self.logger.info('[RpiEepromConfig] EEPROM configuration applied successfully');
      self.commandRouter.pushToastMessage('success', 'Configuration Applied', 'EEPROM configuration updated. System will reboot in 5 seconds...');
      
      // Reboot after 5 seconds
      setTimeout(function() {
        self.rebootSystem();
      }, 5000);
      
      defer.resolve();
    })
    .fail(function(error) {
      self.logger.error('[RpiEepromConfig] Failed to apply EEPROM configuration: ' + error);
      self.commandRouter.pushToastMessage('error', 'Configuration Failed', 'Failed to apply EEPROM configuration: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

RpiEepromConfig.prototype.mergeWithDefaults = function(tempBasic, tempAdvanced, tempDebug) {
  const self = this;
  const result = {};

  self.logger.info('[RpiEepromConfig] Merging configurations');
  self.logger.info('[RpiEepromConfig] tempBasic: ' + JSON.stringify(tempBasic));
  self.logger.info('[RpiEepromConfig] tempAdvanced: ' + JSON.stringify(tempAdvanced));
  self.logger.info('[RpiEepromConfig] tempDebug: ' + JSON.stringify(tempDebug));

  // Start with current EEPROM config (already validated and sanitized)
  const currentConfig = self.currentEepromConfig || {};
  for (const key in currentConfig) {
    if (currentConfig.hasOwnProperty(key)) {
      result[key] = currentConfig[key];
    }
  }

  // Override with tempBasic values - convert lowercase to UPPERCASE EEPROM keys
  if (tempBasic.boot_order) {
    result.BOOT_ORDER = tempBasic.boot_order;
  }
  if (tempBasic.psu_max_current !== undefined) {
    result.PSU_MAX_CURRENT = String(tempBasic.psu_max_current);
  }
  if (tempBasic.power_off_on_halt !== undefined) {
    result.POWER_OFF_ON_HALT = tempBasic.power_off_on_halt ? '1' : '0';
  }
  if (tempBasic.wake_on_gpio !== undefined) {
    result.WAKE_ON_GPIO = tempBasic.wake_on_gpio ? '1' : '0';
  }
  // PCIE_PROBE: Only add if explicitly enabled, remove if explicitly disabled
  if (tempBasic.pcie_probe === true) {
    result.PCIE_PROBE = '1';
  } else if (tempBasic.pcie_probe === false) {
    delete result.PCIE_PROBE;
  }
  if (tempBasic.boot_uart !== undefined) {
    result.BOOT_UART = tempBasic.boot_uart ? '1' : '0';
  }
  if (tempBasic.uart_baud) {
    result.UART_BAUD = String(tempBasic.uart_baud);
  }

  // Override with tempAdvanced values (only if present)
  if (tempAdvanced.usb_msd_discover_timeout !== undefined) {
    result.USB_MSD_DISCOVER_TIMEOUT = String(tempAdvanced.usb_msd_discover_timeout);
  }
  if (tempAdvanced.usb_msd_lun_timeout !== undefined) {
    result.USB_MSD_LUN_TIMEOUT = String(tempAdvanced.usb_msd_lun_timeout);
  }
  if (tempAdvanced.usb_msd_pwr_off_time !== undefined) {
    result.USB_MSD_PWR_OFF_TIME = String(tempAdvanced.usb_msd_pwr_off_time);
  }
  if (tempAdvanced.usb_msd_startup_delay !== undefined) {
    result.USB_MSD_STARTUP_DELAY = String(tempAdvanced.usb_msd_startup_delay);
  }
  if (tempAdvanced.usb_msd_boot_max_retries !== undefined) {
    result.USB_MSD_BOOT_MAX_RETRIES = String(tempAdvanced.usb_msd_boot_max_retries);
  }
  if (tempAdvanced.sd_boot_max_retries !== undefined) {
    result.SD_BOOT_MAX_RETRIES = String(tempAdvanced.sd_boot_max_retries);
  }
  if (tempAdvanced.enable_self_update !== undefined) {
    result.ENABLE_SELF_UPDATE = tempAdvanced.enable_self_update ? '1' : '0';
  }
  if (tempAdvanced.freeze_version !== undefined) {
    result.FREEZE_VERSION = tempAdvanced.freeze_version ? '1' : '0';
  }
  if (tempAdvanced.vl805 !== undefined) {
    result.VL805 = tempAdvanced.vl805;
  }
  if (tempAdvanced.partition !== undefined) {
    result.PARTITION = String(tempAdvanced.partition);
  }

  // Override with tempDebug values (only if present)
  if (tempDebug.disable_hdmi !== undefined) {
    result.DISABLE_HDMI = tempDebug.disable_hdmi ? '1' : '0';
  }
  if (tempDebug.hdmi_delay !== undefined) {
    result.HDMI_DELAY = String(tempDebug.hdmi_delay);
  }
  if (tempDebug.netconsole !== undefined) {
    result.NETCONSOLE = tempDebug.netconsole;
  }
  if (tempDebug.dhcp_timeout !== undefined) {
    result.DHCP_TIMEOUT = String(tempDebug.dhcp_timeout);
  }

  self.logger.info('[RpiEepromConfig] Merged configuration: ' + JSON.stringify(result));

  return result;
};

RpiEepromConfig.prototype.validateConfigSafety = function(config) {
  const self = this;
  const errors = [];
  const warnings = [];

  self.logger.info('[RpiEepromConfig] Validating configuration safety for: ' + self.detectedModel);

  // CRITICAL: NVMe-capable hardware MUST have proper boot configuration
  const hasNvmeSupport = self.modelCapabilities && self.modelCapabilities.boot_modes.includes('nvme');
  
  if (hasNvmeSupport) {
    // Check BOOT_ORDER includes NVMe (hex 6)
    const bootOrder = config.BOOT_ORDER || '';
    if (bootOrder && !bootOrder.includes('6')) {
      warnings.push('NVMe-capable hardware but boot order does not include NVMe mode');
      self.logger.warn('[RpiEepromConfig] Boot order ' + bootOrder + ' missing NVMe on NVMe-capable hardware');
    }

    // CRITICAL: PCIE_PROBE must be enabled for NVMe boot
    if (!config.PCIE_PROBE || config.PCIE_PROBE !== '1') {
      // Auto-fix critical safety issue
      config.PCIE_PROBE = '1';
      warnings.push('CRITICAL: Automatically enabled PCIE_PROBE for NVMe-capable hardware');
      self.logger.warn('[RpiEepromConfig] Auto-enabled PCIE_PROBE=1 for NVMe hardware safety');
    }
  }

  // Validate BOOT_ORDER is valid for this hardware
  if (config.BOOT_ORDER) {
    const availableOrders = self.getAvailableBootOrders();
    const validOrder = availableOrders.some(function(order) {
      return order.value === config.BOOT_ORDER;
    });
    
    if (!validOrder) {
      errors.push('BOOT_ORDER ' + config.BOOT_ORDER + ' is not valid for ' + self.detectedModel);
      self.logger.error('[RpiEepromConfig] Invalid boot order for hardware');
    }
  } else {
    // No boot order specified - use hardware default
    const defaultBootOrder = self.modelCapabilities.default_boot_order;
    config.BOOT_ORDER = defaultBootOrder;
    warnings.push('No boot order specified, using hardware default: ' + defaultBootOrder);
    self.logger.warn('[RpiEepromConfig] Using default boot order: ' + defaultBootOrder);
  }

  // Ensure critical boot parameters exist
  if (config.BOOT_UART === undefined) {
    config.BOOT_UART = '0';
    self.logger.info('[RpiEepromConfig] Setting BOOT_UART default: 0');
  }
  if (config.WAKE_ON_GPIO === undefined) {
    config.WAKE_ON_GPIO = '1';
    self.logger.info('[RpiEepromConfig] Setting WAKE_ON_GPIO default: 1');
  }
  if (config.POWER_OFF_ON_HALT === undefined) {
    config.POWER_OFF_ON_HALT = '0';
    self.logger.info('[RpiEepromConfig] Setting POWER_OFF_ON_HALT default: 0');
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    config: config
  };
};

RpiEepromConfig.prototype.createBackup = function() {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Creating EEPROM backup');

  exec('vcgencmd bootloader_config', { uid: 1000, gid: 1000 }, function(error, stdout, stderr) {
    if (error) {
      self.logger.error('[RpiEepromConfig] Failed to read current EEPROM config for backup: ' + error);
      defer.reject(error);
      return;
    }

    try {
      // Write backup file
      fs.writeFileSync(self.backupFile, '[all]\n' + stdout);
      self.config.set('backup_exists.value', true);
      self.logger.info('[RpiEepromConfig] Backup created successfully: ' + self.backupFile);
      defer.resolve();
    } catch (writeError) {
      self.logger.error('[RpiEepromConfig] Failed to write backup file: ' + writeError);
      defer.reject(writeError);
    }
  });

  return defer.promise;
};

RpiEepromConfig.prototype.buildEepromConfig = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Building new EEPROM configuration');
  self.logger.info('[RpiEepromConfig] Input data keys: ' + Object.keys(data).join(', '));

  // SAFETY CHECK before building
  const safetyCheck = self.validateConfigSafety(data);
  
  // Show warnings to user
  if (safetyCheck.warnings.length > 0) {
    safetyCheck.warnings.forEach(function(warning) {
      self.logger.warn('[RpiEepromConfig] Safety warning: ' + warning);
      self.commandRouter.pushToastMessage('warning', 'Configuration Safety', warning);
    });
  }

  // Abort if critical errors
  if (!safetyCheck.valid) {
    safetyCheck.errors.forEach(function(error) {
      self.logger.error('[RpiEepromConfig] Safety error: ' + error);
      self.commandRouter.pushToastMessage('error', 'Configuration Error', error);
    });
    defer.reject(new Error('Configuration failed safety validation'));
    return defer.promise;
  }

  // Use safety-validated config
  data = safetyCheck.config;

  const config = [];
  config.push('[all]');

  // CRITICAL: Use UPPERCASE keys to match merged config
  
  // boot_order - REQUIRED
  if (data.BOOT_ORDER) {
    config.push('BOOT_ORDER=' + data.BOOT_ORDER);
  } else {
    // Should never happen due to safety check, but failsafe
    const defaultBootOrder = self.modelCapabilities.default_boot_order;
    config.push('BOOT_ORDER=' + defaultBootOrder);
    self.logger.warn('[RpiEepromConfig] Using failsafe boot order: ' + defaultBootOrder);
  }
  
  // Basic settings - REQUIRED
  config.push('BOOT_UART=' + (data.BOOT_UART === '1' ? '1' : '0'));
  config.push('WAKE_ON_GPIO=' + (data.WAKE_ON_GPIO === '1' ? '1' : '0'));
  config.push('POWER_OFF_ON_HALT=' + (data.POWER_OFF_ON_HALT === '1' ? '1' : '0'));

  // CONDITIONALLY SAVE - Only if not default
  
  // psu_max_current (default: 5000)
  if (data.PSU_MAX_CURRENT && data.PSU_MAX_CURRENT) {
    config.push('PSU_MAX_CURRENT=' + data.PSU_MAX_CURRENT);
  }

  // pcie_probe - CRITICAL for NVMe
  if (data.PCIE_PROBE === '1') {
    config.push('PCIE_PROBE=1');
  } else if (data.PCIE_PROBE === '0') {
    config.push('PCIE_PROBE=0');
  }
  // If undefined, omit (natural default)

  // uart_baud (default: 115200)
  if (data.UART_BAUD && data.UART_BAUD !== '115200') {
    config.push('UART_BAUD=' + data.UART_BAUD);
  }

  // usb_msd_discover_timeout (default: 20000)
  if (data.USB_MSD_DISCOVER_TIMEOUT && data.USB_MSD_DISCOVER_TIMEOUT !== '20000') {
    config.push('USB_MSD_DISCOVER_TIMEOUT=' + data.USB_MSD_DISCOVER_TIMEOUT);
  }

  // usb_msd_lun_timeout (default: 2000)
  if (data.USB_MSD_LUN_TIMEOUT && data.USB_MSD_LUN_TIMEOUT !== '2000') {
    config.push('USB_MSD_LUN_TIMEOUT=' + data.USB_MSD_LUN_TIMEOUT);
  }

  // usb_msd_pwr_off_time (default: 1000)
  if (data.USB_MSD_PWR_OFF_TIME !== undefined && data.USB_MSD_PWR_OFF_TIME !== '1000') {
    config.push('USB_MSD_PWR_OFF_TIME=' + data.USB_MSD_PWR_OFF_TIME);
  }

  // usb_msd_startup_delay (default: 0)
  if (data.USB_MSD_STARTUP_DELAY && data.USB_MSD_STARTUP_DELAY !== '0') {
    config.push('USB_MSD_STARTUP_DELAY=' + data.USB_MSD_STARTUP_DELAY);
  }

  // usb_msd_boot_max_retries (default: 1)
  if (data.USB_MSD_BOOT_MAX_RETRIES !== undefined && data.USB_MSD_BOOT_MAX_RETRIES !== '1') {
    config.push('USB_MSD_BOOT_MAX_RETRIES=' + data.USB_MSD_BOOT_MAX_RETRIES);
  }

  // sd_boot_max_retries (default: 3)
  if (data.SD_BOOT_MAX_RETRIES !== undefined && data.SD_BOOT_MAX_RETRIES !== '3') {
    config.push('SD_BOOT_MAX_RETRIES=' + data.SD_BOOT_MAX_RETRIES);
  }

  // enable_self_update (default: 1)
  if (data.ENABLE_SELF_UPDATE !== undefined && data.ENABLE_SELF_UPDATE !== '1') {
    config.push('ENABLE_SELF_UPDATE=' + data.ENABLE_SELF_UPDATE);
  }

  // freeze_version (default: 0)
  if (data.FREEZE_VERSION === '1') {
    config.push('FREEZE_VERSION=1');
  }

  // vl805 (default: empty)
  if (data.VL805 && data.VL805 !== '') {
    config.push('VL805=' + data.VL805);
  }

  // partition (default: 0)
  if (data.PARTITION !== undefined && data.PARTITION !== '0') {
    config.push('PARTITION=' + data.PARTITION);
  }

  // disable_hdmi (default: 0)
  if (data.DISABLE_HDMI === '1') {
    config.push('DISABLE_HDMI=1');
  }

  // hdmi_delay (default: 5)
  if (data.HDMI_DELAY !== undefined && data.HDMI_DELAY !== '5') {
    config.push('HDMI_DELAY=' + data.HDMI_DELAY);
  }

  // netconsole (default: empty)
  if (data.NETCONSOLE && data.NETCONSOLE !== '') {
    config.push('NETCONSOLE=' + data.NETCONSOLE);
  }

  // dhcp_timeout (default: 45000)
  if (data.DHCP_TIMEOUT && data.DHCP_TIMEOUT !== '45000') {
    config.push('DHCP_TIMEOUT=' + data.DHCP_TIMEOUT);
  }

  const finalConfig = config.join('\n') + '\n';
  
  self.logger.info('[RpiEepromConfig] Built config: ' + finalConfig);
  defer.resolve(finalConfig);
  return defer.promise;
};

RpiEepromConfig.prototype.applyEepromConfig = function(configText) {
  const self = this;
  const defer = libQ.defer();

  const tempFile = '/tmp/eeprom-config-temp.conf';

  try {
    // Write temporary config file
    fs.writeFileSync(tempFile, configText);
    self.logger.info('[RpiEepromConfig] Temp file written: ' + tempFile);
    self.logger.info('[RpiEepromConfig] Temp file contents: ' + fs.readFileSync(tempFile, 'utf8'));

    // Apply configuration using rpi-eeprom-config
    exec('sudo rpi-eeprom-config --apply ' + tempFile, { uid: 1000, gid: 1000 }, function(error, stdout, stderr) {
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        self.logger.error('[RpiEepromConfig] Failed to delete temp file: ' + e);
      }

      // Log output from rpi-eeprom-config
      if (stdout) {
        self.logger.info('[RpiEepromConfig] rpi-eeprom-config stdout: ' + stdout);
      }
      if (stderr) {
        self.logger.info('[RpiEepromConfig] rpi-eeprom-config stderr: ' + stderr);
      }

      if (error) {
        self.logger.error('[RpiEepromConfig] Failed to apply EEPROM config: ' + error);
        defer.reject(error);
        return;
      }

      self.logger.info('[RpiEepromConfig] EEPROM configuration applied successfully');
      defer.resolve();
    });
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to write temp config file: ' + error);
    defer.reject(error);
  }

  return defer.promise;
};

// Restore from Backup
RpiEepromConfig.prototype.restoreBackup = function(data) {
  const self = this;
  const defer = libQ.defer();

  if (!fs.existsSync(self.backupFile)) {
    self.logger.error('[RpiEepromConfig] No backup file found');
    self.commandRouter.pushToastMessage('error', 'No Backup Found', 'No backup configuration file exists.');
    defer.reject(new Error('No backup found'));
    return defer.promise;
  }

  self.logger.info('[RpiEepromConfig] Restoring EEPROM configuration from backup');

  try {
    const backupConfig = fs.readFileSync(self.backupFile, 'utf8');
    
    self.applyEepromConfig(backupConfig)
      .then(function() {
        self.logger.info('[RpiEepromConfig] Backup restored successfully');
        self.commandRouter.pushToastMessage('success', 'Backup Restored', 'EEPROM configuration restored from backup. System will reboot in 5 seconds...');
        
        setTimeout(function() {
          self.rebootSystem();
        }, 5000);
        
        defer.resolve();
      })
      .fail(function(error) {
        self.logger.error('[RpiEepromConfig] Failed to restore backup: ' + error);
        self.commandRouter.pushToastMessage('error', 'Restore Failed', 'Failed to restore backup: ' + error);
        defer.reject(error);
      });
  } catch (error) {
    self.logger.error('[RpiEepromConfig] Failed to read backup file: ' + error);
    self.commandRouter.pushToastMessage('error', 'Restore Failed', 'Failed to read backup file: ' + error);
    defer.reject(error);
  }

  return defer.promise;
};

// Restore Factory Defaults
RpiEepromConfig.prototype.restoreFactory = function(data) {
  const self = this;
  const defer = libQ.defer();

  self.logger.info('[RpiEepromConfig] Restoring factory default EEPROM configuration');

  // Get factory boot order from capabilities
  const factoryBootOrder = self.modelCapabilities.factory_boot_order || '0xf41';
  
  // Factory default configuration based on hardware
  const factoryConfig = [
    '[all]',
    'BOOT_UART=0',
    'WAKE_ON_GPIO=1',
    'POWER_OFF_ON_HALT=0',
    'BOOT_ORDER=' + factoryBootOrder
  ];

  // Add PCIE_PROBE for NVMe-capable devices
  if (self.modelCapabilities.boot_modes.includes('nvme')) {
    factoryConfig.push('PCIE_PROBE=1');
  }

  const factoryConfigText = factoryConfig.join('\n');

  self.applyEepromConfig(factoryConfigText)
    .then(function() {
      self.logger.info('[RpiEepromConfig] Factory defaults restored successfully');
      self.commandRouter.pushToastMessage('success', 'Factory Defaults Restored', 'EEPROM configuration reset to factory defaults. System will reboot in 5 seconds...');
      
      setTimeout(function() {
        self.rebootSystem();
      }, 5000);
      
      defer.resolve();
    })
    .fail(function(error) {
      self.logger.error('[RpiEepromConfig] Failed to restore factory defaults: ' + error);
      self.commandRouter.pushToastMessage('error', 'Restore Failed', 'Failed to restore factory defaults: ' + error);
      defer.reject(error);
    });

  return defer.promise;
};

// System Reboot
RpiEepromConfig.prototype.rebootSystem = function() {
  const self = this;
  self.logger.info('[RpiEepromConfig] Rebooting system');
  
  exec('sudo /sbin/reboot', { uid: 1000, gid: 1000 }, function(error, stdout, stderr) {
    if (error) {
      self.logger.error('[RpiEepromConfig] Failed to reboot: ' + error);
    }
  });
};
