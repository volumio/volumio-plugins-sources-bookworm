"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BaseViewHandler_1 = __importDefault(require("./BaseViewHandler"));
const UIHelper_1 = __importDefault(require("../../../util/UIHelper"));
const ViewHelper_1 = __importDefault(require("./ViewHelper"));
const renderers_1 = require("./renderers");
class ExplodableViewHandler extends BaseViewHandler_1.default {
    async explode() {
        const view = this.currentView;
        if (view.noExplode) {
            return [];
        }
        if (view.explode) {
            const qi = view.explode;
            return [{
                    service: 'bandcamp',
                    uri: ViewHelper_1.default.setUriEmbeddedQueueItem(qi.uri, qi),
                    albumart: qi.albumart,
                    artist: qi.artist,
                    album: qi.album,
                    name: qi.title,
                    title: qi.title
                }];
        }
        const tracks = await this.getTracksOnExplode();
        if (!Array.isArray(tracks)) {
            const trackInfo = await this.parseTrackForExplode(tracks);
            return trackInfo ? [trackInfo] : [];
        }
        const trackInfoPromises = tracks.map((track) => this.parseTrackForExplode(track));
        return (await Promise.all(trackInfoPromises)).filter((song) => song);
    }
    parseTrackForExplode(track) {
        const trackUri = this.getTrackUri(track);
        if (!trackUri) {
            return Promise.resolve(null);
        }
        const trackName = track.streamUrl ? track.name : UIHelper_1.default.addNonPlayableText(track.name);
        return Promise.resolve({
            service: 'bandcamp',
            uri: trackUri,
            albumart: track.thumbnail,
            artist: track.artist?.name,
            album: track.album?.name,
            name: trackName,
            title: trackName,
            duration: track.duration
        });
    }
    /**
     * Track uri:
     * bandcamp/track@trackUrl={trackUrl}@artistUrl={...}@albumUrl={...}@explode={...}
     */
    getTrackUri(track) {
        const trackRenderer = this.getRenderer(renderers_1.RendererType.Track);
        const listItemUri = trackRenderer.renderToListItem(track)?.uri ?? null;
        if (!listItemUri) {
            return null;
        }
        // We expect an 'explode' param in listItemUri. That would be the 
        // URI of the queue item.
        const trackView = ViewHelper_1.default.getViewsFromUri(listItemUri).pop();
        if (trackView?.name !== 'track' || !trackView.explode) {
            return null;
        }
        const qi = trackView.explode;
        return ViewHelper_1.default.setUriEmbeddedQueueItem(qi.uri, qi);
    }
}
exports.default = ExplodableViewHandler;
