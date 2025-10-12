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

  exec('vcgencmd bootloader_config', { uid: 1000, gid: 1000 }, function(error, stdout, stderr) {
    if (error) {
      self.logger.error('[RpiEepromConfig] Error reading EEPROM config: ' + error);
      defer.reject(error);
      return;
    }

    const config = self.parseEepromConfig(stdout);
    defer.resolve(config);
  });

  return defer.promise;
};

RpiEepromConfig.prototype.parseEepromConfig = function(configText) {
  const self = this;
  const config = {};
  
  const lines = configText.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      config[key] = value;
    }
  }

  return config;
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

    // PSU Max Current (Pi 5+ only)
    const psuCurrentIndex = basicSection.findIndex(function(item) {
      return item.id === 'psu_max_current';
    });
    if (psuCurrentIndex !== -1) {
      basicSection[psuCurrentIndex].value = parseInt(currentConfig.PSU_MAX_CURRENT || '5000', 10);
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
      psu_max_current: data.psu_max_current,
      power_off_on_halt: data.power_off_on_halt,
      wake_on_gpio: data.wake_on_gpio,
      pcie_probe: data.pcie_probe,
      boot_uart: data.boot_uart,
      uart_baud: (typeof data.uart_baud === 'object' && data.uart_baud.value) ? data.uart_baud.value : data.uart_baud
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

  // Factory defaults based on hardware capabilities
  const factoryBootOrder = self.modelCapabilities.factory_boot_order || '0xf41';
  const hasNvme = self.modelCapabilities.boot_modes.includes('nvme');

  const defaults = {
    // Basic settings defaults
    boot_order: { value: factoryBootOrder, label: 'Factory Default' },
    psu_max_current: 5000,
    power_off_on_halt: false,
    wake_on_gpio: true,
    pcie_probe: hasNvme ? true : false,
    boot_uart: false,
    uart_baud: { value: 115200, label: '115200' },
    
    // Advanced settings defaults
    usb_msd_discover_timeout: 20000,
    usb_msd_lun_timeout: 2000,
    usb_msd_pwr_off_time: 1000,
    usb_msd_startup_delay: 0,
    usb_msd_boot_max_retries: 1,
    sd_boot_max_retries: 3,
    enable_self_update: true,
    freeze_version: false,
    vl805: '',
    partition: 0,
    
    // Debug settings defaults
    disable_hdmi: false,
    hdmi_delay: 5,
    netconsole: '',
    dhcp_timeout: 45000
  };

  // Merge: tempBasic overrides defaults, tempAdvanced overrides, tempDebug overrides
  const merged = Object.assign({}, defaults, tempBasic, tempAdvanced, tempDebug);

  return merged;
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

  const config = [];
  config.push('[all]');

  // ALWAYS SAVE these parameters (even if default)
  
  // boot_order - handle both object and string
  if (data.boot_order) {
    const bootOrderValue = (typeof data.boot_order === 'object' && data.boot_order.value) ? data.boot_order.value : data.boot_order;
    config.push('BOOT_ORDER=' + bootOrderValue);
  } else {
    config.push('BOOT_ORDER=0xf41');
  }
  
  config.push('BOOT_UART=' + (data.boot_uart ? '1' : '0'));
  config.push('WAKE_ON_GPIO=' + (data.wake_on_gpio ? '1' : '0'));
  config.push('POWER_OFF_ON_HALT=' + (data.power_off_on_halt ? '1' : '0'));

  // CONDITIONALLY SAVE - Only if not default
  
  // psu_max_current (default: 5000)
  if (data.psu_max_current && data.psu_max_current !== 5000) {
    config.push('PSU_MAX_CURRENT=' + data.psu_max_current);
  }

  // pcie_probe (default: 1)
  if (data.pcie_probe !== undefined && data.pcie_probe !== true) {
    config.push('PCIE_PROBE=' + (data.pcie_probe ? '1' : '0'));
  }

  // uart_baud (default: 115200)
  if (data.uart_baud) {
    const baudValue = (typeof data.uart_baud === 'object' && data.uart_baud.value) ? data.uart_baud.value : data.uart_baud;
    if (baudValue !== 115200) {
      config.push('UART_BAUD=' + baudValue);
    }
  }

  // usb_msd_discover_timeout (default: 20000)
  if (data.usb_msd_discover_timeout && data.usb_msd_discover_timeout !== 20000) {
    config.push('USB_MSD_DISCOVER_TIMEOUT=' + data.usb_msd_discover_timeout);
  }

  // usb_msd_lun_timeout (default: 2000)
  if (data.usb_msd_lun_timeout && data.usb_msd_lun_timeout !== 2000) {
    config.push('USB_MSD_LUN_TIMEOUT=' + data.usb_msd_lun_timeout);
  }

  // usb_msd_pwr_off_time (default: 1000)
  if (data.usb_msd_pwr_off_time !== undefined && data.usb_msd_pwr_off_time !== 1000) {
    config.push('USB_MSD_PWR_OFF_TIME=' + data.usb_msd_pwr_off_time);
  }

  // usb_msd_startup_delay (default: 0)
  if (data.usb_msd_startup_delay && data.usb_msd_startup_delay !== 0) {
    config.push('USB_MSD_STARTUP_DELAY=' + data.usb_msd_startup_delay);
  }

  // usb_msd_boot_max_retries (default: 1)
  if (data.usb_msd_boot_max_retries !== undefined && data.usb_msd_boot_max_retries !== 1) {
    config.push('USB_MSD_BOOT_MAX_RETRIES=' + data.usb_msd_boot_max_retries);
  }

  // sd_boot_max_retries (default: 3)
  if (data.sd_boot_max_retries !== undefined && data.sd_boot_max_retries !== 3) {
    config.push('SD_BOOT_MAX_RETRIES=' + data.sd_boot_max_retries);
  }

  // enable_self_update (default: 1)
  if (data.enable_self_update !== undefined && data.enable_self_update !== true) {
    config.push('ENABLE_SELF_UPDATE=' + (data.enable_self_update ? '1' : '0'));
  }

  // freeze_version (default: 0)
  if (data.freeze_version) {
    config.push('FREEZE_VERSION=1');
  }

  // vl805 (default: empty)
  if (data.vl805 && data.vl805 !== '') {
    config.push('VL805=' + data.vl805);
  }

  // partition (default: 0)
  if (data.partition !== undefined && data.partition !== 0) {
    config.push('PARTITION=' + data.partition);
  }

  // disable_hdmi (default: 0)
  if (data.disable_hdmi) {
    config.push('DISABLE_HDMI=1');
  }

  // hdmi_delay (default: 5)
  if (data.hdmi_delay !== undefined && data.hdmi_delay !== 5) {
    config.push('HDMI_DELAY=' + data.hdmi_delay);
  }

  // netconsole (default: empty)
  if (data.netconsole && data.netconsole !== '') {
    config.push('NETCONSOLE=' + data.netconsole);
  }

  // dhcp_timeout (default: 45000)
  if (data.dhcp_timeout && data.dhcp_timeout !== 45000) {
    config.push('DHCP_TIMEOUT=' + data.dhcp_timeout);
  }

  self.logger.info('[RpiEepromConfig] Built config: ' + config.join('\n'));
  defer.resolve(config.join('\n') + '\n');
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
