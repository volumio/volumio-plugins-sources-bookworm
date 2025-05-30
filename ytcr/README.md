<a href='https://ko-fi.com/C0C5RGOOP' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

# YouTube Cast Receiver for Volumio

Plugin that enables Volumio to act a YouTube Cast receiver device. Supports casting from YouTube and YouTube Music.

# Changelog

2.0.5
- Update YT dependencies
- Fix 403 stream errors

2.0.4
- Update YT dependencies
- Set a TTL for persisted receiver session data

2.0.3
- Update YT dependencies

2.0.2
- Update YT dependencies

2.0.1
- Fix broken playback due to YT changes (credit: [#837](https://github.com/LuanRT/YouTube.js/pull/837))
- Fix prefetch causing stuck queue on YT app

2.0.0
- Release for Bookworm-based Volumio
- Fix fetching of stream URL through po_tokens and passing appropriate client type (otherwise streams will give 403 error)

1.1.2
- Fix broken playback due to YT changes (credit: [#713] (https://github.com/LuanRT/YouTube.js/pull/713))

1.1.1
- Fix broken playback due to YT changes (credit: [#698](https://github.com/LuanRT/YouTube.js/pull/698))

1.1.0
- Provide metadata to Now Playing plugin through [YouTube2](https://github.com/patrickkfkan/volumio-youtube2) and [YouTube Music](https://github.com/patrickkfkan/volumio-ytmusic) plugins -- so make sure you install those plugins as well!

1.0.7
- Fix broken playback due to YT changes (credit: [#682](https://github.com/LuanRT/YouTube.js/pull/682))
- Add missing bitrate info

1.0.6
- Fix broken API requests due to YT changes

1.0.5
- Fix player not reconnecting with MPD after being disconnected, such as when MPD restarts following a change in configuration.

1.0.4
- Add prefetching of next track
- Add 'prefer Opus streams' option when prefetching enabled
- Use Volumio player name as device name (the name that appears in the Cast menu of clients)

1.0.3
- Add option to stop playback only when all clients have been *explicitly* disconnected

1.0.2
- Remove commented-out code
- Remove links from package author because they don't look good when shown in Volumio plugin store

1.0.1
- Add i18n settings
- Add option to clear persisted data
- Bug fixes

1.0.0
- Add YouTube Music support
- Allow multiple connections
- Support manual pairing, aka Link with TV Code (YouTube only)
- Support playback of private videos and music

0.1.3
- Fix MPD connection
- Update dependency versions; replace deprecated `request` with `node-fetch`

0.1.2
- Improve fetching of audio URLs

0.1.1
- Check audio URLs and refetch on error response (retry up to 5 times)
- Minor change to loading of translations
- Update plugin for Volumio 3

0.1.0-b
- Version change to mark update of yt-cast-receiver module to version 0.1.1-b

0.1.0a-20210627
- Adapt to YouTube changes
- Really fix compatibility with Volumio 2.x
- Add 'Bind to Network Interface' setting

0.1.0a-20210620-2
- Fix compatibility with Volumio 2.x

0.1.0a-20210620
- Update yt-cast-receiver module

0.1.0a-20210419
- More robust transition from another service

0.1.0a-20210417
- Add livestream support

0.1.0a
- Initial release
