"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLUGIN_CONFIG_SCHEMA = void 0;
exports.getAudioQualityOptions = getAudioQualityOptions;
const rp_js_1 = require("@patrickkfkan/rp.js");
const RP2Context_1 = __importDefault(require("../RP2Context"));
exports.PLUGIN_CONFIG_SCHEMA = {
    audioQuality: { defaultValue: rp_js_1.AudioQuality.Flac, json: false },
    persistSession: { defaultValue: true, json: false },
    sessionData: { defaultValue: null, json: false }
};
function getAudioQualityOptions() {
    return [
        {
            label: RP2Context_1.default.getI18n('RP2_LOW'),
            value: rp_js_1.AudioQuality.Low
        },
        {
            label: RP2Context_1.default.getI18n('RP2_MED'),
            value: rp_js_1.AudioQuality.Med
        },
        {
            label: RP2Context_1.default.getI18n('RP2_HIGH'),
            value: rp_js_1.AudioQuality.High
        },
        {
            label: RP2Context_1.default.getI18n('RP2_ULTRA'),
            value: rp_js_1.AudioQuality.Ultra
        },
        {
            label: RP2Context_1.default.getI18n('RP2_FLAC'),
            value: rp_js_1.AudioQuality.Flac
        }
    ];
}
