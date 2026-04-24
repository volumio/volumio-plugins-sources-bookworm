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
var _PlayerStatusMonitor_instances, _PlayerStatusMonitor_player, _PlayerStatusMonitor_serverCredentials, _PlayerStatusMonitor_monitor, _PlayerStatusMonitor_deferredEmitTimer, _PlayerStatusMonitor_handleDisconnect, _PlayerStatusMonitor_handleStatusUpdate, _PlayerStatusMonitor_emitStatusAfterDelay, _PlayerStatusMonitor_emitStatus, _PlayerStatusMonitor_cancelPendingEmit, _PlayerStatusMonitor_mapMonitoredPlayerStatus, _PlayerStatusMonitor_createAndStartMonitor;
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const SqueezeliteMCContext_1 = __importDefault(require("./SqueezeliteMCContext"));
const Util_1 = require("./Util");
const lms_player_monitor_1 = require("lms-player-monitor");
class PlayerStatusMonitor extends events_1.default {
    constructor(player, serverCredentials) {
        super();
        _PlayerStatusMonitor_instances.add(this);
        _PlayerStatusMonitor_player.set(this, void 0);
        _PlayerStatusMonitor_serverCredentials.set(this, void 0);
        _PlayerStatusMonitor_monitor.set(this, void 0);
        _PlayerStatusMonitor_deferredEmitTimer.set(this, void 0);
        __classPrivateFieldSet(this, _PlayerStatusMonitor_player, player, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_serverCredentials, serverCredentials, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_monitor, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_deferredEmitTimer, null, "f");
    }
    async start() {
        __classPrivateFieldSet(this, _PlayerStatusMonitor_monitor, await __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_createAndStartMonitor).call(this), "f");
        try {
            const status = await __classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f").getPlayerStatus(__classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f").id);
            __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_emitStatus).call(this, status);
        }
        catch (error) {
            SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc] Error getting player status:', error));
        }
    }
    async stop() {
        if (!__classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f")) {
            return;
        }
        try {
            await __classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f").stop();
        }
        catch (error) {
            SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('Error stopping player monitor:', error, false));
        }
    }
    getPlayer() {
        return __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f");
    }
    requestUpdate() {
        if (!__classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f")) {
            return;
        }
        __classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f")
            .getPlayerStatus(__classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f").id)
            .then((status) => {
            __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_emitStatus).call(this, status);
        })
            .catch((error) => {
            SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc]: Error handling update request:', error));
        });
    }
    emit(eventName, ...args) {
        return super.emit(eventName, ...args);
    }
    on(event, listener) {
        return super.on(event, listener);
    }
}
_PlayerStatusMonitor_player = new WeakMap(), _PlayerStatusMonitor_serverCredentials = new WeakMap(), _PlayerStatusMonitor_monitor = new WeakMap(), _PlayerStatusMonitor_deferredEmitTimer = new WeakMap(), _PlayerStatusMonitor_instances = new WeakSet(), _PlayerStatusMonitor_handleDisconnect = function _PlayerStatusMonitor_handleDisconnect() {
    if (!__classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f")) {
        return;
    }
    __classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f").removeAllListeners('playerStatus');
    __classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f").removeAllListeners('playerSync');
    __classPrivateFieldGet(this, _PlayerStatusMonitor_monitor, "f").removeAllListeners('serverDisconnect');
    __classPrivateFieldSet(this, _PlayerStatusMonitor_monitor, null, "f");
    __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_cancelPendingEmit).call(this);
    this.emit('disconnect', __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f"));
}, _PlayerStatusMonitor_handleStatusUpdate = function _PlayerStatusMonitor_handleStatusUpdate(status) {
    if (status.playerId === __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f").id) {
        __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_emitStatusAfterDelay).call(this, status);
    }
}, _PlayerStatusMonitor_emitStatusAfterDelay = function _PlayerStatusMonitor_emitStatusAfterDelay(status) {
    __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_cancelPendingEmit).call(this);
    __classPrivateFieldSet(this, _PlayerStatusMonitor_deferredEmitTimer, setTimeout(() => {
        __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_emitStatus).call(this, status);
    }, 200), "f");
}, _PlayerStatusMonitor_emitStatus = function _PlayerStatusMonitor_emitStatus(status) {
    this.emit('update', {
        player: __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f"),
        status: __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_mapMonitoredPlayerStatus).call(this, status)
    });
}, _PlayerStatusMonitor_cancelPendingEmit = function _PlayerStatusMonitor_cancelPendingEmit() {
    if (__classPrivateFieldGet(this, _PlayerStatusMonitor_deferredEmitTimer, "f")) {
        clearTimeout(__classPrivateFieldGet(this, _PlayerStatusMonitor_deferredEmitTimer, "f"));
        __classPrivateFieldSet(this, _PlayerStatusMonitor_deferredEmitTimer, null, "f");
    }
}, _PlayerStatusMonitor_mapMonitoredPlayerStatus = function _PlayerStatusMonitor_mapMonitoredPlayerStatus(status) {
    const mapped = {
        mode: status.status ?? 'stop',
        time: status.currentTime,
        volume: status.volume,
        repeatMode: status.repeatMode,
        shuffleMode: status.shuffleMode,
        canSeek: status.canSeek
    };
    const track = status.track;
    if (track) {
        mapped.currentTrack = {
            type: track.audioFormat,
            title: track.title,
            artist: track.artist,
            trackArtist: track.trackArtist,
            albumArtist: track.albumArtist,
            album: track.album,
            remoteTitle: track.remoteTitle,
            artworkUrl: track.artworkUrl,
            coverId: track.coverId,
            duration: track.duration,
            sampleRate: track.sampleRate,
            sampleSize: track.sampleSize,
            bitrate: track.bitrate
        };
    }
    return mapped;
}, _PlayerStatusMonitor_createAndStartMonitor = async function _PlayerStatusMonitor_createAndStartMonitor() {
    const monitor = new lms_player_monitor_1.LmsPlayerMonitor((0, Util_1.getLmsPlayerMonitorConfig)(__classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f").server, __classPrivateFieldGet(this, _PlayerStatusMonitor_serverCredentials, "f")));
    monitor.on('playerStatus', (status) => __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_handleStatusUpdate).call(this, status));
    monitor.on('serverDisconnect', () => __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_handleDisconnect).call(this));
    await monitor.start();
    return monitor;
};
exports.default = PlayerStatusMonitor;
