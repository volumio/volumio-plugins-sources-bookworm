#!/bin/bash
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing flightmode"
chmod 755 "${PLUGIN_DIR}/scripts/flightmode-apply.sh"

echo "plugininstallend"
