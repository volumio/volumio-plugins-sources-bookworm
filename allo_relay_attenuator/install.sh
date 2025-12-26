#!/bin/bash
echo "Installing Allo Relay Attenuator plugin"

# Get Volumio architecture
ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')

if [ -z "$ARCH" ]; then
  echo "ERROR: Could not detect Volumio architecture"
  exit 1
fi

echo "Detected architecture: $ARCH"

PLUGIN_DIR="/data/plugins/system_hardware/allo_relay_attenuator"
PKG_SOURCE="$PLUGIN_DIR/packages/$ARCH"

# Verify architecture is supported
if [ ! -d "$PKG_SOURCE" ]; then
  echo "ERROR: Architecture $ARCH not supported"
  echo "Available: arm, armv7, armv8, x64"
  exit 1
fi

echo "Using packages from: $PKG_SOURCE"

# =============================================================================
# CLEANUP: Remove any existing installation
# =============================================================================
echo ""
echo "Cleaning up previous installation..."

# Stop daemon if running
systemctl stop fn-rattenu.service 2>/dev/null
systemctl stop rattenu.service 2>/dev/null

# Remove old sudoers files (wrong naming)
rm -f /etc/sudoers.d/volumio-allo-relay-attenuator 2>/dev/null

# Remove old binaries
rm -f /usr/bin/r_attenu 2>/dev/null
rm -f /usr/bin/r_attenuc 2>/dev/null
rm -f /usr/bin/fn-rattenu 2>/dev/null
rm -f /usr/bin/fn-rattenuc 2>/dev/null

# Remove old service files
rm -f /lib/systemd/system/rattenu.service 2>/dev/null
rm -f /lib/systemd/system/fn-rattenu.service 2>/dev/null

# Remove old foonerd packages if present
if dpkg -l | grep -q "^ii  foonerd-rattenu "; then
  echo "Removing existing foonerd-rattenu package..."
  dpkg --purge foonerd-rattenu 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-lgpio0 "; then
  echo "Removing existing libfn-lgpio0 package..."
  dpkg --purge libfn-lgpio0 2>/dev/null
fi

echo "Cleanup complete"

# =============================================================================
# INSTALL: Dependencies
# =============================================================================
echo ""
echo "Installing dependencies..."

apt-get update

# Install LIRC client library (required for IR support)
echo "Installing LIRC client library..."
apt-get install -y liblirc-client0 liblircclient0 --no-install-recommends

if [ $? -ne 0 ]; then
  echo "WARNING: Failed to install liblirc-client0"
  echo "IR remote support may not work"
fi

# Install LIRC daemon (optional, for IR support)
echo "Installing LIRC daemon..."
apt-get install -y lirc --no-install-recommends

if [ $? -ne 0 ]; then
  echo "WARNING: Failed to install lirc"
  echo "IR remote support may not work"
fi

# =============================================================================
# INSTALL: Bundled packages
# =============================================================================
echo ""
echo "Installing bundled packages..."

# Install lgpio library first (dependency)
echo "Installing libfn-lgpio0..."
dpkg -i "$PKG_SOURCE"/libfn-lgpio0_*.deb
if [ $? -ne 0 ]; then
  echo "WARNING: libfn-lgpio0 had issues, attempting to fix dependencies..."
  apt-get install -f -y
fi

# Install relay attenuator binaries
echo "Installing foonerd-rattenu..."
dpkg -i "$PKG_SOURCE"/foonerd-rattenu_*.deb
if [ $? -ne 0 ]; then
  echo "WARNING: foonerd-rattenu had issues, attempting to fix dependencies..."
  apt-get install -f -y
fi

# Fix any remaining dependency issues
apt-get install -f -y

# Verify installation
if [ ! -x /usr/bin/fn-rattenu ]; then
  echo "ERROR: fn-rattenu not found at /usr/bin/fn-rattenu"
  exit 1
fi

if [ ! -x /usr/bin/fn-rattenuc ]; then
  echo "ERROR: fn-rattenuc not found at /usr/bin/fn-rattenuc"
  exit 1
fi

echo "Packages installed successfully"

# =============================================================================
# INSTALL: Service and configuration files
# =============================================================================
echo ""
echo "Installing service files..."

# Copy systemd service
cp "$PLUGIN_DIR/fn-rattenu.service" /lib/systemd/system/
chmod 644 /lib/systemd/system/fn-rattenu.service

