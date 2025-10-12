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
    
    // Check for CM4 update sentinel
    this.checkCM4Sentinel();
    
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

// Detect if running on Compute Module 4
RpiEepromUpdater.prototype.isCM4 = function() {
    try {
        const model = fs.readFileSync('/proc/device-tree/model', 'utf-8');
        return model.includes('Compute Module 4');
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] Failed to read device model: ' + error.message);
        return false;
    }
};

// Check and handle CM4 update sentinel
RpiEepromUpdater.prototype.checkCM4Sentinel = function() {
    const sentinelPath = '/data/plugins/system_controller/rpi_eeprom_updater/cm4_update_state.json';
    
    if (!fs.existsSync(sentinelPath)) {
        return; // No sentinel, normal startup
    }
    
    try {
        const sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf-8'));
        this.logger.info('[RpiEepromUpdater] CM4 sentinel found, state: ' + sentinel.state);
        
        if (sentinel.state === 'config_updated') {
            // First reboot after config update - now flash EEPROM
            this.logger.info('[RpiEepromUpdater] Running EEPROM update on CM4');
            
            if (sentinel.isDowngrade && sentinel.firmwareFile) {
                // Downgrade with specific firmware file
                execSync('sudo /usr/bin/rpi-eeprom-update -d -f "' + sentinel.firmwareFile + '"', { stdio: 'pipe' });
            } else {
                // Standard upgrade
                execSync('sudo /usr/bin/rpi-eeprom-update -a', { stdio: 'pipe' });
            }
            
            // Update sentinel state
            sentinel.state = 'eeprom_staged';
            fs.writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2));
            
            this.logger.info('[RpiEepromUpdater] EEPROM staged, rebooting for flash');
            
            // Reboot to apply EEPROM update
            setTimeout(() => {
                execSync('sudo /sbin/reboot');
            }, 3000);
            
        } else if (sentinel.state === 'eeprom_staged') {
            // Second reboot after EEPROM flash - restore configs
            this.logger.info('[RpiEepromUpdater] Restoring CM4 configs after EEPROM update');
            
            // Restore config.txt
            if (fs.existsSync(sentinel.backups.config_txt)) {
                execSync('sudo /bin/cp "' + sentinel.backups.config_txt + '" /boot/config.txt');
                fs.removeSync(sentinel.backups.config_txt);
                this.logger.info('[RpiEepromUpdater] Restored config.txt');
            }
            
            // Restore rpi-eeprom-update config
            if (fs.existsSync(sentinel.backups.eeprom_config)) {
                execSync('sudo /bin/cp "' + sentinel.backups.eeprom_config + '" /etc/default/rpi-eeprom-update');
                fs.removeSync(sentinel.backups.eeprom_config);
                this.logger.info('[RpiEepromUpdater] Restored rpi-eeprom-update config');
            }
            
            // Update sentinel state for final reboot
            sentinel.state = 'configs_restored';
            fs.writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2));
            
            this.logger.info('[RpiEepromUpdater] Configs restored, rebooting to load original config');
            
            // Third reboot to load restored config.txt
            setTimeout(() => {
                execSync('sudo /sbin/reboot');
            }, 3000);
            
        } else if (sentinel.state === 'configs_restored') {
            // Third reboot complete - cleanup and notify user
            this.logger.info('[RpiEepromUpdater] CM4 update process completed');
            
            const actionType = sentinel.isDowngrade ? 'downgrade' : 'update';
            
            // Delete sentinel
            fs.removeSync(sentinelPath);
            
            this.commandRouter.pushToastMessage(
                'success',
                'EEPROM Update Complete',
                'CM4 EEPROM ' + actionType + ' completed successfully'
            );
        }
    } catch (error) {
        this.logger.error('[RpiEepromUpdater] CM4 sentinel handling failed: ' + error.message);
        // Clean up sentinel on error
        fs.removeSync(sentinelPath);
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
        const tempConfig = 'FIRMWARE_RELEASE_STATUS="' + channel + '"\n';
        const tempConfigPath = '/tmp/rpi-eeprom-channel-test-' + channel;
        fs.writeFileSync(tempConfigPath, tempConfig);
        
        let output = '';
        
        try {
            // Run rpi-eeprom-update to get the actual firmware info for this channel
            output = execSync(
                'BOOTFS=/boot/firmware bash -c "source ' + tempConfigPath + ' && /usr/bin/rpi-eeprom-update"',
                { encoding: 'utf-8', stdio: 'pipe' }
            );
        } catch (error) {
            // rpi-eeprom-update returns non-zero exit code when update is available
            // But still provides valid output in stdout
            if (error.stdout) {
                output = error.stdout;
                this.logger.info('[RpiEepromUpdater] Got output from ' + channel + ' channel (non-zero exit)');
            } else {
                throw error;
            }
        }
        
        fs.removeSync(tempConfigPath);
        
        if (!output) {
            this.logger.error('[RpiEepromUpdater] No output received for channel: ' + channel);
            return null;
        }
        
        // Parse the output to get LATEST timestamp and RELEASE path
        const lines = output.trim().split('\n');
        let timestamp = null;
        let dateString = null;
        let releasePath = null;
        
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
                // Extract path from line like "   RELEASE: latest (/usr/lib/firmware/raspberrypi/bootloader-2712/latest)"
                const pathMatch = line.match(/\((.+)\)/);
                if (pathMatch) {
                    releasePath = pathMatch[1].trim();
                }
            }
        });
        
        if (!timestamp) {
            this.logger.error('[RpiEepromUpdater] Could not parse timestamp for channel: ' + channel);
            this.logger.error('[RpiEepromUpdater] Output was: ' + output.substring(0, 200));
            return null;
        }
        
        this.logger.info('[RpiEepromUpdater] Channel ' + channel + ' version: ' + dateString + ' (' + timestamp + ')');
        
        return {
            path: releasePath,
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
    const self = this;
    
    try {
        // Check if CM4
        if (self.isCM4()) {
            const currentChannel = self.getCurrentChannel();
            return self.performCM4Update(currentChannel);
        }
        
        // Standard update for non-CM4 hardware
        self.logger.info('[RpiEepromUpdater] Starting EEPROM update...');
        
        self.commandRouter.pushToastMessage(
            'info',
            'EEPROM Update',
            'Starting firmware update. Please do not power off the system.'
        );
        
        // Execute update with automatic flag using sudo
        try {
            execSync('sudo /usr/bin/rpi-eeprom-update -a', { stdio: 'pipe' });
        } catch (error) {
            // rpi-eeprom-update may return non-zero exit code even on success
            // Check if it's actually an error or just a warning
            if (error.stderr && error.stderr.toString().includes('failed')) {
                throw error;
            }
            // Otherwise continue - update was staged successfully
            self.logger.info('[RpiEepromUpdater] Update command returned non-zero but appears successful');
        }
        
        self.logger.info('[RpiEepromUpdater] Update staged successfully');
        
        self.commandRouter.pushToastMessage(
            'success',
            'EEPROM Update',
            'Firmware update prepared. System will reboot in 5 seconds.'
        );
        
        // Schedule reboot
        setTimeout(() => {
            self.logger.info('[RpiEepromUpdater] Rebooting system for EEPROM update');
            execSync('sudo /sbin/reboot');
        }, 5000);
        
        defer.resolve();
    } catch (error) {
        self.logger.error('[RpiEepromUpdater] Update failed: ' + error.message);
        
        self.commandRouter.pushToastMessage(
            'error',
            'EEPROM Update Failed',
            'Failed to perform update: ' + error.message
        );
        
        defer.reject(error);
    }
    
    return defer.promise;
};

