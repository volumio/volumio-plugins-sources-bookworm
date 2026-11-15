# RaspDacMini LCD

A Volumio 4 plugin for the Audiophonics RaspDac Mini. It drives the 2.4 inch display on the front and the remote control.

## What it does

**The display** shows the cover of what plays, filling the screen from top to bottom; where a cover does not reach the sides, its own colours, blurred, fill the rest. Two bars lie over it. The one along the top carries what the player is doing, the unit's address, the time, repeat and shuffle, and the volume. The one along the bottom carries the track: its title, its artist and its album on one line, which runs from right to left when it is wider than the glass. A thin line above it fills as the track plays.

Text in any script is drawn: DejaVu Sans has Latin, Greek, Cyrillic and many more, and Chinese, Japanese and Korean come from GNU Unifont on the same line.

**The second page**, reached with the Down key of the remote, keeps the track at the top and lists what is known of the stream: sample rate, bit depth, bit rate, channels, the kind of track, its place in the queue, and the DAC's filter. Down again goes back.

While the DAC takes its other input the screen says which, in large letters. While nothing plays and no key is pressed the screen goes black after a time you choose. The plugin shows the Audiophonics mark while the player's software starts: with *Starting* under it until the player answers, then with *Getting ready* until the player says it has finished starting, which is some time after it first answers. The track's page comes up then. The mark is shown again, with a word for it, when the player shuts down or restarts.

**Level meters**, when they are switched on, stand on the first page: one a channel, upright beside the cover or lying over the track's line. See *Level meters* below.

**The player's own screens.** The display is the system's from the first moments of a start: Volumio's start-up and shutdown screens show on it, and so does the progress of a system update, so the unit never looks dead while it is busy. The plugin draws once those are done.

