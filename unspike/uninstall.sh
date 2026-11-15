#!/bin/sh
# Unspike uninstaller: everything install.sh put outside the plugin folder
# goes; the plugin folder itself the plugin manager removes.

echo "Uninstalling Unspike"

SERVICE="unspike"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-unspike"
# What the unit leaves when it has set the variable at this start.
MARK="${UNSPIKE_MARK:-/run/unspike.set}"

systemctl disable "$SERVICE.service" 2>/dev/null || true
# Where the unit set the variable at this start, it is taken back, so that a
# service started from now on starts as the system has it. Where the system
# sets the variable itself, it is the system's and stays.
if [ -e "$MARK" ]; then
  systemctl unset-environment UV_USE_IO_URING 2>/dev/null || true
  rm -f "$MARK"
fi
systemctl stop "$SERVICE.service" 2>/dev/null || true
rm -f "$UNIT" "$SUDOERS"
systemctl daemon-reload

echo "Unspike uninstalled"
echo "The player's services that are running keep the way they started until the player restarts"
echo "pluginuninstallend"
