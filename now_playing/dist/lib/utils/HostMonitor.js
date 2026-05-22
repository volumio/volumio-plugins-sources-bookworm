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
var _HostMonitor_timer, _HostMonitor_host;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostMonitor = void 0;
const events_1 = require("events");
const NowPlayingContext_1 = __importDefault(require("../NowPlayingContext"));
class HostMonitor extends events_1.EventEmitter {
    constructor() {
        super();
        _HostMonitor_timer.set(this, null);
        _HostMonitor_host.set(this, void 0);
        __classPrivateFieldSet(this, _HostMonitor_host, NowPlayingContext_1.default.getDeviceInfo(true).host, "f");
    }
    start() {
        if (__classPrivateFieldGet(this, _HostMonitor_timer, "f")) {
            return;
        }
        __classPrivateFieldSet(this, _HostMonitor_timer, setInterval(() => {
            const { host } = NowPlayingContext_1.default.getDeviceInfo(true);
            const oldHost = __classPrivateFieldGet(this, _HostMonitor_host, "f");
            if (host !== oldHost) {
                __classPrivateFieldSet(this, _HostMonitor_host, host, "f");
                this.emit('change', oldHost, host);
            }
        }, 15000), "f");
    }
    stop() {
        if (__classPrivateFieldGet(this, _HostMonitor_timer, "f")) {
            clearInterval(__classPrivateFieldGet(this, _HostMonitor_timer, "f"));
            __classPrivateFieldSet(this, _HostMonitor_timer, null, "f");
        }
    }
    emit(eventName, ...args) {
        return super.emit(eventName, ...args);
    }
    on(eventName, listener) {
        return super.on(eventName, listener);
    }
    once(eventName, listener) {
        return super.once(eventName, listener);
    }
    off(eventName, listener) {
        return super.off(eventName, listener);
    }
}
exports.HostMonitor = HostMonitor;
_HostMonitor_timer = new WeakMap(), _HostMonitor_host = new WeakMap();
