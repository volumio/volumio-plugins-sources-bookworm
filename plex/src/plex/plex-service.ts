/**
 * Plex Service — high-level facade combining PlexApiClient, LibraryParser,
 * and StreamResolver into a single, easy-to-use API.
 *
 * All methods return normalized domain types with parsed metadata.
 * Testable with a mocked PlexApiClient.
 */

import type { PlexApiClient } from "./api-client.js";
import type { Library, Artist, Album, Track, Playlist, PaginatedResult } from "../types/index.js";
import { parseLibraries, parseArtists, parseAlbums, parseTracks, parsePlaylists } from "../core/parser.js";
import { buildStreamUrl, buildResourceUrl } from "../core/stream-resolver.js";
import type { PlexConnection } from "../core/stream-resolver.js";

export interface PlayableTrack extends Track {
  streamUrl: string;
}

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export class PlexService {
  constructor(
    private readonly apiClient: PlexApiClient,
    private readonly connection: PlexConnection,
  ) {}

  /** Get all music libraries (filters out non-music sections). */
  async getLibraries(): Promise<Library[]> {
    const raw = await this.apiClient.getLibraries();
    return parseLibraries(raw);
  }

  /** Get all artists in a library section. */
  async getArtists(libraryKey: string): Promise<Artist[]> {
    const raw = await this.apiClient.getArtists(libraryKey);
    return parseArtists(raw);
  }

  /** Get a page of artists in a library section. */
  async getArtistsPaginated(
    libraryKey: string,
    offset: number,
    limit: number,
  ): Promise<PaginatedResult<Artist>> {
    const raw = await this.apiClient.getArtists(libraryKey, { offset, limit });
    return {
      items: parseArtists(raw),
      totalSize: raw.MediaContainer.totalSize ?? raw.MediaContainer.size,
      offset,
    };
  }

  /** Get all artists across all music libraries. */
  async getAllArtists(): Promise<Artist[]> {
    const libraries = await this.getLibraries();
    const results = await Promise.all(
      libraries.map((lib) => this.getArtists(lib.id)),
    );
    return results.flat();
  }

  /** Get all albums in a library section. */
  async getAlbums(libraryKey: string): Promise<Album[]> {
    const raw = await this.apiClient.getAlbums(libraryKey);
    return parseAlbums(raw);
  }

  /** Get a page of albums in a library section. */
  async getAlbumsPaginated(
    libraryKey: string,
    offset: number,
    limit: number,
  ): Promise<PaginatedResult<Album>> {
    const raw = await this.apiClient.getAlbums(libraryKey, { offset, limit });
    return {
      items: parseAlbums(raw),
      totalSize: raw.MediaContainer.totalSize ?? raw.MediaContainer.size,
      offset,
    };
  }

  /** Get all albums across all music libraries. */
  async getAllAlbums(): Promise<Album[]> {
    const libraries = await this.getLibraries();
    const results = await Promise.all(
      libraries.map((lib) => this.getAlbums(lib.id)),
    );
    return results.flat();
  }

  /** Get albums for a specific artist by their albumsKey. */
  async getArtistAlbums(albumsKey: string): Promise<Album[]> {
    const raw = await this.apiClient.getArtistAlbums(albumsKey);
    return parseAlbums(raw);
  }

  /** Get all tracks for an album by its trackListKey. */
  async getAlbumTracks(trackListKey: string): Promise<Track[]> {
    const raw = await this.apiClient.getTracks(trackListKey);
    return parseTracks(raw);
  }

  /** Get popular tracks for an artist by their ratingKey. */
  async getPopularTracks(artistId: string): Promise<Track[]> {
    const raw = await this.apiClient.getPopularTracks(artistId);
    return parseTracks(raw);
  }

  /** Get all audio playlists (filters out video playlists). */
  async getPlaylists(): Promise<Playlist[]> {
    const raw = await this.apiClient.getPlaylists();
    return parsePlaylists(raw);
  }

  /** Get all tracks in a playlist by its itemsKey. */
  async getPlaylistTracks(itemsKey: string): Promise<Track[]> {
    const raw = await this.apiClient.getPlaylistItems(itemsKey);
    return parseTracks(raw);
  }

  /** Get a page of tracks in a playlist. */
  async getPlaylistTracksPaginated(
    itemsKey: string,
    offset: number,
    limit: number,
  ): Promise<PaginatedResult<Track>> {
    const raw = await this.apiClient.getPlaylistItems(itemsKey, { offset, limit });
    return {
      items: parseTracks(raw),
      totalSize: raw.MediaContainer.totalSize ?? raw.MediaContainer.size,
      offset,
    };
  }

  /** Search for tracks, albums, and artists matching a query. */
  async search(query: string): Promise<SearchResults> {
    const [rawTracks, rawAlbums, rawArtists] = await Promise.all([
      this.apiClient.searchTracks(query),
      this.apiClient.searchAlbums(query),
      this.apiClient.searchArtists(query),
    ]);
    return {
      tracks: parseTracks(rawTracks),
      albums: parseAlbums(rawAlbums),
      artists: parseArtists(rawArtists),
    };
  }

  /**
   * Fetch a single track by its ratingKey and resolve its stream URL.
   * Returns a PlayableTrack ready for the audio player.
   */
  async getPlayableTrack(trackId: string): Promise<PlayableTrack> {
    const raw = await this.apiClient.getTrackMetadata(trackId);
    const tracks = parseTracks(raw);
    if (tracks.length === 0) {
      throw new Error(`Track not found: ${trackId}`);
    }
    const track = tracks[0]!;
    if (!track.streamKey) {
      throw new Error(`Track ${trackId} has no playable media`);
    }
    const streamUrl = buildStreamUrl({
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
  async getTrackBrowseKeys(trackId: string): Promise<{ albumBrowseKey: string; artistBrowseKey: string }> {
    const raw = await this.apiClient.getTrackMetadata(trackId);
    const metadata = raw.MediaContainer.Metadata?.[0];
    if (!metadata) throw new Error(`Track not found: ${trackId}`);
    const toChildrenPath = (key: string) =>
      key.endsWith("/children") ? key : `${key}/children`;
    return {
      albumBrowseKey: toChildrenPath(metadata.parentKey),
      artistBrowseKey: toChildrenPath(metadata.grandparentKey),
    };
  }

  /** Build a stream URL from a track's streamKey. */
  getStreamUrl(streamKey: string): string {
    return buildStreamUrl({ ...this.connection, trackKey: streamKey });
  }

  /** Build a full artwork URL from a relative Plex thumbnail path. */
  getArtworkUrl(path: string): string {
    return buildResourceUrl(this.connection, path);
  }
}
