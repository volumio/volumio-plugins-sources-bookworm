#!/bin/bash
# Called by Volumio after plugin zip is extracted.

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
VINYLTRON_DIR="$PLUGIN_DIR/vinyltron"
LEGACY_DIR=/home/volumio/vinyltron
CONFIG_DIR=/data/configuration/user_interface/vinyltron
CONFIG_TOML="$CONFIG_DIR/config.toml"
SERVICE=vinyltron
IDLE_IMAGE_DIR=/data/INTERNAL/Vinyltron/idle-images
# Bookworm ships libheif 1.15.1, which rejects HEIC photos from iPhone 15 Pro+ /
# iOS 18 ("Too many auxiliary image references" — HDR gain maps shared between
# images in an 'altr' group). Fixed upstream in 1.18.0; bookworm-backports ships
# 1.19.x prebuilt for armhf. See docs/engineering-spec.md#libheif-build
BACKPORTS_LIST=/etc/apt/sources.list.d/vinyltron-backports.list

# Volumio's plugin manager waits for "plugininstallend" on stdout to know the
# install finished, on success or failure. On failure, also remove the plugin
# folder so a broken install doesn't linger in the plugin list.
exit_cleanup() {
    ERR="$?"
    if [ "$ERR" -ne 0 ]; then
        echo "Vinyltron install failed (exit $ERR). Cleaning up..."
        bash "$PLUGIN_DIR/uninstall.sh" >/dev/null 2>&1 || true
        rm -rf "$PLUGIN_DIR"
    fi
    echo "plugininstallend"
}
trap exit_cleanup EXIT
# Volumio runs this script via "sh" (dash), which doesn't support
# "set -o pipefail", so avoid relying on pipe exit codes below.
set -e

if [ ! -f "$VINYLTRON_DIR/vinyltron.py" ]; then
    echo "ERROR: bundled Vinyltron daemon not found at $VINYLTRON_DIR"
    exit 1
fi

echo "Installing dependencies..."
apt-get update
# python3-pil installs Pillow from the Bookworm package (prebuilt, no compilation).
if ! apt-get install -y python3-pip python3-pil; then
    echo "Retrying with --force-overwrite (known libpython3-stdlib conflict on fresh Bookworm images)..."
    apt-get install -y -f -o Dpkg::Options::='--force-overwrite'
    apt-get install -y python3-pip python3-pil
fi


echo "Installing libheif from bookworm-backports (for HEIC/HEIF photo uploads)..."
# The Debian 12 (bookworm) archive signing key is already trusted on Raspbian Bookworm
# images, so this needs no keyring setup. Default backports priority (100) means this
# doesn't affect any other package's install/upgrade candidate.
if [ ! -f "$BACKPORTS_LIST" ]; then
    echo "deb http://deb.debian.org/debian bookworm-backports main" > "$BACKPORTS_LIST"
fi
if apt-get update; then
    if ! apt-get install -y -t bookworm-backports libheif-examples; then
        echo "WARNING: failed to install libheif-examples from bookworm-backports."
        echo "Vinyltron will still install, but HEIC/HEIF photo uploads will show"
        echo "'Could not convert image' until this is resolved."
    fi
else
    echo "WARNING: failed to install libheif-examples from bookworm-backports."
    echo "Vinyltron will still install, but HEIC/HEIF photo uploads will show"
    echo "'Could not convert image' until this is resolved."
fi

echo "Creating idle image folder..."
mkdir -p "$IDLE_IMAGE_DIR"
chown -R volumio:volumio /data/INTERNAL/Vinyltron

echo "Preparing Vinyltron configuration..."
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_TOML" ]; then
    if [ -f "$LEGACY_DIR/config.toml" ]; then
        echo "Migrating existing config.toml from $LEGACY_DIR"
        cp "$LEGACY_DIR/config.toml" "$CONFIG_TOML"
    else
        cp "$VINYLTRON_DIR/config.toml" "$CONFIG_TOML"
    fi
fi
chown -R volumio:volumio "$CONFIG_DIR"

