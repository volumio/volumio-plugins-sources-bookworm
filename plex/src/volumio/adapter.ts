/**
 * Volumio Adapter — integration layer that implements Volumio's music service
 * plugin interface and delegates to PlexService for content resolution.
 *
 * Uses kew promises (via libQ) as required by Volumio's plugin contract.
 * Playback is delegated to Volumio's MPD plugin via consume mode.
 */

import type {
  VolumioContext,
  VolumioCoreCommand,
  VolumioLogger,
  MpdPlugin,
  MpdCommandEntry,
  NavigationPage,
  QueueItem,
  SearchQuery,
  SearchResultSection,
  BrowseSource,
  VolumioState,
} from "./types.js";
import { PlexApiClient } from "../plex/api-client.js";
import { PlexService } from "../plex/plex-service.js";
import type { PlexConnection } from "../core/stream-resolver.js";
import type { Track } from "../types/index.js";
import {
  encodePathSegment,
  decodePathSegment,
  shuffleArray,
  parsePaginationUri,
} from "./uri-utils.js";
import {
  browseRoot,
  browseArtists,
  browseArtist,
  browsePopularTracks,
  browseAlbums,
  browseAlbum,
  browsePlaylists,
  browsePlaylist,
  browseShuffleAlbum,
  browseShufflePlaylist,
  trackToNavItem,
} from "./browse-handlers.js";
import type { BrowseOptions } from "./browse-handlers.js";

const SERVICE_NAME = "plex";
const DEFAULT_PAGE_SIZE = 100;

/** Minimal interface for kew-compatible promise library (Volumio's libQ). */
export interface KewLib {
  defer(): { resolve(v: unknown): void; reject(e: unknown): void; promise: PromiseLike<unknown> };
  resolve(v?: unknown): PromiseLike<unknown>;
}

/** Convert a native Promise to a kew promise (required by Volumio). */
function jsPromiseToKew<T>(libQ: KewLib, promise: Promise<T>): unknown {
  const defer = libQ.defer();
  promise.then(
    (result: T) => defer.resolve(result),
    (error: unknown) => defer.reject(error),
  );
  return defer.promise;
}

export class VolumioAdapter {
  private commandRouter: VolumioCoreCommand;
  private logger: VolumioLogger;
  private libQ: KewLib;
  private plexService: PlexService | null = null;
  private connection: PlexConnection | null = null;
  private shuffleEnabled = false;
  private pageSize = DEFAULT_PAGE_SIZE;
  private gaplessPlayback = true;
  private crossfadeEnabled = false;
  private crossfadeDuration = 5;

  private originalServicePushState: VolumioCoreCommand["servicePushState"] | null = null;
  private currentQuality: { trackType?: string; samplerate?: string; bitdepth?: string } = {};

  private readonly browseSource: BrowseSource = {
    name: "Plex",
    uri: "plex",
    plugin_type: "music_service",
    plugin_name: SERVICE_NAME,
    albumart: "/albumart?sourceicon=music_service/plex/plex.png",
  };

