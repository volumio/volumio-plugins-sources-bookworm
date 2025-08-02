//b@lbuze 2025 July

'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
const path = require('path');
const { spawn } = require('child_process');
var execSync = require('child_process').execSync;
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
        //        self.scanBT()
        self.reconnectTrustedDevices();
       // self.pairBtDevice();
        self.clearDeviceList();

        //  self.connect()
        // self.getBTcommands();
    }, 25000);

    defer.resolve();

    return defer.promise; // Return the main promise to allow for chaining
};


Bluetooth_Remote.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();
    self.stopScan();
    self.clearDeviceList();
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
            //  this.pluginPageVisible = true;

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
                    if (err || !stdout) {
                        self.logger.warn(logPrefix + 'Failed to get connected devices: ');
                        uiconf.sections[0].content.push({
                            id: 'noDevice',
                            element: 'input',
                            label: 'Connected Devices',
                            value: 'No devices connected'
                        });
                        defer.resolve(uiconf);
                        return;
                    }

                    const lines = stdout.trim().split('\n');
                    if (lines.length === 0) {
                        uiconf.sections[0].content.push({
                            id: 'noDevice',
                            element: 'input',
                            label: 'Connected Devices',
                            value: 'No devices connected'
                        });
                    } else {
                        lines.forEach((line, i) => {
                            const match = line.match(/^Device\s+([0-9A-F:]+)\s+(.+)$/i);
                            if (!match) return;
                            const addr = match[1];
                            const name = match[2];

                            uiconf.sections[0].content.push({
                                id: `connected_device_${i}`,
                                element: 'input',
                                label: `Connected Device :${name}`,//${i + 1}`,
                                value: `${name} (address :${addr})`
                            });


                            uiconf.sections[0].content.push({
                                id: `disconnect_device_${i}`,
                                element: 'button',
                                label: `Disconnect device ${name}`,
                                onClick: {
                                    type: 'plugin',
                                    endpoint: 'system_hardware/Bluetoothremote',
                                    method: 'disconnectBT',
                                    data: {
                                        address: addr,
                                        name: name
                                    }
                                }

                            });
                            uiconf.sections[0].content.push({
                                id: `forget_device_${i}`,
                                element: 'button',
                                label: `Forget device ${name}`,
                                onClick: {
                                    type: 'plugin',
                                    endpoint: 'system_hardware/Bluetoothremote',
                                    method: 'removeBT',
                                    data: {
                                        address: addr,
                                        name: name
                                    }
                                }

                            });
                        });
                    }

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

Bluetooth_Remote.prototype.reconnectTrustedDevices = function () {
    const self = this;

    self.logger.info(logPrefix + 'Checking for trusted devices to reconnect...');

    exec('bluetoothctl devices', (err, stdout, stderr) => {
        if (err || !stdout) {
            self.logger.error(logPrefix + 'Failed to list Bluetooth devices: ' + (stderr || err.message));
            return;
        }

        const lines = stdout.trim().split('\n');

        lines.forEach((line) => {
            const match = line.match(/^Device\s+([0-9A-F:]+)\s+(.+)$/i);
            if (!match) return;

            const addr = match[1];
            const name = match[2];

            // Check if this device is trusted
            exec(`bluetoothctl info ${addr}`, (infoErr, infoOut) => {
                if (infoErr) return;

                if (infoOut.includes('Paired: yes') && infoOut.includes('Trusted: yes')) {
                    self.logger.info(logPrefix + `Reconnecting trusted device: ${name} (${addr})`);

                    exec(`bluetoothctl connect ${addr}`, (connectErr, connectOut, connectStderr) => {
                        if (connectErr || connectStderr) {
                            self.logger.error(logPrefix + `Failed to reconnect ${name}: ${connectStderr || connectErr.message}`);
                        } else {
                            self.logger.info(logPrefix + `✅ Reconnected ${name} (${addr})`);
                        }
                    });
                }
            });
        });
    });
};


Bluetooth_Remote.prototype.stopScan = function () {
    const self = this;

    // 🔐 Prevent async race conditions by marking scan inactive immediately
    self.scanningActive = false;

    self.logger.info(logPrefix + 'Attempting to stop Bluetooth scan...');

    if (self.btctl) {
        try {
            self.btctl.stdin.write('scan off\n');
            self.logger.info(logPrefix + 'bluetoothctl scan off command sent.');
        } catch (err) {
            self.logger.error(logPrefix + 'Failed to stop bluetoothctl: ' + err.message);
        }
        self.btctl = null;
    }

    if (self.refreshInterval) {
        clearInterval(self.refreshInterval);
        self.refreshInterval = null;
    }

    if (self.pruneInterval) {
        clearInterval(self.pruneInterval);
        self.pruneInterval = null;
    }

    if (self.scanTimeout) {
        clearTimeout(self.scanTimeout);
        self.scanTimeout = null;
        self.logger.info(logPrefix + 'Scan timeout cleared manually.');
    }

    self.config.set('BT_device', {
        name: 'Select a device to connect to',
        address: 'xx'
    });
};


