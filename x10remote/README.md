# X10 RF Remote – Volumio 4 plugin

Makes the keys of RF/IR remote controls usable in Volumio – including keys that the kernel driver only reports as
`MSC_SCAN` (for example the X10 WTI RF receiver `0bc7:0006` with driver `ati_remote`) and that Triggerhappy therefore
never sees. A wizard reads in any remote; every remote becomes a **profile** with key names, labels, commands,
description, notes and up to six pictures. Own commands can replace Volumio's default key assignments for one remote
**without ever modifying `audio.conf`**.

Languages: English, Italiano, Deutsch, Español, Français. *(German documentation: `README.de.md`)*

```
remote → kernel driver (unchanged) → /dev/input/eventX
  → x10mapper.py (systemd service x10mapper, root, Python + evdev)
       → uinput "X10Remote virtual keyboard"   converted keys (KEY_F13 … or a chosen key such as KEY_DVD)
       → uinput "X10Remote passthrough …"      unchanged keys while a remote is grabbed
  → Triggerhappy (part of Volumio) → x10remote-action → Volumio REST API
web interface: Node HTTP server inside the plugin process (unprivileged), port 7710
```

## Features

* **Wizard** in four steps: 1. profile name, description, notes; 2. choose the remote (press a key to detect it,
  or pick it from the device list); 3. press one key at a time and name and assign it right away ("Accept – next
  key", Enter, or simply press the next key; known keys reopen for editing), then **"Done – all keys read in"** saves
  the profile; 4. add up to six pictures (upload or take a photo).
* **Transmitters and receivers**: a profile is a transmitter (the remote); receivers are the USB devices
  (one folder each directly in `/data/INTERNAL/X10`, named exactly like the receiver, with `receiver.json`) with their own name, notes and pictures. Without the **433 MHz** tick a
  receiver belongs to exactly one transmitter and a transmitter to exactly one receiver; with it (e.g. X10 RF) a
  receiver works with several transmitters and a transmitter with several receivers (no double execution).
* **Radio station** action: station name, up to three URIs (failover in that order), display logo / quality / format
  for display plugins, presets from `/data/INTERNAL/X10/radiopresets.txt` (installed once, editable), reachability
  check before applying. Executed as `x10remote-action radio <profile>/<key>` (no expert mode needed; no URI in the
  Triggerhappy line). All stations are published in `/data/INTERNAL/X10/radio-stations.json` (read-only interface
  for other plugins, e.g. an HD44780/VFD display). Start page: check all web radio URIs → text report in
  `/data/INTERNAL/X10/webradio-check-<date>.txt`. Profile page: add the profile's stations to Volumio's
  "My Web Radios" via Volumio's own `addToMyWebRadio` (backup in `X10/_backup`).
* **Templates** (`presets/`): profiles for known remotes that ship with the plugin (first: Medion RF 20016398).
  Texts follow the Volumio language; labels printed on the remote are never translated.
* **Locked while reading in**: from detection on, the mapper reads all devices exclusively – no key (not even
  the power key) triggers anything; the wizard shows whether this was confirmed.
* **Profiles** in `/data/INTERNAL/X10` (share "Internal Storage", fully writable from Windows/macOS): name,
  description, notes, 6 pictures (upload or take a photo), rename (folder follows), duplicate (`<name> copy`),
  **Print Profile** (key list, optionally with command and scan code / `KEY_*`, print or copy as text).
* **Per key:** name, label on the remote, action (built-in Volumio actions or custom command), command description,
  repeat while held, and for scan-code keys the **Triggerhappy key** to emit (list read from `thd --listevents`).
* **Key test** page with virtual LEDs and an event log showing the emitted key and its `audio.conf` assignment;
  "Configure" button for every event.
* **Command reference** next to every command field (`/data/INTERNAL/X10/command reference.txt`, user-editable,
  never overwritten).
* Built-in profile **"Volumio default – vanilla"** = only Volumio's original `audio.conf`.
* **Expert mode** with custom commands and the optional **exclusive Triggerhappy mode**; **watchdog** (every 5 minutes).

## How audio.conf stays untouched

`audio.conf` and every other foreign Triggerhappy file are only **read**. The plugin writes exactly one file,
`/etc/triggerhappy/triggers.d/x10remote.conf`.

* A recognised key with an own action: the mapper grabs only that remote (`EVIOCGRAB`), emits the key as a free virtual
  key that only `x10remote.conf` handles and passes all other keys of that remote through unchanged. If the service
  stops or crashes, the kernel releases the device immediately.
* A scan-code key with an own action whose chosen Triggerhappy key is already used elsewhere is emitted internally as a
  free virtual key ("shielded"). The pool of virtual keys never contains keys used by other trigger files.
  Result: **an action never runs twice**.
* **Exclusive mode (expert mode, off by default):** `install.sh` adds a systemd drop-in for `triggerhappy.service` that
  replaces only the directory after `--triggers` by a variable. Without `/run/x10remote/thd.env` it is the original
  directory, so Triggerhappy behaves exactly as before. When enabled, the plugin writes that file after a configurable
  delay and restarts Triggerhappy, which then reads only `/run/x10remote/triggers.d` (own assignments plus copied
  `audio.conf` lines). It verifies the switch via the process command line and reverts on stop, disable, uninstall and
  after every reboot (`/run` is a tmpfs).

## Volumio plugin rules

* All effects only between `onStart` and `onStop` (mapper service, watchdog timer, exclusive mode, web interface,
  capture). Services are never enabled at boot. `onStart` rejects on real errors.
* Logging only through the Volumio logger (prefix `X10Remote::`), no `console.log`.
* `sudo` only for `systemctl` (including the small root helpers `x10remote-fixperms.service` and the watchdog).
* `install.sh` installs missing packages only (`python3-evdev`, `triggerhappy`, `curl`), never overwrites foreign
  files, writes nothing to `/volumio`; `uninstall.sh` removes only the plugin's own files (profiles stay).
* Multi-language: `i18n/strings_<code>.json`, English is mandatory and the fallback; `UIConfig.json` uses
  `TRANSLATE.X10.*` only. Toasts, modals and the web interface use the plugin's own translation, which follows the
  Volumio language (`language_code`) and reloads when it changes.

## Security

* The web interface (port 7710) runs unprivileged inside the Volumio process, like Volumio's own UI it is meant for
  the home network. Fixed file list, strict validation of every input (types, lengths, allowed values, profile ids),
  pictures checked by file signature, size limits, JSON content type and same-origin check for every write request
  (CSRF protection), Content-Security-Policy without inline scripts, atomic and serialised writes.
* **Expert mode** (settings section, off by default) holds the two functions that reach deeper into the system:
  *Allow custom shell commands* and *Triggerhappy exclusive*. Switching expert mode off turns both off.
* **Custom commands** are **off by default**. They can only be enabled in expert mode, and only after confirming a
  notice that lists the concrete risks (no login on the web interface, rights of the Triggerhappy user `nobody`,
  network access, faulty or copied commands) and explains that the risk is low as long as the device is not reachable
  from the internet. They cannot be unlocked from the web interface. Commands containing `#` are rejected because
  Triggerhappy treats everything after `#` as a comment.

## Installation (development)

```sh
cd /home/volumio/volumio-plugins-sources-bookworm/x10remote
volumio plugin install
volumio vrestart
```
Then enable the plugin in *Plugins → Installed plugins*; its settings show the version and buttons that open the web
interface at `http://<device IP>:7710/`.

## Files

| Path | Purpose |
|---|---|
| `/data/INTERNAL/X10/<profile>/profile.json`, `image1..6` | profiles and pictures |
| `/data/INTERNAL/X10/command reference.txt` | command reference (user-editable) |
| `/data/configuration/system_hardware/x10remote/config.json`, `mapper.json` | settings, generated mapper config |
| `/etc/triggerhappy/triggers.d/x10remote.conf` | the plugin's Triggerhappy file |
| `/etc/systemd/system/x10mapper.service`, `x10remote-watchdog.{service,timer}`, `x10remote-fixperms.service` | services (started only by the plugin) |
| `/etc/systemd/system/triggerhappy.service.d/x10remote.conf` | drop-in for exclusive mode (inert without `/run/x10remote/thd.env`) |
| `/usr/local/bin/x10mapper.py`, `x10remote-action`, `x10remote-watchdog`, `x10remote-fixperms` | programs |

## Troubleshooting

```sh
systemctl is-active x10mapper triggerhappy
journalctl -u x10mapper -n 50
curl -s http://localhost:7710/api/info
cat /run/x10mapper-status.json
```

## License

MIT
