'use strict';

const libQ = require('kew');
const fs = require('fs-extra');
const { execSync, exec } = require('child_process');
const path = require('path');

module.exports = RpiEepromUpdater;

function RpiEepromUpdater(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
}

RpiEepromUpdater.prototype.onVolumioStart = function() {
    const configFile = this.commandRouter.pluginManager.getConfigurationFile(
        this.context,
        'config.json'
    );
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

RpiEepromUpdater.prototype.onStart = function() {
    const defer = libQ.defer();
    
    // Check if hardware is supported
    if (!this.isHardwareSupported()) {
        this.logger.error('[RpiEepromUpdater] Unsupported hardware detected');
        this.commandRouter.pushToastMessage(
            'error',
            'EEPROM Updater',
            'This hardware does not support EEPROM updates'
        );
        defer.reject();
        return defer.promise;
    }
    
    this.logger.info('[RpiEepromUpdater] Plugin started successfully');
    defer.resolve();
    return defer.promise;
};

RpiEepromUpdater.prototype.onStop = function() {
    const defer = libQ.defer();
    this.logger.info('[RpiEepromUpdater] Plugin stopped');
    defer.resolve();
    return defer.promise;
};

RpiEepromUpdater.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

// Check if hardware supports EEPROM updates
RpiEepromUpdater.prototype.isHardwareSupported = function() {
    try {
        // Check if rpi-eeprom-update tool exists
        if (!fs.existsSync('/usr/bin/rpi-eeprom-update')) {
            this.logger.error('[RpiEepromUpdater] rpi-eeprom-update tool not found');
            return false;
        }
        
        // Try to get latest firmware path - if this works, hardware is supported
        execSync('/usr/bin/rpi-eeprom-update -l', { stdio: 'pipe' });
        return true;
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Hardware check failed: ' + error.message);
        return false;
    }
};

// Get current bootloader version information
RpiEepromUpdater.prototype.getCurrentVersion = function() {
    try {
        const output = execSync('vcgencmd bootloader_version', { 
            encoding: 'utf-8',
            stdio: 'pipe'
        });
        
        const lines = output.trim().split('\n');
        const versionInfo = {};
        
        lines.forEach(line => {
            if (line.includes('version')) {
                versionInfo.version = line.split('version ')[1];
            } else if (line.includes('timestamp')) {
                const timestamp = line.split('timestamp ')[1];
                versionInfo.timestamp = parseInt(timestamp, 10);
                versionInfo.date = new Date(versionInfo.timestamp * 1000).toISOString();
            } else if (line.includes('update-time')) {
                const updateTime = line.split('update-time ')[1];
                versionInfo.updateTime = parseInt(updateTime, 10);
            }
        });
        
        return versionInfo;
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Failed to get current version: ' + error.message);
        return null;
    }
};

// Get current firmware channel
RpiEepromUpdater.prototype.getCurrentChannel = function() {
    try {
        const configContent = fs.readFileSync('/etc/default/rpi-eeprom-update', 'utf-8');
        const match = configContent.match(/FIRMWARE_RELEASE_STATUS="(.+)"/);
        return match ? match[1] : 'default';
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Failed to read firmware channel: ' + error.message);
        return 'default';
    }
};

// Get available version for a specific channel
RpiEepromUpdater.prototype.getAvailableVersion = function(channel) {
    try {
        // Temporarily create config file for the channel
        const tempConfig = 'FIRMWARE_RELEASE_STATUS="' + channel + '"';
        const tempConfigPath = '/tmp/rpi-eeprom-channel-test-' + channel;
        fs.writeFileSync(tempConfigPath, tempConfig);
        
        // Run rpi-eeprom-update to get the actual firmware info for this channel
        const output = execSync(
            'BOOTFS=/boot/firmware bash -c "source ' + tempConfigPath + ' && /usr/bin/rpi-eeprom-update"',
            { encoding: 'utf-8', stdio: 'pipe' }
        );
        
        fs.removeSync(tempConfigPath);
        
        // Parse the output to get LATEST timestamp
        const lines = output.trim().split('\n');
        let timestamp = null;
        let dateString = null;
        let path = null;
        
        lines.forEach(line => {
            if (line.includes('LATEST:')) {
                // Extract timestamp from line like "   LATEST: Thu May  8 14:13:17 UTC 2025 (1746713597)"
                const timestampMatch = line.match(/\((\d+)\)/);
                if (timestampMatch) {
                    timestamp = parseInt(timestampMatch[1], 10);
                }
                // Extract date string
                const dateMatch = line.match(/LATEST:\s+(.+)\s+\(\d+\)/);
                if (dateMatch) {
                    dateString = dateMatch[1].trim();
                }
            } else if (line.includes('RELEASE:')) {
                // Extract path from line like "   RELEASE: default (/usr/lib/firmware/raspberrypi/bootloader-2712/default)"
                const pathMatch = line.match(/\((.+)\)/);
                if (pathMatch) {
                    path = pathMatch[1].trim();
                }
            }
        });
        
        if (!timestamp) {
            this.logger.error('[RpiEepromUpdater] Could not parse timestamp for channel: ' + channel);
            return null;
        }
        
        return {
            path: path,
            timestamp: timestamp,
            date: new Date(timestamp * 1000).toISOString(),
            dateString: dateString
        };
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Failed to get available version for ' + channel + ': ' + error.message);
        return null;
    }
};

// Switch firmware channel
RpiEepromUpdater.prototype.setFirmwareChannel = function(channel) {
    try {
        const configContent = 'FIRMWARE_RELEASE_STATUS="' + channel + '"';
        
        // Use sudo with tee to write to root-owned file
        // Use printf instead of echo to preserve quotes properly
        execSync('printf "%s\\n" \'' + configContent + '\' | sudo /usr/bin/tee /etc/default/rpi-eeprom-update > /dev/null', {
            stdio: 'pipe'
        });
        
        this.config.set('firmware_channel', channel);
        
        this.logger.info('[RpiEepromUpdater] Firmware channel set to: ' + channel);
        return true;
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Failed to set firmware channel: ' + error.message);
        return false;
    }
};

// Perform EEPROM update
RpiEepromUpdater.prototype.performUpdate = function() {
    const defer = libQ.defer();
    
    try {
        this.logger.info('[RpiEepromUpdater] Starting EEPROM update...');
        
        this.commandRouter.pushToastMessage(
            'info',
            'EEPROM Update',
            'Starting firmware update. Please do not power off the system.'
        );
        
        // Execute update with automatic flag using sudo
        execSync('sudo /usr/bin/rpi-eeprom-update -a', { stdio: 'pipe' });
        
        this.logger.info('[RpiEepromUpdater] Update staged successfully');
        
        this.commandRouter.pushToastMessage(
            'success',
            'EEPROM Update',
            'Firmware update prepared. System will reboot in 5 seconds.'
        );
        
        // Schedule reboot
        setTimeout(() => {
            this.logger.info('[RpiEepromUpdater] Rebooting system for EEPROM update');
            execSync('/usr/bin/sudo /sbin/reboot');
        }, 5000);
        
        defer.resolve();
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Update failed: ' + error.message);
        
        this.commandRouter.pushToastMessage(
            'error',
            'EEPROM Update Failed',
            'Failed to perform update: ' + error.message
        );
        
        defer.reject(error);
    }
    
    return defer.promise;
};

// Get firmware status for UI
RpiEepromUpdater.prototype.getFirmwareStatus = function() {
    const defer = libQ.defer();
    
    try {
        const currentVersion = this.getCurrentVersion();
        const currentChannel = this.getCurrentChannel();
        
        const defaultVersion = this.getAvailableVersion('default');
        const latestVersion = this.getAvailableVersion('latest');
        
        const status = {
            current: currentVersion,
            currentChannel: currentChannel,
            channels: {
                default: defaultVersion,
                latest: latestVersion
            },
            updateType: 'none', // 'upgrade', 'downgrade', or 'none'
            updateAvailable: false
        };
        
        // Check if update/downgrade is available for current channel
        const channelVersion = status.channels[currentChannel];
        
        if (channelVersion && currentVersion && channelVersion.timestamp) {
            if (channelVersion.timestamp > currentVersion.timestamp) {
                status.updateType = 'upgrade';
                status.updateAvailable = true;
            } else if (channelVersion.timestamp < currentVersion.timestamp) {
                status.updateType = 'downgrade';
                status.updateAvailable = true;
            }
            // If equal, updateType stays 'none'
        }
        
        defer.resolve(status);
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Failed to get firmware status: ' + error.message);
        defer.reject(error);
    }
    
    return defer.promise;
};

// UI Configuration
RpiEepromUpdater.prototype.getUIConfig = function() {
    const defer = libQ.defer();
    const self = this;
    
    const lang_code = this.commandRouter.sharedVars.get('language_code');
    
    self.commandRouter.i18nJson(
        path.join(__dirname, 'i18n', 'strings_' + lang_code + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json')
    )
    .then(function(uiconf) {
        // Get firmware status
        self.getFirmwareStatus()
            .then(function(status) {
                // Current version section (section 0)
                uiconf.sections[0].content[0].value = status.current ? 
                    status.current.date : 'Unknown';
                uiconf.sections[0].content[1].value = status.current ? 
                    status.current.version.substring(0, 12) + '...' : 'Unknown';
                
                // Channel selection (section 1)
                uiconf.sections[1].content[0].value.value = status.currentChannel;
                uiconf.sections[1].content[0].value.label = status.currentChannel;
                
                // Available version for selected channel only
                const channelVersion = status.channels[status.currentChannel];
                if (channelVersion) {
                    uiconf.sections[1].content[1].value = channelVersion.date || 'Not available';
                } else {
                    uiconf.sections[1].content[1].value = 'Not available';
                }
                
                // Upgrade section (section 2)
                if (status.updateType === 'upgrade') {
                    uiconf.sections[2].hidden = false;
                    uiconf.sections[2].content[0].hidden = false;
                    uiconf.sections[2].content[1].value = 
                        'An update is available on the ' + status.currentChannel + ' channel.';
                } else {
                    uiconf.sections[2].hidden = true;
                }
                
                // Downgrade section (section 3)
                if (status.updateType === 'downgrade') {
                    uiconf.sections[3].hidden = false;
                    uiconf.sections[3].content[1].value = 
                        'The ' + status.currentChannel + ' channel has an older firmware version. Downgrading may cause issues.';
                } else {
                    uiconf.sections[3].hidden = true;
                }
                
                // Up to date message (show in upgrade section if neither upgrade nor downgrade)
                if (status.updateType === 'none') {
                    uiconf.sections[2].hidden = false;
                    uiconf.sections[2].content[0].hidden = true;
                    uiconf.sections[2].content[1].value = 
                        'You are already on the latest firmware for the ' + status.currentChannel + ' channel.';
                }
                
                defer.resolve(uiconf);
            })
            .fail(function(error) {
                self.logger.error('[RpiEepromUpdater] Failed to get status for UI: ' + error);
                defer.resolve(uiconf);
            });
    })
    .fail(function(error) {
        defer.reject(new Error('Failed to load UI configuration: ' + error));
    });
    
    return defer.promise;
};

// Handle downgrade confirmation
RpiEepromUpdater.prototype.performDowngrade = function(data) {
    const defer = libQ.defer();
    const self = this;
    
    try {
        // Check if user confirmed understanding of risks
        if (!data || !data.downgrade_confirm || data.downgrade_confirm !== true) {
            self.logger.warn('[RpiEepromUpdater] Downgrade attempted without confirmation');
            self.commandRouter.pushToastMessage(
                'warning',
                'Confirmation Required',
                'Please confirm you understand the risks of downgrading firmware'
            );
            defer.reject(new Error('Downgrade not confirmed'));
            return defer.promise;
        }
        
        self.logger.info('[RpiEepromUpdater] Starting EEPROM downgrade...');
        
        self.commandRouter.pushToastMessage(
            'info',
            'EEPROM Downgrade',
            'Starting firmware downgrade. Please do not power off the system.'
        );
        
        // Execute downgrade with automatic flag using sudo (same as upgrade)
        execSync('sudo /usr/bin/rpi-eeprom-update -a', { stdio: 'pipe' });
        
        self.logger.info('[RpiEepromUpdater] Downgrade staged successfully');
        
        self.commandRouter.pushToastMessage(
            'success',
            'EEPROM Downgrade',
            'Firmware downgrade prepared. System will reboot in 5 seconds.'
        );
        
        // Schedule reboot
        setTimeout(() => {
            self.logger.info('[RpiEepromUpdater] Rebooting system for EEPROM downgrade');
            execSync('sudo /sbin/reboot');
        }, 5000);
        
        defer.resolve();
    } catch (error) {
        self.logger.error('[RpiEepromUpdater] Downgrade failed: ' + error.message);
        
        self.commandRouter.pushToastMessage(
            'error',
            'EEPROM Downgrade Failed',
            'Failed to perform downgrade: ' + error.message
        );
        
        defer.reject(error);
    }
    
    return defer.promise;
};

// Handle channel change
RpiEepromUpdater.prototype.saveChannelSettings = function(data) {
    const defer = libQ.defer();
    const self = this;
    
    try {
        self.logger.info('[RpiEepromUpdater] Saving channel settings');
        
        if (!data || !data.firmware_channel || !data.firmware_channel.value) {
            self.logger.error('[RpiEepromUpdater] Invalid data structure received');
            defer.reject(new Error('Invalid data'));
            return defer.promise;
        }
        
        const newChannel = data.firmware_channel.value;
        self.logger.info('[RpiEepromUpdater] Switching to channel: ' + newChannel);
        
        if (self.setFirmwareChannel(newChannel)) {
            self.commandRouter.pushToastMessage(
                'success',
                'Channel Changed',
                'Firmware channel set to: ' + newChannel
            );
            
            // Trigger UI refresh to show new available version
            self.logger.info('[RpiEepromUpdater] Triggering UI refresh');
            self.commandRouter.getUIConfigOnPlugin('system_controller', 'rpi_eeprom_updater', {})
                .then(function(config) {
                    self.commandRouter.broadcastMessage('pushUiConfig', config);
                    defer.resolve();
                })
                .fail(function(error) {
                    self.logger.error('[RpiEepromUpdater] Failed to refresh UI: ' + error);
                    // Still resolve since channel was changed successfully
                    defer.resolve();
                });
        } else {
            self.commandRouter.pushToastMessage(
                'error',
                'Channel Change Failed',
                'Failed to change firmware channel'
            );
            defer.reject(new Error('setFirmwareChannel failed'));
        }
    } catch (error) {
        self.logger.error('[RpiEepromUpdater] saveChannelSettings exception: ' + error.message);
        defer.reject(error);
    }
    
    return defer.promise;
};

// Handle update button click
RpiEepromUpdater.prototype.updateFirmware = function() {
    return this.performUpdate();
};

RpiEepromUpdater.prototype.setUIConfig = function(data) {
    // Volumio compatibility
};

RpiEepromUpdater.prototype.getConf = function(varName) {
    return this.config.get(varName);
};

RpiEepromUpdater.prototype.setConf = function(varName, varValue) {
    this.config.set(varName, varValue);
};
