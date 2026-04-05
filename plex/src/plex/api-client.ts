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

import http from "http";
import https from "https";
import type { PlexConnection } from "../core/stream-resolver.js";
import type {
  RawLibraryResponse,
  RawArtistResponse,
  RawAlbumResponse,
  RawTrackResponse,
  RawPlaylistResponse,
} from "../types/index.js";

// ── Error classes ───────────────────────────────────────────────────

/** Base error for non-successful Plex API responses. */
export class PlexApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PlexApiError";
  }
}

/** Thrown when Plex returns 401 Unauthorized (bad or expired token). */
export class PlexAuthError extends PlexApiError {
  constructor(message = "Unauthorized — check your Plex token") {
    super(message, 401);
    this.name = "PlexAuthError";
  }
}

/** Thrown for network failures, timeouts, and unparseable responses. */
export class PlexConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PlexConnectionError";
  }
}

// ── Pagination ──────────────────────────────────────────────────────

/** Parameters for paginated Plex API requests. */
export interface PaginationParams {
  offset: number;
  limit: number;
}

// ── Client ──────────────────────────────────────────────────────────

export interface PlexApiClientOptions extends PlexConnection {
  /** Request timeout in milliseconds. Default: 10 000 */
  timeoutMs?: number;
}

export class PlexApiClient {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly https: boolean;
  private readonly timeoutMs: number;

  constructor(options: PlexApiClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.token = options.token;
    this.https = options.https ?? false;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Fetch all library sections. */
  async getLibraries(): Promise<RawLibraryResponse> {
    return this.request<RawLibraryResponse>("/library/sections");
  }

  /** Fetch artists for a library section (type=8 requests artist-level items). */
  async getArtists(libraryKey: string, pagination?: PaginationParams): Promise<RawArtistResponse> {
    const paginationQuery = pagination
      ? `&X-Plex-Container-Start=${pagination.offset}&X-Plex-Container-Size=${pagination.limit}`
      : "";
    return this.request<RawArtistResponse>(
      `/library/sections/${encodeURIComponent(libraryKey)}/all?type=8${paginationQuery}`,
    );
  }

  /** Fetch albums for a library section (type=9 requests album-level items). */
  async getAlbums(libraryKey: string, pagination?: PaginationParams): Promise<RawAlbumResponse> {
    const paginationQuery = pagination
      ? `&X-Plex-Container-Start=${pagination.offset}&X-Plex-Container-Size=${pagination.limit}`
      : "";
    return this.request<RawAlbumResponse>(
      `/library/sections/${encodeURIComponent(libraryKey)}/all?type=9${paginationQuery}`,
    );
  }

  /** Fetch tracks for an album. `albumKey` is the full path from Album.trackListKey. */
  async getTracks(albumKey: string): Promise<RawTrackResponse> {
    return this.request<RawTrackResponse>(albumKey);
  }

  /** Fetch albums for an artist. `artistKey` is the full path from Artist.albumsKey. */
  async getArtistAlbums(artistKey: string): Promise<RawAlbumResponse> {
    return this.request<RawAlbumResponse>(artistKey);
  }

  /** Fetch popular tracks for an artist by querying the library section with rating-based sorting. */
  async getPopularTracks(artistId: string): Promise<RawTrackResponse> {
    // First, get the artist metadata to find which library section they belong to
    const artistMeta = await this.request<RawArtistResponse>(
      `/library/metadata/${encodeURIComponent(artistId)}`,
    );
    const sectionId = (artistMeta.MediaContainer as Record<string, unknown>).librarySectionID as string | undefined;
    if (!sectionId) {
      throw new PlexApiError(`Could not determine library section for artist ${artistId}`, 0);
    }
    // Query the section for tracks by this artist, sorted by popularity
    const enc = encodeURIComponent;
    return this.request<RawTrackResponse>(
      `/library/sections/${enc(sectionId)}/all?type=10&artist.id=${enc(artistId)}&sort=ratingCount:desc&limit=100`,
    );
  }

  /** Fetch all playlists on the server. */
  async getPlaylists(): Promise<RawPlaylistResponse> {
    return this.request<RawPlaylistResponse>("/playlists");
  }

  /** Fetch items (tracks) for a playlist. `itemsKey` is the full path from Playlist.itemsKey. */
  async getPlaylistItems(itemsKey: string, pagination?: PaginationParams): Promise<RawTrackResponse> {
    const paginationQuery = pagination
      ? `${itemsKey.includes("?") ? "&" : "?"}X-Plex-Container-Start=${pagination.offset}&X-Plex-Container-Size=${pagination.limit}`
      : "";
    return this.request<RawTrackResponse>(`${itemsKey}${paginationQuery}`);
  }

  /** Fetch metadata for a single track by its ratingKey. */
  async getTrackMetadata(trackId: string): Promise<RawTrackResponse> {
    return this.request<RawTrackResponse>(
      `/library/metadata/${encodeURIComponent(trackId)}`,
    );
  }

  /** Search for tracks matching a query (type=10). */
  async searchTracks(query: string): Promise<RawTrackResponse> {
    return this.request<RawTrackResponse>(
      `/search?type=10&query=${encodeURIComponent(query)}`,
    );
  }

  /** Search for albums matching a query (type=9). */
  async searchAlbums(query: string): Promise<RawAlbumResponse> {
    return this.request<RawAlbumResponse>(
      `/search?type=9&query=${encodeURIComponent(query)}`,
    );
  }

  /** Search for artists matching a query (type=8). */
  async searchArtists(query: string): Promise<RawArtistResponse> {
    return this.request<RawArtistResponse>(
      `/search?type=8&query=${encodeURIComponent(query)}`,
    );
  }

  // ── Internal ────────────────────────────────────────────────────

  private request<T>(path: string): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    const fullPath = `${path}${separator}X-Plex-Token=${encodeURIComponent(this.token)}`;

    return new Promise<T>((resolve, reject) => {
      const httpModule = this.https ? https : http;
      const req = httpModule.get(
        {
          hostname: this.host,
          port: this.port,
          path: fullPath,
          headers: { Accept: "application/json" },
          timeout: this.timeoutMs,
        },
        (res) => {
          const statusCode = res.statusCode ?? 0;

          if (statusCode === 401) {
            res.resume(); // drain the response
            reject(new PlexAuthError());
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            res.resume();
            reject(
              new PlexApiError(
                `Plex API error: ${statusCode} ${res.statusMessage ?? ""}`.trim(),
                statusCode,
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            try {
              resolve(JSON.parse(body) as T);
            } catch (error: unknown) {
              reject(
                new PlexConnectionError(
                  "Failed to parse Plex API response as JSON",
                  error,
                ),
              );
            }
          });
          res.on("error", (error: Error) => {
            reject(
              new PlexConnectionError(
                `Failed to connect to Plex server at ${this.host}:${this.port}`,
                error,
              ),
            );
          });
        },
      );

      req.on("timeout", () => {
        req.destroy();
        reject(
          new PlexConnectionError(
            `Request to Plex server at ${this.host}:${this.port} timed out after ${this.timeoutMs}ms`,
          ),
        );
      });

      req.on("error", (error: Error) => {
        reject(
          new PlexConnectionError(
            `Failed to connect to Plex server at ${this.host}:${this.port}`,
            error,
          ),
        );
      });
    });
  }
}
