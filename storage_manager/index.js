// Storage Manager - manage additional disks: init, partition, format, label, fsck
'use strict';

var libQ = require('kew');
var exec = require('child_process').exec;

var VOLUMIO_LABELS = ['issd', 'ihdd', 'Internal SSD', 'Internal HDD'];
var BOOT_LABELS = ['boot', 'volumio', 'volumio_data'];

module.exports = StorageManager;

function StorageManager(context) {
    var self = this;
    self.context = context;
    self.commandRouter = context.coreCommand;
    self.logger = self.commandRouter.logger;
    self._progressInterval = null;
}

StorageManager.prototype.onVolumioStart = function () {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    self.config = new (require('v-conf'))();
    self.config.loadFile(configFile);
    return libQ.resolve();
};

StorageManager.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

StorageManager.prototype.onStart = function () {
    return libQ.resolve();
};

StorageManager.prototype.onStop = function () {
    return libQ.resolve();
};

StorageManager.prototype.onRestart = function () {};

StorageManager.prototype.t = function (key, fallback) {
    try {
        if (this.commandRouter && typeof this.commandRouter.getI18nString === 'function') {
            var direct = this.commandRouter.getI18nString(key);
            if (direct && direct !== key) return direct;
            var tr = this.commandRouter.getI18nString('TRANSLATE.' + key);
            if (tr && tr !== ('TRANSLATE.' + key)) return tr;
        }
    } catch (e) {}
    return fallback || key;
};

StorageManager.prototype.onInstall = function () {};

StorageManager.prototype.onUninstall = function () {};

StorageManager.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    ).then(function (uiconf) {
        return self.getDisks().then(function (result) {
            self.mergeDiskListIntoUiConfig(uiconf, result, self);
            return self.getOsMaintenanceStatus(result).then(function (osStatus) {
                self.mergeOsMaintenanceIntoUiConfig(uiconf, osStatus, result);
            }).catch(function (err) {
                self.logger.warn('Storage Manager getOsMaintenanceStatus failed:', err);
            }).then(function () {
                return self.getDataPartitionInfo(result.bootDevice).then(function (dataInfo) {
                    self.mergeDataResizeIntoUiConfig(uiconf, dataInfo, result);
                }).catch(function (err) {
                    self.logger.warn('Storage Manager getDataPartitionInfo failed:', err);
                });
            });
        }).then(function () {
            defer.resolve(uiconf);
        });
    }).fail(function (err) {
        self.logger.warn('Storage Manager getUIConfig failed:', err);
        defer.reject(err || new Error());
    });

    return defer.promise;
};

StorageManager.prototype.mergeDiskListIntoUiConfig = function (uiconf, result, self) {
    var placeholderDisk = (self && self.t) ? self.t('PLACEHOLDER_SELECT_DISK', '— Select a disk —') : '— Select a disk —';
    var placeholderPart = (self && self.t) ? self.t('PLACEHOLDER_SELECT_PARTITION', '— Select partition —') : '— Select partition —';
    var diskOpts = result.diskOptions || [{ value: '', label: placeholderDisk }];
    var partOpts = result.partitionOptions || [{ value: '', label: placeholderPart }];
    var labelOpts = result.labelOptions || [];
    var formatOpts = result.formatOptions || [];
    var sections = uiconf.sections || [];
    for (var i = 0; i < sections.length; i++) {
        var content = sections[i].content || [];
        for (var j = 0; j < content.length; j++) {
            var c = content[j];
            if (c.id === 'label_disk' || c.id === 'manage_disk') {
                c.options = diskOpts;
                c.value = { value: '', label: placeholderDisk };
            }
            if (c.id === 'label_partition' || c.id === 'repair_partition') {
                c.options = partOpts;
                c.value = { value: '', label: placeholderPart };
            }
            if (c.id === 'new_label') {
                c.options = labelOpts;
            }
            if (c.id === 'manage_format') {
                c.options = formatOpts;
            }
        }
    }
};

StorageManager.prototype.setUIConfig = function (data) {};

StorageManager.prototype.getConf = function (varName) {
    return this.config.get(varName);
};

StorageManager.prototype.setConf = function (varName, varValue) {
    this.config.set(varName, varValue);
};

// Run a command with optional timeout; returns promise with { stdout, stderr, code }
function runCommand(cmd, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var opts = { timeout: timeoutMs || 30000, maxBuffer: 2 * 1024 * 1024 };
        exec(cmd, opts, function (err, stdout, stderr) {
            if (err) {
                return resolve({ stdout: stdout || '', stderr: stderr || '', code: err.code || -1, error: err });
            }
            resolve({ stdout: stdout || '', stderr: stderr || '', code: 0 });
        });
    });
}

// Resolve true if device is USB, false otherwise. deviceName = disk or partition (e.g. sda, sda1, nvme0n1p1).
function getDeviceTransport(deviceName) {
    return runCommand('sudo lsblk -J -o NAME,PKNAME,TRAN 2>/dev/null', 5000).then(function (out) {
        if (out.code !== 0 || !out.stdout) return Promise.resolve(null);
        try {
            var json = JSON.parse(out.stdout);
            var blockdevices = json.blockdevices || [];
            function findNode(list, name) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === name) return list[i];
                    if (list[i].children) {
                        var c = findNode(list[i].children, name);
                        if (c) return c;
                    }
                }
                return null;
            }
            function findDisk(list, name) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === name && list[i].type === 'disk') return list[i];
                }
                return null;
            }
            var node = findNode(blockdevices, deviceName);
            if (!node) return null;
            var diskName = (node.pkname && node.pkname.length) ? node.pkname : node.name;
            var disk = findDisk(blockdevices, diskName);
            var tran = (disk && disk.tran) ? disk.tran : (node.tran || '');
            return (tran || '').toLowerCase();
        } catch (e) {
            return null;
        }
    });
}

function isDeviceUsb(deviceName) {
    return getDeviceTransport(deviceName).then(function (tran) {
        return tran ? tran.indexOf('usb') >= 0 : false;
    });
}

