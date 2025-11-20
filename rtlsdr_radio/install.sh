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

# Verify architecture is supported
if [ ! -d "$BIN_SOURCE" ]; then
  echo "ERROR: Architecture $ARCH not supported"
  echo "Available: arm, armv7, armv8, x64"
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

# Install RTL-SDR libraries (lightweight, no compilation)
echo "Installing RTL-SDR libraries..."
apt-get install -y rtl-sdr librtlsdr0

# Install runtime dependencies for DAB (no build tools)
echo "Installing DAB runtime dependencies..."
apt-get install -y libfftw3-3 libsamplerate0 libfaad2

# Create librtlsdr.so symlink for dlopen compatibility
# DAB binaries use dlopen("librtlsdr.so") but package only provides librtlsdr.so.0
echo "Creating librtlsdr.so symlink..."
if [ -f "$LIB_DIR/librtlsdr.so.0" ] && [ ! -e "$LIB_DIR/librtlsdr.so" ]; then
  ln -s "$LIB_DIR/librtlsdr.so.0" "$LIB_DIR/librtlsdr.so"
  echo "Created symlink: $LIB_DIR/librtlsdr.so -> librtlsdr.so.0"
elif [ -e "$LIB_DIR/librtlsdr.so" ]; then
  echo "Symlink already exists: $LIB_DIR/librtlsdr.so"
else
  echo "WARNING: Could not create librtlsdr.so symlink - library not found"
fi

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

# Copy pre-compiled binaries
echo "Installing DAB binaries..."
cp "$BIN_SOURCE/dab-rtlsdr-3" /usr/local/bin/
cp "$BIN_SOURCE/dab-scanner-3" /usr/local/bin/
chmod +x /usr/local/bin/dab-rtlsdr-3
chmod +x /usr/local/bin/dab-scanner-3

# Verify installation
if [ ! -f /usr/local/bin/dab-rtlsdr-3 ]; then
  echo "ERROR: dab-rtlsdr-3 installation failed"
  exit 1
fi

if [ ! -f /usr/local/bin/dab-scanner-3 ]; then
  echo "ERROR: dab-scanner-3 installation failed"
  exit 1
fi

echo "DAB binaries installed successfully"

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
echo "Version: 1.0.8"
echo "Architecture: $ARCH"
echo "Binaries: /usr/local/bin/dab-{rtlsdr,scanner}-3"
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
