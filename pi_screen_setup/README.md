# Pi Screen Setup Plugin for Volumio

A comprehensive display configuration plugin for Volumio 4.x (Bookworm) on Raspberry Pi. Provides a guided wizard interface for configuring HDMI, DSI, DPI, and composite video outputs with proper rotation, resolution, and audio routing.

## Features

- **Guided Setup Wizard**: 7-step wizard walks through complete display configuration
- **Display Presets Database**: Over 200 pre-configured settings for popular displays (Waveshare, Adafruit, Elecrow, GeeekPi, UCTRONICS, LCDwiki, Sunfounder, Kuman, Pimoroni, Raspberry Pi Official, Joy-IT, Freenove, Seeed Studio, Spotpear, Longruner, Hosyond, HMTECH, BIGTREETECH/BIQU)
- **Multiple Output Types**: HDMI, DSI (ribbon), DPI (GPIO), Composite, Custom overlays
- **Dual HDMI Support**: Full configuration for Pi 4/5 dual HDMI ports
- **Rotation Support**: 0/90/180/270 degree rotation with proper KMS, fbcon, and plymouth integration
- **Audio Routing**: Configure HDMI audio independently from video
- **Migration System**: Automatically detects and migrates existing display settings
- **Safe Configuration**: Creates backups before changes, validates settings before applying
- **KMS/DRM Support**: Full vc4-kms-v3d overlay support for Pi 2/3/4/5
- **Preset Manager**: Web-based interface for managing and contributing display presets
- **Internationalization**: Available in 6 languages (English, German, French, Spanish, Italian, Dutch)
- **Database Auto-Update**: Automatic fetching of latest display presets from GitHub

## Preset Manager

The plugin includes a standalone web interface for managing display presets:

**Access**: http://volumio.local:4567/

**Features**:
- View and search all display presets
- Add new presets with full parameter configuration
- Edit existing presets
- Import presets from URL, file, or direct upload
- Export database for backup or GitHub contribution
- Create and restore backups
- Revert to bundled database

The Preset Manager is useful for:
- Adding support for displays not in the default database
- Testing preset configurations before contributing upstream
- Managing custom presets for OEM deployments

## Supported Hardware

- Raspberry Pi 2, 3, 4, 5
- Raspberry Pi 400, 500
- Compute Modules CM3, CM4, CM5
- Pi Zero 2 W (limited KMS support)

## Supported Display Types

### HDMI Displays (with presets)

**Waveshare:**
- 2.8", 3.5", 4", 4.3", 5", 7", 7.9", 8.8", 9.3", 10.1", 11.9" HDMI LCD
- Round (5" 1080x1080) and Square (4" 720x720)

**Adafruit:**
- 5", 7", 10.1" (including IPS and Backpack models)

**Elecrow:**
- 5", 7"

**GeeekPi/52Pi:**
- 5", 7", 11.6"

**UCTRONICS:**
- 3.5", 5", 7"

**LCDwiki/Goodtft:**
- 3.5", 4", 5", 7" (Miuzei/Kuman rebrands)

**Sunfounder:**
- 7", 10.1"

**Kuman:**
- 7"

**Joy-IT:**
- 5", 7", 10", 10.1" HDMI LCD

**Freenove:**
- 7" HDMI

**Seeed Studio:**
- 5" (720x1280), 7" (720x1280, 1024x600, 1280x800), 10.1" (1280x800, 1200x1920, 1366x768)

**Spotpear:**
- 4", 5", 7", 10.1", 5" Round (1080x1080)

**Longruner:**
- 5", 7" HDMI

**Hosyond:**
- 5", 7", 8.8" bar, 10.1" HDMI

**HMTECH:**
- 7", 10.1" HDMI

**Generic/Standard:**
- Generic resolutions (480x320, 800x480, 1024x600, 1280x800, 1366x768)
- Standard resolutions (720p, 1080p, 4K 30Hz, 4K 60Hz)
- Custom timing support (hdmi_timings and hdmi_cvt)

### DSI Displays

**Official Raspberry Pi:**
- Raspberry Pi Touch Display 7" (Original, 800x480)
- Raspberry Pi Touch Display 2 - 7" (720x1280)
- Raspberry Pi Touch Display 2 - 5" (720x1280)

