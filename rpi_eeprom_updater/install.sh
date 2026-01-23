#!/bin/bash

echo "Installing Raspberry Pi EEPROM Updater Plugin"

# Stop rpi-eeprom-update service to prevent automatic firmware updates during package operations
echo "Stopping rpi-eeprom-update service..."
if systemctl is-active --quiet rpi-eeprom-update.service; then
    systemctl stop rpi-eeprom-update.service
    echo "Service stopped"
else
    echo "Service not active, continuing..."
fi

# Ensure rpi-eeprom package is installed and up to date
echo "Checking rpi-eeprom package..."
apt-get update

if ! dpkg -l | grep -q "rpi-eeprom"; then
    echo "rpi-eeprom package not found. Installing..."
    apt-get install -y rpi-eeprom
    if [ $? -ne 0 ]; then
        echo "Failed to install rpi-eeprom package"
        exit 1
    fi
else
    echo "rpi-eeprom package found. Ensuring it is up to date..."
    apt-get install -y --only-upgrade rpi-eeprom
    if [ $? -ne 0 ]; then
        echo "Failed to upgrade rpi-eeprom package"
        exit 1
    fi
fi

# Verify rpi-eeprom-update tool exists (can be in /usr/bin or /usr/sbin)
if [ -f /usr/bin/rpi-eeprom-update ]; then
    echo "rpi-eeprom-update tool found at /usr/bin/rpi-eeprom-update"
elif [ -f /usr/sbin/rpi-eeprom-update ]; then
    echo "rpi-eeprom-update tool found at /usr/sbin/rpi-eeprom-update"
else
    echo "ERROR: rpi-eeprom-update tool not found after installation"
    exit 1
fi

# Verify vcgencmd tool exists (can be in /usr/bin or /usr/sbin)
if [ -f /usr/bin/vcgencmd ]; then
    echo "vcgencmd tool found at /usr/bin/vcgencmd"
elif [ -f /usr/sbin/vcgencmd ]; then
    echo "vcgencmd tool found at /usr/sbin/vcgencmd"
else
    echo "ERROR: vcgencmd tool not found"
    echo "This tool is required and should be part of libraspberrypi-bin package"
    exit 1
fi

# Test if hardware is supported by attempting to list available updates
if [ -f /usr/bin/rpi-eeprom-update ]; then
    /usr/bin/rpi-eeprom-update -l > /dev/null 2>&1
elif [ -f /usr/sbin/rpi-eeprom-update ]; then
    /usr/sbin/rpi-eeprom-update -l > /dev/null 2>&1
fi

if [ $? -ne 0 ]; then
    echo "WARNING: This hardware may not support EEPROM updates"
    echo "Plugin will install but may not function correctly"
fi

# Create sudoers entry for volumio user
# Note: reboot, tee, mv, rm, chmod are already permitted in base Volumio sudoers
# Adding rpi-eeprom-update and cp with wildcards to allow all arguments
echo "Creating sudoers entry for EEPROM operations..."
cat > /etc/sudoers.d/volumio-user-rpi_updater << EOF
volumio ALL=(ALL) NOPASSWD: /usr/bin/rpi-eeprom-update
volumio ALL=(ALL) NOPASSWD: /usr/sbin/rpi-eeprom-update
volumio ALL=(ALL) NOPASSWD: /bin/cp
volumio ALL=(ALL) NOPASSWD: /usr/bin/cp
EOF

# Set proper permissions on sudoers file
chmod 0440 /etc/sudoers.d/volumio-user-rpi_updater

# Validate sudoers syntax
visudo -c -f /etc/sudoers.d/volumio-user-rpi_updater
if [ $? -ne 0 ]; then
    echo "ERROR: Invalid sudoers syntax"
    rm -f /etc/sudoers.d/volumio-user-rpi_updater
    exit 1
fi

# Mask rpi-eeprom-update service to prevent automatic firmware updates
echo "Masking rpi-eeprom-update service..."
if systemctl list-unit-files | grep -q "rpi-eeprom-update.service"; then
    systemctl mask rpi-eeprom-update.service
    echo "Service masked - automatic updates disabled"
else
    echo "Service not found in system, skipping..."
fi

echo "Raspberry Pi EEPROM Updater Plugin installed successfully"
echo "plugininstallend"
