#!/bin/bash

# Correct variable assignment (no spaces around "=")
PPATH="/data/plugins/system_hardware/Bluetoothremote"
CPATH="/data/INTERNAL/Bluetooth_Remote"
CNAME="triggerhappy.conf"

echo "Installing Bluetooth Remote Plugin Dependencies"

# Create configuration folder
sudo mkdir -p "$CPATH"
sudo chown -R volumio "$CPATH"
sudo chgrp -R volumio "$CPATH"

# Copy the config file
cp "$PPATH/$CNAME" "$CPATH"

# Create or overwrite the Triggerhappy systemd service
sudo bash -c "cat > /lib/systemd/system/triggerhappy.service <<EOC
[Unit]
Description=triggerhappy global hotkey daemon
After=local-fs.target

[Service]
Type=notify
ExecStart=
ExecStart=/usr/sbin/thd --triggers $CPATH/$CNAME --socket /run/thd.socket --user volumio --deviceglob "/dev/input/event*"

[Install]
WantedBy=multi-user.target
EOC
"
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl restart triggerhappy
sudo systemctl enable triggerhappy

# Required to end the plugin install successfully
echo "plugininstallend"

