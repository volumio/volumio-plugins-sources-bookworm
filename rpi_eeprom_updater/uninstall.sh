#!/bin/bash

echo "Uninstalling Raspberry Pi EEPROM Updater Plugin"

# Remove any pending update files if they exist
if [ -f /boot/firmware/recovery.bin ]; then
    echo "Removing pending EEPROM update files..."
    rm -f /boot/firmware/recovery.bin
    rm -f /boot/firmware/pieeprom.upd
    rm -f /boot/firmware/pieeprom.sig
    rm -f /boot/firmware/vl805.bin
    rm -f /boot/firmware/vl805.sig
    if [ $? -eq 0 ]; then
        echo "Removed pending EEPROM update files"
    else
        echo "Warning: Failed to remove some update files"
    fi
fi

# Remove sudoers entry
if [ -f /etc/sudoers.d/volumio-user-rpi_updater ]; then
    echo "Removing sudoers entry..."
    rm -f /etc/sudoers.d/volumio-user-rpi_updater
    if [ $? -eq 0 ]; then
        echo "Sudoers entry removed successfully"
    else
        echo "Warning: Failed to remove sudoers entry"
    fi
fi

# Note: We do NOT remove the rpi-eeprom package as it may be used by other plugins
# or the system itself. Users can manually remove it if desired.
# Unmask rpi-eeprom-update service to restore normal behavior
if systemctl list-unit-files | grep -q "rpi-eeprom-update.service"; then
    echo "Unmasking rpi-eeprom-update service..."
    systemctl unmask rpi-eeprom-update.service
    echo "Service unmasked - system can manage updates normally"
fi

# Note: We do NOT remove the rpi-eeprom package as it may be used by other plugins
# or the system itself. Users can manually remove it if desired.

echo "Raspberry Pi EEPROM Updater Plugin uninstalled successfully"
echo "Note: rpi-eeprom package has been left installed for system use"
echo "pluginuninstallend"
