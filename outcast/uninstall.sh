#!/bin/sh
# Outcast Uplink uninstaller: everything install.sh and the plugin put outside the
# plugin folder goes; the plugin folder itself the plugin manager removes, and the
# audio chain is written again without the tap when the plugin is disabled. The
# recordings under the data folder are the user's and stay.

echo "Uninstalling Outcast Uplink"

PLUGIN_DIR=/data/plugins/audio_interface/outcast
UNIT=/etc/systemd/system/outcast.service
SUDOERS=/etc/sudoers.d/volumio-user-outcast

systemctl stop outcast.service 2>/dev/null || true
systemctl disable outcast.service 2>/dev/null || true
rm -f "$UNIT"
systemctl daemon-reload
rm -f "$SUDOERS"
rm -rf /run/outcast
rm -f "$PLUGIN_DIR"/asound/*.conf "$PLUGIN_DIR/lib/libevotap.so" "$PLUGIN_DIR/bin/outcast" "$PLUGIN_DIR/bin/evopeg" "$PLUGIN_DIR/bin/evotap-cat"
rm -f /dev/shm/evoaudio.outcast.* /dev/shm/evometer.outcast.* /dev/shm/evoaudio.outcast-check.* /dev/shm/evometer.outcast-check.*
echo "The recordings under /data/INTERNAL/outcast stay"

echo "Outcast Uplink uninstalled"
echo "pluginuninstallend"
