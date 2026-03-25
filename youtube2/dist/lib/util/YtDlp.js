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
var _a, _YtDlpWrapper_ytDlp;
Object.defineProperty(exports, "__esModule", { value: true });
exports.YtDlpWrapper = void 0;
const volumio_yt_dlp_1 = require("volumio-yt-dlp");
const YouTube2Context_1 = __importDefault(require("../YouTube2Context"));
const WD = '/data/plugins/music_service/youtube2/.yt-dlp';
function createYtDlpInstance() {
    return new volumio_yt_dlp_1.YtDlp({
        workingDir: WD,
        cookies: YouTube2Context_1.default.getConfigValue('cookie'),
        logger: {
            info: (msg) => YouTube2Context_1.default.getLogger().info(`[youtube2] [yt-dlp] ${msg}`),
            warn: (msg) => YouTube2Context_1.default.getLogger().warn(`[youtube2] [yt-dlp] ${msg}`),
            debug: (msg) => YouTube2Context_1.default.getLogger().verbose(`[youtube2] [yt-dlp] ${msg}`),
            error: (msg) => YouTube2Context_1.default.getLogger().error(`[youtube2] [yt-dlp] ${msg}`),
        }
    });
}
class YtDlpWrapper {
    static getInstance() {
        if (!__classPrivateFieldGet(this, _a, "f", _YtDlpWrapper_ytDlp)) {
            __classPrivateFieldSet(this, _a, createYtDlpInstance(), "f", _YtDlpWrapper_ytDlp);
        }
        return __classPrivateFieldGet(this, _a, "f", _YtDlpWrapper_ytDlp);
    }
    static refresh() {
        const ytDlp = this.getInstance();
        const cookie = YouTube2Context_1.default.getConfigValue('cookie');
        if (cookie) {
            ytDlp.setCookies(cookie);
        }
        else {
            ytDlp.setCookies(null);
        }
    }
}
exports.YtDlpWrapper = YtDlpWrapper;
_a = YtDlpWrapper;
_YtDlpWrapper_ytDlp = { value: null };
