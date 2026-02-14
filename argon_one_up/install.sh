#!/bin/bash

echo "Installing Argon ONE UP plugin"

# Get architecture
ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')
echo "Architecture: ${ARCH}"

# Install required packages
echo "Installing dependencies..."
apt-get update
apt-get install -y i2c-tools python3-evdev

# Optional: ddcutil (display brightness), wpctl from PipeWire (volume) - for keyboard hotkeys
apt-get install -y ddcutil 2>/dev/null || true

# Boot config files (Volumio includes userconfig.txt last, so it can override)
USERCONFIG="/boot/userconfig.txt"

if [ ! -f "$USERCONFIG" ]; then
    touch "$USERCONFIG" 2>/dev/null || true
fi

# Helper: check if param exists in userconfig.txt (we only check userconfig to avoid duplicates there)
# Note: We intentionally add to userconfig even if a setting exists in volumioconfig.txt under a
# different scope (e.g., dwc2 is [cm4] only, pciex1_gen=2 is [pi5] - we need to override/add for Pi 5)
param_in_userconfig() {
    local pattern="$1"
    grep -q "^[[:space:]]*${pattern}" "$USERCONFIG" 2>/dev/null
}

# Helper: add param to userconfig if not already there
add_boot_param() {
    local pattern="$1"
    local line="$2"
    if ! param_in_userconfig "$pattern"; then
        echo "$line" >> "$USERCONFIG"
        echo "Added: $line"
    else
        echo "Already present: $pattern"
    fi
}

echo "Configuring boot parameters for Argon ONE UP..."

# Argon ONE UP required settings (for Pi 5 / CM5):
# - dtparam=i2c_arm=on     -> Already in volumioconfig.txt [all], skip
# - dtparam=uart0=on       -> Not present, add (keyboard/trackpad)
# - dtoverlay=dwc2         -> Only [cm4] in volumioconfig, add for Pi 5
# - dtparam=pciex1_gen=3   -> volumioconfig has =2 for [pi5], override to =3
# - usb_max_current_enable -> Not present, add
# - dtparam=ant2           -> Not present, add (external antenna)

add_boot_param "dtparam=uart0" "dtparam=uart0=on"
add_boot_param "dtoverlay=dwc2" "dtoverlay=dwc2,dr_mode=host"
add_boot_param "dtparam=pciex1_gen" "dtparam=pciex1_gen=3"
add_boot_param "usb_max_current_enable" "usb_max_current_enable=1"
add_boot_param "dtparam=ant2" "dtparam=ant2"

# Pi 5 PWM fan control (Argon ONE UP uses the Pi 5's cooling_fan interface)
# This enables the fan controller and exposes fan speed via /sys/devices/platform/cooling_fan/
add_boot_param "dtparam=cooling_fan" "dtparam=cooling_fan"
# Fan temperature curve (millidegrees Celsius -> PWM speed 0-255)
add_boot_param "dtparam=fan_temp0=" "dtparam=fan_temp0=45000,fan_temp0_speed=125"
add_boot_param "dtparam=fan_temp1=" "dtparam=fan_temp1=50000,fan_temp1_speed=175"
add_boot_param "dtparam=fan_temp2=" "dtparam=fan_temp2=55000,fan_temp2_speed=225"
add_boot_param "dtparam=fan_temp3=" "dtparam=fan_temp3=60000,fan_temp3_speed=250"

# Load I2C kernel module
if ! lsmod | grep -q i2c_dev; then
    modprobe i2c-dev
fi

# Ensure i2c-dev loads on boot
if ! grep -q "^i2c-dev" /etc/modules; then
    echo "i2c-dev" >> /etc/modules
fi

# Create sudoers entry for volumio user
# Note: File must be named volumio-user-* to come AFTER volumio-user alphabetically
SUDOERS_FILE="/etc/sudoers.d/volumio-user-argon_one_up"
echo "Creating sudoers entry for argon_one_up..."
cat > "${SUDOERS_FILE}" << 'EOF'
# Argon ONE UP plugin - allow volumio user to control hardware
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cset
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cget
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cdetect
volumio ALL=(ALL) NOPASSWD: /sbin/shutdown
volumio ALL=(ALL) NOPASSWD: /sbin/reboot
volumio ALL=(ALL) NOPASSWD: /usr/bin/rpi-eeprom-config
EOF

chmod 0440 "${SUDOERS_FILE}"

# Validate sudoers syntax
visudo -c -f "${SUDOERS_FILE}"
if [ $? -ne 0 ]; then
    echo "ERROR: Invalid sudoers syntax"
    rm -f "${SUDOERS_FILE}"
    exit 1
fi
echo "Sudoers configuration complete."

# Check if I2C devices are accessible
echo "Checking I2C bus..."
if [ -e /dev/i2c-1 ]; then
    echo "I2C bus 1 available"
else
    echo "WARNING: I2C bus not available. Reboot may be required."
fi

# Keyboard handler service (Argon ONE UP laptop: brightness, volume, battery key)
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
KEYBOARD_SCRIPT="${PLUGIN_DIR}/argonkeyboard.py"
SERVICE_NAME="argon-one-up-keyboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ -f "$KEYBOARD_SCRIPT" ]; then
    echo "Installing keyboard handler service..."
    cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=Argon ONE UP keyboard handler (brightness, volume, battery)
After=volumio.service
PartOf=volumio.service

[Service]
Type=simple
User=volumio
Group=volumio
Environment=ARGON_ONE_UP_CONFIG=/data/configuration/system_hardware/argon_one_up/config.json
ExecStart=/usr/bin/python3 ${KEYBOARD_SCRIPT} SERVICE
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}.service" 2>/dev/null || true
    systemctl start "${SERVICE_NAME}.service" 2>/dev/null || true
    echo "Keyboard handler service installed and started."
else
    echo "Keyboard script not found, skipping keyboard service."
fi

echo "Argon ONE UP plugin installed successfully"
echo "plugininstallend"
