//Systeminfo - balbuze October 2025
'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
const si = require('systeminformation');
const { getBuiltinModule } = require('process');

// Define the Systeminfo class
module.exports = Systeminfo;


function Systeminfo(context) {
    var self = this;
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.commandRouter.logger;
};

Systeminfo.prototype.onVolumioStart = function () {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

Systeminfo.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

Systeminfo.prototype.onStop = function () {
    var defer = libQ.defer();
    defer.resolve();
    return defer.promise;
};

Systeminfo.prototype.onStart = function () {
    var defer = libQ.defer();
    defer.resolve();
    return defer.promise;
};

Systeminfo.prototype.onRestart = function () {
    // No specific actions needed on restart for this plugin
};

Systeminfo.prototype.onInstall = function () {
    // Perform installation tasks here
};

Systeminfo.prototype.onUninstall = function () {
    // Perform uninstallation tasks here
};

Systeminfo.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var lang_code = this.commandRouter.sharedVars.get('language_code');

    this.commandRouter.i18nJson(__dirname + '/i1n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function (uiconf) {
            defer.resolve(uiconf);
        })
        .fail(function () {
            defer.reject(new Error());
        });

    return defer.promise;
};

Systeminfo.prototype.setUIConfig = function (data) {
    // No specific actions needed for setting UI config
};

Systeminfo.prototype.getConf = function (varName) {
    // No specific actions needed for getting config
};

Systeminfo.prototype.setConf = function (varName, varValue) {
    // No specific actions needed for setting config
};

Systeminfo.prototype.getBluetoothVersion = async function () {
    const self = this;
    const logger = self.logger;
    try {
        // Try multiple methods to detect Bluetooth version
        const methods = [
            // Method 1: Try hciconfig
            async () => {
                const { stdout } = await new Promise((resolve, reject) => {
                    exec('hciconfig -a | grep "HCI Ver"', (error, stdout) => {
                        if (error) reject(error);
                        else resolve({ stdout });
                    });
                });
                const match = stdout.match(/HCI Ver[^0-9]*([0-9]+\.[0-9]+)/);
                if (match) return match[1];
                throw new Error('Version not found in hciconfig');
            },
            // Method 2: Try bluetoothctl
            async () => {
                const { stdout } = await new Promise((resolve, reject) => {
                    exec('bluetoothctl --version', (error, stdout) => {
                        if (error) reject(error);
                        else resolve({ stdout });
                    });
                });
                const match = stdout.match(/([0-9]+\.[0-9]+)/);
                if (match) return match[1];
                throw new Error('Version not found in bluetoothctl');
            }
        ];

        for (const method of methods) {
            try {
                const version = await method();
                return version;
            } catch (e) {
                logger.debug('Bluetooth detection method failed:', e.message);
                continue;
            }
        }

        return 'Not detected';
    } catch (error) {
        logger.warn('Bluetooth version detection failed:', error.message);
        return 'Not available';
    }
};

Systeminfo.prototype.getAirPlayVersion = async function () {
    const self = this;
    const logger = self.logger;
    try {
        // Try to get shairport-sync version
        const { stdout } = await new Promise((resolve, reject) => {
            exec('shairport-sync -V 2>/dev/null || dpkg-query -W -f=\'${Version}\' shairport-sync', (error, stdout) => {
                if (error) reject(error);
                else resolve({ stdout });
            });
        });

        const version = stdout.trim();
        if (version) {
            // Extract AirPlay version from shairport-sync version
            if (version.includes('2.')) {
                return 'AirPlay 1';
            } else if (version.includes('3.')) {
                return 'AirPlay 2';
            }
            return `AirPlay (${version})`;
        }
        return 'Not installed';
    } catch (error) {
        logger.warn('AirPlay version detection failed:', error.message);
        return 'Not available';
    }
};

