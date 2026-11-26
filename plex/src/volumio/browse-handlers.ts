/**
 * Browse navigation handlers — pure functions that build NavigationPage
 * responses for Volumio's browser, delegating content fetching to PlexService.
 */

import type {
  NavigationPage,
  NavigationInfo,
  NavigationList,
  NavigationListItem,
} from "./types.js";
import type { PlexService } from "../plex/plex-service.js";
import type { Track } from "../types/index.js";
import { encodePathSegment, shuffleArray } from "./uri-utils.js";
import type { PaginationState } from "./uri-utils.js";

const SERVICE_NAME = "plex";

export interface BrowseOptions {
  pageSize: number;
  shuffleEnabled: boolean;
}

export const ARTIST_SORT_OPTIONS = [
  { label: "By Name (A → Z)",       sort: "titleSort:asc" },
  { label: "By Name (Z → A)",       sort: "titleSort:desc" },
  { label: "Recently Added",        sort: "addedAt:desc" },
  { label: "Added (Oldest First)",  sort: "addedAt:asc" },
  { label: "Most Played",           sort: "viewCount:desc" },
  { label: "Least Played",          sort: "viewCount:asc" },
] as const;

export const ALBUM_SORT_OPTIONS = [
  { label: "By Artist (A → Z)",        sort: "artist.titleSort:asc" },
  { label: "By Artist (Z → A)",        sort: "artist.titleSort:desc" },
  { label: "By Title (A → Z)",         sort: "titleSort:asc" },
  { label: "By Title (Z → A)",         sort: "titleSort:desc" },
  { label: "By Release Date (Newest)", sort: "originallyAvailableAt:desc" },
  { label: "By Release Date (Oldest)", sort: "originallyAvailableAt:asc" },
  { label: "Recently Added (Newest)",  sort: "addedAt:desc" },
  { label: "Recently Added (Oldest)",  sort: "addedAt:asc" },
] as const;

export function browseRoot(): NavigationPage {
  const items: NavigationListItem[] = [
    {
      service: SERVICE_NAME,
      type: "folder",
      title: "Artists",
      uri: "plex/artists",
      icon: "fa fa-microphone",
    },
    {
      service: SERVICE_NAME,
      type: "folder",
      title: "Albums",
      uri: "plex/albums",
      icon: "fa fa-music",
    },
    {
      service: SERVICE_NAME,
      type: "folder",
      title: "Playlists",
      uri: "plex/playlists",
      icon: "fa fa-list",
    },
  ];

  return {
    navigation: {
      prev: { uri: "/" },
      lists: [
        {
          title: "Plex Music",
          icon: "fa fa-server",
          availableListViews: ["list", "grid"],
          items,
        },
      ],
    },
  };
}

export async function browseArtists(
  service: PlexService,
  pagination: PaginationState,
  options: BrowseOptions,
): Promise<NavigationPage> {
  const libraries = await service.getLibraries();
  let libraryKey = pagination.libraryKey;
  if (libraryKey === null) {
    libraryKey = libraries[0]?.id ?? null;
    if (!libraryKey) {
      return { navigation: { prev: { uri: "plex" }, lists: [{ title: "Artists", icon: "fa fa-microphone", availableListViews: ["list", "grid"], items: [] }] } };
    }
  }

  const sort = pagination.sort ?? undefined;
  const sortPart = sort ? `~${sort}` : "";
  const baseUri = `plex/artists${sortPart}`;

  const result = await service.getArtistsPaginated(libraryKey, pagination.offset, options.pageSize, sort);

  const sortList: NavigationList = {
    title: "Sort by",
    availableListViews: ["list"],
    items: ARTIST_SORT_OPTIONS.map((option) => ({
      service: SERVICE_NAME,
      type: "folder" as const,
      title: option.label,
      uri: `plex/artists~${option.sort}`,
      icon: "fa fa-sort",
    })),
  };

  const items: NavigationListItem[] = [];

  if (pagination.offset > 0) {
    const prevOffset = Math.max(0, pagination.offset - options.pageSize);
    const prevUri = prevOffset === 0
      ? baseUri
      : `${baseUri}@${libraryKey}:${prevOffset}`;
    items.push({
      service: SERVICE_NAME,
      type: "item",
      title: "Previous page",
      uri: prevUri,
      icon: "fa fa-arrow-circle-up",
    });
  }

  items.push(...result.items.map((artist) => ({
    service: SERVICE_NAME,
    type: "folder" as const,
    title: artist.title,
    ...(artist.artworkUrl ? { albumart: service.getArtworkUrl(artist.artworkUrl) } : {}),
    uri: `plex/artist/${encodePathSegment(artist.albumsKey)}`,
  })));

  const nextOffset = pagination.offset + result.items.length;
  if (nextOffset < result.totalSize) {
    items.push({
      service: SERVICE_NAME,
      type: "item",
      title: "Load more...",
      uri: `${baseUri}@${libraryKey}:${nextOffset}`,
      icon: "fa fa-arrow-circle-down",
    });
  } else {
    const currentLibIndex = libraries.findIndex((l) => l.id === libraryKey);
    const nextLib = libraries[currentLibIndex + 1];
    if (nextLib) {
      items.push({
        service: SERVICE_NAME,
        type: "item",
        title: "Load more...",
        uri: `${baseUri}@${nextLib.id}:0`,
        icon: "fa fa-arrow-circle-down",
      });
    }
  }

  return {
    navigation: {
      prev: { uri: "plex" },
      lists: [
        sortList,
        {
          title: "Artists",
          icon: "fa fa-microphone",
          availableListViews: ["list", "grid"],
          items,
        },
      ],
    },
  };
}

