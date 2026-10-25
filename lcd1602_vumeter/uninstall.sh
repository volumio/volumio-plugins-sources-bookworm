#!/bin/bash
# LCD1602 VU Meter uninstaller: everything install.sh and the plugin put
# outside the plugin folder goes; the plugin folder itself the plugin
# manager removes.

echo "Uninstalling LCD1602 VU Meter"

PLUGIN_DIR="/data/plugins/system_hardware/lcd1602_vumeter"
SERVICE="lcd1602-vumeter"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-lcd1602_vumeter"
USERCONFIG="/boot/userconfig.txt"
MARK_BEGIN="# >>> lcd1602_vumeter"
MARK_END="# <<< lcd1602_vumeter"

systemctl stop "$SERVICE.service" 2>/dev/null || true
systemctl disable "$SERVICE.service" 2>/dev/null || true
rm -f "$UNIT"
systemctl daemon-reload

rm -f "$SUDOERS"
rm -f /etc/udev/rules.d/60-lcd1602-vumeter-i2c.rules /etc/modules-load.d/lcd1602-vumeter.conf
udevadm control --reload 2>/dev/null || true
rm -f /tmp/lcd1602-vumeter.sock /dev/shm/vutap.*
rm -f "$PLUGIN_DIR/alsa-lib/libvutap.so"

# The lines the plugin wrote into the boot configuration, between its marks.
if [ -f "$USERCONFIG" ] && grep -q "^$MARK_BEGIN" "$USERCONFIG"; then
  sed -i "/^$MARK_BEGIN/,/^$MARK_END/d" "$USERCONFIG"
  echo "Removed the plugin's lines from $USERCONFIG"
fi

echo "LCD1602 VU Meter uninstalled"
echo "pluginuninstallend"
