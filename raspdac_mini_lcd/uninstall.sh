#!/bin/bash

# RaspDacMini LCD Plugin Uninstallation Script

echo "Uninstalling RaspDacMini LCD plugin..."

# Get plugin directory
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Stopping and disabling service..."

# Stop service if running
systemctl stop rdmlcd.service 2>/dev/null

if [ $? -eq 0 ]; then
    echo "Service stopped"
else
    echo "Service was not running"
fi

# Disable service
systemctl disable rdmlcd.service 2>/dev/null

if [ $? -eq 0 ]; then
    echo "Service disabled"
else
    echo "Service was not enabled"
fi

echo "Removing service files..."

# Remove service file
if [ -f /etc/systemd/system/rdmlcd.service ]; then
    rm -f /etc/systemd/system/rdmlcd.service
    echo "Service file removed"
else
    echo "Service file not found"
fi

# Remove service override directory
if [ -d /etc/systemd/system/rdmlcd.service.d ]; then
    rm -rf /etc/systemd/system/rdmlcd.service.d
    echo "Service override directory removed"
else
    echo "Service override directory not found"
fi

# Reload systemd
systemctl daemon-reload

echo "Removing boot configuration..."

# Remove dtoverlay line from /boot/userconfig.txt
if [ -f /boot/userconfig.txt ]; then
    # Create backup
    cp /boot/userconfig.txt /boot/userconfig.txt.backup
    
    # Remove RaspDacMini LCD lines
    sed -i '/# RaspDacMini LCD Display/d' /boot/userconfig.txt
    sed -i '/dtoverlay=raspdac-mini-lcd/d' /boot/userconfig.txt
    
    # Remove GPIO IR line if it was added (optional, commented by default)
    # sed -i '/dtoverlay=gpio-ir,gpio_pin=4/d' /boot/userconfig.txt
    
    echo "Boot configuration cleaned"
else
    echo "Boot configuration file not found"
fi

# Note: We intentionally leave the dtoverlay file in /boot/overlays/
# Users may want to use it manually or it may be shared with other plugins
# Uncomment the following line if you want to remove it:
# rm -f /boot/overlays/raspdac-mini-lcd.dtbo

echo "Cleaning up temporary files..."

# Remove installation lock file if it exists
if [ -f /home/volumio/raspdac_mini_lcd.installing ]; then
    rm -f /home/volumio/raspdac_mini_lcd.installing
    echo "Lock file removed"
fi

echo ""
echo "=========================================="
echo "RaspDacMini LCD Plugin Uninstallation Complete"
echo "=========================================="
echo ""
echo "IMPORTANT: A reboot is recommended to fully remove the device tree overlay."
echo ""
echo "The following items were preserved:"
echo "  - Device tree overlay file (/boot/overlays/raspdac-mini-lcd.dtbo)"
echo "  - Compositor npm packages (in plugin directory)"
echo ""
echo "To manually clean these if desired:"
echo "  - sudo rm /boot/overlays/raspdac-mini-lcd.dtbo"
echo "  - rm -rf $PLUGIN_DIR/compositor/node_modules"
echo ""

echo "pluginuninstallend"

