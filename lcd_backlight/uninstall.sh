#!/bin/bash

echo "Uninstalling LCD Backlight Control plugin..."

# Stop the service (restores full backlight brightness) and remove boot autostart, if any
echo "Stopping service..."
systemctl stop lcd_backlight.service 2>/dev/null || true
systemctl disable lcd_backlight.service 2>/dev/null || true

# Remove the service file and the script symlink (not the files in the plugin folder - Volumio removes that folder itself)
echo "Removing systemd service file and Python script symlink..."
rm -f /etc/systemd/system/lcd_backlight.service
rm -f /usr/local/bin/backlight_control.py

systemctl daemon-reload
systemctl reset-failed lcd_backlight.service 2>/dev/null || true

# Remove runtime configuration directory
echo "Removing config directory /etc/lcd_backlight..."
rm -rf /etc/lcd_backlight

echo "Uninstallation complete!"
echo "pluginuninstallend"