  constructor(context: VolumioContext, libQ: KewLib) {
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.libQ = libQ;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Called when Volumio starts — load config, instantiate Plex client. */
  onVolumioStart(): unknown {
    this.logger.info("[Plex] onVolumioStart");

    const host = "localhost";
    const port = 32400;
    const token = "";

    this.connection = { host, port, token };
    const apiClient = new PlexApiClient({ host, port, token });
    this.plexService = new PlexService(apiClient, this.connection);

    return this.libQ.resolve();
  }

  /** Called when the plugin is enabled — register browse source. */
  onStart(): unknown {
    this.logger.info("[Plex] onStart");
    this.commandRouter.volumioAddToBrowseSources(this.browseSource);
    this.installStateMaskHook();
    return this.libQ.resolve();
  }

  /** Called when the plugin is disabled — remove browse source, clean up. */
  onStop(): unknown {
    this.logger.info("[Plex] onStop");
    this.commandRouter.volumioRemoveToBrowseSources(this.browseSource);
    this.removeStateMaskHook();
    this.plexService = null;
    this.connection = null;
    return this.libQ.resolve();
  }

  /** Return the list of configuration files for this plugin. */
  getConfigurationFiles(): string[] {
    return ["config.json"];
  }

  // ── Configure (for external config injection in tests/setup) ───────

  /** Set up the PlexService and connection from external config. */
  configure(plexService: PlexService, connection: PlexConnection, options?: { shuffle?: boolean; pageSize?: number; gaplessPlayback?: boolean; crossfadeEnabled?: boolean; crossfadeDuration?: number }): void {
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
  handleBrowseUri(uri: string): unknown {
    this.logger.info(`[Plex] handleBrowseUri: ${uri}`);
    return jsPromiseToKew(this.libQ, this._handleBrowseUri(uri));
  }

  private async _handleBrowseUri(uri: string): Promise<NavigationPage> {
    const service = this.requireService();
    const parts = uri.split("/");
    const options: BrowseOptions = { pageSize: this.pageSize, shuffleEnabled: this.shuffleEnabled };

    // plex
    if (uri === "plex") {
      return browseRoot();
    }

    // plex/artists or plex/artists@{libKey}:{offset}
    if (uri === "plex/artists" || uri.startsWith("plex/artists@")) {
      return browseArtists(service, parsePaginationUri(uri), options);
    }

    // plex/albums or plex/albums@{libKey}:{offset}
    if (uri === "plex/albums" || uri.startsWith("plex/albums@")) {
      return browseAlbums(service, parsePaginationUri(uri), options);
    }

    // plex/playlists
    if (uri === "plex/playlists") {
      return browsePlaylists(service);
    }

    // plex/artist/{albumsKey...}  (key may contain slashes, encoded as __)
    if (parts[1] === "artist" && parts[2]) {
      const albumsKey = decodePathSegment(parts.slice(2).join("/"));
      return browseArtist(service, albumsKey);
    }

    // plex/popular/{artistId}
    if (parts[1] === "popular" && parts[2]) {
      return browsePopularTracks(service, parts[2]);
    }

    // plex/shuffle-album/{trackListKey...}
    if (parts[1] === "shuffle-album" && parts[2]) {
      const trackListKey = decodePathSegment(parts.slice(2).join("/"));
      return browseShuffleAlbum(service, trackListKey);
    }

    // plex/shuffle-playlist/{itemsKey...}
    if (parts[1] === "shuffle-playlist" && parts[2]) {
      const itemsKey = decodePathSegment(parts.slice(2).join("/"));
      return browseShufflePlaylist(service, itemsKey);
    }

    // plex/album/{trackListKey...}  (key may contain slashes, encoded as __)
    if (parts[1] === "album" && parts[2]) {
      const trackListKey = decodePathSegment(parts.slice(2).join("/"));
      return browseAlbum(service, trackListKey, options);
    }

    // plex/playlist/{itemsKey...} or plex/playlist/{itemsKey...}@{offset}
    if (parts[1] === "playlist" && parts[2]) {
      const raw = parts.slice(2).join("/");
      const atIndex = raw.indexOf("@");
      if (atIndex === -1) {
        return browsePlaylist(service, decodePathSegment(raw), 0, options);
      }
      const itemsKey = decodePathSegment(raw.slice(0, atIndex));
      const offset = parseInt(raw.slice(atIndex + 1), 10) || 0;
      return browsePlaylist(service, itemsKey, offset, options);
    }

    throw new Error(`Unknown browse URI: ${uri}`);
  }

  // ── Explode (resolve URI to queue items) ───────────────────────────

  /** Resolve a URI to QueueItem[] for Volumio's queue. */
  explodeUri(uri: string): unknown {
    this.logger.info(`[Plex] explodeUri: ${uri}`);
    return jsPromiseToKew(this.libQ, this._explodeUri(uri));
  }

  private async _explodeUri(uri: string): Promise<QueueItem[]> {
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
      const trackListKey = decodePathSegment(parts.slice(2).join("/"));
      const tracks = await service.getAlbumTracks(trackListKey);
      shuffleArray(tracks);
      return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
    }

    // plex/shuffle-playlist/{itemsKey...}
    if (parts[1] === "shuffle-playlist" && parts[2]) {
      const itemsKey = decodePathSegment(parts.slice(2).join("/"));
      const tracks = await service.getPlaylistTracks(itemsKey);
      shuffleArray(tracks);
      return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
    }

    // plex/album/{trackListKey...}
    if (parts[1] === "album" && parts[2]) {
      const trackListKey = decodePathSegment(parts.slice(2).join("/"));
      const tracks = await service.getAlbumTracks(trackListKey);
      return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
    }

    // plex/playlist/{itemsKey...}
    if (parts[1] === "playlist" && parts[2]) {
      const itemsKey = decodePathSegment(parts.slice(2).join("/"));
      const tracks = await service.getPlaylistTracks(itemsKey);
      return tracks.filter((track) => track.streamKey).map((track) => this.trackToQueueItem(service, track));
    }

    throw new Error(`Cannot explode URI: ${uri}`);
  }

  private trackToQueueItem(service: PlexService, track: Track): QueueItem {
    const item: QueueItem = {
      uri: `plex/track/${track.id}/stream/${encodePathSegment(track.streamKey)}`,
      service: SERVICE_NAME,
      name: track.title,
      artist: track.artist,
      album: track.album,
      albumart: track.artworkUrl ? service.getArtworkUrl(track.artworkUrl) : "",
      duration: Math.round(track.duration / 1000),
      type: "track",
    };
    if (track.trackType) item.trackType = track.trackType;
    if (track.samplerate) item.samplerate = track.samplerate;
    if (track.bitdepth) item.bitdepth = track.bitdepth;
    return item;
  }

  // ── Goto (navigate to artist/album of playing track) ───────────────

  /** Navigate to the artist or album browse page for the currently playing track. */
  goto(data: { type: "album" | "artist"; uri?: string }): unknown {
    this.logger.info(`[Plex] goto: ${data.type}`);
    return jsPromiseToKew(this.libQ, this._goto(data));
  }

  private async _goto(data: { type: "album" | "artist"; uri?: string }): Promise<NavigationPage> {
    const service = this.requireService();
    const uri = data.uri ?? "";

    // Extract track ID from "plex/track/{id}/stream/..."
    const match = uri.match(/^plex\/track\/(\d+)\//);
    if (!match) {
      throw new Error(`Cannot navigate: track URI does not contain a track ID (uri=${uri})`);
    }
    const trackId = match[1]!;

    const { albumBrowseKey, artistBrowseKey } = await service.getTrackBrowseKeys(trackId);

    if (data.type === "album") {
      return this._handleBrowseUri(`plex/album/${encodePathSegment(albumBrowseKey)}`);
    } else {
      return this._handleBrowseUri(`plex/artist/${encodePathSegment(artistBrowseKey)}`);
    }
  }

  // ── Playback (delegates to MPD via consume mode) ───────────────────

  /** Clear queue, add track, and start playback via MPD. */
  clearAddPlayTrack(track: QueueItem): unknown {
    this.logger.info(`[Plex] clearAddPlayTrack: ${track.name}`);
    return jsPromiseToKew(this.libQ, this._clearAddPlayTrack(track));
  }

  private async _clearAddPlayTrack(track: QueueItem): Promise<void> {
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
    let songId: string | undefined;
    try {
      await mpdPlugin.sendMpdCommand(`load "${streamUrl}"`, []);
    } catch {
      const resp = (await mpdPlugin.sendMpdCommand(`addid "${streamUrl}"`, [])) as {
        Id?: string;
      };
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
  prefetch(track: QueueItem): unknown {
    this.logger.info(`[Plex] prefetch: ${track.name}`);
    return jsPromiseToKew(this.libQ, this._prefetch(track));
  }

  private async _prefetch(track: QueueItem): Promise<void> {
    if (!this.gaplessPlayback) {
      this.commandRouter.stateMachine.prefetchDone = false;
      return;
    }

    const mpdPlugin = this.getMpdPlugin();
    const streamUrl = this.resolveStreamUrl(track.uri);

    try {
      const resp = (await mpdPlugin.sendMpdCommand(`addid "${streamUrl}"`, [])) as { Id?: string };
      const songId = resp?.Id;

      if (songId !== undefined) {
        await this.mpdAddTags(mpdPlugin, songId, track);
      }

      await mpdPlugin.sendMpdCommand("consume 1", []);
      this.commandRouter.stateMachine.prefetchDone = true;
      this.logger.info(`[Plex] Prefetched next track: ${track.name}`);
    } catch (err) {
      this.logger.error(`[Plex] Prefetch failed: ${err}`);
      this.commandRouter.stateMachine.prefetchDone = false;
    }
  }

  /** Set title/artist/album tags on an MPD queue entry by song ID. */
  private async mpdAddTags(
    mpdPlugin: MpdPlugin,
    songId: string,
    track: QueueItem,
  ): Promise<void> {
    const commands: MpdCommandEntry[] = [
      { command: "addtagid", parameters: [songId, "title", track.name] },
      { command: "addtagid", parameters: [songId, "album", track.album] },
      { command: "addtagid", parameters: [songId, "artist", track.artist] },
    ];
    await mpdPlugin.sendMpdCommandArray(commands);
  }

  /** Resolve a queue item URI to the actual stream URL for MPD.
   *  Accepts both plex/track/{id}/stream/{key} and legacy plex/stream/{key} URIs. */
  private resolveStreamUrl(uri: string): string {
    // New format: plex/track/{id}/stream/{encodedKey}
    const newPrefix = "plex/track/";
    if (uri.startsWith(newPrefix)) {
      const streamIdx = uri.indexOf("/stream/");
      if (streamIdx !== -1) {
        const streamKey = decodePathSegment(uri.slice(streamIdx + "/stream/".length));
        return this.requireService().getStreamUrl(streamKey);
      }
    }
    // Legacy format: plex/stream/{encodedKey}
    const legacyPrefix = "plex/stream/";
    if (uri.startsWith(legacyPrefix)) {
      const streamKey = decodePathSegment(uri.slice(legacyPrefix.length));
      return this.requireService().getStreamUrl(streamKey);
    }
    return uri;
  }

  /** Stop playback. */
  stop(): unknown {
    this.logger.info("[Plex] stop");
    this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
    return this.getMpdPlugin().stop();
  }

  /** Pause playback. */
  pause(): unknown {
    this.logger.info("[Plex] pause");
    this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
    return this.getMpdPlugin().pause();
  }

  /** Start or resume playback. */
  play(): unknown {
    this.logger.info("[Plex] play");
    this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
    return this.getMpdPlugin().resume();
  }

  /** Resume playback. */
  resume(): unknown {
    this.logger.info("[Plex] resume");
    this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
    return this.getMpdPlugin().resume();
  }

  /** Seek to a position in milliseconds. */
  seek(position: number): unknown {
    this.logger.info(`[Plex] seek: ${position}ms`);
    this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
    return this.getMpdPlugin().seek(position);
  }

  /** Skip to the next track. */
  next(): unknown {
    this.logger.info("[Plex] next");
    this.commandRouter.stateMachine.setConsumeUpdateService("mpd", true, false);
    return this.getMpdPlugin().next();
  }

  /** Go back to the previous track. */
  previous(): unknown {
    this.logger.info("[Plex] previous");
    this.commandRouter.stateMachine.setConsumeUpdateService(undefined);
    return this.commandRouter.stateMachine.previous();
  }

  // ── Search ─────────────────────────────────────────────────────────

  /** Search Plex for tracks and albums matching the query. */
  search(query: SearchQuery): unknown {
    this.logger.info(`[Plex] search: ${query.value}`);
    return jsPromiseToKew(this.libQ, this._search(query));
  }

  private async _search(query: SearchQuery): Promise<SearchResultSection[]> {
    const service = this.requireService();
    const results = await service.search(query.value);
    const sections: SearchResultSection[] = [];

    if (results.tracks.length > 0) {
      sections.push({
        title: "Plex Tracks",
        availableListViews: ["list"],
        items: results.tracks.map((track) => trackToNavItem(service, track)),
      });
    }

    if (results.artists.length > 0) {
      sections.push({
        title: "Plex Artists",
        availableListViews: ["list", "grid"],
        items: results.artists.map((artist) => ({
          service: SERVICE_NAME,
          type: "folder" as const,
          title: artist.title,
          ...(artist.artworkUrl ? { albumart: service.getArtworkUrl(artist.artworkUrl) } : {}),
          uri: `plex/artist/${encodePathSegment(artist.albumsKey)}`,
        })),
      });
    }

    if (results.albums.length > 0) {
      sections.push({
        title: "Plex Albums",
        availableListViews: ["list", "grid"],
        items: results.albums.map((album) => ({
          service: SERVICE_NAME,
          type: "folder" as const,
          title: album.title,
          artist: album.artist,
          ...(album.artworkUrl ? { albumart: service.getArtworkUrl(album.artworkUrl) } : {}),
          uri: `plex/album/${encodePathSegment(album.trackListKey)}`,
        })),
      });
    }

    return sections;
  }

  // ── State push ─────────────────────────────────────────────────────

  /** Push playback state to Volumio's state machine. */
  pushState(state: VolumioState): void {
    this.commandRouter.servicePushState(state, SERVICE_NAME);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private requireService(): PlexService {
    if (!this.plexService) {
      throw new Error("PlexService not initialized — call onVolumioStart first");
    }
    return this.plexService;
  }

  private getMpdPlugin(): MpdPlugin {
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
  private installStateMaskHook(): void {
    if (this.originalServicePushState) return; // already installed
    const original = this.commandRouter.servicePushState.bind(this.commandRouter);
    this.originalServicePushState = original;
    this.commandRouter.servicePushState = (state: VolumioState, serviceName: string) => {
      if (state.uri && state.uri.includes("X-Plex-Token")) {
        state = { ...state, uri: state.uri.replace(/X-Plex-Token=[^&]+/, "X-Plex-Token=████████") };
        state = { ...state, ...this.currentQuality };
      }
      return original(state, serviceName);
    };
  }

  private removeStateMaskHook(): void {
    if (this.originalServicePushState) {
      this.commandRouter.servicePushState = this.originalServicePushState;
      this.originalServicePushState = null;
    }
  }
}

