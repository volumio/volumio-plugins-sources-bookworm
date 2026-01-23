# RaspDacMini LCD Plugin for Volumio 4.x

Display driver plugin for Audiophonics RaspDacMini with 2.4" LCD (320x240) on Volumio 4.x (Debian Bookworm).

## Hardware Compatibility

* Audiophonics RaspDacMini
* Display: ZJY240S0800TG02 (ILI9341 controller)
* IR Receiver: GPIO 4 (optional, for remote control)
* Remote: Audiophonics ApEvo 38kHz (14 buttons)
* Raspberry Pi 3/4/5 (ARM architecture: armhf or arm64)
* GPIO Configuration: DC=27, RESET=24, LED=18

## Features

* Native framebuffer rendering via /dev/fb1
* Event-driven display updates with 50fps target
* Album art with background blur effect
* Scrolling text with easing animation
* Volume and playback state indicators
* Repeat and shuffle status icons in header
* Mute indicator with visual feedback
* DAC input control (I2S/SPDIF toggle)
* DAC filter cycling
* Configurable screen timeout
* IR remote control support (Audiophonics ApEvo remote)
* Prebuilt compositor packages for fast installation
* Node.js 20 compatible
* Real-time socket.io integration with Volumio

## Requirements

* Volumio 4.x (Debian Bookworm)
* Node.js 20+
* Raspberry Pi (ARM architecture)
* Device tree overlay file: raspdac-mini-lcd.dtbo

## Installation

### Via Volumio Plugin Store (Future)

Once submitted and approved:
1. Navigate to Plugins -> Search
2. Search for "RaspDacMini LCD"
3. Click Install
4. **IMPORTANT: Reboot your system** for device tree overlay to load
5. After reboot, enable the plugin via: Plugins -> Installed Plugins -> RaspDacMini LCD

### Manual Installation (Development/Testing)

1. SSH into your Volumio system
2. Clone the repository:
   ```bash
   git clone https://github.com/foonerd/RaspDacMini --depth=1
   cd RaspDacMini
   ```
3. Install the plugin:
   ```bash
   volumio plugin install
   ```
4. Wait for installation to complete
   - **With prebuilt**: ~10 seconds (no compilation)
   - **Without prebuilt**: ~15-30 minutes (compiles from source)
5. **IMPORTANT: Reboot your system** for device tree overlay to load:
   ```bash
   sudo reboot
   ```
6. After reboot, enable the plugin via Volumio UI: Plugins -> Installed Plugins -> RaspDacMini LCD

**Note:** The installation script automatically detects if a prebuilt compositor exists for your architecture and Node version. If found, it uses the prebuilt (fast). If not found, it compiles from source (slow but works). See [PREBUILT.md](PREBUILT.md) for creating prebuilt archives.

### Installation Process

The installation script automatically:
* Installs system dependencies (build-essential, Cairo, Pango, JPEG, GIF, SVG libraries)
* Compiles native RGB565 color conversion module
* Installs compositor npm packages (canvas, socket.io-client 2.3.0, etc.)
* Copies device tree overlay to /boot/overlays/
* Configures /boot/userconfig.txt with dtoverlay
* Creates systemd service (rdmlcd.service)
* Enables service for auto-start

### Post-Installation

After reboot, verify installation:
```bash
# Check framebuffer device
ls -la /dev/fb1

# Check service status
sudo systemctl status rdmlcd.service

# View logs
sudo journalctl -u rdmlcd.service -f
```

## Configuration

Access plugin settings via Volumio UI: Plugins -> Installed Plugins -> RaspDacMini LCD -> Settings

### Available Options

* **Enable LCD Display**: Turn display output on/off
* **Screen Timeout**: Seconds before screen sleep when idle (0 = never sleep, default: 900)

### Actions

* **Restart LCD Service**: Restart the display service to apply changes

## Remote Control

The plugin includes support for the Audiophonics ApEvo IR remote control with custom LIRC implementation to avoid system service conflicts.

### Button Mappings

| Button | Function |
|--------|----------|
| Play | Play/Pause toggle |
| Previous (left) | Previous track |
| Next (right) | Next track |
| Left arrow (playleft) | Seek backward (hold) |
| Right arrow (playright) | Seek forward (hold) |
| Up | Cycle DAC filters |
| Down | Switch display view (metadata scroll) |
| Option | Short press: Toggle repeat / Long press: Toggle shuffle |
| Input | Toggle DAC input (I2S/SPDIF) |
| Volume + | Volume up |
| Volume - | Volume down |
| Mute | Mute/unmute toggle |
| OK | Stop playback |
| Power | System shutdown |

### LIRC Implementation

The plugin uses custom systemd services to prevent conflicts with system LIRC:

