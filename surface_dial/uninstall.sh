#!/bin/bash
set -e

echo "Removing Surface Dial plugin system additions"
RULE_FILE="/etc/udev/rules.d/99-volumio-surface-dial.rules"
RULE_MARKER="# Volumio Surface Dial plugin"
if [ -f "$RULE_FILE" ]; then
  if grep -qF "$RULE_MARKER" "$RULE_FILE"; then sudo rm -f "$RULE_FILE"; else echo "Leaving $RULE_FILE untouched because it is not marked as owned by this plugin"; fi
fi
sudo udevadm control --reload-rules || true
sudo udevadm trigger --subsystem-match=hidraw || true
echo "Surface Dial plugin removed"
echo "pluginuninstallend"
