//b@lbuze 2025 July

'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
const path = require('path');
const { spawn } = require('child_process');
var execSync = require('child_process').execSync;
const io = require('socket.io-client');
const dbus = require('dbus-native');
const WebSocket = require('ws');
const logPrefix = "Bluetoothremote--- "

module.exports = Bluetooth_Remote;
function Bluetooth_Remote(context) {
    var self = this;
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
    self.commandRouter = self.context.coreCommand;
}

Bluetooth_Remote.prototype.onVolumioStart = function () {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
};

Bluetooth_Remote.prototype.onStart = function () {
    const self = this;
    const defer = libQ.defer();

    self.commandRouter.loadI18nStrings();
    //  self.socket = io.connect('http://localhost:3000');

    setTimeout(() => {
        //   self.scanBT()
        self.pairBtDevice()
        //  self.connect()
        // self.getBTcommands();
    }, 8000);

    defer.resolve();

    return defer.promise; // Return the main promise to allow for chaining
};


Bluetooth_Remote.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();
    self.stopScan();
    // self.removeBT();

    /* self.removeBT()
 
     self.config.set('BT_device', {
         name: "Selected a device or scan",
         address: "xx"
     });
     */
    defer.resolve();
    return defer.promise;  // Return the promise so it can be awaited

};

Bluetooth_Remote.prototype.onRestart = function () {
    var self = this;
};

// Configuration Methods -----------------------------------------------------------------------------

Bluetooth_Remote.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function (uiconf) {
            this.pluginPageVisible = true;

            //uiconf.sections[0].content[0].value = self.config.get('BT_device');

            var BT_device = self.config.get('BT_device');
            var BT_device_name = BT_device ? BT_device.name : 'No Device choose one or scan';
            var BT_device_mac = BT_device ? BT_device.address : 'xx';

            self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.value', BT_device_mac);
            self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.label', BT_device_name);

            try {
                // Read the JSON file
                let listf = fs.readFileSync('/data/plugins/system_hardware/Bluetoothremote/remote_devices.json', 'utf8');

                // Parse the JSON content
                let remoteDevices = JSON.parse(listf);

                // Ensure the result is an array
                if (Array.isArray(remoteDevices)) {
                    // Iterate through the list of devices and extract address and name
                    remoteDevices.forEach(device => {
                        const address = device.address || 'Unknown Address';
                        const name = device.name || 'Unnamed Device';

                        self.logger.info(logPrefix + `Device found: ${name} - ${address}`);

                        self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
                            value: address,
                            label: name
                        });
                    });
                } else {
                    self.logger.error(logPrefix + 'The data in the JSON file is not in the expected format (should be an array).');
                }

            } catch (err) {
                self.logger.error(logPrefix + ' Failed to read remote_devices.json: ' + err);
            }

            try {
                exec('bluetoothctl devices Connected', (err, stdout, stderr) => {
                    let connectedName = 'No device connected';

                    if (!err && stdout) {
                        const lines = stdout.trim().split('\n');
                        const match = lines[0]?.match(/^Device\s+([0-9A-F:]+)\s+(.+)$/i);

                        if (match) {
                            const nameFromBluetoothctl = match[2];
                            const storedConnected = self.config.get('Connected_BT_device');

                            if (
                                storedConnected &&
                                storedConnected.name &&
                                storedConnected.name === nameFromBluetoothctl
                            ) {
                                connectedName = nameFromBluetoothctl;
                            } else {
                                connectedName = 'No device connected';
                            }
                        }
                    } else {
                        connectedName = 'No device connected';
                        self.logger.warn(logPrefix + 'Failed to get connected device via bluetoothctl: ' + stderr);
                    }

                    uiconf.sections[0].content[2].value = connectedName;
                    //   uiconf.sections[1].hidden = true;

                    defer.resolve(uiconf);
                });
            } catch (err) {
                self.logger.warn(logPrefix + `Could not determine connected device: ${err}`);
            }

        })
        .fail(function () {
            defer.reject(new Error());
        });

    return defer.promise;
};

