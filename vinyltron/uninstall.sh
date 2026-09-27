#!/bin/bash
# Called by Volumio when the plugin is uninstalled.
# User config and idle images are preserved under /data, as is the built
# rpi-rgb-led-matrix tree under /home/volumio. Boot config changes made by
# install.sh (/boot/userconfig.txt, /boot/cmdline.txt) are also left in place,
# intentionally leaving onboard/HDMI audio disabled so GPIO18/PWM stays free
# for the matrix. To restore onboard audio, restore /boot/*.vinyltron-orig
# (see docs/install.md) and reboot.

/bin/systemctl stop vinyltron || true
/bin/systemctl disable vinyltron || true
rm -f /etc/systemd/system/vinyltron.service
rm -f /etc/sudoers.d/vinyltron
systemctl daemon-reload

echo "pluginuninstallend"
