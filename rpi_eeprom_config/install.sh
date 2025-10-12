#!/bin/bash
echo "Installing Raspberry Pi EEPROM Configuration Manager Plugin"

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

# Verify rpi-eeprom-config tool exists
if [ ! -f /usr/bin/rpi-eeprom-config ]; then
  echo "ERROR: rpi-eeprom-config tool not found after installation"
  exit 1
fi

# Verify vcgencmd tool exists
if [ ! -f /usr/bin/vcgencmd ]; then
  echo "ERROR: vcgencmd tool not found"
  echo "This tool is required and should be part of libraspberrypi-bin package"
  exit 1
fi

# Test if hardware is supported by attempting to read bootloader config
/usr/bin/vcgencmd bootloader_config > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "WARNING: This hardware may not support EEPROM configuration"
  echo "Plugin will install but may not function correctly"
fi

# Ensure flashrom package is installed and up to date
echo "Checking flashrom package..."
if ! dpkg -l | grep -q "flashrom"; then
  echo "flashrom package not found. Installing..."
  apt-get install -y flashrom
  if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install flashrom package"
    echo "EEPROM updates will require reboot to take effect"
  fi
else
  echo "flashrom package found. Ensuring it is up to date..."
  apt-get install -y --only-upgrade flashrom
  if [ $? -ne 0 ]; then
    echo "WARNING: Failed to upgrade flashrom package"
  fi
fi

# Verify flashrom tool exists
if [ ! -f /usr/bin/flashrom ]; then
  echo "WARNING: flashrom tool not found"
  echo "EEPROM updates will require reboot to take effect"
else
  echo "flashrom tool found - EEPROM updates will apply immediately"
fi

# Create sudoers entry for volumio user
# Note: reboot, tee, mv, rm, chmod are already permitted in base Volumio sudoers
# Adding rpi-eeprom-config which is required by this plugin
echo "Creating sudoers entry for EEPROM operations..."
cat > /etc/sudoers.d/010_rpi-eeprom-config << EOF
volumio ALL=(ALL) NOPASSWD: /usr/bin/rpi-eeprom-config
EOF

# Set proper permissions on sudoers file
chmod 0440 /etc/sudoers.d/010_rpi-eeprom-config

# Validate sudoers syntax
visudo -c -f /etc/sudoers.d/010_rpi-eeprom-config
if [ $? -ne 0 ]; then
  echo "ERROR: Invalid sudoers syntax"
  rm -f /etc/sudoers.d/010_rpi-eeprom-config
  exit 1
fi

echo "Raspberry Pi EEPROM Configuration Manager Plugin installed successfully"
echo "plugininstallend"
