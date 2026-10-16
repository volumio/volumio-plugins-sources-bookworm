# Waveshare 2.8 SPI Panel

Volumio plugin for the Waveshare 2.8 inch SPI LCD (SKU 27579).

It installs `waveshare28-config` and the armhf `waveshare28-panel`
from `payload/`, writes sudoers, and opens Settings. Enable runs
`apply`. Disable runs `recover` and keeps `/boot/waveshare28.conf`.
The plugin does not edit `volumioconfig.txt`. Payload is this
plugin's responsibility.

Not part of a Volumio image. Pi 1 and the original Pi Zero (armv6)
are refused.

## Settings

Panel: rotation, speed, backend. Console only when the backend is
framebuffer. HDMI only on a Pi 4 with framebuffer. A read-only 3A+
KMS line only on a Pi 3A+.

UI: theme, boot status text, track strip. Bar spacing is kept and
does not move the glass.

SPI and rotation 0 are the defaults. They are starting values, not
locks.

Glass behaviour is `docs/UI.md` in the parent repository. Keys are
`docs/CONFIG.md`.

## Testing

Hands-on testing was on the [PIXIS CB-1](https://github.com/PIXISREPO/VOLUMIO-4-TOUCH):
a Pi 3A+ (portrait and landscape, framebuffer) and a Pi Zero 2 W
(portrait, SPI). Artwork, track text, progress and touch. That
repository is the CB-1 build and install guide.

Thank you, Peter.

## Licence

This plugin's package metadata is MIT. The renderer in `payload/` is
Apache-2.0, the same as the parent repository.
