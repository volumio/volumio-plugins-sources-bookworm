#!/bin/bash

# Define the base directory for the plugin
PLUGIN_DIR="/data/plugins/audio_interface/fusiondsp"

# Ensure the directory exists
if [ ! -d "$PLUGIN_DIR" ]; then
  echo "Error: Directory $PLUGIN_DIR does not exist."
  exit 1
fi

# Change to the plugin directory
cd "$PLUGIN_DIR" || exit

# Run the backend script
./camillagui/camillagui_backend/camillagui_backend
