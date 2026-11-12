#!/bin/sh
# MPDantic uninstaller: everything install.sh and the plugin put outside the plugin
# folder goes; the plugin folder itself the plugin manager removes. The data folder,
# which holds what the user can undo, is the user's and stays.

echo "Uninstalling MPDantic"

PLUGIN_DIR=/data/plugins/system_controller/mpdantic
UNIT=/etc/systemd/system/mpdantic.service
SUDOERS=/etc/sudoers.d/volumio-user-mpdantic
AVAHI=/etc/avahi/services/mpdantic.service

systemctl stop mpdantic.service 2>/dev/null || true
systemctl disable mpdantic.service 2>/dev/null || true
rm -f "$UNIT"
systemctl daemon-reload
rm -f "$SUDOERS"
rm -f "$AVAHI"
rm -rf /run/mpdantic
rm -f "$PLUGIN_DIR/bin/mpdantic"
echo "The data under /data/INTERNAL/mpdantic stays"

echo "MPDantic uninstalled"
echo "pluginuninstallend"
