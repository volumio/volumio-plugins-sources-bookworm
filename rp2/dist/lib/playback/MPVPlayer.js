"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _MPVPlayer_instances, _MPVPlayer_service, _MPVPlayer_getService, _MPVPlayer_startMpv;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MPVPlayer = void 0;
const volumio_ext_players_1 = require("volumio-ext-players");
const RP2Context_1 = __importDefault(require("../RP2Context"));
const rp_js_1 = require("@patrickkfkan/rp.js");
class MPVPlayer extends rp_js_1.Player {
    constructor() {
        super(...arguments);
        _MPVPlayer_instances.add(this);
        _MPVPlayer_service.set(this, null);
        this.getPosition = () => {
            return (this.getStatus()?.time ?? 0) * 1000;
        };
    }
    async play(url, position) {
        const service = await __classPrivateFieldGet(this, _MPVPlayer_instances, "m", _MPVPlayer_getService).call(this);
        if (!service) {
            return;
        }
        await service.play({
            uri: url,
            streamUrl: url
        }, position / 1000);
        this.notifyPlaying((service.getStatus()?.time || 0) * 1000);
    }
    async pause() {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_PLAYER_GONE'));
            return;
        }
        await __classPrivateFieldGet(this, _MPVPlayer_service, "f").pause();
        this.notifyPaused((__classPrivateFieldGet(this, _MPVPlayer_service, "f").getStatus()?.time || 0) * 1000);
    }
    async resume() {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_PLAYER_GONE'));
            return;
        }
        await __classPrivateFieldGet(this, _MPVPlayer_service, "f").resume();
        this.notifyPlaying((__classPrivateFieldGet(this, _MPVPlayer_service, "f").getStatus()?.time || 0) * 1000);
    }
    async seek(position) {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_PLAYER_GONE'));
            return;
        }
        await __classPrivateFieldGet(this, _MPVPlayer_service, "f").seek(position / 1000);
        this.notifySeeked((__classPrivateFieldGet(this, _MPVPlayer_service, "f").getStatus()?.time || 0) * 1000);
    }
    async stop() {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_PLAYER_GONE'));
            return;
        }
        await __classPrivateFieldGet(this, _MPVPlayer_service, "f").stop();
        this.notifyStopped();
    }
    async quit() {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_PLAYER_GONE'));
            return;
        }
        await __classPrivateFieldGet(this, _MPVPlayer_service, "f").quit();
    }
    getStatus() {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_PLAYER_GONE'));
            return null;
        }
        return __classPrivateFieldGet(this, _MPVPlayer_service, "f").getStatus();
    }
    pushState() {
        if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
            return;
        }
        __classPrivateFieldGet(this, _MPVPlayer_service, "f").pushState();
    }
}
exports.MPVPlayer = MPVPlayer;
_MPVPlayer_service = new WeakMap(), _MPVPlayer_instances = new WeakSet(), _MPVPlayer_getService = async function _MPVPlayer_getService() {
    if (!__classPrivateFieldGet(this, _MPVPlayer_service, "f")) {
        RP2Context_1.default.getLogger().info(`[rp2] Starting mpv`);
        try {
            const p = await __classPrivateFieldGet(this, _MPVPlayer_instances, "m", _MPVPlayer_startMpv).call(this);
            p.once('close', (code) => {
                if (code && code !== 0) {
                    RP2Context_1.default.toast('warning', RP2Context_1.default.getI18n('RP2_PLAYER_CLOSED_UNEXPECTEDLY', 'mpv'));
                }
                RP2Context_1.default.getLogger().info(`[rp2] mpv process closed`);
                __classPrivateFieldGet(this, _MPVPlayer_service, "f")?.removeAllListeners();
                __classPrivateFieldSet(this, _MPVPlayer_service, null, "f");
            });
            p.on('unsetVolatile', () => {
                console.log('MPVPlayer onunsetVolatile called');
                if (this.onUnsetVolatile) {
                    console.log('MPVPlayer calling onunsetVolatile callbacks');
                    this.onUnsetVolatile();
                }
            });
            __classPrivateFieldSet(this, _MPVPlayer_service, p, "f");
            return p;
        }
        catch (error) {
            RP2Context_1.default.toast('error', RP2Context_1.default.getErrorMessage(RP2Context_1.default.getI18n('RP2_ERR_PLAYER_START', 'mpv'), error));
            return null;
        }
    }
    return __classPrivateFieldGet(this, _MPVPlayer_service, "f");
}, _MPVPlayer_startMpv = async function _MPVPlayer_startMpv() {
    RP2Context_1.default.toast('info', RP2Context_1.default.getI18n('RP2_STARTING_PLAYER', 'mpv'));
    try {
        const mpv = new volumio_ext_players_1.MPVService({
            serviceName: 'rp2',
            logger: RP2Context_1.default.getLogger(),
            volumio: {
                commandRouter: RP2Context_1.default.volumioCoreCommand,
                mpdPlugin: RP2Context_1.default.getMpdPlugin(),
                statemachine: RP2Context_1.default.getStateMachine(),
                stateTransformer: RP2Context_1.default.getStateTransformer(),
                unsetVolatileOnStop: 'manual'
            }
        });
        mpv.on('status', (status) => {
            if (status.state === 'stopped') {
                this.notifyStopped();
            }
        });
        await mpv.start();
        return mpv;
    }
    catch (error) {
        throw Error(RP2Context_1.default.getErrorMessage(RP2Context_1.default.getI18n('RP2_ERR_PLAYER_START', 'mpv'), error));
    }
};
