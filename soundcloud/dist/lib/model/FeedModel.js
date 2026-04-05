"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _FeedModel_instances, _FeedModel_getFeedItemsFetchPromise, _FeedModel_convertFetchedFeedItemToEntity, _FeedModel_onGetFeedItemsLoopFetchEnd;
Object.defineProperty(exports, "__esModule", { value: true });
const BaseModel_1 = __importDefault(require("./BaseModel"));
const soundcloud_fetch_1 = require("soundcloud-fetch");
const Mapper_1 = __importDefault(require("./Mapper"));
const TrackHelper_1 = __importDefault(require("../util/TrackHelper"));
class FeedModel extends BaseModel_1.default {
    constructor() {
        super(...arguments);
        _FeedModel_instances.add(this);
    }
    getFeedItems(params) {
        const getItems = (this.commonGetCollectionItemsFromLoopFetchResult);
        const getNextPageToken = (this.commonGetNextPageTokenFromLoopFetchResult);
        return this.loopFetch({
            callbackParams: { ...params },
            getFetchPromise: __classPrivateFieldGet(this, _FeedModel_instances, "m", _FeedModel_getFeedItemsFetchPromise).bind(this),
            getItemsFromFetchResult: getItems.bind(this),
            getNextPageTokenFromFetchResult: getNextPageToken.bind(this),
            convertToEntity: __classPrivateFieldGet(this, _FeedModel_instances, "m", _FeedModel_convertFetchedFeedItemToEntity).bind(this),
            onEnd: __classPrivateFieldGet(this, _FeedModel_instances, "m", _FeedModel_onGetFeedItemsLoopFetchEnd).bind(this),
            pageToken: params.pageToken,
            pageOffset: params.pageOffset,
            limit: params.limit
        });
    }
}
_FeedModel_instances = new WeakSet(), _FeedModel_getFeedItemsFetchPromise = async function _FeedModel_getFeedItemsFetchPromise(params) {
    const api = this.getSoundCloudAPI();
    const continuationContents = await this.commonGetLoopFetchResultByPageToken(params);
    if (continuationContents) {
        return continuationContents;
    }
    const queryParams = {
        activityTypes: params.activityTypes,
        limit: soundcloud_fetch_1.Constants.QUERY_MAX_LIMIT
    };
    return api.me.getFeed(queryParams);
}, _FeedModel_convertFetchedFeedItemToEntity = async function _FeedModel_convertFetchedFeedItemToEntity(item) {
    const wrappedItem = item.item;
    if (wrappedItem instanceof soundcloud_fetch_1.Album) {
        return Mapper_1.default.mapAlbum(wrappedItem);
    }
    else if (wrappedItem instanceof soundcloud_fetch_1.Playlist) {
        return Mapper_1.default.mapPlaylist(wrappedItem);
    }
    else if (wrappedItem instanceof soundcloud_fetch_1.Track) {
        return Mapper_1.default.mapTrack(wrappedItem);
    }
    return null;
}, _FeedModel_onGetFeedItemsLoopFetchEnd = function _FeedModel_onGetFeedItemsLoopFetchEnd(result) {
    const tracks = result.items.filter((item) => item.type === 'track');
    TrackHelper_1.default.cacheTracks(tracks, this.getCacheKeyForFetch.bind(this, 'track'));
    return result;
};
exports.default = FeedModel;
//# sourceMappingURL=FeedModel.js.map