// Perform CM4-specific update with config backup/restore cycle
RpiEepromUpdater.prototype.performCM4Update = function(channel) {
    const defer = libQ.defer();
    const self = this;
    
    try {
        self.logger.info('[RpiEepromUpdater] Starting CM4 EEPROM update process');
        
        const sentinelPath = '/data/plugins/system_controller/rpi_eeprom_updater/cm4_update_state.json';
        const configTxtBackup = '/boot/config.txt.rpi-eeprom-backup';
        const eepromConfigBackup = '/etc/default/rpi-eeprom-update.backup';
        
        // Backup config.txt
        execSync('sudo /bin/cp /boot/config.txt "' + configTxtBackup + '"');
        self.logger.info('[RpiEepromUpdater] Backed up config.txt');
        
        // Backup rpi-eeprom-update config
        execSync('sudo /bin/cp /etc/default/rpi-eeprom-update "' + eepromConfigBackup + '"');
        self.logger.info('[RpiEepromUpdater] Backed up rpi-eeprom-update config');
        
        // Read current configs
        let configTxt = fs.readFileSync('/boot/config.txt', 'utf-8');
        let eepromConfig = fs.readFileSync('/etc/default/rpi-eeprom-update', 'utf-8');
        
        // Add CM4-specific settings to config.txt if not present
        const cm4Section = '\n[cm4]\ndtparam=spi=on\ndtoverlay=audremap\ndtoverlay=spi-gpio40-45\n';
        if (!configTxt.includes('[cm4]')) {
            configTxt += cm4Section;
            fs.writeFileSync('/tmp/config.txt.tmp', configTxt);
            execSync('sudo /bin/cp /tmp/config.txt.tmp /boot/config.txt');
            fs.removeSync('/tmp/config.txt.tmp');
            self.logger.info('[RpiEepromUpdater] Added CM4 settings to config.txt');
        }
        
        // Add CM4-specific settings to rpi-eeprom-update config
        if (!eepromConfig.includes('RPI_EEPROM_USE_FLASHROM')) {
            eepromConfig += '\nRPI_EEPROM_USE_FLASHROM=1\n';
        }
        if (!eepromConfig.includes('CM4_ENABLE_RPI_EEPROM_UPDATE')) {
            eepromConfig += 'CM4_ENABLE_RPI_EEPROM_UPDATE=1\n';
        }
        
        // Update channel setting
        if (eepromConfig.match(/FIRMWARE_RELEASE_STATUS=.*/)) {
            eepromConfig = eepromConfig.replace(/FIRMWARE_RELEASE_STATUS=.*/, 'FIRMWARE_RELEASE_STATUS="' + channel + '"');
        } else {
            eepromConfig += 'FIRMWARE_RELEASE_STATUS="' + channel + '"\n';
        }
        
        fs.writeFileSync('/tmp/rpi-eeprom-update.tmp', eepromConfig);
        execSync('sudo /bin/cp /tmp/rpi-eeprom-update.tmp /etc/default/rpi-eeprom-update');
        fs.removeSync('/tmp/rpi-eeprom-update.tmp');
        self.logger.info('[RpiEepromUpdater] Updated rpi-eeprom-update config');
        
        // Create sentinel
        const sentinel = {
            state: 'config_updated',
            timestamp: Date.now(),
            channel: channel,
            backups: {
                config_txt: configTxtBackup,
                eeprom_config: eepromConfigBackup
            }
        };
        
        fs.writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2));
        self.logger.info('[RpiEepromUpdater] Created CM4 sentinel');
        
        self.commandRouter.pushToastMessage(
            'info',
            'CM4 EEPROM Update',
            'CM4 requires special handling. System will reboot three times. Please wait...'
        );
        
        // First reboot to load new config.txt settings
        setTimeout(() => {
            self.logger.info('[RpiEepromUpdater] Rebooting to load CM4 config');
            execSync('sudo /sbin/reboot');
        }, 5000);
        
        defer.resolve();
    } catch (error) {
        self.logger.error('[RpiEepromUpdater] CM4 update failed: ' + error.message);
        
        self.commandRouter.pushToastMessage(
            'error',
            'CM4 Update Failed',
            'Failed to prepare CM4 update: ' + error.message
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
            updateAvailable: false,
            downgradePath: null // Store path for downgrade
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
                status.downgradePath = channelVersion.path;
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
        
        // Get the firmware path for the current channel
        self.getFirmwareStatus()
            .then(function(status) {
                if (!status.downgradePath) {
                    self.logger.error('[RpiEepromUpdater] No downgrade path available');
                    self.commandRouter.pushToastMessage(
                        'error',
                        'Downgrade Failed',
                        'Could not determine firmware file path'
                    );
                    defer.reject(new Error('No downgrade path'));
                    return;
                }
                
                // Get the actual firmware file path from the channel directory
                const channelDir = status.downgradePath;
                let firmwareFile = null;
                
                try {
                    // List files in the channel directory
                    const files = fs.readdirSync(channelDir);
                    
                    // Find the pieeprom .bin file (not recovery.bin)
                    for (let i = 0; i < files.length; i++) {
                        if (files[i].startsWith('pieeprom-') && files[i].endsWith('.bin')) {
                            firmwareFile = path.join(channelDir, files[i]);
                            break;
                        }
                    }
                } catch (error) {
                    self.logger.error('[RpiEepromUpdater] Failed to read channel directory: ' + error.message);
                }
                
                if (!firmwareFile || !fs.existsSync(firmwareFile)) {
                    self.logger.error('[RpiEepromUpdater] Firmware file not found in: ' + channelDir);
                    self.commandRouter.pushToastMessage(
                        'error',
                        'Downgrade Failed',
                        'Firmware file not found'
                    );
                    defer.reject(new Error('Firmware file not found'));
                    return;
                }
                
                self.logger.info('[RpiEepromUpdater] Using firmware file: ' + firmwareFile);
                
                // Check if CM4
                if (self.isCM4()) {
                    const currentChannel = self.getCurrentChannel();
                    return self.performCM4Downgrade(currentChannel, firmwareFile);
                }
                
                // Standard downgrade for non-CM4 hardware
                self.commandRouter.pushToastMessage(
                    'info',
                    'EEPROM Downgrade',
                    'Starting firmware downgrade. Please do not power off the system.'
                );
                
                // Execute downgrade with -d (downgrade) and -f (firmware file) flags
                try {
                    execSync('sudo /usr/bin/rpi-eeprom-update -d -f "' + firmwareFile + '"', { stdio: 'pipe' });
                } catch (error) {
                    // rpi-eeprom-update may return non-zero exit code even on success
                    // Check if it's actually an error or just a warning
                    if (error.stderr && error.stderr.toString().includes('failed')) {
                        throw error;
                    }
                    // Otherwise continue - downgrade was staged successfully
                    self.logger.info('[RpiEepromUpdater] Downgrade command returned non-zero but appears successful');
                }
                
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
            })
            .fail(function(error) {
                self.logger.error('[RpiEepromUpdater] Failed to get firmware status: ' + error);
                defer.reject(error);
            });
        
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

// Perform CM4-specific downgrade
RpiEepromUpdater.prototype.performCM4Downgrade = function(channel, firmwareFile) {
    const defer = libQ.defer();
    const self = this;
    
    try {
        self.logger.info('[RpiEepromUpdater] Starting CM4 EEPROM downgrade process');
        
        const sentinelPath = '/data/plugins/system_controller/rpi_eeprom_updater/cm4_update_state.json';
        const configTxtBackup = '/boot/config.txt.rpi-eeprom-backup';
        const eepromConfigBackup = '/etc/default/rpi-eeprom-update.backup';
        
        // Backup config.txt
        execSync('sudo /bin/cp /boot/config.txt "' + configTxtBackup + '"');
        self.logger.info('[RpiEepromUpdater] Backed up config.txt');
        
        // Backup rpi-eeprom-update config
        execSync('sudo /bin/cp /etc/default/rpi-eeprom-update "' + eepromConfigBackup + '"');
        self.logger.info('[RpiEepromUpdater] Backed up rpi-eeprom-update config');
        
        // Read current configs
        let configTxt = fs.readFileSync('/boot/config.txt', 'utf-8');
        let eepromConfig = fs.readFileSync('/etc/default/rpi-eeprom-update', 'utf-8');
        
        // Add CM4-specific settings to config.txt if not present
        const cm4Section = '\n[cm4]\ndtparam=spi=on\ndtoverlay=audremap\ndtoverlay=spi-gpio40-45\n';
        if (!configTxt.includes('[cm4]')) {
            configTxt += cm4Section;
            fs.writeFileSync('/tmp/config.txt.tmp', configTxt);
            execSync('sudo /bin/cp /tmp/config.txt.tmp /boot/config.txt');
            fs.removeSync('/tmp/config.txt.tmp');
            self.logger.info('[RpiEepromUpdater] Added CM4 settings to config.txt');
        }
        
        // Add CM4-specific settings to rpi-eeprom-update config
        if (!eepromConfig.includes('RPI_EEPROM_USE_FLASHROM')) {
            eepromConfig += '\nRPI_EEPROM_USE_FLASHROM=1\n';
        }
        if (!eepromConfig.includes('CM4_ENABLE_RPI_EEPROM_UPDATE')) {
            eepromConfig += 'CM4_ENABLE_RPI_EEPROM_UPDATE=1\n';
        }
        
        // Update channel setting
        if (eepromConfig.match(/FIRMWARE_RELEASE_STATUS=.*/)) {
            eepromConfig = eepromConfig.replace(/FIRMWARE_RELEASE_STATUS=.*/, 'FIRMWARE_RELEASE_STATUS="' + channel + '"');
        } else {
            eepromConfig += 'FIRMWARE_RELEASE_STATUS="' + channel + '"\n';
        }
        
        fs.writeFileSync('/tmp/rpi-eeprom-update.tmp', eepromConfig);
        execSync('sudo /bin/cp /tmp/rpi-eeprom-update.tmp /etc/default/rpi-eeprom-update');
        fs.removeSync('/tmp/rpi-eeprom-update.tmp');
        self.logger.info('[RpiEepromUpdater] Updated rpi-eeprom-update config');
        
        // Create sentinel with firmware file for downgrade
        const sentinel = {
            state: 'config_updated',
            timestamp: Date.now(),
            channel: channel,
            isDowngrade: true,
            firmwareFile: firmwareFile,
            backups: {
                config_txt: configTxtBackup,
                eeprom_config: eepromConfigBackup
            }
        };
        
        fs.writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2));
        self.logger.info('[RpiEepromUpdater] Created CM4 downgrade sentinel');
        
        self.commandRouter.pushToastMessage(
            'info',
            'CM4 EEPROM Downgrade',
            'CM4 requires special handling. System will reboot three times. Please wait...'
        );
        
        // First reboot to load new config.txt settings
        setTimeout(() => {
            self.logger.info('[RpiEepromUpdater] Rebooting to load CM4 config');
            execSync('sudo /sbin/reboot');
        }, 5000);
        
        defer.resolve();
    } catch (error) {
        self.logger.error('[RpiEepromUpdater] CM4 downgrade failed: ' + error.message);
        
        self.commandRouter.pushToastMessage(
            'error',
            'CM4 Downgrade Failed',
            'Failed to prepare CM4 downgrade: ' + error.message
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