// Determine the disk the system actually booted from (for exclusion and "this system" targeting).
// Uses /boot or / mount source, then lsblk PKNAME to get parent disk. Returns promise of disk name or null.
function getActualBootDevice() {
    return runCommand('findmnt -n -o SOURCE /boot 2>/dev/null || findmnt -n -o SOURCE / 2>/dev/null', 5000).then(function (out) {
        var src = (out.stdout || '').trim();
        if (!src) return Promise.resolve(null);
        var dev = src.replace(/^\/dev\//, '');
        if (!dev) return Promise.resolve(null);
        return runCommand('sudo lsblk -no PKNAME /dev/' + dev + ' 2>/dev/null', 5000).then(function (pk) {
            var pkname = (pk.stdout || '').trim();
            if (pkname) return pkname;
            return dev.replace(/p?[0-9]+$/, '').replace(/p$/, '') || null;
        });
    }).catch(function () { return null; });
}

// Parse lsblk JSON; return { bootDevice, otherDisks, otherVolumioDisks, labelsInUse, diskOptions, partitionOptions, labelOptions, formatOptions }
StorageManager.prototype.getDisks = function () {
    var self = this;
    var defer = libQ.defer();

    Promise.all([
        runCommand('sudo lsblk -J -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE,PKNAME,TRAN 2>/dev/null', 15000),
        getActualBootDevice()
    ]).then(function (arr) {
        var out = arr[0];
        var actualBootDevice = arr[1];
        if (out.code !== 0 && !out.stdout) {
            defer.resolve({
                bootDevice: null,
                otherVolumioDisks: [],
                diskOptions: [{ value: '', label: self.t('ERR_LIST_DISKS', 'Failed to list disks') }],
                partitionOptions: [],
                labelOptions: [],
                formatOptions: [
                    { value: 'ext4', label: 'ext4' },
                    { value: 'fat32', label: 'FAT32' },
                    { value: 'exfat', label: 'exFAT' },
                    { value: 'ntfs', label: 'NTFS' }
                ]
            });
            return;
        }
        try {
            var json = JSON.parse(out.stdout);
            var blockdevices = json.blockdevices || [];
            var bootName = actualBootDevice;
            var labelsInUse = [];
            var otherDisks = [];
            var allPartitionsByDisk = {};

            function collectLabels(node) {
                if (node.label && VOLUMIO_LABELS.indexOf(node.label) !== -1) {
                    labelsInUse.push(node.label);
                }
                (node.children || []).forEach(collectLabels);
            }

            function isBootDisk(node) {
                if (node.label && BOOT_LABELS.indexOf(node.label) !== -1) return true;
                return (node.children || []).some(isBootDisk);
            }

            blockdevices.forEach(function (disk) {
                if (disk.type !== 'disk') return;
                collectLabels(disk);
                var hasVolumioLabels = isBootDisk(disk);
                if (disk.name === actualBootDevice) {
                    return;
                }
                var parts = (disk.children || []).filter(function (p) { return p.type === 'part'; });
                var partList = parts.map(function (p) {
                    return {
                        name: p.name,
                        size: p.size || '',
                        fstype: p.fstype || '',
                        label: p.label || '',
                        mountpoint: p.mountpoint || ''
                    };
                });
                allPartitionsByDisk[disk.name] = partList;
                var tran = (disk.tran || '').toLowerCase();
                var isUsb = tran.indexOf('usb') >= 0;
                otherDisks.push({
                    name: disk.name,
                    size: disk.size || '',
                    partitions: partList,
                    tran: tran,
                    isUsb: isUsb,
                    hasVolumioLabels: hasVolumioLabels
                });
            });

            var otherVolumioDisks = otherDisks.filter(function (d) { return d.hasVolumioLabels; });

            if (!bootName && blockdevices.length) {
                for (var b = 0; b < blockdevices.length; b++) {
                    if (blockdevices[b].type === 'disk' && isBootDisk(blockdevices[b])) {
                        bootName = blockdevices[b].name;
                        break;
                    }
                }
            }

            var diskOptions = [{ value: '', label: self.t('PLACEHOLDER_SELECT_DISK', '— Select a disk —') }].concat(
                otherDisks.map(function (d) { return { value: d.name, label: d.name + ' (' + d.size + ')' }; })
            );

            var partitionOptions = [{ value: '', label: self.t('PLACEHOLDER_SELECT_PARTITION', '— Select partition —') }];
            otherDisks.forEach(function (d) {
                d.partitions.forEach(function (p) {
                    partitionOptions.push({
                        value: p.name,
                        label: p.name + ' ' + (p.fstype || '') + ' ' + (p.label ? '[' + p.label + ']' : '') + ' ' + (p.mountpoint || '')
                    });
                });
            });

            var availableLabels = VOLUMIO_LABELS.filter(function (l) { return labelsInUse.indexOf(l) === -1; });
            var labelOptions = availableLabels.map(function (l) { return { value: l, label: l }; });
            if (labelOptions.length === 0) labelOptions = VOLUMIO_LABELS.map(function (l) { return { value: l, label: l }; });

            var formatOptions = [
                { value: 'ext4', label: 'ext4' },
                { value: 'fat32', label: 'FAT32' },
                { value: 'exfat', label: 'exFAT' },
                { value: 'ntfs', label: 'NTFS' }
            ];

            defer.resolve({
                bootDevice: bootName,
                otherDisks: otherDisks,
                otherVolumioDisks: otherVolumioDisks,
                labelsInUse: labelsInUse,
                diskOptions: diskOptions,
                partitionOptions: partitionOptions,
                labelOptions: labelOptions,
                formatOptions: formatOptions
            });
        } catch (e) {
            self.logger.warn('Storage Manager parse lsblk failed:', e.message);
            defer.resolve({
                bootDevice: null,
                otherVolumioDisks: [],
                diskOptions: [{ value: '', label: self.t('ERR_PARSE', 'Parse error') }],
                partitionOptions: [],
                labelOptions: [],
                formatOptions: [
                    { value: 'ext4', label: 'ext4' },
                    { value: 'fat32', label: 'FAT32' },
                    { value: 'exfat', label: 'exFAT' },
                    { value: 'ntfs', label: 'NTFS' }
                ]
            });
        }
    }).catch(function (err) {
        self.logger.warn('Storage Manager getDisks failed:', err);
        defer.resolve({
            bootDevice: null,
            otherVolumioDisks: [],
            diskOptions: [{ value: '', label: self.t('ERR_LIST_DISKS', 'Error listing disks') }],
            partitionOptions: [],
            labelOptions: [],
            formatOptions: [
                { value: 'ext4', label: 'ext4' },
                { value: 'fat32', label: 'FAT32' },
                { value: 'exfat', label: 'exFAT' },
                { value: 'ntfs', label: 'NTFS' }
            ]
        });
    });

    return defer.promise;
};

// Refresh disk list and push updated UI config
StorageManager.prototype.refreshDisks = function () {
    var self = this;
    self.commandRouter.pushToastMessage('info', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('REFRESHING_DISK_LIST', 'Refreshing disk list…'));
    self.getDisks().then(function (result) {
        return self.commandRouter.i18nJson(
            __dirname + '/i18n/strings_en.json',
            __dirname + '/i18n/strings_en.json',
            __dirname + '/UIConfig.json'
        ).then(function (uiconf) {
            self.mergeDiskListIntoUiConfig(uiconf, result, self);
            return self.getOsMaintenanceStatus(result).then(function (osStatus) {
                self.mergeOsMaintenanceIntoUiConfig(uiconf, osStatus);
            }).catch(function () {}).then(function () {
                return self.getDataPartitionInfo(result.bootDevice).then(function (dataInfo) {
                    self.mergeDataResizeIntoUiConfig(uiconf, dataInfo, result);
                }).catch(function () {});
            }).then(function () { return uiconf; });
        }).then(function (uiconf) {
            if (uiconf) self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
        });
    });
};

// --- Progress modal helpers ---
StorageManager.prototype.startProgress = function (title, message) {
    var self = this;
    if (self._progressInterval) clearInterval(self._progressInterval);
    self._progressTitle = title || 'Working…';
    self._progressMessage = message || 'Do not use this disk until the operation finishes.';
    self._progressValue = 0;
    self.commandRouter.broadcastMessage('openModal', {
        title: self._progressTitle,
        message: self._progressMessage,
        size: 'lg',
        progress: true
    });
    self.commandRouter.broadcastMessage('modalProgress', {
        title: self._progressTitle,
        message: self._progressMessage,
        progressNumber: self._progressValue
    });
    self._progressInterval = setInterval(function () {
        self._progressValue = Math.min(95, self._progressValue + 2);
        self.commandRouter.broadcastMessage('modalProgress', {
            title: self._progressTitle,
            message: self._progressMessage,
            progressNumber: self._progressValue
        });
    }, 500);
};

StorageManager.prototype.updateProgress = function (percent, message) {
    var self = this;
    self._progressValue = Math.min(95, percent);
    self._progressMessage = message || self._progressMessage;
    self.commandRouter.broadcastMessage('modalProgress', {
        title: self._progressTitle,
        message: self._progressMessage,
        progressNumber: self._progressValue
    });
};

StorageManager.prototype.finishProgress = function (success, message) {
    var self = this;
    if (self._progressInterval) {
        clearInterval(self._progressInterval);
        self._progressInterval = null;
    }
    self.commandRouter.broadcastMessage('modalDone', {
        title: self._progressTitle || 'Storage Manager',
        message: message || (success ? 'Operation completed.' : 'Operation failed.'),
        progressNumber: 100,
        buttons: [{
            name: 'Close',
            class: 'btn btn-info',
            emit: 'closeModals',
            payload: ''
        }]
    });
    self._progressTitle = '';
    self._progressMessage = '';
    self._progressValue = 0;
};

// Unmount a block device or partition; returns promise
function unmountDevice(dev) {
    var path = dev.indexOf('/') === 0 ? dev : '/dev/' + dev;
    return runCommand('sudo umount ' + path + ' 2>/dev/null', 10000);
}

// Unmount all partitions on a disk (e.g. sda -> sda1, sda2, ...; nvme0n1 -> nvme0n1p1, ...)
function unmountAllPartitionsOnDisk(diskName) {
    return runCommand('sudo lsblk -ln -o NAME,PKNAME,TYPE 2>/dev/null | awk \'$2=="' + diskName + '" && $3=="part" { print $1 }\'', 5000).then(function (out) {
        var parts = (out.stdout || '').trim().split('\n').filter(Boolean);
        var chain = Promise.resolve();
        parts.forEach(function (p) {
            chain = chain.then(function () { return unmountDevice(p); });
        });
        return chain;
    });
}

// Get current mount point for a partition (e.g. sda1 -> /data/INTERNAL)
function getMountPoint(partition) {
    var path = partition.indexOf('/') === 0 ? partition : '/dev/' + partition;
    return runCommand('mount | awk \'$1=="' + path + '" { print $3; exit }\'', 2000).then(function (out) {
        var mp = (out.stdout || '').trim();
        return mp || null;
    });
}

// Remount read-write (e.g. /data/INTERNAL)
function remountRw(mountpoint) {
    if (!mountpoint) return Promise.resolve({ code: 0 });
    return runCommand('sudo mount -o remount,rw ' + mountpoint + ' 2>/dev/null', 5000);
}

// --- Volumio OS storage maintenance (boot disk: dirty check & fix) ---
// Get filesystem state for a partition (ext4: clean/dirty; vfat: no state)
function getPartitionState(partitionName) {
    var path = partitionName.indexOf('/') === 0 ? partitionName : '/dev/' + partitionName;
    return runCommand('sudo blkid -o value -s TYPE ' + path + ' 2>/dev/null', 5000).then(function (out) {
        var fstype = (out.stdout || '').trim().toLowerCase();
        if (fstype === 'ext4' || fstype === 'ext3' || fstype === 'ext2') {
            return runCommand('sudo tune2fs -l ' + path + ' 2>/dev/null', 5000).then(function (tune) {
                var state = 'unknown';
                var line = (tune.stdout || '').split('\n').filter(function (l) { return l.indexOf('Filesystem state:') === 0; })[0];
                if (line) {
                    var m = line.match(/Filesystem state:\s*(\S+)/);
                    if (m) state = m[1].toLowerCase();
                }
                return { clean: state === 'clean', stateText: state };
            });
        }
        if (fstype === 'vfat' || fstype === 'fat') {
            return Promise.resolve({ clean: true, stateText: 'vfat' });
        }
        return Promise.resolve({ clean: true, stateText: fstype || 'unknown' });
    });
}

// Get partitions on the boot disk (by device name). Returns promise { bootDevice, partitions: [{ name, label, fstype, mountpoint }] }
function getBootPartitions(bootDevice) {
    if (!bootDevice) return Promise.resolve({ bootDevice: null, partitions: [] });
    return runCommand('sudo lsblk -J -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE,PKNAME 2>/dev/null', 15000).then(function (out) {
        if (out.code !== 0 || !out.stdout) return { bootDevice: bootDevice, partitions: [] };
        try {
            var json = JSON.parse(out.stdout);
            var blockdevices = json.blockdevices || [];
            function findDisk(list, name) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === name && list[i].type === 'disk') return list[i];
                    if (list[i].children) {
                        var d = findDisk(list[i].children, name);
                        if (d) return d;
                    }
                }
                return null;
            }
            var disk = findDisk(blockdevices, bootDevice);
            if (!disk || !disk.children) return { bootDevice: bootDevice, partitions: [] };
            var parts = disk.children.filter(function (p) { return p.type === 'part'; }).map(function (p) {
                return {
                    name: p.name,
                    size: p.size || '',
                    label: p.label || '',
                    fstype: p.fstype || '',
                    mountpoint: p.mountpoint || ''
                };
            });
            return { bootDevice: bootDevice, partitions: parts };
        } catch (e) {
            return { bootDevice: bootDevice, partitions: [] };
        }
    });
}