- **rdm_remote.service** - Custom lircd daemon using plugin configs
- **rdm_irexec.service** - Button handler executing Volumio commands
- **System services masked** - lircd.service and lircd.socket disabled

All LIRC configurations are stored in the plugin directory, not /etc/lirc/.

### Testing Remote

After installation and reboot:

```bash
# Check custom LIRC service status
systemctl status rdm_remote.service
systemctl status rdm_irexec.service

# Check if LIRC is receiving signals
irw

# Press buttons on remote - you should see output like:
# 0198b847 00 play ApEvo
# 019858a7 00 playright ApEvo
```

If no output, check:
- IR receiver wiring (GPIO 4)
- dtoverlay=gpio-ir,gpio_pin=4 in /boot/userconfig.txt
- lircd-setup.service completed successfully

## Architecture

### Display Layout

The LCD header (top bar) shows status indicators:

```
[Play/Pause] [IP Address] ... [Clock] ... [Repeat] [Shuffle] [Volume]
     4,4        21,15          165,15      226,3    242,3     260,2
```

* Play/Pause/Stop icon (left)
* IP address and clock (center)
* Repeat icon - dim when off, bright when active
* Shuffle icon - dim when off, bright when active
* Volume indicator with level waves

### HTTP Control Endpoints

The compositor runs an HTTP server on port 4153 for external control:

| Endpoint | Function |
|----------|----------|
| /switch_view | Toggle metadata scroll view |
| /toggle_input | Toggle DAC input (I2S/SPDIF) |
| /next_filter | Cycle to next DAC filter |
| /toggle_repeat | Toggle repeat mode (1.5s debounce) |
| /toggle_shuffle | Toggle shuffle mode (1.5s debounce) |
| /nosleep | Reset idle timeout |
| /poweroff | Shutdown system |

### Layer Overview

1. **Hardware Layer**: Device tree overlay provides /dev/fb1 framebuffer
2. **Rendering Engine**: Canvas-based compositor with event-driven updates
3. **Data Source**: Socket.io 2.3.0 listener for Volumio state changes
4. **Color Conversion**: Native C++ module for RGBA to BGR565 conversion
5. **Plugin Wrapper**: Volumio plugin lifecycle management
6. **Service Management**: systemd service with environment override

### Directory Structure

```
raspdac_mini_lcd/
├── package.json                      # Plugin metadata and dependencies
├── config.json                       # Default configuration values
├── UIConfig.json                     # Settings UI definition
├── index.js                          # Plugin controller (lifecycle management)
├── install.sh                        # POSIX sh installation script
├── uninstall.sh                      # Cleanup script
├── requiredConf.json                 # Hardware requirements
├── LICENSE                           # GPL-3.0 license
├── README.md                         # This file
├── PREBUILT.md                       # Guide for creating prebuilt archives
├── i18n/                             # Translation files
│   └── strings_en.json               # English translations
├── assets/                           # Binary assets and configuration files
│   ├── raspdac-mini-lcd.dtbo         # Device tree overlay (user must add)
│   ├── lircd.conf                    # LIRC remote control configuration
│   ├── lircrc                        # Remote button to command mappings
│   ├── lirc_options.conf             # LIRC daemon configuration
│   ├── README.txt                    # Assets folder documentation
│   └── compositor-*.tar.gz           # Optional prebuilts (armv7l/aarch64)
├── lirc/                             # LIRC runtime (created during install)
│   ├── lircd.conf                    # Remote button codes (from assets)
│   ├── lircrc                        # Button command mappings (from assets)
│   └── lirc_options.conf             # Daemon config (from assets)
├── compositor/                       # Display rendering engine
│   ├── index.js                      # Main compositor (798 lines)
│   ├── package.json                  # Compositor dependencies
│   ├── rdmlcd.sh                     # Service startup wrapper
│   ├── service/                      # systemd service files
│   │   ├── rdmlcd.service            # systemd service definition
│   │   └── SERVICE_DOCUMENTATION.txt # Service configuration guide
│   └── utils/                        # Compositor utility modules
│       ├── volumiolistener.js        # Volumio socket.io integration
│       ├── daccontrol.js             # Native DAC control (I2S/SPDIF, filters)
│       ├── scroll_animation.js       # Easing functions for scrolling
│       ├── panicmeter.js             # Write collision detection
│       ├── upnp_albumart_fallback.js # Album art fallback logic
│       └── rgb565.node               # Native module (built during install)
└── native/                           # Native C++ modules source
    └── rgb565/                       # Color conversion module
        ├── rgb565.cpp                # RGBA to BGR565 conversion
        ├── binding.gyp               # node-gyp build configuration
        ├── build_rdmlcd.sh           # Build and install script
        └── package.json              # Native module metadata
```

