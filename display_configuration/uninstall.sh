#!/bin/bash
# Display Configuration uninstaller: everything install.sh and the plugin put
# outside the plugin folder goes; the plugin folder the plugin manager removes.
# Backups under /data/INTERNAL are kept, as the settings page says.

echo "Uninstalling Display Configuration"

HELPER="/usr/local/bin/display-configuration-root"
SUDOERS="/etc/sudoers.d/volumio-user-display_configuration"

rm -f /etc/X11/xorg.conf.d/90-display-configuration-resolution.conf
rm -f /etc/X11/xorg.conf.d/95-display-configuration-touch.conf
rm -f /data/plugins/user_interface/display_configuration/rotation.cfg
# Legacy BIOS boots: the plugin's tokens off the syslinux kernel line again.
if [ -f /boot/syslinux.cfg ] && [ -x "$HELPER" ]; then
  "$HELPER" syslinux clear || echo "the syslinux kernel line could not be cleaned; see /boot/syslinux.cfg"
fi
rm -f "$SUDOERS" "$HELPER"

echo "Display Configuration uninstalled"
echo "pluginuninstallend"
