"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _PlaylistViewHandler_instances, _PlaylistViewHandler_browseList, _PlaylistViewHandler_getPlaylistList, _PlaylistViewHandler_browsePlaylist;
Object.defineProperty(exports, "__esModule", { value: true });
const BandcampContext_1 = __importDefault(require("../../../BandcampContext"));
const model_1 = require("../../../model");
const renderers_1 = require("./renderers");
const ExplodableViewHandler_1 = __importDefault(require("./ExplodableViewHandler"));
class PlaylistViewHandler extends ExplodableViewHandler_1.default {
    constructor() {
        super(...arguments);
        _PlaylistViewHandler_instances.add(this);
    }
    browse() {
        const view = this.currentView;
        if (view.playlistUrl) {
            return __classPrivateFieldGet(this, _PlaylistViewHandler_instances, "m", _PlaylistViewHandler_browsePlaylist).call(this, view.playlistUrl);
        }
        return __classPrivateFieldGet(this, _PlaylistViewHandler_instances, "m", _PlaylistViewHandler_browseList).call(this);
    }
    async getTracksOnExplode() {
        const playlistUrl = this.currentView.playlistUrl;
        if (!playlistUrl) {
            throw Error('No playlistUrl specified');
        }
        const model = this.getModel(model_1.ModelType.Playlist);
        const playlistInfo = await model.getPlaylist(playlistUrl);
        const playlistTracks = playlistInfo.tracks;
        return playlistTracks || [];
    }
}
_PlaylistViewHandler_instances = new WeakSet(), _PlaylistViewHandler_browseList = async function _PlaylistViewHandler_browseList() {
    const lists = [];
    const playlistList = await __classPrivateFieldGet(this, _PlaylistViewHandler_instances, "m", _PlaylistViewHandler_getPlaylistList).call(this);
    lists.push(playlistList);
    return {
        navigation: {
            prev: { uri: this.constructPrevUri() },
            lists
        }
    };
}, _PlaylistViewHandler_getPlaylistList = async function _PlaylistViewHandler_getPlaylistList() {
    const view = this.currentView;
    const fanModel = this.getModel(model_1.ModelType.Fan);
    let me;
    try {
        const meType = BandcampContext_1.default.getConfigValue('myBandcampType', 'cookie');
        const myCookie = BandcampContext_1.default.getConfigValue('myCookie', '');
        const myUsername = BandcampContext_1.default.getConfigValue('myUsername', '');
        if (meType === 'cookie' && myCookie) {
            me = await fanModel.getInfo();
        }
        else if (meType === 'username' && myUsername) {
            me = await fanModel.getInfo(myUsername);
        }
        else {
            me = null;
        }
    }
    catch (_) {
        me = null;
    }
    let username = view.username;
    const fanInfo = username ? await fanModel.getInfo(username) : null;
    const fanId = fanInfo?.fanId ?? me?.fanId;
    if (!fanId) {
        throw Error('Invalid request: no user specified or found');
    }
    let title;
    if (me && me.fanId === fanId) {
        title = BandcampContext_1.default.getI18n('BANDCAMP_MY_PLAYLISTS');
    }
    else if (fanInfo?.name || fanInfo?.username) {
        title = BandcampContext_1.default.getI18n('BANDCAMP_USER_PLAYLISTS', fanInfo.name || fanInfo.username);
    }
    else {
        title = undefined;
    }
    const modelParams = {
        fanId,
        limit: view.inSection ? BandcampContext_1.default.getConfigValue('itemsPerSection', 5) : BandcampContext_1.default.getConfigValue('itemsPerPage', 47)
    };
    if (view.pageRef) {
        modelParams.pageToken = view.pageRef.pageToken;
        modelParams.pageOffset = view.pageRef.pageOffset;
    }
    const playlistList = await this.getModel(model_1.ModelType.Playlist).getPlaylists(modelParams);
    const playlistRenderer = this.getRenderer(renderers_1.RendererType.Playlist);
    const listItems = playlistList.items.reduce((result, playlist) => {
        const rendered = playlistRenderer.renderToListItem(playlist);
        if (rendered) {
            result.push(rendered);
        }
        return result;
    }, []);
    const nextPageRef = this.constructPageRef(playlistList.nextPageToken, playlistList.nextPageOffset);
    if (nextPageRef) {
        const nextUri = this.constructNextUri(nextPageRef);
        listItems.push(this.constructNextPageItem(nextUri));
    }
    return {
        title,
        availableListViews: ['list', 'grid'],
        items: listItems
    };
}, _PlaylistViewHandler_browsePlaylist = async function _PlaylistViewHandler_browsePlaylist(playlistUrl) {
    const playlist = await this.getModel(model_1.ModelType.Playlist).getPlaylist(playlistUrl);
    const playlistRenderer = this.getRenderer(renderers_1.RendererType.Playlist);
    const trackRenderer = this.getRenderer(renderers_1.RendererType.Track);
    const trackItems = playlist.tracks?.reduce((result, track, i) => {
        const parsed = trackRenderer.renderToListItem(track);
        if (parsed) {
            result.push(parsed);
        }
        return result;
    }, []);
    const header = playlistRenderer.renderToHeader(playlist);
    const page = {
        navigation: {
            prev: { uri: this.constructPrevUri() },
            info: header,
            lists: [{
                    availableListViews: ['list'],
                    items: trackItems || []
                }]
        }
    };
    return page;
};
exports.default = PlaylistViewHandler;
