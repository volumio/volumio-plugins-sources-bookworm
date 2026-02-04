# Raspberry Pi EEPROM Configuration Plugin

Volumio plugin for configuring Raspberry Pi bootloader EEPROM parameters.

## Features

- Configure boot order with presets or custom priority
- Power management settings
- **RTC battery charging** (Pi 5 / 500 / 500+ / CM5): enable charging of the onboard RTC backup battery; stored in `userconfig.txt` (survives OTA updates)
- USB configuration and timeouts
- Serial console debugging
- Network console debugging (advanced)
- HDMI diagnostics control
- Automatic backup before changes
- Restore from backup or factory defaults

## Supported Hardware

- Raspberry Pi 4 Model B
- Raspberry Pi 400
- Raspberry Pi 500 and 500+
- Raspberry Pi 5
- Compute Module 4 and 5

## Installation

Install via Volumio Plugin Manager or manually from the plugin repository.

## Usage

1. Navigate to Settings > Raspberry Pi EEPROM Configuration
2. Acknowledge the risk warning
3. Configure desired parameters
4. Click "Save Configuration and Reboot"
5. System will automatically reboot after 5 seconds

## Boot Order Presets

- **SD Card Priority**: Tries SD first, then USB, then NVMe
- **USB Priority**: Tries USB first, then SD, then NVMe
- **NVMe Priority**: Tries NVMe first, then USB, then SD
- **Custom**: Configure individual boot positions

## Safety Features

- Automatic backup before configuration changes
- Risk acknowledgment required
- Single latest backup maintained
- Factory defaults restore option

## Important Notes

- Always ensure stable power during configuration
- System will automatically reboot after saving
- Changes take effect after reboot
- Keep bootloader firmware up to date
- **RTC battery charging** is stored in `/boot/userconfig.txt` so it survives OTA updates; `config.txt` and `volumioconfig.txt` are overwritten on OTA.

## Author

Just a Nerd  
https://github.com/foonerd/

## License

MIT
