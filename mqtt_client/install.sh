#!/bin/bash

echo "Installing MQTT Client plugin dependencies..."

# Navigate to plugin directory
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd -P)"
cd "$PLUGIN_DIR"

# Install npm dependencies
npm install --production

# Fix ownership of node_modules to ensure volumio user can delete during uninstall
# This is needed because npm may create files with different ownership
if [ -d "$PLUGIN_DIR/node_modules" ]; then
  chown -R volumio:volumio "$PLUGIN_DIR/node_modules"
fi

echo "MQTT Client plugin installation complete."
echo "plugininstallend"
