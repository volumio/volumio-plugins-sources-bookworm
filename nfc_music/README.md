# NFC Music

Volumio 4 (Bookworm) plugin that plays music when you hold an NFC tag against a reader.

## Hardware
- A PC/SC compatible USB NFC reader, tested with the **ACR122U**
- NFC tags (NTAG213/215/216, MIFARE Classic, ...). Only the tag UID is read; nothing is written to the tag.

## Installation
Install from the Volumio plugin store (category *System Hardware*).
`install.sh` installs `pcscd` and `libccid` (only when missing), enables `pcscd.socket` and blacklists
the kernel `pn533` NFC drivers, which otherwise claim the ACR122U. Unplug and replug the reader after
installing. `uninstall.sh` undoes exactly these changes, using the state recorded in
`/data/configuration/system_hardware/nfc_music/install-state`.

## Usage
1. Open *Settings → Plugins → NFC Music*.
2. Hold a new tag against the reader and click **Bewerk deze tag** (edit this tag).
   The settings page is currently in Dutch; an English translation is planned.
3. Give it a name, choose what it should play and save.

Supported actions:

| Type | Fields |
|---|---|
| Local album | artist, album |
| Local track | artist, title (album optional) |

Matching ignores case, accents and punctuation.

## Where data is stored
Tags are stored in `/data/configuration/system_hardware/nfc_music/tags.json`
(format: see `config/tags.example.json`). The file is kept when the plugin is **updated**.
When the plugin is **uninstalled**, Volumio removes this folder (as for every plugin), so copy
`tags.json` first if you want to keep your tags.

## Troubleshooting
```bash
journalctl -u volumio -f | grep -i nfc     # plugin log
pcsc_scan                                  # (package pcsc-tools) is the reader seen by pcscd?
```

## License
MIT
