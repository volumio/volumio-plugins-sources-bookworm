#!/bin/bash

# Name of the plugin
PLUGIN_NAME="alsa-rme-adi2-volume"

PLUGIN_CATEGORY="system_hardware"
PLUGIN_DIRECTORY="alsa_rme_adi2_volume"

# In a later version we will wire the suitable settings
# from the plugin configuration page.
# For now the default values for the service
# should work for most users.
#
# RUN_ARGUMENTS="--run-arguments \"--verbose\""
RUN_ARGUMENTS=""

# ###########################################################################
# CONSTANTS
# ###########################################################################

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

# ###########################################################################
# DO NOT EDIT BELOW THIS LINE
# ###########################################################################

# Set the correct architecture
ARCHITECTURE=`dpkg --print-architecture`
if [ "$ARCHITECTURE" = "amd64" ] | [ "$ARCHITECTURE" = "x86_64" ]
then
    # 64-bit OS on Intel/AMD 64-bit CPU (PC)
    ARCHITECTURE="$ARCHITECTURE_CANONICAL_NAME_X86_64"
elif [ "$ARCHITECTURE" = "arm" ] | [ "$ARCHITECTURE" = "armhf" ] || [ "$ARCHITECTURE" = "armv7l" ] || [ "$ARCHITECTURE" = "armv8l" ]
then
    # 32-bit OS, even on a 64-bit CPU (e.g., Raspberry Pi 3)
    ARCHITECTURE="$ARCHITECTURE_CANONICAL_NAME_ARM"
elif [ "$ARCHITECTURE" = "aarch64" ] | [ "$ARCHITECTURE" = "arm64" ]
then
    # 64-bit OS on ARM 64-bit CPU (e.g., Raspberry Pi 5)
    ARCHITECTURE="$ARCHITECTURE_CANONICAL_NAME_AARCH64"
else
    echo "[ERRO] Architecture $ARCHITECTURE has no pre-built executable."
    echo "[ERRO] Supported architectures are: 'amd64', 'armhf'."
    exit 3
fi
echo "[INFO] Architecture (Volumio): '$ARCHITECTURE'"

echo "[INFO] Run the service installer ..."
SERVICE_INSTALLER_PATH="$SERVICE_DIRECTORY_PATH/$ARCHITECTURE/$SERVICE_INSTALLER_FILE_NAME"
echo "[INFO] Using service installer file '$SERVICE_INSTALLER_PATH'"
sudo bash "$SERVICE_INSTALLER_PATH" --uninstall --architecture "$ARCHITECTURE"
echo "[INFO] Run the service installer ... done"

#requred to end the plugin uninstall
echo "Done"
echo "pluginuninstallend"
