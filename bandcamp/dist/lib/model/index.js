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
var _a, _Model_logger;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelType = void 0;
const bandcamp_fetch_1 = __importDefault(require("bandcamp-fetch"));
const AlbumModel_1 = __importDefault(require("./AlbumModel"));
const ArticleModel_1 = __importDefault(require("./ArticleModel"));
const BandModel_1 = __importDefault(require("./BandModel"));
const DiscoverModel_1 = __importDefault(require("./DiscoverModel"));
const FanModel_1 = __importDefault(require("./FanModel"));
const SearchModel_1 = __importDefault(require("./SearchModel"));
const ShowModel_1 = __importDefault(require("./ShowModel"));
const TagModel_1 = __importDefault(require("./TagModel"));
const TrackModel_1 = __importDefault(require("./TrackModel"));
const BandcampContext_1 = __importDefault(require("../BandcampContext"));
const PlaylistModel_1 = __importDefault(require("./PlaylistModel"));
var ModelType;
(function (ModelType) {
    ModelType["Album"] = "Album";
    ModelType["Article"] = "Article";
    ModelType["Band"] = "Band";
    ModelType["Discover"] = "Discover";
    ModelType["Fan"] = "Fan";
    ModelType["Search"] = "Search";
    ModelType["Show"] = "Show";
    ModelType["Tag"] = "Tag";
    ModelType["Track"] = "Track";
    ModelType["Playlist"] = "Playlist";
})(ModelType || (exports.ModelType = ModelType = {}));
const MODEL_TYPE_TO_CLASS = {
    [ModelType.Album]: AlbumModel_1.default,
    [ModelType.Article]: ArticleModel_1.default,
    [ModelType.Band]: BandModel_1.default,
    [ModelType.Discover]: DiscoverModel_1.default,
    [ModelType.Fan]: FanModel_1.default,
    [ModelType.Search]: SearchModel_1.default,
    [ModelType.Show]: ShowModel_1.default,
    [ModelType.Tag]: TagModel_1.default,
    [ModelType.Track]: TrackModel_1.default,
    [ModelType.Playlist]: PlaylistModel_1.default
};
class Model {
    static getInstance(type) {
        if (MODEL_TYPE_TO_CLASS[type]) {
            return new MODEL_TYPE_TO_CLASS[type]();
        }
        throw Error(`Model not found for type ${String(type)}`);
    }
    static setCookie(value) {
        bandcamp_fetch_1.default.setCookie(value);
    }
    static get cookie() {
        return bandcamp_fetch_1.default.cookie;
    }
    static setLogDebugMessages(value) {
        if (value) {
            bandcamp_fetch_1.default.setLogger(__classPrivateFieldGet(this, _a, "f", _Model_logger));
        }
        else {
            bandcamp_fetch_1.default.setLogger(null);
        }
    }
    static reset() {
        bandcamp_fetch_1.default.setCookie();
        this.clearLibCache();
    }
    static clearLibCache() {
        bandcamp_fetch_1.default.cache.clear();
    }
    static async ensureStreamURL(url) {
        const testResult = await bandcamp_fetch_1.default.stream.test(url);
        if (testResult.ok) {
            return url;
        }
        return await bandcamp_fetch_1.default.stream.refresh(url);
    }
}
_a = Model;
_Model_logger = { value: void 0 };
(() => {
    bandcamp_fetch_1.default.setPuppeteerExecutablePath('/usr/bin/chromium-headless-shell');
    __classPrivateFieldSet(_a, _a, {
        info: (msg) => BandcampContext_1.default.getLogger().info(`[bandcamp] (bcfetch) ${msg}`),
        warn: (msg) => BandcampContext_1.default.getLogger().warn(`[bandcamp] (bcfetch) ${msg}`),
        debug: (msg) => BandcampContext_1.default.getLogger().verbose(`[bandcamp] (bcfetch) ${msg}`),
        error: (msg) => BandcampContext_1.default.getLogger().error(`[bandcamp] (bcfetch) ${msg}`)
    }, "f", _Model_logger);
})();
exports.default = Model;
