Crate `1.6.0` `armv7-unknown-linux-musleabihf` renderer. Publish as
`runtime-v1.6.0`. Until that tag exists, this file is the plugin payload
only — not a GitHub Release asset.

    waveshare28-panel
    waveshare28-panel.sha256

Volumio 4 userland is armhf even on a Pi 5 (`VOLUMIO_ARCH=arm`).
`install.sh` copies this file to `/usr/local/bin/waveshare28-panel`.
To refresh it after a runtime release, replace both files from that tag.