Systeminfo.prototype.getBoardInfo = async function () {
    const self = this;
    const logger = self.logger;
    try {
        // Try /proc/board_info first (for Tinker Board and similar)
        try {
            const { stdout: boardInfoRaw } = await new Promise((resolve, reject) => {
                exec('cat /proc/board_info 2>/dev/null', (error, stdout) => {
                    if (error) reject(error);
                    else resolve({ stdout });
                });
            });
            if (boardInfoRaw) {
                const boardInfo = boardInfoRaw.trim();
                if (boardInfo.toLowerCase().includes('tinker board')) {
                    return {
                        manufacturer: 'ASUS',
                        model: boardInfo
                    };
                }
                // Add more board checks here if needed
            }
        } catch (e) {
            logger.debug('/proc/board_info read failed:', e.message);
        }
        // Try device tree model first
        try {
            const { stdout: dtModel } = await new Promise((resolve, reject) => {
                exec('cat /proc/device-tree/model 2>/dev/null', (error, stdout) => {
                    if (error) reject(error);
                    else resolve({ stdout });
                });
            });

            if (dtModel) {
                const model = dtModel.trim();
                // Check for various boards
                if (model.toLowerCase().includes('tinker board')) {
                    return {
                        manufacturer: 'ASUS',
                        model: 'Tinker Board'
                    };
                } else if (model.includes('Raspberry Pi')) {
                    return {
                        manufacturer: 'Raspberry Pi Foundation',
                        model: model
                    };
                } else if (model.includes('Khadas')) {
                    return {
                        manufacturer: 'Khadas',
                        model: model
                    };
                } else if (model.includes('Hardkernel ODROID-N2')) {
                    return {
                        manufacturer: 'Hardkernel',
                        model: model
                    };
                } else if (model.includes('Hardkernel ODROID-M1S')) {
                    return {
                        manufacturer: 'Hardkernel',
                        model: model
                    };

                }
            }
        } catch (e) {
            logger.debug('Device tree model read failed:', e.message);
        }

        // Try DMI for x86 systems
        try {
            const [manufacturer, productName] = await Promise.all([
                new Promise((resolve) => {
                    exec('cat /sys/class/dmi/id/sys_vendor 2>/dev/null', (error, stdout) => {
                        resolve(error ? '' : stdout.trim());
                    });
                }),
                new Promise((resolve) => {
                    exec('cat /sys/class/dmi/id/product_name 2>/dev/null', (error, stdout) => {
                        resolve(error ? '' : stdout.trim());
                    });
                })
            ]);

            // Only use DMI info for x86 boards (not ARM, not unknown)
            if (
                productName &&
                productName !== '' &&
                !/arm|unknown|generic|raspberry|tinker|khadas/i.test(productName)
            ) {
                return {
                    manufacturer: manufacturer || 'Generic',
                    model: productName
                };
            }
        } catch (e) {
            logger.debug('DMI info read failed:', e.message);
        }

        // Fallback to cpuinfo
        const { stdout: cpuinfo } = await new Promise((resolve, reject) => {
            exec("grep -E '^(Hardware|model name|vendor_id)' /proc/cpuinfo | head -n1", (error, stdout) => {
                if (error) reject(error);
                else resolve({ stdout });
            });
        });

        if (cpuinfo) {
            const line = cpuinfo.trim();
            if (line.includes('Hardware')) {
                const hardware = line.split(':')[1].trim();
                // Check for known ARM platforms
                const hardwareLower = hardware.toLowerCase();
                if (hardwareLower.includes('tinker') || hardwareLower.includes('rockchip')) {
                    return {
                        manufacturer: 'ASUS',
                        model: 'Tinker Board'
                    };
                } else if (hardware.includes('AMLOGIC')) {
                    return {
                        manufacturer: 'Khadas',
                        model: 'VIM Series (Amlogic)'
                    };
                }
            } else if (line.includes('model name') || line.includes('vendor_id')) {
                // x86 system
                return {
                    manufacturer: 'Generic',
                    model: 'x86 System'
                };
            }
        }

        return {
            manufacturer: 'Unknown',
            model: 'Unknown System'
        };

    } catch (error) {
        logger.warn('Board detection failed:', error.message);
        return {
            manufacturer: 'Error',
            model: 'Detection Failed'
        };
    }
};

Systeminfo.prototype.getFirmwareInfo = async function () {
    const self = this;

    try {
        // Get board model
        const { stdout: modelOutput } = await new Promise((resolve, reject) => {
            exec('cat /proc/device-tree/model', (error, stdout) => {
                if (error) {
                    reject(new Error('Board model detection failed: ' + error.message));
                }
                resolve({ stdout });
            });
        });
        const model = modelOutput.trim().toLowerCase();

        // Select appropriate command based on model
        let cmd = '';
        if (model.includes('raspberry pi 4') || model.includes('raspberry pi 5') || model.includes('compute module')) {
            cmd = 'echo volumio | sudo -S vcgencmd bootloader_version';
        } else if (model.includes('odroid')) {

            cmd = `echo volumio | sudo -S /bin/bash -c 'for dev in /dev/mmcblk*; do dd if="$dev" bs=1M count=1 2>/dev/null | strings | grep -m1 -E "^U-Boot( SPL)? [0-9]+\\.[0-9]+" && break; done'`;
        } else if (model.includes('khadas')) {
            cmd = `/bin/echo volumio | /usr/bin/sudo -S strings -n 8 /dev/mmcblk0 2>/dev/null | grep -m1 -i 'U-Boot' || true`;
        } else {
            cmd = 'echo volumio | sudo -S vcgencmd version';
        }

        // Execute command
        const { stdout: cmdOutput, stderr } = await new Promise((resolve, reject) => {
            exec(cmd, { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error('Firmware detection failed: ' + error.message));
                } else {
                    if (stderr) {
                        self.logger.info('Firmware detection stderr: ' + stderr);
                    }
                    resolve({ stdout, stderr });
                }
            });
        });

        const outputLines = cmdOutput.trim().split('\n');
        //   console.log('------------outputLines: ', outputLines);

        // For bootloader_version, combine date and hash into one line
        try {
            if (cmd.includes('bootloader_version') && outputLines.length >= 2) {
                const date = outputLines[0]?.trim() || '';
                const versionMatch = outputLines[1]?.match(/version\s+([^\s]+)/);
                const version = versionMatch ? versionMatch[1] : '';
                if (date && version) return `${date} (${version})`;
            } else if (cmd.includes('U-Boot') && outputLines.length >= 1) {
                const versionLine = outputLines.find(line =>
                    line.startsWith('U-Boot') &&
                    !line.includes('=') &&
                    /^U-Boot( SPL)? [0-9]+\.[0-9]+/.test(line)
                );
                if (versionLine) {
                    const match = versionLine.match(/^U-Boot(?: SPL)? ([^\s]+)/);
                    if (match) return `U-Boot ${match[1]}`;
                }
            }

            // Fallback: return all lines joined
            return outputLines.join(' ').trim().replace(/^%+\s*/, '') || 'Not applicable or failed';
        } catch (error) {
            self.logger.info('Firmware detection is not applicable or failed: ' + error.message);
            return 'Not applicable or failed';
        }

    } catch (error) {
        self.logger.info('Firmware detection outer try failed: ' + error.message);
        return 'Not applicable or failed';
    }
};

