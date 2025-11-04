ASSETS DIRECTORY
----------------

This directory contains binary assets and configuration files required for the plugin.

Required Files:

1. raspdac-mini-lcd.dtbo - Device tree overlay for LCD display
   Source: https://github.com/foonerd/zjy240s0800tg02-ili9341-dtoverlay
   
   To add the dtbo file:
   - Download from the repository above
   - Place raspdac-mini-lcd.dtbo in this directory
   
   The dtbo provides:
   - Framebuffer device /dev/fb1
   - Configuration: buswidth=8, rotate=1, MADCTL 0xe8
   - GPIO: DC=27, RESET=24, LED=18

2. lircd.conf - LIRC remote control configuration
   - Audiophonics ApEvo remote button codes (14 buttons, 38kHz)
   - IR receiver GPIO 4
   - Copied to plugin lirc/ directory during install
   - Used by custom rdm_remote.service

3. lircrc - Remote button to Volumio command mappings
   - Maps buttons to volumio commands (play/pause/seek/volume/etc)
   - Background execution (&) for all commands
   - Copied to plugin lirc/ directory during install
   - Used by custom rdm_irexec.service

4. lirc_options.conf - LIRC daemon configuration
   - Custom options to avoid system service conflicts
   - Architecture-specific plugin paths (armhf/arm64)
   - Copied to plugin lirc/ directory during install
   - Auto-configured during installation

LIRC Implementation Notes:
- System lircd.service and lircd.socket are MASKED to prevent conflicts
- Custom services (rdm_remote.service, rdm_irexec.service) run independently
- Services start after lircd-setup.service completes
- All configs stored in plugin directory (/data/plugins/.../lirc/)

Optional Files:

5. compositor-{arch}-node{version}.tar.gz - Prebuilt compositor packages
   - Speeds up installation (no compilation needed)
   - Example: compositor-armv7l-node20.tar.gz
   - See PREBUILT.md for creating these archives

