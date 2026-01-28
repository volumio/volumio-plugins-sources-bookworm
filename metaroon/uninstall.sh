#!/bin/bash

echo "================================================"
echo "Uninstalling MetaRoon plugin"
echo "================================================"

# Get plugin info
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_CATEGORY=$(cat "$PLUGIN_DIR"/package.json | jq -r ".volumio_info.plugin_type")
PACKAGE_NAME=$(cat "$PLUGIN_DIR"/package.json | jq -r ".name")

echo "Plugin: $PACKAGE_NAME"
echo "Category: $PLUGIN_CATEGORY"

# Stop and disable RoonBridge service first
if systemctl is-active --quiet roonbridge; then
    echo "Stopping RoonBridge service..."
    sudo systemctl stop roonbridge
fi

if systemctl is-enabled --quiet roonbridge 2>/dev/null; then
    echo "Disabling RoonBridge service..."
    sudo systemctl disable roonbridge
fi

# Remove systemd service file (install creates it in /etc/systemd/system/)
if [ -f "/etc/systemd/system/roonbridge.service" ]; then
    echo "Removing RoonBridge service file..."
    sudo rm -f "/etc/systemd/system/roonbridge.service"
fi

# Also check legacy location just in case
if [ -f "/lib/systemd/system/roonbridge.service" ]; then
    sudo rm -f "/lib/systemd/system/roonbridge.service"
fi

# Reload systemd
sudo systemctl daemon-reload

# Remove RoonBridge installation
if [ -d "/opt/roonbridge" ]; then
    echo "Removing RoonBridge installation from /opt/roonbridge..."
    sudo rm -rf "/opt/roonbridge"
fi

# Remove Roon Bridge data directories (where it stores pairing info, cache, etc.)
if [ -d "/var/roon" ]; then
    echo "Removing Roon data from /var/roon..."
    sudo rm -rf "/var/roon"
fi

# Check for user-level Roon data
VOLUMIO_ROON_DIR="/home/volumio/.RoonBridge"
if [ -d "$VOLUMIO_ROON_DIR" ]; then
    echo "Removing Roon data from $VOLUMIO_ROON_DIR..."
    rm -rf "$VOLUMIO_ROON_DIR"
fi

ROOT_ROON_DIR="/root/.RoonBridge"
if [ -d "$ROOT_ROON_DIR" ]; then
    echo "Removing Roon data from $ROOT_ROON_DIR..."
    sudo rm -rf "$ROOT_ROON_DIR"
fi

# Remove plugin configuration (if exists outside plugin directory)
CONFIG_DIR="/data/configuration/$PLUGIN_CATEGORY/$PACKAGE_NAME"
if [ -d "$CONFIG_DIR" ]; then
    echo "Removing plugin configuration from $CONFIG_DIR..."
    sudo rm -rf "$CONFIG_DIR"
fi

echo ""
echo "================================================"
echo "MetaRoon plugin uninstalled successfully"
echo "================================================"
echo ""
echo "RoonBridge has been removed. Your Volumio device"
echo "will no longer appear as a Roon output."
