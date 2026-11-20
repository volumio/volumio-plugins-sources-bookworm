# Changelog – X10 RF Remote (x10remote)

Newest version first. Public numbering starts with 0.55.0.

## 0.67.2

source comments translated to English; key names of the new templates in all five languages; texts for eleven error codes that had none

## 0.67.1

nothing is loaded or registered at boot any more (uinput autoload file and udev rule of older versions are removed, the mapper service handles both itself); a failed installation leaves no files behind; install/uninstall scripts are executable; no pending timer after the plugin is stopped

## 0.67.0

save a profile (or the Mobile Remote assignment) as template; four new shipped templates (Medion RF 20018268 with X10 WTI receiver, G21 Pro, generic 2.4 GHz remote, Mobile Remote with four radio stations); folders in /data/INTERNAL/X10 are named sender-…, receiver-…, template-… (older folders are renamed at start)

## 0.66.2

the mapper log always says how Triggerhappy got the virtual devices

## 0.66.1

fix - keys did nothing after the plugin or the mapper was (re)started until Triggerhappy was restarted: the mapper now checks that Triggerhappy has opened its virtual devices, registers them with th-cmd if not, and as a last resort the plugin restarts Triggerhappy; no more "Unable to parse trigger line" messages for empty lines

## 0.66.0

66 instead of 36 internal keys for "automatic" (KEY_MACRO1-30 added when Triggerhappy knows them, existing assignments keep their key)

## 0.65.3

Mobile Remote - IP address smaller

## 0.65.1

Mobile Remote - host name larger, IP address to the right of it; stopping the plugin can no longer fail on a single step

## 0.65.0

Mobile Remote - host name and IP address of the device at the top; above the volume control an own picture can be chosen for the light and the dark appearance (no picture is shipped; without one the word "Volume" is shown)

## 0.64.0

the same Triggerhappy key may be chosen more than once - buttons with the same action share the key (one command line), a different action gets its own internal key, so one press never runs two commands; the key list shows what each key is already used for in the profile being edited

## 0.63.0

Mobile Remote with 20 buttons (5 x 4) instead of 16; new simulation of the phone page inside the web interface (light/dark), reachable from the plugin settings, with working buttons

## 0.62.0

all ports are preset and freely configurable in the settings - web interface 7810, internal key events 7811, Mobile Remote 7812 (an unchanged old default 7710/7720 is moved once, a port you chose stays); Mobile Remote: four fixed buttons below the volume control - previous, pause, play, next - using Volumio's own commands

## 0.61.0

new "Mobile Remote" - a page for the phone on its own port (off by default) with 16 freely assignable buttons, title/artist/album from Volumio and volume; the buttons are configured like remote keys (Triggerhappy key, built-in actions, radio stations, custom commands in expert mode)

## 0.60.0

profile or receiver folders that are ignored because of invalid content are shown in the profile list (and reported if the profile is active) instead of disappearing silently; the Triggerhappy start is re-checked every 5 minutes - exclusive mode is withdrawn if another plugin overrides triggerhappy.service later; "repeat" is preselected for volume up/down

## 0.59.1

self-review of 0.59.0 - receivers with a HID consumer-control interface (ABS_VOLUME) are no longer mistaken for touchscreens; while reading in a combined receiver only its key part is locked, never its touchpad/mouse part; keyboards are never taken over automatically and their keystrokes are not shown during detection; SIGHUP is only sent once Triggerhappy handles it; watchdog does not restart a mapper that exited with code 78; X10 default profile only on the very first start

## 0.59.0

review fixes - profiles from the SMB share are validated on every load and the Triggerhappy file strips control characters; Triggerhappy is reloaded with SIGHUP instead of restarted; exclusive mode creates its systemd drop-in only while switched on (runtime, in /run) and refuses if another plugin overrides triggerhappy.service; warning if Triggerhappy does not read the plugin's file; wizard detection never locks touchscreens, mice or keyboards and asks for confirmation (same key twice); watchdog off by default and only restarts crashed services; install aborts if python3-evdev is missing, mapper no longer restart-loops; X10 default profile only when an X10 receiver is connected; held keys: debounce 600 ms (ati_remote), IR repeat frames (rc-core) no longer read in as a second key; smaller template pictures; architectures armhf/amd64

## 0.58.1

several transmitters on one receiver with identical codes - the profile activated last applies instead of skipping, identical assignments are no conflict

## 0.58.0

radio station action (3 URIs failover, presets, reachability check, display data, radio-stations.json), web radio report, add to My Web Radios, receivers in one folder named like the receiver, same Triggerhappy key allowed in different profiles

## 0.57.0

transmitters and receivers with own names and pictures, 433 MHz mode (n:m), template library (Medion RF 20016398), all keys locked while reading in, used Triggerhappy keys greyed out, delete in profile list

## 0.56.0

new wizard - profile first, then key by key (name and action right away), "Done", then pictures

## 0.55.1

web interface follows the Volumio language automatically

## 0.55.0

first public release - wizard to read in RF/IR remotes (including scan-code-only keys such as the X10 WTI receiver), profiles with labels, descriptions, notes and pictures, key test page, command reference, print view, rename/duplicate profiles, custom commands replace Volumio defaults per remote without modifying audio.conf, expert mode (custom shell commands off by default, exclusive Triggerhappy mode), watchdog, translations: English, Italian, German, Spanish, French

