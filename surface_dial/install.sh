#!/bin/bash
set -e

echo "Installing Surface Dial plugin prerequisites"
if ! command -v bluetoothctl >/dev/null 2>&1; then sudo apt-get update; sudo apt-get -y install bluez --no-install-recommends; fi
if ! command -v python3 >/dev/null 2>&1; then sudo apt-get update; sudo apt-get -y install python3 --no-install-recommends; fi
PLUGIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
HAPTIC_HELPER="$PLUGIN_DIR/scripts/set-dial-feature.py"
RULE_FILE="/etc/udev/rules.d/99-volumio-surface-dial.rules"
RULE_MARKER="# Volumio Surface Dial plugin"
if [ ! -f "$HAPTIC_HELPER" ]; then echo "ERROR: Missing Surface Dial feature-report helper: $HAPTIC_HELPER" >&2; exit 1; fi
chmod 0755 "$HAPTIC_HELPER"
if [ -e "$RULE_FILE" ] && ! grep -qF "$RULE_MARKER" "$RULE_FILE"; then echo "ERROR: $RULE_FILE already exists and is not owned by this plugin; refusing to overwrite it." >&2; exit 1; fi
sudo tee "$RULE_FILE" >/dev/null <<'RULES'
# Volumio Surface Dial plugin
# Microsoft Surface Dial: VID 045e, PID 091b
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="045e", ATTRS{idProduct}=="091b", MODE:="0660", GROUP:="volumio"
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", KERNELS=="*045E:091B*", MODE:="0660", GROUP:="volumio"
RULES
sudo udevadm control --reload-rules || true
sudo udevadm trigger --subsystem-match=hidraw || true
sudo systemctl start bluetooth.service >/dev/null 2>&1 || true
echo "Surface Dial plugin installed"
echo "plugininstallend"
