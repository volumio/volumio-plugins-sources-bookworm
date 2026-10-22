# Pirate Audio Screensaver 0.1.6

Volumio 4 / Bookworm beta plugin for a Raspberry Pi with Pimoroni Pirate Audio. Install and enable the **Pirate Audio** hardware plugin first. Plugin category: `user_interface`.

## Features

- Shows a moving clock after a configurable period without playback.
- Returns control of the display when playback resumes.
- Shares the screen through the Pirate Audio process, preserving its music display and physical buttons without a second GPIO owner.
- Configurable idle delay and display rotation.
- Individually enables or disables the 15 bundled clock fonts; random selection uses only enabled fonts.
- Shows a real `12:34` sample of every font in native Volumio dialogs.
- Keeps settings across restarts and normal plugin upgrades.

## Font settings

Open the plugin settings and use the **Clock fonts** section. All fonts are enabled on the first upgrade from 0.1.5. Keep at least one enabled and click that section's **Save** button. Saving restarts the screensaver service to apply the selection.

**Preview all fonts** opens the gallery with three columns on desktop and a single column on narrow screens. Each font's help icon also opens its own preview when Volumio's documentation icons are enabled. The gallery always remains available. The preview images are generated from the bundled fonts and embedded in the dialog; no external connection or preview server is needed. English and French are supported.

`previews/index.html` is an offline gallery for viewing the same PNG files on a computer. It is not the settings page.

The standard UIConfig does not provide inline images beside switches. The plugin therefore uses the native help and custom dialog templates, which support sanitized HTML images. Reference: [Volumio UI dist3](https://github.com/volumio/Volumio2-UI/tree/dist3).

## Runtime and settings

The runtime stays inside the installed plugin:

```text
/data/plugins/user_interface/pirate_audio_screensaver/venv
/data/plugins/user_interface/pirate_audio_screensaver/volumio-screensaver.env
```

Persistent UI settings are stored at:

```text
/data/configuration/user_interface/pirate_audio_screensaver/settings.json
```

`enabled_fonts` is an array of stable IDs in `settings.json`, and a comma-separated string in `v-conf`. The same IDs are written to `ENABLED_FONTS` in the service environment. Node and Python share `python/volumio_screensaver/fonts/catalog.json`, avoiding separate lists of font filenames.

An absent `ENABLED_FONTS` preserves the old behavior of enabling all bundled fonts. For direct runtime configuration, an explicitly empty or invalid selection uses a system/Pillow fallback rather than re-enabling disabled fonts. The UI rejects disabling every font. If a persisted selection becomes empty or obsolete, the wrapper recovers with DS Digital alone.

Installation creates the plugin-local virtual environment and systemd service. It also installs a validated sudo rule allowing Volumio to run only the display bridge's exact `enable` and `disable` commands without a password. This permits automatic startup after a reboot. Plugin commands use noninteractive sudo so a missing permission is reported immediately. Uninstalling removes this plugin's rule and runtime; Volumio may also remove persisted settings on uninstall.

The rule is stored in `/etc/sudoers.d/volumio-user-pirate-audio-screensaver`, after Volumio's general `volumio-user` policy in lexical order. Installation migrates the earlier `pirate-audio-screensaver` rule only if it belongs to this plugin.

## Sharing the display

Recent `st7789` drivers exclusively reserve GPIO lines. Two independent display objects cannot coexist, even if the screensaver only sends frames while music is stopped. The hardware integration uses the Pirate Audio process as the sole display owner. A local Unix socket receives clock frames, while the original music display and button handlers continue to run. Music, native button activity, a disconnected screensaver or an expired heartbeat return the screen to Pirate Audio. The wrapper keeps the bridge alive across fast Socket.IO reconnections, even when the native script's initial wait returns while its network threads remain connected.

Enabling installs only this managed systemd override:

```text
/etc/systemd/system/pirateaudio.service.d/50-volumio-screensaver.conf
```

It runs the original `pirateaudio/display.py` through a wrapper using the original hardware plugin's interpreter and user. It does not edit the hardware plugin's source or settings. Its existing service remains responsible for the GPIO and SPI device. Enabling can briefly restart its display process to load the wrapper. Disabling or uninstalling removes the override and restores the original command. Other service overrides are preserved.

The integration targets the source and service of Pirate Audio 0.1.5 on Bookworm; device validation is required. The standalone Python runtime still supports direct ST7789 access when `DISPLAY_BRIDGE_SOCKET` is absent; use that mode only when no other process owns the screen.

## Development and validation

From this plugin directory:

```bash
npm install --ignore-scripts
npm test
PYTHONPATH=python python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/generate_font_previews.py
python3 tools/build_release.py
```

Pillow is needed only to regenerate previews. The plugin serves the committed PNGs directly. The archive excludes development dependencies, tests, build artifacts and caches.

Local validation: 15 Node tests and 45 passing Python tests, including real stream communication and fast Socket.IO reconnection. One additional Unix-socket test is skipped on this Windows Python runtime, which has no `AF_UNIX`; the device check must verify the Linux socket and actual display. The tests cover real `kew` and `v-conf` dependencies, font filtering and display sharing. See [VALIDATION_FR.md](VALIDATION_FR.md).

## Installation and publication

Extract the release ZIP to a working folder on the Volumio device, enter that folder and run:

```bash
volumio plugin install
```

The local installer can reject a plugin that is already installed. Back up its actual configuration and runtime environment before uninstalling 0.1.5 through Volumio. Uninstalling also removes the plugin configuration directory. After installing 0.1.6, restore the backed-up configuration before enabling the plugin and run the device checks.

For Bookworm publication, keep the folder `pirate_audio_screensaver` at the root of the `volumio-plugins-sources-bookworm` repository. Its metadata remains in category `user_interface`. Commit and push the validated sources to your fork, then submit from that Git source checkout on the Bookworm device, using the same MyVolumio account as before. The installed directory and an extracted ZIP are not Git source checkouts. Keep development artifacts, virtual environments, caches and old ZIPs out of the submission directory; the helper can include files even when Git ignores them.

```bash
cd ~/volumio-plugins-sources-bookworm/pirate_audio_screensaver
volumio plugin submit
```

This local development version has not been submitted to the store.
