#!/bin/bash

echo "Installing ir_activity_led Dependencies"
# No native packages are required; GPIO access is provided by @iiot2k/gpiox.

# If you need to differentiate install for armhf and i386 you can get the variable like this
#DPKG_ARCH=`dpkg --print-architecture`
# Then use it to differentiate your install

#required to end the plugin install
echo "plugininstallend"
