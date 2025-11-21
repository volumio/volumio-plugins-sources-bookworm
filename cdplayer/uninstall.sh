#!/bin/bash
set -e

SERVICE_NAME="cdplayer_stream.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"

echo "Stopping and removing service..."
sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
sudo rm -f "$SERVICE_FILE"
sudo systemctl daemon-reload

# sudo apt-get remove -y --purge \
#   gstreamer1.0-tools \
#   gstreamer1.0-plugins-base \
#   gstreamer1.0-plugins-good \
#   gstreamer1.0-plugins-ugly \
#   cdparanoia \
#   build-essential \
#   wget \
#   tar \
#   cmake 
# sudo apt-get autoremove -y

echo "pluginuninstallend"
