# Splash Frames (RGB565)

Shipped with the plugin and used at install time (no on-device generation).

## Required files

320×240 RGB565, 153600 bytes each:

| File | When shown |
|------|------------|
| `boot.raw` | Early boot when fb1 appears ("Booting...") |
| `starting.raw` | Compositor load ("Starting...") |
| `shutdown.raw` | Power off |
| `reboot.raw` | Reboot |

## Source logo

- `volumio-logo.png` — from [volumio-graphic-resources](https://github.com/volumio/volumio-graphic-resources)

## Regenerate (maintainers)

```bash
pip install Pillow
python3 scripts/build-splash-frames.py
```

Commit updated `*.raw` files before release.
