#!/bin/bash

# Name of the plugin
PLUGIN_NAME="alsa-rme-adi2-volume-control"

# Category and plugin directory names under /data/plugins/
PLUGIN_CATEGORY="system_hardware"
PLUGIN_DIRECTORY="alsa_rme_adi2_volume_control"

# ###########################################################################
# DO NOT EDIT BELOW THIS LINE
# ###########################################################################

# Exit codes
EXIT_CODE=0
EXIT_CODE_OK=0
EXIT_CODE_ERROR=1

# The canonical architecture names in Volumio are "amd64" and "armhf".
#
# Note that on ARM the userspace is always 32-bit,
# even on 64-bit CPUs, hence we set "armhf" for both here.
ARCHITECTURE_CANONICAL_NAME_X86_64="amd64"
ARCHITECTURE_CANONICAL_NAME_ARM="armhf"
ARCHITECTURE_CANONICAL_NAME_AARCH64="armhf"

# Absolute path of the directory containing this script
#SCRIPT_DIRECTORY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIRECTORY_PATH="/data/plugins/$PLUGIN_CATEGORY/$PLUGIN_DIRECTORY"

# Absolute path of the service/ directory,
# which is expected to contain a child directory
# for each of the canonical architecture names.
SERVICE_DIRECTORY_PATH="$SCRIPT_DIRECTORY_PATH/service"

# Absolute path of the bin/ directory,
# which is expected to contain one sub-directory
# for each of the supported architectures
SERVICE_EXECUTABLE_BIN_DIRECTORY_PATH="$SERVICE_DIRECTORY_PATH/bin"
SERVICE_EXECUTABLE_FILE_NAME="alsa-rme-adi2-volume-control"
SERVICE_EXECUTABLE_FILE_DESTINATION_PATH="/usr/local/bin/$SERVICE_EXECUTABLE_FILE_NAME"

# Absolute path of the service unit file
SERVICE_UNIT_FILE_NAME="alsa-rme-adi2-volume-control.service"
SERVICE_UNIT_FILE_SOURCE_PATH="$SERVICE_DIRECTORY_PATH/systemd/$SERVICE_UNIT_FILE_NAME"
SERVICE_UNIT_FILE_DESTINATION_PATH="/lib/systemd/system/$SERVICE_UNIT_FILE_NAME"
SERVICE_UNIT_FILE_TMP_PATH="/tmp/$SERVICE_UNIT_FILE_NAME"

# Absolute path of the service preset file
SERVICE_PRESET_FILE_NAME="99-alsa-rme-adi2-volume-control.preset"
SERVICE_PRESET_FILE_SOURCE_PATH="$SERVICE_DIRECTORY_PATH/systemd/$SERVICE_PRESET_FILE_NAME"
SERVICE_PRESET_FILE_DESTINATION_PATH="/usr/lib/systemd/system-preset/$SERVICE_PRESET_FILE_NAME"

# Absolute path of the udev rules file
SERVICE_UDEV_RULES_FILE_NAME="99-alsa-rme-adi2-volume-control.rules"
SERVICE_UDEV_RULES_FILE_SOURCE_PATH="$SERVICE_DIRECTORY_PATH/udev/$SERVICE_UDEV_RULES_FILE_NAME"
SERVICE_UDEV_RULES_FILE_DESTINATION_PATH="/etc/udev/rules.d/$SERVICE_UDEV_RULES_FILE_NAME"

# Absolute path of the service sudoers file
SERVICE_SUDOERS_FILE_NAME="alsa-rme-adi2-volume-control"
SERVICE_SUDOERS_FILE_SOURCE_PATH="$SERVICE_DIRECTORY_PATH/sudoers/$SERVICE_SUDOERS_FILE_NAME"
SERVICE_SUDOERS_FILE_DESTINATION_PATH="/etc/sudoers.d/$SERVICE_SUDOERS_FILE_NAME"

# Absolute path of the installer and uninstaller
INSTALLER_FILE_PATH="$SCRIPT_DIRECTORY_PATH/install.sh"
UNINSTALLER_FILE_PATH="$SCRIPT_DIRECTORY_PATH/uninstall.sh"

# Trap for exit codes
on_exit () {
    echo "[INFO] Exit Status: $EXIT_CODE"
    if [ $EXIT_CODE -eq $EXIT_CODE_OK ]
    then
        echo "[INFO] Plugin $PLUGIN_NAME uninstalled correctly"
    else
        echo "[ERRO] Plugin $PLUGIN_NAME failed to uninstall"
    fi
    # required to end the plugin installation
    echo "pluginuninstallend"
}
trap on_exit EXIT

# Set the correct architecture
ARCHITECTURE=`uname -m`
case "$ARCHITECTURE" in
    amd64|x86_64)
        # 64-bit OS on Intel/AMD 64-bit CPU (PC)
        ARCHITECTURE="$ARCHITECTURE_CANONICAL_NAME_X86_64"
        ;;
    arm|armhf|armv7l|armv8l)
        # 32-bit OS, even on a 64-bit CPU (e.g., Raspberry Pi 3)
        ARCHITECTURE="$ARCHITECTURE_CANONICAL_NAME_ARM"
        ;;
    aarch64|arm64)
        # 64-bit OS on ARM 64-bit CPU (e.g., Raspberry Pi 5)
        ARCHITECTURE="$ARCHITECTURE_CANONICAL_NAME_AARCH64"
        ;;
    *)
        echo "[ERRO] Architecture $ARCHITECTURE has no pre-built executable."
        echo "[ERRO] Supported architectures are: 'amd64', 'armhf'."
        EXIT_CODE=$EXIT_CODE_ERROR
        exit $EXIT_CODE ;
esac
echo "[INFO] Architecture (Volumio): '$ARCHITECTURE'"

echo "[INFO] Remove sudoers file ..."
sudo rm -f "$SERVICE_SUDOERS_FILE_DESTINATION_PATH"
echo "[INFO] Remove sudoers file ... done"

echo "[INFO] Remove udev rules file ..."
sudo rm -f "$SERVICE_UDEV_RULES_FILE_DESTINATION_PATH"
sudo udevadm control --reload-rules || true
sudo udevadm trigger || true
echo "[INFO] Remove udev rules file ... done"

echo "[INFO] Uninstall service ..."
sudo systemctl stop "$SERVICE_UNIT_FILE_NAME" || true
sudo systemctl disable "$SERVICE_UNIT_FILE_NAME" || true
sudo rm -f "$SERVICE_UNIT_FILE_DESTINATION_PATH"
sudo rm -f "$SERVICE_PRESET_FILE_DESTINATION_PATH"
sudo systemctl daemon-reload || true
echo "[INFO] Uninstall service ... done"

echo "[INFO] Remove service executable file ..."
sudo rm -f "$SERVICE_EXECUTABLE_FILE_DESTINATION_PATH"
echo "[INFO] Remove service executable file ... done"

# The required
# echo "plugininstallend"
# to end the plugin install will be called by the on_exit trap handler
EXIT_CODE=$EXIT_CODE_OK
exit $EXIT_CODE
