# ReplayGain plugin for Volumio

Plays every track at a consistent loudness, using the ReplayGain tags stored in
your files by taggers such as [rsgain](https://github.com/complexlogic/rsgain),
loudgain or foobar2000. Tracks without tags play unchanged.

It applies to everything Volumio plays through MPD: local and NAS libraries, web
radio, and plugins that stream to MPD such as Jellyfin. Spotify, YouTube Cast and
AirPlay do not go through MPD and are not affected.

## Settings

| Setting | |
| --- | --- |
| **ReplayGain** | `Album gain` preserves the loudness differences between the tracks of an album. `Track gain` levels each track on its own. `Auto` uses track gain when shuffle is on and album gain otherwise. `Off` disables it. |
| **ReplayGain preamp** | An extra −6 to +12 dB on top of ReplayGain. ReplayGain targets a fairly quiet reference level, so a positive value is often wanted. Peaks are limited, so the preamp cannot cause clipping. |

Saving restarts MPD, so playback stops for a moment.

## Installing

From this directory, on a Volumio player:

```bash
volumio plugin install
```

For a different player, run `volumio plugin package` and upload the resulting zip
to `http://<player>:3000/plugin-upload`.

## Where the settings go

The plugin registers with the MPD plugin's `registerConfigCallback()`, which
appends its settings to `/etc/mpd.conf` every time Volumio regenerates it:

```
### ReplayGain (managed by the replaygain plugin)
replaygain                      "album"
replaygain_preamp               "0"
replaygain_missing_preamp       "0"
replaygain_limit                "yes"
```

Nothing under `/volumio` is modified, so the settings survive Volumio updates.

## Good to know

- Uninstalling restarts Volumio about twenty seconds after it finishes, to clear
  the callback the plugin registered with MPD. This is expected; let it run.
- If you previously added `replaygain` lines to `mpd.conf.tmpl` over SSH, remove
  them. The plugin manages those settings itself, and MPD will not start when a
  setting is defined twice.
