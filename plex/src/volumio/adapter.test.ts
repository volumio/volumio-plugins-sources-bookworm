import { describe, it, expect, beforeEach, vi } from "vitest";
import { VolumioAdapter } from "./adapter.js";
import type { KewLib } from "./adapter.js";
import type { PlexService, PlayableTrack } from "../plex/plex-service.js";
import type { PlexConnection } from "../core/stream-resolver.js";
import type { Library, Artist, Album, Track, Playlist, PaginatedResult } from "../types/index.js";
type PaginatedTracks = PaginatedResult<Track>;
import type {
  VolumioContext,
  VolumioCoreCommand,
  VolumioLogger,
  MpdPlugin,
  NavigationPage,
  QueueItem,
  SearchResultSection,
} from "./types.js";

// ── Mock kew (simple native-Promise-based stand-in) ──────────────────

function createMockLibQ(): KewLib {
  return {
    defer: () => {
      let _resolve: (v: unknown) => void;
      let _reject: (e: unknown) => void;
      const promise = new Promise((res, rej) => {
        _resolve = res;
        _reject = rej;
      });
      return {
        resolve: (v: unknown) => _resolve!(v),
        reject: (e: unknown) => _reject!(e),
        promise,
      };
    },
    resolve: (v?: unknown) => Promise.resolve(v),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────

const connection: PlexConnection = {
  host: "192.168.1.100",
  port: 32400,
  token: "test-token",
};

const librariesFixture: Library[] = [
  { id: "1", title: "Music", type: "artist" },
  { id: "3", title: "Podcasts", type: "artist" },
];

const artistsFixture: Artist[] = [
  {
    id: "500",
    title: "Radiohead",
    artworkUrl: "/library/metadata/500/thumb/123",
    albumsKey: "/library/metadata/500/children",
  },
  {
    id: "501",
    title: "Pink Floyd",
    artworkUrl: null,
    albumsKey: "/library/metadata/501/children",
  },
];

const albumsFixture: Album[] = [
  {
    id: "1001",
    title: "OK Computer",
    artist: "Radiohead",
    year: 1997,
    artworkUrl: "/library/metadata/1001/thumb/123",
    trackListKey: "/library/metadata/1001/children",
  },
  {
    id: "1002",
    title: "Kid A",
    artist: "Radiohead",
    year: 2000,
    artworkUrl: null,
    trackListKey: "/library/metadata/1002/children",
  },
];

const tracksFixture: Track[] = [
  {
    id: "2001",
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    duration: 282000,
    artworkUrl: "/library/metadata/1001/thumb/123",
    streamKey: "/library/parts/2001/file.flac",
    trackType: "flac",
    samplerate: "44.1 kHz",
    bitdepth: "24 bit",
  },
  {
    id: "2002",
    title: "Paranoid Android",
    artist: "Radiohead",
    album: "OK Computer",
    duration: 383000,
    artworkUrl: null,
    streamKey: "/library/parts/2002/file.flac",
    trackType: null,
    samplerate: null,
    bitdepth: null,
  },
];

const playlistsFixture: Playlist[] = [
  { id: "5001", title: "Favorites", trackCount: 10, itemsKey: "/playlists/5001/items" },
];

const playableTrackFixture: PlayableTrack = {
  ...tracksFixture[0]!,
  streamUrl: "http://192.168.1.100:32400/library/parts/2001/file.flac?X-Plex-Token=test-token",
};

// ── Mock factories ───────────────────────────────────────────────────

function createMockPlexService(): PlexService {
  return {
    getLibraries: vi.fn<() => Promise<Library[]>>().mockResolvedValue(librariesFixture),
    getArtists: vi.fn<(k: string) => Promise<Artist[]>>().mockResolvedValue(artistsFixture),
    getAllArtists: vi.fn<() => Promise<Artist[]>>().mockResolvedValue(artistsFixture),
    getArtistsPaginated: vi.fn<(k: string, o: number, l: number) => Promise<PaginatedResult<Artist>>>()
      .mockResolvedValue({ items: artistsFixture, totalSize: artistsFixture.length, offset: 0 }),
    getAlbums: vi.fn<(k: string) => Promise<Album[]>>().mockResolvedValue(albumsFixture),
    getAllAlbums: vi.fn<() => Promise<Album[]>>().mockResolvedValue(albumsFixture),
    getAlbumsPaginated: vi.fn<(k: string, o: number, l: number) => Promise<PaginatedResult<Album>>>()
      .mockResolvedValue({ items: albumsFixture, totalSize: albumsFixture.length, offset: 0 }),
    getArtistAlbums: vi.fn<(k: string) => Promise<Album[]>>().mockResolvedValue(albumsFixture),
    getPopularTracks: vi.fn<(id: string) => Promise<Track[]>>().mockResolvedValue(tracksFixture),
    getAlbumTracks: vi.fn<(k: string) => Promise<Track[]>>().mockResolvedValue(tracksFixture),
    getPlaylists: vi.fn<() => Promise<Playlist[]>>().mockResolvedValue(playlistsFixture),
    getPlaylistTracks: vi.fn<(k: string) => Promise<Track[]>>().mockResolvedValue(tracksFixture),
    getPlaylistTracksPaginated: vi.fn<(k: string, o: number, l: number) => Promise<PaginatedTracks>>()
      .mockResolvedValue({ items: tracksFixture, totalSize: tracksFixture.length, offset: 0 }),
    search: vi.fn().mockResolvedValue({ tracks: tracksFixture, albums: albumsFixture, artists: artistsFixture }),
    getPlayableTrack: vi.fn<(id: string) => Promise<PlayableTrack>>().mockResolvedValue(playableTrackFixture),
    getStreamUrl: vi.fn<(k: string) => string>().mockImplementation(
      (streamKey: string) => `http://192.168.1.100:32400${streamKey}?X-Plex-Token=test-token`,
    ),
    getArtworkUrl: vi.fn<(p: string) => string>().mockImplementation(
      (path: string) => `http://192.168.1.100:32400${path}?X-Plex-Token=test-token`,
    ),
  } as unknown as PlexService;
}

function createMockMpdPlugin(): MpdPlugin {
  return {
    sendMpdCommand: vi.fn().mockResolvedValue(undefined),
    sendMpdCommandArray: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    clientMpd: {
      sendCommand: vi.fn(),
    },
  };
}

function createMockContext(mpdPlugin?: MpdPlugin): {
  context: VolumioContext;
  commandRouter: VolumioCoreCommand;
  logger: VolumioLogger;
} {
  const logger: VolumioLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const commandRouter: VolumioCoreCommand = {
    pushConsoleMessage: vi.fn(),
    servicePushState: vi.fn(),
    volumioAddToBrowseSources: vi.fn(),
    volumioRemoveToBrowseSources: vi.fn(),
    stateMachine: {
      setConsumeUpdateService: vi.fn(),
      previous: vi.fn().mockResolvedValue(undefined),
      prefetchDone: false,
    },
    pluginManager: {
      getPlugin: vi.fn().mockReturnValue(mpdPlugin ?? createMockMpdPlugin()),
    },
  };

  return {
    context: { coreCommand: commandRouter, logger },
    commandRouter,
    logger,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("VolumioAdapter", () => {
  let adapter: VolumioAdapter;
  let mockService: ReturnType<typeof createMockPlexService>;
  let commandRouter: VolumioCoreCommand;
  let mpdPlugin: MpdPlugin;

  beforeEach(() => {
    mpdPlugin = createMockMpdPlugin();
    const mocks = createMockContext(mpdPlugin);
    commandRouter = mocks.commandRouter;

    adapter = new VolumioAdapter(mocks.context, createMockLibQ());
    mockService = createMockPlexService();
    adapter.configure(mockService, connection);
  });

  // ── Lifecycle ────────────────────────────────────────────────────

  describe("onStart", () => {
    it("registers browse source with Volumio", async () => {
      await adapter.onStart();

      expect(commandRouter.volumioAddToBrowseSources).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Plex",
          uri: "plex",
          plugin_type: "music_service",
          plugin_name: "plex",
        }),
      );
    });
  });

  describe("onStop", () => {
    it("removes browse source from Volumio", async () => {
      await adapter.onStop();

      expect(commandRouter.volumioRemoveToBrowseSources).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Plex", uri: "plex" }),
      );
    });

    it("clears the PlexService reference", async () => {
      await adapter.onStop();

      // Attempting to browse after stop should fail (root is static, so use artists)
      await expect(adapter.handleBrowseUri("plex/artists")).rejects.toThrow(
        "PlexService not initialized",
      );
    });
  });

  describe("getConfigurationFiles", () => {
    it("returns config.json", () => {
      expect(adapter.getConfigurationFiles()).toEqual(["config.json"]);
    });
  });

  // ── Browse: root ─────────────────────────────────────────────────

  describe("handleBrowseUri — root", () => {
    it("returns Artists, Albums, and Playlists folders at root", async () => {
      const result = (await adapter.handleBrowseUri("plex")) as NavigationPage;

      const items = result.navigation.lists[0]!.items;
      expect(items).toHaveLength(3);
      expect(items[0]!.title).toBe("Artists");
      expect(items[0]!.uri).toBe("plex/artists");
      expect(items[0]!.icon).toBe("fa fa-microphone");
      expect(items[1]!.title).toBe("Albums");
      expect(items[1]!.uri).toBe("plex/albums");
      expect(items[1]!.icon).toBe("fa fa-music");
      expect(items[2]!.title).toBe("Playlists");
      expect(items[2]!.uri).toBe("plex/playlists");
      expect(items[2]!.icon).toBe("fa fa-list");
    });

    it("sets prev URI to /", async () => {
      const result = (await adapter.handleBrowseUri("plex")) as NavigationPage;
      expect(result.navigation.prev.uri).toBe("/");
    });
  });

  // ── Browse: artists ─────────────────────────────────────────────

  describe("handleBrowseUri — artists", () => {
    it("returns artists from first library when no pagination state", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists")) as NavigationPage;

      expect(mockService.getArtistsPaginated).toHaveBeenCalledWith("1", 0, 100, undefined);
      // lists[0] is sort picker, lists[1] is artist list
      const items = result.navigation.lists[1]!.items;
      // 2 artists + "Load more..." (rolls over to second library)
      expect(items).toHaveLength(3);
      expect(items[0]!.title).toBe("Radiohead");
      expect(items[0]!.type).toBe("folder");
      expect(items[0]!.albumart).toContain("/library/metadata/500/thumb/123");
      expect(items[1]!.title).toBe("Pink Floyd");
      expect(items[1]!.albumart).toBeUndefined();
      expect(items[2]!.title).toBe("Load more...");
      expect(items[2]!.uri).toBe("plex/artists@3:0");
    });

    it("shows sort picker as the first list with 6 options", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists")) as NavigationPage;

      const sortList = result.navigation.lists[0]!;
      expect(sortList.title).toBe("Sort by");
      expect(sortList.items).toHaveLength(6);
      expect(sortList.items[0]!.title).toBe("By Name (A → Z)");
      expect(sortList.items[0]!.uri).toBe("plex/artists~titleSort:asc");
      expect(sortList.items[1]!.title).toBe("By Name (Z → A)");
      expect(sortList.items[1]!.uri).toBe("plex/artists~titleSort:desc");
      expect(sortList.items[2]!.title).toBe("Recently Added");
      expect(sortList.items[2]!.uri).toBe("plex/artists~addedAt:desc");
      expect(sortList.items[3]!.title).toBe("Added (Oldest First)");
      expect(sortList.items[3]!.uri).toBe("plex/artists~addedAt:asc");
      expect(sortList.items[4]!.title).toBe("Most Played");
      expect(sortList.items[4]!.uri).toBe("plex/artists~viewCount:desc");
      expect(sortList.items[5]!.title).toBe("Least Played");
      expect(sortList.items[5]!.uri).toBe("plex/artists~viewCount:asc");
    });

    it("artist URIs encode the albumsKey", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.uri).toBe("plex/artist/%2Flibrary%2Fmetadata%2F500%2Fchildren");
    });

    it("shows Load more when there are more results", async () => {
      vi.mocked(mockService.getArtistsPaginated).mockResolvedValue({
        items: artistsFixture,
        totalSize: 150,
        offset: 0,
      });

      const result = (await adapter.handleBrowseUri("plex/artists")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      const lastItem = items[items.length - 1]!;
      expect(lastItem.title).toBe("Load more...");
      expect(lastItem.uri).toBe("plex/artists@1:2");
    });

    it("rolls over to next library when current is exhausted", async () => {
      vi.mocked(mockService.getArtistsPaginated).mockResolvedValue({
        items: artistsFixture,
        totalSize: 2,
        offset: 0,
      });

      const result = (await adapter.handleBrowseUri("plex/artists@1:0")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      const lastItem = items[items.length - 1]!;
      expect(lastItem.title).toBe("Load more...");
      expect(lastItem.uri).toBe("plex/artists@3:0");
    });

    it("fetches with correct offset from paginated URI", async () => {
      await adapter.handleBrowseUri("plex/artists@1:100");
      expect(mockService.getArtistsPaginated).toHaveBeenCalledWith("1", 100, 100, undefined);
    });

    it("shows Previous page on subsequent pages", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists@1:100")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.title).toBe("Previous page");
      expect(items[0]!.uri).toBe("plex/artists");
      expect(items[0]!.icon).toBe("fa fa-arrow-circle-up");
    });

    it("Previous page links to intermediate page when not near the start", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists@1:200")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.title).toBe("Previous page");
      expect(items[0]!.uri).toBe("plex/artists@1:100");
    });

    it("omits Previous page on first page", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.title).not.toBe("Previous page");
    });

    it("omits Load more on last page of last library", async () => {
      // Only one library
      vi.mocked(mockService.getLibraries).mockResolvedValue([librariesFixture[0]!]);
      vi.mocked(mockService.getArtistsPaginated).mockResolvedValue({
        items: artistsFixture,
        totalSize: 2,
        offset: 0,
      });

      const result = (await adapter.handleBrowseUri("plex/artists")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items.every((i) => i.title !== "Load more...")).toBe(true);
    });

    it("passes sort to getArtistsPaginated when sort is in URI", async () => {
      await adapter.handleBrowseUri("plex/artists~titleSort:desc");

      expect(mockService.getArtistsPaginated).toHaveBeenCalledWith("1", 0, 100, "titleSort:desc");
    });

    it("preserves sort in Load more URI", async () => {
      vi.mocked(mockService.getArtistsPaginated).mockResolvedValue({
        items: artistsFixture,
        totalSize: 500,
        offset: 0,
      });

      const result = (await adapter.handleBrowseUri("plex/artists~addedAt:desc")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      const lastItem = items[items.length - 1]!;
      expect(lastItem.uri).toBe("plex/artists~addedAt:desc@1:2");
    });

    it("preserves sort in Previous page URI", async () => {
      const result = (await adapter.handleBrowseUri("plex/artists~titleSort:asc@1:100")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.title).toBe("Previous page");
      expect(items[0]!.uri).toBe("plex/artists~titleSort:asc");
    });
  });

  // ── Browse: artist (albums by artist) ─────────────────────────

  describe("handleBrowseUri — artist", () => {
    it("returns albums for an artist", async () => {
      const uri = "plex/artist/%2Flibrary%2Fmetadata%2F500%2Fchildren";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;

      expect(mockService.getArtistAlbums).toHaveBeenCalledWith(
        "/library/metadata/500/children",
      );
      const items = result.navigation.lists[0]!.items;
      expect(items).toHaveLength(3);
      // Albums first
      expect(items[0]!.title).toBe("OK Computer");
      expect(items[0]!.artist).toBe("Radiohead");
      expect(items[0]!.type).toBe("folder");
      // Popular Tracks folder at the end
      expect(items[2]!.title).toBe("Popular Tracks");
      expect(items[2]!.type).toBe("folder");
      expect(items[2]!.uri).toBe("plex/popular/500");
    });

    it("sets prev URI to plex/artists", async () => {
      const uri = "plex/artist/%2Flibrary%2Fmetadata%2F500%2Fchildren";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;
      expect(result.navigation.prev.uri).toBe("plex/artists");
    });
  });

  // ── Browse: albums ────────────────────────────────────────────

  describe("handleBrowseUri — albums", () => {
    it("returns albums from first library when no pagination state", async () => {
      const result = (await adapter.handleBrowseUri("plex/albums")) as NavigationPage;

      expect(mockService.getAlbumsPaginated).toHaveBeenCalledWith("1", 0, 100, undefined);
      // lists[0] is sort picker, lists[1] is album list
      const items = result.navigation.lists[1]!.items;
      // 2 albums + "Load more..." (rolls over to second library)
      expect(items).toHaveLength(3);
      expect(items[0]!.title).toBe("OK Computer");
      expect(items[0]!.artist).toBe("Radiohead");
      expect(items[0]!.type).toBe("folder");
      expect(items[0]!.albumart).toContain("/library/metadata/1001/thumb/123");
      expect(items[1]!.albumart).toBeUndefined();
      expect(items[2]!.title).toBe("Load more...");
    });

    it("shows sort picker as the first list with 8 options", async () => {
      const result = (await adapter.handleBrowseUri("plex/albums")) as NavigationPage;

      const sortList = result.navigation.lists[0]!;
      expect(sortList.title).toBe("Sort by");
      expect(sortList.items).toHaveLength(8);
      expect(sortList.items[0]!.title).toBe("By Artist (A → Z)");
      expect(sortList.items[0]!.uri).toBe("plex/albums~artist.titleSort:asc");
      expect(sortList.items[1]!.title).toBe("By Artist (Z → A)");
      expect(sortList.items[1]!.uri).toBe("plex/albums~artist.titleSort:desc");
      expect(sortList.items[2]!.title).toBe("By Title (A → Z)");
      expect(sortList.items[2]!.uri).toBe("plex/albums~titleSort:asc");
      expect(sortList.items[3]!.title).toBe("By Title (Z → A)");
      expect(sortList.items[3]!.uri).toBe("plex/albums~titleSort:desc");
      expect(sortList.items[4]!.title).toBe("By Release Date (Newest)");
      expect(sortList.items[4]!.uri).toBe("plex/albums~originallyAvailableAt:desc");
      expect(sortList.items[5]!.title).toBe("By Release Date (Oldest)");
      expect(sortList.items[5]!.uri).toBe("plex/albums~originallyAvailableAt:asc");
      expect(sortList.items[6]!.title).toBe("Recently Added (Newest)");
      expect(sortList.items[6]!.uri).toBe("plex/albums~addedAt:desc");
      expect(sortList.items[7]!.title).toBe("Recently Added (Oldest)");
      expect(sortList.items[7]!.uri).toBe("plex/albums~addedAt:asc");
    });

    it("album URIs encode the trackListKey", async () => {
      const result = (await adapter.handleBrowseUri("plex/albums")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.uri).toBe("plex/album/%2Flibrary%2Fmetadata%2F1001%2Fchildren");
    });

    it("shows Load more when there are more results", async () => {
      vi.mocked(mockService.getAlbumsPaginated).mockResolvedValue({
        items: albumsFixture,
        totalSize: 500,
        offset: 0,
      });

      const result = (await adapter.handleBrowseUri("plex/albums")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      const lastItem = items[items.length - 1]!;
      expect(lastItem.title).toBe("Load more...");
      expect(lastItem.uri).toBe("plex/albums@1:2");
    });

    it("shows Previous page on subsequent pages", async () => {
      const result = (await adapter.handleBrowseUri("plex/albums@1:100")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.title).toBe("Previous page");
      expect(items[0]!.uri).toBe("plex/albums");
    });

    it("passes sort to getAlbumsPaginated when sort is in URI", async () => {
      await adapter.handleBrowseUri("plex/albums~titleSort:asc");

      expect(mockService.getAlbumsPaginated).toHaveBeenCalledWith("1", 0, 100, "titleSort:asc");
    });

    it("preserves sort in Load more URI", async () => {
      vi.mocked(mockService.getAlbumsPaginated).mockResolvedValue({
        items: albumsFixture,
        totalSize: 500,
        offset: 0,
      });

      const result = (await adapter.handleBrowseUri("plex/albums~titleSort:asc")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      const lastItem = items[items.length - 1]!;
      expect(lastItem.uri).toBe("plex/albums~titleSort:asc@1:2");
    });

    it("preserves sort in Previous page URI", async () => {
      const result = (await adapter.handleBrowseUri("plex/albums~titleSort:asc@1:100")) as NavigationPage;
      const items = result.navigation.lists[1]!.items;
      expect(items[0]!.title).toBe("Previous page");
      expect(items[0]!.uri).toBe("plex/albums~titleSort:asc");
    });

    it("passes descending sort to getAlbumsPaginated", async () => {
      await adapter.handleBrowseUri("plex/albums~titleSort:desc");

      expect(mockService.getAlbumsPaginated).toHaveBeenCalledWith("1", 0, 100, "titleSort:desc");
    });
  });

  // ── Browse: album ────────────────────────────────────────────────

  describe("handleBrowseUri — album", () => {
    it("returns tracks for an album", async () => {
      const uri = "plex/album/%2Flibrary%2Fmetadata%2F1001%2Fchildren";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;

      expect(mockService.getAlbumTracks).toHaveBeenCalledWith(
        "/library/metadata/1001/children",
      );
      const items = result.navigation.lists[0]!.items;
      expect(items).toHaveLength(2);
      expect(items[0]!.title).toBe("Airbag");
      expect(items[0]!.type).toBe("song");
      expect(items[0]!.uri).toBe("plex/track/2001");
      // Duration should be in seconds
      expect(items[0]!.duration).toBe(282);
    });

    it("uses album title from first track as list title", async () => {
      const uri = "plex/album/%2Flibrary%2Fmetadata%2F1001%2Fchildren";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;
      expect(result.navigation.lists[0]!.title).toBe("OK Computer");
    });
  });

  // ── Browse: playlists ────────────────────────────────────────────

  describe("handleBrowseUri — playlists", () => {
    it("returns playlist list", async () => {
      const result = (await adapter.handleBrowseUri("plex/playlists")) as NavigationPage;

      expect(mockService.getPlaylists).toHaveBeenCalledOnce();
      const items = result.navigation.lists[0]!.items;
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe("Favorites");
      expect(items[0]!.type).toBe("folder");
      expect(items[0]!.uri).toBe("plex/playlist/%2Fplaylists%2F5001%2Fitems");
    });
  });

  // ── Browse: playlist tracks ──────────────────────────────────────

  describe("handleBrowseUri — playlist tracks", () => {
    it("returns tracks in a playlist", async () => {
      const uri = "plex/playlist/%2Fplaylists%2F5001%2Fitems";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;

      expect(mockService.getPlaylistTracksPaginated).toHaveBeenCalledWith("/playlists/5001/items", 0, 100);
      const items = result.navigation.lists[0]!.items;
      expect(items).toHaveLength(2);
      expect(items[0]!.title).toBe("Airbag");
      expect(items[0]!.type).toBe("song");
    });

    it("sets prev URI to plex/playlists", async () => {
      const uri = "plex/playlist/%2Fplaylists%2F5001%2Fitems";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;
      expect(result.navigation.prev.uri).toBe("plex/playlists");
    });

    it("shows Load more when there are more tracks", async () => {
      vi.mocked(mockService.getPlaylistTracksPaginated).mockResolvedValue({
        items: tracksFixture,
        totalSize: 200,
        offset: 0,
      });

      const uri = "plex/playlist/%2Fplaylists%2F5001%2Fitems";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;
      const lastList = result.navigation.lists[result.navigation.lists.length - 1]!;
      const lastItem = lastList.items[lastList.items.length - 1]!;
      expect(lastItem.title).toBe("Load more...");
      expect(lastItem.uri).toBe("plex/playlist/%2Fplaylists%2F5001%2Fitems@2");
    });

    it("fetches with correct offset from paginated URI", async () => {
      const uri = "plex/playlist/%2Fplaylists%2F5001%2Fitems@50";
      await adapter.handleBrowseUri(uri);
      expect(mockService.getPlaylistTracksPaginated).toHaveBeenCalledWith("/playlists/5001/items", 50, 100);
    });

    it("shows Previous page on subsequent pages", async () => {
      const uri = "plex/playlist/%2Fplaylists%2F5001%2Fitems@50";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;
      const items = result.navigation.lists[0]!.items;
      expect(items[0]!.title).toBe("Previous page");
      expect(items[0]!.uri).toBe("plex/playlist/%2Fplaylists%2F5001%2Fitems");
    });

    it("omits Load more on last page", async () => {
      vi.mocked(mockService.getPlaylistTracksPaginated).mockResolvedValue({
        items: tracksFixture,
        totalSize: 2,
        offset: 0,
      });

      const uri = "plex/playlist/%2Fplaylists%2F5001%2Fitems";
      const result = (await adapter.handleBrowseUri(uri)) as NavigationPage;
      const items = result.navigation.lists[0]!.items;
      expect(items.every((i) => i.title !== "Load more...")).toBe(true);
    });
  });

  // ── Browse: error handling ───────────────────────────────────────

  describe("handleBrowseUri — errors", () => {
    it("rejects unknown URIs", async () => {
      await expect(adapter.handleBrowseUri("plex/unknown/thing")).rejects.toThrow(
        "Unknown browse URI",
      );
    });

    it("propagates PlexService errors", async () => {
      vi.mocked(mockService.getArtistsPaginated).mockRejectedValue(new Error("Network failure"));
      await expect(adapter.handleBrowseUri("plex/artists")).rejects.toThrow("Network failure");
    });
  });

  // ── Explode: single track ────────────────────────────────────────

  describe("explodeUri — track", () => {
    it("resolves a single track to a QueueItem", async () => {
      const result = (await adapter.explodeUri("plex/track/2001")) as QueueItem[];

      expect(mockService.getPlayableTrack).toHaveBeenCalledWith("2001");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("Airbag");
      expect(result[0]!.artist).toBe("Radiohead");
      expect(result[0]!.album).toBe("OK Computer");
      expect(result[0]!.uri).toBe("plex/track/2001/stream/%2Flibrary%2Fparts%2F2001%2Ffile.flac");
      expect(result[0]!.uri).not.toContain("Token");
      expect(result[0]!.service).toBe("plex");
      expect(result[0]!.type).toBe("track");
      expect(result[0]!.duration).toBe(282);
    });
  });

  // ── Explode: album ───────────────────────────────────────────────

  describe("explodeUri — album", () => {
    it("resolves all album tracks to QueueItems", async () => {
      const uri = "plex/album/%2Flibrary%2Fmetadata%2F1001%2Fchildren";
      const result = (await adapter.explodeUri(uri)) as QueueItem[];

      expect(mockService.getAlbumTracks).toHaveBeenCalledWith(
        "/library/metadata/1001/children",
      );
      expect(mockService.getPlayableTrack).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("Airbag");
      expect(result[0]!.uri).toBe("plex/track/2001/stream/%2Flibrary%2Fparts%2F2001%2Ffile.flac");
      expect(result[0]!.uri).not.toContain("Token");
      expect(result[1]!.name).toBe("Paranoid Android");
      expect(result[1]!.uri).toBe("plex/track/2002/stream/%2Flibrary%2Fparts%2F2002%2Ffile.flac");
    });
  });

  // ── Explode: errors ──────────────────────────────────────────────

  describe("explodeUri — errors", () => {
    it("rejects unknown URIs", async () => {
      await expect(adapter.explodeUri("plex/unknown/123")).rejects.toThrow("Cannot explode URI");
    });
  });

  // ── Explode: tracks with no media ────────────────────────────────

  describe("explodeUri — missing streamKey", () => {
    it("filters out tracks with empty streamKey in multi-track explode", async () => {
      const tracksWithMissing: Track[] = [
        { ...tracksFixture[0]! },
        { ...tracksFixture[1]!, streamKey: "" },
      ];
      vi.mocked(mockService.getAlbumTracks).mockResolvedValue(tracksWithMissing);

      const result = (await adapter.explodeUri("plex/album/%2Flibrary%2Fmetadata%2F1001%2Fchildren")) as QueueItem[];
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("Airbag");
    });

    it("rejects single-track explode when getPlayableTrack throws for missing media", async () => {
      vi.mocked(mockService.getPlayableTrack).mockRejectedValue(new Error("Track 2001 has no playable media"));
      await expect(adapter.explodeUri("plex/track/2001")).rejects.toThrow("has no playable media");
    });
  });

  // ── clearAddPlayTrack ────────────────────────────────────────────

  describe("clearAddPlayTrack", () => {
    const queueItem: QueueItem = {
      uri: "plex/stream/%2Flibrary%2Fparts%2F2001%2Ffile.flac",
      service: "plex",
      name: "Airbag",
      artist: "Radiohead",
      album: "OK Computer",
      albumart: "",
      duration: 282,
      type: "track",
    };

    // The resolved stream URL that getStreamUrl returns for the encoded key
    const resolvedUrl = "http://192.168.1.100:32400/library/parts/2001/file.flac?X-Plex-Token=test-token";

    it("sends stop, clear, then tries load before falling back to addid", async () => {
      // load fails, so addid is used as fallback
      vi.mocked(mpdPlugin.sendMpdCommand).mockImplementation((cmd: string) => {
        if (cmd.startsWith("load ")) return Promise.reject(new Error("not supported"));
        if (cmd.startsWith("addid ")) return Promise.resolve({ Id: "42" });
        return Promise.resolve(undefined);
      });

      await adapter.clearAddPlayTrack(queueItem);

      const mpdSend = vi.mocked(mpdPlugin.sendMpdCommand);
      expect(mpdSend).toHaveBeenCalledWith("stop", []);
      expect(mpdSend).toHaveBeenCalledWith("clear", []);
      expect(mpdSend).toHaveBeenCalledWith(`load "${resolvedUrl}"`, []);
      expect(mpdSend).toHaveBeenCalledWith(`addid "${resolvedUrl}"`, []);
      expect(mpdSend).toHaveBeenCalledWith("play", []);
    });

    it("skips addid when load succeeds", async () => {
      await adapter.clearAddPlayTrack(queueItem);

      const mpdSend = vi.mocked(mpdPlugin.sendMpdCommand);
      expect(mpdSend).toHaveBeenCalledWith(`load "${resolvedUrl}"`, []);
      expect(mpdSend).not.toHaveBeenCalledWith(`addid "${resolvedUrl}"`, []);
    });

    it("sets metadata tags via addtagid when addid returns a song ID", async () => {
      vi.mocked(mpdPlugin.sendMpdCommand).mockImplementation((cmd: string) => {
        if (cmd.startsWith("load ")) return Promise.reject(new Error("not supported"));
        if (cmd.startsWith("addid ")) return Promise.resolve({ Id: "42" });
        return Promise.resolve(undefined);
      });

      await adapter.clearAddPlayTrack(queueItem);

      expect(vi.mocked(mpdPlugin.sendMpdCommandArray)).toHaveBeenCalledWith([
        { command: "addtagid", parameters: ["42", "title", "Airbag"] },
        { command: "addtagid", parameters: ["42", "album", "OK Computer"] },
        { command: "addtagid", parameters: ["42", "artist", "Radiohead"] },
      ]);
    });

    it("does not set tags when load succeeds (no song ID)", async () => {
      await adapter.clearAddPlayTrack(queueItem);

      expect(vi.mocked(mpdPlugin.sendMpdCommandArray)).not.toHaveBeenCalled();
    });

    it("decodes legacy __ encoded stream URIs", async () => {
      const legacyItem: QueueItem = {
        ...queueItem,
        uri: "plex/stream/__library__parts__2001__file.flac",
      };
      await adapter.clearAddPlayTrack(legacyItem);
      expect(vi.mocked(mpdPlugin.sendMpdCommand)).toHaveBeenCalledWith(`load "${resolvedUrl}"`, []);
    });

    it("sets consume update service before playing", async () => {
      await adapter.clearAddPlayTrack(queueItem);

      expect(commandRouter.stateMachine.setConsumeUpdateService).toHaveBeenCalledWith(
        "mpd",
        true,
        false,
      );
    });
  });

  // ── Playback controls ────────────────────────────────────────────

  describe("playback controls", () => {
    it("stop sets consume update service and delegates to mpd plugin", async () => {
      await adapter.stop();
      expect(commandRouter.stateMachine.setConsumeUpdateService).toHaveBeenCalledWith("mpd", true, false);
      expect(vi.mocked(mpdPlugin.stop)).toHaveBeenCalled();
    });

    it("pause sets consume update service and delegates to mpd plugin", async () => {
      await adapter.pause();
      expect(commandRouter.stateMachine.setConsumeUpdateService).toHaveBeenCalledWith("mpd", true, false);
      expect(vi.mocked(mpdPlugin.pause)).toHaveBeenCalled();
    });

    it("resume sets consume update service and delegates to mpd plugin", async () => {
      await adapter.resume();
      expect(commandRouter.stateMachine.setConsumeUpdateService).toHaveBeenCalledWith("mpd", true, false);
      expect(vi.mocked(mpdPlugin.resume)).toHaveBeenCalled();
    });

    it("seek sets consume update service and delegates to mpd plugin", async () => {
      await adapter.seek(45000);
      expect(commandRouter.stateMachine.setConsumeUpdateService).toHaveBeenCalledWith("mpd", true, false);
      expect(vi.mocked(mpdPlugin.seek)).toHaveBeenCalledWith(45000);
    });
  });

  // ── Search ───────────────────────────────────────────────────────

  describe("search", () => {
    it("returns tracks, artists, and albums in Volumio format", async () => {
      const result = (await adapter.search({ value: "radiohead" })) as SearchResultSection[];

      expect(mockService.search).toHaveBeenCalledWith("radiohead");
      expect(result).toHaveLength(3);

      // Tracks section
      expect(result[0]!.title).toBe("Plex Tracks");
      expect(result[0]!.items).toHaveLength(2);
      expect(result[0]!.items[0]!.title).toBe("Airbag");
      expect(result[0]!.items[0]!.type).toBe("song");

      // Artists section
      expect(result[1]!.title).toBe("Plex Artists");
      expect(result[1]!.items).toHaveLength(2);
      expect(result[1]!.items[0]!.title).toBe("Radiohead");
      expect(result[1]!.items[0]!.type).toBe("folder");

      // Albums section
      expect(result[2]!.title).toBe("Plex Albums");
      expect(result[2]!.items).toHaveLength(2);
      expect(result[2]!.items[0]!.title).toBe("OK Computer");
      expect(result[2]!.items[0]!.type).toBe("folder");
    });

    it("omits empty sections", async () => {
      vi.mocked(mockService.search).mockResolvedValue({ tracks: [], albums: [], artists: [] });

      const result = (await adapter.search({ value: "nothing" })) as SearchResultSection[];
      expect(result).toHaveLength(0);
    });

    it("returns only tracks section when no album or artist matches", async () => {
      vi.mocked(mockService.search).mockResolvedValue({
        tracks: tracksFixture,
        albums: [],
        artists: [],
      });

      const result = (await adapter.search({ value: "airbag" })) as SearchResultSection[];
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe("Plex Tracks");
    });
  });

  // ── pushState ────────────────────────────────────────────────────

  describe("pushState", () => {
    it("delegates to commandRouter.servicePushState", () => {
      const state = {
        status: "play" as const,
        service: "plex",
        title: "Test",
        artist: "Artist",
        album: "Album",
        albumart: "",
        uri: "http://example.com/track",
        seek: 0,
        duration: 300,
      };

      adapter.pushState(state);

      expect(commandRouter.servicePushState).toHaveBeenCalledWith(state, "plex");
    });
  });
});
