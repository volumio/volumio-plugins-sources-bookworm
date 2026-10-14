# Surface Dial for Volumio 4

Use a Microsoft Surface Dial as a tactile Bluetooth controller for Volumio 4 (Bookworm).

## Features

- Rotate: volume in fixed 2% steps.
- 50 hardware haptic detents per revolution, mapping one revolution to 100 volume percentage points.
- Single press: Play / Pause by default.
- Double press: Next track by default.
- Long press: Previous track by default.
- Unified Haptics switch, enabled by default.
- Bluetooth discovery, pairing, trust, forget and automatic reconnect after sleep/drop-out.
- Direct Linux `hidraw` input; no companion application or permanent external daemon.
- Optional reverse rotation.

## Requirements

Volumio 4 Bookworm, working Bluetooth hardware, and a Microsoft Surface Dial (VID `045e`, PID `091b`). The installer adds BlueZ or Python 3 only if missing and installs a narrowly scoped udev rule for the Dial's `hidraw` device.

## Pairing

Enable the plugin, open Settings, put the Dial into pairing mode, choose **Scan for Surface Dial**, then **Pair selected Surface Dial**. The device is trusted during pairing. After sleep or a dropped connection, wake the Dial by pressing or rotating it and the plugin will request reconnection automatically without re-pairing.

## Defaults

- Rotation: 2% volume per detent / 50 detents per revolution.
- Single press: Play / Pause.
- Double press: Next.
- Long press: Previous.
- Haptics: On.
- Double-press window: 420 ms.
- Long-press threshold: 700 ms.
- Reconnect interval: 5 seconds.

## System changes

`install.sh` creates `/etc/udev/rules.d/99-volumio-surface-dial.rules`, refusing to overwrite an unrelated file at that path. `uninstall.sh` removes it only when marked as owned by this plugin. Bluetooth and Python packages are not removed because they may be shared by Volumio or other plugins. The plugin does not modify `/volumio` or `/myvolumio`.

## Known limitation

Surface Dial sleep/reconnect activity may interrupt Bluetooth audio when Surface Dial and Wireless Output Manager share the same Bluetooth adapter. If playback stutters, disable the Surface Dial plugin. Separating the Dial and speaker onto different adapters prevented the interruption in one Raspberry Pi/Volumio 4 test, but Wireless Output Manager may need explicit adapter selection to reconnect its speaker after reboot.

## Development

Canonical development repository: https://github.com/jhscann/volumio-surface-dial

Protocol research was informed by `andreasjhkarlsson/mac-dial`; this is an independent implementation and does not copy its source code.

MIT licence. Microsoft, Surface and Surface Dial are trademarks of Microsoft Corporation. This project is unofficial and is not affiliated with or endorsed by Microsoft or Volumio.
