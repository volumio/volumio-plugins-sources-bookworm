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
var _PlayerStatusMonitor_instances, _PlayerStatusMonitor_player, _PlayerStatusMonitor_serverCredentials, _PlayerStatusMonitor_child, _PlayerStatusMonitor_deferredEmitTimer, _PlayerStatusMonitor_startPromise, _PlayerStatusMonitor_startResolve, _PlayerStatusMonitor_startReject, _PlayerStatusMonitor_handleChildMessage, _PlayerStatusMonitor_handleChildExit, _PlayerStatusMonitor_handleChildError, _PlayerStatusMonitor_cancelPendingEmit, _PlayerStatusMonitor_getChildModulePath;
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const SqueezeliteMCContext_1 = __importDefault(require("./SqueezeliteMCContext"));
const ChildProcessUtils_1 = require("./ChildProcessUtils");
class PlayerStatusMonitor extends events_1.default {
    constructor(player, serverCredentials) {
        super();
        _PlayerStatusMonitor_instances.add(this);
        _PlayerStatusMonitor_player.set(this, void 0);
        _PlayerStatusMonitor_serverCredentials.set(this, void 0);
        _PlayerStatusMonitor_child.set(this, void 0);
        _PlayerStatusMonitor_deferredEmitTimer.set(this, void 0);
        _PlayerStatusMonitor_startPromise.set(this, void 0);
        _PlayerStatusMonitor_startResolve.set(this, void 0);
        _PlayerStatusMonitor_startReject.set(this, void 0);
        __classPrivateFieldSet(this, _PlayerStatusMonitor_player, player, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_serverCredentials, serverCredentials, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_child, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_deferredEmitTimer, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startPromise, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startResolve, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startReject, null, "f");
    }
    async start() {
        if (__classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f")) {
            return __classPrivateFieldGet(this, _PlayerStatusMonitor_startPromise, "f") ?? Promise.resolve();
        }
        const childPath = __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_getChildModulePath).call(this);
        SqueezeliteMCContext_1.default.getLogger().verbose(`[squeezelite_mc] PlayerStatusMonitor: fork child process at ${childPath}`);
        __classPrivateFieldSet(this, _PlayerStatusMonitor_child, (0, child_process_1.fork)(childPath, [], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }), "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startPromise, new Promise((resolve, reject) => {
            __classPrivateFieldSet(this, _PlayerStatusMonitor_startResolve, resolve, "f");
            __classPrivateFieldSet(this, _PlayerStatusMonitor_startReject, reject, "f");
        }), "f");
        __classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f").on('message', (message) => {
            __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_handleChildMessage).call(this, message);
        });
        __classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f").on('exit', (code, signal) => {
            __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_handleChildExit).call(this, code, signal);
        });
        __classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f").on('error', (error) => {
            __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_handleChildError).call(this, error);
        });
        __classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f").send({
            type: 'start',
            payload: {
                player: __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f"),
                serverCredentials: __classPrivateFieldGet(this, _PlayerStatusMonitor_serverCredentials, "f")
            }
        });
        return __classPrivateFieldGet(this, _PlayerStatusMonitor_startPromise, "f");
    }
    async stop() {
        if (!__classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f")) {
            return;
        }
        SqueezeliteMCContext_1.default.getLogger().verbose('[squeezelite_mc] PlayerStatusMonitor: stopping child process');
        const child = __classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_child, null, "f");
        if (child.connected) {
            child.send({ type: 'stop' });
            child.disconnect();
        }
        await new Promise((resolve) => {
            child.once('exit', () => resolve());
            if (!child.connected) {
                resolve();
            }
        });
    }
    getPlayer() {
        return __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f");
    }
    requestUpdate() {
        if (!__classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f") || !__classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f").connected) {
            return;
        }
        __classPrivateFieldGet(this, _PlayerStatusMonitor_child, "f").send({ type: 'requestUpdate' });
    }
    emit(eventName, ...args) {
        return super.emit(eventName, ...args);
    }
    on(event, listener) {
        return super.on(event, listener);
    }
}
_PlayerStatusMonitor_player = new WeakMap(), _PlayerStatusMonitor_serverCredentials = new WeakMap(), _PlayerStatusMonitor_child = new WeakMap(), _PlayerStatusMonitor_deferredEmitTimer = new WeakMap(), _PlayerStatusMonitor_startPromise = new WeakMap(), _PlayerStatusMonitor_startResolve = new WeakMap(), _PlayerStatusMonitor_startReject = new WeakMap(), _PlayerStatusMonitor_instances = new WeakSet(), _PlayerStatusMonitor_handleChildMessage = function _PlayerStatusMonitor_handleChildMessage(message) {
    switch (message.type) {
        case 'log':
            (0, ChildProcessUtils_1.logChildProcessMessage)(message.payload.level, message.payload.message);
            break;
        case 'started':
            SqueezeliteMCContext_1.default.getLogger().verbose('[squeezelite_mc] PlayerStatusMonitor: child process started');
            __classPrivateFieldGet(this, _PlayerStatusMonitor_startResolve, "f")?.call(this);
            __classPrivateFieldSet(this, _PlayerStatusMonitor_startResolve, null, "f");
            __classPrivateFieldSet(this, _PlayerStatusMonitor_startReject, null, "f");
            break;
        case 'update':
            __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_cancelPendingEmit).call(this);
            __classPrivateFieldSet(this, _PlayerStatusMonitor_deferredEmitTimer, setTimeout(() => {
                this.emit('update', message.payload);
            }, 200), "f");
            break;
        case 'disconnect':
            this.emit('disconnect', __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f"));
            break;
        case 'error':
            if (__classPrivateFieldGet(this, _PlayerStatusMonitor_startReject, "f")) {
                __classPrivateFieldGet(this, _PlayerStatusMonitor_startReject, "f").call(this, new Error(message.payload.message));
            }
            else {
                SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc] PlayerStatusMonitor: child process error:', message.payload.message));
            }
            break;
    }
}, _PlayerStatusMonitor_handleChildExit = function _PlayerStatusMonitor_handleChildExit(code, signal) {
    SqueezeliteMCContext_1.default.getLogger().verbose(`[squeezelite_mc] PlayerStatusMonitor: child process exited (code: ${code}; signal: ${signal})`);
    __classPrivateFieldSet(this, _PlayerStatusMonitor_child, null, "f");
    __classPrivateFieldGet(this, _PlayerStatusMonitor_instances, "m", _PlayerStatusMonitor_cancelPendingEmit).call(this);
    if (__classPrivateFieldGet(this, _PlayerStatusMonitor_startReject, "f")) {
        __classPrivateFieldGet(this, _PlayerStatusMonitor_startReject, "f").call(this, new Error(`PlayerStatusMonitor: child process exited unexpectedly (${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''})`));
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startResolve, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startReject, null, "f");
        return;
    }
    this.emit('disconnect', __classPrivateFieldGet(this, _PlayerStatusMonitor_player, "f"));
}, _PlayerStatusMonitor_handleChildError = function _PlayerStatusMonitor_handleChildError(error) {
    SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc] PlayerStatusMonitor: child process error: ', error));
    if (__classPrivateFieldGet(this, _PlayerStatusMonitor_startReject, "f")) {
        __classPrivateFieldGet(this, _PlayerStatusMonitor_startReject, "f").call(this, error);
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startResolve, null, "f");
        __classPrivateFieldSet(this, _PlayerStatusMonitor_startReject, null, "f");
        return;
    }
}, _PlayerStatusMonitor_cancelPendingEmit = function _PlayerStatusMonitor_cancelPendingEmit() {
    if (__classPrivateFieldGet(this, _PlayerStatusMonitor_deferredEmitTimer, "f")) {
        clearTimeout(__classPrivateFieldGet(this, _PlayerStatusMonitor_deferredEmitTimer, "f"));
        __classPrivateFieldSet(this, _PlayerStatusMonitor_deferredEmitTimer, null, "f");
    }
}, _PlayerStatusMonitor_getChildModulePath = function _PlayerStatusMonitor_getChildModulePath() {
    return path_1.default.join(__dirname, 'PlayerStatusMonitorChild.js');
};
exports.default = PlayerStatusMonitor;
