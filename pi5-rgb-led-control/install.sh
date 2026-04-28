#!/bin/bash
echo "Installing Pi5 RGB Status Link Dependencies"

# Update and install system dependencies for GPIO and Requests
sudo apt-get update
sudo apt-get -y install python3-pip python3-gpiozero python3-requests --no-install-recommends

# Create a default led_settings.json if it doesn't exist 
# This prevents the Python engine from failing on the first boot
PLUGIN_DIR="/data/plugins/system_controller/pi5-rgb-led-control"
if [ ! -f "$PLUGIN_DIR/led_settings.json" ]; then
    echo '{"PIN_R":17,"PIN_G":27,"PIN_B":22,"SHUT_SPD":"medium"}' > "$PLUGIN_DIR/led_settings.json"
    sudo chmod 777 "$PLUGIN_DIR/led_settings.json"
fi

# Ensure the Python script is executable
chmod +x "$PLUGIN_DIR/led_engine.py"

echo "plugininstallend"