StorageManager.prototype.getOsMaintenanceStatus = function (result) {
    var self = this;
    var bootDevice = (result && result.bootDevice) ? result.bootDevice : null;
    if (!bootDevice) return Promise.resolve({ bootDevice: null, partitions: [] });
    return getBootPartitions(bootDevice).then(function (info) {
        if (!info.partitions.length) return info;
        var chain = Promise.resolve();
        info.partitions.forEach(function (p, idx) {
            chain = chain.then(function () {
                return getPartitionState(p.name).then(function (state) {
                    info.partitions[idx].state = state.stateText;
                    info.partitions[idx].clean = state.clean;
                });
            });
        });
        return chain.then(function () { return info; });
    });
};

StorageManager.prototype.mergeOsMaintenanceIntoUiConfig = function (uiconf, osStatus, result) {
    var self = this;
    var sections = (uiconf && uiconf.sections) || [];
    var otherVolumioDisks = (result && result.otherVolumioDisks) ? result.otherVolumioDisks : [];
    var bootDevice = (result && result.bootDevice) ? result.bootDevice : null;
    for (var i = 0; i < sections.length; i++) {
        if (sections[i].id !== 'section_os_maintenance') continue;
        var content = sections[i].content || [];
        for (var j = 0; j < content.length; j++) {
            if (content[j].id === 'os_maintenance_target_disk') {
                var opts = [{ value: '', label: self.t('OS_MAINT_THIS_SYSTEM', 'This system (boot device)') + (bootDevice ? ' [' + bootDevice + ']' : '') }];
                otherVolumioDisks.forEach(function (d) {
                    opts.push({ value: d.name, label: d.name + ' (' + d.size + ')' });
                });
                content[j].options = opts;
                content[j].value = opts[0];
                break;
            }
        }
        if (!osStatus || !osStatus.bootDevice) {
            sections[i].description = self.t('OS_MAINT_NO_BOOT_DISK', 'No Volumio boot disk detected (only applies when running from internal/SD storage).');
            break;
        }
        if (!osStatus.partitions || !osStatus.partitions.length) {
            sections[i].description = self.t('OS_MAINT_NO_PARTITIONS', 'No partitions found on boot device ') + osStatus.bootDevice + '.';
            break;
        }
        var lines = [self.t('OS_MAINT_THIS_SYSTEM', 'This system') + ' [' + osStatus.bootDevice + ']:'];
        osStatus.partitions.forEach(function (p) {
            var status = p.clean ? self.t('OS_MAINT_CLEAN', 'Clean') : self.t('OS_MAINT_DIRTY', 'Dirty – fix recommended');
            lines.push('  ' + p.name + ' (' + (p.label || p.fstype || '') + '): ' + status);
        });
        if (otherVolumioDisks.length) {
            lines.push('');
            lines.push(self.t('OS_MAINT_ANOTHER_HINT', 'To fix another Volumio installation (recovery), select it above and click Check and fix all.'));
        }
        sections[i].description = lines.join('\n');
        break;
    }
};

