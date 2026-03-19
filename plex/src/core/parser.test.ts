import { describe, it, expect } from "vitest";
import { parseLibraries, parseAlbums, parseTracks, parsePlaylists } from "./parser.js";
import type {
  RawLibraryResponse,
  RawAlbumResponse,
  RawTrackResponse,
  RawPlaylistResponse,
} from "../types/index.js";
import librariesFixture from "../../test/fixtures/libraries.json";
import albumsFixture from "../../test/fixtures/albums.json";
import tracksFixture from "../../test/fixtures/tracks.json";
import playlistsFixture from "../../test/fixtures/playlists.json";

// ── parseLibraries ───────────────────────────────────────────────────

describe("parseLibraries", () => {
  it("parses valid library response and filters to music libraries", () => {
    const result = parseLibraries(librariesFixture as RawLibraryResponse);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "1",
      title: "Music",
      type: "artist",
    });
    expect(result[1]).toEqual({
      id: "3",
      title: "Podcasts",
      type: "artist",
    });
  });

  it("filters out non-music libraries", () => {
    const result = parseLibraries(librariesFixture as RawLibraryResponse);
    const types = result.map((lib) => lib.type);
    expect(types.every((t) => t === "artist")).toBe(true);
  });

  it("handles empty directory array", () => {
    const empty: RawLibraryResponse = {
      MediaContainer: { size: 0, Directory: [] },
    };
    expect(parseLibraries(empty)).toEqual([]);
  });

  it("handles response with no music libraries", () => {
    const noMusic: RawLibraryResponse = {
      MediaContainer: {
        size: 1,
        Directory: [{ key: "1", title: "Movies", type: "movie" }],
      },
    };
    expect(parseLibraries(noMusic)).toEqual([]);
  });
});

// ── parsePlaylists ───────────────────────────────────────────────────

describe("parsePlaylists", () => {
  it("parses valid playlist response and filters to audio playlists", () => {
    const result = parsePlaylists(playlistsFixture as RawPlaylistResponse);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "5001",
      title: "Chill Vibes",
      trackCount: 25,
      itemsKey: "/playlists/5001/items",
    });
    expect(result[1]).toEqual({
      id: "5003",
      title: "Road Trip",
      trackCount: 42,
      itemsKey: "/playlists/5003/items",
    });
  });

  it("filters out non-audio playlists", () => {
    const result = parsePlaylists(playlistsFixture as RawPlaylistResponse);
    expect(result.every((p) => p.title !== "Movie Night")).toBe(true);
  });

  it("handles empty metadata array", () => {
    const empty: RawPlaylistResponse = {
      MediaContainer: { size: 0, Metadata: [] },
    };
    expect(parsePlaylists(empty)).toEqual([]);
  });

  it("handles response with no audio playlists", () => {
    const videoOnly: RawPlaylistResponse = {
      MediaContainer: {
        size: 1,
        Metadata: [
          {
            ratingKey: "9999",
            key: "/playlists/9999/items",
            title: "Videos",
            playlistType: "video",
            leafCount: 5,
          },
        ],
      },
    };
    expect(parsePlaylists(videoOnly)).toEqual([]);
  });
});

// ── parseAlbums ──────────────────────────────────────────────────────

describe("parseAlbums", () => {
  it("parses valid album response", () => {
    const result = parseAlbums(albumsFixture as RawAlbumResponse);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "1001",
      title: "OK Computer",
      artist: "Radiohead",
      year: 1997,
      artworkUrl: "/library/metadata/1001/thumb/1609459200",
      trackListKey: "/library/metadata/1001/children",
    });
  });

  it("handles missing optional fields", () => {
    const result = parseAlbums(albumsFixture as RawAlbumResponse);
    const unknownAlbum = result[1]!;
    expect(unknownAlbum.year).toBeNull();
    expect(unknownAlbum.artworkUrl).toBeNull();
  });

  it("handles empty metadata array", () => {
    const empty: RawAlbumResponse = {
      MediaContainer: { size: 0, Metadata: [] },
    };
    expect(parseAlbums(empty)).toEqual([]);
  });
});

// ── parseTracks ──────────────────────────────────────────────────────

describe("parseTracks", () => {
  it("parses valid track response", () => {
    const result = parseTracks(tracksFixture as RawTrackResponse);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      id: "2001",
      title: "Airbag",
      artist: "Radiohead",
      album: "OK Computer",
      duration: 282000,
      artworkUrl: "/library/metadata/1001/thumb/1609459200",
      streamKey: "/library/parts/2001/1234567/file.flac",
      trackType: "flac",
      samplerate: "44.1 kHz",
      bitdepth: "24 bit",
    });
  });

  it("extracts audio quality fields from Media[0]", () => {
    const result = parseTracks(tracksFixture as RawTrackResponse);
    // Track with full quality data
    expect(result[0]!.trackType).toBe("flac");
    expect(result[0]!.samplerate).toBe("44.1 kHz");
    expect(result[0]!.bitdepth).toBe("24 bit");
    // Track with codec but no bitDepth/samplingRate
    expect(result[1]!.trackType).toBe("mp3");
    expect(result[1]!.samplerate).toBeNull();
    expect(result[1]!.bitdepth).toBeNull();
    // Track with 16-bit / 48 kHz
    expect(result[2]!.trackType).toBe("flac");
    expect(result[2]!.samplerate).toBe("48 kHz");
    expect(result[2]!.bitdepth).toBe("16 bit");
  });

  it("handles missing artwork", () => {
    const result = parseTracks(tracksFixture as RawTrackResponse);
    const paranoid = result[1]!;
    expect(paranoid.artworkUrl).toBeNull();
  });

  it("extracts stream key from first Media/Part", () => {
    const result = parseTracks(tracksFixture as RawTrackResponse);
    expect(result[0]!.streamKey).toBe(
      "/library/parts/2001/1234567/file.flac"
    );
    expect(result[2]!.streamKey).toBe(
      "/library/parts/2003/1234569/file.flac"
    );
  });

  it("handles empty metadata array", () => {
    const empty: RawTrackResponse = {
      MediaContainer: { size: 0, Metadata: [] },
    };
    expect(parseTracks(empty)).toEqual([]);
  });

  it("handles track with empty Media array gracefully", () => {
    const badTrack: RawTrackResponse = {
      MediaContainer: {
        size: 1,
        Metadata: [
          {
            ratingKey: "9999",
            key: "/library/metadata/9999",
            title: "Bad Track",
            grandparentTitle: "Unknown",
            grandparentKey: "/library/metadata/9000/children",
            parentTitle: "Unknown Album",
            parentKey: "/library/metadata/9998/children",
            duration: 100000,
            Media: [],
          },
        ],
      },
    };
    const result = parseTracks(badTrack);
    expect(result[0]!.streamKey).toBe("");
    expect(result[0]!.trackType).toBeNull();
    expect(result[0]!.samplerate).toBeNull();
    expect(result[0]!.bitdepth).toBeNull();
  });
});
