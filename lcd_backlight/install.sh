#!/bin/bash

echo "Installing LCD Backlight Control plugin..."

# Install Python dependencies
echo "Installing Python dependencies..."
apt-get update
apt-get install -y python3-smbus

# Install pip package for smbus if needed
pip3 install smbus 2>/dev/null || true

# Copy Python script to system location
echo "Installing Python script..."
cp backlight_control.py /usr/local/bin/backlight_control.py
chmod +x /usr/local/bin/backlight_control.py

# Creating global directory
if [ -d "/etc/lcd_backlight" ]; then
    echo "Directory /etc/lcd_backlight already exist"
else
mkdir -p /etc/lcd_backlight
echo "Directory /etc/lcd_backlight created"

fi

chmod 755 /etc/lcd_backlight
chmod 775 /etc/lcd_backlight/*
chown -R volumio:volumio /etc/lcd_backlight


# Check content
ls -la /etc/lcd_backlight/

# Copy systemd service file
echo "Installing systemd service..."
cp lcd_backlight.service /etc/systemd/system/lcd_backlight.service

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable service (but don't start yet - will be controlled by plugin)
echo "Enabling service..."
systemctl enable lcd_backlight.service
systemctl start lcd_backlight.service

# Creating plugin lcd_backlight  directory
if [ -d "/data/plugins/system_hardware/lcd_backlight'" ]; then
    echo "Directory /data/plugins/system_hardware/lcd_backlight already exist"
else
mkdir -p /data/plugins/system_hardware/lcd_backlight
echo "Directory /data/plugins/system_hardware/lcd_backlight created"

fi
chmod 755 /data/plugins/system_hardware/lcd_backlight
chown -R volumio:volumio /data/plugins/system_hardware/lcd_backlight


echo "Installation complete!"
echo "Configure the plugin via Volumio web interface and enable it."
echo "plugininstallend"

exit 0