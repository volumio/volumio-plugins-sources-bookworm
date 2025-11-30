#!/bin/bash
echo "Installing FM/DAB Radio plugin dependencies"

# Get Volumio architecture - direct match to bin/ folder
ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')

if [ -z "$ARCH" ]; then
  echo "ERROR: Could not detect Volumio architecture"
  exit 1
fi

echo "Detected architecture: $ARCH"

PLUGIN_DIR="/data/plugins/music_service/rtlsdr_radio"
BIN_SOURCE="$PLUGIN_DIR/bin/$ARCH"
PKG_SOURCE="$PLUGIN_DIR/packages/$ARCH"

# Verify architecture is supported
if [ ! -d "$BIN_SOURCE" ]; then
  echo "ERROR: Architecture $ARCH not supported"
  echo "Available: arm, armv7, armv8, x64"
  exit 1
fi

if [ ! -d "$PKG_SOURCE" ]; then
  echo "ERROR: Packages for architecture $ARCH not found"
  exit 1
fi

# Set library directory based on architecture
case "$ARCH" in
  arm|armv7)
    LIB_DIR="/usr/lib/arm-linux-gnueabihf"
    ;;
  armv8)
    LIB_DIR="/usr/lib/aarch64-linux-gnu"
    ;;
  x64)
    LIB_DIR="/usr/lib/x86_64-linux-gnu"
    ;;
  *)
    echo "ERROR: Unknown architecture: $ARCH"
    exit 1
    ;;
esac

echo "Using binaries from: $BIN_SOURCE"
echo "Using packages from: $PKG_SOURCE"
echo "Library directory: $LIB_DIR"

# Check if web management port is available
echo "Checking web management port availability..."
WEB_PORT=3456
if netstat -tuln 2>/dev/null | grep -q ":$WEB_PORT "; then
  echo "WARNING: Port $WEB_PORT is already in use"
  echo "Web management interface may not start"
  echo "You may need to change managementPort in index.js"
elif command -v ss >/dev/null 2>&1; then
  if ss -tuln 2>/dev/null | grep -q ":$WEB_PORT "; then
    echo "WARNING: Port $WEB_PORT is already in use"
    echo "Web management interface may not start"
    echo "You may need to change managementPort in index.js"
  else
    echo "Port $WEB_PORT is available for web management"
  fi
else
  echo "Port $WEB_PORT will be used for web management"
fi

# =============================================================================
# CLEANUP: Remove mainstream RTL-SDR packages and old plugin artifacts
# =============================================================================
echo ""
echo "Cleaning up mainstream RTL-SDR packages and old artifacts..."

# Stop any running RTL-SDR processes
echo "Stopping any running RTL-SDR processes..."
pkill -f "rtl_fm" 2>/dev/null
pkill -f "rtl_power" 2>/dev/null
pkill -f "dab-rtlsdr-3" 2>/dev/null
pkill -f "dab-scanner-3" 2>/dev/null
pkill -f "fn-rtl_fm" 2>/dev/null
pkill -f "fn-rtl_power" 2>/dev/null
pkill -f "fn-dab" 2>/dev/null
pkill -f "fn-dab-scanner" 2>/dev/null
sleep 1

# Remove old plugin binaries from previous installs
echo "Removing old plugin binaries..."
rm -f /usr/local/bin/dab-rtlsdr-3
rm -f /usr/local/bin/dab-scanner-3
rm -f /usr/local/bin/fn-dab
rm -f /usr/local/bin/fn-dab-scanner

# Remove mainstream RTL-SDR packages if installed
# These conflict with our custom foonerd packages
echo "Removing mainstream RTL-SDR packages if present..."
if dpkg -l | grep -q "^ii  rtl-sdr "; then
  echo "Removing rtl-sdr package..."
  apt-get remove -y rtl-sdr 2>/dev/null
fi

if dpkg -l | grep -q "^ii  librtlsdr-dev "; then
  echo "Removing librtlsdr-dev package..."
  apt-get remove -y librtlsdr-dev 2>/dev/null
fi

if dpkg -l | grep -q "^ii  librtlsdr2 "; then
  echo "Removing librtlsdr2 package..."
  apt-get remove -y librtlsdr2 2>/dev/null
fi

if dpkg -l | grep -q "^ii  librtlsdr0 "; then
  echo "Removing librtlsdr0 package..."
  apt-get remove -y librtlsdr0 2>/dev/null
fi

# Remove any previously installed foonerd package variants from manual testing
# Variant 1: blog naming
echo "Checking for foonerd blog variant packages..."
if dpkg -l | grep -q "^ii  foonerd-rtlsdr-blog "; then
  echo "Removing foonerd-rtlsdr-blog package..."
  dpkg --purge foonerd-rtlsdr-blog 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr-blog-dev "; then
  echo "Removing libfn-rtlsdr-blog-dev package..."
  dpkg --purge libfn-rtlsdr-blog-dev 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr-blog0 "; then
  echo "Removing libfn-rtlsdr-blog0 package..."
  dpkg --purge libfn-rtlsdr-blog0 2>/dev/null
