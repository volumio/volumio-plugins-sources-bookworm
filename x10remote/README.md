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
web interface: Node HTTP server inside the plugin process (unprivileged), port 7810
```

## Features

* **Wizard** in four steps: 1. profile name, description, notes; 2. choose the remote (press the same key twice to
  detect and confirm it, or pick it from the device list); 3. press one key at a time and name and assign it right away ("Accept – next
  key", Enter, or simply press the next key; known keys reopen for editing), then **"Done – all keys read in"** saves
  the profile; 4. add up to six pictures (upload or take a photo).
* **Transmitters and receivers**: a profile is a transmitter (the remote); receivers are the USB devices
  (one folder each directly in `/data/INTERNAL/X10`, named `receiver-<name of the receiver>`, with `receiver.json`) with their own name, notes and pictures. Without the **433 MHz** tick a
  receiver belongs to exactly one transmitter and a transmitter to exactly one receiver; with it (e.g. X10 RF) a
  receiver works with several transmitters and a transmitter with several receivers (no double execution).
* **Radio station** action: station name, up to three URIs (failover in that order), display logo / quality / format
  for display plugins, presets from `/data/INTERNAL/X10/radiopresets.txt` (installed once, editable), reachability
  check before applying. Executed as `x10remote-action radio <profile>/<key>` (no expert mode needed; no URI in the
  Triggerhappy line). All stations are published in `/data/INTERNAL/X10/radio-stations.json` (read-only interface
  for other plugins, e.g. an HD44780/VFD display). Start page: check all web radio URIs → text report in
  `/data/INTERNAL/X10/webradio-check-<date>.txt`. Profile page: add the profile's stations to Volumio's
  "My Web Radios" via Volumio's own `addToMyWebRadio` (backup in `X10/_backup`).
* **Templates** (`templates/template-<name>/template.json` + pictures): profiles for known remotes that ship with the
  plugin (Medion RF 20016398 / 20018268 / 20029724 with the X10 WTI receiver, G21 Pro, a generic 2.4 GHz remote, a
  Mobile Remote assignment with four radio stations). Texts follow the Volumio language; labels printed on the remote
  are never translated. **Save as template** (profile page, Mobile Remote page) writes a profile with its pictures,
  station logos and the data of its receivers to `/data/INTERNAL/X10/template-<name>/` – listed next to the shipped
  ones, usable at once, and ready to be sent in for shipping. Own templates live on the share and are validated like
  every profile when a profile is created from them; custom commands in a template are dropped unless they are enabled.
* **Folder names show what a folder is:** `sender-<name>` (profile of a remote), `receiver-<Name>` (receiver),
  `template-<name>` (template). Folders from older versions – also ones copied in by hand – are renamed when the
  plugin starts; active profiles stay active.
* **Locked while reading in – but never the local console**: during detection only remote-like devices are grabbed
  (receivers such as X10/ati_remote, IR, HDMI-CEC); keyboards are only observed, mice and touchscreens are not
  opened at all, so a kiosk display stays usable. A device counts as detected only after the same key arrives twice
  (or the user clicks *Use this device*). While the keys are read in, only that confirmed device is grabbed (bounded
  by a keepalive timeout) – none of its keys, not even the power key, triggers anything. The wizard shows whether
  the lock was confirmed.
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
* **Mobile Remote** (off by default): a page for the phone on its own port (default 7812). From top to bottom: host
  name and IP address of the device, title/artist/album from Volumio, 20 freely assignable buttons, a volume control
  (− / slider / +) and four fixed buttons (previous, pause, play, next). Light and dark appearance follow the phone.
  Above the volume control the user can show an own picture (one for light, one for dark; PNG/JPG/WebP); the plugin
  ships no picture, and without one the word "Volume" is shown. The buttons are configured on their own page of the web interface exactly like remote keys: free
  Triggerhappy key from the list (or automatic), built-in action, radio station, or a custom command in expert mode.
* **Simulation:** the web interface shows the same phone page in a phone frame (light/dark switch) – reachable from
  the plugin settings, the start page and the Mobile Remote page. It is the real page, so every button works; it is
  served by the configuration port under `/sim/` and may only be framed by the web interface itself.
* **Triggerhappy keys may be chosen more than once.** Keys with the same command share the key and one trigger line;
  the first key with a different command keeps the chosen key, every further one gets an internal virtual key, so one
  press never runs two commands. The key list shows what a key is already used for in the profile being edited.
* **Ports:** all three are preset and can be changed in the plugin settings (1024–65535, all different): web interface
  7810, Mobile Remote page 7812, internal key events 7811 (UDP, 127.0.0.1 only). If a port is in use, the next free one
  is taken and shown.
* **Expert mode** with custom commands and the optional **exclusive Triggerhappy mode**; optional **watchdog**
  (off by default; every 5 minutes it restarts Triggerhappy or the mapper only if they **crashed** – a service stopped
  on purpose stays stopped).
* **Held keys:** a key without repeat fires once while held. For scan-code keys a new press is only recognised after
  no frame of that code arrived for the debounce time (default 600 ms – the X10 driver `ati_remote` holds repeats
  back for 500 ms). With IR receivers (rc-core) the scan-only frames the kernel sends while a recognised key is held
  are treated as repeats of that key, so the wizard does not read the same button in twice.

## How audio.conf stays untouched

`audio.conf` and every other foreign Triggerhappy file are only **read**. The plugin writes exactly one file,
`/etc/triggerhappy/triggers.d/x10remote.conf`.

* A recognised key with an own action: the mapper grabs only that remote (`EVIOCGRAB`), emits the key as a free virtual
  key that only `x10remote.conf` handles and passes all other keys of that remote through unchanged. If the service
  stops or crashes, the kernel releases the device immediately.
* A scan-code key with an own action whose chosen Triggerhappy key is already used elsewhere is emitted internally as a
  free virtual key ("shielded"). The pool of virtual keys never contains keys used by other trigger files.
  Result: **an action never runs twice**.
* Triggerhappy opens input devices only when it starts; devices created later reach it through its udev rule, which
  is not reliable everywhere. The mapper therefore checks (`/proc/<thd>/fd`) that Triggerhappy has opened the virtual
  keyboard and each passthrough device, registers a missing one with `th-cmd --passfd --add`, and only if that fails
  the plugin restarts Triggerhappy (at most once a minute).
* Changes are applied with **SIGHUP** (`systemctl kill -s HUP --kill-who=main triggerhappy.service`) – Triggerhappy
  re-reads its trigger files; the unit has no `ExecReload`, and commands Triggerhappy is running are not signalled.
* The plugin checks which `--triggers` path the running Triggerhappy really uses. If another plugin or a manual
  override points it elsewhere, the plugin's file is not read – this is reported under *Show status* and in the web
  interface instead of failing silently.
* **Exclusive mode (expert mode, off by default):** nothing is installed for it in advance. Only when it is switched
  on does the root helper `x10remote-thd-exclusive@on.service` create a **runtime** drop-in
  `/run/systemd/system/triggerhappy.service.d/x10remote-exclusive.conf` that changes only the directory after
  `--triggers` to `/run/x10remote/triggers.d` (own assignments plus copied `audio.conf` lines). If another drop-in
  (e.g. the Bluetooth remote plugin) already overrides `ExecStart`, the helper **refuses** and names the file – the
  plugin never takes over a foreign override. The switch is verified via the process command line; `@off` removes the
  drop-in on stop, disable, uninstall, and `/run` is empty after every reboot.

## Volumio plugin rules

* All effects only between `onStart` and `onStop` (mapper service, watchdog timer, exclusive mode, web interface,
  capture). Services are never enabled at boot. `onStart` rejects on real errors.
* Logging only through the Volumio logger (prefix `X10Remote::`), no `console.log`.
* `sudo` only for `systemctl` (including the small root helpers `x10remote-fixperms.service`,
  `x10remote-thd-exclusive@.service` and the watchdog). The helpers take no user input.
* `install.sh` installs missing packages only (`python3-evdev`, `triggerhappy`, `curl`), never overwrites foreign
  files, writes nothing to `/volumio`, and **aborts with an error** if `python3-evdev` or Triggerhappy cannot be
  installed. The mapper exits with code 78 if evdev or `/dev/uinput` is unusable; the unit does not restart it then
  (`RestartPreventExitStatus=78`, start limit). `uninstall.sh` removes only the plugin's own files (profiles stay).
* First start: the X10 default profile is created and activated **only if an X10 receiver (0bc7:0006) is connected**;
  otherwise "Volumio default – vanilla" stays active.
* Multi-language: `i18n/strings_<code>.json`, English is mandatory and the fallback; `UIConfig.json` uses
  `TRANSLATE.X10.*` only. Toasts, modals and the web interface use the plugin's own translation, which follows the
  Volumio language (`language_code`) and reloads when it changes.

## Security

* **Everything read from `/data/INTERNAL/X10` is validated on every load**, not only when saved through the web
  interface – the folder is on the guest-writable SMB share. A hand-edited `profile.json` goes through the same checks
  (lengths, control characters, allowed actions, key names) or is ignored with a log message. In addition the writer
  of the Triggerhappy file strips all control characters, also from comments, and accepts only `KEY_*`/`BTN_*` names.
* **Mobile Remote port:** a second, separate HTTP server that exists only while the option is switched on (and only
  between `onStart` and `onStop`). It serves three fixed files (plus the user's own two pictures, if chosen) and four endpoints: read state (host name,
  IP, title, artist, album, volume, button labels – no URIs, no commands), press one of the 20 buttons, set the volume, and previous / pause /
  play / next (Volumio's own `volumioPrevious`, `volumioPause`, `volumioPlay`, `volumioNext`). No configuration
  endpoint is reachable on this port. Same protections as the web interface (fixed file list, CSP without inline code,
  same-origin and JSON content type for writes, 200-byte body limit).
  A button press never runs a command inside the plugin: the plugin passes the button number to the mapper over the
  Unix socket `/run/x10mapper.sock`; the mapper accepts it only from root or the user `volumio` (`SO_PEERCRED`), only
  numbers 1–20, and emits the virtual key configured for that button – Triggerhappy then runs the command as for any
  remote key. Volume and now-playing use Volumio's own `volumiosetvolume` / `volumioGetState`.
  The buttons are stored as a reserved profile (`/data/INTERNAL/X10/mobile-remote`), validated like every profile.
* The web interface (port 7810) runs unprivileged inside the Volumio process, like Volumio's own UI it is meant for
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
interface at `http://<device IP>:7810/`.

