#!/bin/bash

echo "Uninstalling Raspberry Pi EEPROM Configuration Manager Plugin"

# Remove sudoers entry
if [ -f /etc/sudoers.d/010_rpi-eeprom-config ]; then
    echo "Removing sudoers entry..."
    rm -f /etc/sudoers.d/010_rpi-eeprom-config
    if [ $? -eq 0 ]; then
        echo "Sudoers entry removed successfully"
    else
        echo "Warning: Failed to remove sudoers entry"
    fi
fi

# Note: We do NOT remove the rpi-eeprom package as it may be used by other plugins
# or the system itself. Users can manually remove it if desired.

# Note: We do NOT remove plugin data directory or backups as users may want to
# preserve their backup configurations. Volumio will handle cleanup if needed.

echo "Raspberry Pi EEPROM Configuration Manager Plugin uninstalled successfully"
echo "Note: Plugin data and backups have been preserved in /data/configuration/"
echo "Note: rpi-eeprom package has been left installed for system use"
echo "pluginuninstallend"
