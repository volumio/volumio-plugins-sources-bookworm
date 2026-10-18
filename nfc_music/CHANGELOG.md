# Changelog

## [Unreleased]
### Changed
- Tags are stored in `/data/configuration/system_hardware/nfc_music/tags.json` and survive plugin updates
  (automatic migration from the old location).
- `install.sh` installs `pcscd`/`libccid`, enables `pcscd.socket` and blacklists the kernel `pn533` drivers;
  the install state is recorded (and kept across updates) so `uninstall.sh` reverts exactly these changes.
- Removed unused dependencies (`fs-extra`, `v-conf`).

## [2.0.0]
- Configuration page: last scanned tag, pick an existing tag, edit/delete a tag.
- Play local albums and tracks via the Volumio REST API.
