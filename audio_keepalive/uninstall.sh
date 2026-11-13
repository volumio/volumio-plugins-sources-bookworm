#!/bin/sh
# Audio Keepalive uninstaller: everything install.sh and the plugin put outside the
# plugin folder goes; the plugin folder itself the plugin manager removes.

echo "Uninstalling Audio Keepalive"

UNIT=/etc/systemd/system/audio-keepalive.service
SUDOERS=/etc/sudoers.d/volumio-user-audio_keepalive

systemctl stop audio-keepalive.service 2>/dev/null || true
systemctl disable audio-keepalive.service 2>/dev/null || true
rm -f "$UNIT" /lib/systemd/system/audio-keepalive.service /usr/bin/audio-keepalive-daemon
for dir in /usr/lib/arm-linux-gnueabihf/alsa-lib /usr/lib/aarch64-linux-gnu/alsa-lib /usr/lib/x86_64-linux-gnu/alsa-lib; do
  rm -f "$dir/libasound_module_pcm_keepalive.so"
done
systemctl daemon-reload
rm -f "$SUDOERS"
rm -rf /run/audio-keepalive

echo "Audio Keepalive uninstalled"
echo "pluginuninstallend"
