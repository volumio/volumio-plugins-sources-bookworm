# Raspberry Pi EEPROM Firmware Updater

Volumio plugin for managing Raspberry Pi bootloader EEPROM firmware updates.

## Features

- Automatic detection of Raspberry Pi hardware with EEPROM support
- Display current bootloader version and installation date
- Switch between firmware release channels (default, latest)
- Compare current version with available versions
- One-click firmware upgrade
- Automatic system reboot after successful update
- Multi-language support (i18n ready)

## Supported Hardware

- Raspberry Pi 4 Model B
- Raspberry Pi 400
- Raspberry Pi 500
- Raspberry Pi 5
- Raspberry Pi Compute Module 4
- Raspberry Pi Compute Module 5

## Installation

Install via Volumio Plugin Manager:

1. Navigate to Settings > Plugins
2. Search for "Raspberry Pi EEPROM Firmware Updater"
3. Click Install
4. Enable the plugin after installation completes

## Usage

1. Navigate to Settings > Raspberry Pi EEPROM Firmware Updater
2. View your current bootloader version
3. Select desired firmware channel (default or latest)
4. Click "Save Channel" to switch channels
5. If an update is available, click "Update Firmware Now"
6. System will automatically reboot after 5 seconds

## Firmware Channels

- **default**: Stable releases recommended for most users
- **latest**: New features, bug fixes, and improvements

## Safety Notes

- **Do not power off** the system during firmware update
- Updates require a system reboot to take effect
- Current bootloader configuration is preserved during updates
- A backup of the configuration is stored before updating

## Downgrading

For bootloader downgrades, please refer to official Raspberry Pi documentation:
https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#raspberry-pi-4-boot-eeprom

## Author

Just a Nerd
https://github.com/foonerd/

## License

MIT

## Repository

https://github.com/volumio/volumio-plugins-sources-bookworm/tree/master/rpi_eeprom_updater