# Reload systemd
systemctl daemon-reload

echo "Service installed"

# =============================================================================
# INSTALL: LIRC configuration
# =============================================================================
echo ""
echo "Installing LIRC configuration..."

# Create LIRC config directory if needed
mkdir -p /etc/lirc

# Backup and replace lirc_options.conf (required for GPIO IR)
if [ -f /etc/lirc/lirc_options.conf ]; then
  if [ ! -f /etc/lirc/lirc_options.conf.bak ]; then
    cp /etc/lirc/lirc_options.conf /etc/lirc/lirc_options.conf.bak
    echo "Original lirc_options.conf backed up"
  fi
fi

if [ -f "$PLUGIN_DIR/lirc_options.conf" ]; then
  cp "$PLUGIN_DIR/lirc_options.conf" /etc/lirc/lirc_options.conf
  echo "lirc_options.conf installed (driver=default for GPIO IR)"
fi

# Copy LIRC remote configuration
if [ -f "$PLUGIN_DIR/lircd.conf" ]; then
  cp "$PLUGIN_DIR/lircd.conf" /etc/lirc/lircd.conf
fi

# Copy LIRC button mapping
if [ -f "$PLUGIN_DIR/lircrc" ]; then
  cp "$PLUGIN_DIR/lircrc" /etc/lirc/lircrc
fi

# Restart lircd to apply new configuration
systemctl restart lircd 2>/dev/null

echo "LIRC configuration installed"

# =============================================================================
# INSTALL: Volume control scripts
# =============================================================================
echo ""
echo "Setting up volume control scripts..."

chmod +x "$PLUGIN_DIR/setvolume.sh"
chmod +x "$PLUGIN_DIR/getvolume.sh"
chmod +x "$PLUGIN_DIR/setmute.sh"
chmod +x "$PLUGIN_DIR/getmute.sh"

echo "Volume scripts configured"

# =============================================================================
# CONFIGURE: Sudoers for volume control
# =============================================================================
echo ""
echo "Configuring sudoers..."

cat > /etc/sudoers.d/volumio-user-allo_relay_attenuator << EOF
# Allo Relay Attenuator - allow volumio user to control attenuator
volumio ALL=(ALL) NOPASSWD: /usr/bin/fn-rattenuc
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start fn-rattenu.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl stop fn-rattenu.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart fn-rattenu.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
volumio ALL=(ALL) NOPASSWD: /bin/cp /tmp/fn-rattenu.service /lib/systemd/system/fn-rattenu.service
EOF

chmod 0440 /etc/sudoers.d/volumio-user-allo_relay_attenuator
visudo -c -f /etc/sudoers.d/volumio-user-allo_relay_attenuator
if [ $? -ne 0 ]; then
  echo "ERROR: Invalid sudoers syntax"
  rm -f /etc/sudoers.d/volumio-user-allo_relay_attenuator
else
  echo "Sudoers configured"
fi

# =============================================================================
# CONFIGURE: I2C
# =============================================================================
echo ""
echo "Configuring I2C..."

# I2C is already enabled in volumioconfig.txt for Volumio
# Just verify I2C device is available
if [ -e /dev/i2c-1 ]; then
  echo "I2C is available"
else
  echo "WARNING: I2C device not found - may need reboot"
fi

# Load I2C module
modprobe i2c-dev 2>/dev/null

# Make I2C module persistent
if ! grep -q "i2c-dev" /etc/modules; then
  echo "i2c-dev" >> /etc/modules
  echo "I2C module made persistent"
fi

echo "I2C configured"

# =============================================================================
# DONE
# =============================================================================
echo ""
echo "=========================================="
echo "Allo Relay Attenuator installation complete"
echo "=========================================="
echo "Version: 4.0.0"
echo "Architecture: $ARCH"
echo ""
echo "Installed packages:"
echo "  - libfn-lgpio0 (GPIO library)"
echo "  - foonerd-rattenu (daemon and client)"
echo "  - liblirc-client0 (IR support)"
echo ""
echo "Installed binaries:"
echo "  - /usr/bin/fn-rattenu (daemon)"
echo "  - /usr/bin/fn-rattenuc (client)"
echo ""
echo "Service: fn-rattenu.service"
echo ""
echo "NOTE: A reboot may be required for I2C changes"
echo "=========================================="
echo ""

echo "plugininstallend"
