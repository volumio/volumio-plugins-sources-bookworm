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
var _PlayerFinder_instances, _PlayerFinder_status, _PlayerFinder_child, _PlayerFinder_startPromise, _PlayerFinder_startResolve, _PlayerFinder_startReject, _PlayerFinder_handleChildMessage, _PlayerFinder_handleChildExit, _PlayerFinder_handleChildError, _PlayerFinder_getChildModulePath;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerFinderStatus = void 0;
const SqueezeliteMCContext_1 = __importDefault(require("./SqueezeliteMCContext"));
const events_1 = __importDefault(require("events"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const ChildProcessUtils_1 = require("./ChildProcessUtils");
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
        _PlayerFinder_child.set(this, void 0);
        _PlayerFinder_startPromise.set(this, void 0);
        _PlayerFinder_startResolve.set(this, void 0);
        _PlayerFinder_startReject.set(this, void 0);
        __classPrivateFieldSet(this, _PlayerFinder_status, PlayerFinderStatus.Stopped, "f");
        __classPrivateFieldSet(this, _PlayerFinder_child, null, "f");
        __classPrivateFieldSet(this, _PlayerFinder_startPromise, null, "f");
        __classPrivateFieldSet(this, _PlayerFinder_startResolve, null, "f");
        __classPrivateFieldSet(this, _PlayerFinder_startReject, null, "f");
    }
    start(opts = {}) {
        if (__classPrivateFieldGet(this, _PlayerFinder_child, "f")) {
            return __classPrivateFieldGet(this, _PlayerFinder_startPromise, "f") ?? Promise.resolve();
        }
        const childPath = __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_getChildModulePath).call(this);
        SqueezeliteMCContext_1.default.getLogger().verbose(`[squeezelite_mc] PlayerFinder: fork child process at ${childPath}`);
        __classPrivateFieldSet(this, _PlayerFinder_child, (0, child_process_1.fork)(childPath, [], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }), "f");
        __classPrivateFieldSet(this, _PlayerFinder_startPromise, new Promise((resolve, reject) => {
            __classPrivateFieldSet(this, _PlayerFinder_startResolve, resolve, "f");
            __classPrivateFieldSet(this, _PlayerFinder_startReject, reject, "f");
        }), "f");
        __classPrivateFieldGet(this, _PlayerFinder_child, "f").on('message', (message) => {
            __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handleChildMessage).call(this, message);
        });
        __classPrivateFieldGet(this, _PlayerFinder_child, "f").on('exit', (code, signal) => {
            __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handleChildExit).call(this, code, signal);
        });
        __classPrivateFieldGet(this, _PlayerFinder_child, "f").on('error', (error) => {
            __classPrivateFieldGet(this, _PlayerFinder_instances, "m", _PlayerFinder_handleChildError).call(this, error);
        });
        __classPrivateFieldGet(this, _PlayerFinder_child, "f").send({
            type: 'start',
            payload: {
                serverCredentials: opts.serverCredentials,
                eventFilter: opts.eventFilter
            }
        });
        __classPrivateFieldSet(this, _PlayerFinder_status, PlayerFinderStatus.Started, "f");
        return __classPrivateFieldGet(this, _PlayerFinder_startPromise, "f");
    }
    async stop() {
        if (!__classPrivateFieldGet(this, _PlayerFinder_child, "f")) {
            return;
        }
        SqueezeliteMCContext_1.default.getLogger().verbose('[squeezelite_mc] PlayerFinder: stopping child process');
        const child = __classPrivateFieldGet(this, _PlayerFinder_child, "f");
        __classPrivateFieldSet(this, _PlayerFinder_child, null, "f");
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
        __classPrivateFieldSet(this, _PlayerFinder_status, PlayerFinderStatus.Stopped, "f");
    }
    getStatus() {
        return __classPrivateFieldGet(this, _PlayerFinder_status, "f");
    }
    on(eventName, listener) {
        return super.on(eventName, listener);
    }
}
_PlayerFinder_status = new WeakMap(), _PlayerFinder_child = new WeakMap(), _PlayerFinder_startPromise = new WeakMap(), _PlayerFinder_startResolve = new WeakMap(), _PlayerFinder_startReject = new WeakMap(), _PlayerFinder_instances = new WeakSet(), _PlayerFinder_handleChildMessage = function _PlayerFinder_handleChildMessage(message) {
    switch (message.type) {
        case 'log':
            (0, ChildProcessUtils_1.logChildProcessMessage)(message.payload.level, message.payload.message);
            break;
        case 'started':
            SqueezeliteMCContext_1.default.getLogger().verbose('[squeezelite_mc] PlayerFinder: child process started');
            __classPrivateFieldGet(this, _PlayerFinder_startResolve, "f")?.call(this);
            __classPrivateFieldSet(this, _PlayerFinder_startResolve, null, "f");
            __classPrivateFieldSet(this, _PlayerFinder_startReject, null, "f");
            break;
        case 'found':
            this.emit('found', message.payload);
            break;
        case 'lost':
            this.emit('lost', message.payload);
            break;
        case 'error':
            if (__classPrivateFieldGet(this, _PlayerFinder_startReject, "f")) {
                __classPrivateFieldGet(this, _PlayerFinder_startReject, "f").call(this, new Error(message.payload.message));
            }
            else {
                SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc] PlayerFinder: child process error:', message.payload.message));
            }
            this.emit('error', message.payload.message);
            break;
    }
}, _PlayerFinder_handleChildExit = function _PlayerFinder_handleChildExit(code, signal) {
    SqueezeliteMCContext_1.default.getLogger().verbose(`[squeezelite_mc] PlayerFinder: child process exited (code: ${code}; signal: ${signal})`);
    __classPrivateFieldSet(this, _PlayerFinder_child, null, "f");
    if (__classPrivateFieldGet(this, _PlayerFinder_startReject, "f")) {
        __classPrivateFieldGet(this, _PlayerFinder_startReject, "f").call(this, new Error(`PlayerFinder: child process exited unexpectedly (${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''})`));
        __classPrivateFieldSet(this, _PlayerFinder_startResolve, null, "f");
        __classPrivateFieldSet(this, _PlayerFinder_startReject, null, "f");
    }
}, _PlayerFinder_handleChildError = function _PlayerFinder_handleChildError(error) {
    SqueezeliteMCContext_1.default.getLogger().error(SqueezeliteMCContext_1.default.getErrorMessage('[squeezelite_mc] PlayerFinder: child process error: ', error));
    if (__classPrivateFieldGet(this, _PlayerFinder_startReject, "f")) {
        __classPrivateFieldGet(this, _PlayerFinder_startReject, "f").call(this, error);
        __classPrivateFieldSet(this, _PlayerFinder_startResolve, null, "f");
        __classPrivateFieldSet(this, _PlayerFinder_startReject, null, "f");
        return;
    }
}, _PlayerFinder_getChildModulePath = function _PlayerFinder_getChildModulePath() {
    return path_1.default.join(__dirname, 'PlayerFinderChild.js');
};
exports.default = PlayerFinder;
