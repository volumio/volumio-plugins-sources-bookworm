"use strict";
/**
 * Plex API Client — low-level HTTP communication with a Plex Media Server.
 *
 * Makes authenticated GET requests and returns raw Plex API response shapes
 * (defined in src/types/index.ts). All responses are JSON-parsed but not
 * transformed — use the Library Parser for normalized domain types.
 *
 * Uses Node's built-in `http` module for compatibility with all Volumio
 * versions (Node 14+).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexApiClient = exports.PlexConnectionError = exports.PlexAuthError = exports.PlexApiError = void 0;
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
// ── Error classes ───────────────────────────────────────────────────
/** Base error for non-successful Plex API responses. */
class PlexApiError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = "PlexApiError";
    }
}
exports.PlexApiError = PlexApiError;
/** Thrown when Plex returns 401 Unauthorized (bad or expired token). */
class PlexAuthError extends PlexApiError {
    constructor(message = "Unauthorized — check your Plex token") {
        super(message, 401);
        this.name = "PlexAuthError";
    }
}
exports.PlexAuthError = PlexAuthError;
/** Thrown for network failures, timeouts, and unparseable responses. */
class PlexConnectionError extends Error {
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "PlexConnectionError";
    }
}
exports.PlexConnectionError = PlexConnectionError;
class PlexApiClient {
    constructor(options) {
        this.host = options.host;
        this.port = options.port;
        this.token = options.token;
        this.https = options.https ?? false;
        this.timeoutMs = options.timeoutMs ?? 10000;
    }
    /** Fetch all library sections. */
    async getLibraries() {
        return this.request("/library/sections");
    }
    /** Fetch artists for a library section (type=8 requests artist-level items). */
    async getArtists(libraryKey, pagination) {
        const paginationQuery = pagination
            ? `&X-Plex-Container-Start=${pagination.offset}&X-Plex-Container-Size=${pagination.limit}`
            : "";
        return this.request(`/library/sections/${encodeURIComponent(libraryKey)}/all?type=8${paginationQuery}`);
    }
    /** Fetch albums for a library section (type=9 requests album-level items). */
    async getAlbums(libraryKey, pagination) {
        const paginationQuery = pagination
            ? `&X-Plex-Container-Start=${pagination.offset}&X-Plex-Container-Size=${pagination.limit}`
            : "";
        return this.request(`/library/sections/${encodeURIComponent(libraryKey)}/all?type=9${paginationQuery}`);
    }
    /** Fetch tracks for an album. `albumKey` is the full path from Album.trackListKey. */
    async getTracks(albumKey) {
        return this.request(albumKey);
    }
    /** Fetch albums for an artist. `artistKey` is the full path from Artist.albumsKey. */
    async getArtistAlbums(artistKey) {
        return this.request(artistKey);
    }
    /** Fetch popular tracks for an artist by querying the library section with rating-based sorting. */
    async getPopularTracks(artistId) {
        // First, get the artist metadata to find which library section they belong to
        const artistMeta = await this.request(`/library/metadata/${encodeURIComponent(artistId)}`);
        const sectionId = artistMeta.MediaContainer.librarySectionID;
        if (!sectionId) {
            throw new PlexApiError(`Could not determine library section for artist ${artistId}`, 0);
        }
        // Query the section for tracks by this artist, sorted by popularity
        const enc = encodeURIComponent;
        return this.request(`/library/sections/${enc(sectionId)}/all?type=10&artist.id=${enc(artistId)}&sort=ratingCount:desc&limit=100`);
    }
    /** Fetch all playlists on the server. */
    async getPlaylists() {
        return this.request("/playlists");
    }
    /** Fetch items (tracks) for a playlist. `itemsKey` is the full path from Playlist.itemsKey. */
    async getPlaylistItems(itemsKey, pagination) {
        const paginationQuery = pagination
            ? `${itemsKey.includes("?") ? "&" : "?"}X-Plex-Container-Start=${pagination.offset}&X-Plex-Container-Size=${pagination.limit}`
            : "";
        return this.request(`${itemsKey}${paginationQuery}`);
    }
    /** Fetch metadata for a single track by its ratingKey. */
    async getTrackMetadata(trackId) {
        return this.request(`/library/metadata/${encodeURIComponent(trackId)}`);
    }
    /** Search for tracks matching a query (type=10). */
    async searchTracks(query) {
        return this.request(`/search?type=10&query=${encodeURIComponent(query)}`);
    }
    /** Search for albums matching a query (type=9). */
    async searchAlbums(query) {
        return this.request(`/search?type=9&query=${encodeURIComponent(query)}`);
    }
    /** Search for artists matching a query (type=8). */
    async searchArtists(query) {
        return this.request(`/search?type=8&query=${encodeURIComponent(query)}`);
    }
    // ── Internal ────────────────────────────────────────────────────
    request(path) {
        const separator = path.includes("?") ? "&" : "?";
        const fullPath = `${path}${separator}X-Plex-Token=${encodeURIComponent(this.token)}`;
        return new Promise((resolve, reject) => {
            const httpModule = this.https ? https_1.default : http_1.default;
            const req = httpModule.get({
                hostname: this.host,
                port: this.port,
                path: fullPath,
                headers: { Accept: "application/json" },
                timeout: this.timeoutMs,
            }, (res) => {
                const statusCode = res.statusCode ?? 0;
                if (statusCode === 401) {
                    res.resume(); // drain the response
                    reject(new PlexAuthError());
                    return;
                }
                if (statusCode < 200 || statusCode >= 300) {
                    res.resume();
                    reject(new PlexApiError(`Plex API error: ${statusCode} ${res.statusMessage ?? ""}`.trim(), statusCode));
                    return;
                }
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const body = Buffer.concat(chunks).toString("utf-8");
                    try {
                        resolve(JSON.parse(body));
                    }
                    catch (error) {
                        reject(new PlexConnectionError("Failed to parse Plex API response as JSON", error));
                    }
                });
                res.on("error", (error) => {
                    reject(new PlexConnectionError(`Failed to connect to Plex server at ${this.host}:${this.port}`, error));
                });
            });
            req.on("timeout", () => {
                req.destroy();
                reject(new PlexConnectionError(`Request to Plex server at ${this.host}:${this.port} timed out after ${this.timeoutMs}ms`));
            });
            req.on("error", (error) => {
                reject(new PlexConnectionError(`Failed to connect to Plex server at ${this.host}:${this.port}`, error));
            });
        });
    }
}
exports.PlexApiClient = PlexApiClient;