export async function browseArtist(service: PlexService, albumsKey: string): Promise<NavigationPage> {
  const albums = await service.getArtistAlbums(albumsKey);

  // Extract artist ratingKey from albumsKey (e.g. "/library/metadata/123/children" → "123")
  const artistId = albumsKey.split("/").slice(-2, -1)[0];

  const items: NavigationListItem[] = albums.map((album) => ({
    service: SERVICE_NAME,
    type: "folder" as const,
    title: album.title,
    artist: album.artist,
    ...(album.artworkUrl ? { albumart: service.getArtworkUrl(album.artworkUrl) } : {}),
    uri: `plex/album/${encodePathSegment(album.trackListKey)}`,
  }));

  // Add "Popular Tracks" folder after the albums
  if (artistId) {
    items.push({
      service: SERVICE_NAME,
      type: "folder",
      title: "Popular Tracks",
      uri: `plex/popular/${artistId}`,
      icon: "fa fa-fire",
    });
  }

  return {
    navigation: {
      prev: { uri: "plex/artists" },
      lists: [
        {
          title: albums[0]?.artist ?? "Artist",
          availableListViews: ["list", "grid"],
          items,
        },
      ],
    },
  };
}

export async function browsePopularTracks(service: PlexService, artistId: string): Promise<NavigationPage> {
  const tracks = await service.getPopularTracks(artistId);

  const items: NavigationListItem[] = tracks.map((track) =>
    trackToNavItem(service, track),
  );

  return {
    navigation: {
      prev: { uri: `plex/artist/${encodePathSegment(`/library/metadata/${artistId}/children`)}` },
      lists: [
        {
          title: "Popular Tracks",
          icon: "fa fa-fire",
          availableListViews: ["list"],
          items,
        },
      ],
    },
  };
}

