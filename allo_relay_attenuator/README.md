# Allo Relay Attenuator Plugin

Hardware volume control using Allo Relay Attenuator with 64-step relay-switched attenuation.

## Features

- 64-step relay-based volume attenuation (0-63)
- Hardware button support via J10 header
- IR remote control support (optional)
- Volumio integration with hardware volume scripts

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

### 4.0.0
- Complete rewrite for Volumio 4.x (Bookworm)
- Uses lgpio instead of deprecated WiringPi
- Polling-based button detection (no GPIO interrupt required)
- Play/pause button calls volumio toggle command

## Documentation

Local documentation included in docs/ folder:
- Relay-Attenuator-User-Manual.pdf - Setup and usage guide
- Relay-Attenuator-Tech-Manual.pdf - Hardware specifications and pinouts
- HARDWARE.md - Quick reference for software development

## License

GPL-3.0
