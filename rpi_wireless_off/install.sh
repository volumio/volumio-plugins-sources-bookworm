#!/bin/sh
# The plugin manager runs this as root when RPi Wireless Off is installed or updated, and a
# non-zero exit fails the step. Updates run it again, so a second run has to change nothing. Only
# an unsupported board makes it delete the plugin folder. uninstall.sh takes back what this puts
# outside that folder. RWO_DT_ROOT moves the device tree and RWO_GENERATOR_DIR the generator's
# folder. Only the tests set them.

echo "Installing RPi Wireless Off"

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$PLUGIN_DIR/systemd/rpi-wireless-off-generator"
TARGET="${RWO_GENERATOR_DIR:-/lib/systemd/system-generators}/rpi-wireless-off-generator"

# A refused install leaves nothing behind, so the next attempt starts clean.
refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

# The SoC of the Pi 4, Pi 400 and CM4. The generator and isSupportedBoard in lib/radios.js check
# the same string.
grep -qsxzF brcm,bcm2711 "${RWO_DT_ROOT:-/proc/device-tree}/compatible" ||
  refuse "ERROR: RPi Wireless Off only supports the Raspberry Pi 4, Pi 400 and Compute Module 4. On other boards, use Flight Mode."

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: the generator is missing from the package ($SOURCE)"
  exit 1
fi

# systemd runs the generator at every boot and every daemon-reload. It writes the drop-ins that
# make systemd skip volumiobt.service and wireless.service while their chip is off. install sets
# the mode itself, because a zip can lose the executable bit.
if ! install -m 755 "$SOURCE" "$TARGET"; then
  echo "ERROR: could not install the generator as $TARGET"
  exit 1
fi
systemctl daemon-reload || echo "WARNING: systemctl daemon-reload failed. The generator takes effect at the next boot."
chown -R volumio:volumio "$PLUGIN_DIR" || echo "WARNING: could not give $PLUGIN_DIR to the volumio user."

echo "RPi Wireless Off installed"
echo "plugininstallend"
