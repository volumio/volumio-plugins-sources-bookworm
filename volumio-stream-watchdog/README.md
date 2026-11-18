# volumio-stream-watchdog

A Volumio 4 plugin that keeps your web radio playing. If the stream stops, it reissues it; if that does not help, it switches to a curated local playlist, always shuffled; and when the stream comes back, it resumes it automatically.

## How it works

Most "offline fallback" approaches probe a generic host like `8.8.8.8`. That misses the failures that matter: the router is up, DNS works, but the station's server restarted, or it answers while sending no audio, or Volumio's queue died after an error and nothing is playing at all. The only reliable signal is what the player is actually doing — and, since Volumio can say "playing" while nothing reaches the sound card, what the sound card is doing too.

So the plugin runs one small loop. Every 5 seconds it looks at the player and asks a single question — *should the radio be playing, and is it?* — and takes one step:

```
nothing to watch ── a stream starts playing ──► WATCHING
WATCHING ── stopped, or nothing heard ──► wait one tick ──► reissue the stream (twice) ──► FALLBACK
FALLBACK ── offline playlist plays, shuffled
         ── every Restore Check Interval: does the stream answer? ──► play it
         ── stream playing again ──► WATCHING
         ── nothing playing ──► play the offline playlist again
```

Nothing ever waits for an event to confirm that a step worked: the next tick checks. If a restore lands on a station that answers but dies a second later — which is exactly what happens in the minute after many stations restart — the plugin is back on the offline playlist ten seconds later and tries again at the next interval. There is no state in which it can sit doing nothing while the room is silent.

**The sound card is checked too.** Volumio can report "playing" while its player (MPD) is stopped underneath — a burst of skip commands from a remote did that to a store for three and a half hours. While a radio is playing, the plugin also reads the kernel's view of the output card (`/proc/asound`, the card set in Volumio's Playback Options): if the card is not playing, or its position has not moved, that counts as a stopped stream. If the card cannot be read, or the output is a loopback (the Bluetooth bridge), the plugin goes by Volumio's state alone.

**So is MPD's log.** When a station's connection stalls without closing, MPD keeps the card running and feeds it silence — a store heard 24 minutes of it while every other signal said "playing". MPD notes it in `/var/log/mpd.log` ("Decoder is too slow; playing silence") every five seconds. Short silences are network hiccups that MPD rides out by itself, so they are left alone; once the silence has lasted 20 seconds it counts as a stopped stream, and the reissue opens a new connection.

**What you press in the Volumio UI is respected.** Pressing Stop or Pause in the Volumio web UI (or the app) tells the plugin to stop looking after the stream; so do Next and Back while the radio plays. Switching to local music, Spotify or any non-stream source does the same.

**Everything else is undone.** The same commands sent through Volumio's REST API or command line — a Bluetooth or IR remote, a script — are treated like any other failure: the radio comes back within about ten seconds. So does a pause nobody pressed (MPD pauses itself when its output fails), and Volumio stuck on "paused" while the music actually plays is recognised from the sound card. On a web radio, a pause is a stop.

**The offline playlist is always shuffled — the first track too.** Outages are usually short; played in order, the same few tracks would open every outage.

### What happens on failure

1. The stream is reissued up to twice, ten seconds apart — often that is all it takes; the offline playlist starts about 25 seconds after the stream stopped
2. If it still is not playing, a warning toast appears: *"Stream lost — switching to local music."*
3. The playlist named `"Offline"` (configurable) is shuffled and played; without one, the local library under `music-library/INTERNAL` is used

### What happens on restore

1. While the playlist plays, the plugin checks the stream every Restore Check Interval
2. When the stream answers, it is played; once it is actually playing, a success toast appears: *"Stream is back — resumed."*
3. If it dies right away, the offline playlist comes back and the plugin tries again later. Each try that dies doubles the wait before the next one (30 s → 1 → 2 → 4 → 8 → 10 min at most), so a station that answers but sends no audio for hours does not cut the music every half minute. A check where the stream does not answer at all costs nothing audible and does not count. The wait goes back to the interval as soon as the radio holds