**Shutting down and restarting.** The system's own shutdown screen comes up some seconds after a shutdown or a restart has begun. Until it does, the display shows the mark with *Shutting down* or *Restarting* under it, whoever asked for it: the player, a command, an update. The system's screen comes once the network has been taken down, so how long the mark is up depends on how long the player takes to stop. On a system set up to show no screen of its own, and with the *Direct* display driver, *Restarting* stays until the next start, and *Shutting down* gives way to a black screen after three seconds. This is the *System framebuffer* display driver; see [Display driver](#display-driver) for the other.

**The remote.** The streamer acts on every key:

| Key | Action |
| --- | --- |
| Play | play or pause |
| The keys beside Play | seek back, seek forward; they step on while held |
| Left, Right | previous track, next track |
| OK | stop |
| Volume up, Volume down | the player's volume; they step on while held |
| Mute | mute, and back |
| Input | the DAC's input: the player, or SPDIF |
| Up | the DAC's next filter |
| Down | the second page, and back |
| Option | repeat on or off; held for half a second, shuffle on or off |
| Power | shuts the player down |

## Requirements

- A RaspDac Mini with the 2.4 inch display, on a Raspberry Pi.
- Volumio 4.
- For the Input and Up keys and the DAC line of the second page: the DAC chosen in Volumio's Playback Options as *Audiophonics I-Sabre ES9028Q2M*.

## Installing

Install the plugin from Volumio's plugin store, under System Hardware, and enable it. The first installation switches on the SPI bus and the remote's receiver in the boot configuration: **restart the player once** when the plugin asks.

Installing over version 1 of the plugin replaces it, keeps your settings and starts the new display at once. Restart the player afterwards to finish the update: until then the settings page is still version 1's.

## Settings

| Setting | What it does |
| --- | --- |
| Display on | Off stops the display's program: the screen stays black and the remote is not read. |
| Display driver | *System framebuffer*, or *Direct*. A change takes effect when the player has restarted. |
| Mark at start and at shutdown | The Audiophonics mark with a word under it while the player's software starts, shuts down or restarts. Off leaves the screen black at those times. |
| Black after | Seconds after the last key on the remote, while nothing plays, before the screen goes black. 0 never goes black. |
| Level meters | Two meters on the first page, one a channel. Off unless you switch them on. |
| Meters: where they stand | Upright at the right of the cover, at the left, or one at each side; or lying over the track's line. |
| Meters: gain (dB) | Decibels added to what the meters show, -12 to 12. What is played is not touched. |
| Obey the remote | Off leaves every key without effect. |
| Check the remote | Says whether the receiver is being read and which key arrived last. |
| Detail | How much the display's program writes to the journal. |

Settings take effect when saved.

The display has no line to switch its light off, so a black screen still glows a little.

## Level meters

Switch *Level meters* on and two meters stand on the first page, one a channel, on a scale of sixty decibels. The bright part of a meter is the level, averaged as a VU meter averages; the dimmer part reaches to the peak; a mark holds the highest peak for a moment before it falls. The scale's marks stand at full scale and at 3, 6, 10, 20, 30, 40, 50 and 60 decibels under it, and five of them are named.

*Meters: where they stand* places them. Upright, they stand in a strip beside the cover, at the right or at the left, the left channel first; or one at each side, the left channel's at the left of the cover and the right channel's at the right, each with its own scale. An upright scale runs from the bottom up. Lying, they are in a strip over the track's line, the left channel above the right and the scale running from left to right.

Where they stand has a cost. The display is sent whole rows, from the topmost that changed to the bottommost, and upright meters change nearly every row with every frame: that is more than can be sent fifty times a second. While upright meters move, the screen is drawn twenty-five times a second, and a track's line that runs moves two pixels at a time. Lying meters change only the rows above the track's line, and leave it at fifty and one pixel.

Upright meters need the Raspberry Pi at its full speed. One whose power supply sags slows itself, and the display's bus with it, to less than half for as long as the sag lasts, and upright meters then move unevenly. `vcgencmd get_throttled` says whether that has happened: anything but `0x0` has a cause worth finding, and the first bit is the supply.

*Meters: gain* adds up to twelve decibels to what the meters show, or takes as many away: up for music that leaves them low, down for music that keeps them at the top. It moves the meters only.

The meters read evotap, a tap in the player's audio path. Every stream passes through it unchanged, PCM, DoP and native DSD alike, and it measures the stream ahead of the player's volume, so the meters show the music and not the volume it is played at. After the plugin is installed or updated the tap joins the audio path once the player has restarted; the plugin asks when that is needed. With the meters off, the tap is not in the path. Switching the meters on or off has the player set its audio path up again, which stops what is playing. There are no meters on the second page, nor while the DAC takes its S/PDIF input, which is not the player's stream.

To see what the meters read without the display, while something plays:

    /data/plugins/system_hardware/raspdac_mini_lcd/bin/raspdacmini-panel --levels

## Display driver

The display can be driven in one of two ways. They cannot share it, so the choice is written into the boot configuration and takes effect when the player restarts.

| | System framebuffer | Direct |
| --- | --- | --- |
| Who drives the display | the kernel's own driver for it, loaded at boot | the plugin's program, over SPI |
| Volumio's start-up and shutdown screens | shown | not shown |
| The progress of a system update | shown | not shown: the screen is black until the update is done |
| Before the plugin's program runs | the system's screens | nothing |
| What is sent to the display | the whole picture at each change | only the part that changed |

*System framebuffer* is what the plugin sets unless you choose otherwise. *Direct* is there for a system whose kernel does not have the display's driver.

## What it installs

One small native program runs the display and the remote; nothing is compiled on the player, and no package is installed. Outside its own folder, the plugin installs one systemd unit (`raspdacmini-panel.service`), udev rules for the receiver's decoder and its device, a helper that writes the plugin's lines in the boot configuration (`/usr/local/bin/raspdacmini-boot`), another that tells the display, as its service is stopped, whether the system is shutting down or restarting (`/usr/local/bin/raspdacmini-leaving`), a sudoers entry for switching the service and running that helper, and a marked block of two lines in `/boot/userconfig.txt`. Uninstalling removes them all.

The display's driver is the kernel's own `fbtft` overlay, which comes with the system; the plugin ships no overlay.

Installing also removes what version 1 installed: its five services, its helper scripts, its sudoers entry, its display overlay and its lines in the boot configuration; and it gives back the system's lirc services and boot splash, which version 1 had masked. The packages version 1 installed are left in place.

Covers are fetched with the player's own `curl`.

In the player's audio path the plugin puts only what its settings ask for: the tap for the level meters, while they are on.

## Troubleshooting

The display's program writes to the system journal:

    journalctl -u raspdacmini-panel -f

Set *Detail* to Changes to see each change of the player's state, each key, and the DAC's input and filter as they change.

| What you see | What to look at |
| --- | --- |
| The screen stays dark after a first installation, or after changing the display driver | The display's driver is loaded at the next restart. The journal says which is missing until then: `no framebuffer named fb_ili9341`, or `/dev/spidev0.0`. |
| The screen shows nothing during a system update | The display driver is set to *Direct*. |
| The remote does nothing | *Check the remote* says whether the receiver is read. The receiver is switched on at the first restart after installing. |
| Input and Up do nothing, and the second page shows no filter | The journal says `no sound card named I-Sabre Q2M DAC`: choose the DAC in Playback Options. |
| No cover | The journal says why once for each cover: the address and what `curl` or the decoder said. |

## Credits

Audiophonics donated the hardware this plugin is developed on. Olivier Schwach wrote the original RaspDac Mini plugin for Audiophonics, and the work started with him; version 2 is a rewrite from the ground up by Just a Nerd.

Source, hardware notes and build: https://github.com/foonerd/audiophonics

## Support this project

The plugin is free and open source, maintained by one developer in his own time. If it has earned a place on your player, you can support its development through [GitHub Sponsors](https://github.com/sponsors/foonerd) or [Ko-fi](https://ko-fi.com/justanerd). Sponsorship is a thank-you, not a purchase: it buys no priority, no features and no support agreement.

## Licence

MIT. Three things shipped with the plugin are separate works under their own licences: DejaVu Sans, as `assets/DejaVuSans.ttf` (see `assets/DEJAVU.txt`); GNU Unifont, as `assets/unifont.hex` (see `assets/UNIFONT.txt`); and evotap, the tap the level meters read, under the MIT licence (see `evotap/NOTICE.txt`).