export async function browseAlbums(
  service: PlexService,
  pagination: PaginationState,
  options: BrowseOptions,
): Promise<NavigationPage> {
  const libraries = await service.getLibraries();
  let libraryKey = pagination.libraryKey;
  if (libraryKey === null) {
    libraryKey = libraries[0]?.id ?? null;
    if (!libraryKey) {
      return { navigation: { prev: { uri: "plex" }, lists: [{ title: "Albums", availableListViews: ["list", "grid"], items: [] }] } };
    }
  }

  const sort = pagination.sort ?? undefined;
  const sortPart = sort ? `~${sort}` : "";
  const baseUri = `plex/albums${sortPart}`;

  const result = await service.getAlbumsPaginated(libraryKey, pagination.offset, options.pageSize, sort);

  const sortList: NavigationList = {
    title: "Sort by",
    availableListViews: ["list"],
    items: ALBUM_SORT_OPTIONS.map((option) => ({
      service: SERVICE_NAME,
      type: "folder" as const,
      title: option.label,
      uri: `plex/albums~${option.sort}`,
      icon: "fa fa-sort",
    })),
  };

  const items: NavigationListItem[] = [];

  if (pagination.offset > 0) {
    const prevOffset = Math.max(0, pagination.offset - options.pageSize);
    const prevUri = prevOffset === 0
      ? baseUri
      : `${baseUri}@${libraryKey}:${prevOffset}`;
    items.push({
      service: SERVICE_NAME,
      type: "item",
      title: "Previous page",
      uri: prevUri,
      icon: "fa fa-arrow-circle-up",
    });
  }

  items.push(...result.items.map((album) => ({
    service: SERVICE_NAME,
    type: "folder" as const,
    title: album.title,
    artist: album.artist,
    ...(album.artworkUrl ? { albumart: service.getArtworkUrl(album.artworkUrl) } : {}),
    uri: `plex/album/${encodePathSegment(album.trackListKey)}`,
  })));

  const nextOffset = pagination.offset + result.items.length;
  if (nextOffset < result.totalSize) {
    items.push({
      service: SERVICE_NAME,
      type: "item",
      title: "Load more...",
      uri: `${baseUri}@${libraryKey}:${nextOffset}`,
      icon: "fa fa-arrow-circle-down",
    });
  } else {
    const currentLibIndex = libraries.findIndex((l) => l.id === libraryKey);
    const nextLib = libraries[currentLibIndex + 1];
    if (nextLib) {
      items.push({
        service: SERVICE_NAME,
        type: "item",
        title: "Load more...",
        uri: `${baseUri}@${nextLib.id}:0`,
        icon: "fa fa-arrow-circle-down",
      });
    }
  }

  return {
    navigation: {
      prev: { uri: "plex" },
      lists: [
        sortList,
        {
          title: "Albums",
          availableListViews: ["list", "grid"],
          items,
        },
      ],
    },
  };
}

export async function browseAlbum(
  service: PlexService,
  trackListKey: string,
  options: BrowseOptions,
): Promise<NavigationPage> {
  const tracks = await service.getAlbumTracks(trackListKey);

  const lists: NavigationList[] = [];

  if (options.shuffleEnabled) {
    lists.push({
      availableListViews: ["list"],
      items: [{
        service: SERVICE_NAME,
        type: "folder",
        title: "Shuffle",
        uri: `plex/shuffle-album/${encodePathSegment(trackListKey)}`,
        icon: "fa fa-random",
      }],
    });
  }

  lists.push({
    title: tracks[0]?.album ?? "Album",
    availableListViews: ["list"],
    items: tracks.map((track) => trackToNavItem(service, track)),
  });

  const firstTrack = tracks[0];
  const info: NavigationInfo | undefined = firstTrack
    ? {
        service: SERVICE_NAME,
        type: "song",
        uri: `plex/album/${encodePathSegment(trackListKey)}`,
        albumart: firstTrack.artworkUrl ? service.getArtworkUrl(firstTrack.artworkUrl) : "",
        album: firstTrack.album,
        artist: firstTrack.artist,
      }
    : undefined;

  return {
    navigation: {
      prev: { uri: "plex/albums" },
      ...(info && { info }),
      lists,
    },
  };
}

export async function browsePlaylists(service: PlexService): Promise<NavigationPage> {
  const playlists = await service.getPlaylists();

  const items: NavigationListItem[] = playlists.map((pl) => ({
    service: SERVICE_NAME,
    type: "folder",
    title: pl.title,
    uri: `plex/playlist/${encodePathSegment(pl.itemsKey)}`,
    icon: "fa fa-list",
  }));

  return {
    navigation: {
      prev: { uri: "plex" },
      lists: [
        {
          title: "Playlists",
          icon: "fa fa-list",
          availableListViews: ["list"],
          items,
        },
      ],
    },
  };
}

