#!/bin/bash

echo "Uninstalling MQTT Client plugin..."

# Get plugin directory
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd -P)"

# Fix permissions before Volumio tries to delete
# This handles case where node_modules has wrong ownership
if [ -d "$PLUGIN_DIR/node_modules" ]; then
  chown -R volumio:volumio "$PLUGIN_DIR/node_modules" 2>/dev/null
  chmod -R u+w "$PLUGIN_DIR/node_modules" 2>/dev/null
fi

echo "MQTT Client plugin uninstallation complete."
echo "pluginuninstallend"
