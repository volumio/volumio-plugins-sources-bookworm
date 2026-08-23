# Pirate Audio Screensaver

Volumio plugin for displaying an idle clock screensaver on Pimoroni Pirate Audio ST7789 displays.

The Python screensaver engine lives in this repository. This directory contains the Volumio plugin wrapper intended to be published under the `user_interface` plugin category.

## Features

- Shows a clock screensaver when Volumio is idle.
- Restores the normal Pirate Audio display when playback resumes.
- Configurable idle delay from the Volumio UI.
- Configurable ST7789 display rotation from the Volumio UI.
- Persistent settings across reboot.
- Managed through a systemd service: `volumio-screensaver.service`.

## Hardware target

This plugin is intended for Raspberry Pi systems running Volumio with a Pimoroni Pirate Audio display or a compatible 240x240 ST7789 SPI screen.

The current package metadata targets `armhf` Volumio systems.

## Volumio settings

The plugin exposes only the user-facing options that are normally useful:

- `Idle delay before screensaver starts`
- `Display rotation`

Other runtime parameters are kept internal and written to `/etc/volumio-screensaver.env` with safe defaults.

Persistent UI settings are stored in:

```text
/data/configuration/user_interface/pirate_audio_screensaver/settings.json
```

Runtime environment is written to:

```text
/etc/volumio-screensaver.env
```

## Runtime behavior

- `install.sh` installs system dependencies, the Python package and the systemd service file.
- `onStart()` writes `/etc/volumio-screensaver.env`, enables and starts `volumio-screensaver.service`.
- `onStop()` stops and disables the service.
- `saveSettings()` persists the UI settings, rewrites the environment file and restarts the service.
- `uninstall.sh` removes the service, virtual environment and environment file.

## Local test on a Volumio device

From this plugin directory on a Volumio device:

```bash
volumio plugin refresh
volumio vrestart
volumio plugin install
```

Then enable the plugin from the Volumio UI.

Useful checks:

```bash
cat /etc/volumio-screensaver.env
cat /data/configuration/user_interface/pirate_audio_screensaver/settings.json
sudo systemctl status volumio-screensaver
sudo journalctl -u volumio-screensaver -n 100 --no-pager
```

## Publication workflow

For official publication, copy this folder into a fork of `volumio/volumio-plugins-sources` at:

```text
user_interface/pirate_audio_screensaver
```

Commit and push the fork, then run from the plugin directory on a Volumio device:

```bash
volumio plugin submit
```

## Notes

At boot, Volumio may not be immediately ready when the service starts. Temporary log warnings such as `Could not read Volumio state` are acceptable as long as the service remains active and later detects playback state correctly.
