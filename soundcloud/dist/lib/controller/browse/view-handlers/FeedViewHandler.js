"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _FeedViewHandler_instances, _FeedViewHandler_getRenderer;
Object.defineProperty(exports, "__esModule", { value: true });
const SoundCloudContext_1 = __importDefault(require("../../../SoundCloudContext"));
const model_1 = require("../../../model");
const BaseViewHandler_1 = __importDefault(require("./BaseViewHandler"));
const renderers_1 = require("./renderers");
class FeedViewHandler extends BaseViewHandler_1.default {
    constructor() {
        super(...arguments);
        _FeedViewHandler_instances.add(this);
    }
    async browse() {
        const { pageRef } = this.currentView;
        const pageToken = pageRef?.pageToken;
        const pageOffset = pageRef?.pageOffset;
        const modelParams = { activityTypes: ['TrackPost', 'TrackRepost'] };
        if (pageToken) {
            modelParams.pageToken = pageRef.pageToken;
        }
        if (pageOffset) {
            modelParams.pageOffset = pageRef.pageOffset;
        }
        modelParams.limit = SoundCloudContext_1.default.getConfigValue('itemsPerPage');
        const items = await this.getModel(model_1.ModelType.Feed).getFeedItems(modelParams);
        const page = this.buildPageFromLoopFetchResult(items, {
            getRenderer: __classPrivateFieldGet(this, _FeedViewHandler_instances, "m", _FeedViewHandler_getRenderer).bind(this),
            title: SoundCloudContext_1.default.getI18n('SOUNDCLOUD_LIST_TITLE_FEED')
        });
        return page;
    }
}
_FeedViewHandler_instances = new WeakSet(), _FeedViewHandler_getRenderer = function _FeedViewHandler_getRenderer(item) {
    if (item.type === 'album') {
        return this.getRenderer(renderers_1.RendererType.Album);
    }
    else if (item.type === 'playlist' || item.type === 'system-playlist') {
        return this.getRenderer(renderers_1.RendererType.Playlist);
    }
    else if (item.type === 'track') {
        return this.getRenderer(renderers_1.RendererType.Track);
    }
    return null;
};
exports.default = FeedViewHandler;
//# sourceMappingURL=FeedViewHandler.js.map