#!/bin/sh
# NFC Music - install dependencies for ACR122U (and other PC/SC) NFC readers.
# Volumio runs this script as root with /bin/sh, so it must stay POSIX sh.

STATE_DIR="/data/configuration/system_hardware/nfc_music"
STATE_FILE="$STATE_DIR/install-state"
BLACKLIST_FILE="/etc/modprobe.d/nfc_music-blacklist.conf"
REQUIRED="pcscd libccid libpcsclite1"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# What earlier installs of this plugin recorded (kept on update, so uninstall
# still knows what this plugin originally added).
INSTALLED_BY_PLUGIN=""
SOCKET_WAS_ENABLED=""
BLACKLIST_CREATED=""
if [ -f "$STATE_FILE" ]; then
    . "$STATE_FILE"
fi

echo "Installing NFC Music dependencies"

# Remember the original state of pcscd.socket only the first time.
if [ -z "$SOCKET_WAS_ENABLED" ]; then
    if systemctl is-enabled --quiet pcscd.socket 2>/dev/null; then
        SOCKET_WAS_ENABLED="yes"
    else
        SOCKET_WAS_ENABLED="no"
    fi
fi

MISSING=""
for pkg in $REQUIRED; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -n "$MISSING" ]; then
    echo "Installing:$MISSING"
    if ! { $SUDO apt-get update && $SUDO apt-get -y install --no-install-recommends $MISSING; }; then
        echo "Installing packages failed"
        # Volumio detects failure by the exit code; this line only ends its log view.
        echo "plugininstallend"
        exit 1
    fi
    INSTALLED_BY_PLUGIN="$INSTALLED_BY_PLUGIN$MISSING"
else
    echo "All required packages already installed"
fi

# The kernel NFC drivers claim the ACR122U before pcscd can use it.
# Only create our own file; never edit existing system files.
if [ ! -f "$BLACKLIST_FILE" ]; then
    echo "Blacklisting kernel NFC drivers (pn533_usb, pn533, nfc) for pcscd"
    printf '%s\n' \
        "# Added by the Volumio NFC Music plugin - removed on uninstall" \
        "blacklist pn533_usb" \
        "blacklist pn533" \
        "blacklist nfc" | $SUDO tee "$BLACKLIST_FILE" >/dev/null
    BLACKLIST_CREATED="yes"
    $SUDO modprobe -r pn533_usb pn533 nfc 2>/dev/null || true
fi

$SUDO systemctl enable --now pcscd.socket >/dev/null 2>&1 || true

# Save the install state in the plugin's own configuration folder, owned by
# the volumio user (the plugin writes tags.json there too).
for dir in /data/configuration/system_hardware "$STATE_DIR"; do
    if [ ! -d "$dir" ]; then
        $SUDO install -d -o volumio -g volumio "$dir"
    fi
done
{
    echo "INSTALLED_BY_PLUGIN=\"$(echo $INSTALLED_BY_PLUGIN)\""
    echo "SOCKET_WAS_ENABLED=\"$SOCKET_WAS_ENABLED\""
    echo "BLACKLIST_CREATED=\"$BLACKLIST_CREATED\""
} | $SUDO tee "$STATE_FILE" >/dev/null
$SUDO chown volumio:volumio "$STATE_FILE" 2>/dev/null || true

echo "NFC Music dependencies installed"
echo "If your reader is not detected, unplug and replug it (or reboot)."

#required to end the plugin install
echo "plugininstallend"
