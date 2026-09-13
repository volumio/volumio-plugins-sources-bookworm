"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lms_discovery_1 = __importDefault(require("lms-discovery"));
const Util_1 = require("./Util");
const load_esm_1 = require("load-esm");
const Util_2 = require("./Util");
async function runChildProcess() {
    const { LmsPlayerMonitor } = await (0, load_esm_1.loadEsm)('lms-player-monitor');
    const sendToParent = (message) => {
        if (process.send) {
            process.send(message);
        }
    };
    const log = (level, message) => {
        sendToParent({
            type: 'log',
            payload: {
                level,
                message
            }
        });
    };
    log('debug', '[squeezelite_mc] PlayerFinderChild process starting');
    const foundPlayers = [];
    const monitors = {};
    let opts = {};
    const getPlayersOnServer = async (server, monitor) => {
        try {
            log('info', `[squeezelite_mc] Getting players connected to ${server.name} (${server.ip})`);
            const players = await monitor.getPlayers();
            const result = players
                .filter((player) => player.isConnected && player.playerId !== '00:00:00:00:00:00')
                .map((player) => ({
                id: player.playerId,
                ip: player.ip?.split(':')[0],
                name: player.name,
                server
            }));
            log('info', `[squeezelite_mc] Players connected to ${server.name} (${server.ip}): ${JSON.stringify(result)}`);
            return result;
        }
        catch (error) {
            log('error', (0, Util_2.getErrorMessage)(`[squeezelite_mc] Failed to get players on server ${server.name} (${server.ip}):`, error));
            sendToParent({
                type: 'error',
                payload: {
                    message: (0, Util_2.getErrorMessage)(`Request to ${server.name} (${server.ip}) failed with error:`, error, false)
                }
            });
            throw error;
        }
    };
    const createMonitor = (server) => {
        const monitor = new LmsPlayerMonitor((0, Util_1.getLmsPlayerMonitorConfig)(server, opts.serverCredentials, {
            debug: (msg) => log('debug', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
            info: (msg) => log('info', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
            warn: (msg) => log('warn', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
            error: (msg) => log('error', `[squeezelite_mc] (lms-player-monitor) ${msg}`)
        }));
        monitor.on('serverDisconnect', () => handleServerLost(server));
        monitor.on('playerConnect', (players) => {
            players.forEach((player) => handlePlayerConnect(server, player));
        });
        monitor.on('playerDisconnect', (players) => {
            players.forEach((player) => handlePlayerDisconnect(player));
        });
        return monitor;
    };
    const clearMonitor = async (monitor) => {
        monitor.removeAllListeners('serverDisconnect');
        monitor.removeAllListeners('playerConnect');
        monitor.removeAllListeners('playerDisconnect');
        try {
            await monitor.stop();
        }
        catch (error) {
            log('error', (0, Util_2.getErrorMessage)('Error stopping player monitor:', error, false));
        }
    };
    const removeAndEmitLostByPlayerId = (id) => {
        const foundIndex = foundPlayers.findIndex((player) => id === player.id);
        if (foundIndex >= 0) {
            const lost = foundPlayers.splice(foundIndex, 1);
            filterAndEmit('lost', lost);
        }
    };
    const isInFoundPlayers = (playerId, server) => {
        return (foundPlayers.findIndex((player) => player.id === playerId && player.server.ip === server.ip) >= 0);
    };
    const handlePlayerConnect = (server, player) => {
        if (!isInFoundPlayers(player.playerId, server)) {
            const mapped = {
                id: player.playerId,
                ip: player.ip?.split(':')[0],
                name: player.name,
                server
            };
            log('info', `[squeezelite_mc] Player connected to ${server.name} (${server.ip}): ${JSON.stringify({
                id: mapped.id,
                ip: mapped.ip,
                name: mapped.name
            })}`);
            foundPlayers.push(mapped);
            filterAndEmit('found', [mapped]);
        }
    };
    const handlePlayerDisconnect = (player) => {
        removeAndEmitLostByPlayerId(player.playerId);
    };
    const filterAndEmit = (eventName, players) => {
        const eventFilter = opts.eventFilter;
        if (!eventFilter) {
            sendToParent({ type: eventName, payload: players });
            return;
        }
        const predicates = [];
        if (eventFilter.playerIP) {
            const pip = eventFilter.playerIP;
            predicates.push(Array.isArray(pip) ?
                (player) => player.ip !== undefined && pip.includes(player.ip)
                : (player) => pip === player.ip);
        }
        if (eventFilter.playerName) {
            const pn = eventFilter.playerName;
            predicates.push(Array.isArray(pn) ?
                (player) => pn.includes(player.name)
                : (player) => pn === player.name);
        }
        if (eventFilter.playerId) {
            const pid = eventFilter.playerId;
            predicates.push(Array.isArray(pid) ?
                (player) => pid.includes(player.id)
                : (player) => pid === player.id);
        }
        let filtered = players;
        for (let i = 0; i < predicates.length; i++) {
            filtered = filtered.filter(predicates[i]);
        }
        if (filtered.length > 0) {
            sendToParent({ type: eventName, payload: filtered });
        }
    };
    const handleServerDiscovered = (data) => {
        if (!data.cliPort) {
            log('warn', `[squeezelite_mc] Disregarding discovered server due to missing CLI port: ${JSON.stringify(data)}`);
            return;
        }
        const server = {
            ip: data.ip,
            name: data.name,
            ver: data.ver,
            uuid: data.uuid,
            jsonPort: data.jsonPort,
            cliPort: data.cliPort
        };
        log('info', `[squeezelite_mc] Server discovered: ${JSON.stringify(server)}`);
        void (async () => {
            try {
                monitors[server.ip] = createMonitor(server);
                const players = await getPlayersOnServer(server, monitors[server.ip]);
                if (players.length > 0) {
                    foundPlayers.push(...players);
                    filterAndEmit('found', players);
                }
                try {
                    await monitors[server.ip].start();
                    log('info', '[squeezelite_mc] Player monitor started');
                }
                catch (error) {
                    log('error', (0, Util_2.getErrorMessage)(`[squeezelite_mc] Failed to start player monitor on ${server.name} (${server.ip}):`, error));
                    sendToParent({
                        type: 'error',
                        payload: {
                            message: (0, Util_2.getErrorMessage)(`Request to ${server.name} (${server.ip}) failed with error:`, error, false)
                        }
                    });
                    throw error;
                }
            }
            catch (error) {
                log('error', (0, Util_2.getErrorMessage)('[squeezelite_mc] An error occurred while processing discovered server:', error));
            }
        })();
    };
    const handleServerLost = (server) => {
        log('info', `[squeezelite_mc] Server lost: ${JSON.stringify(server)}`);
        const lost = foundPlayers.filter((player) => player.server.ip === server.ip);
        foundPlayers.splice(0, foundPlayers.length, ...foundPlayers.filter((player) => player.server.ip !== server.ip));
        if (lost.length > 0) {
            filterAndEmit('lost', lost);
        }
        void (async () => {
            const monitor = monitors[server.ip];
            if (monitor) {
                delete monitors[server.ip];
                await clearMonitor(monitor);
            }
        })();
    };
    process.on('message', (message) => {
        if (!message || typeof message.type !== 'string') {
            return;
        }
        void (async () => {
            try {
                switch (message.type) {
                    case 'start': {
                        log('debug', '[squeezelite_mc] PlayerFinderChild handling start request');
                        opts = message.payload;
                        // Start server discovery
                        lms_discovery_1.default.on('discovered', handleServerDiscovered);
                        lms_discovery_1.default.on('lost', handleServerLost);
                        lms_discovery_1.default.start();
                        log('info', '[squeezelite_mc] Server discovery started');
                        sendToParent({ type: 'started' });
                        break;
                    }
                    case 'stop': {
                        log('debug', '[squeezelite_mc] PlayerFinderChild handling stop request');
                        lms_discovery_1.default.removeAllListeners('discovered');
                        lms_discovery_1.default.removeAllListeners('lost');
                        lms_discovery_1.default.stop();
                        await Promise.all(Object.values(monitors).map((monitor) => clearMonitor(monitor)));
                        foundPlayers.splice(0, foundPlayers.length);
                        Object.keys(monitors).forEach((key) => delete monitors[key]);
                        process.exit(0);
                        break;
                    }
                }
            }
            catch (error) {
                sendToParent({
                    type: 'error',
                    payload: { message: String(error) }
                });
                process.exit(1);
            }
        })();
    });
    process.on('disconnect', () => {
        void (async () => {
            log('debug', '[squeezelite_mc] PlayerFinderChild process disconnect event');
            lms_discovery_1.default.removeAllListeners('discovered');
            lms_discovery_1.default.removeAllListeners('lost');
            lms_discovery_1.default.stop();
            await Promise.all(Object.values(monitors).map((monitor) => clearMonitor(monitor)));
        })();
    });
    process.on('uncaughtException', (error) => {
        log('error', (0, Util_2.getErrorMessage)('[squeezelite_mc] PlayerFinderChild uncaught exception', error));
        sendToParent({ type: 'error', payload: { message: String(error) } });
        process.exit(1);
    });
}
if (process.send) {
    void runChildProcess();
}