Bluetooth_Remote.prototype.scanBT = function () {
    const self = this;
    const DEVICE_TIMEOUT_MS = 60000; // 1 minute timeout for stale devices
    const REFRESH_INFO_INTERVAL = 10000;
    const PRUNE_INTERVAL = 10000;
    const SCAN_DURATION_MS = 60000;
    self.scanTimeout = null;
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
            // ✅ Prevent writing if scanning was already stopped
            if (!self.scanningActive) {
                self.logger.info(logPrefix + 'writeDevices skipped: scan already stopped.');
                return;
            }

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
        self.scanningActive = false; // Set early to avoid race conditions

        if (self.btctl && self.btctl.stdin.writable) {
            self.logger.info(logPrefix + 'Stopping Bluetooth scan after timeout...');
            self.commandRouter.pushToastMessage('info', 'Bluetooth Remote', 'Scan terminated! Re scan if needed!');
            self.btctl.stdin.write('scan off\n');
            self.btctl.stdin.end();
            self.clearDeviceList();
        }

        if (refreshInterval) clearInterval(refreshInterval);
        if (pruneInterval) clearInterval(pruneInterval);
    }

    async function runBluetoothScan() {
        try {
            self.logger.info(logPrefix + 'Starting Bluetooth scan...');
            self.commandRouter.pushToastMessage('info', 'Bluetooth Remote', 'Scan in progress for 60 seconds...🔥, Set your device on Pairing mode!, Open the list (may take 10sec)');
            await executeBluetoothctlCommand(['power on', 'scan on']);
        } catch (error) {
            self.logger.error(logPrefix + 'Bluetooth scan failed: ' + error.message);
        }
    }

    runBluetoothScan();

    // Refresh device info
    self.refreshInterval = setInterval(() => {
        if (self.btctl && self.btctl.stdin.writable) {
            Object.keys(self.discoveredDevices).forEach(addr => {
                self.logger.info(logPrefix + `Refreshing info for ${addr}`);
                self.btctl.stdin.write(`info ${addr}\n`);
            });
        }
    }, REFRESH_INFO_INTERVAL);

    // Prune and save device list
    self.pruneInterval = setInterval(() => {
        saveRemoteDevices();
    }, PRUNE_INTERVAL);

    // Auto-stop scan after 60s

    self.scanTimeout = setTimeout(() => {
        stopScan();
        self.logger.info(logPrefix + 'Bluetooth scan ended after 60 seconds.');
    }, SCAN_DURATION_MS);
};

Bluetooth_Remote.prototype.disconnectBT = function (data) {
    const self = this;
    const defer = libQ.defer();

    const deviceName = data?.name;
    const deviceAddress = data?.address;

    if (!deviceAddress || deviceAddress === 'xx') {
        self.logger.warn(logPrefix + 'disconnectBT: No valid device address provided.');
        self.commandRouter.pushToastMessage('warning', 'Bluetooth Remote', '❌ No valid device address provided for disconnect.');
        defer.resolve();
        return defer.promise;
    }

    self.logger.info(logPrefix + `Attempting to disconnect from ${deviceName} (${deviceAddress})`);

    exec(`bluetoothctl disconnect ${deviceAddress}`, (err, stdout, stderr) => {
        if (err) {
            self.logger.error(logPrefix + `Failed to disconnect ${deviceName}: ${stderr || err.message}`);
            self.commandRouter.pushToastMessage('error', 'Bluetooth Remote', `❌ Failed to disconnect ${deviceName}`);
            defer.reject(err);
        } else {
            self.logger.info(logPrefix + `✅ Device ${deviceName} disconnected: ${stdout.trim()}`);
            self.commandRouter.pushToastMessage('success', 'Bluetooth Remote', `✅ ${deviceName} disconnected`);

            // ✅ Refresh UI AFTER successful disconnect
            setTimeout(() => {
                self.refreshUI();
            }, 2300); // delay slightly after disconnect

            defer.resolve();
        }
    });

    return defer.promise;
};


