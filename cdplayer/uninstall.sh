#!/bin/bash
# TODO: cleanup this and verify all the steps
echo "🧹 Uninstalling cdplayer plugin..."

# --- Stop and remove systemd service ---
SERVICE_FILE="/etc/systemd/system/cdplayer_stream.service"

echo "🧹 Removing CD HTTP streamer systemd service..."
if sudo systemctl is-active --quiet cdplayer_stream.service; then
    sudo systemctl stop cdplayer_stream.service
fi
if sudo systemctl is-enabled --quiet cdplayer_stream.service; then
    sudo systemctl disable cdplayer_stream.service
fi

sudo rm -f "$SERVICE_FILE"
sudo systemctl daemon-reload

echo "✅ Systemd service removed."

# --- Optional: Remove Python packages ---
python3 -m pip uninstall -y Flask python-mpd2

# --- Optional: Remove OS packages ---
sudo apt-get purge -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-ugly gstreamer1.0-libav cdparanoia cd-discid libcdio-utils python3 python3-pip
sudo apt-get autoremove -y

#required to end the plugin uninstall
echo "Done
echo "pluginuninstallend"
