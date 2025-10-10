#!/bin/bash

echo "Installing Raspberry Pi EEPROM Updater Plugin"

# Check if rpi-eeprom package is installed
if ! dpkg -l | grep -q "rpi-eeprom"; then
    echo "rpi-eeprom package not found. Installing..."
    apt-get update
    apt-get install -y rpi-eeprom
    if [ $? -ne 0 ]; then
        echo "Failed to install rpi-eeprom package"
        exit 1
    fi
fi

# Verify rpi-eeprom-update tool exists
if [ ! -f /usr/bin/rpi-eeprom-update ]; then
    echo "ERROR: rpi-eeprom-update tool not found after installation"
    exit 1
fi

# Test if hardware is supported
/usr/bin/rpi-eeprom-update -l > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "WARNING: This hardware may not support EEPROM updates"
    echo "Plugin will install but may not function correctly"
fi

# Create sudoers entry for volumio user
echo "Creating sudoers entry for EEPROM operations..."
cat > /etc/sudoers.d/010_rpi-eeprom-updater << EOF
volumio ALL=(ALL) NOPASSWD: /usr/bin/tee /etc/default/rpi-eeprom-update, /usr/bin/rpi-eeprom-update
EOF

# Set proper permissions on sudoers file
chmod 0440 /etc/sudoers.d/010_rpi-eeprom-updater

# Validate sudoers syntax
visudo -c -f /etc/sudoers.d/010_rpi-eeprom-updater
if [ $? -ne 0 ]; then
    echo "ERROR: Invalid sudoers syntax"
    rm -f /etc/sudoers.d/010_rpi-eeprom-updater
    exit 1
fi

echo "Raspberry Pi EEPROM Updater Plugin installed successfully"
echo "plugininstallend"
