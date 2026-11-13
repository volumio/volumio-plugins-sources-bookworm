#!/bin/bash

# Cleanup function for failed installation
cleanup() {
    echo "Cleaning up after failed installation..." >&2
    rm -f /usr/local/bin/backlight_control.py 2>/dev/null || true
    rm -f /etc/systemd/system/lcd_backlight.service 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
}

echo "Installing LCD Backlight Control plugin..."

# Get the plugin directory path
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPECTED_DIR="/data/plugins/system_hardware/lcd_backlight"
echo "Plugin directory: $PLUGIN_DIR"

# This script is run by Volumio's plugin manager from the installed plugin folder (under /data).
# Run manually from a source folder (e.g. /home/volumio/...) it would not register the plugin
# in Volumio and the service would point to files outside the installed plugin.
case "$PLUGIN_DIR" in
    /data/*) ;;
    *) NOT_INSTALLED_BY_VOLUMIO=1 ;;
esac
if [ -n "$NOT_INSTALLED_BY_VOLUMIO" ]; then
    echo "Error: install.sh must not be run manually." >&2
    echo "Install the plugin as user 'volumio' (not root, without sudo) from the plugin source folder:" >&2
    echo "    cd $PLUGIN_DIR && volumio plugin install" >&2
    echo "Volumio copies the plugin to $EXPECTED_DIR and runs this script from there." >&2
    exit 1
fi

# Set trap for errors
trap cleanup ERR

echo "Checking Python dependencies..."

# Install only the modules that are missing. The package repositories of older
# releases (Volumio 3 / Debian buster) may be unavailable, so apt is used only when needed.
MISSING_PACKAGES=""
python3 -c "import smbus" 2>/dev/null || MISSING_PACKAGES="$MISSING_PACKAGES python3-smbus"

if [ -n "$MISSING_PACKAGES" ]; then
    echo "Installing:$MISSING_PACKAGES"

    if ! apt-get update; then
        echo "Warning: Failed to update package lists" >&2
    fi

    if ! apt-get install -y $MISSING_PACKAGES; then
        echo "Error: Failed to install required packages:$MISSING_PACKAGES" >&2
        exit 1
    fi
else
    echo "Python module smbus is already installed"
fi

# Install Python script using symlink
echo "Installing Python script..."
chmod +x "$PLUGIN_DIR/backlight_control.py"
ln -sf "$PLUGIN_DIR/backlight_control.py" /usr/local/bin/backlight_control.py

# Runtime configuration directory, written by the plugin (user volumio) and read by the service
mkdir -p /etc/lcd_backlight
chmod 755 /etc/lcd_backlight

# Default values (same as config.json). The plugin rewrites them when it starts.
echo "Creating default configuration files..."
echo "0" > /etc/lcd_backlight/lcd_enabled
echo "1" > /etc/lcd_backlight/lcd_int_time
echo "12" > /etc/lcd_backlight/lcd_min_backlight
echo "255" > /etc/lcd_backlight/lcd_max_backlight
echo "0.75" > /etc/lcd_backlight/lcd_lux_multiplier
echo "0.3" > /etc/lcd_backlight/lcd_smoothing_factor
echo "0" > /etc/lcd_backlight/lcd_playback_boost
echo "30" > /etc/lcd_backlight/lcd_playback_boost_duration
# Playback state, updated by the plugin on every play/stop change
echo "0" > /etc/lcd_backlight/lcd_playing

chmod 664 /etc/lcd_backlight/lcd_*
chown -R volumio:volumio /etc/lcd_backlight

# The service is started and stopped by the plugin (onStart/onStop), it is not
# enabled at boot. Remove the boot autostart created by plugin versions <= 1.1.0.
# This must run BEFORE the unit file is installed: "disable" also deletes a unit
# file that is a symlink pointing outside the systemd directories ("linked" unit).
systemctl disable lcd_backlight.service 2>/dev/null || true
rm -f /etc/systemd/system/lcd_backlight.service

# Install systemd service as a regular file (copy, not symlink)
echo "Installing systemd service..."
install -m 644 "$PLUGIN_DIR/lcd_backlight.service" /etc/systemd/system/lcd_backlight.service
systemctl daemon-reload

if [ ! -f /etc/systemd/system/lcd_backlight.service ]; then
    echo "Error: systemd service file was not installed" >&2
    exit 1
fi

# Disable trap on successful completion
trap - ERR

echo "Installation complete!"
echo "Enable the plugin in the Volumio web interface (Plugins -> Installed plugins)."
# Volumio is not restarted here: this script runs before the plugin is registered
# (addPluginToConfig), a restart now would abort the installation.
echo "If this was a reinstall or an update, restart Volumio afterwards: volumio vrestart"
echo "plugininstallend"

exit 0