Systeminfo.prototype.getHwAudioInfo = async function (outputDevice) {
    const self = this;
    try {
        const cmd = `/data/plugins/user_interface/Systeminfo/hw_params hw:${outputDevice}`;
        const { stdout } = await new Promise((resolve, reject) => {
            exec(cmd, { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error('Audio hardware detection failed: ' + error.message));
                } else {
                    resolve({ stdout });
                }
            });
        });
        const hwInfo = JSON.parse(stdout);
        return {
            channels: hwInfo.channels.value,
            samplerates: hwInfo.samplerates.value
        };
    } catch (error) {
        self.logger.error('Audio hardware detection failed, check if "hw_params" exists and is executable:', error.message);
        return {
            channels: 'N/A',
            samplerates: 'N/A'
        };
    }
};

Systeminfo.prototype.getStorageInfo = async function () {
    const self = this;
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            // Use df with -BM to get output in megabytes
            exec("/bin/df -BM /data | /usr/bin/tail -1", (error, stdout) => {
                if (error) {
                    reject(new Error('Storage detection failed: ' + error.message));
                }
                resolve({ stdout });
            });
        });

        const [filesystem, size, used, avail, pcent_with_percent_sign, mount] = stdout.trim().replace(/\s+/g, ' ').split(' ');

        const sizeCleaned = size ? size.replace('M', '') : 'N/A';
        const usedCleaned = used ? used.replace('M', '') : 'N/A';
        const availCleaned = avail ? avail.replace('M', '') : 'N/A';

        let pcent = 'N/A';
        if (sizeCleaned !== 'N/A' && availCleaned !== 'N/A') {
            const total = parseInt(sizeCleaned, 10);
            const available = parseInt(availCleaned, 10);
            if (total > 0) {
                pcent = Math.round((available / total) * 100);
            }
        }

        return {
            size: sizeCleaned,
            used: usedCleaned,
            avail: availCleaned,
            pcent: pcent
        };
    } catch (error) {
        return {
            size: 'N/A',
            used: 'N/A',
            avail: 'N/A',
            pcent: 'N/A'
        };
    }
};

Systeminfo.prototype.getRaspberryPiInfo = async function () {
    const self = this;
    const logger = self.logger;
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            exec('cat /proc/device-tree/model', (error, stdout) => {
                if (error) {
                    reject(new Error('Raspberry Pi model detection failed: ' + error.message));
                }
                resolve({ stdout });
            });
        });
        const model = stdout.trim();
        if (model.includes('Raspberry Pi')) {
            return {
                manufacturer: 'Raspberry Pi Foundation',
                model: model,
            };
        }
        return {
            manufacturer: 'N/A',
            model: 'N/A',
        };
    } catch (error) {
        logger.warn('Failed to get Raspberry Pi model:', error.message);
        return {
            manufacturer: 'N/A',
            model: 'N/A',
        };
    }
};

Systeminfo.prototype.getCpuModelName = async function () {
    const self = this;
    try {
        // First try /proc/cpuinfo for ARM/embedded boards
        const { stdout: cpuinfoLine } = await new Promise((resolve) => {
            exec("grep -E '^(model name|Hardware)\\s*:' /proc/cpuinfo | head -n1 || true", (err, stdout) => {
                resolve({ stdout: err ? '' : stdout });
            });
        });
        if (cpuinfoLine) {
            const m = cpuinfoLine.match(/:\s*(.+)/);
            if (m && m[1]) {
                const candidate = m[1].trim();
                // filter out known non-CPU strings (package/service names)
                if (!/\b(upmpdcli|gmediarender|rygel)\b/i.test(candidate)) {
                    return candidate;
                }
            }
        }

        // Fallback to lscpu
        const { stdout } = await new Promise((resolve) => {
            exec("lscpu | grep 'Model name' || true", (error, stdout) => {
                resolve({ stdout: error ? '' : stdout });
            });
        });
        const match = stdout.match(/Model name:\s*(.+)/);
        if (match && match[1]) {
            const candidate = match[1].trim();
            if (!/\b(upmpdcli|gmediarender|rygel)\b/i.test(candidate)) return candidate;
        }

        return 'N/A';
    } catch (error) {
        return 'N/A';
    }
};