Bluetooth_Remote.prototype.removeBT = function (data) {
    const self = this;
    const defer = libQ.defer();

    self.unpairBTpopup();

    const targetDeviceAddress = data?.address;
    const targetDeviceName = data?.name;

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
                self.commandRouter.pushToastMessage('success', 'Bluetooth Remote', `Device ${targetDeviceName} removed`);

                // Only clear stored connected device if it matches
                const connected = self.config.get('Connected_BT_device');
                if (connected && connected.address === targetDeviceAddress) {
                    self.config.set('Connected_BT_device', {
                        name: 'No device connected',
                        address: 'xx'
                    });
                }

                // Also clear if it was selected for pairing
                const selected = self.config.get('BT_device');
                if (selected && selected.address === targetDeviceAddress) {
                    self.config.set('BT_device', {
                        name: 'Select a device to connect to',
                        address: 'xx'
                    });
                }
                setTimeout(() => {
                    self.refreshUI();

                }, 2000);
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
            setTimeout(resolve, 2500);
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

        // Always reset BT_device after pairing attempt
        self.config.set('BT_device', {
            name: 'Press scan to discover devices',
            address: 'xx'
        });

        if (output.includes('Connection successful') || output.includes('Device is already connected')) {
            self.commandRouter.pushToastMessage('success', '✅Bluetooth Remote', `${target.name} paired and connected`);
            self.clearDeviceList();
            self.refreshUI();
            defer.resolve();
        } else {
            self.commandRouter.pushToastMessage('error', 'Bluetooth Remote', `Failed to pair ${target.name}`);
            self.clearDeviceList();
            self.refreshUI();
            defer.reject(new Error('Pairing sequence incomplete or failed.'));
        }
    });

    bluetoothctl.on('error', (err) => {
        self.logger.error(logPrefix + `bluetoothctl error: ${err.message}`);
        defer.reject(err);
    });

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


Bluetooth_Remote.prototype.clearDeviceList = function () {
    const self = this;
    var path = '/data/plugins/system_hardware/Bluetoothremote/remote_devices.json';
    const placeholder = [
        {
            address: "Press scan to detect BT device",
            name: "xx"
        }
    ];

    try {
        fs.writeFileSync(path, JSON.stringify(placeholder, null, 2));
        self.logger.info("Bluetoothremote--- Device list cleared and placeholder written.");
        self.refreshUI();
    } catch (error) {
        self.logger.error("Bluetoothremote--- Failed to reset device list: " + error.message);
    }
};


Bluetooth_Remote.prototype.saveBT = function (data) {
    const self = this;
    const defer = libQ.defer();
    self.stopScan();

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
    }, 15000);
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

        exec('sudo systemctl restart triggerhappy.service', (restartError, restartStdout, restartStderr) => {
            if (restartError) {
                self.logger.error(`Bluetoothremote--- Failed to restart triggerhappy: ${restartError.message}`);
                self.commandRouter.pushToastMessage('error', 'Triggerhappy', '❌ Failed to restart service. See logs for details.');
                return resolve("Failed to restart triggerhappy.service");
            }

            // Give system some time to apply changes and flush logs
            setTimeout(() => {
                // Check if the service is active
                exec('systemctl is-active triggerhappy.service', (statusErr, statusOut) => {
                    const isActive = statusOut.trim() === 'active';

                    if (!isActive) {
                        self.logger.error("Bluetoothremote--- Triggerhappy service is not active after restart.");
                        self.commandRouter.pushToastMessage('error', 'Triggerhappy', '❌ Triggerhappy service failed to start.');
                        return resolve("Triggerhappy service failed to start");
                    }

                    // Now check logs for config errors
                    exec('journalctl -u triggerhappy.service --since "10 seconds ago" | grep "Unable to parse trigger line"', (logErr, logOut) => {
                        if (logOut && logOut.trim() !== '') {
                            self.logger.error(`Bluetoothremote--- triggerhappy config issues detected:\n${logOut}`);
                            self.commandRouter.pushToastMessage('error', 'Triggerhappy', '⚠️ Triggerhappy config contains invalid lines. Please check.');
                            return resolve("Triggerhappy config contains invalid lines.");
                        }

                        self.logger.info("Bluetoothremote--- triggerhappy service restarted successfully.");
                        self.commandRouter.pushToastMessage('success', 'Triggerhappy', '✅ The service restarted successfully, your new configuration is now used!');
                        resolve('Triggerhappy restarted cleanly');
                    });
                });
            }, 1000); // Wait a full second to ensure logs and status are updated
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

