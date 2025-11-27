# FM/DAB Radio Plugin for Volumio

Receive FM and DAB/DAB+ radio using RTL-SDR USB tuners.

## Hardware Requirements

- RTL-SDR USB dongle (RTL2832U chipset)
- Compatible with R820T, R820T2, R828D, E4000 tuners
- Quality dongles recommended: Nooelec NESDR Smart, RTL-SDR Blog V3/V4
- Cheap generic blue dongles work but may require PPM frequency correction for DAB
- Antenna suitable for FM (88-108 MHz) and/or DAB Band III (174-240 MHz)

## Supported Platforms

- Raspberry Pi (armhf, arm64)
- x86/x64 systems (amd64)
- Volumio 4.x (Bookworm)

## Features

### Radio Reception
- FM radio reception (87.5-108 MHz)
- DAB and DAB+ digital radio
- Automatic station scanning with configurable sensitivity
- Integrated with Volumio's playback system
- Volume control through Volumio
- Real-time signal quality indicator (5-level display)

### Station Management
- Web-based station management interface
- Mark stations as favorites
- Hide unwanted stations
- Custom station naming
- Search and filter stations
- Recycle bin for deleted stations (recoverable)
- Per-row save buttons for quick edits
- Bulk operations (clear all, rescan)

### Multilingual Support
The plugin fully supports internationalization with automatic language detection:
- Plugin settings interface displays in your selected Volumio language
- Web management interface automatically follows Volumio's language setting
- No manual configuration required

**Supported Languages:**
- English
- German (Deutsch)
- Spanish (Espanol)
- French (Francais)
- Italian (Italiano)
- Japanese (日本語)
- Dutch (Nederlands)
- Polish (Polski)
- Portuguese (Portugues)
- Russian (Русский)
- Chinese Simplified (简体中文)

To change language: Settings > Appearance > Language. Both plugin settings and web manager will update automatically.

### Backup and Restore
The plugin includes a comprehensive backup and restore system to protect your station configurations:

**Features:**
- Three backup types: Stations Only, Configuration Only, or Full Backup
- Automatic pruning (keeps 5 most recent backups per type)
- Download backups as ZIP files
- Upload and restore external backups
- Mix-and-match restore (stations from one backup, config from another)
- Optional auto-backup before plugin uninstall
- Backup history with timestamps and sizes

**Location:**
- Access via Maintenance tab in web station manager
- Backups stored in: `/data/rtlsdr_radio_backups/`

**Usage:**
1. Open web station manager (see Web Interface Access below)
2. Click "Maintenance" tab
3. Select backup type and click "Create Backup Now"
4. Download backups or restore from history table

**Auto-Backup:**
Enable "Automatic backup before uninstall" checkbox to automatically create a full backup when uninstalling the plugin. Backups are preserved even after uninstall.

### Antenna Positioning Tools
The plugin includes professional-grade tools for optimizing antenna placement and orientation:

**Tool 1: RF Spectrum Scan**
- Full-band spectrum analysis (87.5 MHz to 240 MHz)
- 2-second scan covering FM and DAB frequencies
- Visual signal strength display across entire spectrum
- Identify which frequencies have strong signals in your location
- Real-time feedback for antenna orientation adjustments

**Tool 2: DAB Channel Validation**
- Validate specific DAB channels for signal presence
- Progressive results via Server-Sent Events (displays results as each channel completes)
- Per-channel sync status and service count
- Quality assessment (excellent vs no signal)
- Typical validation time: 10-15 seconds per channel with signal, 2-3 seconds for no signal

**When to Use:**
- Before initial full scan to verify antenna reception
- Antenna positioning and orientation (rotating/tilting for best signal)
- Diagnosing reception problems
- Comparing antenna locations
- Verifying dongle functionality

**How to Use:**
1. Open web station manager (see Web Interface Access below)
2. Click "Antenna Positioning" tab
3. Tool 1: Click "Start Spectrum Scan" for full-band analysis
4. Tool 2: Select channels to validate, click "Validate Selected Channels"
5. View progressive results in real-time
6. Adjust antenna and re-test until optimal signal achieved

**Workflow Guide:**
1. Start with RF Spectrum Scan to see available frequencies
2. Use DAB Channel Validation to test specific channels
3. Adjust antenna position/orientation between tests
4. Repeat until signal strength is optimal
5. Perform full station scan once antenna is positioned

**Technical Details:**
- Spectrum scan uses fn-rtl_power for wide-band analysis
- Channel validation uses custom fn-dab-scanner binaries
- Progressive SSE streaming prevents long waits
- Three critical bugs fixed in v1.0.8 for accurate validation
- No signal channels terminate in 2-3 seconds (no timeout)
- Strong signal channels complete in 10-15 seconds

### Diagnostics Tools
The plugin includes diagnostic tools to test your USB dongle before scanning:

- **Purpose**: Verify your dongle can receive specific frequencies
- **When to use**: Station won't play, weak signal, testing new dongle
- **How**: Enter a known strong station, save settings, click test
- **Expected result**: You should hear audio