fi

# Variant 2: osmocom naming
echo "Checking for foonerd osmocom variant packages..."
if dpkg -l | grep -q "^ii  foonerd-rtlsdr-osmocom "; then
  echo "Removing foonerd-rtlsdr-osmocom package..."
  dpkg --purge foonerd-rtlsdr-osmocom 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr-osmocom-dev "; then
  echo "Removing libfn-rtlsdr-osmocom-dev package..."
  dpkg --purge libfn-rtlsdr-osmocom-dev 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr-osmocom0 "; then
  echo "Removing libfn-rtlsdr-osmocom0 package..."
  dpkg --purge libfn-rtlsdr-osmocom0 2>/dev/null
fi

# Variant 3: current naming (ensure clean reinstall)
echo "Checking for existing foonerd packages..."
if dpkg -l | grep -q "^ii  foonerd-rtlsdr "; then
  echo "Removing existing foonerd-rtlsdr package..."
  dpkg --purge foonerd-rtlsdr 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr-dev "; then
  echo "Removing existing libfn-rtlsdr-dev package..."
  dpkg --purge libfn-rtlsdr-dev 2>/dev/null
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr0 "; then
  echo "Removing existing libfn-rtlsdr0 package..."
  dpkg --purge libfn-rtlsdr0 2>/dev/null
fi

# Remove stale symlink created by old install.sh
if [ -L "$LIB_DIR/librtlsdr.so" ]; then
  echo "Removing stale librtlsdr.so symlink..."
  rm -f "$LIB_DIR/librtlsdr.so"
fi

# Reload udev rules after removing packages
udevadm control --reload-rules 2>/dev/null
udevadm trigger 2>/dev/null

# Remove old udev rules that may be left behind from previous installations
echo "Cleaning up old udev rules..."
rm -f /lib/udev/rules.d/60-librtlsdr0.rules 2>/dev/null
rm -f /etc/udev/rules.d/rtl-sdr.rules 2>/dev/null
rm -f /lib/udev/rules.d/rtl-sdr.rules 2>/dev/null
# Also remove our own rules if present (will be reinstalled by package)
rm -f /lib/udev/rules.d/60-libfn-rtlsdr0.rules 2>/dev/null
rm -f /etc/udev/rules.d/60-libfn-rtlsdr0.rules 2>/dev/null

# Clean up any orphaned dependencies
apt-get autoremove -y 2>/dev/null

echo "Cleanup complete"

# =============================================================================
# INSTALL: Bundled foonerd packages and DAB binaries
# =============================================================================
echo ""
echo "Installing bundled RTL-SDR packages..."

# Update package list
apt-get update

# Install zip utilities for backup/restore functionality
echo "Installing zip utilities for backup/restore..."
if ! command -v zip &> /dev/null || ! command -v unzip &> /dev/null; then
  apt-get install -y zip unzip
  echo "Zip utilities installed"
else
  echo "Zip utilities already present"
fi

# Install runtime dependencies for DAB (no build tools)
echo "Installing DAB runtime dependencies..."
apt-get install -y libfftw3-single3 libsamplerate0 libfaad2

# Install sox for RDS audio resampling
echo "Installing sox for RDS audio processing..."
if ! command -v sox &> /dev/null; then
  apt-get install -y sox
  echo "Sox installed"
else
  echo "Sox already present"
fi

# Install bundled foonerd RTL-SDR packages
# Order matters: library first, then binaries
# Note: libfn-rtlsdr-dev is NOT installed - only needed for development, not runtime
echo "Installing libfn-rtlsdr0 (shared library)..."
dpkg -i "$PKG_SOURCE"/libfn-rtlsdr0_*.deb
if [ $? -ne 0 ]; then
  echo "WARNING: libfn-rtlsdr0 had issues, attempting to fix dependencies..."
  apt-get install -f -y
fi

echo "Installing foonerd-rtlsdr (binaries)..."
dpkg -i "$PKG_SOURCE"/foonerd-rtlsdr_*.deb
if [ $? -ne 0 ]; then
  echo "WARNING: foonerd-rtlsdr had issues, attempting to fix dependencies..."
  apt-get install -f -y
fi

# Fix any missing dependencies
apt-get install -f -y

echo "RTL-SDR packages installed successfully"

# Create librtlsdr.so compatibility symlink for DAB binaries
# fn-dab and fn-dab-scanner use dlopen("librtlsdr.so") to load the library
echo "Creating librtlsdr.so compatibility symlink..."
if [ -f "$LIB_DIR/libfn-rtlsdr.so.0" ]; then
  ln -sf "$LIB_DIR/libfn-rtlsdr.so.0" "$LIB_DIR/librtlsdr.so"
  echo "Created symlink: $LIB_DIR/librtlsdr.so -> libfn-rtlsdr.so.0"
else
  echo "WARNING: libfn-rtlsdr.so.0 not found, DAB may not work"
fi

# Reload udev rules to activate RTL-SDR device permissions
echo "Activating udev rules..."
udevadm control --reload-rules
udevadm trigger
echo "Udev rules activated"

