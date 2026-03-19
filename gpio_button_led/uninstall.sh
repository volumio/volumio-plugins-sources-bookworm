#!/bin/bash

echo "Uninstalling GPIO Power Button plugin"

# Remove gpio-shutdown overlay from userconfig.txt if present
if [ -f /boot/userconfig.txt ]; then
    sed -i '/^dtoverlay=gpio-shutdown/d' /boot/userconfig.txt
    echo "Removed gpio-shutdown overlay from /boot/userconfig.txt"
fi

echo "pluginuninstallend"
