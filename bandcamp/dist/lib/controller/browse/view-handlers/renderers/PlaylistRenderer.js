"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _PlaylistRenderer_instances, _PlaylistRenderer_getSummary, _PlaylistRenderer_durationFormat;
Object.defineProperty(exports, "__esModule", { value: true });
const BaseRenderer_1 = __importDefault(require("./BaseRenderer"));
const ViewHelper_1 = __importDefault(require("../ViewHelper"));
const BandcampContext_1 = __importDefault(require("../../../../BandcampContext"));
const DEFAULT_ICON = '/albumart?sourceicon=music_service/mpd/playlisticon.png';
class PlaylistRenderer extends BaseRenderer_1.default {
    constructor() {
        super(...arguments);
        _PlaylistRenderer_instances.add(this);
    }
    renderToListItem(data) {
        if (!data.url) {
            return null;
        }
        const playlistView = {
            name: 'playlist',
            playlistUrl: data.url
        };
        return {
            service: 'bandcamp',
            type: 'folder',
            title: data.title,
            artist: data.modifiedDate,
            album: __classPrivateFieldGet(this, _PlaylistRenderer_instances, "m", _PlaylistRenderer_getSummary).call(this, data),
            albumart: data.imageUrl || DEFAULT_ICON,
            uri: `${this.uri}/${ViewHelper_1.default.constructUriSegmentFromView(playlistView)}`
        };
    }
    renderToHeader(data) {
        return {
            uri: this.uri,
            service: 'bandcamp',
            type: 'song',
            title: data.title,
            genre: BandcampContext_1.default.getI18n('BANDCAMP_N_TRACKS', data.numTracks),
            artist: data.description,
            albumart: data.imageUrl || DEFAULT_ICON,
            year: data.modifiedDate,
            duration: __classPrivateFieldGet(this, _PlaylistRenderer_instances, "m", _PlaylistRenderer_durationFormat).call(this, data.duration)
        };
    }
}
_PlaylistRenderer_instances = new WeakSet(), _PlaylistRenderer_getSummary = function _PlaylistRenderer_getSummary(data) {
    const duration = __classPrivateFieldGet(this, _PlaylistRenderer_instances, "m", _PlaylistRenderer_durationFormat).call(this, data.duration);
    return duration ?
        BandcampContext_1.default.getI18n('BANDCAMP_N_TRACKS_DURATION', data.numTracks, duration)
        : BandcampContext_1.default.getI18n('BANDCAMP_N_TRACKS', data.numTracks);
}, _PlaylistRenderer_durationFormat = function _PlaylistRenderer_durationFormat(duration) {
    if (duration) {
        // Hours, minutes and seconds
        const hrs = ~~(duration / 3600);
        const mins = ~~((duration % 3600) / 60);
        const secs = ~~duration % 60;
        if (hrs === 0 && mins === 0 && secs === 0) {
            return null;
        }
        if (hrs === 0 && mins === 0 && secs > 0) {
            return BandcampContext_1.default.getI18n('BANDCAMP_N_SECONDS', secs);
        }
        if (hrs === 0 && mins > 0) {
            return BandcampContext_1.default.getI18n('BANDCAMP_N_MINUTES', mins);
        }
        if (hrs > 0 && mins === 0) {
            return BandcampContext_1.default.getI18n('BANDCAMP_N_HOURS', hrs);
        }
        return BandcampContext_1.default.getI18n('BANDCAMP_N_HOURS_MINS', hrs, mins);
    }
    return null;
};
exports.default = PlaylistRenderer;
