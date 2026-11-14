#!/bin/sh
# Audiophonics Evo Sabre uninstaller: everything install.sh put outside the
# plugin folder goes; the plugin folder itself the plugin manager removes.

echo "Uninstalling Audiophonics Evo Sabre"

SERVICE="evosabre-panel"
UNIT="/etc/systemd/system/$SERVICE.service"
KEEPALIVE_SERVICE="evosabre-keepalive"
KEEPALIVE_UNIT="/etc/systemd/system/$KEEPALIVE_SERVICE.service"
RULES="/etc/udev/rules.d/70-evosabre-remote.rules"
SUDOERS="/etc/sudoers.d/volumio-user-audiophonics_evo_sabre"
USERCONFIG="/boot/userconfig.txt"
MARK_BEGIN="# >>> audiophonics_evo_sabre"
MARK_END="# <<< audiophonics_evo_sabre"

systemctl stop "$SERVICE.service" 2>/dev/null || true
systemctl disable "$SERVICE.service" 2>/dev/null || true
systemctl stop "$KEEPALIVE_SERVICE.service" 2>/dev/null || true
rm -f "$UNIT" "$KEEPALIVE_UNIT"
rm -rf /run/evosabre-keepalive
systemctl daemon-reload

rm -f "$SUDOERS" "$RULES"
udevadm control --reload 2>/dev/null || true

# The lines the plugin wrote into the boot configuration, between its marks.
if [ -f "$USERCONFIG" ] && grep -q "^$MARK_BEGIN\$" "$USERCONFIG"; then
  sed -i "/^$MARK_BEGIN\$/,/^$MARK_END\$/d" "$USERCONFIG"
  echo "Removed the plugin's lines from $USERCONFIG"
fi

echo "Audiophonics Evo Sabre uninstalled"
echo "pluginuninstallend"
