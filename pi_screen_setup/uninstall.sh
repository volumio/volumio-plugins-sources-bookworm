#!/bin/bash
# Pi Screen Setup uninstaller. Volumio's plugin manager runs it as root with sh.
# The plugin's lines leave the boot files and the lines it took out of Volumio's own
# files go back (the helper's clean-exit); the helper and its sudoers entry go; the
# plugin folder the plugin manager removes. Backups and restore points under
# /data/INTERNAL/pi_screen_setup are kept.

echo "Uninstalling Pi Screen Setup"

PLUGIN_DIR="/data/plugins/system_hardware/pi_screen_setup"
HELPER="/usr/local/bin/pi-screen-setup-root"
SUDOERS="/etc/sudoers.d/volumio-user-pi_screen_setup"

if [ -x "$HELPER" ]; then
  "$HELPER" clean-exit || echo "WARNING: the clean exit did not complete; check /boot/config.txt for 'include videoconfig.txt'"
elif [ -f "$PLUGIN_DIR/scripts/pi-screen-setup-root.sh" ]; then
  sh "$PLUGIN_DIR/scripts/pi-screen-setup-root.sh" clean-exit || echo "WARNING: the clean exit did not complete"
else
  # A release before 1.0 left no helper: the include line and the plugin's file at least.
  if [ -f /boot/config.txt ] && grep -q '^include videoconfig\.txt$' /boot/config.txt; then
    sed -i '/^include videoconfig\.txt$/d' /boot/config.txt
  fi
  rm -f /boot/videoconfig.txt
fi

rm -f "$SUDOERS" "$HELPER"

echo "Pi Screen Setup uninstalled; backups stay under /data/INTERNAL/pi_screen_setup"
echo "pluginuninstallend"
