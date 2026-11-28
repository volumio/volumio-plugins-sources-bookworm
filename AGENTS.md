# Writing Volumio plugins

This repository holds the sources of the plugins in the Volumio Plugin Store, for Volumio 4 on Debian Bookworm. Each folder is one plugin. These rules apply to every plugin here, and a plugin that breaks one is rejected at review.

Full documentation: https://developers.volumio.com. The whole of it as one text file: https://developers.volumio.com/llms-full.txt

## Start from the example

New plugins start from `example_plugin/`, either with `volumio plugin init` on a Volumio device or by copying the folder. It already follows every rule below. Keep its structure:

| File | Purpose |
|---|---|
| `package.json` | Name, version, `volumio_info` (prettyName, icon, plugin_type, architectures, os), engines, dependencies |
| `index.js` | The controller. Exports one constructor that takes `context` |
| `config.json` | Default settings, as `{"key": {"type": "string", "value": "..."}}` |
| `UIConfig.json` | The settings page. `onSave.endpoint` is `<plugin_type>/<name>` |
| `i18n/strings_en.json` | Every UI string. `TRANSLATE.KEY` in `UIConfig.json` reads from here |
| `install.sh`, `uninstall.sh` | Executable, start with `set -e`, end with `echo "plugininstallend"` / `echo "pluginuninstallend"` |
| `README.md`, `LICENSE` | Required |

`plugin_type` is one of `audio_interface`, `music_service`, `system_controller`, `system_hardware`, `user_interface`, `miscellanea`. The folder on the device is `/data/plugins/<plugin_type>/<name>/`.

`package.json` must contain `"os": ["bookworm"]`, `"architectures"` with `amd64` and/or `armhf`, `"engines": {"node": ">=20", "volumio": ">=4"}`, a real `author`, `repository`, `details` and `changelog`, and a `license`.

## The controller API

- `context.coreCommand` is the command router, `context.logger` the logger.
- Lifecycle methods return a `kew` (libQ) promise: `onVolumioStart` loads config, `onStart` starts the plugin, `onStop` stops it, `getConfigurationFiles` returns `['config.json']`, `getUIConfig` returns the settings page.
- Settings: `v-conf` with `config.get(key)` and `config.set(key, value)`.
- Messages to the user: `commandRouter.pushToastMessage(type, title, message)` with `type` one of `success`, `info`, `warning`, `error`.
- Calling another plugin: `commandRouter.executeOnPlugin(type, name, method, data)`.
- Music services also implement `handleBrowseUri`, `explodeUri`, `search`, `clearAddPlayTrack`, `stop`, `pause`, `resume`, `seek`, and push state with `commandRouter.servicePushState(state, serviceName)`. See https://developers.volumio.com/plugins/music-service.
- Use promises and events. Chain `.then()` on the libQ promise an API returns, or wrap a callback with `libQ.defer()`. Use `setTimeout` or `setInterval` only when no promise or event exists, and clear them in `onStop`.

## Hard rules

### Lifecycle
- Installing the plugin has no effect. Everything starts in `onStart` and is undone in `onStop`.
- `onStop` releases everything: timers, sockets, socket.io connections, child processes, browse sources, overlays.
- Long-running processes are systemd units the plugin ships, started and stopped with `sudo /bin/systemctl` from `onStart` and `onStop`. Never child processes of the plugin.

### Stability
- Never take the backend down: no `process.exit`, no global `uncaughtException` handlers, no overriding `commandRouter` methods.
- Catch every failure of a remote API, log it and reject the promise or show a toast. Volumio keeps working when the service is down.
- Don't assume the network is ready at start. If a login is needed, retry it when the network is back.
- No blocking calls in handlers: no `execSync`, `spawnSync` or synchronous network calls.

