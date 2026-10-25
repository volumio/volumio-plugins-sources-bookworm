#!/bin/bash
# LCD1602 VU Meter installer. Runs as root through the plugin manager; its
# output is shown in the install dialog and a non-zero exit fails the
# install. What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing LCD1602 VU Meter"

PLUGIN_DIR="/data/plugins/system_hardware/lcd1602_vumeter"
SERVICE="lcd1602-vumeter"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-lcd1602_vumeter"
USERCONFIG="/boot/userconfig.txt"
MARK_BEGIN="# >>> lcd1602_vumeter"
MARK_END="# <<< lcd1602_vumeter"

# The binaries are chosen by the userland (armhf, arm64, amd64), not by the
# image's label: the 32-bit Pi image runs under a 64-bit kernel.
# shellcheck source=scripts/arch.sh
. "$PLUGIN_DIR/scripts/arch.sh"
ARCH=$(userland_arch)
LABEL=$(sed -n 's/^VOLUMIO_ARCH="\(.*\)"/\1/p' /etc/os-release | head -n1)
HARDWARE=$(sed -n 's/^VOLUMIO_HARDWARE="\(.*\)"/\1/p' /etc/os-release | head -n1)

# A refused install leaves nothing behind, so the next attempt starts clean.
refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

echo "Architecture: $ARCH (image label: ${LABEL:-none}), hardware: ${HARDWARE:-unknown}"

# =============================================================================
# CHECK: the binaries for this machine. The unzip does not keep modes.
# =============================================================================
chmod +x "$PLUGIN_DIR"/bin/*/lcd1602-vumeter "$PLUGIN_DIR"/scripts/*.sh 2>/dev/null || true
if [ ! -x "$PLUGIN_DIR/bin/$ARCH/lcd1602-vumeter" ]; then
  refuse "ERROR: no display binary for architecture $ARCH (available: $(ls "$PLUGIN_DIR/bin" 2>/dev/null | tr '\n' ' '))"
fi
if [ ! -f "$PLUGIN_DIR/alsa-lib/$ARCH/libvutap.so" ]; then
  refuse "ERROR: no audio tap for architecture $ARCH"
fi
ln -sf "$PLUGIN_DIR/alsa-lib/$ARCH/libvutap.so" "$PLUGIN_DIR/alsa-lib/libvutap.so"
echo "Tap: $PLUGIN_DIR/alsa-lib/$ARCH/libvutap.so"
mkdir -p "$PLUGIN_DIR/asound"

# =============================================================================
# INSTALL: system packages. i2c-tools is in every Volumio image; checked all the same.
# =============================================================================
installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"
}
if ! installed i2c-tools; then
  echo "Installing i2c-tools"
  apt-get update
  apt-get install -y i2c-tools || echo "WARNING: i2c-tools could not be installed; Detect on the settings page will not work"
fi

# =============================================================================
# SETUP: the I2C bus. Volumio's Raspberry Pi image enables the hardware bus,
# loads i2c-dev, has the i2c group and a udev rule for /dev/i2c-*; each is
# checked and supplied where missing, so other boards and a PC with a USB
# I2C adapter work the same.
# =============================================================================
if [ -d /boot ] && [ -f /boot/config.txt ]; then
  if ! grep -qs "^dtparam=i2c_arm=on" /boot/config.txt /boot/volumioconfig.txt "$USERCONFIG" 2>/dev/null; then
    echo "Enabling the I2C bus in $USERCONFIG (reboot required)"
    {
      echo "$MARK_BEGIN"
      echo "dtparam=i2c_arm=on"
      echo "$MARK_END"
    } >> "$USERCONFIG"
  fi
fi
groupadd -f i2c
if ! id -nG volumio | tr ' ' '\n' | grep -qx i2c; then
  usermod -aG i2c volumio
  echo "Added volumio to the i2c group"
fi
if ! grep -qs "^i2c-dev" /etc/modules /etc/modules-load.d/*.conf 2>/dev/null; then
  echo "i2c-dev" > /etc/modules-load.d/lcd1602-vumeter.conf
  echo "i2c-dev loads at boot"
fi
if ! lsmod | grep -q "^i2c_dev"; then
  modprobe i2c-dev 2>/dev/null || true
fi
cat > /etc/udev/rules.d/60-lcd1602-vumeter-i2c.rules << 'EOF'
# lcd1602_vumeter plugin: the I2C buses belong to the i2c group
KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"
EOF
udevadm control --reload 2>/dev/null || true
udevadm trigger --subsystem-match=i2c-dev 2>/dev/null || true

# =============================================================================
# SETUP: sudo for what the plugin runs as the volumio user: the service,
# the bus scan, and the boot configuration file. Named volumio-user-* so it
# sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" << 'EOF'
# lcd1602_vumeter plugin: the display service, the I2C scan, the boot configuration
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start lcd1602-vumeter.service, /bin/systemctl stop lcd1602-vumeter.service, /bin/systemctl restart lcd1602-vumeter.service, /bin/systemctl is-active lcd1602-vumeter.service
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cdetect -y *
volumio ALL=(ALL) NOPASSWD: /usr/bin/tee /boot/userconfig.txt
EOF
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

# =============================================================================
# SETUP: the display service. Enabled so the display speaks from boot;
# the plugin starts and stops it as it is enabled and disabled.
# =============================================================================
install -m 644 "$PLUGIN_DIR/systemd/lcd1602-vumeter.service" "$UNIT"
systemctl daemon-reload
systemctl enable "$SERVICE.service" >/dev/null 2>&1 || true

chown -R volumio:volumio "$PLUGIN_DIR"

echo "LCD1602 VU Meter installed"
echo "plugininstallend"
