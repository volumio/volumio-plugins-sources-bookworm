#!/bin/bash
echo "Installing Kiosk settings"

sudo apt-get update
sudo apt-get install -y unclutter-xfixes xscreensaver xscreensaver-data-extra xscreensaver-gl-extra

#required to end the plugin install
echo "plugininstallend"
