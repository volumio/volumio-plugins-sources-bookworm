# Spotify Soloist Connect

> **Stable, version 0.9.0.**
> This package tracks the cutting-edge line. An accepted build is published to the Volumio plugin store as a separate process.

Turns a Volumio 4 device into a Spotify Connect endpoint using Spotify Soloist.

Audio plays through `pcm.volumio`, so Volumio's volume control, DSP and the rest of the AAMPP chain all apply.
There is no PulseAudio daemon and no PipeWire on the device.

Track metadata, cover art and transport controls sync into the Volumio UI.
Works on Raspberry Pi and on x86.

**This is an unofficial, community-built plugin. It is not affiliated with, endorsed by or sponsored by Spotify AB.**

---

## Before you install

You need a Spotify account with **Premium** to generate a Soloist API key.
Once the plugin is running, both Free and Premium accounts can connect to it from the Spotify app.

You also need the device to reach Spotify's CDN, because the Soloist binary is downloaded on install rather than bundled.

---

## Setup

1. Install the plugin from the package supplied to you. An accepted build is published to the Volumio plugin store as a separate process and may lag this repository.
2. Log in to the [Spotify for Developers dashboard](https://developer.spotify.com/dashboard) and generate a key on the [Spotify Soloist API Key](https://developer.spotify.com/dashboard/soloist) page.
3. Open the plugin settings, paste the key, set a device name, and save.
4. Open the Spotify app on the same network and pick the device.

The plugin starts without a key so that the settings page can be opened.
The Soloist daemon starts once a key has been saved.

Treat the API key as a secret.
It belongs to the account that generated it and must not be shared.

---

## Settings

The page is split by what a save does. **Save & Restart Soloist** is for Spotify identity, sound, cache and diagnostics: those values are read by the daemon, so playback stops and comes back. **Save** is for the Volumio queue switches, the timing fields, and the binary auto-update switch: this process reads them on the next row, the next event, or the next daily check, and Soloist keeps playing. **Convert playlist** rewrites a saved Volumio list and does not restart. **Backup settings** writes a named snapshot on this device; restore runs the same checks as Save.

| Setting | Section | Default | Notes |
|---|---|---|---|
| API key | Spotify | empty | From the Spotify for Developers dashboard. Stored on the device with mode 0600. Saving restarts. |
| Retain my API key | Spotify | on | Keeps the key and paired session across uninstall. |
| Device name | Spotify | `Volumio` | The name shown in the Spotify app. Saving restarts. |
| Play Spotify tracks from the Volumio queue | Volumio queue | off | A `soloist_connect` row in a Volumio playlist or queue plays through Soloist. On also shows the Spotify Queue tile on Browse. Off hides the tile and skips those rows. Does not restart. |
| Let a queued track play on the active Spotify device | Volumio queue | off | Only with the setting above. If the session sits on a phone or another speaker, the row plays there instead of being skipped. The list may wait on it. Does not restart. |
| Playlist | Convert playlist | — | Only lists that still have `spop` + `spotify:track:` rows. A list already saved as `soloist_connect` does not appear. Does not restart. |
| Overwrite in place | Convert playlist | off | Off writes a clone. On rewrites the selected file. Does not restart. |
| New playlist name | Convert playlist | empty | Clone only. Empty becomes `{source} (Soloist)`. Ignored when overwrite is on. |
| Initial volume | Sound | 50 | 0 to 100. Saving restarts. Unused when Align volume on start is on, except as a fallback if Volumio has no mixer. |
| Align volume on start | Sound | off | Copy Volumio's volume to Spotify when this speaker becomes the active Connect device, instead of applying Initial Volume. Saving restarts. |
| Output trim (dB) | Sound | 0 | -12 to +12. A fixed gain on the Spotify stream before it reaches the ALSA chain. Saving restarts. |
| Loudness normalization | Sound | on | Spotify's own track-to-track matching. Off leaves the original track level. Not Output Trim. Saving restarts. The engine has no official switch; the plugin writes the prefs key at spawn. |
| Crossfade | Sound | off | Spotify's own fade between consecutive tracks. Off is a hard cut. Not Output buffer. Saving restarts. The engine has no official switch; the plugin writes the prefs keys at spawn. |
| Crossfade time (ms) | Sound | 2000 | 1000 to 12000. Used only when Crossfade is on. Below 1000 does nothing. Saving restarts. |
| Cache location | Cache | Disk | **Disk** survives a reboot. **RAM** takes writes off a slow SD card, costs that much memory, and is emptied on every reboot and daemon restart. Saving restarts. |
| Cache size (MB) | Cache | 1024 | `0` means no limit. Other values must be 100 or more. In RAM mode the size is capped to what the board can spare. Saving restarts. |
| Seek coalesce (ms) | Timing | 200 | 0 to 2000. How long after the last slider move before one seek is sent. 0 sends every move. Does not restart. |
| Inactive hold (ms) | Timing | 2000 | 0 to 10000. How long after Spotify reports the device inactive before the plugin yields the output. 0 yields immediately. Does not restart. |
| Quality retry wait (ms) | Timing | 300 | 0 to 2000. How long to wait before looking again when the playing cache file is not ready. 0 does not retry. Does not restart. |
| Quality retries | Timing | 2 | 0 to 10. How many times to look again. 0 does not retry. Does not restart. |
| Spotify Queue wait (ms) | Timing | 2500 | 0 to 10000. How long the Spotify Queue tile waits for `get_queue`. 0 shows the last event immediately. Does not restart. |
| Verbose logging | Diagnostics | off | Logs every event Spotify sends the device, and turns on the audio shim's own diagnostics. Saving restarts so the shim picks it up. |
| Backup name | Backup settings | — | Named snapshot of the stored settings under `/data/INTERNAL/soloist_connect/backups`. The API key is included only when Retain my API key is on. This is not a clone of the Spotify login. The restore list updates on this page. |
| Backup | Restore settings | — | Applies through the same checks as Save. A backup without a key keeps the key already on this box. Restore of Spotify identity, sound, cache or diagnostics restarts Soloist. |
| Backup | Delete settings backup | — | Removes the named file. Live settings are not changed. |
| Download a new Soloist binary before it expires | Binary Update | off | Once a day, if seven days or fewer remain or the build is already dead, and Spotify is not playing here, pull from Spotify and start the new binary. No reboot. We do not review that tarball. Does not restart on Save. |
| Update Soloist binary now | Binary Update | — | Manual pull. Progress modal, then a 15 second reboot countdown with Restart and Cancel. A failed download leaves the running binary alone. |

The **update** button still reboots after a successful download. The switch above does not.

---

## Mixed playlists

This plugin is still a Spotify Connect speaker first. From 0.7.0 it can also play a Spotify **track** that is already sitting in a Volumio playlist or queue.

Turn on **Play Spotify tracks from the Volumio queue**. The row must say `service: "soloist_connect"`. Entries saved for the stock Spotify plugin say `spop` and are skipped at play time. **Convert playlist** rewrites those track rows in a saved list under `/data/playlist/`. Clone is the default and leaves the original file alone; overwrite replaces it. Album, playlist and artist URIs are not rewritten. Conversion does not turn the queue switch on. A paired Spotify session is enough; the app does not have to be open. If there is no session, or another device holds it, that row is skipped and the list moves on.

Names and artwork come from tracks Soloist has already reported this session. A URI it has never seen queues with a placeholder until it starts.

Soloist's own queue is not the playhead. Next and previous walk the Volumio list. When the Spotify row ends, Soloist is paused and the DAC is released so the next service (local, UPnP, web radio) can open it. With this setting on, a **Spotify Queue** tile on Browse shows that Connect list (now playing, play next, up next, autoplay, recently played). Tapping a track there is the same `explodeUri` path as a mixed-list row. Off hides the tile, so a tap cannot skip a row and stop Connect.

Do not turn on **Let a queued track play on the active Spotify device** unless you want a row to play on the phone or another speaker when the session is not here. Off is the safe default.

---

## How the audio path works

```
Spotify app  ->  soloist daemon  ->  Pulse shim  ->  pcm.volumio  ->  AAMPP / DSP  ->  DAC
```

Soloist has no ALSA backend of its own; it speaks PipeWire or PulseAudio.
The plugin ships a private Pulse shim (`libpulse.so.0`) that implements the PulseAudio client calls Soloist uses, and points Soloist at it.
No PulseAudio daemon is installed, and nothing else on the system is changed.

Sample rate and quality shown in the Volumio UI are worked out on the device.
Soloist does not report either, so the sample rate comes from the open ALSA stream and the quality tier is measured from the downloaded track: its size against its duration gives the bitrate, which maps onto Spotify's own tiers.
A skip clears the previous tier. If the new file is not open yet, or is still filling, the line has no tier until the size settles or the bitrate is already lossless. The plugin does not read the playing cache file.

### Sharing the output with other sources

The device is held only while Spotify is playing.

Pausing in the Spotify app keeps it, so resuming is instant.
Starting anything else in Volumio, a local album, a web radio, another plugin, takes it: Spotify pauses and the new source plays.

The player stays in the Spotify app's device list throughout.
Switching source in Volumio does not end the Connect session, so pressing play on the phone again brings it straight back without re-selecting the device.

### Volume

When Volumio has a mixer, hardware or software, that mixer does the attenuation and the Spotify app's slider moves it.
The stream itself stays at full scale, which is what VU meters and other per-source metering need: the needles follow the music rather than the volume knob.

By default Soloist starts at **Initial volume** and that value is mirrored to the mixer. That can yank the knob if you were already listening at another level. **Align volume on start** copies Volumio's volume onto Spotify instead, the same way the stock Spotify plugin does when the speaker becomes active. Off by default.

With the mixer set to `None` there is nothing downstream to attenuate, so the volume is applied to the stream instead.

**Output trim** is separate from all of this. It is a fixed offset on the stream itself, applied before the ALSA chain, and it is the right control when this source is simply quieter or louder than everything else on the system. Because the stream normally arrives at full scale, a trim is also what changes how far VU meters swing on Spotify without touching any other source. Around +6 dB is a reasonable starting point if the needles sit at half height.

### VU meters

If you use the PeppyMeter screensaver, turn its Spotify metering on there and the meters will follow Spotify.
There is no switch for it in this plugin: the screensaver owns the setting and this plugin follows it, whichever of the two you set up first.

Metering routes the audio through the screensaver's own point in the chain, which is below FusionDSP and Stylish Player, so those are bypassed while it is on. The screensaver already refuses to enable Spotify metering when DSP is in use.

### Do not run the stock Spotify plugin as well

Volumio's own Spotify Connect plugin and this one are two versions of the same thing, and they compete for the same audio path.
Enable one or the other. The plugin warns you if it finds both running.

---

## Supported devices

| Device | Supported |
|---|---|
| Raspberry Pi 2 and later, 32-bit or 64-bit userspace | yes |
| x86 / x86_64 | yes |
| Raspberry Pi 1, Pi Zero v1 (armv6) | no, Soloist has no armv6 build |

Volumio 4 (Debian Bookworm base) is required.

---

## Things to know

**Disabling the plugin stops the Soloist daemon.**
It is then not a Spotify Connect endpoint. Pause and Volumio Stop do not stop the service; that is so resume stays instant.

**Soloist builds expire after 90 days.**
This is a Spotify design decision, not a plugin limitation.
On start the plugin re-downloads an already-dead build. While the plugin stays up, a once-a-day check logs remaining days. With **Download a new Soloist binary before it expires** on, that check pulls from Spotify when seven days or fewer remain, or the build is already dead, and Spotify is not playing here. That silent pull starts the new binary and does not reboot. Off, the check only logs, and an already-dead build toasts to use the button. The button still shows a 15 second reboot countdown with Restart and Cancel; a failed download does not replace what is already running.
We do not review the tarball Spotify serves.
A device left powered off past the expiry will refresh on its next start, provided it can reach the internet.

**Skip and seek are not instant.**
Volumio's ALSA chain buffers audio ahead of the DAC, and it applies the Output Buffer setting twice, so the delay is roughly double the value you set.
Seek discards only what is still in the Pulse shim; audio already committed to the device plays out.
Lowering the setting shortens it; too low risks dropouts on a busy device.

**Lossless needs a moment at the start of a track.**
At lossless the plugin buffers half a second of audio before the DAC, which is why skip and seek take longer there than at the lossy tiers.

**The Soloist binary is not part of this package.**
It is downloaded from Spotify's official CDN during install, because Spotify does not permit redistributing it.

**A RAM cache is emptied on every restart.**
That is what it is: memory, not storage. Saving Spotify, Sound, Cache or Diagnostics restarts the daemon, so the cache is discarded then too, and the next track is downloaded again. Saving the Volumio queue, Timing, or Binary Update sections does not. RAM is worth choosing when the boot medium is slow, not otherwise.

**A mixed-playlist Spotify row needs this plugin's service name.**
`soloist_connect`, not `spop`. **Convert playlist** rewrites `spop` track rows in a saved Volumio list. A list that is already `soloist_connect` is left alone and does not appear in the selector. With queue playback off, converted rows still appear and are skipped when reached.

**The Spotify Queue tile is this speaker's Connect list.**
It appears on Browse only when **Play Spotify tracks from the Volumio queue** is on and Soloist is connected. Now playing, play next, up next, autoplay and recently played come from `get_queue` and stay in those sections. While the tile is open, a track change or `queue_changed` refreshes the page (a full `get_queue`, because the unsolicited event is capped at 10). That is not Volumio's mixed playlist, and there is no Spotify library browse or search.

**A settings backup is not a clone of the Spotify login.**
It is the stored plugin settings on this device. The API key is written into the file only when **Retain my API key** is on. Restore without a key keeps the key already on this box. The paired session under `/data/soloist/data` is left alone.

---

## Troubleshooting

Check the daemon:

```
journalctl -u soloist -f
```

Check the plugin:

```
journalctl -u volumio -f | grep -i soloist
```

Turn on **Verbose logging** first when investigating playback problems. Without it the audio shim is silent about what it does when ALSA reports a fault, and the log shows the symptom with nothing on either side of it. The startup line is always printed. It names the plugin, the shim, and which mode it is in:

```
SoloistConnect: plugin=0.9.0 shim=0.2.9 rev=... userspace=armhf device=plug:volumio ... diag=1
```

The journal on Volumio is held in memory and is destroyed by a reboot. Capture it before restarting:

```
journalctl -b -u soloist -u volumio --no-pager > /data/soloist-report.txt
```

Confirm the ALSA device exists:

```
aplay -L | grep volumio
```

Common cases:

- **Nothing plays and the log shows exit code 10.** The Soloist build expired. Press the update button in the plugin settings. A successful update shows a 15 second reboot countdown.
- **A Spotify row in a playlist does nothing, or the list jumps past it.** Queue playback is off by default. The row must be `soloist_connect`, not `spop`. Use **Convert playlist** on a saved list that still says `spop`. A paired session is required; if another device holds it the row is skipped unless remote play is on. If a conversion looks wrong, keep a copy of `/data/playlist/<name>` (URIs and titles, not an API key).
- **The device does not appear in the Spotify app.** Check that the API key was saved, that the daemon is running, and that the device and phone are on the same network segment.
- **Another source will not start while Spotify is connected.** Should not happen from 0.4.0 onwards. If it does, `journalctl -u volumio -f | grep -i soloist` around the moment you switch will show whether the device was released.
- **Install failed with "Pulse shim ... is not in the plugin package".** The package was built without the libraries for this architecture. Report it, including the architecture reported by `dpkg --print-architecture`.

When reporting a problem, **never post your API key, unredacted logs, crash reports or the contents of `/data/soloist`.**
Redact before sharing. From 0.7.6, `ps` should show `nice-try-logsubmit` in place of the key about two seconds after Soloist starts. A log taken in that window, or an older plugin, can still contain the real key.

---

## Licence and attribution

This plugin is MIT licensed. See [LICENSE](LICENSE).
The Pulse shim that plays through `pcm.volumio` is this project's own code, shipped as `alsa-lib/<arch>/libpulse.so.0`.

Using Spotify Soloist means accepting the [Spotify Terms and Conditions of Use](https://www.spotify.com/legal/end-user-agreement/).
Soloist is proprietary Spotify software and is downloaded from Spotify, not supplied by this plugin.

Spotify, Spotify Connect and Spotify Soloist are trademarks of Spotify AB.
Volumio is a trademark of Volumio SRL.
Raspberry Pi is a trademark of Raspberry Pi Ltd.
These marks are used descriptively only.

---

## Source and support

Source, build system and full third-party notices:
https://github.com/foonerd/alsa_soloist_connect

Report plugin problems there.
Problems with Soloist itself, or with Spotify accounts and playback, belong with Spotify; the project repository lists where each one goes.

---

## Credits

- [wheaten](https://github.com/wheaten/) started this work.
- [nerd](https://github.com/foonerd/) took it over and carried it to the Volumio 4 ALSA path.