StorageManager.prototype.fixOsPartitions = function (data) {
    var self = this;
    var targetRaw = (data && data.os_maintenance_target_disk) ? (data.os_maintenance_target_disk.value != null ? data.os_maintenance_target_disk.value : data.os_maintenance_target_disk) : null;
    var targetDisk = (typeof targetRaw === 'string') ? targetRaw : (targetRaw && targetRaw.value !== undefined ? targetRaw.value : null);
    self.getDisks().then(function (result) {
        var diskToFix = (targetDisk && targetDisk.length) ? targetDisk : (result.bootDevice || null);
        if (!diskToFix) {
            self.commandRouter.pushToastMessage('info', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('OS_MAINT_NO_BOOT_DISK', 'No Volumio boot disk detected.'));
            return;
        }
        return getBootPartitions(diskToFix).then(function (osStatus) {
            if (!osStatus.partitions || !osStatus.partitions.length) {
                self.commandRouter.pushToastMessage('info', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('OS_MAINT_NO_PARTITIONS', 'No partitions found on selected device.'));
                return;
            }
            self.startProgress(self.t('OS_MAINT_FIX_TITLE', 'Checking and fixing Volumio OS partitions') + ' (' + diskToFix + ')', self.t('OS_MAINT_FIX_MSG', 'Do not power off.'));
            var idx = 0;
            function doNext() {
                if (idx >= osStatus.partitions.length) {
                    self.finishProgress(true, self.t('OS_MAINT_FIX_DONE', 'All partitions checked. You can use the system again.'));
                    self.refreshDisks();
                    return;
                }
                var p = osStatus.partitions[idx];
                var path = '/dev/' + p.name;
                self.updateProgress(Math.round((100 * idx) / osStatus.partitions.length), self.t('OS_MAINT_FIX_PART', 'Checking ') + p.name + '…');
                getMountPoint(p.name).then(function (mountpoint) {
                    return runCommand('sudo blkid -o value -s TYPE ' + path + ' 2>/dev/null', 5000).then(function (out) {
                        var fstype = (out.stdout || '').trim().toLowerCase();
                        return unmountDevice(p.name).then(function () {
                            var cmd = '';
                            if (fstype === 'ext4' || fstype === 'ext3' || fstype === 'ext2') cmd = 'sudo fsck -y ' + path;
                            else if (fstype === 'vfat' || fstype === 'fat') cmd = 'sudo fsck.vfat -a ' + path;
                            else return Promise.resolve({ code: 0 });
                            return runCommand(cmd, 300000);
                        }).then(function (res) {
                            if (mountpoint) return runCommand('sudo mount ' + path + ' ' + mountpoint + ' 2>/dev/null', 5000);
                            return res;
                        });
                    });
                }).then(function () {
                    idx++;
                    doNext();
                }).catch(function (err) {
                    self.finishProgress(false, 'Error: ' + (err.message || err));
                    self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), err.message || self.t('ERR_FSCK_FAILED', 'Fsck failed.'));
                });
            }
            doNext();
        });
    }).fail(function (err) {
        self.logger.warn('Storage Manager fixOsPartitions failed:', err);
        self.finishProgress(false, err.message || 'Failed.');
    });
};