Systeminfo.prototype.formatUptime = function (uptime) {
    const days = Math.floor(uptime / (3600 * 24));
    const hours = Math.floor((uptime % (3600 * 24)) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    return `${days} days, ${hours} Hrs, ${minutes} Minutes, ${seconds} Seconds`;
};

Systeminfo.prototype.getBogoMIPS = async function () {
    const self = this;
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            exec("grep -m1 'BogoMIPS' /proc/cpuinfo", (error, stdout) => {
                if (error) {
                    reject(new Error('BogoMIPS grep failed: ' + error.message));
                }
                resolve({ stdout });
            });
        });
        const match = stdout.match(/BogoMIPS\s+:\s(.+)/);
        return match ? match[1].trim() : 'N/A';
    } catch (error) {
        return 'N/A';
    }
};

// Simplified UPnP renderer detection: prefer dpkg-query for package versions,
// then check whether the binary or service exists. Returns concise string.
Systeminfo.prototype.getUpnpRendererVersion = async function () {
    const self = this;
    const logger = self.logger;
    try {
        // 1) Prefer dpkg package version for upmpdcli
        const upmpdPkg = await new Promise((resolve) => {
            exec("dpkg-query -W -f='${Version}' upmpdcli 2>/dev/null || true", (err, stdout) => {
                resolve(err ? '' : stdout.trim());
            });
        });
        if (upmpdPkg) return `upmpdcli ${upmpdPkg}`;

        // 2) If package not available, check if binary exists
        const upmpdWhich = await new Promise((resolve) => {
            exec('which upmpdcli 2>/dev/null || true', (err, stdout) => {
                resolve(err ? '' : stdout.trim());
            });
        });
        if (upmpdWhich) return 'upmpdcli (installed)';

        // 3) If not binary, check for running service
        const upmpdService = await new Promise((resolve) => {
            exec("systemctl is-active --quiet upmpdcli.service && echo 'active' || true", (err, stdout) => {
                resolve(err ? '' : stdout.trim());
            });
        });
        if (upmpdService === 'active') return 'upmpdcli (service)';


        return 'Not detected';
    } catch (err) {
        logger && logger.warn && logger.warn('UPnP detection failed:', err.message);
        return 'Not available';
    }
};

// Detect U-Boot version (for boards like Khadas VIM3L) by scanning common block devices !!! function not used anymore
Systeminfo.prototype.getUbootVersion = async function () {
    const self = this;
    try {
        const cmd = `/bin/echo volumio | /usr/bin/sudo -S strings -n 8 /dev/mmcblk0 2>/dev/null | grep -m1 -i 'U-Boot' || true`;

        return await new Promise((resolve) => {
            exec(cmd, (error, stdout, stderr) => {
                if (stderr && stderr.toString().trim()) {
                    self.logger.info('U-Boot scan stderr: ' + stderr.toString().trim());
                }
                let out = (stdout || '').toString().trim();
                out = out.replace(/^%+\s*/, '').trim();

                resolve(out || 'Not detected');
            });
        });
    } catch (error) {
        self.logger.error('U-Boot detection failed:', error.message);
        return 'Not available';
    }
};

