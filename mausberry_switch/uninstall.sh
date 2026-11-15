#!/bin/bash

echo "Removing mausberry-switch"
sudo apt-get purge -y mausberry-switch

# Required by Volumio to finish the plugin removal
echo "pluginuninstallend"