// --- Data partition resize (Volumio OS: this system or another installation) ---
// Optional targetDisk: if set, only look for volumio_data on that disk. Otherwise use boot device then first found.
// Returns { dataPartition, disk, partitionSizeBytes, fsSizeBytes, needsResize, mountpoint } or { noDataPartition: true }
StorageManager.prototype.getDataPartitionInfo = function (targetDisk) {
    var self = this;
    return runCommand('sudo lsblk -J -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE,PKNAME 2>/dev/null', 15000).then(function (out) {
        if (out.code !== 0 || !out.stdout) return { noDataPartition: true };
        try {
            var json = JSON.parse(out.stdout);
            var blockdevices = json.blockdevices || [];
            var dataPart = null;
            var diskName = null;
            function findLabel(list, label) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].label === label && list[i].type === 'part') return { part: list[i], pk: list[i].pkname };
                    if (list[i].children) {
                        var r = findLabel(list[i].children, label);
                        if (r) return r;
                    }
                }
                return null;
            }
            if (targetDisk) {
                var disk = blockdevices.filter(function (d) { return d.name === targetDisk && d.type === 'disk'; })[0];
                if (disk) {
                    var r = findLabel(disk.children || [], 'volumio_data');
                    if (r) {
                        dataPart = r.part.name;
                        diskName = r.pk || disk.name;
                    }
                }
            } else {
                for (var j = 0; j < blockdevices.length; j++) {
                    var r = findLabel(blockdevices[j].children || [], 'volumio_data');
                    if (r) {
                        dataPart = r.part.name;
                        diskName = r.pk || blockdevices[j].name;
                        break;
                    }
                }
            }
            if (!dataPart || !diskName) return { noDataPartition: true };
            var path = '/dev/' + dataPart;
            return runCommand('sudo blockdev getsize64 ' + path + ' 2>/dev/null', 5000).then(function (sizeOut) {
                var partitionSizeBytes = parseInt((sizeOut.stdout || '').trim(), 10) || 0;
                return runCommand('sudo tune2fs -l ' + path + ' 2>/dev/null', 5000).then(function (tuneOut) {
                    var blockCount = 0;
                    var blockSize = 4096;
                    (tuneOut.stdout || '').split('\n').forEach(function (line) {
                        var m = line.match(/Block count:\s*(\d+)/);
                        if (m) blockCount = parseInt(m[1], 10);
                        m = line.match(/Block size:\s*(\d+)/);
                        if (m) blockSize = parseInt(m[1], 10);
                    });
                    var fsSizeBytes = blockCount * blockSize;
                    var threshold = 1024 * 1024; // 1 MiB
                    var needsResize = partitionSizeBytes > 0 && (partitionSizeBytes - fsSizeBytes) > threshold;
                    return getMountPoint(dataPart).then(function (mountpoint) {
                        return {
                            dataPartition: dataPart,
                            disk: diskName,
                            partitionSizeBytes: partitionSizeBytes,
                            fsSizeBytes: fsSizeBytes,
                            needsResize: needsResize,
                            mountpoint: mountpoint
                        };
                    });
                });
            });
        } catch (e) {
            return { noDataPartition: true };
        }
    }).catch(function () { return { noDataPartition: true }; });
};

