# ES9018K2M DAC Control Plugin for Volumio

Hardware control plugin for ES9018K2M-based DAC HATs on Raspberry Pi running Volumio 4.

## Features

- **Hardware Volume Mode** - Enables volume slider even with Mixer Type: None
- **Safe Startup Volume** - Caps volume on startup to protect speakers
- **Start Muted** - Begin playback muted for safe system startup
- **Remember Last Volume** - Restore previous volume level on restart
- **Graceful Volume Ramping** - Smooth fade in/out eliminates audible pops and clicks
- **Pop-Free Seeks** - Pre-emptive mute prevents audio discontinuities
- **Digital Filters** - FIR/IIR filter selection
- **DPLL Jitter Reduction** - Configurable for I2S and DSD sources
- **Channel Balance** - Fine-tune left/right balance

## Supported Hardware

- Aoide DAC II
- Audiophonics I-SABRE ES9018K2M
- TeraDAK ES9018K2M
- Other generic ES9018K2M I2S DAC boards

## Quick Start

### 1. Configure Volumio Audio Output

1. Go to **Volumio Settings > Playback Options**
2. Enable **I2S DAC** and select **R-PI DAC** as DAC Model
3. Under **Volume Options**, set **Mixer Type** to **None**
4. Click **Save** and **Reboot**

### 2. Install the Plugin

```bash
git clone --depth=1 https://github.com/foonerd/es9018k2m-plugin.git
cd es9018k2m-plugin
volumio plugin install
```

### 3. Enable the Plugin

1. Go to **Volumio Settings > Plugins > Installed Plugins**
2. Enable **ES9018K2M DAC Control**

## Common Tasks

### Get Volume Slider Working

If you don't see a volume slider:

1. Open plugin settings
2. Ensure **Use External Volume Device** is Off
3. Set **Volume Mode** to "Hardware (Override)"
4. Save - slider should appear immediately

### Protect Speakers on Startup

When using Hardware mode with amp that powers on at full volume:

**Option 1: Start Muted**
- Enable **Start Muted** in Volume Control section
- DAC starts muted, use volume slider to unmute
- If **Remember Last Volume** also enabled, slider shows remembered level

**Option 2: Safe Startup Volume**
- Enable **Safe Startup Volume**
- Set **Safe Startup Level** (e.g. 25%)
- Volume capped to this level if system volume exceeds it

**Option 3: Remember Last Volume**
- Enable **Remember Last Volume**
- Restores your last volume setting on restart
- Overrides safe startup if enabled

### Stop Pops and Clicks

**During seeks:**
- Increase **Seek Mute Duration** to 200-300ms

**During play/pause:**
- Enable **Graceful Play/Pause/Stop**
- Increase **Graceful Ramp Steps** to 4 or 5

**During volume changes:**
- Enable **Graceful Volume Changes**

### Adjust Sound Signature

- **FIR Filter**: Try "Minimum Phase" for less pre-ringing
- **DPLL**: Higher values = more jitter reduction (start with 5 for I2S)

### Use with External Volume Control

For setups with Allo Relay Attenuator, external pre-amp, or receiver:

1. Open plugin settings
2. Enable **Use External Volume Device** toggle
3. Save settings

With External Volume Device enabled:
- External device handles all volume control
- Plugin manages DAC features only (filters, DPLL, balance)
- Seek mute and graceful transitions still work
- No volume slider conflicts between plugins

## Configuration Reference

### Volume Control (Hardware Mode)

| Setting | Default | Description |
|---------|---------|-------------|
| Use External Volume Device | Off | Enable if external device controls volume (Allo Relay Attenuator, pre-amp, receiver) |
| Volume Mode | Hardware | Hardware: plugin controls volume (recommended). Software: Volumio mixer controls volume |
| ALSA Card Number | auto | Manual override for multi-card setups |
| Start Muted | Off | Start DAC muted on plugin load |
| Safe Startup Volume | Off | Cap volume on startup if exceeds safe level |
| Safe Startup Level | 25% | Maximum startup volume when safe startup enabled |
| Remember Last Volume | Off | Restore last volume on plugin start (overrides safe startup) |

### Mute & Transitions

| Setting | Default | Description |
|---------|---------|-------------|
| Seek Mute Duration | 150ms | Time to mute during seeks (0 to disable) |
| Graceful Ramp Steps | 3 | Steps for volume fade (1-5, more = smoother) |
| Graceful Play/Pause/Stop | On | Fade on playback state changes |
| Graceful Volume Changes | On | Fade on volume adjustments >5% |

### Device Detection

| Setting | Default | Description |
|---------|---------|-------------|
| I2C Bus | 1 | Usually 1 for Raspberry Pi |
| I2C Address | 0x48 | Try 0x49, 0x4A, 0x4B if not detected |
| Debug Logging | Off | Enable verbose logging for troubleshooting |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No volume slider | Disable External Volume Device, set Volume Mode to "Hardware (Override)" |
| Device not detected | Check I2C address, verify R-PI DAC selected in Playback Options |
| Pops during seek | Increase Seek Mute Duration |
| Pops on play/pause | Enable Graceful Play/Pause/Stop, increase steps |
| Pops on volume change | Enable Graceful Volume Changes |
| Slider jumps back | Enable Debug Logging, check journalctl for errors |
| Volume too loud on startup | Enable Safe Startup Volume or Start Muted |

## Technical Details

For architecture, register configuration, and implementation details, see [TECHNICAL.md](TECHNICAL.md).

## Changelog

### v1.2.5
- External Volume Device toggle for Allo Relay Attenuator, pre-amps, receivers
- UI restructure with dynamic field visibility (no page refresh needed)
- Fixed volume persistence - startup no longer corrupts saved volume
- Volume Mode simplified to Hardware/Software (external moved to toggle)
- UI refresh after save via broadcastMessage

### v1.2.4
- Hardware volume mode as default (recommended for most users)
- Updated prerequisites to include Mixer Type: None setting

### v1.2.3
- Fixed startup volume timing with VOLUMIO_SYSTEM_STATUS polling
- Added config.save() for reliable volume persistence across reboots
- Start muted now respects remember last volume for slider position
- Dynamic UI with visibleIf (no page refresh needed)

### v1.2.2
- Safe startup volume (caps volume on start)
- Start muted option
- Remember last volume
- UI redesign with Device Detection, Volume Control, Mute & Transitions sections

### v1.2.1
- Hardware Volume Override mode
- Graceful volume ramping for all transitions
- Configurable ramp steps (1-5)
- Auto-detect or manual ALSA card selection

### v1.2.0
- Event-driven architecture with socket.io
- Pre-emptive seek mute via commandRouter intercept

### v1.1.1
- Fixed chip ID detection
- Fixed volume range (0-49.5dB)

## Credits

This plugin builds upon work and contributions from:

- **Audiophonics** - Serial sync reference implementation
  https://github.com/audiophonics/ES9018K2M_serial_sync

- **Chris Song** - Original volumio-es9018k2m-plugin concept
  https://github.com/ChrisPanda/volumio-es9018k2m-plugin

- **Darmur** - ES9038Q2M optimal register configuration
  https://github.com/Darmur

- **Grey_bird (DanyHovard)** - I2C control implementation
  https://github.com/DanyHovard/es9018k2m_volumio_I2C_control

- **luoyi** - Rpi-ES9018K2M-DAC kernel driver reference
  https://github.com/luoyi/Rpi-ES9018K2M-DAC

## License

MIT License
