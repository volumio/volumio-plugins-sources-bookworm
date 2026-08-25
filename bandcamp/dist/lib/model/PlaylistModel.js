"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _PlaylistModel_instances, _PlaylistModel_getPlaylistsFetchPromise, _PlaylistModel_getPlaylistsFromFetchResult, _PlaylistModel_getNextPageTokenFromPlaylistsFetchResult, _PlaylistModel_convertFetchedPlaylistListItemToEntity, _PlaylistModel_convertFetchedPlaylistToEntity;
Object.defineProperty(exports, "__esModule", { value: true });
const bandcamp_fetch_1 = __importDefault(require("bandcamp-fetch"));
const BandcampContext_1 = __importDefault(require("../BandcampContext"));
const BaseModel_1 = __importDefault(require("./BaseModel"));
const EntityConverter_1 = __importDefault(require("../util/EntityConverter"));
class PlaylistModel extends BaseModel_1.default {
    constructor() {
        super(...arguments);
        _PlaylistModel_instances.add(this);
    }
    getPlaylistCount(fanId) {
        return BandcampContext_1.default.getCache().getOrSet(this.getCacheKeyForFetch('playlistCount', { fanId }), async () => {
            const list = await bandcamp_fetch_1.default.limiter.playlist.list({ fanId });
            return list.total;
        });
    }
    getPlaylists(params) {
        return this.loopFetch({
            callbackParams: { ...params },
            getFetchPromise: __classPrivateFieldGet(this, _PlaylistModel_instances, "m", _PlaylistModel_getPlaylistsFetchPromise).bind(this),
            getItemsFromFetchResult: __classPrivateFieldGet(this, _PlaylistModel_instances, "m", _PlaylistModel_getPlaylistsFromFetchResult).bind(this),
            getNextPageTokenFromFetchResult: __classPrivateFieldGet(this, _PlaylistModel_instances, "m", _PlaylistModel_getNextPageTokenFromPlaylistsFetchResult).bind(this),
            convertToEntity: __classPrivateFieldGet(this, _PlaylistModel_instances, "m", _PlaylistModel_convertFetchedPlaylistListItemToEntity).bind(this),
            pageOffset: params.pageOffset,
            pageToken: params.pageToken,
            limit: params.limit
        });
    }
    async getPlaylist(playlistUrl) {
        const queryParams = {
            playlistUrl,
            artistImageFormat: this.getArtistImageFormat(),
            trackImageFormat: this.getAlbumImageFormat(),
            playlistImageFormat: this.getAlbumImageFormat(),
            curatorImageFormat: this.getArtistImageFormat()
        };
        const playlist = await BandcampContext_1.default.getCache().getOrSet(this.getCacheKeyForFetch('playlist', queryParams), async () => {
            const pl = await bandcamp_fetch_1.default.limiter.playlist.getPlaylist(queryParams);
            if (pl.additionalTrackIds.length > 0) {
                const additionalTracks = await bandcamp_fetch_1.default.limiter.playlist.getAdditionalTracks({ playlist: pl });
                return {
                    ...pl,
                    tracks: [
                        ...pl.tracks,
                        ...additionalTracks
                    ]
                };
            }
            return pl;
        });
        return __classPrivateFieldGet(this, _PlaylistModel_instances, "m", _PlaylistModel_convertFetchedPlaylistToEntity).call(this, playlist);
    }
    getPlaylistCategories() {
        return BandcampContext_1.default.getCache().getOrSet(this.getCacheKeyForFetch('articleCategories'), () => bandcamp_fetch_1.default.limiter.article.getCategories());
    }
}
_PlaylistModel_instances = new WeakSet(), _PlaylistModel_getPlaylistsFetchPromise = function _PlaylistModel_getPlaylistsFetchPromise(params) {
    let continuation = undefined;
    if (params.pageToken) {
        const parsedPageToken = JSON.parse(params.pageToken);
        continuation = parsedPageToken?.continuation || undefined;
    }
    const queryParams = continuation ? {
        continuation,
        imageFormat: this.getAlbumImageFormat()
    } : {
        fanId: params.fanId,
        imageFormat: this.getAlbumImageFormat()
    };
    return BandcampContext_1.default.getCache().getOrSet(this.getCacheKeyForFetch('playlists', queryParams), () => bandcamp_fetch_1.default.limiter.playlist.list(queryParams));
}, _PlaylistModel_getPlaylistsFromFetchResult = function _PlaylistModel_getPlaylistsFromFetchResult(result) {
    return result.items.slice(0);
}, _PlaylistModel_getNextPageTokenFromPlaylistsFetchResult = function _PlaylistModel_getNextPageTokenFromPlaylistsFetchResult(result, params) {
    const continuation = result.continuation;
    let indexRef = 0;
    if (params.pageToken) {
        const parsedPageToken = JSON.parse(params.pageToken);
        indexRef = parsedPageToken?.indexRef || 0;
    }
    if (result.items.length > 0 && result.total > indexRef + result.items.length) {
        const nextPageToken = {
            continuation,
            indexRef: indexRef + result.items.length
        };
        return JSON.stringify(nextPageToken);
    }
    return null;
}, _PlaylistModel_convertFetchedPlaylistListItemToEntity = function _PlaylistModel_convertFetchedPlaylistListItemToEntity(item) {
    return EntityConverter_1.default.convertPlaylistListItem(item);
}, _PlaylistModel_convertFetchedPlaylistToEntity = function _PlaylistModel_convertFetchedPlaylistToEntity(item) {
    return EntityConverter_1.default.convertPlaylist(item);
};
exports.default = PlaylistModel;
