"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayController = void 0;
const RP2Context_1 = __importDefault(require("../RP2Context"));
const util_1 = require("../util");
class PlayController {
    /**
     * track.uri:
     * rp2/channel@id=...
     */
    async clearAddPlayTrack(track) {
        RP2Context_1.default.getLogger().info(`[rp2] clearAddPlayTrack: ${track.uri}`);
        const view = (0, util_1.parseUri)(track.uri).pop();
        if (!view || view.name !== 'channel' || !view.params.id) {
            throw Error(`Invalid URI "${track.uri}`);
        }
        const rpjs = RP2Context_1.default.getRpjsLib();
        await rpjs.play(view.params.id);
        if (RP2Context_1.default.getConfigValue('persistSession')) {
            RP2Context_1.default.setConfigValue('sessionData', rpjs.getSessionData());
        }
    }
    async stop() {
        await RP2Context_1.default.getRpjsLib().stop();
    }
    async pause() {
        await RP2Context_1.default.getRpjsLib().pause();
    }
    async resume() {
        await RP2Context_1.default.getRpjsLib().resume();
    }
    async seek(position) {
        await RP2Context_1.default.getRpjsLib().seek(position);
    }
    async play() {
        const rpjs = RP2Context_1.default.getRpjsLib();
        if (rpjs.getStatus().state === 'paused') {
            await rpjs.resume();
        }
    }
    async next() {
        await RP2Context_1.default.getRpjsLib().skip();
    }
    async previous() {
        await RP2Context_1.default.getRpjsLib().seek(0);
    }
}
exports.PlayController = PlayController;
