#!/bin/bash

# Cleanup function for failed installation
cleanup() {
    echo "Cleaning up after failed installation..." >&2
    rm -f /usr/local/bin/backlight_control.py 2>/dev/null || true
    rm -f /etc/systemd/system/lcd_backlight.service 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
}

# Set trap for errors
trap cleanup ERR

echo "Installing LCD Backlight Control plugin..."

# Get the plugin directory path
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Plugin directory: $PLUGIN_DIR"

echo "Installing Python dependencies..."

if ! apt-get update; then
    echo "Warning: Failed to update package lists" >&2
fi

if ! apt-get install -y python3-smbus python3-requests; then
    echo "Error: Failed to install required packages" >&2
    exit 1
fi

pip3 install smbus 2>/dev/null || echo "Note: smbus already installed or not available"

# Install Python script using symlink
echo "Installing Python script..."
ln -sf "$PLUGIN_DIR/backlight_control.py" /usr/local/bin/backlight_control.py
chmod +x "$PLUGIN_DIR/backlight_control.py"

# Creating global directory
if [ -d "/etc/lcd_backlight" ]; then
    echo "Directory /etc/lcd_backlight already exist"
else
    mkdir -p /etc/lcd_backlight
    echo "Directory /etc/lcd_backlight created"
fi

chmod 755 /etc/lcd_backlight
chown -R volumio:volumio /etc/lcd_backlight

# Create default config files with initial values
echo "Creating default configuration files..."
echo "1" > /etc/lcd_backlight/lcd_enabled
echo "1" > /etc/lcd_backlight/lcd_int_time
echo "12" > /etc/lcd_backlight/lcd_min_backlight
echo "255" > /etc/lcd_backlight/lcd_max_backlight
echo "0.75" > /etc/lcd_backlight/lcd_lux_multiplier
echo "0.3" > /etc/lcd_backlight/lcd_smoothing_factor
echo "0" > /etc/lcd_backlight/lcd_playback_boost
echo "30" > /etc/lcd_backlight/lcd_playback_boost_duration

# Set proper permissions for config files
chmod 664 /etc/lcd_backlight/lcd_*
chown volumio:volumio /etc/lcd_backlight/lcd_*

# Check content
ls -la /etc/lcd_backlight/

# Install systemd service using symlink
echo "Installing systemd service..."
ln -sf "$PLUGIN_DIR/lcd_backlight.service" /etc/systemd/system/lcd_backlight.service

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable service (but don't start yet - will be controlled by plugin)
echo "Enabling service..."
systemctl enable lcd_backlight.service
systemctl start lcd_backlight.service

# Creating plugin lcd_backlight directory
if [ -d "/data/plugins/system_hardware/lcd_backlight" ]; then
    echo "Directory /data/plugins/system_hardware/lcd_backlight already exist"
else
    mkdir -p /data/plugins/system_hardware/lcd_backlight
    echo "Directory /data/plugins/system_hardware/lcd_backlight created"
fi

chmod 755 /data/plugins/system_hardware/lcd_backlight
chown -R volumio:volumio /data/plugins/system_hardware/lcd_backlight


# Disable trap on successful completion
trap - ERR

echo "Installation complete!"
echo "Configure the plugin via Volumio web interface and enable it."
echo "plugininstallend"

exit 0