## Files

| Path | Purpose |
|---|---|
| `/data/INTERNAL/X10/sender-<name>/profile.json`, `image1..6` | profiles (remotes) and pictures |
| `/data/INTERNAL/X10/receiver-<Name>/receiver.json`, `image1..6` | receivers and pictures |
| `/data/INTERNAL/X10/template-<name>/template.json`, pictures | own templates ("Save as template") |
| `/data/INTERNAL/X10/command reference.txt` | command reference (user-editable) |
| `/data/configuration/system_hardware/x10remote/config.json`, `mapper.json` | settings, generated mapper config |
| `/etc/triggerhappy/triggers.d/x10remote.conf` | the plugin's Triggerhappy file |
| `/etc/systemd/system/x10mapper.service`, `x10remote-watchdog.{service,timer}`, `x10remote-fixperms.service`, `x10remote-thd-exclusive@.service` | services (started only by the plugin) |
| `/run/systemd/system/triggerhappy.service.d/x10remote-exclusive.conf` | runtime drop-in, exists only while exclusive mode is on |
| `/usr/local/bin/x10mapper.py`, `x10remote-action`, `x10remote-radio`, `x10remote-watchdog`, `x10remote-fixperms`, `x10remote-thd-exclusive` | programs |

## Troubleshooting

```sh
systemctl is-active x10mapper triggerhappy
journalctl -u x10mapper -n 50
curl -s http://localhost:7810/api/info
cat /run/x10mapper-status.json
cat /proc/$(systemctl show -p MainPID --value triggerhappy)/cmdline | tr '\0' ' '; echo   # which --triggers path
```

Hardware checks for held keys (with *Log key presses* on): hold a key for one second and count the `Key:` lines –
expected is exactly one for keys without repeat:

```sh
journalctl -u x10mapper -f
```

## License

MIT
