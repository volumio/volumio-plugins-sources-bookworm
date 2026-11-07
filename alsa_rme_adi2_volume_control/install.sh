#!/bin/bash

# Name of the plugin
PLUGIN_NAME="alsa-rme-adi2-volume-control"

# Category and plugin directory names under /data/plugins/
PLUGIN_CATEGORY="system_hardware"
PLUGIN_DIRECTORY="alsa_rme_adi2_volume_control"

# ###########################################################################
# DO NOT EDIT BELOW THIS LINE
# ###########################################################################

EXIT_CODE=0
EXIT_CODE_OK=0
EXIT_CODE_ERROR=1

on_exit () {
    echo "Exit Status: $EXIT_CODE"
    if [ $EXIT_CODE -eq $EXIT_CODE_OK ]
    then
        echo "Plugin $PLUGIN_NAME installed correctly"
    else
        echo "Plugin $PLUGIN_NAME failed to install"
    fi
    echo "plugininstallend"
}
trap on_exit EXIT

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

# File name of the service installer, located in the
# $SERVICE_DIRECTORY_PATH/$ARCHITECTURE/ directory.
SERVICE_INSTALLER_FILE_NAME="install.sh"

# Name of the background service"
SERVICE_NAME="alsa-rme-adi2-volume-control.service"

# Path of the sudoers file for this service
SUDOERS_FILE_PATH="/etc/sudoers.d/alsa-rme-adi2-volume-control"

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
    exit $EXIT_CODE_ERROR ;
esac
echo "[INFO] Architecture (Volumio): '$ARCHITECTURE'"

echo "[INFO] Run the service installer ..."
SERVICE_INSTALLER_PATH="$SERVICE_DIRECTORY_PATH/$ARCHITECTURE/$SERVICE_INSTALLER_FILE_NAME"
echo "[INFO] Using service installer file '$SERVICE_INSTALLER_PATH'"
sudo bash "$SERVICE_INSTALLER_PATH" --from-source --no-compile --architecture "$ARCHITECTURE"
EXIT_CODE=$?
if [ $EXIT_CODE -ne $EXIT_CODE_OK ]
then
    echo "[ERRO] The service installer returned $EXIT_CODE"
    exit $EXIT_CODE
fi
echo "[INFO] Run the service installer ... done"

# Per Volumio plugins documentation, we want the effect of the plugin
# to be controlled by the plugin enable/disable event.
#
# Therefore, here we stop and disable the service after it has been installed.
echo "[INFO] Stopping and disabling the systemd service ..."
sudo systemctl stop "$SERVICE_NAME"
sudo systemctl disable "$SERVICE_NAME"
echo "[INFO] Stopping and disabling the systemd service ... done"

# Commands called by index.js
echo "[INFO] Creating sudoers file ..."
cat > "$SUDOERS_FILE_PATH" << EOF
# ALSA RME ADI-2 Volume Control
volumio ALL=(ALL) NOPASSWD: /bin/systemctl status $SERVICE_NAME
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start $SERVICE_NAME
volumio ALL=(ALL) NOPASSWD: /bin/systemctl stop $SERVICE_NAME
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart $SERVICE_NAME
volumio ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
EOF
echo "[INFO] Creating sudoers file ... done"

# The required
# echo "plugininstallend"
# to end the plugin install will be called by the on_exit trap handler
EXIT_CODE=$EXIT_CODE_OK
exit $EXIT_CODE
