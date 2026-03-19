#!/bin/bash

# pi_screen_setup uninstall script

# Get plugin directory info from package.json
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_TYPE=$(grep -oP '"plugin_type"\s*:\s*"\K[^"]+' "${PLUGIN_DIR}/package.json")
PLUGIN_NAME=$(grep -oP '"name"\s*:\s*"\K[^"]+' "${PLUGIN_DIR}/package.json")

echo "Uninstalling ${PLUGIN_NAME}..."

# Paths
DATA_DIR="/data/plugins/${PLUGIN_TYPE}/${PLUGIN_NAME}"
FACTORY_DIR="${DATA_DIR}/backups/factory"

# Check if factory backups exist
if [ -d "${FACTORY_DIR}" ]; then
    echo ""
    echo "Restoring factory defaults from installation backup..."
    
    # Restore config.txt (this also removes include line)
    if [ -f "${FACTORY_DIR}/config.txt" ]; then
        echo "Restoring original config.txt..."
        sudo cp "${FACTORY_DIR}/config.txt" /boot/config.txt
        sudo chmod 644 /boot/config.txt
    else
        # No factory backup - just remove include line
        if [ -f "/boot/config.txt" ]; then
            if grep -q "^include videoconfig.txt" /boot/config.txt; then
                echo "Removing include line from config.txt..."
                sudo sed -i '/^include videoconfig.txt$/d' /boot/config.txt
            fi
        fi
    fi
    
    # Restore cmdline.txt
    if [ -f "${FACTORY_DIR}/cmdline.txt" ]; then
        echo "Restoring original cmdline.txt..."
        sudo cp "${FACTORY_DIR}/cmdline.txt" /boot/cmdline.txt
        sudo chmod 644 /boot/cmdline.txt
    fi
    
    # Restore volumioconfig.txt if we had a backup
    if [ -f "${FACTORY_DIR}/volumioconfig.txt" ]; then
        echo "Restoring original volumioconfig.txt..."
        sudo cp "${FACTORY_DIR}/volumioconfig.txt" /boot/volumioconfig.txt
        sudo chmod 644 /boot/volumioconfig.txt
    fi
    
    # Restore userconfig.txt if we had a backup
    if [ -f "${FACTORY_DIR}/userconfig.txt" ]; then
        echo "Restoring original userconfig.txt..."
        sudo cp "${FACTORY_DIR}/userconfig.txt" /boot/userconfig.txt
        sudo chmod 644 /boot/userconfig.txt
    fi
    
    echo "Factory defaults restored."
else
    # No factory backups - just remove include line
    echo "No factory backups found - removing plugin configuration only..."
    if [ -f "/boot/config.txt" ]; then
        if grep -q "^include videoconfig.txt" /boot/config.txt; then
            echo "Removing include line from config.txt..."
            sudo sed -i '/^include videoconfig.txt$/d' /boot/config.txt
        fi
    fi
fi

# Remove videoconfig.txt (plugin-created file)
if [ -f "/boot/videoconfig.txt" ]; then
    echo "Removing /boot/videoconfig.txt..."
    sudo rm -f /boot/videoconfig.txt
fi

# Remove sudoers configuration
SUDOERS_FILE="/etc/sudoers.d/volumio-user-pi_screen_setup"
if [ -f "${SUDOERS_FILE}" ]; then
    echo "Removing sudo permissions..."
    sudo rm -f "${SUDOERS_FILE}"
fi

# Remove data directory (backups and config)
if [ -d "${DATA_DIR}" ]; then
    echo "Removing plugin data directory..."
    rm -rf "${DATA_DIR}"
fi

echo ""
echo "Uninstallation complete."
echo ""
echo "Factory boot configuration has been restored."
echo "A reboot is recommended to apply the original settings."
echo ""
echo "pluginuninstallend"
