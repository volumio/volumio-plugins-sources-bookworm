import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlexService } from "./plex-service.js";
import type { PlexApiClient } from "./api-client.js";
import type { PlexConnection } from "../core/stream-resolver.js";
import type {
  RawLibraryResponse,
  RawArtistResponse,
  RawAlbumResponse,
  RawTrackResponse,
  RawPlaylistResponse,
} from "../types/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────

const connection: PlexConnection = {
  host: "192.168.1.100",
  port: 32400,
  token: "test-token",
};

const librariesFixture: RawLibraryResponse = {
  MediaContainer: {
    size: 3,
    Directory: [
      { key: "1", title: "Music", type: "artist" },
      { key: "2", title: "Movies", type: "movie" },
      { key: "3", title: "Podcasts", type: "artist" },
    ],
  },
};

const albumsFixture: RawAlbumResponse = {
  MediaContainer: {
    size: 2,
    Metadata: [
      {
        ratingKey: "1001",
        key: "/library/metadata/1001/children",
        title: "OK Computer",
        parentTitle: "Radiohead",
        thumb: "/library/metadata/1001/thumb/123",
        year: 1997,
      },
      {
        ratingKey: "1002",
        key: "/library/metadata/1002/children",
        title: "Kid A",
        parentTitle: "Radiohead",
        year: 2000,
      },
    ],
  },
};

const tracksFixture: RawTrackResponse = {
  MediaContainer: {
    size: 2,
    Metadata: [
      {
        ratingKey: "2001",
        key: "/library/metadata/2001",
        title: "Airbag",
        grandparentTitle: "Radiohead",
        grandparentKey: "/library/metadata/1000/children",
        parentTitle: "OK Computer",
        parentKey: "/library/metadata/1001/children",
        duration: 282000,
        thumb: "/library/metadata/1001/thumb/123",
        Media: [{ Part: [{ key: "/library/parts/2001/file.flac" }] }],
      },
      {
        ratingKey: "2002",
        key: "/library/metadata/2002",
        title: "Paranoid Android",
        grandparentTitle: "Radiohead",
        grandparentKey: "/library/metadata/1000/children",
        parentTitle: "OK Computer",
        parentKey: "/library/metadata/1001/children",
        duration: 383000,
        Media: [{ Part: [{ key: "/library/parts/2002/file.flac" }] }],
      },
    ],
  },
};

const singleTrackFixture: RawTrackResponse = {
  MediaContainer: {
    size: 1,
    Metadata: [
      {
        ratingKey: "2001",
        key: "/library/metadata/2001",
        title: "Airbag",
        grandparentTitle: "Radiohead",
        grandparentKey: "/library/metadata/1000/children",
        parentTitle: "OK Computer",
        parentKey: "/library/metadata/1001/children",
        duration: 282000,
        thumb: "/library/metadata/1001/thumb/123",
        Media: [{ Part: [{ key: "/library/parts/2001/file.flac" }] }],
      },
    ],
  },
};

const playlistsFixture: RawPlaylistResponse = {
  MediaContainer: {
    size: 2,
    Metadata: [
      {
        ratingKey: "5001",
        key: "/playlists/5001/items",
        title: "Favorites",
        playlistType: "audio",
        leafCount: 10,
      },
      {
        ratingKey: "5002",
        key: "/playlists/5002/items",
        title: "Movie Clips",
        playlistType: "video",
        leafCount: 5,
      },
    ],
  },
};

const artistsFixture: RawArtistResponse = {
  MediaContainer: {
    size: 1,
    Metadata: [
      {
        ratingKey: "500",
        key: "/library/metadata/500/children",
        title: "Radiohead",
        thumb: "/library/metadata/500/thumb/123",
      },
    ],
  },
};

const emptyTracksFixture: RawTrackResponse = {
  MediaContainer: {
    size: 0,
    Metadata: [],
  },
};

// ── Mock client ───────────────────────────────────────────────────────

