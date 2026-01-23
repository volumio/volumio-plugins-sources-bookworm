#!/bin/bash

# Variable assignment
PPATH="/data/plugins/system_hardware/Bluetoothremote"
CPATH="/data/INTERNAL/Bluetooth_Remote"
CNAME="triggerhappy.conf"
SDIR="/etc/systemd/system/triggerhappy.service.d"

echo "Installing Bluetooth Remote Plugin Dependencies"

# Install evtest if not already present
sudo apt update
sudo apt install -y evtest

# Create configuration folder only if it doesn't exist
if [ ! -d "$CPATH" ]; then
  sudo mkdir -p "$CPATH"
fi

# Copy the triggerhappy config file if it doesn't already exist
if [ ! -f "$CPATH/$CNAME" ]; then
  cp "$PPATH/$CNAME" "$CPATH"
fi

sudo chown -R volumio "$CPATH"
sudo chgrp -R volumio "$CPATH"
sudo chmod -R 777 "$CPATH"

# Create systemd override directory if missing
sudo mkdir -p "$SDIR"

sudo tee "$SDIR/override.conf" > /dev/null <<EOC
[Service]
Type=notify
ExecStart= 
ExecStart=/usr/sbin/thd --triggers /data/INTERNAL/Bluetooth_Remote/triggerhappy.conf --socket /run/thd.socket --user nobody --deviceglob "/dev/input/event*"
EOC

# Reload systemd and apply new configuration
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl restart triggerhappy

# Required to end the plugin install successfully
echo "plugininstallend"