// --- Main function to get system info and display modal ---
Systeminfo.prototype.getsysteminfo = async function (data) {
    const self = this;
    const defer = libQ.defer();

    try {
        const [
            allData,
            audioConfig,
            sysVersion,
            firmwareInfo,
            storageInfo,
            mpdVersion,
            bogoMips,
            boardInfo,
            upnp,
            cpuModelName
        ] = await Promise.all([
            si.getAllData(),
            new Promise((resolve) => {
                fs.readFile('/data/configuration/audio_interface/alsa_controller/config.json', 'utf8', (err, config) => {
                    if (err) {
                        self.logger.info('Error reading audio config:', err);
                        resolve({});
                    } else {
                        try {
                            resolve(JSON.parse(config));
                        } catch (e) {
                            self.logger.info('Error parsing audio config:', e);
                            resolve({});
                        }
                    }
                });
            }),
            self.commandRouter.executeOnPlugin('system_controller', 'system', 'getSystemVersion', ''),
            self.getFirmwareInfo(),
            self.getStorageInfo(),
            new Promise((resolve) => {
                exec('mpd -V', (error, stdout) => {
                    resolve(error ? 'N/A' : stdout.trim().split('\n')[0]);
                });
            }),
            self.getBogoMIPS(),
            self.getBoardInfo(),
            self.getUpnpRendererVersion(),
            self.getCpuModelName()
        ]);
        /*
                // Conditionally fetch U-Boot only for non-Raspberry-family boards
                let ubootValue = 'Not detected';
                try {
                    const isRaspberry = ((boardInfo && ((boardInfo.manufacturer || '').toString().toLowerCase().includes('raspberry')))
                        || ((boardInfo && (boardInfo.model || '').toString().toLowerCase().includes('raspberry'))));
        
                    if (isRaspberry) {
                        self.logger.info('Board detected as Raspberry-family; skipping U-Boot detection');
                        ubootValue = 'Not applicable';
                    } else {
                        ubootValue = await self.getUbootVersion();
                        self.logger.info('U-Boot value' + ubootValue);
        
                    }
                } catch (e) {
                    self.logger.warn('U-Boot conditional detection failed:', e.message);
                    ubootValue = 'Not available';
                }
        */
        const outputDevice = audioConfig.outputdevice?.value;
        const hwAudioInfo = outputDevice ? await self.getHwAudioInfo(outputDevice) : { channels: 'N/A', samplerates: 'N/A' };

        // Board info already obtained from getBoardInfo()
        let networkInfo = { iface: 'N/A', ip4: 'N/A', mac: 'N/A', type: 'N/A' };
        try {
            networkInfo = await si.networkInterfaces('default');
        } catch (e) {
            self.logger.warn('Failed to get network info via systeminformation:', e.message);
        }

        let cpuTemp = 'N/A';
        try {
            const tempResult = await si.cpuTemperature();
            cpuTemp = tempResult.main ? `${tempResult.main.toFixed(0)}°C` : 'N/A';
        } catch (e) {
            self.logger.warn('Failed to get CPU temperature:', e.message);
        }

        // Assign the fetched firmware information to the boardInfo object
        boardInfo.firmware = firmwareInfo;

        // Final data object
        const finalData = {
            os: {
                version: sysVersion.systemversion,
                hostname: allData.os.hostname,
                kernel: allData.os.kernel,
                governor: allData.cpu.governor,
                uptime: self.formatUptime(allData.time.uptime)
            },
            software: {
                mpdVersion: mpdVersion,
                bluetooth: await self.getBluetoothVersion() || 'Not detected',
                airplay: await self.getAirPlayVersion() || 'Not detected',
                upnp: upnp || 'Not detected'
            },
            network: {
                iface: networkInfo.iface,
                ip: networkInfo.ip4,
                mac: networkInfo.mac,
                type: networkInfo.type,
                speed: networkInfo.iface === 'wlan0' ? (await new Promise((resolve) => exec("/usr/bin/sudo /sbin/iwconfig wlan0 | grep 'Bit Rate' | awk '{print $2,$3}' | tr -d 'Rate:' | xargs", (e, d) => resolve(d?.replace(/=/g, '').trim()))) || 'N/A') : (await new Promise((resolve) => exec("/usr/bin/sudo /sbin/ethtool eth0 | grep -i speed | tr -d 'Speed:' | xargs", (e, d) => resolve(d?.replace('\n', '') === '1000Mb/s' ? '1Gb/s' : d?.trim()))) || 'N/A')
            },
            audio: {
                configuredHw: audioConfig.outputdevicename?.value || 'N/A',
                mixerType: audioConfig.mixer_type?.value || 'N/A',
                channels: hwAudioInfo.channels,
                sampleRate: hwAudioInfo.samplerates
            },
            board: boardInfo,
            // U-Boot information (if available)
            boardUboot: {
                uboot: typeof ubootValue !== 'undefined' ? ubootValue : 'Not detected'
            },
            cpu: {
                brand: allData.cpu.brand,
                modelName: cpuModelName,
                speed: allData.cpu.speed,
                family: allData.cpu.family,
                model: allData.cpu.model,
                cores: allData.cpu.cores,
                physicalCores: allData.cpu.physicalCores,
                bogomips: bogoMips,
                avgLoad: (allData.currentLoad.avgLoad * 100).toFixed(0),
                temperature: cpuTemp
            },
            memory: {
                total: (allData.mem.total / 1024).toFixed(0) + ' Ko',
                free: (allData.mem.free / 1024).toFixed(0) + ' Ko',
                used: (allData.mem.used / 1024).toFixed(0) + ' Ko'
            },
            storage: storageInfo
        };

        // Construct HTML message with conditional checks
        let combinedMessages = '';

        // OS info
        if (finalData.os.version !== 'N/A' || finalData.os.hostname !== 'N/A' || finalData.os.kernel !== 'N/A' || finalData.os.governor !== 'N/A' || finalData.os.uptime !== 'N/A') {
            combinedMessages += `<li>OS info</br></li><ul>`;
            if (finalData.os.version !== 'N/A') combinedMessages += `<li>Version of Volumio: ${finalData.os.version}</li>`;
            if (finalData.os.hostname !== 'N/A') combinedMessages += `<li>Hostname: ${finalData.os.hostname}</li>`;
            if (finalData.os.kernel !== 'N/A') combinedMessages += `<li>Kernel: ${finalData.os.kernel}</li>`;
            if (finalData.os.governor !== 'N/A') combinedMessages += `<li>Governor: ${finalData.os.governor}</li>`;
            if (finalData.os.uptime !== 'N/A') combinedMessages += `<li>Uptime: ${finalData.os.uptime}</li>`;
            combinedMessages += `</ul>`;
        }

        // Network info
        if (finalData.network.iface !== 'N/A' || finalData.network.ip !== 'N/A' || finalData.network.mac !== 'N/A' || finalData.network.type !== 'N/A' || finalData.network.speed !== 'N/A') {
            combinedMessages += `<li>Network info</br></li><ul>`;
            if (finalData.network.iface !== 'N/A') combinedMessages += `<li>Interface: ${finalData.network.iface}</li>`;
            if (finalData.network.ip !== 'N/A') combinedMessages += `<li>IP Address: ${finalData.network.ip}</li>`;
            if (finalData.network.mac !== 'N/A') combinedMessages += `<li>MAC Address: ${finalData.network.mac}</li>`;
            if (finalData.network.type !== 'N/A') combinedMessages += `<li>Type: ${finalData.network.type}</li>`;
            if (finalData.network.speed !== 'N/A') combinedMessages += `<li>Speed: ${finalData.network.speed}</li>`;
            combinedMessages += `</ul>`;
        }

        // Audio info
        if (finalData.audio.configuredHw !== 'N/A' || finalData.audio.mixerType !== 'N/A' || finalData.audio.channels !== 'N/A' || finalData.audio.sampleRate !== 'N/A') {
            combinedMessages += `<li>Audio info</br></li><ul>`;
            if (finalData.audio.configuredHw !== 'N/A') combinedMessages += `<li>Hw audio configured: ${finalData.audio.configuredHw}</li>`;
            if (finalData.audio.mixerType !== 'N/A') combinedMessages += `<li>Mixer type: ${finalData.audio.mixerType}</li>`;
            if (finalData.audio.channels !== 'N/A') combinedMessages += `<li>Number of channels: ${finalData.audio.channels}</li>`;
            if (finalData.audio.sampleRate !== 'N/A') combinedMessages += `<li>Supported sample rate: ${finalData.audio.sampleRate}</li>`;
            combinedMessages += `</ul>`;
        }

        // Board info
        const validBoardInfo = (Object.entries(finalData.board).some(([key, value]) =>
            value &&
            value !== 'N/A' &&
            value !== 'Unknown' &&
            value !== 'Generic' &&
            value !== 'Unknown System' &&
            value !== 'Detection Failed' &&
            value !== '' &&
            value !== 'Default string' &&
            value !== 'Not applicable')) ||
            (finalData.boardUboot && finalData.boardUboot.uboot && !['Not detected', 'Not available', ''].includes(finalData.boardUboot.uboot));

        if (validBoardInfo) {
            combinedMessages += `<li>Board info</br></li><ul>`;
            if (
                finalData.board.manufacturer &&
                !['N/A', 'Unknown', 'Generic', '', 'Default string'].includes(finalData.board.manufacturer)
            ) {
                combinedMessages += `<li>Manufacturer: ${finalData.board.manufacturer}</li>`;
            }
            if (
                finalData.board.model &&
                !['N/A', 'Unknown System', 'Generic', '', 'Default string'].includes(finalData.board.model)
            ) {
                combinedMessages += `<li>Model: ${finalData.board.model}</li>`;
            }
            if (
                finalData.board.version &&
                !['N/A', 'Unknown', 'Generic', '', 'Default string'].includes(finalData.board.version)
            ) {
                combinedMessages += `<li>Version: ${finalData.board.version}</li>`;
            }
            if (
                finalData.board.firmware &&
                !['N/A', 'Unknown', 'Generic', '', 'Default string', 'Not applicable or failed'].includes(finalData.board.firmware)
            ) {
                combinedMessages += `<li>Firmware Version: ${finalData.board.firmware}</li>`;
            }
            // U-Boot (if available and not a placeholder)
            if (finalData.boardUboot && finalData.boardUboot.uboot && !['Not detected', 'Not available', '', 'Not applicable'].includes(finalData.boardUboot.uboot)) {
                combinedMessages += `<li>U-Boot: ${finalData.boardUboot.uboot}</li>`;
            }
            combinedMessages += `</ul>`;
        }

        // CPU info
        if (finalData.cpu.brand !== 'N/A' || finalData.cpu.modelName !== 'N/A' || finalData.cpu.speed !== 'N/A' || finalData.cpu.family !== 'N/A' || finalData.cpu.model !== 'N/A' || finalData.cpu.cores !== 'N/A' || finalData.cpu.physicalCores !== 'N/A' || finalData.cpu.bogomips !== 'N/A' || finalData.cpu.avgLoad !== 'N/A' || finalData.cpu.temperature !== 'N/A') {
            combinedMessages += `<li>CPU info</br></li><ul>`;
            if (finalData.cpu.brand !== 'N/A') combinedMessages += `<li>Brand: ${finalData.cpu.brand}</li>`;
            if (finalData.cpu.modelName !== 'N/A') combinedMessages += `<li>Model name: ${finalData.cpu.modelName}</li>`;
            if (finalData.cpu.speed !== 'N/A') combinedMessages += `<li>Speed: ${finalData.cpu.speed} GHz</li>`;
            if (finalData.cpu.family !== 'N/A') combinedMessages += `<li>Family: ${finalData.cpu.family}</li>`;
            if (finalData.cpu.model !== 'N/A') combinedMessages += `<li>Model: ${finalData.cpu.model}</li>`;
            if (finalData.cpu.cores !== 'N/A') combinedMessages += `<li>Number of cores: ${finalData.cpu.cores}</li>`;
            if (finalData.cpu.physicalCores !== 'N/A') combinedMessages += `<li>Physical cores: ${finalData.cpu.physicalCores}</li>`;
            if (finalData.cpu.bogomips !== 'N/A') combinedMessages += `<li>BogoMIPS: ${finalData.cpu.bogomips}</li>`;
            if (finalData.cpu.avgLoad !== 'N/A') combinedMessages += `<li>Average load: ${finalData.cpu.avgLoad}%</li>`;
            if (finalData.cpu.temperature !== 'N/A') combinedMessages += `<li>Temperature: ${finalData.cpu.temperature}</li>`;
            combinedMessages += `</ul>`;
        }

        // Memory info
        if (finalData.memory.total !== 'N/A' || finalData.memory.free !== 'N/A' || finalData.memory.used !== 'N/A') {
            combinedMessages += `<li>Memory info</br></li><ul>`;
            if (finalData.memory.total !== 'N/A') combinedMessages += `<li>Memory: ${finalData.memory.total}</li>`;
            if (finalData.memory.free !== 'N/A') combinedMessages += `<li>Free: ${finalData.memory.free}</li>`;
            if (finalData.memory.used !== 'N/A') combinedMessages += `<li>Used: ${finalData.memory.used}</li>`;
            combinedMessages += `</ul>`;
        }

        // Software info
        if (finalData.software.mpdVersion !== 'N/A' || finalData.software.bluetooth !== 'N/A' || finalData.software.airplay !== 'N/A') {
            combinedMessages += `<li>Software info</br></li><ul>`;
            if (finalData.software.mpdVersion !== 'N/A') combinedMessages += `<li>MPD version: ${finalData.software.mpdVersion}</li>`;
            if (finalData.software.bluetooth !== 'N/A') combinedMessages += `<li>Bluetooth capabilities version: ${finalData.software.bluetooth}</li>`;
            if (finalData.software.airplay !== 'N/A') combinedMessages += `<li>AirPlay version: ${finalData.software.airplay}</li>`;
            if (finalData.software.upnp && finalData.software.upnp !== 'Not detected' && finalData.software.upnp !== 'Not available') combinedMessages += `<li>UPnP renderer: ${finalData.software.upnp}</li>`;
            combinedMessages += `</ul>`;
        }

        // Storage info
        if (finalData.storage.size !== 'N/A' || finalData.storage.used !== 'N/A' || finalData.storage.avail !== 'N/A' || finalData.storage.pcent !== 'N/A') {
            combinedMessages += `<li>Storage info</br></li><ul>`;
            if (finalData.storage.size !== 'N/A') combinedMessages += `<li>INTERNAL storage - Size: ${finalData.storage.size}MB</li>`;
            if (finalData.storage.used !== 'N/A') combinedMessages += `<li>Used: ${finalData.storage.used}MB</li>`;
            if (finalData.storage.avail !== 'N/A') combinedMessages += `<li>Available: ${finalData.storage.avail}MB (${finalData.storage.pcent}%)</li>`;
            combinedMessages += `</ul>`;
        }

        const modalData = {
            title: 'System Information',
            message: combinedMessages,
            size: 'lg',
            buttons: [{
                name: 'Close',
                class: 'btn btn-warning',
                emit: 'closeModals',
                payload: ''
            }]
        };

        self.commandRouter.broadcastMessage('openModal', modalData);
        defer.resolve();

    } catch (error) {
        self.logger.error('Failed to get system information:', error);
        self.commandRouter.pushToastMessage('error', 'Failed to get system information', error.message);
        defer.reject(error);
    }

    return defer.promise;
};

