#!/bin/bash

echo "Uninstalling Audio Keepalive"

sudo systemctl stop audio-keepalive.service 2>/dev/null
sudo systemctl disable audio-keepalive.service 2>/dev/null

sudo rm -f /lib/systemd/system/audio-keepalive.service
sudo rm -f /etc/sudoers.d/volumio-user-audio_keepalive
sudo rm -f /usr/bin/audio-keepalive-daemon

for dir in \
    /usr/lib/arm-linux-gnueabihf/alsa-lib \
    /usr/lib/aarch64-linux-gnu/alsa-lib \
    /usr/lib/x86_64-linux-gnu/alsa-lib
do
    if [ -f "${dir}/libasound_module_pcm_keepalive.so" ]; then
        sudo rm -f "${dir}/libasound_module_pcm_keepalive.so"
        echo "Removed ${dir}/libasound_module_pcm_keepalive.so"
    fi
done

sudo systemctl daemon-reload 2>/dev/null

echo "Done"
echo "pluginuninstallend"
