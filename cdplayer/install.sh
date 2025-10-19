#!/bin/bash
set -e

LIBDISCID_VER=0.6.5
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
  build-essential \
  wget \
  tar \
  cmake

# --- CD info deps ---
echo "Libdiscid install and setup"

# 1. Download libdiscid source
wget -O libdiscid.tar.gz https://codeload.github.com/metabrainz/libdiscid/tar.gz/refs/tags/v${LIBDISCID_VER}
tar xzf libdiscid.tar.gz
cd libdiscid-${LIBDISCID_VER}

# 1. Build only the CLI
mkdir build
cd build
cmake ..
make discid

# 2. Copy the small binary to your path
sudo cp ./discid /usr/local/bin/

# 3. Cleanup (optional)
cd ..
cd ..
rm -rf libdiscid-${LIBDISCID_VER} libdiscid.tar.gz

# --- volumio permissions ---
echo "Volumio permissions"

# Add volumio user to cdrom group to access the CD drive
sudo usermod -aG cdrom volumio || true

# --- systemd service ---
echo "Daemon service setup"
sudo cp "$PLUGIN_DIR/system/$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_FILE"
sudo systemctl restart "$SERVICE_FILE"

echo "plugininstallend"



