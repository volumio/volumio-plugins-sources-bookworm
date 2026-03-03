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
var _StateTransformer_status;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateTransformer = void 0;
const RP2Context_1 = __importDefault(require("../RP2Context"));
class StateTransformer {
    constructor() {
        _StateTransformer_status.set(this, null);
    }
    setRpjsStatus(status) {
        __classPrivateFieldSet(this, _StateTransformer_status, status, "f");
    }
    modifyVolatileSeekBeforeSet(playerTime) {
        if (!__classPrivateFieldGet(this, _StateTransformer_status, "f") || !__classPrivateFieldGet(this, _StateTransformer_status, "f").channel || !__classPrivateFieldGet(this, _StateTransformer_status, "f").track) {
            return playerTime;
        }
        const { track } = __classPrivateFieldGet(this, _StateTransformer_status, "f");
        if (!track.duration) {
            return 0;
        }
        return Math.max(0, playerTime - track.positionInStream);
    }
    transformStateBeforePush(state) {
        if (!__classPrivateFieldGet(this, _StateTransformer_status, "f") || !__classPrivateFieldGet(this, _StateTransformer_status, "f").channel || !__classPrivateFieldGet(this, _StateTransformer_status, "f").track) {
            return state;
        }
        const { track, channel } = __classPrivateFieldGet(this, _StateTransformer_status, "f");
        const positionInTrack = state.seek && track.duration ? state.seek - track.positionInStream : 0;
        const transformed = {
            ...state,
            uri: `rp2/channel@id=${encodeURIComponent(channel.id)}`,
            title: track.title ?? channel.title,
            artist: track.artist ?? RP2Context_1.default.getI18n('RP2_RP'),
            album: track.album ?? undefined,
            albumart: track.cover.large ||
                track.cover.medium ||
                track.cover.small ||
                undefined,
            seek: positionInTrack,
            duration: track.duration ? track.duration / 1000 : 0,
            trackType: track.format ?? state.trackType,
            bitrate: track.bitrate ?? state.bitrate,
            stream: !track.duration,
            random: false,
            repeat: false
        };
        if (transformed.bitrate) {
            // The following ensures the bitrate will be shown.
            transformed.samplerate = transformed.bitrate;
            transformed.bitrate = undefined;
            transformed.bitdepth = undefined;
        }
        return transformed;
    }
}
exports.StateTransformer = StateTransformer;
_StateTransformer_status = new WeakMap();