Bluetooth_Remote.prototype.stopScan = function () {
    if (this.btctl) {
        this.logger.info(logPrefix + 'Stopping Bluetooth scan...');
        this.btctl.stdin.write('scan off\n');
        this.btctl.stdin.end();
        this.btctl.kill();
        this.btctl = null;
    }
};
Bluetooth_Remote.prototype.scanBT = function () {
    const self = this;
    const DEVICE_TIMEOUT_MS = 60000; // 1 minute timeout for stale devices
    const REFRESH_INFO_INTERVAL = 15000;
    const PRUNE_INTERVAL = 10000;
    const SCAN_DURATION_MS = 60000;

    self.discoveredDevices = {};
    self.scanningActive = true;

    let refreshInterval, pruneInterval;

    function decodeBlobData(data) {
        let decodedData = data.toString('utf8');
        decodedData = decodedData.replace(/\x1B\[[0-?9;]*[mK]/g, '');
        decodedData = decodedData.replace(/[^\x20-\x7E\r\n\t]/g, '');
        return decodedData.trim();
    }

    function isInputDevice(info) {
        return (
            info.includes('Class: 0x0500') || // Keyboard
            info.includes('Class: 0x0504') || // Joystick
            info.includes('Class: 0x0508') || // Gamepad
            info.includes('Class: 0x0540') || // Remote control
            info.includes('Class: 0x0580') || // Mouse
            info.includes('Class: 0x05C0') || // Keyboard+Mouse
            info.includes('Class: 0x00002580') ||
            info.includes('0000110e-0000-1000-8000-00805f9b34fb') || // HID
            info.includes('00001124-0000-1000-8000-00805f9b34fb') ||
            info.includes('00001812-0000-1000-8000-00805f9b34fb')    // HID over GATT
        );
    }

    function saveRemoteDevices() {
        const filePath = path.join(__dirname, 'remote_devices.json');
        exec('bluetoothctl devices', (err, stdout, stderr) => {
            if (err || !stdout) {
                const errorMsg = stderr || (err ? err.message : 'Unknown error');
                self.logger.error(logPrefix + 'Failed to list bluetooth devices: ' + errorMsg);
                return;
            }

            const lines = stdout.trim().split('\n');
            const devices = [];
            let pending = lines.length;
            if (pending === 0) return writeDevices([]);

            lines.forEach(line => {
                const match = line.match(/^Device\s+([0-9A-F:]+)\s+(.+)$/i);
                if (!match) {
                    if (--pending === 0) writeDevices(devices);
                    return;
                }

                const address = match[1];
                const name = match[2];

                exec(`bluetoothctl info ${address}`, (infoErr, infoOut) => {
                    if (!infoErr && isInputDevice(infoOut)) {
                        devices.push({ address, name });
                    }
                    if (--pending === 0) writeDevices(devices);
                });
            });
        });

        function writeDevices(devices) {
            const filePath = path.join(__dirname, 'remote_devices.json');

            if (devices.length === 0) {
                devices.push({
                    address: 'xx',
                    name: 'No input device found. Please scan again.'
                });
                self.config.set('BT_device', {
                    name: 'No BT remote control device found',
                    address: 'xx'
                });
            }

            try {
                fs.writeFileSync(filePath, JSON.stringify(devices, null, 2));
                self.logger.info(logPrefix + `Saved ${devices.length} input-capable devices to ${filePath}`);
            } catch (err) {
                self.logger.error(logPrefix + `Failed to write remote_devices.json: ${err.message}`);
            }

            self.refreshUI();
        }
    }

    function executeBluetoothctlCommand(commands) {
        return new Promise((resolve, reject) => {
            const bluetoothctl = spawn('bluetoothctl');
            self.btctl = bluetoothctl;

            bluetoothctl.stdout.on('data', (data) => {
                const response = decodeBlobData(data);
                self.logger.info(logPrefix + response);

                if (response.includes('DeviceSet') && response.includes('not available')) {
                    const addrMatch = response.match(/DeviceSet\s+([0-9A-F:]+)/);
                    if (addrMatch) {
                        delete self.discoveredDevices[addrMatch[1]];
                    }
                    return;
                }

                if (response.includes('Device') && response.includes('not available')) {
                    const addrMatch = response.match(/Device\s+([0-9A-F:]+)/);
                    if (addrMatch) {
                        delete self.discoveredDevices[addrMatch[1]];
                    }
                    return;
                }

                const newDeviceMatch = response.match(/\[NEW\] Device ([0-9A-F:]+) (.+)/);
                if (newDeviceMatch) {
                    const addr = newDeviceMatch[1];
                    const name = newDeviceMatch[2];
                    self.discoveredDevices[addr] = {
                        address: addr,
                        name: name,
                        lastSeen: Date.now(),
                        rawInfo: ''
                    };
                    bluetoothctl.stdin.write(`info ${addr}\n`);
                }

                const nameMatch = response.match(/Name:\s+(.+)/);
                const addrMatch = response.match(/Device ([0-9A-F:]+)/);
                if (addrMatch) {
                    const addr = addrMatch[1];
                    if (self.discoveredDevices[addr]) {
                        if (nameMatch) {
                            self.discoveredDevices[addr].name = nameMatch[1];
                        }
                        self.discoveredDevices[addr].rawInfo += response + '\n';
                        self.discoveredDevices[addr].lastSeen = Date.now();
                    }
                }
            });

            bluetoothctl.stderr.on('data', (data) => {
                self.logger.error(logPrefix + `[stderr]: ${decodeBlobData(data)}`);
            });

            bluetoothctl.on('close', (code) => {
                self.logger.info(logPrefix + `bluetoothctl exited with code ${code}`);
                self.scanningActive = false;
                resolve();
            });

            bluetoothctl.on('error', (err) => {
                self.logger.error(logPrefix + 'bluetoothctl error: ', err);
                reject(err);
            });

            commands.forEach(cmd => bluetoothctl.stdin.write(`${cmd}\n`));
        });
    }

    function stopScan() {
        if (self.btctl && self.btctl.stdin.writable) {
            self.logger.info(logPrefix + 'Stopping Bluetooth scan after timeout...');
                        self.commandRouter.pushToastMessage('info', 'Bluetooth Remote', 'Scan terminated!, Re scan if needed!');

            self.btctl.stdin.write('scan off\n');
            self.btctl.stdin.end();
            /* self.config.set('BT_device', {
                   name: 'Press scan to discover devices',
                   address: 'xx'
               });
               */
        }
        if (refreshInterval) clearInterval(refreshInterval);
        if (pruneInterval) clearInterval(pruneInterval);
        self.scanningActive = false;
    }

    async function runBluetoothScan() {
        try {
            self.logger.info(logPrefix + 'Starting Bluetooth scan...');
            self.commandRouter.pushToastMessage('info', 'Bluetooth Remote', 'Scan in progress for 60 seconds...🔥, Set your device on Pairing mode!');
            await executeBluetoothctlCommand(['power on', 'scan on']);
        } catch (error) {
            self.logger.error(logPrefix + 'Bluetooth scan failed: ' + error.message);
        }
    }

    runBluetoothScan();

    // Refresh device info
    refreshInterval = setInterval(() => {
        if (self.btctl && self.btctl.stdin.writable) {
            Object.keys(self.discoveredDevices).forEach(addr => {
                self.logger.info(logPrefix + `Refreshing info for ${addr}`);
                self.btctl.stdin.write(`info ${addr}\n`);
            });
        }
    }, REFRESH_INFO_INTERVAL);

    // Prune and save device list
    pruneInterval = setInterval(() => {
        saveRemoteDevices();
    }, PRUNE_INTERVAL);

    // Auto-stop scan after 60s
    setTimeout(() => {
        stopScan();
        self.logger.info(logPrefix + 'Bluetooth scan ended after 60 seconds.');
    }, SCAN_DURATION_MS);
};

Bluetooth_Remote.prototype.removeBT = function () {
    const self = this;
    const defer = libQ.defer();
    self.unpairBTpopup();

    const targetDevice = self.config.get("BT_device");
    const targetDeviceAddress = targetDevice && targetDevice.address;

    if (!targetDeviceAddress || targetDeviceAddress === 'xx') {
        self.logger.warn(logPrefix + "No valid Bluetooth device selected for removal.");
        self.commandRouter.pushToastMessage('warning', 'Bluetooth Remote', 'No valid device selected to unpair/remove.');
        defer.resolve();
        return defer.promise;
    }

    self.logger.info(logPrefix + `Starting unpairing process for device: ${targetDeviceAddress}`);

    // First untrust the device
    exec(`bluetoothctl untrust ${targetDeviceAddress}`, (untrustErr, untrustStdout, untrustStderr) => {
        if (untrustErr) {
            self.logger.warn(logPrefix + `Untrust failed for ${targetDeviceAddress}: ${untrustErr.message}`);
        } else {
            self.logger.info(logPrefix + `Device ${targetDeviceAddress} untrusted: ${untrustStdout.trim()}`);
        }

        // Then remove the device
        exec(`bluetoothctl remove ${targetDeviceAddress}`, (removeErr, removeStdout, removeStderr) => {
            if (removeErr) {
                self.logger.error(logPrefix + `Failed to remove device ${targetDeviceAddress}: ${removeErr.message}`);
                defer.reject(removeErr);
            } else {
                self.logger.info(logPrefix + `Device ${targetDeviceAddress} removed: ${removeStdout.trim()}`);
                self.commandRouter.pushToastMessage('success', 'Bluetooth Remote', `Device ${targetDevice.name} removed`);
                self.config.set('Connected_BT_device', {
                    name: 'No device connected',
                    address: 'xx'
                });
                self.config.set('BT_device', {
                    name: 'Select a device to connect to',
                    address: 'xx'
                });
                //  self.refreshUI();
                defer.resolve();
            }
        });
    });

    return defer.promise;
};


Bluetooth_Remote.prototype.pairBtDevice = function () {
    const self = this;
    const defer = libQ.defer();

    const target = self.config.get("BT_device");
    const address = target?.address;

    if (!address || address === "xx") {
        self.logger.warn(logPrefix + "No Bluetooth device selected.");
        self.commandRouter.pushToastMessage('warning', '❌Bluetooth Remote', 'No device selected to pair.');
        defer.resolve();
        return defer.promise;
    }

    self.logger.info(logPrefix + `Starting pairing with device: ${address}`);

    const commands = [
        'power on',
        //'agent on',
        //'default-agent',
        `pair ${address}`,
        `trust ${address}`,
        `connect ${address}`
    ];

    const bluetoothctl = spawn('bluetoothctl');
    let output = '';

    const sendCommand = (cmd) => {
        return new Promise((resolve) => {
            self.logger.info(logPrefix + `Sending command: ${cmd}`);
            bluetoothctl.stdin.write(cmd + '\n');
            setTimeout(resolve, 2500); // Wait for command to take effect
        });
    };

    bluetoothctl.stdout.on('data', (data) => {
        const msg = data.toString('utf8');
        output += msg;
        self.logger.info(logPrefix + msg);

        if (msg.includes('Connection successful') || msg.includes('Device is already connected')) {
            self.logger.info(logPrefix + `✅ Connection confirmed: ${target.name} (${address})`);
            self.config.set('Connected_BT_device', { name: target.name, address: address });
        }
    });

    bluetoothctl.stderr.on('data', (data) => {
        self.logger.error(logPrefix + `[stderr] ${data.toString('utf8')}`);
    });

    bluetoothctl.on('close', (code) => {
        self.logger.info(logPrefix + `bluetoothctl exited with code ${code}`);
        if (output.includes('Connection successful') || output.includes('Device is already connected')) {
            self.commandRouter.pushToastMessage('success', '✅Bluetooth Remote', `${target.name} paired and connected`);
            // self.refreshUI();
            defer.resolve();
        } else {
            self.commandRouter.pushToastMessage('error', 'Bluetooth Remote', `Failed to pair ${target.name}`);
            defer.reject(new Error('Pairing sequence incomplete or failed.'));
        }
    });

    bluetoothctl.on('error', (err) => {
        self.logger.error(logPrefix + `bluetoothctl error: ${err.message}`);
        defer.reject(err);
    });

    // Sequentially send commands
    (async () => {
        for (const cmd of commands) {
            await sendCommand(cmd);
        }
        setTimeout(() => {
            bluetoothctl.stdin.write('quit\n');
        }, 1000);
    })();

    return defer.promise;
};


Bluetooth_Remote.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

Bluetooth_Remote.prototype.refreshUI = function () {
    const self = this;


    setTimeout(function () {
        var respconfig = self.commandRouter.getUIConfigOnPlugin('system_hardware', 'Bluetoothremote', {});
        respconfig.then(function (config) {
            self.commandRouter.broadcastMessage('pushUiConfig', config);
        });
        self.commandRouter.closeModals();
    }, 510);
};

/*
Bluetooth_Remote.prototype.refreshUI = function () {
    const self = this;

    setTimeout(function () {
        var respconfig = self.commandRouter.getUIConfigOnPlugin('system_hardware', 'Bluetoothremote', {});
        respconfig.then(function (config) {
            self.commandRouter.broadcastMessage('pushUiConfig', config);
        });
        self.commandRouter.closeModals();
    }, 510);
};
*/
Bluetooth_Remote.prototype.saveBTx = function (data) {
    const self = this;
    const defer = libQ.defer();

    self.config.set('BT_device', {
        name: data['BT_device'].label,
        address: data['BT_device'].value
    });

    if (data['BT_device'].value === "xx") {
        self.logger.info(logPrefix + 'No device selected!');
        defer.reject('No device selected');
        return defer.promise;
    }

    self.removeBT(); // Start unpair/removal process

    // Wait 5 seconds before attempting pairing
    setTimeout(() => {
        let modalData = {
            title: "Connecting to Bluetooth device...",
            message: "Please wait a few seconds...",
            size: 'lg'
        };
        self.commandRouter.broadcastMessage("openModal", modalData);

        setTimeout(() => self.commandRouter.closeModals(), 5000);

        self.saveBTP();


    }, 5000); // 5 seconds delay to allow unpairing to finish

    return defer.promise;
};



Bluetooth_Remote.prototype.saveBT = function (data) {
    const self = this;
    const defer = libQ.defer();
    // Save Bluetooth device details in configuration
    self.config.set('BT_device', {
        name: data['BT_device'].label,
        address: data['BT_device'].value
    });

    if (data['BT_device'].value === "xx") {
        self.logger.info(logPrefix + 'No device selected!');
        defer.reject('No device selected'); // Reject the promise if no device is selected
        return defer.promise;
    }

    let modalData = {
        title: "Connexion to Bluetooth devices...",// self.commandRouter.getI18nString('TOOLS_INSTALL_TITLE'),
        message: "Please wait few seconds ...",// self.commandRouter.getI18nString('TOOLS_INSTALL_WAIT'),
        size: 'lg'
    };
    //self.commandRouter.pushToastMessage('info', 'Please wait while installing ( up to 30 seconds)');
    self.commandRouter.broadcastMessage("openModal", modalData);
    setTimeout(function () {

        self.commandRouter.closeModals();
    }, 7000);
    // Pair the Bluetooth device
    self.pairBtDevice()
        .then(() => {
            // If pairing succeeds, resolve the promise
            self.logger.info(logPrefix + 'Device paired successfully');

            //  self.commandRouter.pushToastMessage('success', self.config.get('BT_device').name + " is now used as BT output");
            defer.resolve();
        })
        .catch((error) => {
            // If pairing fails, reject the promise
            self.logger.error(logPrefix + 'Error pairing device: ' + self.config.get('BT_device').name + error);
            // self.commandRouter.pushToastMessage('error', 'Error pairing device: ' + self.config.get('BT_device').name + error);
            defer.reject(error);
        });

    // Return the promise to allow async handling
    return defer.promise;
};

Bluetooth_Remote.prototype.unpairBTpopup = function (data) {
    const self = this;
    let modalData = {
        title: "Unpair Bluetooth devices in progress",// self.commandRouter.getI18nString('TOOLS_INSTALL_TITLE'),
        message: "Please wait 2 seconds ...",// self.commandRouter.getI18nString('TOOLS_INSTALL_WAIT'),
        size: 'lg'
    };
    //self.commandRouter.pushToastMessage('info', 'Please wait while installing ( up to 30 seconds)');
    self.commandRouter.broadcastMessage("openModal", modalData);
    setTimeout(function () {

        self.commandRouter.closeModals();
    }, 5000);
};


Bluetooth_Remote.prototype.getLabelForSelect = function (options, key) {
    var n = options.length;
    for (var i = 0; i < n; i++) {
        if (options[i].value == key)
            return options[i].label;
    }
    return 'VALUE NOT FOUND BETWEEN SELECT OPTIONS!';
};

Bluetooth_Remote.prototype.restartTriggerhappy = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        self.logger.info("Bluetoothremote--- Restarting triggerhappy service...");

        exec('sudo systemctl restart triggerhappy.service', (error, stdout, stderr) => {
            if (error) {
                self.logger.error(`Bluetoothremote--- Failed to restart triggerhappy: ${error.message}`);
                return reject(error);
            }

            setTimeout(() => {
                exec('journalctl -u triggerhappy.service --since "10 seconds ago" | grep "Unable to parse trigger line"', (logErr, logOut, logStderr) => {
                    if (logOut.trim() !== '') {
                        self.logger.error(`Bluetoothremote--- triggerhappy restart completed with errors:\n${logOut}`);
                        self.commandRouter.pushToastMessage('error', 'Triggerhappy', '⚠️ Triggerhappy config contains invalid lines. Please check.');
                        return resolve('Config issue detected');
                    }

                    self.logger.info("Bluetoothremote--- triggerhappy service restarted successfully.");
                    self.commandRouter.pushToastMessage('success', 'Triggerhappy', '✅ The service restarted successfully, your new configuration is now used!');
                    resolve(stdout.trim());
                });
            }, 500); // 0.5s delay to allow log to flush
        });
    });
};




Bluetooth_Remote.prototype.setUIConfig = function (data) {
    var self = this;
    //Perform your installation tasks here
};

Bluetooth_Remote.prototype.getConf = function (varName) {
    var self = this;
    //Perform your installation tasks here
};

Bluetooth_Remote.prototype.setConf = function (varName, varValue) {
    var self = this;
    //Perform your installation tasks here
};

