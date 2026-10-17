#!/bin/bash
# NFC Music - remove what install.sh added.

MARKER_DIR="/data/INTERNAL/nfc_music"
MARKER="$MARKER_DIR/installed-packages"
BLACKLIST_FILE="/etc/modprobe.d/nfc_music-blacklist.conf"

if [ -f "$BLACKLIST_FILE" ] && grep -q "NFC Music plugin" "$BLACKLIST_FILE"; then
    echo "Removing kernel driver blacklist"
    sudo rm -f "$BLACKLIST_FILE"
fi

if [ -s "$MARKER" ]; then
    echo "Removing packages installed by NFC Music: $(tr '\n' ' ' < "$MARKER")"
    # shellcheck disable=SC2046
    sudo apt-get -y purge --auto-remove $(cat "$MARKER")
fi

rm -rf "$MARKER_DIR" 2>/dev/null || sudo rm -rf "$MARKER_DIR"

# Note: the user's tags in /data/configuration/system_hardware/nfc_music are
# kept on purpose, so reinstalling the plugin restores them.

echo "Done"
echo "pluginuninstallend"
