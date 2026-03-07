#!/bin/bash

echo "Uninstalling LCD Backlight Control plugin..."

# Ensure script is run as root (typical for Volumio plugin uninstall)
if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root. Use 'sudo $0'"
    exit 1
fi

# Stop and disable service
echo "Stopping and disabling service..."
systemctl stop lcd_backlight.service 2>/dev/null || true
systemctl disable lcd_backlight.service 2>/dev/null || true

# Remove systemd service SYMLINK (not the source file in plugin folder!)
echo "Removing systemd service symlink..."
rm -f /etc/systemd/system/lcd_backlight.service

# Remove Python script SYMLINK (not the source file in plugin folder!)
echo "Removing Python script symlink..."
rm -f /usr/local/bin/backlight_control.py

# Reload systemd and clean up
echo "Reloading systemd daemon..."
systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

# Remove any leftover config files from sysfs (created by the Python script)
echo "Removing plugin config files from sysfs (if any exist)..."
if ls -d /sys/class/backlight/*/ >/dev/null 2>&1; then
    for backlight_dir in /sys/class/backlight/*/; do
        rm -f "${backlight_dir}"/lcd_* 2>/dev/null || true
    done
fi

# Remove config directory
echo "Removing config directory /etc/lcd_backlight..."
rm -rf /etc/lcd_backlight 2>/dev/null || true

# Remove plugin data directory
echo "Removing plugin data directory..."
rm -rf /data/plugins/system_hardware/lcd_backlight 2>/dev/null || true

echo "Uninstallation complete!"
echo "pluginuninstallend"
