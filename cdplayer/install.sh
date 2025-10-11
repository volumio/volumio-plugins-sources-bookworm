#!/bin/bash
set -e

echo "Installing cdplayer dependencies"
sudo apt-get update

# --- Runtime deps (minimal) ---
sudo apt-get install -y --no-install-recommends \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-ugly \
  cdparanoia \
  cd-discid \
  libcdio-utils

# Allow 'volumio' to read the CD device
sudo usermod -aG cdrom volumio || true

# --- systemd service ---
PLUGIN_DIR="/data/plugins/music_service/cdplayer"
SERVICE_FILE="cdplayer_stream.service"
SYSTEMD_DIR="/etc/systemd/system"

sudo cp "$PLUGIN_DIR/system/$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_FILE"
sudo systemctl restart "$SERVICE_FILE"

echo "plugininstallend"
