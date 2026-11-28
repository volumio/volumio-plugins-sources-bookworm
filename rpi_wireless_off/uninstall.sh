#!/bin/sh
# The plugin manager runs this as root when RPi Wireless Off is uninstalled, after onStop and
# before it deletes the plugin folder, so lib/userconfig.js is still there. It always exits 0,
# because a non-zero exit fails the uninstall step. It takes back what the plugin put outside its
# folder: the block of overlay lines in userconfig.txt and the generator.
# RWO_GENERATOR_DIR, RWO_USERCONFIG and RWO_NODE move the generator's folder and userconfig.txt
# and name the node binary. Only the tests set them.

echo "Uninstalling RPi Wireless Off"

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATOR="${RWO_GENERATOR_DIR:-/lib/systemd/system-generators}/rpi-wireless-off-generator"
USERCONFIG="${RWO_USERCONFIG:-/boot/userconfig.txt}"
NODE="${RWO_NODE:-/usr/bin/node}"

# The plugin is gone once this has run, so the log says how to finish by hand.
delete_by_hand() {
  echo "Delete the plugin's lines from $USERCONFIG by hand. They mention rpi_wireless_off plugin,"
  echo "or are the dtoverlay=disable-wifi and dtoverlay=disable-bt lines the plugin added."
}

# The CLI prints removed, none or broken and exits 0 for all three. Any other output means node or
# the CLI failed. It leaves a damaged block alone, because in a damaged file nothing says which
# lines are the plugin's.
if [ -f "$USERCONFIG" ]; then
  result=$("$NODE" "$PLUGIN_DIR/lib/userconfig.js" --remove-block "$USERCONFIG" 2>&1)
  case "$result" in
    removed)
      echo "Removed the plugin's block from $USERCONFIG."
      # Only here does a reboot change anything. With no block, or one left alone, the chips stay as they are.
      echo "Reboot to turn the chips back on."
      ;;
    none)
      echo "$USERCONFIG has no block from the plugin."
      ;;
    broken)
      echo "The plugin's block in $USERCONFIG is damaged, so it was left alone."
      delete_by_hand
      ;;
    *)
      echo "Could not remove the plugin's block from $USERCONFIG: $result"
      delete_by_hand
      ;;
  esac
fi

# A Save that lost power between writing its temp file and the rename leaves the temp file behind.
# It can be there with no userconfig.txt next to it, so this stands outside the check above.
rm -f "$USERCONFIG.rwo-tmp"

# No systemctl daemon-reload here. The chips stay off until the next reboot, and until then the
# drop-ins the generator wrote under /run keep volumiobt.service and wireless.service from looping or
# failing. A reload would delete them at once. The reboot clears /run, and with the generator gone
# nothing writes them again.
rm -f "$GENERATOR" || echo "WARNING: could not delete $GENERATOR."

echo "RPi Wireless Off uninstalled"
echo "pluginuninstallend"
