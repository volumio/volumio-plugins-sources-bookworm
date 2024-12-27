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

# Activate the virtual environment
if [ ! -f "cgui/bin/activate" ]; then
  echo "Error: Virtual environment not found in $PLUGIN_DIR/cgui."
  exit 1
fi
source cgui/bin/activate

# Run the main Python script
if [ ! -f "cgui/main.py" ]; then
  echo "Error: main.py not found in $PLUGIN_DIR/cgui."
  exit 1
fi
python cgui/main.py