StorageManager.prototype.mergeDataResizeIntoUiConfig = function (uiconf, dataInfo, result) {
    var self = this;
    var sections = (uiconf && uiconf.sections) || [];
    var otherVolumioDisks = (result && result.otherVolumioDisks) ? result.otherVolumioDisks : [];
    var bootDevice = (result && result.bootDevice) ? result.bootDevice : null;
    for (var i = 0; i < sections.length; i++) {
        if (sections[i].id !== 'section_data_resize') continue;
        var content = sections[i].content || [];
        for (var j = 0; j < content.length; j++) {
            if (content[j].id === 'data_resize_target_disk') {
                var opts = [{ value: '', label: self.t('DATA_RESIZE_THIS_SYSTEM', 'This system (boot device)') + (bootDevice ? ' [' + bootDevice + ']' : '') }];
                otherVolumioDisks.forEach(function (d) {
                    opts.push({ value: d.name, label: d.name + ' (' + d.size + ')' });
                });
                content[j].options = opts;
                content[j].value = opts[0];
                break;
            }
        }
        if (!dataInfo || dataInfo.noDataPartition) {
            sections[i].description = self.t('DATA_RESIZE_NO_PARTITION', 'No Volumio data partition (volumio_data) found. This applies only to the boot device.');
            break;
        }
        var partMb = Math.round(dataInfo.partitionSizeBytes / (1024 * 1024));
        var fsMb = Math.round(dataInfo.fsSizeBytes / (1024 * 1024));
        var sizeMb = partMb > 0 ? partMb : fsMb;
        var freeMb = Math.max(0, Math.round((dataInfo.partitionSizeBytes - dataInfo.fsSizeBytes) / (1024 * 1024)));
        var sizeFreeStr = self.t('DATA_RESIZE_SIZE', 'Size: ') + sizeMb + ' MB, ' + self.t('DATA_RESIZE_FREE', 'Free: ') + freeMb + ' MB.';
        var status = dataInfo.needsResize
            ? self.t('DATA_RESIZE_NEEDED', 'Resize needed – automatic resize did not complete. ') + sizeFreeStr
            : self.t('DATA_RESIZE_OK', 'OK – data partition is using full size. ') + sizeFreeStr;
        if (dataInfo.disk) status = '[' + dataInfo.disk + '] ' + status;
        if (otherVolumioDisks.length) {
            status += '\n\n' + self.t('DATA_RESIZE_ANOTHER_HINT', 'To resize another Volumio installation, select it above and click Resize to 100%.');
        }
        sections[i].description = status;
        break;
    }
};

StorageManager.prototype.resizeDataPartition = function (data) {
    var self = this;
    var action = (data && data.action) ? data.action : 'max';
    var targetRaw = (data && data.data_resize_target_disk) ? (data.data_resize_target_disk.value != null ? data.data_resize_target_disk.value : data.data_resize_target_disk) : null;
    var targetDisk = (typeof targetRaw === 'string') ? targetRaw : (targetRaw && targetRaw.value !== undefined ? targetRaw.value : null);
    self.getDisks().then(function (result) {
        var diskToResize = (targetDisk && targetDisk.length) ? targetDisk : (result.bootDevice || null);
        return self.getDataPartitionInfo(diskToResize).then(function (info) {
            if (info.noDataPartition || !info.dataPartition) {
                self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('DATA_RESIZE_NO_PARTITION', 'No Volumio data partition found.'));
                return;
            }
            if (action !== 'max') {
                self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), 'Custom/shrink not implemented yet.');
                return;
            }
            if (!info.needsResize) {
                self.commandRouter.pushToastMessage('info', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('DATA_RESIZE_ALREADY_FULL', 'Data partition is already at full size. No action needed.'));
                return;
            }
            var path = '/dev/' + info.dataPartition;
        var diskPath = '/dev/' + info.disk;
        self.startProgress(self.t('DATA_RESIZE_TITLE', 'Resizing data partition to 100%'), self.t('DATA_RESIZE_MSG', 'Do not power off.'));
        getMountPoint(info.dataPartition).then(function (mountpoint) {
            return unmountDevice(info.dataPartition).then(function () {
                return runCommand('sudo parted -s ' + diskPath + ' unit s print free 2>/dev/null', 15000);
            }).then(function (out) {
                if (out.code !== 0) throw new Error(out.stderr || 'parted failed');
                var lastFreeEnd = null;
                var lines = (out.stdout || '').split('\n');
                for (var i = lines.length - 1; i >= 0; i--) {
                    var parts = lines[i].trim().split(/\s+/);
                    if (parts.indexOf('Free') >= 0 && parts.length >= 3) {
                        var endStr = (parts[2] || parts[1] || '').toString().replace(/s$/, '');
                        lastFreeEnd = parseInt(endStr, 10);
                        if (!isNaN(lastFreeEnd)) break;
                    }
                }
                if (lastFreeEnd == null) throw new Error('Could not parse free space end');
                return runCommand('sudo parted -s ' + diskPath + ' resizepart 3 ' + lastFreeEnd + 's 2>/dev/null', 15000);
            }).then(function (out) {
                if (out.code !== 0) throw new Error(out.stderr || 'resizepart failed');
                self.updateProgress(40, self.t('DATA_RESIZE_FSCK', 'Checking filesystem…'));
                return runCommand('sudo e2fsck -f -y ' + path + ' 2>/dev/null', 120000);
            }).then(function () {
                self.updateProgress(60, self.t('DATA_RESIZE_RESIZE2FS', 'Resizing filesystem…'));
                return runCommand('sudo resize2fs ' + path + ' 2>/dev/null', 120000);
            }).then(function (out) {
                if (out.code !== 0) throw new Error(out.stderr || 'resize2fs failed');
                if (info.mountpoint) return runCommand('sudo mount ' + path + ' ' + info.mountpoint + ' 2>/dev/null', 5000);
                return { code: 0 };
            }).then(function () {
                self.finishProgress(true, self.t('DATA_RESIZE_DONE', 'Data partition resized to full size.'));
                self.refreshDisks();
            });
        }).catch(function (err) {
            self.finishProgress(false, 'Error: ' + (err.message || err));
            self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), err.message || self.t('DATA_RESIZE_FAILED', 'Resize failed.'));
            if (info.mountpoint) runCommand('sudo mount ' + path + ' ' + info.mountpoint + ' 2>/dev/null', 5000);
        });
        });
    }).fail(function () {
        self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('DATA_RESIZE_NO_PARTITION', 'No Volumio data partition found.'));
    });
};

