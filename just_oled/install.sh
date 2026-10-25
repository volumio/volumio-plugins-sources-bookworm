#!/bin/bash
# Just OLED installer. Runs as root through the plugin manager; its output
# is shown in the install dialog and a non-zero exit fails the install.
# What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing Just OLED"

PLUGIN_DIR="/data/plugins/system_hardware/just_oled"
SERVICE="just-oled"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-just_oled"
USERCONFIG="/boot/userconfig.txt"
# The installer's block: the buses enabled. The plugin keeps a block of its
# own for a custom bus, under plain `# >>> just_oled` marks.
MARK_BEGIN="# >>> just_oled install"
MARK_END="# <<< just_oled install"

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
chmod +x "$PLUGIN_DIR"/bin/*/just-oled "$PLUGIN_DIR"/scripts/*.sh 2>/dev/null || true
if [ ! -x "$PLUGIN_DIR/bin/$ARCH/just-oled" ]; then
  refuse "ERROR: no display binary for architecture $ARCH (available: $(ls "$PLUGIN_DIR/bin" 2>/dev/null | tr '\n' ' '))"
fi
if [ ! -f "$PLUGIN_DIR/alsa-lib/$ARCH/libjustoledtap.so" ]; then
  refuse "ERROR: no audio tap for architecture $ARCH"
fi
ln -sf "$PLUGIN_DIR/alsa-lib/$ARCH/libjustoledtap.so" "$PLUGIN_DIR/alsa-lib/libjustoledtap.so"
echo "Tap: $PLUGIN_DIR/alsa-lib/$ARCH/libjustoledtap.so"
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
# SETUP: the buses. Volumio's Raspberry Pi image enables the hardware I2C
# bus and loads i2c-dev; SPI is enabled here where it is not. Each line
# goes between the plugin's marks in /boot/userconfig.txt, which survives
# an OTA update, and comes out with the plugin.
# =============================================================================
lines=""
if [ -d /boot ] && [ -f /boot/config.txt ]; then
  if ! grep -qs "^dtparam=i2c_arm=on" /boot/config.txt /boot/volumioconfig.txt "$USERCONFIG" 2>/dev/null; then
    lines="$lines dtparam=i2c_arm=on"
  fi
  if ! grep -qs "^dtparam=spi=on" /boot/config.txt /boot/volumioconfig.txt "$USERCONFIG" 2>/dev/null; then
    lines="$lines dtparam=spi=on"
  fi
  if [ -n "$lines" ]; then
    echo "Enabling in $USERCONFIG (reboot required):$lines"
    {
      echo "$MARK_BEGIN"
      for line in $lines; do echo "$line"; done
      echo "$MARK_END"
    } >> "$USERCONFIG"
  fi
fi
for group in i2c spi gpio; do
  groupadd -f "$group"
  if ! id -nG volumio | tr ' ' '\n' | grep -qx "$group"; then
    usermod -aG "$group" volumio
    echo "Added volumio to the $group group"
  fi
done
if ! grep -qs "^i2c-dev" /etc/modules /etc/modules-load.d/*.conf 2>/dev/null; then
  echo "i2c-dev" > /etc/modules-load.d/just-oled.conf
  echo "i2c-dev loads at boot"
fi
if ! lsmod | grep -q "^i2c_dev"; then
  modprobe i2c-dev 2>/dev/null || true
fi
# The device nodes the daemon opens, owned by the groups the service joins.
cat > /etc/udev/rules.d/60-just-oled.rules << 'EOF'
# just_oled plugin: the buses the display hangs on belong to their groups
KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"
KERNEL=="spidev*", GROUP="spi", MODE="0660"
KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
EOF
udevadm control --reload 2>/dev/null || true
udevadm trigger --subsystem-match=i2c-dev --subsystem-match=spidev --subsystem-match=gpio 2>/dev/null || true

# =============================================================================
# SETUP: sudo for what the plugin runs as the volumio user: the service,
# the bus scan, and the boot configuration file. Named volumio-user-* so it
# sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" << 'EOF'
# just_oled plugin: the display service, the I2C scan, the boot configuration
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start just-oled.service, /bin/systemctl stop just-oled.service, /bin/systemctl restart just-oled.service, /bin/systemctl is-active just-oled.service, /bin/systemctl enable just-oled.service, /bin/systemctl disable just-oled.service
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
# the plugin enables and disables it as it is enabled and disabled.
# =============================================================================
install -m 644 "$PLUGIN_DIR/systemd/just-oled.service" "$UNIT"
systemctl daemon-reload
systemctl enable "$SERVICE.service" >/dev/null 2>&1 || true

chown -R volumio:volumio "$PLUGIN_DIR"

echo "Just OLED installed"
echo "plugininstallend"
