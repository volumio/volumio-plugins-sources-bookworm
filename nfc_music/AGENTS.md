# AGENTS.md - NFC Music (Volumio plugin)

Context for AI agents and reviewers (ChatGPT / Codex) working on this folder.

## Project
- Volumio 4 (Debian Bookworm, Node 20) plugin `nfc_music`, type `system_hardware`.
- Reads NFC tag UIDs with a PC/SC reader (ACR122U, `pcsclite` native module, `pcscd` service)
  and starts playback through the Volumio REST API on `127.0.0.1:3000` (`lib/player.js`).
- `index.js`: plugin controller (lifecycle, configuration page, tag storage).
- `lib/nfc-reader.js`: PC/SC reader. `lib/tag-handler.js`: maps a tag action to the player.
- `UIConfig.json` + the `build*Section` functions in `index.js`: the settings page.
- User tags: `/data/configuration/system_hardware/nfc_music/tags.json`
  (schema: `config/tags.example.json`). Never in git, never inside the plugin folder.
- Goal: publication in the official Volumio plugin store (fork of
  `volumio/volumio-plugins-sources-bookworm`). Only files under `nfc_music/` may change.

## Code Review Rules

Write review comments in Dutch. Be concrete: name the file, the line and a fix.

### Volumio store requirements (reject-level)
- Every effect of the plugin starts in `onStart` and is fully undone in `onStop`
  (reader closed, timers cleared, listeners removed). Nothing may run just because the plugin is installed.
- No `console.log` / `console.error`; use `this.logger` (`info` for user-relevant events, `debug` for noise).
- Never write to `/volumio` or `/myvolumio`. `install.sh` must not overwrite existing system files
  or reinstall tools Volumio itself uses; it must end with `echo "plugininstallend"`.
- `uninstall.sh` reverts what `install.sh` did and ends with `echo "pluginuninstallend"`.
- No secrets, tokens or personal data in the repository (`config/tags.json`, `config/spotify.json`).
- A change that users will receive must bump `version` in `package.json` and update
  `volumio_info.changelog` and `CHANGELOG.md`.

### Correctness
- Lifecycle methods and UI handlers (`onStart`, `onStop`, `getUIConfig`, `onSave` targets)
  must return a promise (kew `libQ` or native) and must never throw synchronously.
- Errors while handling a scanned tag are caught and logged; one bad tag must not stop the reader.
- Writing `tags.json` stays atomic (temp file + rename) and keeps a `.bak`.
- External HTTP calls (axios) need a timeout.
- Data read from `tags.json` or the UI is untrusted: validate types and ranges (e.g. volume 0-100).

### UIConfig.json pitfalls (learned the hard way)
- `element: "text"` does not exist; use `element: "input", type: "text"`.
- A `saveButton.data` array must list exactly the content ids of that section.
- A standalone `button` cannot send live field values; only a section `saveButton` can.
- The endpoint string is `system_hardware/nfc_music` everywhere.

### Style
- Files use LF line endings and UTF-8. Keep changes small and focused; no unrelated reformatting.
- User-facing strings belong in `i18n/strings_en.json` (English default) with `strings_nl.json` as translation.
