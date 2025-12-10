#!/bin/bash

echo "Uninstalling LCD Backlight Control plugin..."

# Stop and disable service
echo "Stopping service..."
sudo systemctl stop lcd_backlight.service
sudo systemctl disable lcd_backlight.service

# Remove service file
echo "Removing systemd service..."
sudo rm -f /etc/systemd/system/lcd_backlight.service

# Remove Python script
echo "Removing Python script..."
sudo rm -f /usr/local/bin/backlight_control.py

# Reload systemd
echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

# Remove config files from sysfs (optional - they don't hurt if left)
# Find backlight path
BACKLIGHT_PATH=$(ls -d /sys/class/backlight/* 2>/dev/null | head -n1)
if [ -n "$BACKLIGHT_PATH" ]; then
    echo "Removing config files from $BACKLIGHT_PATH..."
    sudo rm -f "$BACKLIGHT_PATH"/lcd_* 2>/dev/null || true
fi

# Remove config files
echo "Removing systemd service..."
sudo rm -f /etc/lcd_backlight


echo "Uninstallation complete!"
echo "pluginuninstallend"
