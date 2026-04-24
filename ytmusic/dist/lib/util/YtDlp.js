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
const YTMusicContext_1 = __importDefault(require("../YTMusicContext"));
const WD = '/data/plugins/music_service/ytmusic/.yt-dlp';
function createYtDlpInstance() {
    return new volumio_yt_dlp_1.YtDlp({
        workingDir: WD,
        cookies: YTMusicContext_1.default.getConfigValue('cookie'),
        logger: {
            info: (msg) => YTMusicContext_1.default.getLogger().info(`[ytmusic] [yt-dlp] ${msg}`),
            warn: (msg) => YTMusicContext_1.default.getLogger().warn(`[ytmusic] [yt-dlp] ${msg}`),
            debug: (msg) => YTMusicContext_1.default.getLogger().verbose(`[ytmusic] [yt-dlp] ${msg}`),
            error: (msg) => YTMusicContext_1.default.getLogger().error(`[ytmusic] [yt-dlp] ${msg}`),
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
        const cookie = YTMusicContext_1.default.getConfigValue('cookie');
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
