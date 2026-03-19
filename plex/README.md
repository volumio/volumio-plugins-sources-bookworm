# Volumio Plex Plugin

A Volumio music service plugin that lets you browse and play music from your Plex Media Server.

## Features

- Stream music directly from Plex via MPD (native Volumio music playback)
- Browse Plex music libraries and albums
- Browse Plex playlists
- Search for tracks and albums

## Prerequisites

- A running Volumio 3 device (Node 14+, ARM or x86)
- A Plex Media Server on your network with at least one music library
- A Plex authentication token ([how to find your token](https://support.plex.tv/articles/204059436/))

## Development/Building

The plugin must be built on your development machine before deploying to Volumio. TypeScript is not installed on the device.

```bash
# Install dependencies
npm install

# Compile TypeScript to CommonJS in dist/
npm run build

# Run tests (optional)
npm test
```

## Installing on Volumio

### Option 1: volumio plugin install (recommended)

1. Copy the required files to a temporary directory on the Volumio device:

```bash
scp -r index.js config.json UIConfig.json i18n/ install.sh uninstall.sh \
  package.json plex.png dist/ \
  volumio@<VOLUMIO_IP>:/tmp/plex-plugin/
```

2. SSH into the Volumio device and set up the plugin directory:

```bash
ssh volumio@<VOLUMIO_IP>
mkdir -p /data/plugins/music_service/plex
cp -r /tmp/plex-plugin/* /data/plugins/music_service/plex/
```

3. Install through Volumio's plugin system:

```bash
cd /data/plugins/music_service/plex
volumio plugin install
```

4. Enable the plugin when prompted, or enable it from the Volumio UI under **Settings > Plugins > Installed Plugins**.

### Option 2: Manual install

1. Copy the required files directly to the plugin directory:

```bash
scp -r index.js config.json UIConfig.json i18n/ install.sh uninstall.sh \
  package.json plex.png dist/ \
  volumio@<VOLUMIO_IP>:/data/plugins/music_service/plex/
```

2. SSH into the device and run the install script:

```bash
ssh volumio@<VOLUMIO_IP>
cd /data/plugins/music_service/plex
./install.sh
```

3. Restart Volumio:

```bash
volumio vrestart
```

## Configuration

Go to **Settings > Plugins > Installed Plugins** in the Volumio UI and click **Settings** on the Plex plugin. The settings page has four sections.

### Plex Login

The easiest way to connect. Authenticates via plex.tv without needing to find your token manually.

1. Click **Login with Plex** — a unique auth URL is generated and shown in the field below the button
2. Open that URL in a browser and sign in to your Plex account
3. Return to Volumio and click **Check Login Status** — the plugin fetches your token and lists your available servers
4. Select your server from the dropdown and click **Apply Server**

### Connection (manual)

Enter your server details directly if you already have a token or prefer not to use the login flow.

| Field | Description | Default |
|-------|-------------|---------|
| **Host** | Hostname or IP address of your Plex server | — |
| **Port** | Plex server port | `32400` |
| **Token** | Your Plex authentication token | — |
| **HTTPS** | Connect using HTTPS instead of HTTP | off |

### Browse Options

| Field | Description | Default |
|-------|-------------|---------|
| **Shuffle** | Randomise track order when adding an album or playlist to the queue | off |
| **Page size** | Number of items fetched per page when browsing large libraries (10–1000) | `100` |

### Playback Options

| Field | Description | Default |
|-------|-------------|---------|
| **Gapless playback** | Play tracks back-to-back without silence between them | on |
| **Crossfade** | Fade between tracks instead of cutting | off |
| **Crossfade duration** | Length of the crossfade in seconds (1–12). Visible only when Crossfade is on | `5` |

After saving any section, "Plex" will appear (or remain) in the browse menu.

## Uninstalling

From the Volumio UI: **Settings > Plugins > Installed Plugins**, click the uninstall button on the Plex plugin.

Or manually:

```bash
rm -rf /data/plugins/music_service/plex
rm -rf /data/configuration/plugins/music_service/plex
sudo systemctl restart volumio
```

## Developer Notes

- Added shuffle function that mimics the behavior of Plex's shuffle (Fisher-Yates algorithm) but is added as an entry inside playlists and albums. It can turned off inside the plugin settings.
- Added crossfade option but it is not strongly supported by Volumio and might not behave as expected. The plugin will attempt to overlap tracks by the specified duration, but due to technical limitations, the maximum effective crossfade is probably around 2 seconds. Perhaps future versions of Volumio will have better support for crossfading.