echo "Installing Python dependencies..."
# Pillow is installed via python3-pil above (prebuilt, no compilation).
# Remaining packages are pure Python; pip install won't trigger a build.
# --break-system-packages required on Python 3.11+ (PEP 668 / Bookworm).
PIP_FLAGS=""
python3 -c "import sys; exit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null && PIP_FLAGS="--break-system-packages"
pip3 install $PIP_FLAGS "requests>=2.21,<3" "toml>=0.10,<1" "python-socketio[client]==4.6.1"

# Install and enable systemd service
echo "Installing systemd service..."
cat > /etc/systemd/system/vinyltron.service <<EOF
[Unit]
Description=Vinyltron — HUB75 album art display
After=network.target volumio.service
Wants=volumio.service

[Service]
Type=simple
Environment=PYTHONDONTWRITEBYTECODE=1
WorkingDirectory=$VINYLTRON_DIR
ExecStart=/usr/bin/python3 $VINYLTRON_DIR/vinyltron.py $CONFIG_TOML
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SERVICE

# Allow volumio user to control the service without a password
cat > /etc/sudoers.d/vinyltron <<'EOF'
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start vinyltron, /bin/systemctl stop vinyltron, /bin/systemctl restart vinyltron, /bin/systemctl reload vinyltron, /bin/systemctl is-active vinyltron
EOF
chmod 440 /etc/sudoers.d/vinyltron

# Free up GPIO18/PWM for the matrix and prevent Bookworm from re-enabling
# snd_bcm2835, so hardware-pulse mode (adafruit-hat-pwm) works with the Bonnet
# without manual SSH setup. See docs/engineering-spec.md for background.
echo "Checking boot configuration for matrix PWM..."
NEEDS_REBOOT=0

USERCONFIG=/boot/userconfig.txt
if [ ! -f "$USERCONFIG" ]; then
    echo "dtparam=audio=off" > "$USERCONFIG"
    NEEDS_REBOOT=1
elif ! grep -qx 'dtparam=audio=off' "$USERCONFIG"; then
    [ -f "$USERCONFIG.vinyltron-orig" ] || cp "$USERCONFIG" "$USERCONFIG.vinyltron-orig"
    # Ensure the file ends with a newline before appending, or our line
    # would get tacked onto the end of the last existing line.
    [ -z "$(tail -c1 "$USERCONFIG")" ] || echo >> "$USERCONFIG"
    echo "dtparam=audio=off" >> "$USERCONFIG"
    NEEDS_REBOOT=1
fi

CMDLINE=/boot/cmdline.txt
if [ -f "$CMDLINE" ]; then
    OLD_CMDLINE="$(cat "$CMDLINE")"
    HAS_MODULE_BLACKLIST=0
    HAS_MODPROBE_BLACKLIST=0
    NEW_CMDLINE=""
    for word in $OLD_CMDLINE; do
        case "$word" in
            snd_bcm2835.enable_hdmi=1|snd_bcm2835.enable_headphones=1)
                continue ;;
            module_blacklist=snd_bcm2835) HAS_MODULE_BLACKLIST=1 ;;
            modprobe.blacklist=snd_bcm2835) HAS_MODPROBE_BLACKLIST=1 ;;
        esac
        NEW_CMDLINE="${NEW_CMDLINE:+$NEW_CMDLINE }$word"
    done
    [ "$HAS_MODULE_BLACKLIST" -eq 1 ] || NEW_CMDLINE="$NEW_CMDLINE module_blacklist=snd_bcm2835"
    [ "$HAS_MODPROBE_BLACKLIST" -eq 1 ] || NEW_CMDLINE="$NEW_CMDLINE modprobe.blacklist=snd_bcm2835"

    if [ "$NEW_CMDLINE" != "$OLD_CMDLINE" ]; then
        [ -f "$CMDLINE.vinyltron-orig" ] || cp "$CMDLINE" "$CMDLINE.vinyltron-orig"
        printf '%s' "$NEW_CMDLINE" > "$CMDLINE"
        NEEDS_REBOOT=1
    fi
fi

if [ "$NEEDS_REBOOT" -eq 1 ]; then
    echo "Boot configuration updated (onboard audio disabled, snd_bcm2835 blacklisted)"
    echo "so the matrix can use hardware-pulse PWM. *** Reboot the Pi for this to take"
    echo "effect. *** Originals saved as /boot/cmdline.txt.vinyltron-orig and"
    echo "/boot/userconfig.txt.vinyltron-orig (if it already existed)."
fi
