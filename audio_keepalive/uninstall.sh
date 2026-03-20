#!/bin/bash

echo "Uninstalling Audio Keepalive"

for dir in /usr/lib/arm-linux-gnueabihf/alsa-lib /usr/lib/x86_64-linux-gnu/alsa-lib; do
    if [ -f "${dir}/libasound_module_pcm_keepalive.so" ]; then
        sudo rm -f "${dir}/libasound_module_pcm_keepalive.so"
        echo "Removed ${dir}/libasound_module_pcm_keepalive.so"
    fi
done

echo "Done"
echo "pluginuninstallend"
