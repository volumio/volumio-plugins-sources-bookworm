#!/bin/sh
# NFC Music - undo exactly what install.sh did (state in install-state).
# Volumio runs this script as root with /bin/sh, so it must stay POSIX sh.

STATE_DIR="/data/configuration/system_hardware/nfc_music"
STATE_FILE="$STATE_DIR/install-state"
BLACKLIST_FILE="/etc/modprobe.d/nfc_music-blacklist.conf"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

INSTALLED_BY_PLUGIN=""
SOCKET_WAS_ENABLED=""
BLACKLIST_CREATED=""
if [ -f "$STATE_FILE" ]; then
    . "$STATE_FILE"
fi

if [ "$BLACKLIST_CREATED" = "yes" ] && [ -f "$BLACKLIST_FILE" ]; then
    echo "Removing kernel driver blacklist"
    $SUDO rm -f "$BLACKLIST_FILE"
fi

if [ "$SOCKET_WAS_ENABLED" = "no" ]; then
    echo "Restoring pcscd.socket to disabled"
    $SUDO systemctl disable --now pcscd.socket >/dev/null 2>&1 || true
fi

if [ -n "$INSTALLED_BY_PLUGIN" ]; then
    echo "Removing packages installed by NFC Music: $INSTALLED_BY_PLUGIN"
    $SUDO apt-get -y purge --auto-remove $INSTALLED_BY_PLUGIN
fi

# Only remove our own state file. Volumio itself deletes the rest of
# /data/configuration/system_hardware/nfc_music (including tags.json)
# after this script, as it does for every plugin.
$SUDO rm -f "$STATE_FILE"

echo "Done"
echo "pluginuninstallend"
