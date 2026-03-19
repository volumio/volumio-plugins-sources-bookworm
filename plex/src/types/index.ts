// ── Parsed domain types ──────────────────────────────────────────────
// These are the normalized types used throughout the plugin after raw
// Plex API responses have been parsed by the Library Parser (src/core/parser.ts).

/** A Plex music library section. Only "artist" type sections are music. */
export interface Library {
  /** Plex section key, used to query albums within this library */
  id: string;
  /** Display name of the library (e.g. "Music") */
  title: string;
  /** Plex library type — we only keep "artist" (music) libraries */
  type: string;
}

/** A music artist from a Plex library. */
export interface Artist {
  /** Plex ratingKey — unique identifier for the artist */
  id: string;
  title: string;
  /** Relative path to artist art thumbnail, null if missing */
  artworkUrl: string | null;
  /** Plex key to fetch the list of albums for this artist (e.g. "/library/metadata/123/children") */
  albumsKey: string;
}

/** A music album from a Plex library. */
export interface Album {
  /** Plex ratingKey — unique identifier for the album */
  id: string;
  title: string;
  /** Artist name — sourced from Plex's parentTitle field */
  artist: string;
  /** Release year, null when not available in Plex metadata */
  year: number | null;
  /** Relative path to album art thumbnail, null if missing */
  artworkUrl: string | null;
  /** Plex key to fetch the list of tracks for this album (e.g. "/library/metadata/1001/children") */
  trackListKey: string;
}

/** A Plex playlist (audio only). */
export interface Playlist {
  /** Plex ratingKey — unique identifier for the playlist */
  id: string;
  title: string;
  /** Number of tracks in the playlist */
  trackCount: number;
  /** API path to fetch the playlist's items (e.g. "/playlists/12345/items") */
  itemsKey: string;
}

/** A single music track, ready to be queued for playback. */
export interface Track {
  /** Plex ratingKey — unique identifier for the track */
  id: string;
  title: string;
  /** Artist name — sourced from Plex's grandparentTitle field */
  artist: string;
  /** Album name — sourced from Plex's parentTitle field */
  album: string;
  /** Track duration in milliseconds */
  duration: number;
  /** Relative path to track/album art thumbnail, null if missing */
  artworkUrl: string | null;
  /** Plex part key used to build the streaming URL (e.g. "/library/parts/2001/1234567/file.flac") */
  streamKey: string;
  /** Audio codec used as Volumio trackType (e.g. "flac", "mp3", "alac"), null if unavailable */
  trackType: string | null;
  /** Sample rate formatted for display (e.g. "44.1 kHz"), null if unavailable */
  samplerate: string | null;
  /** Bit depth formatted for display (e.g. "24 bit"), null if unavailable */
  bitdepth: string | null;
}

/** A page of results from a paginated query. */
export interface PaginatedResult<T> {
  items: T[];
  totalSize: number;
  offset: number;
}

// ── Raw Plex API response shapes ─────────────────────────────────────
// These mirror the JSON structure returned by the Plex Media Server API.
// All Plex responses wrap their payload in a MediaContainer object.
// Index signatures ([key: string]: unknown) allow extra fields we don't use.

/** Response from GET /playlists — lists all playlists on the server. */
export interface RawPlaylistResponse {
  MediaContainer: {
    size: number;
    Metadata: RawPlaylistMetadata[];
  };
}

/** A single playlist entry from the Plex /playlists response. */
export interface RawPlaylistMetadata {
  /** Unique identifier for this playlist */
  ratingKey: string;
  /** API path to fetch playlist items (e.g. "/playlists/12345/items") */
  key: string;
  title: string;
  /** "audio" for music playlists, "video" for video playlists */
  playlistType: string;
  /** Number of items in the playlist */
  leafCount: number;
  [key: string]: unknown;
}

/** Response from GET /library/sections/{key}/all?type=8 — lists artists. */
export interface RawArtistResponse {
  MediaContainer: {
    size: number;
    /** Total items available across all pages (present when using pagination params). */
    totalSize?: number;
    Metadata: RawArtistMetadata[];
  };
}

/** A single artist entry from the Plex artist listing. */
export interface RawArtistMetadata {
  /** Unique identifier for this artist */
  ratingKey: string;
  /** API path to fetch the artist's children (albums) */
  key: string;
  title: string;
  /** Relative thumbnail path, absent when artist has no artwork */
  thumb?: string;
  [key: string]: unknown;
}

/** Response from GET /library/sections — lists all library sections. */
export interface RawLibraryResponse {
  MediaContainer: {
    size: number;
    /** Each Directory is a library section (Music, Movies, TV, etc.) */
    Directory: RawDirectory[];
  };
}

/** A single library section entry from the Plex /library/sections response. */
export interface RawDirectory {
  /** Section key used in subsequent API calls (e.g. "1") */
  key: string;
  title: string;
  /** Section type — "artist" for music, "movie" for movies, etc. */
  type: string;
  [key: string]: unknown;
}

/** Response from GET /library/sections/{key}/all?type=9 — lists albums. */
export interface RawAlbumResponse {
  MediaContainer: {
    size: number;
    /** Total items available across all pages (present when using pagination params). */
    totalSize?: number;
    Metadata: RawAlbumMetadata[];
  };
}

/** A single album entry from the Plex albums listing. */
export interface RawAlbumMetadata {
  /** Unique identifier for this album */
  ratingKey: string;
  /** API path to fetch the album's children (tracks) */
  key: string;
  title: string;
  /** Artist name — Plex stores the artist as the album's parent */
  parentTitle: string;
  /** Relative thumbnail path, absent when album has no artwork */
  thumb?: string;
  year?: number;
  [key: string]: unknown;
}

/** Response from GET /library/metadata/{key}/children — lists tracks. */
export interface RawTrackResponse {
  MediaContainer: {
    size: number;
    /** Total items available across all pages (present when using pagination params). */
    totalSize?: number;
    Metadata: RawTrackMetadata[];
  };
}

/**
 * A single track entry from the Plex tracks listing.
 *
 * Plex nests the actual file reference inside Media → Part. A track can
 * have multiple Media entries (different qualities/formats), each with
 * multiple Parts (for multi-file tracks). We always use the first
 * Media[0].Part[0] as the stream source.
 */
export interface RawTrackMetadata {
  ratingKey: string;
  /** API path for this track's metadata */
  key: string;
  title: string;
  /** Artist name — Plex stores artist as the track's grandparent (artist → album → track) */
  grandparentTitle: string;
  /** Album name — Plex stores album as the track's parent */
  parentTitle: string;
  /** API path to fetch the album's tracks (e.g. "/library/metadata/123/children") */
  parentKey: string;
  /** API path to fetch the artist's albums (e.g. "/library/metadata/456/children") */
  grandparentKey: string;
  /** Duration in milliseconds */
  duration: number;
  /** Relative thumbnail path, absent when track/album has no artwork */
  thumb?: string;
  /** Array of media versions — we use Media[0].Part[0].key as the stream source */
  Media: Array<{
    Part: Array<{
      /** File path key used to build the streaming URL */
      key: string;
      /** Audio streams nested inside this part (streamType=2 is audio) */
      Stream?: Array<{
        /** 1=video, 2=audio, 3=subtitle */
        streamType?: number;
        /** Bit depth in bits per sample (e.g. 16, 24) */
        bitDepth?: number;
        /** Sample rate in Hz (e.g. 44100, 48000, 96000) */
        samplingRate?: number;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    }>;
    /** Audio codec (e.g. "flac", "mp3", "alac") */
    audioCodec?: string;
    /** File container format (e.g. "flac", "mp4") */
    container?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}
