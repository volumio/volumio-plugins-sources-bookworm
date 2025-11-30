#!/bin/bash
set -e

PLUGIN_DIR="/data/plugins/music_service/cdplayer"
SERVICE_FILE="cdplayer_stream.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "Installing cdplayer dependencies"
sudo apt-get update

# --- Runtime deps ---
sudo apt-get install -y --no-install-recommends \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-ugly \
  cdparanoia \
  build-essential

# --- volumio permissions ---
echo "Configuring permissions"
# Allow volumio user to access the CD drive
sudo usermod -aG cdrom volumio || true

# --- systemd service ---
echo "Setting up daemon service"
sudo cp "$PLUGIN_DIR/system/$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_FILE"
sudo systemctl daemon-reload

echo "plugininstallend"