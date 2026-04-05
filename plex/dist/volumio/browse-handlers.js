"use strict";
/**
 * Browse navigation handlers — pure functions that build NavigationPage
 * responses for Volumio's browser, delegating content fetching to PlexService.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.browseRoot = browseRoot;
exports.browseArtists = browseArtists;
exports.browseArtist = browseArtist;
exports.browsePopularTracks = browsePopularTracks;
exports.browseAlbums = browseAlbums;
exports.browseAlbum = browseAlbum;
exports.browsePlaylists = browsePlaylists;
exports.browsePlaylist = browsePlaylist;
exports.browseShuffleAlbum = browseShuffleAlbum;
exports.browseShufflePlaylist = browseShufflePlaylist;
exports.trackToNavItem = trackToNavItem;
const uri_utils_js_1 = require("./uri-utils.js");
const SERVICE_NAME = "plex";
function browseRoot() {
    const items = [
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
async function browseArtists(service, pagination, options) {
    const libraries = await service.getLibraries();
    let libraryKey = pagination.libraryKey;
    if (libraryKey === null) {
        libraryKey = libraries[0]?.id ?? null;
        if (!libraryKey) {
            return { navigation: { prev: { uri: "plex" }, lists: [{ title: "Artists", icon: "fa fa-microphone", availableListViews: ["list", "grid"], items: [] }] } };
        }
    }
    const result = await service.getArtistsPaginated(libraryKey, pagination.offset, options.pageSize);
    const items = [];
    if (pagination.offset > 0) {
        const prevOffset = Math.max(0, pagination.offset - options.pageSize);
        const prevUri = prevOffset === 0
            ? "plex/artists"
            : `plex/artists@${libraryKey}:${prevOffset}`;
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
        type: "folder",
        title: artist.title,
        ...(artist.artworkUrl ? { albumart: service.getArtworkUrl(artist.artworkUrl) } : {}),
        uri: `plex/artist/${(0, uri_utils_js_1.encodePathSegment)(artist.albumsKey)}`,
    })));
    const nextOffset = pagination.offset + result.items.length;
    if (nextOffset < result.totalSize) {
        items.push({
            service: SERVICE_NAME,
            type: "item",
            title: "Load more...",
            uri: `plex/artists@${libraryKey}:${nextOffset}`,
            icon: "fa fa-arrow-circle-down",
        });
    }
    else {
        const currentLibIndex = libraries.findIndex((l) => l.id === libraryKey);
        const nextLib = libraries[currentLibIndex + 1];
        if (nextLib) {
            items.push({
                service: SERVICE_NAME,
                type: "item",
                title: "Load more...",
                uri: `plex/artists@${nextLib.id}:0`,
                icon: "fa fa-arrow-circle-down",
            });
        }
    }
    return {
        navigation: {
            prev: { uri: "plex" },
            lists: [
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
async function browseArtist(service, albumsKey) {
    const albums = await service.getArtistAlbums(albumsKey);
    // Extract artist ratingKey from albumsKey (e.g. "/library/metadata/123/children" → "123")
    const artistId = albumsKey.split("/").slice(-2, -1)[0];
    const items = albums.map((album) => ({
        service: SERVICE_NAME,
        type: "folder",
        title: album.title,
        artist: album.artist,
        ...(album.artworkUrl ? { albumart: service.getArtworkUrl(album.artworkUrl) } : {}),
        uri: `plex/album/${(0, uri_utils_js_1.encodePathSegment)(album.trackListKey)}`,
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
async function browsePopularTracks(service, artistId) {
    const tracks = await service.getPopularTracks(artistId);
    const items = tracks.map((track) => trackToNavItem(service, track));
    return {
        navigation: {
            prev: { uri: `plex/artist/${(0, uri_utils_js_1.encodePathSegment)(`/library/metadata/${artistId}/children`)}` },
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
async function browseAlbums(service, pagination, options) {
    const libraries = await service.getLibraries();
    let libraryKey = pagination.libraryKey;
    if (libraryKey === null) {
        libraryKey = libraries[0]?.id ?? null;
        if (!libraryKey) {
            return { navigation: { prev: { uri: "plex" }, lists: [{ title: "Albums", availableListViews: ["list", "grid"], items: [] }] } };
        }
    }
    const result = await service.getAlbumsPaginated(libraryKey, pagination.offset, options.pageSize);
    const items = [];
    if (pagination.offset > 0) {
        const prevOffset = Math.max(0, pagination.offset - options.pageSize);
        const prevUri = prevOffset === 0
            ? "plex/albums"
            : `plex/albums@${libraryKey}:${prevOffset}`;
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
        type: "folder",
        title: album.title,
        artist: album.artist,
        ...(album.artworkUrl ? { albumart: service.getArtworkUrl(album.artworkUrl) } : {}),
        uri: `plex/album/${(0, uri_utils_js_1.encodePathSegment)(album.trackListKey)}`,
    })));
    const nextOffset = pagination.offset + result.items.length;
    if (nextOffset < result.totalSize) {
        items.push({
            service: SERVICE_NAME,
            type: "item",
            title: "Load more...",
            uri: `plex/albums@${libraryKey}:${nextOffset}`,
            icon: "fa fa-arrow-circle-down",
        });
    }
    else {
        const currentLibIndex = libraries.findIndex((l) => l.id === libraryKey);
        const nextLib = libraries[currentLibIndex + 1];
        if (nextLib) {
            items.push({
                service: SERVICE_NAME,
                type: "item",
                title: "Load more...",
                uri: `plex/albums@${nextLib.id}:0`,
                icon: "fa fa-arrow-circle-down",
            });
        }
    }
    return {
        navigation: {
            prev: { uri: "plex" },
            lists: [
                {
                    title: "Albums",
                    availableListViews: ["list", "grid"],
                    items,
                },
            ],
        },
    };
}
async function browseAlbum(service, trackListKey, options) {
    const tracks = await service.getAlbumTracks(trackListKey);
    const lists = [];
    if (options.shuffleEnabled) {
        lists.push({
            availableListViews: ["list"],
            items: [{
                    service: SERVICE_NAME,
                    type: "folder",
                    title: "Shuffle",
                    uri: `plex/shuffle-album/${(0, uri_utils_js_1.encodePathSegment)(trackListKey)}`,
                    icon: "fa fa-random",
                }],
        });
    }
    lists.push({
        title: tracks[0]?.album ?? "Album",
        availableListViews: ["list"],
        items: tracks.map((track) => trackToNavItem(service, track)),
    });
    return {
        navigation: {
            prev: { uri: "plex/albums" },
            lists,
        },
    };
}
async function browsePlaylists(service) {
    const playlists = await service.getPlaylists();
    const items = playlists.map((pl) => ({
        service: SERVICE_NAME,
        type: "folder",
        title: pl.title,
        uri: `plex/playlist/${(0, uri_utils_js_1.encodePathSegment)(pl.itemsKey)}`,
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
async function browsePlaylist(service, itemsKey, offset, options) {
    const result = await service.getPlaylistTracksPaginated(itemsKey, offset, options.pageSize);
    const lists = [];
    // Navigation items (previous page, shuffle) in their own list
    const navItems = [];
    if (offset > 0) {
        const prevOffset = Math.max(0, offset - options.pageSize);
        const prevUri = prevOffset === 0
            ? `plex/playlist/${(0, uri_utils_js_1.encodePathSegment)(itemsKey)}`
            : `plex/playlist/${(0, uri_utils_js_1.encodePathSegment)(itemsKey)}@${prevOffset}`;
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
            uri: `plex/shuffle-playlist/${(0, uri_utils_js_1.encodePathSegment)(itemsKey)}`,
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
                    uri: `plex/playlist/${(0, uri_utils_js_1.encodePathSegment)(itemsKey)}@${nextOffset}`,
                    icon: "fa fa-arrow-circle-down",
                }],
        });
    }
    return {
        navigation: {
            prev: { uri: "plex/playlists" },
            lists,
        },
    };
}
async function browseShuffleAlbum(service, trackListKey) {
    const tracks = await service.getAlbumTracks(trackListKey);
    (0, uri_utils_js_1.shuffleArray)(tracks);
    const items = tracks.map((track) => trackToNavItem(service, track));
    return {
        navigation: {
            prev: { uri: `plex/album/${(0, uri_utils_js_1.encodePathSegment)(trackListKey)}` },
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
async function browseShufflePlaylist(service, itemsKey) {
    const tracks = await service.getPlaylistTracks(itemsKey);
    (0, uri_utils_js_1.shuffleArray)(tracks);
    const items = tracks.map((track) => trackToNavItem(service, track));
    return {
        navigation: {
            prev: { uri: `plex/playlist/${(0, uri_utils_js_1.encodePathSegment)(itemsKey)}` },
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
function trackToNavItem(service, track) {
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
