#!/bin/bash

echo "Installing MQTT Client plugin dependencies..."

# Navigate to plugin directory
cd "$(dirname "$0")"

# Install npm dependencies
npm install --production

echo "MQTT Client plugin installation complete."
