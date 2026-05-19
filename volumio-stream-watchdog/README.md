# volumio-stream-watchdog

A Volumio 4 plugin that detects genuine streaming failure — not just network loss — and automatically switches to a curated local playlist. When your stream comes back, the plugin resumes it automatically.

## How it works

Most "offline fallback" approaches probe a generic host like `8.8.8.8` via TCP. That misses a large class of real failures: your router is up, DNS works fine, but the radio station server is down or your ISP is dropping streaming traffic selectively. The correct signal is Volumio's own player state.

This plugin uses two detection layers that must both agree before any action is taken:

**Layer 1 — State Watcher (reactive):** Subscribes to Volumio's internal `pushState` socket.io events. When the player was streaming (`stream: true`) and transitions to `stop` without a user-initiated command, it marks a candidate failure.

**Layer 2 — Stream Probe (proactive):** On a configurable interval, makes an HTTP HEAD request directly to the stream URL. Only when both layers confirm failure does the plugin act.

This combination eliminates false positives from brief network hiccups, user-initiated stops, and library scans.

### State machine

```
IDLE ──► WATCHING ──► SUSPECT ──► FALLBACK
           ▲                          │
           └──────────────────────────┘
                  (stream restored)
```

- **IDLE** — No stream playing. Plugin is dormant.
- **WATCHING** — Stream is active. Probes run on `streamCheckInterval`.
- **SUSPECT** — Unexpected stop detected or first probe failure. Waits one more cycle.
- **FALLBACK** — Failure confirmed. Local playlist plays. Restoration probes run on `restoreCheckInterval`.

### What happens on failure

1. Current stream URI and queue are snapshotted
2. A warning toast appears: *"Stream lost — switching to local music."*
3. Volumio stops and clears the queue
4. A Volumio playlist named `"Offline"` (configurable) starts playing
5. If no such playlist exists, the plugin scans `music-library/INTERNAL` as a fallback

### What happens on restore

1. Restoration probe succeeds twice in a row
2. A success toast appears: *"Stream restored — resuming."*
3. The original stream resumes automatically (if auto-restore is enabled)

## Requirements

- Volumio 4.x
- A Volumio playlist named `"Offline"` containing local tracks (create it in Browse → Playlists before any failure occurs)
- Local music files on the SD card under `music-library/INTERNAL`

## Creating your Offline playlist

In the Volumio UI, browse to your local music, add tracks to the queue, then save the queue as a playlist named **Offline** (or whatever name you configure in settings). That playlist will play automatically whenever your stream fails.

## Installation

### From the Volumio Plugin Store (once published)

Navigate to **Plugins → Miscellanea** and search for "Stream Watchdog".

### Manual install (development)

```bash
# SSH into your Volumio device
ssh volumio@volumio.local

# Clone the repo into the plugins directory
cd /data/plugins/system_controller
git clone https://github.com/josemathias/volumio-stream-watchdog volumio-stream-watchdog

# Install dependencies
cd volumio-stream-watchdog
npm install

# Restart Volumio
sudo systemctl restart volumio
```

Then navigate to **Plugins → Installed Plugins** and enable **Stream Watchdog**.

## Configuration

Open the plugin settings page in Volumio (**Plugins → Installed → Stream Watchdog → Settings**):

| Setting | Default | Description |
|---|---|---|
| Offline Playlist Name | `Offline` | Name of the Volumio playlist to play when stream fails |
| Stream Check Interval (seconds) | `30` | How often to probe the stream URL while watching (minimum: 15) |
| Restore Check Interval (seconds) | `60` | How often to probe while in fallback mode (minimum: 30) |
| Auto-Restore | `on` | Automatically resume the original stream when it returns |

## Logs

Plugin activity is written to the Volumio system log. To watch it live:

```bash
sudo journalctl -fu volumio | grep StreamWatchdog
```

## Architecture notes

- No external npm dependencies — `http`/`https` probing uses Node.js built-ins
- `socket.io-client` is referenced from Volumio's own `node_modules` to avoid version conflicts
- The plugin does not write to `/volumio` or `/myvolumio`
- All timers and socket connections are cleanly torn down on `onStop`

## Development

Full implementation plan, state machine design, marketplace submission checklist, and phased implementation guide are in [`docs/development-plan.md`](docs/development-plan.md).

### Tests

The test suite uses Node's built-in runner (`node:test`) — no test dependencies to install.

```bash
npm install        # installs kew + v-conf
npm run test:l0    # unit tests (state machine, config)
npm run test:l1    # integration tests (HTTP stream probe)
npm test           # both
```

CI runs on GitHub Actions via the QA Lab platform — see `docs/development-plan.md` §8.5.

## License

MIT © josemathias