Systeminfo.prototype.runBench = function () {
    const self = this;
    const modalData = {
        title: 'Run Bench Tests',
        message: "This will Run Sysbench CPU and Memory benchmarks using 'sysbench'. The tests takes 30 sceonds to complete. Do not play music while running Benchtest! Once started, please wait until the tests are finished. Click 'Run BenchMarks' to start the benchmarks.",
        size: 'lg',
        buttons: [{
            name: 'Run Benchmarks',
            class: 'btn btn-cancel',
            emit: 'callMethod',
            payload: { 'endpoint': 'user_interface/Systeminfo', 'method': 'runSysbench' }

        },
        {
            name: "Quit",
            class: 'btn btn-info',
            emit: 'closeModals',
            payload: ""
        }
        ]
    };

    self.commandRouter.broadcastMessage('openModal', modalData);
}

Systeminfo.prototype.runSysbench = async function (options = {}) {
  const self = this;
  const threadsAll = options.threads || '$(nproc)';
  const time = options.time || 10;
  const memBlock = options.block || '1M';
  const memTotal = options.total || '1G';

  // --- async exec helper ---
  async function execPromise(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout.toString());
      });
    });
  }

  // --- build and show progress modal ---
  function updateProgress(stepStates) {
    let html = '<li>Benchmark progress</br></li><ul>';
    html += `<li>Bench 1 (CPU multi): ${stepStates[0]}</li>`;
    html += `<li>Bench 2 (CPU 1 thread): ${stepStates[1]}</li>`;
    html += `<li>Bench 3 (Memory): ${stepStates[2]}</li>`;
    html += '</ul>';

    const modalData = {
      title: 'Benchmark Progress',
      message: html,
      size: 'lg',
    /*  buttons: [{
        name: 'Close',
        class: 'btn btn-warning',
        emit: 'closeModals',
        payload: ''
      }]*/
    };
    self.commandRouter.broadcastMessage('openModal', modalData);
  }

  // --- parsers ---
  function parseCpu(out) {
    return {
      total: (out.match(/total time:\s*([\d.]+)s/i) || [])[1] || 'N/A',
      eps: (out.match(/events per second:\s*([\d.]+)/i) || [])[1] || 'N/A',
      min: (out.match(/min:\s*([\d.]+)/i) || [])[1] || 'N/A',
      avg: (out.match(/avg:\s*([\d.]+)/i) || [])[1] || 'N/A',
      max: (out.match(/max:\s*([\d.]+)/i) || [])[1] || 'N/A'
    };
  }

  function parseMem(out) {
    const ops = (out.match(/Total operations:\s*([\d]+)/i) || [])[1] || 'N/A';
    const opsPerSec = (out.match(/Total operations:\s*\d+\s*\(([\d.]+)\s+per second\)/i) || [])[1] || 'N/A';
    const transferred = (out.match(/([\d.]+)\s*MiB transferred/i) || [])[1] || 'N/A';
    const throughput = (out.match(/\(([\d.]+)\s*MiB\/sec\)/i) || [])[1]
      || (out.match(/MiB\/s\s*:\s*([\d.]+)/i) || [])[1]
      || 'N/A';
    const totalTime = (out.match(/total time:\s*([\d.]+)s/i) || [])[1] || 'N/A';
    return {
      ops,
      opsPerSec,
      transferred: transferred !== 'N/A' ? transferred + ' MiB' : 'N/A',
      throughput: throughput !== 'N/A' ? throughput + ' MiB/sec' : 'N/A',
      totalTime
    };
  }

  try {
    self.logger.info('Starting full sysbench sequence...');

    // initial states with emojis
    let steps = ['🚀', '⏳', '⏳'];
    updateProgress(steps);

    // live update every 10s
    let tick = 0;
    const interval = setInterval(() => {
      tick += 10;
      self.logger.info(`Progress update (${tick}s): ${steps.join(', ')}`);
      updateProgress(steps);
    }, 10_000);

    // --- Bench 1: CPU all threads ---
    const cpuAllOut = await execPromise(`sysbench cpu --threads=${threadsAll} --time=${time} run`);
    steps = ['✅', '🚀', '⏳'];
    updateProgress(steps);

    // --- Bench 2: CPU 1 thread ---
    const cpu1Out = await execPromise(`sysbench cpu --threads=1 --time=${time} run`);
    steps = ['✅', '✅', '🚀'];
    updateProgress(steps);

    // --- Bench 3: Memory ---
    const memOut = await execPromise(`sysbench memory --threads=1 --memory-block-size=${memBlock} --memory-total-size=${memTotal} run`);
    clearInterval(interval);

    // --- Parse all outputs ---
    const cpuAll = parseCpu(cpuAllOut);
    const cpu1 = parseCpu(cpu1Out);
    const mem = parseMem(memOut);

    // --- Final formatted HTML (same style as your system info) ---
    let combined = '';
    combined += `<li>CPU Benchmark (All Threads)</br></li><ul>`;
    combined += `<li>Events per second: ${cpuAll.eps}</li>`;
    combined += `<li>Min latency: ${cpuAll.min} ms</li>`;
    combined += `<li>Avg latency: ${cpuAll.avg} ms</li>`;
    combined += `<li>Max latency: ${cpuAll.max} ms</li></ul>`;

    combined += `<li>CPU Benchmark (1 Thread)</br></li><ul>`;
    combined += `<li>Events per second: ${cpu1.eps}</li>`;
    combined += `<li>Min latency: ${cpu1.min} ms</li>`;
    combined += `<li>Avg latency: ${cpu1.avg} ms</li>`;
    combined += `<li>Max latency: ${cpu1.max} ms</li></ul>`;

    combined += `<li>Memory Benchmark</br></li><ul>`;
    combined += `<li>Throughput: ${mem.throughput}</li>`;
    combined += `<li>Transferred: ${mem.transferred}</li>`;
    combined += `<li>Total operations: ${mem.ops}</li>`;
    combined += `<li>Operations per second: ${mem.opsPerSec}</li></ul>`;

    // --- Final results modal ---
    const modalData = {
      title: 'Benchmark Results',
      message: combined,
      size: 'lg',
      buttons: [{
        name: 'Close',
        class: 'btn btn-warning',
        emit: 'closeModals',
        payload: ''
      }]
    };
    self.commandRouter.broadcastMessage('openModal', modalData);

    return { cpu_all: cpuAll, cpu_single: cpu1, memory: mem };

  } catch (err) {
    self.logger.error('Sysbench failed: ' + err.message);
    self.commandRouter.pushToastMessage('error', 'Benchmark Error', 'Sysbench failed: ' + err.message);
    throw err;
  }
};

