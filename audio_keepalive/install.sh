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

case "$ARCH" in
    arm|armv7)
        BIN_ARCH="armhf"
        ALSA_PLUGIN_DIR="/usr/lib/arm-linux-gnueabihf/alsa-lib"
        ;;
    armv8|aarch64)
        BIN_ARCH="aarch64"
        ALSA_PLUGIN_DIR="/usr/lib/aarch64-linux-gnu/alsa-lib"
        ;;
    x64|amd64)
        BIN_ARCH="amd64"
        ALSA_PLUGIN_DIR="/usr/lib/x86_64-linux-gnu/alsa-lib"
        ;;
    *)
        echo "ERROR: Architecture $ARCH not supported"
        echo "plugininstallend"
        exit 1
        ;;
esac

SO_SRC="${PLUGIN_PATH}/alsa-lib/${BIN_ARCH}/libasound_module_pcm_keepalive.so"
DAEMON_SRC="${PLUGIN_PATH}/bin/${BIN_ARCH}/audio-keepalive-daemon"

if [ ! -f "$SO_SRC" ]; then
    echo "ERROR: Binary not found: ${SO_SRC}"
    echo "plugininstallend"
    exit 1
fi

if [ ! -f "$DAEMON_SRC" ]; then
    echo "ERROR: Binary not found: ${DAEMON_SRC}"
    echo "plugininstallend"
    exit 1
fi

sudo mkdir -p "${ALSA_PLUGIN_DIR}"
sudo install -m 0644 "$SO_SRC" "${ALSA_PLUGIN_DIR}/libasound_module_pcm_keepalive.so"
sudo install -m 0755 "$DAEMON_SRC" /usr/bin/audio-keepalive-daemon
echo "Installed keepalive ALSA client and daemon for ${ARCH}"

sudo install -m 0644 "${PLUGIN_PATH}/audio-keepalive.service" /lib/systemd/system/audio-keepalive.service

sudo tee /etc/sudoers.d/volumio-user-audio_keepalive > /dev/null << EOF
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start audio-keepalive.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl stop audio-keepalive.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart audio-keepalive.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl kill -s HUP audio-keepalive.service
EOF
sudo chmod 0440 /etc/sudoers.d/volumio-user-audio_keepalive
if ! sudo visudo -c -f /etc/sudoers.d/volumio-user-audio_keepalive; then
    echo "ERROR: Invalid sudoers syntax"
    sudo rm -f /etc/sudoers.d/volumio-user-audio_keepalive
    echo "plugininstallend"
    exit 1
fi

sudo systemctl daemon-reload
echo "plugininstallend"