**Understanding Gain Settings**:
- Gain controls the RTL-SDR RF amplifier, affecting signal-to-noise ratio and overload threshold
- **NESDR Smart dongles**: Start with gain 20 (better amplifiers, prevent overload)
- **Generic RTL-SDR**: Start with gain 80 (needs higher amplification)
- Adjust if: distorted (lower gain) or no signal (higher gain)
- Note: This is RF amplification, not volume control

**Understanding PPM Correction** (DAB only):
- PPM corrects frequency error from cheap crystal oscillators
- **Quality dongles** (Nooelec, RTL-SDR Blog V3/V4): Use PPM=0
- **Cheap blue dongles**: Typically need PPM 40-60 (varies per dongle)
- If DAB scan finds no stations, try PPM values from -100 to +100 in steps of 10
- Each dongle has its own specific PPM value due to manufacturing variance
- FM reception is more tolerant and usually works without PPM correction

**DAB Metadata (DLS)**:
The plugin automatically extracts now-playing information from DAB broadcasts:
- **DLS (Dynamic Label Segment)**: Text metadata broadcast by DAB stations
- **Artist/Title Parsing**: Automatically parses "Artist - Title" format
- **Volumio Integration**: Pushes metadata so Volumio can fetch album artwork via MusicBrainz

When playing a DAB station, you may see:
- Station name in the title field
- Artist name from DLS
- Track title from DLS
- Album artwork fetched automatically by Volumio

Note: Not all stations broadcast DLS metadata, and formats vary by broadcaster.

**Technical Service Names**:
DAB stations use technical identifiers that may differ from display names:
- Example: Enter "BBC Radio1" (no space) for the station branded as "BBC Radio 1" (with space)
- These are broadcast identifiers from the DAB ensemble
- Must match exactly as transmitted

**Default Test Values (UK/London)**:
- FM: 94.9 MHz (BBC Radio London)
- DAB Ensemble: 12B
- DAB Service: BBC Radio1
- Test Gain: 20 (NESDR Smart)

### Web Interface Access
The station management interface is accessible through the plugin settings:
- Navigate to: Settings > Plugins > Installed Plugins > FM/DAB Radio
- Click "Open in New Tab" or "Open in Current Window"
- Direct access: `http://<volumio-ip>:3456`

## Installation

1. Install plugin through Volumio plugin store
2. Connect RTL-SDR USB dongle
3. Enable plugin in Volumio settings
4. Scan for available stations
5. Browse and play stations from "FM/DAB Radio" source

## Usage

### Plugin Settings Organization (v1.0.0+)
The plugin settings are organized for quick access:
1. **Radio Station Management** - First section, open by default with immediate access to station manager
2. **Radio Station Management Configuration** - Advanced settings (hostname override)
3. **FM Radio** - FM configuration (expand to see settings)
4. **DAB/DAB+ Radio** - DAB configuration (expand to see settings)
5. **Diagnostics** - Testing tools for your USB dongle

### Playing Stations
1. Navigate to "Music Library" in Volumio
2. Select "FM/DAB Radio" source
3. Browse available stations
4. Click to play

### Managing Stations
1. Open plugin settings: Settings > Plugins > Installed Plugins > FM/DAB Radio
2. Click "Open in New Tab" or "Open in Current Window" in the Station Management section
3. Use the web interface to:
   - Mark favorites (star icon)
   - Hide stations (eye icon)
   - Delete stations (trash icon)
   - Rename stations (edit name field)
   - Search for stations
   - Rescan for new stations

### Testing Your Dongle
1. Open plugin settings
2. Expand "Diagnostics" section (if collapsed)
3. Enable "Show Diagnostics"
3. Enter test values (defaults provided for UK/London)
4. Click "Save Test Settings"
5. Click test button (FM or DAB)
6. Adjust gain if needed based on audio quality

### Save Options
Three ways to save changes:
- Click green save button on individual changed rows
- Click "Save (n)" button at top (saves all changes)
- Use save bar at bottom (saves all changes)

## Development

Prototype repository: https://github.com/foonerd/volumio-plugins-sources-bookworm
Target repository: https://github.com/volumio/volumio-plugins-sources-bookworm

## Architecture

