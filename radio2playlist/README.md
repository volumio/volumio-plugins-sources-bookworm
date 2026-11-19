# Radio2Playlist — v1.4.2

Save the currently playing web radio station into a native Volumio playlist,
including its editable name, stream URL and available artwork.

## Requirements and status

- Volumio 4 / Debian Bookworm; Node.js >=20.
- Store architectures: armhf, amd64; category: user_interface.
- Source/test candidate; not a Volumio-approved Store release.
- Author: Dieter Senf (Steyer-Tec). Repository: https://github.com/Steyer-Tec/volumio-plugins-sources-bookworm

## Features and usage

Play a web radio station, open the plugin settings and click Refresh. Edit the
station name, choose an existing playlist or enter a new playlist name, then save.
Favorites use a configurable target playlist; save that setting before pressing
the heart. Optional Auto mode saves newly played stations to its configured
playlist. Duplicate protection uses the exact stream URI. German and English
translations are included. Two browser tabs help: change stations in one, then
refresh and save in the plugin settings in the other.

## Playlist storage and safeguards

Native local Volumio playlists are JSON arrays under /data/playlist. Exact
filenames are preserved. Actual M3U files, malformed JSON, symlinks, empty files
and non-array documents are not offered or overwritten. Names must not contain
path separators, control characters, leading dots or surrounding whitespace;
the limit is 200 UTF-8 bytes.

The plugin uses one synchronous write path. Existing playlists are replaced
atomically through a temporary file in the same directory; new files are
published exclusively. Failed writes are reported. No concurrent createPlaylist
socket request is issued. This does not lock out other applications editing the
same playlist: avoid simultaneous edits from different applications.

This release handles local playlists. MyVolumio cloud syncing is not implemented
or verified. Station name and artwork quality depend on Volumio's state; edit
ambiguous names manually. A favicon is not guaranteed to be a station logo.

## Development installation and submission

Install/uninstall scripts contain only lifecycle markers, with no npm command,
shared directory changes, user-playlist deletion or service restart. Standard
Volumio plugin tooling must prepare the dependencies. This source ZIP contains
no node_modules and is not a verified Store download artifact.

Put this folder as radio2playlist in your Bookworm repository fork, and use volumio plugin install on Bookworm.
Test installation, activation, restart, all features, uninstall and reinstall
before submitting through volumio plugin submit.

When replacing an old development installation in miscellanea, first record
favorites/Auto settings and uninstall the old plugin through Volumio. The corrected
plugin and configuration paths use user_interface. Settings are not automatically
migrated across categories; user playlists remain in place.

## Changelog

### 1.4.2
- Apply review category user_interface in metadata and every UI endpoint.
- Use the Bookworm OS array; retain Node >=20 and Volumio >=4 engines.
- Remove npm, chmod 777 and recursive ownership changes from installation.
- Reject unsafe paths, symlinks and invalid existing playlist data.
- Use exclusive/atomic publication without competing socket creation.
- Propagate failures; retry Auto saves after errors and handle changed targets.
- Fix empty selection fallback, deleted playlists, editable names and UI refresh.
- Preserve exact filenames; replace unnecessary fs-extra with Node's built-in fs.
- Keep Socket.IO 2.x compatibility instead of forcing a major upgrade.

### 1.4.1
Earlier Bookworm/Store adjustments; review found incomplete compliance.

### 1.4.0
Initial Store submission candidate.

## Official references

- https://github.com/volumio/volumio-plugins-sources-bookworm
- https://developers.volumio.com/plugins/plugins-overview
- https://developers.volumio.com/plugins/submission-checklist

## License

MIT; copyright Dieter Senf (Steyer-Tec). See LICENSE.
