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
  sudo chown -R volumio "$CPATH"
  sudo chgrp -R volumio "$CPATH"
fi

# Copy the triggerhappy config file if it doesn't already exist
if [ ! -f "$CPATH/$CNAME" ]; then
  cp "$PPATH/$CNAME" "$CPATH"
fi

# Create systemd override directory if missing
sudo mkdir -p "$SDIR"

# Create or overwrite systemd override file for triggerhappy
sudo bash -c "cat > '$SDIR/override.conf' <<EOC
[Unit]
Description=triggerhappy global hotkey daemon
After=local-fs.target

[Service]
Type=notify
ExecStart=/usr/sbin/thd --triggers /data/INTERNAL/Bluetooth_Remote/triggerhappy.conf --socket /run/thd.socket --user nobody --deviceglob "/dev/input/event*"

[Install]
WantedBy=multi-user.target
EOC"

# Reload systemd and apply new configuration
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl restart triggerhappy

# Required to end the plugin install successfully
echo "plugininstallend"

