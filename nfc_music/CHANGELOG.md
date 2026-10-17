# Changelog

## [Unreleased]
### Changed
- Tags are stored in `/data/configuration/system_hardware/nfc_music/tags.json` and survive plugin updates
  (automatic migration from the old location).
- `install.sh` installs `pcscd`/`libccid` and blacklists the kernel `pn533` drivers; `uninstall.sh` reverts this.
- Removed unused dependencies (`fs-extra`, `v-conf`).

## [2.0.0]
- Configuration page: last scanned tag, pick an existing tag, edit/delete a tag.
- Play local albums and tracks via the Volumio REST API.
