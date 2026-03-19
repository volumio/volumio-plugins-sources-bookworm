"use strict";
/**
 * Plex Service — high-level facade combining PlexApiClient, LibraryParser,
 * and StreamResolver into a single, easy-to-use API.
 *
 * All methods return normalized domain types with parsed metadata.
 * Testable with a mocked PlexApiClient.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexService = void 0;
const parser_js_1 = require("../core/parser.js");
const stream_resolver_js_1 = require("../core/stream-resolver.js");
class PlexService {
    constructor(apiClient, connection) {
        this.apiClient = apiClient;
        this.connection = connection;
    }
    /** Get all music libraries (filters out non-music sections). */
    async getLibraries() {
        const raw = await this.apiClient.getLibraries();
        return (0, parser_js_1.parseLibraries)(raw);
    }
    /** Get all artists in a library section. */
    async getArtists(libraryKey) {
        const raw = await this.apiClient.getArtists(libraryKey);
        return (0, parser_js_1.parseArtists)(raw);
    }
    /** Get a page of artists in a library section. */
    async getArtistsPaginated(libraryKey, offset, limit) {
        const raw = await this.apiClient.getArtists(libraryKey, { offset, limit });
        return {
            items: (0, parser_js_1.parseArtists)(raw),
            totalSize: raw.MediaContainer.totalSize ?? raw.MediaContainer.size,
            offset,
        };
    }
    /** Get all artists across all music libraries. */
    async getAllArtists() {
        const libraries = await this.getLibraries();
        const results = await Promise.all(libraries.map((lib) => this.getArtists(lib.id)));
        return results.flat();
    }
    /** Get all albums in a library section. */
    async getAlbums(libraryKey) {
        const raw = await this.apiClient.getAlbums(libraryKey);
        return (0, parser_js_1.parseAlbums)(raw);
    }
    /** Get a page of albums in a library section. */
    async getAlbumsPaginated(libraryKey, offset, limit) {
        const raw = await this.apiClient.getAlbums(libraryKey, { offset, limit });
        return {
            items: (0, parser_js_1.parseAlbums)(raw),
            totalSize: raw.MediaContainer.totalSize ?? raw.MediaContainer.size,
            offset,
        };
    }
    /** Get all albums across all music libraries. */
    async getAllAlbums() {
        const libraries = await this.getLibraries();
        const results = await Promise.all(libraries.map((lib) => this.getAlbums(lib.id)));
        return results.flat();
    }
    /** Get albums for a specific artist by their albumsKey. */
    async getArtistAlbums(albumsKey) {
        const raw = await this.apiClient.getArtistAlbums(albumsKey);
        return (0, parser_js_1.parseAlbums)(raw);
    }
    /** Get all tracks for an album by its trackListKey. */
    async getAlbumTracks(trackListKey) {
        const raw = await this.apiClient.getTracks(trackListKey);
        return (0, parser_js_1.parseTracks)(raw);
    }
    /** Get popular tracks for an artist by their ratingKey. */
    async getPopularTracks(artistId) {
        const raw = await this.apiClient.getPopularTracks(artistId);
        return (0, parser_js_1.parseTracks)(raw);
    }
    /** Get all audio playlists (filters out video playlists). */
    async getPlaylists() {
        const raw = await this.apiClient.getPlaylists();
        return (0, parser_js_1.parsePlaylists)(raw);
    }
    /** Get all tracks in a playlist by its itemsKey. */
    async getPlaylistTracks(itemsKey) {
        const raw = await this.apiClient.getPlaylistItems(itemsKey);
        return (0, parser_js_1.parseTracks)(raw);
    }
    /** Get a page of tracks in a playlist. */
    async getPlaylistTracksPaginated(itemsKey, offset, limit) {
        const raw = await this.apiClient.getPlaylistItems(itemsKey, { offset, limit });
        return {
            items: (0, parser_js_1.parseTracks)(raw),
            totalSize: raw.MediaContainer.totalSize ?? raw.MediaContainer.size,
            offset,
        };
    }
    /** Search for tracks, albums, and artists matching a query. */
    async search(query) {
        const [rawTracks, rawAlbums, rawArtists] = await Promise.all([
            this.apiClient.searchTracks(query),
            this.apiClient.searchAlbums(query),
            this.apiClient.searchArtists(query),
        ]);
        return {
            tracks: (0, parser_js_1.parseTracks)(rawTracks),
            albums: (0, parser_js_1.parseAlbums)(rawAlbums),
            artists: (0, parser_js_1.parseArtists)(rawArtists),
        };
    }
    /**
     * Fetch a single track by its ratingKey and resolve its stream URL.
     * Returns a PlayableTrack ready for the audio player.
     */
    async getPlayableTrack(trackId) {
        const raw = await this.apiClient.getTrackMetadata(trackId);
        const tracks = (0, parser_js_1.parseTracks)(raw);
        if (tracks.length === 0) {
            throw new Error(`Track not found: ${trackId}`);
        }
        const track = tracks[0];
        if (!track.streamKey) {
            throw new Error(`Track ${trackId} has no playable media`);
        }
        const streamUrl = (0, stream_resolver_js_1.buildStreamUrl)({
            ...this.connection,
            trackKey: track.streamKey,
        });
        return { ...track, streamUrl };
    }
    /** Get the album and artist browse keys for a track by its ratingKey.
     *
     * Plex's parentKey/grandparentKey may or may not include "/children" depending
     * on the server version. We normalize them to always be the children endpoint,
     * which is what our browse handlers expect. */
    async getTrackBrowseKeys(trackId) {
        const raw = await this.apiClient.getTrackMetadata(trackId);
        const metadata = raw.MediaContainer.Metadata?.[0];
        if (!metadata)
            throw new Error(`Track not found: ${trackId}`);
        const toChildrenPath = (key) => key.endsWith("/children") ? key : `${key}/children`;
        return {
            albumBrowseKey: toChildrenPath(metadata.parentKey),
            artistBrowseKey: toChildrenPath(metadata.grandparentKey),
        };
    }
    /** Build a stream URL from a track's streamKey. */
    getStreamUrl(streamKey) {
        return (0, stream_resolver_js_1.buildStreamUrl)({ ...this.connection, trackKey: streamKey });
    }
    /** Build a full artwork URL from a relative Plex thumbnail path. */
    getArtworkUrl(path) {
        return (0, stream_resolver_js_1.buildResourceUrl)(this.connection, path);
    }
}
exports.PlexService = PlexService;
