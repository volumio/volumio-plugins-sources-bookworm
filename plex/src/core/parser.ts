/**
 * Library Parser — pure functions that transform raw Plex API JSON
 * responses into our normalized domain types (Library, Album, Track).
 *
 * No network calls or side effects; all functions are safe to unit-test
 * with fixture data alone.
 */

import type {
  Library,
  Artist,
  Album,
  Track,
  Playlist,
  RawLibraryResponse,
  RawArtistResponse,
  RawAlbumResponse,
  RawTrackResponse,
  RawPlaylistResponse,
} from "../types/index.js";

// Plex uses "audio" as the playlistType for music playlists.
const AUDIO_PLAYLIST_TYPE = "audio";

// Plex uses "artist" as the section type for music libraries.
// Other types include "movie", "show", "photo", etc.
const MUSIC_LIBRARY_TYPE = "artist";

/**
 * Parse the /library/sections response into Library objects.
 * Only music libraries (type "artist") are returned — all other
 * section types (movies, TV, photos) are filtered out.
 */
export function parseLibraries(raw: RawLibraryResponse): Library[] {
  const directories = raw.MediaContainer.Directory ?? [];
  return directories
    .filter((dir) => dir.type === MUSIC_LIBRARY_TYPE)
    .map((dir) => ({
      id: dir.key,
      title: dir.title,
      type: dir.type,
    }));
}

/**
 * Parse the /playlists response into Playlist objects.
 * Only audio playlists are returned — video playlists are filtered out.
 */
export function parsePlaylists(raw: RawPlaylistResponse): Playlist[] {
  const metadata = raw.MediaContainer.Metadata ?? [];
  return metadata
    .filter((item) => item.playlistType === AUDIO_PLAYLIST_TYPE)
    .map((item) => ({
      id: item.ratingKey,
      title: item.title,
      trackCount: item.leafCount,
      itemsKey: item.key, // e.g. "/playlists/12345/items"
    }));
}

/**
 * Parse the /library/sections/{key}/all?type=8 response into Artist objects.
 */
export function parseArtists(raw: RawArtistResponse): Artist[] {
  const metadata = raw.MediaContainer.Metadata ?? [];
  return metadata.map((item) => ({
    id: item.ratingKey,
    title: item.title,
    artworkUrl: item.thumb ?? null,
    albumsKey: item.key, // e.g. "/library/metadata/123/children"
  }));
}

/**
 * Parse an album listing response into Album objects.
 *
 * Plex's hierarchy is: Library → Artist → Album → Track.
 * In the album response, `parentTitle` is the artist name and `key`
 * points to the track listing endpoint for that album.
 * Optional fields (year, thumb) fall back to null when absent.
 */
export function parseAlbums(raw: RawAlbumResponse): Album[] {
  const metadata = raw.MediaContainer.Metadata ?? [];
  return metadata.map((item) => ({
    id: item.ratingKey,
    title: item.title,
    artist: item.parentTitle, // Plex: album's parent = artist
    year: item.year ?? null,
    artworkUrl: item.thumb ?? null,
    trackListKey: item.key, // e.g. "/library/metadata/1001/children"
  }));
}

/**
 * Parse a track listing response into Track objects.
 *
 * Plex's hierarchy for tracks: grandparent = artist, parent = album.
 * The stream key is extracted from the first Media/Part entry
 * (Media[0].Part[0].key), which is the primary file for the track.
 * Falls back to "" if the Media array is empty or malformed.
 */
export function parseTracks(raw: RawTrackResponse): Track[] {
  const metadata = raw.MediaContainer.Metadata ?? [];
  return metadata.map((item) => {
    const media = item.Media?.[0];
    const part = media?.Part?.[0];
    // bitDepth and samplingRate live on the Stream element inside Part, not on Media.
    // For audio-only files there is exactly one Stream; streamType 2 = audio.
    const audioStream = part?.Stream?.find((s) => s.streamType === 2) ?? part?.Stream?.[0];
    return {
      id: item.ratingKey,
      title: item.title,
      artist: item.grandparentTitle, // Plex: track's grandparent = artist
      album: item.parentTitle, // Plex: track's parent = album
      duration: item.duration,
      artworkUrl: item.thumb ?? null,
      streamKey: part?.key ?? "", // First media file's path
      trackType: media?.audioCodec ?? media?.container ?? null,
      samplerate: audioStream?.samplingRate != null ? `${audioStream.samplingRate / 1000} kHz` : null,
      bitdepth: audioStream?.bitDepth != null ? `${audioStream.bitDepth} bit` : null,
    };
  });
}
