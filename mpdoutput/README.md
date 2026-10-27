# MPD HTTP & Icecast output

A Volumio 4 plugin that streams what the player is playing: as an HTTP stream served from the player, to an Icecast server, or both.

Store name: `mpdoutput` (category `audio_interface`). Existing installations upgrade in place and keep their settings.

## What it does

- **HTTP stream** — MPD serves the encoded audio on a port of your choice. Any player on the network opens `http://<player>:<port>/`. Encoders: MP3, Ogg Vorbis, Ogg Opus, FLAC.
- **Icecast** — the encoded audio is published on a mount of an Icecast 2 server. Encoders: Ogg Vorbis, Ogg Opus, MP3. The title Volumio shows on screen (`Artist - Title`) is sent to the server on every track change, for all encoders; Icecast 2.4 applies it to Vorbis and MP3 mounts and ignores it for Opus (listeners still receive the audio).

Both streams follow playback, pause and stop. While stopped, listeners stay connected and hear silence.

**What is in the stream.** Everything MPD renders: the music library, web radio, UPnP, and the streaming services Volumio plays through MPD. Services that bring their own player (Spotify Connect, AirPlay, Bluetooth, Tidal Connect, multiroom) do not pass through MPD and are not in the stream. The stream level is MPD's output before Volumio's volume stage, so it does not follow the player volume.

## How the Icecast stream stays up

MPD does not talk to the Icecast server. MPD hands the encoded stream to a small relay on the player (`relay/relay.js`, a systemd service `mpd-output-relay.service`), and the relay publishes it. The relay owns every network timeout:

- if the server reboots, is restarted or refuses the connection, the relay reconnects with increasing intervals (1 s up to 30 s);
- if the server or the network freezes without closing the connection, the relay notices within seconds that nothing is being accepted, drops the connection and reconnects;
- if the credentials are rejected, it waits a minute between attempts;
- if MPD restarts (Volumio does that when the output device changes), the relay re-attaches to the feed as soon as playback resumes.

Playback on the player is never affected by any of this: MPD's side of the feed is non-blocking by design and discards what the relay cannot take. The **Show relay status** button in the settings reports whether the relay is connected to MPD and to the server and the last error, if any.

## Settings

**HTTP stream**: on/off, stream name, encoder, bitrate, sample format, port. Advanced: maximum number of listeners, genre and website announced to players.

**Icecast**: on/off, server, port, mount point, source user and password, encoder, bitrate, sample format, stream name, public listing. Advanced: description, genre, website, and the local feed port (127.0.0.1:8010 by default; change only if another service uses it).

Saving restarts MPD, as every MPD configuration change in Volumio does; check playback afterwards.

After updating the plugin from the store, restart Volumio (or reboot) so the new version is the one running; Volumio loads plugin code once per start.

## Backup and restore

The settings page has three sections for named settings backups: **Save settings backup**, **Restore settings backup**, **Delete settings backup**. A backup is a JSON file with every setting of the plugin, written to `/data/INTERNAL/mpdoutput/backups/<name>.json` — outside the plugin and its configuration folder, so it survives disabling, uninstalling and reinstalling the plugin. That folder is part of Volumio's *Internal Storage* network share, so a backup can be copied off the player with any file browser.

Restoring applies the backup through the same checks as a save and restarts MPD once. A backup that would not pass the settings page (for example two streams on the same port) is refused with the reason, and the current settings stay.

To move the configuration to another player, or back onto a freshly installed one: install the plugin, copy the backup file into `/data/INTERNAL/mpdoutput/backups/` on the new player (the share is `\\<player>\Internal Storage\mpdoutput\backups`), open the plugin settings and restore it. The file contains the Icecast source password; it is written readable by the owner only, and it should be kept private wherever it is copied.

## Where things live on the player

| What | Where |
| --- | --- |
| Plugin | `/data/plugins/audio_interface/mpdoutput/` |
| Settings | `/data/configuration/audio_interface/mpdoutput/config.json` |
| Relay settings (written by the plugin, contains the source password, mode 0600) | `/data/configuration/audio_interface/mpdoutput/relay.json` |
| Relay service | `mpd-output-relay.service`, log: `journalctl -u mpd-output-relay` |
| Relay status | `/run/mpd-output/status.json` (connection state, last error, current title and its source) |
| Settings backups | `/data/INTERNAL/mpdoutput/backups/*.json` (kept on uninstall) |
| MPD outputs | added to Volumio's generated `/etc/mpd.conf` under the comment `# mpdoutput plugin: streaming outputs`; written by Volumio, not by the plugin |

The MPD outputs are contributed through Volumio's own MPD configuration writer, so they survive output-device and playback-option changes and disappear when the plugin is disabled or uninstalled.

## Requirements

Volumio 4 (bookworm, Node 20) with MPD built with the `httpd` output plugin (every Volumio 4 image qualifies). Icecast 2.4 or later for the Icecast stream; the SHOUTcast and Icecast 1 source protocols are not supported.

Titles are sent to the server as UTF-8. For MP3 mounts Icecast re-encodes them to the mount's charset, which defaults to ISO-8859-1; to keep characters outside that set (for example Polish diacritics), set `<charset>UTF-8</charset>` on the mount in the server's configuration. Ogg mounts carry UTF-8 natively.

## Development

```
npm test               # static checks: syntax, JSON, UI keys and translations (no dependencies needed)
npm run test:backup    # settings backup/restore against a stubbed Volumio (needs npm install)
```

The relay can be run standalone for diagnosis:

```
node relay/relay.js /data/configuration/audio_interface/mpdoutput/relay.json --status /tmp/status.json --control /tmp/control.sock
```

## Credits

Original plugin by Balbuze. Rework (relay, configuration integration, validation, translations) by Just a Nerd.

## License

ISC
