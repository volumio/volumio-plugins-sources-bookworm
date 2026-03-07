# Radio2Playlist (Volumio Plugin) — v1.4.0

Radio2Playlist lets you save the currently playing **Webradio station** into a **real Volumio playlist** (including station title and albumart/logo when available).

## Features
- Save current webradio station to an existing playlist
- Create a new playlist and save the current station
- ❤️ Favorites button (configurable target playlist)
- ⚡ Optional Auto Mode (toggle): automatically saves newly played stations to a selected playlist
- Duplicate protection with user feedback
- UX hints:
  - If no playlists exist, the plugin shows a clear warning (create a playlist first)
  - Two-tabs workflow tip for fast station collection

## How to use
1. Start playing a Webradio station
2. Open the plugin settings
3. Click **Refresh**
4. Choose an existing playlist (or create a new one)
5. Click **Save**

### Tip: Use two browser tabs
- Tab 1: change the radio station
- Tab 2: keep this plugin page open
After switching stations, click **Refresh** and save. This makes it easy to collect many stations quickly.

## Notes
- If you have no playlists yet: create one in Volumio first (Browse → Playlists → New playlist).

## Changelog
### 1.4.0
- Stable release for Store submission
- No-empty-UI fix (UI sections resolved by ID)
- Permission fix for clean uninstall
- UX hints (no playlist warning + two-tabs workflow)
