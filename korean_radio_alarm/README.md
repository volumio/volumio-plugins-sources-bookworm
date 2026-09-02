# Korean Radio Alarm

A Volumio 4 Bookworm music service plugin that adds Korean radio browsing plus a weekly alarm scheduler.

## Features

- Browse grouped Korean radio stations in the Volumio browse section.
- Configure an unlimited number of independent alarm slots (dynamic add/delete from the UI).
- Slots support their own time, station, volume, and weekday schedule.
- Each slot can be configured to play a station or stop playback when it triggers.
- Volumio 4 Bookworm compatibility (`engines.node >= 20`, `volumio >= 4`, `os: ["bookworm"]`).
- No additional system dependencies and no runtime writes to `/volumio` or `/myvolumio`.
- KBS stations resolve through the KBS play API and memoize stream URLs in-memory during runtime, which can reduce repeated stream start latency without changing playback behavior.

## Included stations

- KBS
  - KBS Classic FM
  - KBS Cool FM
  - KBS Hanminjok
  - KBS World Radio
- News
  - YTN Radio
- Music
  - CBS Music FM

`MBC`, `SBS`, and `Listen.moe K-pop` are currently omitted because stream stability and playback compatibility need additional validation before re-adding.

## Default config for dynamic alarm slots

`config.json` ships with defaults for `alarm_ids` and `alarm_1`.

- `alarm_ids`: comma-separated active slot IDs (`alarm_1` by default)
- `alarm_1`: enabled=false, weekdays Mon-Fri=true, Sat/Sun=false
- all slots use `korean_radio_alarm://station/kbs-classic-fm` as default station

Legacy single-slot config keys are still supported for migration.

## Install / test / uninstall (local repo)

```bash
cd /path/to/korean_radio_alarm
npm ci
npm test
```

You can install directly from the plugin folder on a Bookworm device:

```bash
# from device/remote shell
cd /path/to/korean_radio_alarm
volumio plugin install .
```

## Volumio submission checklist

- Use only repository defaults for Bookworm submission (`bookworm`, amd64/armhf, node>=20).
- Keep plugin entrypoints (`install.sh`, `uninstall.sh`, `config.json`, `UIConfig.json`) and lockfiles committed.
- Avoid external apt packages and avoid writing outside plugin-scoped directories.
- Verify no system-level side effects.
- Validate station catalogue and defaults align with submit-ready constraints.

See full checklist in [`docs/submission-checklist.md`](docs/submission-checklist.md).

## Known limitations

- Radio stream endpoints can change without notice.
- This repo intentionally omits `MBC`, `SBS`, and `Listen.moe K-pop` until stream stability is revalidated.
- Dynamic endpoint failures should surface naturally and be reviewed before re-enabling stations.
