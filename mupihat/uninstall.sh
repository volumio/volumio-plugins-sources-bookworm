#!/bin/bash

echo "Uninstalling MuPiHAT Plugin"

# Stop and disable the MuPiHAT service
echo "Stopping MuPiHAT service..."
sudo systemctl stop mupi_hat.service 2>/dev/null || true
sudo systemctl disable mupi_hat.service 2>/dev/null || true

# Remove the systemd service file
echo "Removing systemd service file..."
sudo rm -f /etc/systemd/system/mupi_hat.service
sudo systemctl daemon-reload

# Remove MuPiHAT installation directory
echo "Removing MuPiHAT files..."
sudo rm -rf /usr/local/bin/mupibox

# Remove temporary files
echo "Cleaning up temporary files..."
sudo rm -f /tmp/mupihat.json
sudo rm -f /tmp/mupihat.log

# Remove boot configuration files
echo "Removing boot configuration..."
sudo rm -f /boot/mupihatconfig.txt

# Remove include line from userconfig.txt
if [ -f /boot/userconfig.txt ]; then
	sudo sed -i '/include mupihatconfig.txt/d' /boot/userconfig.txt
fi

echo "MuPiHAT plugin uninstalled successfully!"

echo "pluginuninstallend"