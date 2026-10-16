#!/bin/bash
# Idempotent teardown. onStop should already have done this.
# This script runs as root via the plugin manager.

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
APPLY="${PLUGIN_DIR}/scripts/flightmode-apply.sh"
MODE_FILE="${PLUGIN_DIR}/flightmode.mode"

echo "Uninstalling flightmode"

printf '%s\n' 'on' > "${PLUGIN_DIR}/wifi.state" || true
printf '%s\n' 'on' > "${PLUGIN_DIR}/bluetooth.state" || true
printf '%s\n' 'off' > "${PLUGIN_DIR}/flightmode.state" || true
printf '%s\n' 'off' > "${PLUGIN_DIR}/wifi.persist" || true
printf '%s\n' 'release' > "${MODE_FILE}" || true
rm -f /run/flightmode-wifi-session || true

if [ -x "${APPLY}" ]; then
  "${APPLY}" || true
fi

systemctl stop volumio-flightmode.path >/dev/null 2>&1 || true
systemctl disable volumio-flightmode.path >/dev/null 2>&1 || true
systemctl disable volumio-flightmode.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/volumio-flightmode.path
rm -f /etc/systemd/system/volumio-flightmode.service
systemctl daemon-reload >/dev/null 2>&1 || true

echo "pluginuninstallend"
