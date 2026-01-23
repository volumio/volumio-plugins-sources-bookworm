#!/bin/bash

echo "Installing GPIO Buttons plugin"

# Compatibility with Volumio 4 config files due to directory rename
if [ -f /data/configuration/system_controller/gpio-buttons/config.json ]; then
    echo "Migrating config from system_controller to system_hardware"
    mv /data/configuration/system_controller/gpio-buttons /data/configuration/system_hardware/gpio-buttons
fi

echo "plugininstallend"
