#!/bin/bash

PPATH="/data/plugins/system_hardware/Bluetoothremote"
CPATH="/data/INTERNAL/Bluetooth_Remote"
CNAME="triggerhappy.conf"

echo "Installing Bluetooth Remote Plugin Dependencies"

# Create configuration folder if it doesn't exist
sudo mkdir -p "$CPATH"

# Copy the config file only if it doesn't already exist
if [ ! -f "$CPATH/$CNAME" ]; then
    echo "Copying default triggerhappy configuration..."
    cp "$PPATH/$CNAME" "$CPATH"
else
    echo "Configuration file already exists, skipping copy."
fi

# Set ownership
sudo chown -R volumio "$CPATH"
sudo chgrp -R volumio "$CPATH"

# Create or overwrite the Triggerhappy systemd service
sudo bash -c "cat > /lib/systemd/system/triggerhappy.service <<EOC
[Unit]
Description=triggerhappy global hotkey daemon
After=local-fs.target

[Service]
Type=notify
ExecStart=
ExecStart=/usr/sbin/thd --triggers $CPATH/$CNAME --socket /run/thd.socket --user nobody --deviceglob \"/dev/input/event*\"

[Install]
WantedBy=multi-user.target
EOC
"

# Reload systemd and restart the service
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl restart triggerhappy
sudo systemctl enable triggerhappy

# Required to end the plugin install successfully
echo "plugininstallend"
