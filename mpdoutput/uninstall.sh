#!/bin/bash
# MPD HTTP & Icecast output uninstaller: everything install.sh and the plugin
# put outside the plugin folder goes; the plugin folder itself the plugin
# manager removes. The MPD outputs disappear when Volumio next writes
# mpd.conf, which the plugin triggers when it is stopped before this runs.

echo "Uninstalling MPD HTTP & Icecast output"

SERVICE="mpd-output-relay"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-mpdoutput"

systemctl stop "$SERVICE.service" 2>/dev/null || true
systemctl disable "$SERVICE.service" 2>/dev/null || true
rm -f "$UNIT"
systemctl daemon-reload
rm -f "$SUDOERS"
rm -rf /run/mpd-output
rm -f /data/configuration/audio_interface/mpdoutput/relay.json

echo "Done"
echo "pluginuninstallend"