StorageManager.prototype.initDisk = function (data) {
    var self = this;
    var device = (data && (data.manage_disk || data.selected_disk)) ? ((data.manage_disk || data.selected_disk).value || (data.manage_disk || data.selected_disk)) : (data && data.device);
    if (!device) {
        self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_SELECT_DISK_FIRST', 'Select a disk first.'));
        return;
    }
    if (/^\/dev\//.test(device)) device = device.replace(/^\/dev\//, '');
    var path = '/dev/' + device;

    var modalData = {
        title: 'Init disk – destroy all data',
        message: 'This will erase the partition table on <strong>' + path + '</strong>. All data on this disk will be lost. Do not use this disk during the operation. Continue?',
        size: 'md',
        buttons: [
            { name: 'Cancel', class: 'btn btn-default', emit: 'closeModals', payload: '' },
            { name: 'Yes, init disk', class: 'btn btn-danger', emit: 'callMethod', payload: { endpoint: 'system_hardware/storage_manager', method: 'initDiskConfirm', data: { device: device } } }
        ]
    };
    self.commandRouter.broadcastMessage('openModal', modalData);
};

StorageManager.prototype.initDiskConfirm = function (data) {
    var self = this;
    var payload = (data && data.data) ? data.data : data;
    var device = (payload && payload.device) ? payload.device : (data && data.device);
    if (!device) return;
    var path = '/dev/' + device;

    self.startProgress('Initializing disk', 'Unmounting and creating new partition table. Do not use this disk.');

    setImmediate(function () {
        unmountAllPartitionsOnDisk(device).then(function () {
            return runCommand('sudo parted -s ' + path + ' mklabel msdos', 15000);
        }).then(function (out) {
            if (out.code !== 0) throw new Error(out.stderr || out.error || 'parted failed');
            self.finishProgress(true, 'Disk initialized. You can now create a partition (Create partition & format).');
            self.refreshDisks();
        }).catch(function (err) {
            self.finishProgress(false, 'Error: ' + (err.message || err));
            self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), err.message || self.t('ERR_INIT_FAILED', 'Init failed.'));
        });
    });
};

