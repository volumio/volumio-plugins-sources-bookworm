#!/bin/bash
# NFC Music - install dependencies for ACR122U (and other PC/SC) NFC readers.

MARKER_DIR="/data/INTERNAL/nfc_music"
MARKER="$MARKER_DIR/installed-packages"
BLACKLIST_FILE="/etc/modprobe.d/nfc_music-blacklist.conf"
PACKAGES="pcscd libccid libpcsclite1"

echo "Installing NFC Music dependencies"

# Remember which packages were NOT installed before, so uninstall.sh only
# removes what this plugin added.
sudo mkdir -p "$MARKER_DIR"
sudo chown "$(id -un)" "$MARKER_DIR"
: > "$MARKER"
for pkg in $PACKAGES; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        echo "$pkg" >> "$MARKER"
    fi
done

if [ -s "$MARKER" ]; then
    echo "Installing: $(tr '\n' ' ' < "$MARKER")"
    sudo apt-get update
    # shellcheck disable=SC2046
    sudo apt-get -y install --no-install-recommends $(cat "$MARKER") || {
        echo "Installing packages failed"
        echo "plugininstallend"
        exit 1
    }
else
    echo "All required packages already installed"
fi

# The kernel NFC drivers claim the ACR122U before pcscd can use it.
# Only create our own blacklist file; never edit existing system files.
if [ ! -f "$BLACKLIST_FILE" ]; then
    echo "Blacklisting kernel NFC drivers (pn533_usb, pn533, nfc) for pcscd"
    sudo tee "$BLACKLIST_FILE" >/dev/null <<'CONF'
# Added by the Volumio NFC Music plugin - removed on uninstall
blacklist pn533_usb
blacklist pn533
blacklist nfc
CONF
    sudo modprobe -r pn533_usb pn533 nfc 2>/dev/null || true
fi

sudo systemctl enable pcscd.socket >/dev/null 2>&1 || true
sudo systemctl restart pcscd.socket >/dev/null 2>&1 || true

echo "NFC Music dependencies installed"
echo "If your reader is not detected, unplug and replug it (or reboot)."

#required to end the plugin install
echo "plugininstallend"
