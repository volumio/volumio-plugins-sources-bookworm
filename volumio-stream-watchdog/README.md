# volumio-stream-watchdog

A Volumio 4 plugin that keeps your web radio playing. If the stream stops, it reissues it; if that does not help, it switches to a curated local playlist, always shuffled; and when the stream comes back, it resumes it automatically.

## How it works

Most "offline fallback" approaches probe a generic host like `8.8.8.8`. That misses the failures that matter: the router is up, DNS works, but the station's server restarted, or it answers while sending no audio, or Volumio's queue died after an error and nothing is playing at all. The only reliable signal is what the player is actually doing.

So the plugin runs one small loop. Every 5 seconds it looks at the player and asks a single question — *should the radio be playing, and is it?* — and takes one step:

```
nothing to watch ── a stream starts playing ──► WATCHING
WATCHING ── stopped ──► wait one tick ──► reissue the stream (twice) ──► FALLBACK
FALLBACK ── offline playlist plays, shuffled
         ── every Restore Check Interval: does the stream answer? ──► play it
         ── stream playing again ──► WATCHING
         ── nothing playing ──► play the offline playlist again
```

Nothing ever waits for an event to confirm that a step worked: the next tick checks. If a restore lands on a station that answers but dies a second later — which is exactly what happens in the minute after many stations restart — the plugin is back on the offline playlist ten seconds later and tries again at the next interval. There is no state in which it can sit doing nothing while the room is silent.

**Your Stop is respected.** Pressing Stop (in the UI, the app, or anything that calls Volumio's stop) tells the plugin to stop looking after the stream. Switching to local music, Spotify or any non-stream source does the same. Pausing is left alone.

**The offline playlist is always shuffled — the first track too.** Outages are usually short; played in order, the same few tracks would open every outage.

### What happens on failure

1. The stream is reissued up to twice, a few seconds apart — often that is all it takes
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
