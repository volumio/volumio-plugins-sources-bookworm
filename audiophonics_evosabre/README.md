# Audiophonics Evo Sabre

A Volumio 4 plugin for the Audiophonics EVO Sabre. It drives the second display, the one on the right of the front panel, and the transport keys of the remote control.

## What it does

**The display** shows what is playing: the title, the artist and the album, the sample rate and bit depth, the volume, the player's address, and the time played against the track's length, at a size you choose. A title too long for the glass scrolls. Text in any script is drawn; Chinese, Japanese, Korean, Cyrillic and Greek come from GNU Unifont.

While the player rests, paused or stopped, a clock takes the place of the track, with the day and the date; or, if you ask for it, a snake that plays by itself. Left alone, the display dims, and while nothing plays it then goes dark; a key on the remote or playback starting brings it back. It greets with the Audiophonics mark when it starts, says *Getting ready* until the player has finished starting, and says goodbye when the player shuts down.

**The remote.** The streamer obeys five keys:

| Key | Action |
| --- | --- |
| Play | play or pause |
| Right, Left | next track, previous track |
| Up, Down | seek forward, seek back; they step on while held |

The volume, the mute, the input and the power keys are read by the DAC board itself.

## Requirements

- An EVO Sabre on a Raspberry Pi 4 or 5, or a Compute Module 4 or 5 on a carrier board with the 40-pin header.
- Volumio 4.

## Installing

Install the plugin from Volumio's plugin store, under System Hardware, and enable it. The first installation switches on the SPI bus and the remote's receiver in the boot configuration: **restart the player once** when the plugin asks.

Installing over version 2 of the plugin replaces it and starts the new display at once; your settings are kept. Restart the player afterwards to finish the update: until then the settings page is still version 2's.

## Settings

| Setting | What it does |
| --- | --- |
| Display on | Off stops the display's program: the display stays dark and the transport keys are not read. |
| Brightness | 1 to 255. |
| Track time | The time played, the track's length and the bar between them: Off, Small, Medium, Large or Extra large. Small unless you choose another. |
| Level meters | Two meters beside the track, one a channel. Off unless you switch them on. |
| Meters: where they stand | Lying under the track, with the time under them or beside them, or upright at its left or its right. |
| Meters: gain (dB) | Decibels added to what the meters show, -12 to 12. What is played is not touched. |
| Clock after | Seconds of rest before the clock replaces the track. 0 keeps the track. |
| Clock digits: unlit segments | The segments of the clock's digits that are not lit: Dark, Very faint, Faint or Dim. The first two greys are fainter than any other on the display. The Extra large track time is drawn in the same digits and follows it. |
| Snake me! | While the player rests, a snake has the display in place of the clock. Off unless you switch it on. |
| Dim after | Seconds after the last key on the remote, or after playback started, before the display dims. 0 never dims. |
| Dark after | Seconds after the last key, while nothing plays, before the display goes dark. 0 never goes dark. |
| Obey the transport keys | Off leaves the remote to the DAC board alone. |
| Check the remote | Says whether the receiver is being read and which key arrived last. |
| Click prevention | Holds the audio output open so the DAC's clocks never stop between tracks. Off unless you switch it on. |
| Detail | How much the display's program writes to the journal. |

Settings take effect when saved.

## Track time

*Track time* sets how large the time played and the track's length are drawn. The bar that shows how far the track has played runs between the two.

| Size | Its figures | The track above it |
| --- | --- | --- |
| Small | 6 pixels tall | The title, the artist and the album, a line each. |
| Medium | 8 pixels tall | The same three lines. |
| Large | 10 pixels tall | The artist and the album share a line. |
| Extra large | 13 pixels tall, drawn in segments as the clock's digits are | The artist and the album share a line. |

Small is the size the time has had since version 3.0.0. Small and Medium stand along the bottom of the display. Large and Extra large need the rows the album's line has, so the artist and the album share the line under the title, and the time stands in the middle of the rows under it.

The time played is drawn as wide as the track's length, so the bar keeps its place and its length from the first second of a track to the last. A stream has no length, and no time is drawn for it. Off leaves the time and its bar out.

## Level meters

Switch *Level meters* on and two meters stand beside the track, one a channel, on a scale of sixty decibels. The bright part of a meter is the level, averaged as a VU meter averages; the dimmer part reaches to the peak; a mark holds the highest peak for a moment before it falls. The marks between the two meters stand at 50, 40, 30, 20, 10, 6 and 3 decibels under full scale, and at full scale.

*Meters: where they stand* places them. Lying under the track, the left channel is above the right and the scale runs from left to right; the artist and the album share the line under the title to make room. Upright at the left or the right of the track, the left channel comes first and the scale runs from the bottom up; each line of the track is a little shorter.

Lying meters have the track time in one of two places. Under them, the meters run from edge to edge and the time has a row of its own along the bottom; a Large time leaves the meters three rows a channel in place of four. Beside them, the time played stands at their left and the track's length at their right, with the meters and the bar between the two. An Extra large time is too tall to stand under the meters and is always beside them.

With *Track time* off, meters lying under the track have the bottom rows as well and are drawn taller, with more room around them.

*Meters: gain* adds up to twelve decibels to what the meters show, or takes as many away: up for music that leaves them low, down for music that keeps them at the top. It moves the meters only.

