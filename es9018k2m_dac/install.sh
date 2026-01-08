#!/bin/bash

echo "Installing ES9018K2M DAC Control Plugin"
echo ""

# Check if i2c-tools is available (should be in Volumio base image)
if ! command -v i2cset &> /dev/null; then
  echo "Installing i2c-tools..."
  apt-get update -q
  apt-get install -y i2c-tools
fi

echo ""
echo "=========================================="
echo "ES9018K2M DAC Control Plugin installed"
echo "=========================================="
echo ""
echo "SETUP INSTRUCTIONS:"
echo ""
echo "1. Go to Volumio Settings > Playback Options"
echo "2. Select 'R-PI DAC' as DAC Model"
echo "3. Save and Reboot"
echo ""
echo "After reboot, open this plugin's settings to configure"
echo "your ES9018K2M DAC (filters, DPLL, balance, etc.)"
echo ""
echo "The plugin will automatically:"
echo "  - Detect the DAC on I2C bus"
echo "  - Initialize with optimal register settings"
echo "  - Sync volume with Volumio"
echo ""

echo "plugininstallend"
