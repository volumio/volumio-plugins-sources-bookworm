<a href='https://ko-fi.com/C0C5RGOOP' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

# SoundCloud plugin for Volumio

Volumio plugin for browsing and playing SoundCloud content.

### Playback

The plugin uses `vlc` and `mpv` for playback. This functionality is provided by the [volumio-ext-players](https://github.com/patrickkfkan/volumio-ext-players) module.

Support for different stream formats

| Codec     | Protocol  | Bitrate   | Supported     | Remarks       |
|-----------|-----------|-----------|---------------|---------------|
| AAC       | HLS       | 160 kbps  | Yes           |               |
| Opus      | HLS       | 64 kbps   | Yes           |               |
| MP3       | HTTP      | 128 kbps  | Yes           |               |
| MP3       | HLS       | 128 kbp   | Partial       | Plays, but seeking will terminate playback.   |

High-quality streams (AAC 256kbps) available with Go+ accounts are not supported, but you can enable "Log Transcodings" in plugin settings and send me Volumio logs so I could see if they can be supported.

DRM-ed streams are not supported at all.

### Changelog

2.1.0
- Use `vlc` and `mpv` for playback + remove `longStreamFormat` config option. Primary streams are now HLS+AAC which play fine (with seeking) even for lengthy ones.
- Add `cookie` config option, now required for "Add to play history" functionality.
- Add charts and feed to browseable content.

2.0.0
- Release for Bookworm-based Volumio

1.0.3
- Fix longer tracks cutting off early at 30-40 minutes into playback

1.0.2
- Fix plugin crash due to error in obtaining SoundCloud client ID

1.0.1
- Add library item filter
- Minor UI changes and bug fixes

1.0.0
- Migrate to TypeScript
- Add support for access to private resources through access token

0.1.5
- [Fixed] Manifest UI detection broken by Volumio commit [db5d61a](https://github.com/volumio/volumio3-backend/commit/db5d61a50dacb60d5132238c7f506f0000f07e07)

0.1.4
- [Fixed] Adding current song to playlist / favorites in Playback view
- [Changed] Because of fix above, track info now shows bitrate instead of bit depth and sample rate
- [Added] Go To Album / Artist*
- [Changed] Use plain text titles if Manifest UI is enabled

*&nbsp;Go To Album has the following behavior:
- Shows the album or playlist (non-system type) from which current track was originally selected; or
- Shows the track's artist, if the track was not selected from an album or playlist

0.1.3
- [Fixed] Translations

0.1.2
- [Changed] Minor change to loading of translations

0.1.1
- [Changed] Update plugin for Volumio 3

0.1.0a-20210103
- [Change] Update soundcloud-fetch module (fixes track ordering)
- [Fix] Strip newline characters from MPD tags that could cause error

0.1.0a
- Initial release
