#!/bin/bash

echo "Installing player_status_led Dependencies"
# GPIO access is provided by @iiot2k/gpiox; no native operating-system packages are required.

# If you need to differentiate install for armhf and i386 you can get the variable like this
#DPKG_ARCH=`dpkg --print-architecture`
# Then use it to differentiate your install

#requred to end the plugin install
echo "plugininstallend"