export async function browsePlaylist(
  service: PlexService,
  itemsKey: string,
  offset: number,
  options: BrowseOptions,
): Promise<NavigationPage> {
  const result = await service.getPlaylistTracksPaginated(itemsKey, offset, options.pageSize);

  const lists: NavigationList[] = [];

  // Navigation items (previous page, shuffle) in their own list
  const navItems: NavigationListItem[] = [];

  if (offset > 0) {
    const prevOffset = Math.max(0, offset - options.pageSize);
    const prevUri = prevOffset === 0
      ? `plex/playlist/${encodePathSegment(itemsKey)}`
      : `plex/playlist/${encodePathSegment(itemsKey)}@${prevOffset}`;
    navItems.push({
      service: SERVICE_NAME,
      type: "item",
      title: "Previous page",
      uri: prevUri,
      icon: "fa fa-arrow-circle-up",
    });
  }

  if (options.shuffleEnabled && offset === 0) {
    navItems.push({
      service: SERVICE_NAME,
      type: "folder",
      title: "Shuffle",
      uri: `plex/shuffle-playlist/${encodePathSegment(itemsKey)}`,
      icon: "fa fa-random",
    });
  }

  if (navItems.length > 0) {
    lists.push({
      availableListViews: ["list"],
      items: navItems,
    });
  }

  // Tracks in their own list
  lists.push({
    title: "Playlist",
    availableListViews: ["list"],
    items: result.items.map((track) => trackToNavItem(service, track)),
  });

  const nextOffset = offset + result.items.length;
  if (nextOffset < result.totalSize) {
    lists.push({
      availableListViews: ["list"],
      items: [{
        service: SERVICE_NAME,
        type: "item",
        title: "Load more...",
        uri: `plex/playlist/${encodePathSegment(itemsKey)}@${nextOffset}`,
        icon: "fa fa-arrow-circle-down",
      }],
    });
  }

  const firstTrack = result.items[0];
  const info: NavigationInfo | undefined = firstTrack
    ? {
        service: SERVICE_NAME,
        type: "song",
        uri: `plex/playlist/${encodePathSegment(itemsKey)}`,
        albumart: firstTrack.artworkUrl ? service.getArtworkUrl(firstTrack.artworkUrl) : "",
        artist: firstTrack.artist,
      }
    : undefined;

  return {
    navigation: {
      prev: { uri: "plex/playlists" },
      ...(info && { info }),
      lists,
    },
  };
}

export async function browseShuffleAlbum(service: PlexService, trackListKey: string): Promise<NavigationPage> {
  const tracks = await service.getAlbumTracks(trackListKey);
  shuffleArray(tracks);

  const items: NavigationListItem[] = tracks.map((track) =>
    trackToNavItem(service, track),
  );

  const firstTrack = tracks[0];
  const info: NavigationInfo | undefined = firstTrack
    ? {
        service: SERVICE_NAME,
        type: "song",
        uri: `plex/shuffle-album/${encodePathSegment(trackListKey)}`,
        albumart: firstTrack.artworkUrl ? service.getArtworkUrl(firstTrack.artworkUrl) : "",
        album: firstTrack.album,
        artist: firstTrack.artist,
      }
    : undefined;

  return {
    navigation: {
      prev: { uri: `plex/album/${encodePathSegment(trackListKey)}` },
      ...(info && { info }),
      lists: [
        {
          title: "Shuffle",
          icon: "fa fa-random",
          availableListViews: ["list"],
          items,
        },
      ],
    },
  };
}

export async function browseShufflePlaylist(service: PlexService, itemsKey: string): Promise<NavigationPage> {
  const tracks = await service.getPlaylistTracks(itemsKey);
  shuffleArray(tracks);

  const items: NavigationListItem[] = tracks.map((track) =>
    trackToNavItem(service, track),
  );

  const firstTrack = tracks[0];
  const info: NavigationInfo | undefined = firstTrack
    ? {
        service: SERVICE_NAME,
        type: "song",
        uri: `plex/shuffle-playlist/${encodePathSegment(itemsKey)}`,
        albumart: firstTrack.artworkUrl ? service.getArtworkUrl(firstTrack.artworkUrl) : "",
        artist: firstTrack.artist,
      }
    : undefined;

  return {
    navigation: {
      prev: { uri: `plex/playlist/${encodePathSegment(itemsKey)}` },
      ...(info && { info }),
      lists: [
        {
          title: "Shuffle",
          icon: "fa fa-random",
          availableListViews: ["list"],
          items,
        },
      ],
    },
  };
}

export function trackToNavItem(service: PlexService, track: Track): NavigationListItem {
  return {
    service: SERVICE_NAME,
    type: "song",
    title: track.title,
    artist: track.artist,
    album: track.album,
    ...(track.artworkUrl ? { albumart: service.getArtworkUrl(track.artworkUrl) } : {}),
    uri: `plex/track/${track.id}`,
    duration: Math.round(track.duration / 1000),
  };
}