## Development Status

### Completed (v1.1.0)

* [x] Plugin structure and configuration
* [x] Volumio 4.x integration
* [x] Compositor integration (moOde9 base, Volumio adapted)
* [x] Native RGB565 color conversion module
* [x] socket.io-client 2.3.0 compatibility
* [x] Installation and uninstallation scripts (POSIX sh)
* [x] systemd service management
* [x] Environment variable configuration pass-through
* [x] UI definition and translations
* [x] Canvas 2.11.2 compatibility (Node 20)
* [x] DAC input control (I2S/SPDIF)
* [x] DAC filter cycling
* [x] Repeat/shuffle icons with visual feedback
* [x] Mute state handling
* [x] Debounced remote control endpoints
* [x] Docker-based prebuilt generation

### Testing Status

* [x] Installation on Volumio 4.x / Raspberry Pi 4
* [x] Framebuffer rendering
* [x] Color format (BGR565)
* [x] Socket.io connection to Volumio
* [x] Real-time playback display
* [x] Album art and metadata
* [x] Service lifecycle management

### Known Requirements

* **Device Tree Overlay**: User must add raspdac-mini-lcd.dtbo to assets/ folder
  - Download from: https://github.com/foonerd/zjy240s0800tg02-ili9341-dtoverlay
* **Reboot Required**: After installation for dtoverlay to load

## Technical Details

### Dependencies

**System Packages (installed automatically):**
* build-essential - Compilers and build tools (make, gcc, g++)
* libcairo2-dev - Cairo graphics library
* libpango1.0-dev - Text layout engine
* libjpeg-dev - JPEG support
* libgif-dev - GIF support
* librsvg2-dev - SVG support
* fbset - Framebuffer configuration
* jq - JSON processor for config parsing

**Compositor Packages:**
* canvas ^2.11.2 - Canvas rendering (Node 20 compatible)
* stackblur-canvas ^2.5.0 - Blur effects
* socket.io-client ^2.3.0 - Volumio communication (v2 API)
* bindings ~1.5.0 - Native module loader
* nan ^2.14.1 - Native abstractions for Node.js
* @tokenizer/http ^0.6.1 - HTTP streaming
* simple-get ^4.0.1 - HTTP client

**Native Module:**
* node-addon-api ^7.1.0 - N-API wrapper

**Plugin Framework (Volumio-managed):**
* kew * - Promise library
* v-conf * - Configuration management
* fs-extra * - File system utilities

### Device Tree Overlay

Source: https://github.com/foonerd/zjy240s0800tg02-ili9341-dtoverlay

Configuration:
* Bus width: 8-bit
* BGR format: enabled (bgr flag set)
* Rotation: 1 (90° - landscape, pins right)
* MADCTL: 0xe8
* SPI speed: 64MHz (default)
* Refresh rate: 30fps (default)

### Color Format

The compositor uses BGR565 format:
* Canvas renders RGBA (32-bit)
* Native module converts to BGR565 (16-bit)
* Big-endian byte order for ILI9341
* Format: BBBBBGGG GGGRRRRR (high byte, low byte)

### Service Management

Service: rdmlcd.service
* Location: /etc/systemd/system/rdmlcd.service
* User: root (required for framebuffer access)
* Working Directory: /data/plugins/system_hardware/raspdac_mini_lcd/compositor
* Environment: SLEEP_AFTER configured via override.conf
* Restart: on-failure with limits

Environment Override:
* Location: /etc/systemd/system/rdmlcd.service.d/override.conf
* Updated automatically when sleep_after changed in UI
* Allows runtime configuration without editing service file

### Prebuilt Compositor Archives

To speed up installation on slower systems (especially 1GB RAM Pi boards), the plugin supports prebuilt compositor archives:

**Installation time:**
* With prebuilt: ~10 seconds
* Without prebuilt: 15-30 minutes (compilation)

**How it works:**
1. Install script checks for `assets/compositor-{ARCH}-node{MAJOR}.tar.gz`
2. If found: Extracts prebuilt, skips build-essential installation
3. If not found: Installs build tools and compiles from source

**Supported architectures:**
* `armv7l` - Raspberry Pi 2/3/4 (32-bit OS)
* `aarch64` - Raspberry Pi 3/4/5 (64-bit OS)

**Creating prebuilts:**
See [PREBUILT.md](PREBUILT.md) for detailed instructions on creating prebuilt archives for your architecture.

## Troubleshooting

### Display not working after installation

**REBOOT REQUIRED** - Device tree overlay only loads on boot:
```bash
sudo reboot
```

After reboot, check framebuffer:
```bash
ls -la /dev/fb1
```