# Blacklist DVB-T kernel drivers to allow rtl-sdr userspace access
echo "Configuring RTL-SDR kernel module blacklist..."
cat > /etc/modprobe.d/blacklist-rtl-sdr.conf << EOF
# Blacklist DVB-T kernel drivers to allow rtl-sdr userspace access
# RTL-SDR Radio Plugin for Volumio
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2832_sdr
blacklist rtl2830
blacklist dvb_usb_v2
blacklist dvb_core
EOF

echo "Blacklist configuration created"

# Unload conflicting modules if currently loaded
echo "Unloading conflicting DVB-T kernel modules..."
modprobe -r dvb_usb_rtl28xxu 2>/dev/null
modprobe -r rtl2832_sdr 2>/dev/null
modprobe -r rtl2832 2>/dev/null
modprobe -r dvb_usb_v2 2>/dev/null
modprobe -r dvb_core 2>/dev/null

echo "DVB-T modules unloaded (if they were loaded)"
echo "NOTE: You may need to unplug/replug the RTL-SDR dongle for changes to take effect"

# Copy pre-compiled DAB binaries
echo "Installing DAB binaries..."
cp "$BIN_SOURCE/fn-dab" /usr/local/bin/
cp "$BIN_SOURCE/fn-dab-scanner" /usr/local/bin/
chmod +x /usr/local/bin/fn-dab
chmod +x /usr/local/bin/fn-dab-scanner

# Copy pre-compiled RDS decoder binary
echo "Installing RDS decoder binary..."
cp "$BIN_SOURCE/fn-redsea" /usr/local/bin/
chmod +x /usr/local/bin/fn-redsea

# Verify installation
if [ ! -f /usr/local/bin/fn-dab ]; then
  echo "ERROR: fn-dab installation failed"
  exit 1
fi

if [ ! -f /usr/local/bin/fn-dab-scanner ]; then
  echo "ERROR: fn-dab-scanner installation failed"
  exit 1
fi

if [ ! -f /usr/local/bin/fn-redsea ]; then
  echo "ERROR: fn-redsea installation failed"
  exit 1
fi

echo "DAB and RDS binaries installed successfully"

# Verify RTL-SDR binaries are available
if [ ! -x /usr/bin/fn-rtl_fm ]; then
  echo "ERROR: fn-rtl_fm not found at /usr/bin/fn-rtl_fm"
  exit 1
fi

if [ ! -x /usr/bin/fn-rtl_power ]; then
  echo "ERROR: fn-rtl_power not found at /usr/bin/fn-rtl_power"
  exit 1
fi

echo "RTL-SDR binaries verified"

# Create sudoers entry for process control
echo "Creating sudoers entry for rtlsdr_radio..."
cat > /etc/sudoers.d/volumio-user-rtlsdr-radio << EOF
# rtlsdr_radio plugin - process control
volumio ALL=(ALL) NOPASSWD: /usr/bin/pkill
EOF

chmod 0440 /etc/sudoers.d/volumio-user-rtlsdr-radio
visudo -c -f /etc/sudoers.d/volumio-user-rtlsdr-radio
if [ $? -ne 0 ]; then
  echo "ERROR: Invalid sudoers syntax"
  rm -f /etc/sudoers.d/volumio-user-rtlsdr-radio
  exit 1
fi

echo "Sudoers configuration complete"

# Load ALSA loopback module
echo "Loading ALSA loopback module..."
modprobe snd-aloop

# Make ALSA loopback persistent
if ! grep -q "snd-aloop" /etc/modules; then
  echo "snd-aloop" >> /etc/modules
  echo "Made snd-aloop module persistent"
fi

# Create stations database directory
mkdir -p /data/plugins/music_service/rtlsdr_radio

# Get hostname for web interface URL
HOSTNAME=$(hostname)
if [ -z "$HOSTNAME" ]; then
  HOSTNAME="volumio"
fi

echo ""
echo "=========================================="
echo "FM/DAB Radio plugin installation complete"
echo "=========================================="
echo "Version: 1.3.1"
echo "Architecture: $ARCH"
echo ""
echo "Installed packages:"
echo "  - foonerd-rtlsdr (fn-rtl_fm, fn-rtl_power, etc.)"
echo "  - libfn-rtlsdr0 (shared library)"
echo "  - sox (audio resampling for RDS)"
echo ""
echo "Installed binaries:"
echo "  - /usr/local/bin/fn-dab"
echo "  - /usr/local/bin/fn-dab-scanner"
echo "  - /usr/local/bin/fn-redsea"
echo ""
echo "=========================================="
echo ""
echo "Web Station Management Interface"
echo "URL: http://$HOSTNAME.local:$WEB_PORT"
echo ""
echo "Access station management via plugin settings:"
echo "Settings > Plugins > Installed > FM/DAB Radio"
echo ""
echo "Two ways to open the station manager:"
echo "1. Open in New Tab - opens in new browser tab"
echo "2. Open in Current Window - opens within Volumio interface"
echo ""
echo "plugininstallend"
