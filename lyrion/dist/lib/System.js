"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startService = startService;
exports.stopService = stopService;
exports.getServiceStatus = getServiceStatus;
exports.getServerPrefs = getServerPrefs;
exports.getServerPort = getServerPort;
const LyrionContext_1 = __importDefault(require("./LyrionContext"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const os_1 = require("os");
const SYSTEMD_SERVICE_NAME = 'logitechmediaserver';
const PREFS_FILE = '/var/lib/squeezeboxserver/prefs/server.prefs';
const DEFAULT_SERVER_PORT = '9000';
function execCommand(cmd, sudo = false) {
    return new Promise((resolve, reject) => {
        LyrionContext_1.default.getLogger().info(`[lyrion] Executing ${cmd}`);
        (0, child_process_1.exec)(sudo ? `echo volumio | sudo -S ${cmd}` : cmd, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
            if (error) {
                LyrionContext_1.default.getLogger().error(LyrionContext_1.default.getErrorMessage(`[lyrion] Failed to execute ${cmd}: ${stderr.toString()}`, error));
                reject(error);
            }
            else {
                resolve(stdout.toString());
            }
        });
    });
}
function systemctl(cmd, service = '') {
    const fullCmd = `/usr/bin/sudo /bin/systemctl ${cmd} ${service} || true`;
    return execCommand(fullCmd);
}
function resolveOnServiceStatusMatch(status, matchConsecutive = 1, retries = 5) {
    let consecutiveCount = 0;
    let tryCount = 0;
    const startCheckTimer = (resolve, reject) => {
        setTimeout(() => {
            void (async () => {
                const _status = await getServiceStatus();
                if (Array.isArray(status) ? status.includes(_status) : _status === status) {
                    consecutiveCount++;
                    if (consecutiveCount === matchConsecutive) {
                        resolve();
                    }
                    else {
                        startCheckTimer(resolve, reject);
                    }
                }
                else if (_status === 'failed') {
                    reject();
                }
                else if (_status === 'activating') {
                    consecutiveCount = 0;
                    startCheckTimer(resolve, reject);
                }
                else if (tryCount < retries - 1) {
                    consecutiveCount = 0;
                    tryCount++;
                    startCheckTimer(resolve, reject);
                }
                else {
                    reject();
                }
            })();
        }, 500);
    };
    return new Promise((resolve, reject) => {
        startCheckTimer(resolve, reject);
    });
}
async function startService() {
    await systemctl('start', SYSTEMD_SERVICE_NAME);
    await resolveOnServiceStatusMatch('active', 5);
}
async function stopService() {
    await systemctl('stop', SYSTEMD_SERVICE_NAME);
    return resolveOnServiceStatusMatch(['inactive', 'failed']);
}
async function getServiceStatus() {
    const recognizedStatuses = ['inactive', 'active', 'activating', 'failed'];
    const regex = /Active: (.*) \(.*\)/gm;
    const out = await systemctl('status', SYSTEMD_SERVICE_NAME);
    const matches = [...out.matchAll(regex)];
    if (matches[0] && matches[0][1] && recognizedStatuses.includes(matches[0][1])) {
        return matches[0][1];
    }
    return 'inactive';
}
function getServerPrefs() {
    if (!fs_1.default.existsSync(PREFS_FILE)) {
        return {};
    }
    try {
        const prefs = fs_1.default.readFileSync(PREFS_FILE, 'utf8');
        const parsed = prefs.split(os_1.EOL).reduce((result, row) => {
            const h = row.split(':');
            if (h.length === 2) {
                const prop = h[0].trim();
                const value = h[1].trim();
                let parsedValue = value;
                if (value.startsWith('\'') && value.endsWith('\'')) {
                    parsedValue = value.substring(1, value.length - 1);
                }
                Reflect.set(result, prop, parsedValue);
            }
            return result;
        }, {});
        return parsed;
    }
    catch (error) {
        LyrionContext_1.default.getLogger().error(LyrionContext_1.default.getErrorMessage('[lyrion] Error reading server prefs file:', error));
        return {};
    }
}
function getServerPort() {
    const prefs = getServerPrefs();
    return prefs['httpport'] || DEFAULT_SERVER_PORT;
}
//# sourceMappingURL=System.js.map