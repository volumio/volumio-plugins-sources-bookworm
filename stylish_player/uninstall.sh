#!/bin/bash

echo "Uninstalling Stylish Player"

KIOSK_SCRIPT="/opt/volumiokiosk.sh"
CONFIG_FILE="/data/configuration/user_interface/stylish_player/config.json"
DEFAULT_PORT=3339

# Read the configured port from config.json (fallback to default)
if [ -f "$CONFIG_FILE" ]; then
  PLUGIN_PORT=$(python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d.get('port',{}).get('value',$DEFAULT_PORT))" 2>/dev/null || echo $DEFAULT_PORT)
else
  PLUGIN_PORT=$DEFAULT_PORT
fi

# If the kiosk script points to the plugin's port, restore it to Volumio default
if [ -f "$KIOSK_SCRIPT" ] && grep -q "localhost:${PLUGIN_PORT}" "$KIOSK_SCRIPT"; then
  echo "Restoring kiosk URL from localhost:${PLUGIN_PORT} to localhost:3000"
  echo volumio | sudo -S sed -i "s|localhost:${PLUGIN_PORT}|localhost:3000|g" "$KIOSK_SCRIPT"
  # Restart kiosk service if running
  if systemctl is-active --quiet volumio-kiosk; then
    echo volumio | sudo -S systemctl restart volumio-kiosk
  fi
fi

echo "Done"
echo "pluginuninstallend"