// --- Create partition and format ---
StorageManager.prototype.createPartition = function (data) {
    var self = this;
    var device = (data && (data.manage_disk || data.selected_disk)) ? ((data.manage_disk || data.selected_disk).value || (data.manage_disk || data.selected_disk)) : (data && data.device);
    var format = (data && (data.manage_format || data.new_format)) ? ((data.manage_format || data.new_format).value || (data.manage_format || data.new_format)) : (data && data.format) || 'ext4';
    var usbLabelRaw = (data && data.manage_usb_label) ? ((data.manage_usb_label.value != null ? data.manage_usb_label.value : data.manage_usb_label) + '').trim() : '';
    if (!device) {
        self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_SELECT_DISK_FIRST', 'Select a disk first.'));
        return;
    }
    if (/^\/dev\//.test(device)) device = device.replace(/^\/dev\//, '');
    var path = '/dev/' + device;
    var part1 = device + (device.match(/nvme|mmcblk/) ? 'p1' : '1');

    setImmediate(function () {
        isDeviceUsb(device).then(function (isUsb) {
            var label;
            if (isUsb) {
                label = usbLabelRaw || 'USB';
                if (VOLUMIO_LABELS.indexOf(label) !== -1) {
                    self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_USB_NO_INTERNAL_LABEL', 'USB disks must not use internal labels (issd, ihdd, Internal SSD, Internal HDD). Use a different label.'));
                    return Promise.reject(new Error('VALIDATION'));
                }
            } else {
                label = 'issd';
            }
            self.startProgress('Creating partition and formatting', 'Do not use this disk until finished.');
            return unmountAllPartitionsOnDisk(device).then(function () {
                self.updateProgress(10, 'Creating partition…');
                return runCommand('sudo parted -s ' + path + ' mklabel msdos 2>/dev/null; sudo parted -s ' + path + ' mkpart primary 0% 100%', 15000);
            }).then(function (out) {
                if (out.code !== 0) throw new Error(out.stderr || out.error || 'parted failed');
                self.updateProgress(30, 'Formatting ' + format + '…');
                var mkfsCmd = '';
                if (format === 'ext4') mkfsCmd = 'sudo mkfs.ext4 -L "' + label.replace(/"/g, '') + '" /dev/' + part1;
                else if (format === 'fat32') mkfsCmd = 'sudo mkfs.vfat -F 32 -n ' + label.substring(0, 11).replace(/[^A-Za-z0-9_]/g, '_') + ' /dev/' + part1;
                else if (format === 'exfat') mkfsCmd = 'sudo mkfs.exfat -n ' + label.substring(0, 15).replace(/[^A-Za-z0-9_]/g, '_') + ' /dev/' + part1;
                else if (format === 'ntfs') mkfsCmd = 'sudo mkfs.ntfs -L "' + label.replace(/"/g, '') + '" /dev/' + part1;
                else mkfsCmd = 'sudo mkfs.ext4 -L "' + label.replace(/"/g, '') + '" /dev/' + part1;
                return runCommand(mkfsCmd, 120000);
            }).then(function (out) {
                if (out.code !== 0) throw new Error(out.stderr || out.error || 'mkfs failed');
                self.updateProgress(90, 'Done.');
                self.finishProgress(true, 'Partition created and formatted. Reboot or go to My Music → Rescan to use the disk.');
                self.refreshDisks();
            });
        }).catch(function (err) {
            if (err && err.message === 'VALIDATION') return;
            self.finishProgress(false, 'Error: ' + (err.message || err));
            self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), err.message || self.t('ERR_CREATE_PARTITION_FAILED', 'Create partition failed.'));
        });
    });
};

// --- Set label on existing partition ---
StorageManager.prototype.setLabel = function (data) {
    var self = this;
    var partition = (data && (data.label_partition || data.selected_partition)) ? ((data.label_partition || data.selected_partition).value || (data.label_partition || data.selected_partition)) : (data && data.partition);
    var newLabel = (data && data.new_label) ? (data.new_label.value || data.new_label) : (data && data.label);
    var usbLabel = (data && data.usb_label) ? ((data.usb_label.value != null ? data.usb_label.value : data.usb_label) + '').trim() : '';
    if (!partition) {
        self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_SELECT_PARTITION_AND_LABEL', 'Select a partition and a label.'));
        return;
    }
    if (/^\/dev\//.test(partition)) partition = partition.replace(/^\/dev\//, '');
    var path = '/dev/' + partition;

    setImmediate(function () {
        isDeviceUsb(partition).then(function (isUsb) {
            var label;
            // If user filled USB/Custom label, use it (avoids relying on TRAN detection for some USB adapters)
            if (usbLabel) {
                label = usbLabel;
                if (VOLUMIO_LABELS.indexOf(label) !== -1) {
                    self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_USB_NO_INTERNAL_LABEL', 'USB disks must not use internal labels (issd, ihdd, Internal SSD, Internal HDD). Use a different label.'));
                    return Promise.reject(new Error('VALIDATION'));
                }
            } else if (isUsb) {
                self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_USB_LABEL_REQUIRED', 'USB disks need a custom label (e.g. USB or a name). Do not use internal labels.'));
                return Promise.reject(new Error('VALIDATION'));
            } else {
                label = newLabel;
                if (!label || VOLUMIO_LABELS.indexOf(label) === -1) {
                    self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_SELECT_PARTITION_AND_LABEL', 'Select a partition and a label.'));
                    return Promise.reject(new Error('VALIDATION'));
                }
            }
            self.startProgress('Setting label', 'Unmounting and setting label. Do not use this disk.');
            return getMountPoint(partition).then(function (mountpoint) {
                return runCommand('sudo blkid -o value -s TYPE ' + path + ' 2>/dev/null', 5000).then(function (out) {
                    var fstype = (out.stdout || '').trim().toLowerCase();
                    return unmountDevice(partition).then(function () {
                        var cmd = '';
                        if (fstype === 'ext4' || fstype === 'ext3' || fstype === 'ext2') cmd = 'sudo e2label ' + path + ' "' + label.replace(/"/g, '') + '"';
                        else if (fstype === 'vfat' || fstype === 'fat') cmd = 'sudo fatlabel ' + path + ' ' + label.substring(0, 11);
                        else if (fstype === 'exfat') cmd = 'sudo exfatlabel ' + path + ' ' + label.substring(0, 15);
                        else if (fstype === 'ntfs') cmd = 'sudo ntfslabel ' + path + ' ' + label;
                        else return Promise.reject(new Error('Unknown filesystem type: ' + fstype));
                        return runCommand(cmd, 10000).then(function (res) {
                            if (mountpoint) return runCommand('sudo mount ' + path + ' ' + mountpoint + ' 2>/dev/null', 5000).then(function () { return res; });
                            return res;
                        });
                    });
                });
            });
        }).then(function (out) {
            if (out && out.code !== 0) throw new Error(out.stderr || out.error || 'label failed');
            self.finishProgress(true, 'Label set. Reboot or Rescan to use.');
            self.refreshDisks();
        }).catch(function (err) {
            if (err && err.message === 'VALIDATION') return;
            self.finishProgress(false, 'Error: ' + (err.message || err));
            self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), err.message || self.t('ERR_SET_LABEL_FAILED', 'Set label failed.'));
        });
    });
};

// --- Run fsck / repair ---
StorageManager.prototype.runFsck = function (data) {
    var self = this;
    var partition = (data && (data.repair_partition || data.selected_partition)) ? ((data.repair_partition || data.selected_partition).value || (data.repair_partition || data.selected_partition)) : (data && data.partition);
    if (!partition) {
        self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), self.t('ERR_SELECT_PARTITION_FIRST', 'Select a partition first.'));
        return;
    }
    if (/^\/dev\//.test(partition)) partition = partition.replace(/^\/dev\//, '');
    var path = '/dev/' + partition;

    self.startProgress('Checking filesystem', 'Do not use this disk until the check finishes.');

    setImmediate(function () {
        getMountPoint(partition).then(function (mountpoint) {
            return runCommand('sudo blkid -o value -s TYPE ' + path + ' 2>/dev/null', 5000).then(function (out) {
                var fstype = (out.stdout || '').trim().toLowerCase();
                return unmountDevice(partition).then(function () {
                    var cmd = '';
                    if (fstype === 'ext4' || fstype === 'ext3' || fstype === 'ext2') cmd = 'sudo fsck -y ' + path;
                    else if (fstype === 'vfat' || fstype === 'fat') cmd = 'sudo fsck.vfat -a ' + path;
                    else if (fstype === 'exfat') cmd = 'sudo exfatfsck -y ' + path + ' 2>/dev/null || true';
                    else if (fstype === 'ntfs') cmd = 'sudo ntfsfix ' + path;
                    else return Promise.reject(new Error('Unsupported filesystem for check: ' + fstype));
                    return runCommand(cmd, 300000).then(function (res) {
                        if (mountpoint) return runCommand('sudo mount ' + path + ' ' + mountpoint + ' 2>/dev/null', 5000).then(function () { return res; });
                        return res;
                    });
                });
            });
        }).then(function (out) {
            var ok = (out && out.code === 0) || (out && (out.code === 1 || out.code === 2)); // fsck can return 1 = errors corrected
            self.finishProgress(ok, ok ? 'Filesystem check finished. You can use the disk again.' : 'Check completed with errors. See log.');
            self.refreshDisks();
        }).catch(function (err) {
            self.finishProgress(false, 'Error: ' + (err.message || err));
            self.commandRouter.pushToastMessage('error', self.t('PLUGIN_CONFIGURATION', 'Storage Manager'), err.message || self.t('ERR_FSCK_FAILED', 'Fsck failed.'));
        });
    });
};