### Display shows white screen or no content

Check service status:
```bash
sudo systemctl status rdmlcd.service
```

View logs:
```bash
sudo journalctl -u rdmlcd.service -f
```

Check dtoverlay loaded:
```bash
dtoverlay -l | grep raspdac
```

### Installation fails with "not found: make"

System dependencies not installed. Try manual installation:
```bash
sudo apt-get update
sudo apt-get install build-essential
```

### Native module compilation fails

Check Node.js version (must be 20+):
```bash
node --version
```

Check architecture:
```bash
dpkg --print-architecture
```

### Socket.io connection errors

Check Volumio running:
```bash
systemctl status volumio.service
```

Check Volumio API:
```bash
curl http://localhost:3000/api/v1/getState
```

### Colors incorrect or inverted

Ensure latest plugin version installed. Native module must match display's BGR format.

### Display pixelated or corrupted

Native module may need recompilation after plugin update:
```bash
cd /data/plugins/system_hardware/raspdac_mini_lcd/native/rgb565
npm run install_rdmlcd
```

## Credits

* **Original Developer**: Olivier Schwach (Audiophonics)
* **moOde9 Compositor**: https://github.com/audiophonics/RaspDacMinilcd/tree/moode9
* **Volumio Adaptation**: Just a Nerd
* **Device Tree Overlay**: https://github.com/foonerd/zjy240s0800tg02-ili9341-dtoverlay

## License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please submit issues or pull requests to the repository.

## Support

For issues and support:
* GitHub Issues: https://github.com/foonerd/RaspDacMini/issues
* Volumio Forum: https://community.volumio.com/

## Changelog

### Version 1.1.0 (2025-01-13)

**DAC Control, Visual Feedback & Reliability Improvements**

* DAC control integration
  - Native Node.js DAC control (replaces shell scripts)
  - Toggle I2S/SPDIF input via Input button
  - Cycle DAC filters via Up button
  - SPDIF mode displays full-screen indicator

* Display improvements
  - Repeat icon in header (circular arrow, position 226,3)
  - Shuffle icon in header (crossed arrows, position 242,3)
  - Icons dim when inactive, bright when active
  - Mute state now triggers visual feedback

* Remote control reliability
  - Debounced repeat/shuffle endpoints (1.5s cooldown)
  - Eliminates rapid-fire toggle issues
  - All timing logic moved to compositor (single-threaded)
  - Removed shell script intermediaries

* Button mapping changes
  - Option: Short press = repeat, Long press = shuffle
  - Input: Toggle DAC input (I2S/SPDIF)
  - Up: Cycle DAC filters
  - Down: Switch display view
  - Mute: Now properly toggles (was mute-only)

* Code quality
  - All comments translated to English
  - Compositor version 3.0.0
  - Credits updated (Author: Nerd, Original: Olivier Schwach)

* Build system
  - Docker-based prebuilt generation
  - Pinned Node.js 20.15 for reliable canvas prebuilts
  - Separate build repo: github.com/foonerd/raspdacmini-builds

### Version 1.0.1 (2025-10-28)

**LIRC Remote Control & Installation Improvements**

* Added full LIRC support for Audiophonics ApEvo remote control
  - Custom rdm_remote.service and rdm_irexec.service to prevent conflicts
  - System lircd.service and lircd.socket masked during installation
  - All LIRC configs stored in plugin directory (not /etc/lirc/)
  - Architecture-specific plugin paths (armhf/arm64)
* Improved button mappings
  - Left/Right arrows: Previous/Next track
  - Play Left/Right: Seek backward/forward (hold)
  - Volume controls with repeat support
  - Background execution for all commands
* Installation robustness
  - Device tree overlay made optional (warns instead of aborting)
  - Clear warning message with download link if dtbo missing
  - Prebuilt compositor detection for faster installation
  - Better error handling and cleanup
* Uninstall improvements
  - Removes GPIO IR overlay from /boot/userconfig.txt
  - Unmasks system LIRC services
  - Complete cleanup of custom services
* Documentation updates
  - Complete LIRC implementation details
  - Service architecture documentation
  - Updated directory structure with lirc/ runtime folder
  - Expanded testing procedures

### Version 1.0.0 (2025-10-27)

**Initial Release - Complete Plugin**

* Plugin structure and Volumio 4.x integration
* Compositor with moOde9 base adapted for Volumio
* Native RGB565 color conversion module (BGR565 format)
* socket.io-client 2.3.0 for Volumio compatibility
* POSIX sh compatible installation scripts
* systemd service with environment override
* Canvas 2.11.2 (Node 20 compatible)
* Real-time playback display with album art
* Configurable screen timeout
* Complete error handling and logging
