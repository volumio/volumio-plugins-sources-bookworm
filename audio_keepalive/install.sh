#!/bin/bash
echo "Installing Audio Keepalive"

ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')

if [ -z "$ARCH" ]; then
    echo "ERROR: Could not detect Volumio architecture"
    echo "plugininstallend"
    exit 1
fi

echo "Detected architecture: $ARCH"

PLUGIN_PATH="/data/plugins/audio_interface/audio_keepalive"
ALSA_BASE_PATH="${PLUGIN_PATH}/alsa-lib"

case "$ARCH" in
    arm|armv7)
        SRC="${ALSA_BASE_PATH}/armhf/libasound_module_pcm_keepalive.so"
        ALSA_PLUGIN_DIR="/usr/lib/arm-linux-gnueabihf/alsa-lib"
        ;;
    armv8)
        SRC="${ALSA_BASE_PATH}/armhf/libasound_module_pcm_keepalive.so"
        ALSA_PLUGIN_DIR="/usr/lib/arm-linux-gnueabihf/alsa-lib"
        ;;
    x64)
        SRC="${ALSA_BASE_PATH}/amd64/libasound_module_pcm_keepalive.so"
        ALSA_PLUGIN_DIR="/usr/lib/x86_64-linux-gnu/alsa-lib"
        ;;
    *)
        echo "ERROR: Architecture $ARCH not supported"
        echo "plugininstallend"
        exit 1
        ;;
esac

if [ -f "$SRC" ]; then
    sudo install -m 0644 "$SRC" "${ALSA_PLUGIN_DIR}/libasound_module_pcm_keepalive.so"
    echo "Installed ALSA keepalive plugin for ${ARCH} to ${ALSA_PLUGIN_DIR}"
else
    echo "ERROR: Binary not found: ${SRC}"
    echo "plugininstallend"
    exit 1
fi

echo "plugininstallend"
