#!/bin/bash

# pi_screen_setup install script
# Exit on error
set -e

# Cleanup function on error
cleanup() {
    if [ $? -ne 0 ]; then
        echo "Installation failed, cleaning up..."
    fi
}
trap cleanup EXIT

# Get plugin directory info from package.json
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_TYPE=$(grep -oP '"plugin_type"\s*:\s*"\K[^"]+' "${PLUGIN_DIR}/package.json")
PLUGIN_NAME=$(grep -oP '"name"\s*:\s*"\K[^"]+' "${PLUGIN_DIR}/package.json")

echo "Installing ${PLUGIN_NAME}..."

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "Warning: Cannot detect device model. This plugin is designed for Raspberry Pi."
fi

MODEL=$(cat /proc/device-tree/model 2>/dev/null || echo "Unknown")
echo "Detected: ${MODEL}"

# Verify it's a Pi
if [[ ! "${MODEL}" =~ "Raspberry Pi" ]]; then
    echo "Warning: This does not appear to be a Raspberry Pi."
    echo "The plugin may not function correctly."
fi

# Setup sudoers for volumio user to write to specific /boot files
# Note: File must be named volumio-user-* to come AFTER volumio-user alphabetically
SUDOERS_FILE="/etc/sudoers.d/volumio-user-pi_screen_setup"
echo "Creating sudoers entry for pi_screen_setup..."
cat > "${SUDOERS_FILE}" << 'EOF'
# pi_screen_setup plugin - allow volumio user to manage specific boot config files
volumio ALL=(ALL) NOPASSWD: /bin/cp * /boot/videoconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/cp * /boot/config.txt
volumio ALL=(ALL) NOPASSWD: /bin/cp * /boot/cmdline.txt
volumio ALL=(ALL) NOPASSWD: /bin/cp * /boot/volumioconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/cp * /boot/userconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/chmod 644 /boot/videoconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/chmod 644 /boot/config.txt
volumio ALL=(ALL) NOPASSWD: /bin/chmod 644 /boot/cmdline.txt
volumio ALL=(ALL) NOPASSWD: /bin/chmod 644 /boot/volumioconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/chmod 644 /boot/userconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/rm /boot/videoconfig.txt
volumio ALL=(ALL) NOPASSWD: /bin/rm -f /boot/videoconfig.txt
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

# Create data directory for backups
DATA_DIR="/data/plugins/${PLUGIN_TYPE}/${PLUGIN_NAME}"
BACKUP_DIR="${DATA_DIR}/backups"
FACTORY_DIR="${BACKUP_DIR}/factory"
RESTORE_POINTS_DIR="${BACKUP_DIR}/restore_points"

echo "Creating data directories..."
mkdir -p "${BACKUP_DIR}"
mkdir -p "${FACTORY_DIR}"
mkdir -p "${RESTORE_POINTS_DIR}"
chown -R volumio:volumio "${DATA_DIR}"
chmod 755 "${DATA_DIR}"
chmod 755 "${BACKUP_DIR}"
chmod 755 "${FACTORY_DIR}"
chmod 755 "${RESTORE_POINTS_DIR}"

# Verify boot partition access
if [ ! -d "/boot" ]; then
    echo "Error: /boot directory not accessible"
    exit 1
fi

if [ ! -f "/boot/config.txt" ]; then
    echo "Error: /boot/config.txt not found"
    exit 1
fi

echo "Boot partition verified."

# Create factory backups (only on first install - do not overwrite existing)
echo "Checking factory backups..."
FACTORY_CREATED=0

if [ ! -f "${FACTORY_DIR}/config.txt" ]; then
    echo "Creating factory backup of config.txt..."
    cp /boot/config.txt "${FACTORY_DIR}/config.txt"
    FACTORY_CREATED=1
fi

if [ ! -f "${FACTORY_DIR}/cmdline.txt" ] && [ -f "/boot/cmdline.txt" ]; then
    echo "Creating factory backup of cmdline.txt..."
    cp /boot/cmdline.txt "${FACTORY_DIR}/cmdline.txt"
    FACTORY_CREATED=1
fi

if [ ! -f "${FACTORY_DIR}/volumioconfig.txt" ] && [ -f "/boot/volumioconfig.txt" ]; then
    echo "Creating factory backup of volumioconfig.txt..."
    cp /boot/volumioconfig.txt "${FACTORY_DIR}/volumioconfig.txt"
    FACTORY_CREATED=1
fi

if [ ! -f "${FACTORY_DIR}/userconfig.txt" ] && [ -f "/boot/userconfig.txt" ]; then
    echo "Creating factory backup of userconfig.txt..."
    cp /boot/userconfig.txt "${FACTORY_DIR}/userconfig.txt"
    FACTORY_CREATED=1
fi

if [ ${FACTORY_CREATED} -eq 1 ]; then
    # Record when factory backup was created
    date -Iseconds > "${FACTORY_DIR}/backup_date.txt"
    chown -R volumio:volumio "${FACTORY_DIR}"
    echo "Factory backups created."
else
    echo "Factory backups already exist - preserving original state."
fi

# Check for existing display configuration that might need migration
echo "Checking for existing display configuration..."
MIGRATION_NEEDED=0

# Note: display_*rotate settings belong to Touch Display plugin - do not detect those
if [ -f "/boot/volumioconfig.txt" ]; then
    if grep -qE "^dtoverlay=vc4-(f?)kms|^hdmi_|^sdtv_|^framebuffer_|^enable_tvout|^display_auto_detect|^display_default_lcd" /boot/volumioconfig.txt 2>/dev/null; then
        echo "Found display settings in volumioconfig.txt"
        MIGRATION_NEEDED=1
    fi
fi

if [ -f "/boot/userconfig.txt" ]; then
    if grep -qE "^dtoverlay=vc4-(f?)kms|^hdmi_|^sdtv_|^framebuffer_|^enable_tvout|^display_auto_detect|^display_default_lcd" /boot/userconfig.txt 2>/dev/null; then
        echo "Found display settings in userconfig.txt"
        MIGRATION_NEEDED=1
    fi
fi

if [ ${MIGRATION_NEEDED} -eq 1 ]; then
    echo ""
    echo "NOTE: Existing display configuration detected."
    echo "The plugin will offer to migrate these settings on first use."
    echo ""
fi

# Create initial empty videoconfig.txt if it doesn't exist
# This prevents errors if config.txt already has include line
if [ ! -f "/boot/videoconfig.txt" ]; then
    echo "# Pi Screen Setup - Configuration pending" > /boot/videoconfig.txt
    echo "# Run the configuration wizard in Volumio to configure display settings" >> /boot/videoconfig.txt
    chown root:root /boot/videoconfig.txt
    chmod 644 /boot/videoconfig.txt
    echo "Created placeholder /boot/videoconfig.txt"
fi

echo "Installation complete."
echo "plugininstallend"