### Commands and root
- Run commands with `execFile` or `spawn` and an argument list. Never build a command string, and never let a settings value reach a shell.
- Root only through `/usr/bin/sudo` followed by the full path of an approved command. No `echo volumio | sudo -S`, no new sudoers entries, no `chmod 777`.
- Approved commands: `/bin/chmod`, `/bin/dd`, `/bin/hostname`, `/bin/ip`, `/bin/journalctl`, `/bin/kill`, `/bin/ln`, `/bin/mount`, `/bin/mv`, `/bin/rm`, `/bin/systemctl`, `/bin/tar`, `/bin/umount`, `/sbin/dhclient`, `/sbin/dhcpcd`, `/sbin/ethtool`, `/sbin/halt`, `/sbin/ifconfig`, `/sbin/iw`, `/sbin/iwconfig`, `/sbin/iwgetid`, `/sbin/iwlist`, `/sbin/modprobe`, `/sbin/poweroff`, `/sbin/reboot`, `/sbin/shutdown`, `/usr/bin/alsactl`, `/usr/bin/apt-get`, `/usr/bin/dcfldd`, `/usr/bin/dtoverlay`, `/usr/bin/gpio`, `/usr/bin/killall`, `/usr/bin/renice`, `/usr/bin/smbtree`, `/usr/bin/timedatectl`, `/usr/bin/unlink`, `/usr/sbin/alsactl`, `/usr/sbin/i2cdetect`, `/usr/sbin/i2cset`, `/usr/sbin/service`, `/usr/sbin/update-rc.d`, `/usr/bin/xset`, `/usr/bin/xinput`, `/usr/bin/tee`, `/opt/vc/bin/tvservice`, `/opt/vc/bin/vcgencmd`.

### Files
- Never write under `/volumio` or `/myvolumio`.
- Never overwrite a file that already exists, and never write a configuration file used by Volumio or by another plugin. Volumio runs on an overlay filesystem: a modified image file hides every later OTA update of that file.
- Generated configuration goes under `/tmp` and is rebuilt at each start. Persistent data goes under `/data`.
- Audio changes go through AAMPP (`has_alsa_contribution` in `package.json` plus a snippet file). Never edit `/etc/asound.conf`. See https://developers.volumio.com/AAMPP/using-aampp.
- Never touch another plugin's files.

### Install and dependencies
- `install.sh` and `uninstall.sh` start with `set -e`. No `|| true` hiding a failed step.
- Volumio runs `install.sh` and `uninstall.sh` as root with `sh`, whatever the shebang says. Write POSIX sh (no bash arrays, `[[ ]]` or `source`) and don't call `sudo` in them.
- `install.sh` never runs npm or pip. Node dependencies go in `package.json`; `volumio plugin package` bundles `node_modules` into the zip.
- Nothing is downloaded at install or at runtime without a pinned version and a checksum check.
- `uninstall.sh` removes what `install.sh` added, and nothing else.
- Every dependency is pinned to an exact version. No `^`, `~`, `"*"` or unpinned git dependencies.
- No API keys, tokens or passwords in the source.

### Hygiene
- Log with `this.logger.info` / `.error`. No `console.log`.
- Every UI string lives in `i18n/strings_en.json`.

## Check your work

Before you call a plugin done, grep it for each of these. Any hit is a rejection:

```bash
grep -rnE 'console\.log|execSync|spawnSync|process\.exit|sudo -S|chmod 777|uncaughtException' --include='*.js' --include='*.sh' . --exclude-dir=node_modules
grep -nE '"\*"|"\^|"~' package.json
grep -nE 'npm |pip ' install.sh
head -2 install.sh uninstall.sh
```

Then, on a Volumio 4 device: `volumio plugin refresh`, `volumio vrestart`, enable the plugin in the UI, and read `journalctl -u volumio -f` for errors while you start, use and stop it.

## Submitting

Commit to your fork of this repository, then run `volumio plugin submit` from the plugin folder on a Volumio device and open a pull request. See https://developers.volumio.com/plugins/plugin-publishing and the full checklist at https://developers.volumio.com/plugins/submission-checklist.
