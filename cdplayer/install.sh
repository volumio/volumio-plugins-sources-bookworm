#!/bin/bash

echo "Installing cdplayer Dependencies"
sudo apt-get update
# Install the required packages via apt-get
sudo apt-get -y install

# If you need to differentiate install for armhf and i386 you can get the variable like this
#DPKG_ARCH=`dpkg --print-architecture`
# Then use it to differentiate your install

#### CHATGPT suggested CONTENT BELOW THIS LINE ####
# --- CD streaming + Python control deps ---
echo "CD streaming + Python control deps"
sudo apt-get update

# GStreamer core + common plugins (CDDA path comes via cdparanoia/gstreamer elements)
echo "GStreamer core + common plugins"
sudo apt-get install -y --no-install-recommends \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav

# CD utilities (track read + disc ID)
echo "CD utilities (track read + disc ID)"
sudo apt-get install -y --no-install-recommends \
  cdparanoia \
  cd-discid \
  libcdio-utils

# Python 3 + Flask API + MPD client
echo "Python 3 + Flask API + MPD client"
sudo apt-get install -y --no-install-recommends python3 python3-pip
python3 -m pip install --no-cache-dir --upgrade pip
python3 -m pip install --no-cache-dir \
  Flask==2.2.5 \
  python-mpd2

# Ensure 'volumio' can read the CD device
echo "Ensure 'volumio' can read the CD device"
sudo usermod -aG cdrom volumio

echo "🔧 Installing CD HTTP streamer systemd service..."

PLUGIN_DIR="/data/plugins/music_service/cdplayer"
SERVICE_FILE="cdplayer_stream.service"
SYSTEMD_DIR="/etc/systemd/system"

# Copy the service file to systemd
sudo cp "$PLUGIN_DIR/system/$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_FILE"

# Reload, enable, and start the service
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_FILE
sudo systemctl start $SERVICE_FILE

echo "✅ CD HTTP streamer service installed and started."

#### CHATGPT suggested CONTENT above THIS LINE ####


#required to end the plugin install
echo "plugininstallend"
