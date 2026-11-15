#!/bin/sh
# RaspDacMini LCD uninstaller: everything install.sh put outside the plugin
# folder goes; the plugin folder itself the plugin manager removes.

echo "Uninstalling RaspDacMini LCD"

SERVICE="raspdacmini-panel"
UNIT="/etc/systemd/system/$SERVICE.service"
RULES="/etc/udev/rules.d/70-raspdacmini-remote.rules"
SUDOERS="/etc/sudoers.d/volumio-user-raspdac_mini_lcd"
USERCONFIG="/boot/userconfig.txt"
MARK_BEGIN="# >>> raspdac_mini_lcd"
MARK_END="# <<< raspdac_mini_lcd"

systemctl stop "$SERVICE.service" 2>/dev/null || true
systemctl disable "$SERVICE.service" 2>/dev/null || true
rm -f "$UNIT"
systemctl daemon-reload

rm -f "$SUDOERS" "$RULES" /usr/local/bin/raspdacmini-boot /usr/local/bin/raspdacmini-leaving
udevadm control --reload 2>/dev/null || true

# The lines the plugin wrote into the boot configuration, between its marks.
if [ -f "$USERCONFIG" ] && grep -q "^$MARK_BEGIN\$" "$USERCONFIG"; then
  sed -i "/^$MARK_BEGIN\$/,/^$MARK_END\$/d" "$USERCONFIG"
  echo "Removed the plugin's lines from $USERCONFIG"
fi

echo "RaspDacMini LCD uninstalled"
echo "pluginuninstallend"
