#!/bin/bash

echo "Uninstalling Raspberry Pi EEPROM Updater Plugin"

# Remove any pending update files if they exist
if [ -f /boot/firmware/recovery.bin ]; then
    rm -f /boot/firmware/recovery.bin
    rm -f /boot/firmware/pieeprom.upd
    rm -f /boot/firmware/pieeprom.sig
    rm -f /boot/firmware/vl805.bin
    rm -f /boot/firmware/vl805.sig
    echo "Removed pending EEPROM update files"
fi

# Remove sudoers entry
if [ -f /etc/sudoers.d/010_rpi-eeprom-updater ]; then
    rm -f /etc/sudoers.d/010_rpi-eeprom-updater
    echo "Removed sudoers entry"
fi

echo "Raspberry Pi EEPROM Updater Plugin uninstalled"
echo "pluginuninstallend"