The meters read evotap, a tap in the player's audio path. Every stream passes through it unchanged, PCM, DoP and native DSD alike, and it measures the stream ahead of the player's volume, so the meters show the music and not the volume it is played at. After the plugin is installed or updated the tap joins the audio path once the player has restarted; the plugin asks when that is needed. With the meters off, the tap is not in the path.

## The snake

Switch *Snake me!* on and, while the player rests, a snake has the display in place of the clock. It comes when the clock would, after the rest set in *Clock after*, and the whole display is its field. Nobody plays it: it goes for a note, grows with each one it eats, and starts over when it has run out of room. The display dims and goes dark as it does with the clock.

## Click prevention

Switch this on if the DAC clicks, or loses the first moment of a track, when playback starts or resumes. Leave it off if you hear no clicks.

The DAC takes its clocks from the Raspberry Pi. On a Raspberry Pi 5 they run only while something plays, so the DAC has to lock on to them again at every start. With Click prevention on, a small program, Audio Keepalive, takes over the audio output and holds it open: the music passes through untouched, and while nothing plays it sends noise far too quiet to hear, so the clocks never stop. A change of sample rate still reopens the output.

After the plugin is installed or updated, Click prevention joins the player's audio path once the player has restarted; the plugin asks when that is needed. If the Audio Keepalive plugin is installed and switched on, it already does this for every output, and Click prevention leaves it to.

## Setting up the DAC

In Playback Options, switch I2S DAC on and choose **Audiophonics I-Sabre ES9028Q2M**, then restart the player when asked. Set DSD Playback Mode to **DSD over PCM (DoP)**. Under Volume Options, set Mixer Type to **Hardware**, Mixer Control Name to **Digital** and Volume Curve Mode to **Linear**.

With Volume Curve Mode on Linear the volume on this display is the number on the DAC's own display. On Natural, Volumio counts the same volume on another scale, and the two displays show different numbers for it. The knob and the remote's volume keys change the volume on the DAC board itself, which does not report it to the player: this display shows that volume again the next time it is set from Volumio.

The DAC board switches the power itself: wait for the player to finish shutting down before switching the unit off.

## If something is wrong

The display's program is a service, `evosabre-panel`. Set Detail to Changes on the settings page, then:

    journalctl -u evosabre-panel -f

It says which board it found, how it opened the display, what the player is doing, and each key that arrives from the remote.

**The display stays dark after installing.** Restart the player: the SPI bus is switched on in the boot configuration, which is read at start.

**The display stays dark and its journal says a GPIO line is busy.** Another program has the display's D/C or reset line; the journal names it. A line *taken through /sys/class/gpio* was left by a program that has since stopped, as version 2 of this plugin left its two, and stays taken until the player restarts. The installer releases the two that version 2 left.

**Nothing plays with Click prevention on.** Look at its service: `systemctl status evosabre-keepalive`. While it is not running the audio path it is part of leads nowhere; switch Click prevention off to play without it.

**The volume and the mute do nothing, on a Raspberry Pi 5 or Compute Module 5.** The DAC board's own microcontroller has stopped answering the player. `dmesg | grep -i sabre` shows failed transfers, and after a restart `Audiophonics Device ID : FFFFFF87`. Switch the unit off and take its power away for ten seconds; a restart alone does not bring it back. What is known of this is in the [hardware notes](https://github.com/foonerd/audiophonics/blob/main/hardware/evo-sabre.md).

**The remote does nothing.** Press a key, then Check the remote on the settings page. *Not found* means the receiver's overlay is not loaded: restart the player. The display looks for the receiver again every few seconds, so one that comes up late is picked up. A receiver that is read but reports no key has not had its decoder switched on:

    cat /sys/class/rc/rc*/protocols

`[nec]` in square brackets is what it needs to show.

## What it installs

In the player's audio path the plugin puts only what its settings ask for: the tap for the level meters, and the program behind Click prevention. Outside its own folder, the plugin installs two systemd units (`evosabre-panel.service` for the display, `evosabre-keepalive.service` for Click prevention), udev rules for the receiver's decoder and its device, a sudoers entry for switching the two services, and a marked block of two lines in `/boot/userconfig.txt`. Uninstalling removes them all. Installing also removes version 2's three services and releases the display's two GPIO lines where version 2 left them taken.

## Credits

Audiophonics donated the hardware this plugin is developed and tested on. Olivier Schwach wrote the original EVO Sabre plugin for Audiophonics, and the work started with him; version 3 is a rewrite from the ground up by Just a Nerd.

Source, hardware notes and build: https://github.com/foonerd/audiophonics

## Support this project

The plugin is free and open source, maintained by one developer in his own time. If it has earned a place on your player, you can support its development through [GitHub Sponsors](https://github.com/sponsors/foonerd) or [Ko-fi](https://ko-fi.com/justanerd). Sponsorship is a thank-you, not a purchase: it buys no priority, no features and no support agreement.

## Licence

MIT. Three things shipped with the plugin are separate works under their own licences: GNU Unifont, as `assets/unifont.hex` (see `assets/UNIFONT.txt`); Audio Keepalive, the program behind Click prevention, under the GNU General Public License (see `keepalive/NOTICE.txt`); and evotap, the tap the level meters read, under the MIT licence (see `evotap/NOTICE.txt`).