### What the plugin does not do

It does not start playback after a reboot — use the AutoStart plugin for that. Once the radio is playing, the watchdog takes over.

## Requirements

- Volumio 4.x
- A Volumio playlist named `"Offline"` containing local tracks (create it in Browse → Playlists before any failure occurs)
- Local music files on the SD card under `music-library/INTERNAL`

## Creating your Offline playlist

In the Volumio UI, browse to your local music, add tracks to the queue, then save the queue as a playlist named **Offline** (or whatever name you configure in settings). That playlist will play automatically whenever your stream fails.

## Installation

### From the Volumio Plugin Store

Stream Watchdog currently lives in Volumio's **beta** channel, so it is not
visible in the store by default. Enable **Plugins test mode** first:

1. Open `http://<your-volumio-address>/dev` in a browser.
2. Switch **Plugins test mode** on.
3. Back in the Volumio UI, go to **Plugins → Search Plugins** and search for
   "Stream Watchdog".

A MyVolumio account is required to browse the plugin store; the free tier is
enough. Once the Volumio team promotes the plugin to the stable channel, test
mode will no longer be needed.

### Manual install (development)

On a Volumio 4 (bookworm) device, install the plugin through Volumio's own
plugin manager rather than dropping files into `/data/plugins` by hand — that
is what registers the plugin, runs `npm install` and makes uninstall work.

```bash
# SSH into your Volumio device
ssh volumio@volumio.local

# Get the plugin sources
git clone https://github.com/volumio/volumio-plugins-sources-bookworm.git --depth=1
cd volumio-plugins-sources-bookworm/volumio-stream-watchdog

# Let Volumio install it
volumio plugin install
```

`volumio plugin install` warns that the plugin is not store-verified and asks
for confirmation, then installs dependencies and offers to enable the plugin.
Remove it again from **Plugins → Installed Plugins → Uninstall**, which runs
`uninstall.sh` and clears the plugin's configuration.

## Configuration

Open the plugin settings page in Volumio (**Plugins → Installed → Stream Watchdog → Settings**):

| Setting | Default | Description |
|---|---|---|
| Offline Playlist Name | `Offline` | Volumio playlist to play, shuffled, when the stream fails |
| Restore Check Interval (seconds) | `60` | While the offline playlist plays, how often to check whether the stream is back (minimum: 30). Doubles after each try that dies, up to 10 min |
| Auto-Restore | `on` | Automatically resume the original stream when it returns |

## Logs

Plugin activity is written to the Volumio system log. To watch it live:

```bash
sudo journalctl -fu volumio | grep StreamWatchdog
```

## Architecture notes

- `lib/decide.js` holds the whole policy as one pure function; `index.js` is the Volumio shell around it
- No external npm dependencies — `http`/`https` probing uses Node.js built-ins
- The plugin never calls Volumio's stop itself; it switches sources with `replaceAndPlay`, which is how it can tell your Stop from its own actions
- The plugin does not write to `/volumio` or `/myvolumio`
- One timer (the tick); torn down on `onStop`
- `lib/soundcard.js` only reads `/proc/asound`; it never opens the sound device
- `lib/mpdlog.js` only reads `/var/log/mpd.log`, from where it last stopped

## Development

The original (1.x) implementation plan and the marketplace submission checklist are in [`docs/development-plan.md`](docs/development-plan.md); the 2.0 design is described in `CLAUDE.md`.

### Tests

The test suite uses Node's built-in runner (`node:test`) — no test dependencies to install.

```bash
npm install        # installs kew + v-conf
npm run test:l0    # unit tests (the policy table, the shell, the offline playlist)
npm run test:l1    # integration tests (the whole loop, the HTTP probe)
npm test           # both
```

CI runs on GitHub Actions via the QA Lab platform — see `docs/development-plan.md` §8.5.

## License

MIT © josemathias
