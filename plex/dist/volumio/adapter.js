"use strict";
/**
 * Volumio Adapter — integration layer that implements Volumio's music service
 * plugin interface and delegates to PlexService for content resolution.
 *
 * Uses kew promises (via libQ) as required by Volumio's plugin contract.
 * Playback is delegated to Volumio's MPD plugin via consume mode.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VolumioAdapter = void 0;
const api_client_js_1 = require("../plex/api-client.js");
const plex_service_js_1 = require("../plex/plex-service.js");
const uri_utils_js_1 = require("./uri-utils.js");
const browse_handlers_js_1 = require("./browse-handlers.js");
const SERVICE_NAME = "plex";
const DEFAULT_PAGE_SIZE = 100;
/** Convert a native Promise to a kew promise (required by Volumio). */
function jsPromiseToKew(libQ, promise) {
    const defer = libQ.defer();
    promise.then((result) => defer.resolve(result), (error) => defer.reject(error));
    return defer.promise;
}
class VolumioAdapter {
    constructor(context, libQ) {
        this.plexService = null;
        this.connection = null;
        this.shuffleEnabled = false;
        this.pageSize = DEFAULT_PAGE_SIZE;
        this.gaplessPlayback = true;
        this.crossfadeEnabled = false;
        this.crossfadeDuration = 5;
        this.originalServicePushState = null;
        this.currentQuality = {};
        this.browseSource = {
            name: "Plex",
            uri: "plex",
            plugin_type: "music_service",
            plugin_name: SERVICE_NAME,
            albumart: "/albumart?sourceicon=music_service/plex/plex.png",
        };
        this.commandRouter = context.coreCommand;
        this.logger = context.logger;
        this.libQ = libQ;
    }
    // ── Lifecycle ──────────────────────────────────────────────────────
    /** Called when Volumio starts — load config, instantiate Plex client. */
    onVolumioStart() {
        this.logger.info("[Plex] onVolumioStart");
        const host = "localhost";
        const port = 32400;
        const token = "";
        this.connection = { host, port, token };
        const apiClient = new api_client_js_1.PlexApiClient({ host, port, token });
        this.plexService = new plex_service_js_1.PlexService(apiClient, this.connection);
        return this.libQ.resolve();
    }
    /** Called when the plugin is enabled — register browse source. */
    onStart() {
        this.logger.info("[Plex] onStart");
        this.commandRouter.volumioAddToBrowseSources(this.browseSource);
        this.installStateMaskHook();
        return this.libQ.resolve();
    }
    /** Called when the plugin is disabled — remove browse source, clean up. */
    onStop() {
        this.logger.info("[Plex] onStop");
        this.commandRouter.volumioRemoveToBrowseSources(this.browseSource);
        this.removeStateMaskHook();
        this.plexService = null;
        this.connection = null;
        return this.libQ.resolve();
    }
    /** Return the list of configuration files for this plugin. */
    getConfigurationFiles() {
        return ["config.json"];
    }
    // ── Configure (for external config injection in tests/setup) ───────
    /** Set up the PlexService and connection from external config. */
    configure(plexService, connection, options) {
        this.plexService = plexService;
        this.connection = connection;
        this.shuffleEnabled = options?.shuffle ?? false;
        this.pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
        this.gaplessPlayback = options?.gaplessPlayback ?? true;
        this.crossfadeEnabled = options?.crossfadeEnabled ?? false;
        this.crossfadeDuration = options?.crossfadeDuration ?? 5;
    }
    // ── Browse ─────────────────────────────────────────────────────────
    /**
     * Handle browse navigation. URI scheme:
     * - plex                          → root (Artists, Albums, Playlists)
     * - plex/artists                  → artists (first page)
     * - plex/artists@{libKey}:{offset}→ artists (paginated)
     * - plex/artist/{albumsKey}       → albums by artist (+ popular tracks folder)
     * - plex/popular/{artistId}       → popular tracks for artist
     * - plex/albums                   → albums (first page)
     * - plex/albums@{libKey}:{offset} → albums (paginated)
     * - plex/album/{trackListKey}     → tracks in album
     * - plex/playlists                → list playlists
     * - plex/playlist/{itemsKey}      → tracks in playlist (first page)
     * - plex/playlist/{itemsKey}@{offset} → tracks in playlist (paginated)
     * - plex/shuffle-album/{key}      → shuffled album tracks
     * - plex/shuffle-playlist/{key}   → shuffled playlist tracks
     */
    handleBrowseUri(uri) {
        this.logger.info(`[Plex] handleBrowseUri: ${uri}`);
        return jsPromiseToKew(this.libQ, this._handleBrowseUri(uri));
    }
    async _handleBrowseUri(uri) {
        const service = this.requireService();
        const parts = uri.split("/");
        const options = { pageSize: this.pageSize, shuffleEnabled: this.shuffleEnabled };
        // plex
        if (uri === "plex") {
            return (0, browse_handlers_js_1.browseRoot)();
        }
        // plex/artists or plex/artists@{libKey}:{offset}
        if (uri === "plex/artists" || uri.startsWith("plex/artists@")) {
            return (0, browse_handlers_js_1.browseArtists)(service, (0, uri_utils_js_1.parsePaginationUri)(uri), options);
        }
        // plex/albums or plex/albums@{libKey}:{offset}
        if (uri === "plex/albums" || uri.startsWith("plex/albums@")) {
            return (0, browse_handlers_js_1.browseAlbums)(service, (0, uri_utils_js_1.parsePaginationUri)(uri), options);
        }
        // plex/playlists
        if (uri === "plex/playlists") {
            return (0, browse_handlers_js_1.browsePlaylists)(service);
        }
        // plex/artist/{albumsKey...}  (key may contain slashes, encoded as __)
        if (parts[1] === "artist" && parts[2]) {
            const albumsKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            return (0, browse_handlers_js_1.browseArtist)(service, albumsKey);
        }
        // plex/popular/{artistId}
        if (parts[1] === "popular" && parts[2]) {
            return (0, browse_handlers_js_1.browsePopularTracks)(service, parts[2]);
        }
        // plex/shuffle-album/{trackListKey...}
        if (parts[1] === "shuffle-album" && parts[2]) {
            const trackListKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            return (0, browse_handlers_js_1.browseShuffleAlbum)(service, trackListKey);
        }
        // plex/shuffle-playlist/{itemsKey...}
        if (parts[1] === "shuffle-playlist" && parts[2]) {
            const itemsKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            return (0, browse_handlers_js_1.browseShufflePlaylist)(service, itemsKey);
        }
        // plex/album/{trackListKey...}  (key may contain slashes, encoded as __)
        if (parts[1] === "album" && parts[2]) {
            const trackListKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            return (0, browse_handlers_js_1.browseAlbum)(service, trackListKey, options);
        }
        // plex/playlist/{itemsKey...} or plex/playlist/{itemsKey...}@{offset}
        if (parts[1] === "playlist" && parts[2]) {
            const raw = parts.slice(2).join("/");
            const atIndex = raw.indexOf("@");
            if (atIndex === -1) {
                return (0, browse_handlers_js_1.browsePlaylist)(service, (0, uri_utils_js_1.decodePathSegment)(raw), 0, options);
            }
            const itemsKey = (0, uri_utils_js_1.decodePathSegment)(raw.slice(0, atIndex));
            const offset = parseInt(raw.slice(atIndex + 1), 10) || 0;
            return (0, browse_handlers_js_1.browsePlaylist)(service, itemsKey, offset, options);
        }
        throw new Error(`Unknown browse URI: ${uri}`);
    }
    // ── Explode (resolve URI to queue items) ───────────────────────────
    /** Resolve a URI to QueueItem[] for Volumio's queue. */
    explodeUri(uri) {
        this.logger.info(`[Plex] explodeUri: ${uri}`);
        return jsPromiseToKew(this.libQ, this._explodeUri(uri));
    }
    async _explodeUri(uri) {
        const service = this.requireService();
        const parts = uri.split("/");
        // plex/track/{trackId}
        if (parts[1] === "track" && parts[2]) {
            const playable = await service.getPlayableTrack(parts[2]);
            return [this.trackToQueueItem(service, playable)];
        }
        // plex/popular/{artistId}
        if (parts[1] === "popular" && parts[2]) {
            const tracks = await service.getPopularTracks(parts[2]);
            return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
        }
        // plex/shuffle-album/{trackListKey...}
        if (parts[1] === "shuffle-album" && parts[2]) {
            const trackListKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            const tracks = await service.getAlbumTracks(trackListKey);
            (0, uri_utils_js_1.shuffleArray)(tracks);
            return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
        }
        // plex/shuffle-playlist/{itemsKey...}
        if (parts[1] === "shuffle-playlist" && parts[2]) {
            const itemsKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            const tracks = await service.getPlaylistTracks(itemsKey);
            (0, uri_utils_js_1.shuffleArray)(tracks);
            return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
        }
        // plex/album/{trackListKey...}
        if (parts[1] === "album" && parts[2]) {
            const trackListKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            const tracks = await service.getAlbumTracks(trackListKey);
            return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
        }
        // plex/playlist/{itemsKey...}
        if (parts[1] === "playlist" && parts[2]) {
            const itemsKey = (0, uri_utils_js_1.decodePathSegment)(parts.slice(2).join("/"));
            const tracks = await service.getPlaylistTracks(itemsKey);
            return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
        }
        throw new Error(`Cannot explode URI: ${uri}`);
    }
    trackToQueueItem(service, track) {
        const item = {
            uri: `plex/track/${track.id}/stream/${(0, uri_utils_js_1.encodePathSegment)(track.streamKey)}`,
            service: SERVICE_NAME,
            name: track.title,
            artist: track.artist,
            album: track.album,
            albumart: track.artworkUrl ? service.getArtworkUrl(track.artworkUrl) : "",
            duration: Math.round(track.duration / 1000),
            type: "track",
        };
        if (track.trackType)
            item.trackType = track.trackType;
        if (track.samplerate)
            item.samplerate = track.samplerate;
        if (track.bitdepth)
            item.bitdepth = track.bitdepth;
        return item;
    }
    // ── Goto (navigate to artist/album of playing track) ───────────────
    /** Navigate to the artist or album browse page for the currently playing track. */
    goto(data) {
        this.logger.info(`[Plex] goto: ${data.type}`);
        return jsPromiseToKew(this.libQ, this._goto(data));
    }
    async _goto(data) {
        const service = this.requireService();
        const uri = data.uri ?? "";
        // Extract track ID from "plex/track/{id}/stream/..."
        const match = uri.match(/^plex\/track\/(\d+)\//);
        if (!match) {
            throw new Error(`Cannot navigate: track URI does not contain a track ID (uri=${uri})`);
        }
        const trackId = match[1];
        const { albumBrowseKey, artistBrowseKey } = await service.getTrackBrowseKeys(trackId);
        if (data.type === "album") {
            return this._handleBrowseUri(`plex/album/${(0, uri_utils_js_1.encodePathSegment)(albumBrowseKey)}`);
        }
        else {
            return this._handleBrowseUri(`plex/artist/${(0, uri_utils_js_1.encodePathSegment)(artistBrowseKey)}`);
        }
    }
    // ── Playback (delegates to MPD via consume mode) ───────────────────
    /** Clear queue, add track, and start playback via MPD. */
    clearAddPlayTrack(track) {
        this.logger.info(`[Plex] clearAddPlayTrack: ${track.name}`);
        return jsPromiseToKew(this.libQ, this._clearAddPlayTrack(track));
    }
    async _clearAddPlayTrack(track) {
        // Store quality metadata so the state hook can re-inject it on every MPD state push.
        this.currentQuality = {
            ...(track.trackType && { trackType: track.trackType }),
            ...(track.samplerate && { samplerate: track.samplerate }),
            ...(track.bitdepth && { bitdepth: track.bitdepth }),
        };
        const mpdPlugin = this.getMpdPlugin();
        const streamUrl = this.resolveStreamUrl(track.uri);
        // Clear MPD queue
        await mpdPlugin.sendMpdCommand("stop", []);
        await mpdPlugin.sendMpdCommand("clear", []);
        // Set crossfade (independent of gapless playback)
        const xfade = this.crossfadeEnabled ? this.crossfadeDuration : 0;
        await mpdPlugin.sendMpdCommand(`crossfade ${xfade}`, []);
        // Try load first (handles playlists/streams), fall back to addid
        let songId;
        try {
            await mpdPlugin.sendMpdCommand(`load "${streamUrl}"`, []);
        }
        catch {
            const resp = (await mpdPlugin.sendMpdCommand(`addid "${streamUrl}"`, []));
            songId = resp?.Id;
        }
        // Set metadata tags so MPD state pushes carry correct info
        if (songId !== undefined) {
            await this.mpdAddTags(mpdPlugin, songId, track);
        }
        // Set consume mode and play
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        await mpdPlugin.sendMpdCommand("play", []);
    }
    /** Pre-buffer the next track into the MPD queue for gapless playback. */
    prefetch(track) {
        this.logger.info(`[Plex] prefetch: ${track.name}`);
        return jsPromiseToKew(this.libQ, this._prefetch(track));
    }
    async _prefetch(track) {
        if (!this.gaplessPlayback) {
            this.commandRouter.stateMachine.prefetchDone = false;
            return;
        }
        const mpdPlugin = this.getMpdPlugin();
        const streamUrl = this.resolveStreamUrl(track.uri);
        try {
            const resp = (await mpdPlugin.sendMpdCommand(`addid "${streamUrl}"`, []));
            const songId = resp?.Id;
            if (songId !== undefined) {
                await this.mpdAddTags(mpdPlugin, songId, track);
            }
            await mpdPlugin.sendMpdCommand("consume 1", []);
            this.commandRouter.stateMachine.prefetchDone = true;
            this.logger.info(`[Plex] Prefetched next track: ${track.name}`);
        }
        catch (err) {
            this.logger.error(`[Plex] Prefetch failed: ${err}`);
            this.commandRouter.stateMachine.prefetchDone = false;
        }
    }
    /** Set title/artist/album tags on an MPD queue entry by song ID. */
    async mpdAddTags(mpdPlugin, songId, track) {
        const commands = [
            { command: "addtagid", parameters: [songId, "title", track.name] },
            { command: "addtagid", parameters: [songId, "album", track.album] },
            { command: "addtagid", parameters: [songId, "artist", track.artist] },
        ];
        await mpdPlugin.sendMpdCommandArray(commands);
    }
    /** Resolve a queue item URI to the actual stream URL for MPD.
     *  Accepts both plex/track/{id}/stream/{key} and legacy plex/stream/{key} URIs. */
    resolveStreamUrl(uri) {
        // New format: plex/track/{id}/stream/{encodedKey}
        const newPrefix = "plex/track/";
        if (uri.startsWith(newPrefix)) {
            const streamIdx = uri.indexOf("/stream/");
            if (streamIdx !== -1) {
                const streamKey = (0, uri_utils_js_1.decodePathSegment)(uri.slice(streamIdx + "/stream/".length));
                return this.requireService().getStreamUrl(streamKey);
            }
        }
        // Legacy format: plex/stream/{encodedKey}
        const legacyPrefix = "plex/stream/";
        if (uri.startsWith(legacyPrefix)) {
            const streamKey = (0, uri_utils_js_1.decodePathSegment)(uri.slice(legacyPrefix.length));
            return this.requireService().getStreamUrl(streamKey);
        }
        return uri;
    }
    /** Stop playback. */
    stop() {
        this.logger.info("[Plex] stop");
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        return this.getMpdPlugin().stop();
    }
    /** Pause playback. */
    pause() {
        this.logger.info("[Plex] pause");
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        return this.getMpdPlugin().pause();
    }
    /** Start or resume playback. */
    play() {
        this.logger.info("[Plex] play");
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        return this.getMpdPlugin().resume();
    }
    /** Resume playback. */
    resume() {
        this.logger.info("[Plex] resume");
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        return this.getMpdPlugin().resume();
    }
    /** Seek to a position in milliseconds. */
    seek(position) {
        this.logger.info(`[Plex] seek: ${position}ms`);
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        return this.getMpdPlugin().seek(position);
    }
    /** Skip to the next track. */
    next() {
        this.logger.info("[Plex] next");
        this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
        return this.getMpdPlugin().next();
    }
    /** Go back to the previous track. */
    previous() {
        this.logger.info("[Plex] previous");
        this.commandRouter.stateMachine.setConsumeUpdateService(undefined);
        return this.commandRouter.stateMachine.previous();
    }
    // ── Search ─────────────────────────────────────────────────────────
    /** Search Plex for tracks and albums matching the query. */
    search(query) {
        this.logger.info(`[Plex] search: ${query.value}`);
        return jsPromiseToKew(this.libQ, this._search(query));
    }
    async _search(query) {
        const service = this.requireService();
        const results = await service.search(query.value);
        const sections = [];
        if (results.tracks.length > 0) {
            sections.push({
                title: "Plex Tracks",
                availableListViews: ["list"],
                items: results.tracks.map((track) => (0, browse_handlers_js_1.trackToNavItem)(service, track)),
            });
        }
        if (results.artists.length > 0) {
            sections.push({
                title: "Plex Artists",
                availableListViews: ["list", "grid"],
                items: results.artists.map((artist) => ({
                    service: SERVICE_NAME,
                    type: "folder",
                    title: artist.title,
                    ...(artist.artworkUrl ? { albumart: service.getArtworkUrl(artist.artworkUrl) } : {}),
                    uri: `plex/artist/${(0, uri_utils_js_1.encodePathSegment)(artist.albumsKey)}`,
                })),
            });
        }
        if (results.albums.length > 0) {
            sections.push({
                title: "Plex Albums",
                availableListViews: ["list", "grid"],
                items: results.albums.map((album) => ({
                    service: SERVICE_NAME,
                    type: "folder",
                    title: album.title,
                    artist: album.artist,
                    ...(album.artworkUrl ? { albumart: service.getArtworkUrl(album.artworkUrl) } : {}),
                    uri: `plex/album/${(0, uri_utils_js_1.encodePathSegment)(album.trackListKey)}`,
                })),
            });
        }
        return sections;
    }
    // ── State push ─────────────────────────────────────────────────────
    /** Push playback state to Volumio's state machine. */
    pushState(state) {
        this.commandRouter.servicePushState(state, SERVICE_NAME);
    }
    // ── Internal helpers ───────────────────────────────────────────────
    requireService() {
        if (!this.plexService) {
            throw new Error("PlexService not initialized — call onVolumioStart first");
        }
        return this.plexService;
    }
    getMpdPlugin() {
        const plugin = this.commandRouter.pluginManager.getPlugin("music_service", "mpd");
        if (!plugin) {
            throw new Error("MPD plugin not found");
        }
        return plugin;
    }
    /**
     * Wrap commandRouter.servicePushState so that:
     * 1. Any Plex token in the URI is sanitised before reaching the state machine.
     * 2. Quality metadata (trackType, samplerate, bitdepth) is re-injected on every
     *    MPD state push — MPD echoes back the raw stream URL so this hook fires for
     *    every playback update, but MPD does not carry our custom quality fields.
     */
    installStateMaskHook() {
        if (this.originalServicePushState)
            return; // already installed
        const original = this.commandRouter.servicePushState.bind(this.commandRouter);
        this.originalServicePushState = original;
        this.commandRouter.servicePushState = (state, serviceName) => {
            if (state.uri && state.uri.includes("X-Plex-Token")) {
                state = { ...state, uri: state.uri.replace(/X-Plex-Token=[^&]+/, "X-Plex-Token=████████") };
                state = { ...state, ...this.currentQuality };
            }
            return original(state, serviceName);
        };
    }
    removeStateMaskHook() {
        if (this.originalServicePushState) {
            this.commandRouter.servicePushState = this.originalServicePushState;
            this.originalServicePushState = null;
        }
    }
}
exports.VolumioAdapter = VolumioAdapter;