- Uses ALSA loopback for lightweight audio routing
- Minimal CPU overhead (suitable for Pi Zero W2)
- Direct PCM passthrough for FM (no encoding/decoding)
- Sox resampling for DAB (handles variable sample rates: 32kHz, 48kHz)
- Integrated with Volumio's music_service framework
- Web management interface on port 3456
- Station data stored in JSON format
- DAB decoding via dab-cmdline (https://github.com/JvanKatwijk/dab-cmdline/tree/master/example-3)

## Troubleshooting

### Plugin won't enable
- Check RTL-SDR dongle is connected
- Verify dongle is detected: `lsusb | grep RTL`

### No stations found
- Check antenna is connected
- Try adjusting scan sensitivity in settings
- Ensure good signal reception (location dependent)
- Use diagnostics tools to test reception first

### Test buttons require save
- Test buttons read saved configuration values, not current inputs
- Always click "Save" before testing
- This ensures consistent test conditions

### Web interface not accessible
- Verify port 3456 is not blocked by firewall
- Check plugin is enabled
- Try accessing via hostname: `http://volumio.local:3456`

## License

GPL-3.0

## Author

Just a Nerd

## Version History

### v1.2.5 (Current)
- Added real-time signal quality indicator for FM and DAB
- Signal strength displayed in Volumio playback screen (5-level indicator)
- Signal quality shown in station manager for currently playing station
- Color-coded Font Awesome signal icon (red/orange/yellow/green based on level)
- Currently playing station highlighted with green border in station manager
- FM signal quality derived from RDS block error rate (BLER)
- DAB signal quality derived from FIB quality and AAC decode success rate
- Updated fn-dab binaries with signal quality callbacks

### v1.2.2
- Added DAB DLS metadata extraction (artist/title from broadcast)
- Volumio now fetches album artwork via MusicBrainz for DAB stations
- Improved state management for DAB playback with customName priority
- DLS text parsed for common formats: "Artist - Title", "Title by Artist"

### v1.2.1
- Added PPM (frequency correction) setting for DAB reception
- Resolves DAB reception issues with cheap RTL-SDR dongles that have inaccurate crystal oscillators
- Quality dongles (Nooelec NESDR, RTL-SDR Blog V3/V4) work at PPM=0
- Cheap generic blue dongles typically need PPM 40-60
- PPM setting available in both DAB Radio section and Diagnostics for testing
- DAB channel validation now uses configured gain (was hardcoded to 80)
- Added tuner type detection and logging in fn-dab binaries
- Fixed bug in rtlsdr-handler checking wrong variable for V4 dongle support
- Added missing TRAFFIC_ALERT translations for 10 languages

### v1.2.0
- Major rewrite of DAB audio pipeline with dynamic sample rate detection
- Automatic PCM format detection from fn-dab stderr output
- Sox-based resampling handles 32kHz/48kHz DAB streams transparently
- Consolidated timeout constants for easier maintenance
- Fixed race conditions in station switching
- 600ms hardware cleanup delay prevents device conflicts
- RDS metadata display for FM stations via fn-redsea
- Complete 11-language internationalization

### v1.0.9
- Added Antenna Positioning Tools
- RF Spectrum Scan: Full-band signal visualization (87.5-240 MHz, 2-second scan)
- DAB Channel Validation: Progressive SSE streaming, per-channel sync and service count
- Fixed three critical DAB scanner bugs:
  - Service count detection (PTY wrapper filtering for PCM-only output)
  - Completion timeout (immediate scanner kill on completion marker)
  - No-signal channel overshoot (immediate kill on channel switch detection)
- Typical validation times: 10-15s with signal, 2-3s no signal (no 30s timeouts)
- Translation concept corrected across 11 languages: "positioning" (antenna orientation for signal) not "alignment" (physical leveling)
- Complete antenna positioning tab translation coverage (49 UI elements)
- All 11 language files validated: 366 keys each, no duplicates, valid JSON
- Comprehensive DAB channel validation workflow guidance

### v1.0.7
- Added comprehensive backup and restore system
- Three backup types: Stations Only, Configuration Only, Full Backup
- Automatic backup pruning (keeps 5 most recent per type)
- ZIP export/import functionality
- Upload and validate external backups with preview
- Mix-and-match restore capability
- Optional auto-backup before plugin uninstall
- Backup history table with download/delete actions
- Fully internationalized (11 languages)

### v1.0.6
- Added sox resampling pipeline for DAB playback with automatic PCM format detection
- Handles variable DAB sample rates (32kHz, 48kHz) transparently
- Added EPIPE error handling for robust process pipeline management
- Fixed station switching regression

### v1.0.0
- Production release - beta testing complete
- Eliminated restart requirement after installation
- Streamlined install process removes obsolete reboot warnings
- DVB-T kernel module management fully automated during install
- Ready for public release

### v0.9.8
- UI reorganization: Station manager now appears first in plugin settings
- Station manager section open by default for immediate access
- FM/DAB configuration sections collapsed by default for cleaner presentation
- Clearer toggle labels: "Show" instead of "Enable"
- Simplified installation (no Volumio core file modification)
- Two access methods for station manager (via plugin settings)

#### Language support
- Full multilingual support: 11 languages fully translated
- Plugin settings UI now uses Volumio's standard translation system
- Web manager automatically detects Volumio's language setting via API
- Both plugin settings and web interface respect user's language choice
- No manual configuration required for language selection

### v0.9.7
- Clarified test button requirements with clear warning messages
- Improved default values (UK/London optimized)
- Enhanced documentation for technical service names vs display names
- Added comprehensive RF gain explanation
- Better diagnostics guidance for troubleshooting

### v0.9.6
- Fixed message element rendering in UI
- Changed from 'message' to 'section' elements with 'description' field

### v0.9.2
- Defense-in-depth save strategy
- Per-row save buttons
- Improved user feedback
- CSS specificity fixes