function createMockClient(): PlexApiClient {
  return {
    getLibraries: vi.fn(),
    getAlbums: vi.fn(),
    getTracks: vi.fn(),
    getPlaylists: vi.fn(),
    getPlaylistItems: vi.fn(),
    getTrackMetadata: vi.fn(),
    searchTracks: vi.fn(),
    searchAlbums: vi.fn(),
    searchArtists: vi.fn(),
  } as unknown as PlexApiClient;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("PlexService", () => {
  let client: ReturnType<typeof createMockClient>;
  let service: PlexService;

  beforeEach(() => {
    client = createMockClient();
    service = new PlexService(client, connection);
  });

  // ── getLibraries ──────────────────────────────────────────────────

  describe("getLibraries", () => {
    it("returns only music libraries", async () => {
      vi.mocked(client.getLibraries).mockResolvedValue(librariesFixture);

      const libraries = await service.getLibraries();

      expect(client.getLibraries).toHaveBeenCalledOnce();
      expect(libraries).toHaveLength(2);
      expect(libraries[0]!.title).toBe("Music");
      expect(libraries[1]!.title).toBe("Podcasts");
      expect(libraries.every((l) => l.type === "artist")).toBe(true);
    });
  });

  // ── getAlbums ─────────────────────────────────────────────────────

  describe("getAlbums", () => {
    it("fetches and parses albums for a library section", async () => {
      vi.mocked(client.getAlbums).mockResolvedValue(albumsFixture);

      const albums = await service.getAlbums("1");

      expect(client.getAlbums).toHaveBeenCalledWith("1");
      expect(albums).toHaveLength(2);
      expect(albums[0]!.title).toBe("OK Computer");
      expect(albums[0]!.artist).toBe("Radiohead");
      expect(albums[0]!.year).toBe(1997);
    });
  });

  // ── getAlbumTracks ────────────────────────────────────────────────

  describe("getAlbumTracks", () => {
    it("fetches and parses tracks for an album", async () => {
      vi.mocked(client.getTracks).mockResolvedValue(tracksFixture);

      const tracks = await service.getAlbumTracks("/library/metadata/1001/children");

      expect(client.getTracks).toHaveBeenCalledWith("/library/metadata/1001/children");
      expect(tracks).toHaveLength(2);
      expect(tracks[0]!.title).toBe("Airbag");
      expect(tracks[0]!.artist).toBe("Radiohead");
      expect(tracks[0]!.album).toBe("OK Computer");
      expect(tracks[0]!.duration).toBe(282000);
      expect(tracks[0]!.streamKey).toBe("/library/parts/2001/file.flac");
    });
  });

  // ── getPlaylists ──────────────────────────────────────────────────

  describe("getPlaylists", () => {
    it("returns only audio playlists", async () => {
      vi.mocked(client.getPlaylists).mockResolvedValue(playlistsFixture);

      const playlists = await service.getPlaylists();

      expect(client.getPlaylists).toHaveBeenCalledOnce();
      expect(playlists).toHaveLength(1);
      expect(playlists[0]!.title).toBe("Favorites");
      expect(playlists[0]!.trackCount).toBe(10);
    });
  });

  // ── getPlaylistTracks ─────────────────────────────────────────────

  describe("getPlaylistTracks", () => {
    it("fetches and parses tracks for a playlist", async () => {
      vi.mocked(client.getPlaylistItems).mockResolvedValue(tracksFixture);

      const tracks = await service.getPlaylistTracks("/playlists/5001/items");

      expect(client.getPlaylistItems).toHaveBeenCalledWith("/playlists/5001/items");
      expect(tracks).toHaveLength(2);
      expect(tracks[0]!.title).toBe("Airbag");
    });
  });

  // ── search ────────────────────────────────────────────────────────

  describe("search", () => {
    it("searches for tracks, albums, and artists in parallel", async () => {
      vi.mocked(client.searchTracks).mockResolvedValue(tracksFixture);
      vi.mocked(client.searchAlbums).mockResolvedValue(albumsFixture);
      vi.mocked(client.searchArtists).mockResolvedValue(artistsFixture);

      const results = await service.search("radiohead");

      expect(client.searchTracks).toHaveBeenCalledWith("radiohead");
      expect(client.searchAlbums).toHaveBeenCalledWith("radiohead");
      expect(client.searchArtists).toHaveBeenCalledWith("radiohead");
      expect(results.tracks).toHaveLength(2);
      expect(results.albums).toHaveLength(2);
      expect(results.artists).toHaveLength(1);
      expect(results.artists[0]!.title).toBe("Radiohead");
    });

    it("returns empty results when nothing matches", async () => {
      vi.mocked(client.searchTracks).mockResolvedValue(emptyTracksFixture);
      vi.mocked(client.searchAlbums).mockResolvedValue({
        MediaContainer: { size: 0, Metadata: [] },
      });
      vi.mocked(client.searchArtists).mockResolvedValue({
        MediaContainer: { size: 0, Metadata: [] },
      });

      const results = await service.search("nonexistent");

      expect(results.tracks).toHaveLength(0);
      expect(results.albums).toHaveLength(0);
      expect(results.artists).toHaveLength(0);
    });
  });

  // ── getPlayableTrack ──────────────────────────────────────────────

  describe("getPlayableTrack", () => {
    it("fetches track metadata and resolves stream URL", async () => {
      vi.mocked(client.getTrackMetadata).mockResolvedValue(singleTrackFixture);

      const playable = await service.getPlayableTrack("2001");

      expect(client.getTrackMetadata).toHaveBeenCalledWith("2001");
      expect(playable.id).toBe("2001");
      expect(playable.title).toBe("Airbag");
      expect(playable.streamUrl).toBe(
        "http://192.168.1.100:32400/library/parts/2001/file.flac?X-Plex-Token=test-token",
      );
    });

    it("includes all track fields in playable track", async () => {
      vi.mocked(client.getTrackMetadata).mockResolvedValue(singleTrackFixture);

      const playable = await service.getPlayableTrack("2001");

      expect(playable.artist).toBe("Radiohead");
      expect(playable.album).toBe("OK Computer");
      expect(playable.duration).toBe(282000);
      expect(playable.artworkUrl).toBe("/library/metadata/1001/thumb/123");
      expect(playable.streamKey).toBe("/library/parts/2001/file.flac");
    });

    it("throws when track is not found", async () => {
      vi.mocked(client.getTrackMetadata).mockResolvedValue(emptyTracksFixture);

      await expect(service.getPlayableTrack("9999")).rejects.toThrow("Track not found: 9999");
    });

    it("throws when track has no playable media", async () => {
      const noMediaFixture: RawTrackResponse = {
        MediaContainer: {
          size: 1,
          Metadata: [{ ...singleTrackFixture.MediaContainer.Metadata![0]!, Media: [] }],
        },
      };
      vi.mocked(client.getTrackMetadata).mockResolvedValue(noMediaFixture);

      await expect(service.getPlayableTrack("2001")).rejects.toThrow("Track 2001 has no playable media");
    });
  });

  // ── getArtworkUrl ─────────────────────────────────────────────────

  describe("getArtworkUrl", () => {
    it("builds a full artwork URL with authentication", () => {
      const url = service.getArtworkUrl("/library/metadata/1001/thumb/123");

      expect(url).toBe(
        "http://192.168.1.100:32400/library/metadata/1001/thumb/123?X-Plex-Token=test-token",
      );
    });
  });

  // ── Error propagation ─────────────────────────────────────────────

  describe("error propagation", () => {
    it("propagates API client errors", async () => {
      const error = new Error("Network failure");
      vi.mocked(client.getLibraries).mockRejectedValue(error);

      await expect(service.getLibraries()).rejects.toThrow("Network failure");
    });
  });
});
