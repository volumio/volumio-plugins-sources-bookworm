# Allo Relay Attenuator Plugin

Hardware volume control using Allo Relay Attenuator with 64-step relay-switched attenuation.

## Features

- 64-step relay-based volume attenuation (0-63)
- Hardware button support via J10 header
- IR remote control support (optional)
- Volumio integration with hardware volume override
- Proper UI sync for I2S-only DACs

## Volume Control Modes

The plugin supports two volume control modes:

### Hardware Mode (Default, Recommended)

Uses Volumio's `setDeviceVolumeOverride` API to provide direct volume control. This mode:
- Bypasses Volumio's buggy Software mixer path for I2S-only DACs
- Properly syncs hardware volume with UI (including physical button changes)
- Works correctly with DACs like ES9023, PCM5102A, ES9018K2M that lack hardware mixers

### Software Mode (Legacy)

Uses Volumio's external volume scripts. This mode:
- May have UI desync issues with I2S-only DACs
- Provided for backward compatibility
- May work better if/when Volumio fixes the core volume retrieval bug

## Hardware Buttons (J10 Header)

| Pin | Function    |
|-----|-------------|
| 1   | Volume Up   |
| 2   | Volume Down |
| 3   | Play/Pause  |
| 4   | Mute        |
| 5   | GND         |

Buttons active low - connect momentary switch between signal pin and GND.

## Requirements

- Volumio 4.x (Bookworm)
- Raspberry Pi with I2C enabled
- Allo Relay Attenuator board

## I2C Addresses

- 0x20: Button switch (PCF8574)
- 0x21: Relay attenuator

## Version History

### 4.0.2
- Add Hardware Volume Mode (default) - fixes UI desync with I2S-only DACs
- Uses Volumio's setDeviceVolumeOverride for direct volume control
- Software mode retained as fallback option
- Physical button changes now properly reflected in UI

### 4.0.1
- Fixed Remember Last volume persistence across plugin and system lifecycle

### 4.0.0
- Complete rewrite for Volumio 4.x (Bookworm)
- Uses lgpio instead of deprecated WiringPi
- Polling-based button detection (no GPIO interrupt required)
- Play/pause button calls volumio toggle command

## Technical Details

### Why Hardware Mode?

Volumio's `retrievevolume()` function in `volumecontrol.js` has a bug affecting I2S-only DACs:
- When `mixertype === 'Software'`, it reads SoftMaster directly via amixer
- This returns 100% (passthrough value) instead of calling external volume scripts
- Result: UI shows 100% while hardware is at different level

Hardware mode registers the plugin as a volume override handler, bypassing this code path entirely.

### Volume Override API

```javascript
self.commandRouter.executeOnPlugin(
  'audio_interface',
  'alsa_controller',
  'setDeviceVolumeOverride',
  {
    card: cardNumber,
    pluginType: 'system_hardware',
    pluginName: 'allo_relay_attenuator',
    overrideMixerType: 'Hardware',
    overrideAvoidSoftwareMixer: true
  }
);
```

When registered, Volumio routes volume calls to the plugin's `alsavolume()` and `retrievevolume()` methods.

## Documentation

Local documentation included in docs/ folder:
- Relay-Attenuator-User-Manual.pdf - Setup and usage guide
- Relay-Attenuator-Tech-Manual.pdf - Hardware specifications and pinouts
- HARDWARE.md - Quick reference for software development

## License

GPL-3.0