**Waveshare DSI (vc4-kms-dsi-waveshare-panel):**
- 2.8" (480x640)
- 3.4" Round (800x800)
- 4.0" (480x800)
- 4.0" C (720x720)
- 4.3" (800x480)
- 5.0" (720x1280)
- 6.25" (720x1560)
- 7.0" C (1024x600)
- 7.0" H (1280x720)
- 7.9" (400x1280)
- 8.0" (1280x800)
- 8.8" (480x1920)
- 10.1" (1280x800)
- 11.9" (320x1480)
- 13.3" 2-lane/4-lane (1920x1080)

**Waveshare DSI-TOUCH V2 Series:**
- 3.4" C, 4.0" C, 5.0" A, 5.5" A
- 7.0" A/B/C, 8.0" A (2-lane/4-lane)
- 8.8" A, 9.0" B (2-lane/4-lane)
- 10.1" A/B (2-lane/4-lane)
- 12.3" A (4-lane)

**BIGTREETECH/BIQU DSI:**
- PI TFT43 V2.0 (4.3", 800x480)
- PI TFT50 V1.0/V2.0 (5", 800x480)
- PI TFT70 V2.1 (7", 800x480)
- HDMI5/HDMI7 V1.0/V1.1/V1.2 (DSI-compatible models)

**Freenove DSI:**
- 4.3" (800x480)
- 5" (800x480)
- 7" (800x480)

**Hosyond DSI:**
- 5" (800x480)
- 7" (800x480)

**Other DSI:**
- JDI LT070ME05000 / V2 (Compute Module only)
- Generic DSI panel (custom timings)

### DPI Displays

**Pimoroni:**
- HyperPixel 4.0 (800x480)
- HyperPixel 4.0 Square (720x720)
- HyperPixel 2.1 Round (480x480)

**Waveshare DPI:**
- 2.8" (480x640)
- 3.5" (640x480)
- 4" B (480x800)
- 4" C (720x720)
- 5" (800x480)
- 7" (1024x600)

**BIGTREETECH DPI:**
- TFT43-DIP (4.3", 800x480)

**Other DPI:**
- VGA666 adapter
- Waveshare 3.5" DPI (640x480)
- Waveshare 4" DPI-C (720x720)
- Owootecc 4.3" DPI (480x320)
- Custom/Generic DPI panel

### Other
- Composite video (PAL/NTSC/PAL-M/PAL-N)
- Custom device tree overlays

## Installation

### Prerequisites
- Volumio 4.x (Bookworm) running on Raspberry Pi
- SSH access enabled

### Install from GitHub (outside plugin store)

If you have a previous version installed, uninstall it first via Volumio UI.

Connect via SSH and run:

```
cd ~
rm -rf pi_screen_setup
git clone --depth=1 https://github.com/foonerd/pi_screen_setup.git
cd pi_screen_setup
volumio plugin install
```

After installation, enable the plugin in Volumio Settings > Plugins > Installed Plugins.

### Update Existing Installation

```
cd ~
rm -rf pi_screen_setup
git clone --depth=1 https://github.com/foonerd/pi_screen_setup.git
cd pi_screen_setup
volumio plugin update
```

## Usage

### Setup Wizard

1. **Step 0 - Detection**: Choose auto-detect or manual configuration
2. **Step 1 - Output Selection**: Select primary display output type
3. **Step 2 - Display Configuration**: Configure resolution/preset and settings
4. **Step 3 - Rotation**: Set display rotation (0/90/180/270 degrees)
5. **Step 4 - KMS Settings**: Configure GPU memory allocation
6. **Step 5 - Advanced**: Additional options and custom parameters
7. **Step 6 - Review**: Confirm settings before applying
8. **Step 7 - Apply**: Write configuration and optionally reboot

### Display Presets

The plugin includes a presets database for common displays. When selecting a preset, the plugin automatically configures:

- hdmi_group and hdmi_mode
- hdmi_timings (raw timing for displays without EDID)
- hdmi_cvt (calculated timing)
- max_framebuffer_height (for tall portrait displays)
- Recommended rotation
- Kernel command line video mode parameter

For displays not in the presets database, use "Custom Timings" to enter manual hdmi_timings or hdmi_cvt values, or add them via the Preset Manager.

### Database Updates

The plugin can automatically fetch the latest display presets database from GitHub:

**Automatic Updates**: When enabled in plugin settings, the database is checked for updates periodically. New presets become available without plugin reinstallation.

**Manual Updates**: Use the Preset Manager at http://volumio.local:4567/ to import updated databases from URL or file.

**OTA Behavior**: Configure how the plugin handles system updates that may overwrite display settings.

### Configuration Files

The plugin manages these files:

- `/boot/videoconfig.txt` - Display configuration (included by config.txt)
- `/boot/config.txt` - Adds include line for videoconfig.txt
- `/boot/cmdline.txt` - Kernel parameters for rotation and video mode

Original files are backed up before modification.

### Backup and Restore

The plugin includes comprehensive backup and restore functionality:

**Factory Backups**
On first installation, the plugin creates factory backups of:
- config.txt
- cmdline.txt
- volumioconfig.txt
- userconfig.txt

These are stored in `/data/plugins/system_hardware/pi_screen_setup/backups/factory/` and are used to restore the original system state.

**Restore Points**
Each time you apply a configuration, a restore point is created containing:
- videoconfig.txt
- config.txt
- cmdline.txt

The last 10 restore points are kept and can be selected from the plugin UI.

**Restore Options**
After completing the wizard, the Edit Configuration section provides:
- **Restore Point dropdown**: Select and restore a previous configuration
- **Restore Factory Defaults**: Reset to the original boot configuration from before plugin installation

**Uninstall Behavior**
When the plugin is uninstalled, it automatically restores the factory defaults, removing all display configuration changes made by the plugin.

## Waveshare Portrait Display Notes

For Waveshare 11.9" and 7.9" HDMI displays (portrait native):

1. Select the appropriate Waveshare preset in Step 2
2. Set rotation to 90 degrees in Step 3 for landscape orientation
3. The plugin will configure:
   - hdmi_timings with correct values
   - max_framebuffer_height (11.9" only)
   - video= parameter with resolution and rotation
   - plymouth= parameter for boot splash rotation

Note: Proper boot splash rotation requires the volumio-adaptive plymouth theme.

## Troubleshooting

### Display not detected
- Enable "Force Hotplug" in HDMI settings
- Try "Ignore EDID" if display reports incorrect capabilities

### No picture after reboot
- Connect via SSH
- Check `/boot/videoconfig.txt` for configuration
- Use plugin UI to restore a previous restore point, or
- Restore factory defaults from plugin UI, or
- Manual restore: `sudo cp /data/plugins/system_hardware/pi_screen_setup/backups/factory/config.txt /boot/config.txt`

### Rotation not working
- Ensure KMS is enabled (required for rotation)
- Check cmdline.txt contains video= and fbcon= parameters
- Some displays require specific rotation values

### Audio issues
- Verify hdmi_drive=2 is set (HDMI mode with audio)
- Check audio output is set to HDMI in Volumio playback settings

### Restoring after failed configuration
If you cannot access the Volumio UI:
1. Connect via SSH
2. Restore factory defaults manually:
```
sudo cp /data/plugins/system_hardware/pi_screen_setup/backups/factory/config.txt /boot/config.txt
sudo cp /data/plugins/system_hardware/pi_screen_setup/backups/factory/cmdline.txt /boot/cmdline.txt
sudo rm /boot/videoconfig.txt
sudo reboot
```

## Technical Details

### KMS Overlay Selection
- Pi 2/3: vc4-kms-v3d
- Pi 4/400/CM4: vc4-kms-v3d-pi4
- Pi 5/500/CM5: vc4-kms-v3d-pi5

### Rotation Implementation
- KMS: video=CONNECTOR:rotate=DEGREES in cmdline.txt
- Framebuffer console: fbcon=rotate:N in cmdline.txt
- Plymouth boot splash: plymouth=DEGREES in cmdline.txt

### Port Suffixes
- HDMI0: No suffix (hdmi_group=2)
- HDMI1: :1 suffix (hdmi_group:1=2)

### Management API
The Preset Manager runs on port 4567 and exposes a REST API for programmatic access. See API.md for full documentation.

## Contributing

Display preset contributions welcome. There are two ways to contribute:

### Via Preset Manager (Recommended)
1. Open http://volumio.local:4567/
2. Add or edit presets using the web interface
3. Test your configuration
4. Use "Export for PR" to generate a properly formatted database file
5. Submit pull request with the exported file

### Manual Method
1. Fork the repository
2. Edit `display_presets.json`
3. Add preset with name, config parameters, and recommended rotation
4. Submit pull request

## License

MIT

## Credits

Developed by Just a Nerd for the Volumio community.
