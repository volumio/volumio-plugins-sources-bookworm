"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _PlayerFinder_instances, _PlayerFinder_status, _PlayerFinder_foundPlayers, _PlayerFinder_monitors, _PlayerFinder_opts, _PlayerFinder_getPlayersOnServer, _PlayerFinder_handleServerDiscovered, _PlayerFinder_handleServerLost, _PlayerFinder_clearMonitor, _PlayerFinder_removeAndEmitLostByPlayerId, _PlayerFinder_isInFoundPlayers, _PlayerFinder_handlePlayerConnect, _PlayerFinder_handlePlayerDisconnect, _PlayerFinder_filterAndEmit, _PlayerFinder_createMonitor;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerFinderStatus = void 0;
const SqueezeliteMCContext_1 = __importDefault(require("./SqueezeliteMCContext"));
const lms_discovery_1 = __importDefault(require("lms-discovery"));
const lms_player_monitor_1 = require("lms-player-monitor");
const events_1 = __importDefault(require("events"));
const Util_1 = require("./Util");
var PlayerFinderStatus;
(function (PlayerFinderStatus) {
    PlayerFinderStatus["Started"] = "started";
    PlayerFinderStatus["Stopped"] = "stopped";
})(PlayerFinderStatus || (exports.PlayerFinderStatus = PlayerFinderStatus = {}));
class PlayerFinder extends events_1.default {
    constructor() {
        super();
        _PlayerFinder_instances.add(this);
        _PlayerFinder_status.set(this, void 0);
        _PlayerFinder_foundPlayers.set(this, void 0);
        _PlayerFinder_monitors.set(this, void 0);
        _PlayerFinder_opts.set(this, void 0);
        __classPrivateFieldSet(this, _PlayerFinder_status, PlayerFinderStatus.Stopped, "f");
        __classPrivateFieldSet(this, _PlayerFinder_foundPlayers, [], "f");
        __classPrivateFieldSet(this, _PlayerFinder_monitors, {}, "f");
        __classPrivateFieldSet(this, _PlayerFinder_opts, {}, "f");
    }
    start(opts = {}) {
        __classPrivateFieldSet(this, _PlayerFinder_opts, opts, "f");
        // Start server discovery
        lms_discovery_1.default.on('discovered', __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handleServerDiscovered).bind(this));
        lms_discovery_1.default.on('lost', __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handleServerLost).bind(this));
        lms_discovery_1.default.start();
        SqueezeliteMCContext_1.default.getLogger().info('[squeezelite_mc] Server discovery started');
        __classPrivateFieldSet(this, _PlayerFinder_status, PlayerFinderStatus.Started, "f");
        SqueezeliteMCContext_1.default.getLogger().info('[squeezelite_mc] Player finder started');
    }
    async stop() {
        lms_discovery_1.default.removeAllListeners('discovered');
        lms_discovery_1.default.removeAllListeners('lost');
        lms_discovery_1.default.stop();
        await Promise.all(Object.values(__classPrivateFieldGet(this, _PlayerFinder_monitors, "f")).map((monitor) => __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_clearMonitor).call(this, monitor)));
        __classPrivateFieldSet(this, _PlayerFinder_foundPlayers, [], "f");
        __classPrivateFieldSet(this, _PlayerFinder_monitors, {}, "f");
        __classPrivateFieldSet(this, _PlayerFinder_status, PlayerFinderStatus.Stopped, "f");
    }
    getStatus() {
        return __classPrivateFieldGet(this, _PlayerFinder_status, "f");
    }
    on(eventName, listener) {
        return super.on(eventName, listener);
    }
}
_PlayerFinder_status = new WeakMap(), _PlayerFinder_foundPlayers = new WeakMap(), _PlayerFinder_monitors = new WeakMap(), _PlayerFinder_opts = new WeakMap(), _PlayerFinder_instances = new WeakSet(), _PlayerFinder_getPlayersOnServer = async function _PlayerFinder_getPlayersOnServer(server, monitor) {
    try {
        SqueezeliteMCContext_1.default.getLogger().info(`[squeezelite_mc] Getting players connected to ${server.name} (${server.ip})`);
        const players = await monitor.getPlayers();
        /**
         * Filter out players with Id '00:00:00:00:00:00', because it could well
         * be due to Squeezelite starting before network is initialized. If
         * this happens to multiple Squeezlite devices, this will mess up the
         * finder (server will also probably be messed up, but that's not something
         * we can deal with here).
         */
        const result = players
            .filter((player) => player.isConnected && player.playerId !== '00:00:00:00:00:00')
            .map((player) => ({
            id: player.playerId,
            ip: player.ip?.split(':')[0],
            name: player.name,
            server
        }));
        SqueezeliteMCContext_1.default.getLogger().info(`[squeezelite_mc] Players connected to ${server.name} (${server.ip}): ${JSON.stringify(result)}`);
        return result;
    }
    catch (error) {
        SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage(`[squeezelite_mc] Failed to get players on server ${server.name} (${server.ip}):`, error));
        this.emit('error', SqueezeliteMCContext_1.default.getErrorMessage(SqueezeliteMCContext_1.default.getI18n('SQUEEZELITE_MC_ERR_SERVER_REQUEST', server.name, server.ip), error, false));
        throw error;
    }
}, _PlayerFinder_handleServerDiscovered = function _PlayerFinder_handleServerDiscovered(data) {
    if (!data.cliPort) {
        SqueezeliteMCContext_1.default.getLogger().warn(`[squeezelite_mc] Disregarding discovered server due to missing CLI port: ${JSON.stringify(data)}`);
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
    SqueezeliteMCContext_1.default.getLogger().info(`[squeezelite_mc] Server discovered: ${JSON.stringify(server)}`);
    void (async () => {
        try {
            __classPrivateFieldGet(this, _PlayerFinder_monitors, "f")[server.ip] = __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_createMonitor).call(this, server);
            const players = await __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_getPlayersOnServer).call(this, server, __classPrivateFieldGet(this, _PlayerFinder_monitors, "f")[server.ip]);
            if (players.length > 0) {
                __classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").push(...players);
                __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_filterAndEmit).call(this, 'found', players);
            }
            try {
                await __classPrivateFieldGet(this, _PlayerFinder_monitors, "f")[server.ip].start();
                SqueezeliteMCContext_1.default.getLogger().info('[squeezelite_mc] Player monitor started');
            }
            catch (error) {
                SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage(`[squeezelite_mc] Failed to start player monitor on ${server.name} (${server.ip}):`, error));
                this.emit('error', SqueezeliteMCContext_1.default.getErrorMessage(SqueezeliteMCContext_1.default.getI18n('SQUEEZELITE_MC_ERR_SERVER_REQUEST', server.name, server.ip), error, false));
                throw error;
            }
        }
        catch (error) {
            SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc] An error occurred while processing discovered server:', error));
        }
    })();
}, _PlayerFinder_handleServerLost = function _PlayerFinder_handleServerLost(server) {
    SqueezeliteMCContext_1.default.getLogger().info(`[squeezelite_mc] Server lost: ${JSON.stringify(server)}`);
    const lost = __classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").filter((player) => player.server.ip === server.ip);
    __classPrivateFieldSet(this, _PlayerFinder_foundPlayers, __classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").filter((player) => player.server.ip !== server.ip), "f");
    if (lost.length > 0) {
        __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_filterAndEmit).call(this, 'lost', lost);
    }
    void (async () => {
        const monitor = __classPrivateFieldGet(this, _PlayerFinder_monitors, "f")[server.ip];
        if (monitor) {
            delete __classPrivateFieldGet(this, _PlayerFinder_monitors, "f")[server.ip];
            await __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_clearMonitor).call(this, monitor);
        }
    })();
}, _PlayerFinder_clearMonitor = async function _PlayerFinder_clearMonitor(monitor) {
    monitor.removeAllListeners('serverDisconnect');
    monitor.removeAllListeners('playerConnect');
    monitor.removeAllListeners('playerDisconnect');
    try {
        await monitor.stop();
    }
    catch (error) {
        SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('Error stopping player monitor:', error, false));
    }
}, _PlayerFinder_removeAndEmitLostByPlayerId = function _PlayerFinder_removeAndEmitLostByPlayerId(id) {
    const foundIndex = __classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").findIndex((player) => id === player.id);
    if (foundIndex >= 0) {
        const lost = __classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").splice(foundIndex, 1);
        __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_filterAndEmit).call(this, 'lost', lost);
    }
}, _PlayerFinder_isInFoundPlayers = function _PlayerFinder_isInFoundPlayers(playerId, server) {
    return (__classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").findIndex((player) => player.id === playerId && player.server.ip === server.ip) >= 0);
}, _PlayerFinder_handlePlayerConnect = function _PlayerFinder_handlePlayerConnect(server, player) {
    if (!__classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_isInFoundPlayers).call(this, player.playerId, server)) {
        const mapped = {
            id: player.playerId,
            ip: player.ip?.split(':')[0],
            name: player.name,
            server
        };
        SqueezeliteMCContext_1.default.getLogger().info(`[squeezelite_mc] Player connected to ${server.name} (${server.ip}): ${JSON.stringify({
            id: mapped.id,
            ip: mapped.ip,
            name: mapped.name
        })}`);
        __classPrivateFieldGet(this, _PlayerFinder_foundPlayers, "f").push(mapped);
        __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_filterAndEmit).call(this, 'found', [mapped]);
    }
}, _PlayerFinder_handlePlayerDisconnect = function _PlayerFinder_handlePlayerDisconnect(player) {
    __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_removeAndEmitLostByPlayerId).call(this, player.playerId);
}, _PlayerFinder_filterAndEmit = function _PlayerFinder_filterAndEmit(eventName, players) {
    const eventFilter = __classPrivateFieldGet(this, _PlayerFinder_opts, "f").eventFilter;
    if (!eventFilter) {
        this.emit(eventName, players);
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
        this.emit(eventName, filtered);
    }
}, _PlayerFinder_createMonitor = function _PlayerFinder_createMonitor(server) {
    const monitor = new lms_player_monitor_1.LmsPlayerMonitor((0, Util_1.getLmsPlayerMonitorConfig)(server, __classPrivateFieldGet(this, _PlayerFinder_opts, "f").serverCredentials));
    monitor.on('serverDisconnect', () => __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handleServerLost).call(this, server));
    monitor.on('playerConnect', (players) => {
        players.forEach((player) => __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handlePlayerConnect).call(this, server, player));
    });
    monitor.on('playerDisconnect', (players) => {
        players.forEach((player) => __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handlePlayerDisconnect).call(this, player));
    });
    return monitor;
};
exports.default = PlayerFinder;
