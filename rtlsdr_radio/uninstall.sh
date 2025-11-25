#!/bin/bash

echo "Uninstalling FM/DAB Radio plugin"

# Stop any running decoder processes
pkill -f fn-rtl_fm
pkill -f fn-rtl_power
pkill -f fn-dab
pkill -f fn-dab-scanner

# Remove sudoers entry
if [ -f /etc/sudoers.d/volumio-user-rtlsdr-radio ]; then
  rm -f /etc/sudoers.d/volumio-user-rtlsdr-radio
  echo "Removed sudoers entry"
fi

# Remove RTL-SDR kernel module blacklist
if [ -f /etc/modprobe.d/blacklist-rtl-sdr.conf ]; then
  rm -f /etc/modprobe.d/blacklist-rtl-sdr.conf
  echo "Removed RTL-SDR kernel module blacklist"
  echo "NOTE: DVB-T drivers will load automatically on next RTL-SDR dongle connection"
fi

# Remove ALSA loopback from persistent modules
sed -i '/snd-aloop/d' /etc/modules

# Unload ALSA loopback module
rmmod snd-aloop 2>/dev/null

# Remove DAB binaries
rm -f /usr/local/bin/fn-dab
rm -f /usr/local/bin/fn-dab-scanner

# Remove foonerd RTL-SDR packages
echo "Removing foonerd RTL-SDR packages..."
if dpkg -l | grep -q "^ii  foonerd-rtlsdr "; then
  dpkg --purge foonerd-rtlsdr 2>/dev/null
  echo "Removed foonerd-rtlsdr"
fi

if dpkg -l | grep -q "^ii  libfn-rtlsdr0 "; then
  dpkg --purge libfn-rtlsdr0 2>/dev/null
  echo "Removed libfn-rtlsdr0"
fi

# Clean up udev rules that may be left behind
echo "Cleaning up udev rules..."
rm -f /lib/udev/rules.d/60-libfn-rtlsdr0.rules 2>/dev/null
rm -f /etc/udev/rules.d/60-libfn-rtlsdr0.rules 2>/dev/null

# Remove librtlsdr.so compatibility symlink
echo "Removing compatibility symlinks..."
rm -f /usr/lib/arm-linux-gnueabihf/librtlsdr.so 2>/dev/null
rm -f /usr/lib/aarch64-linux-gnu/librtlsdr.so 2>/dev/null
rm -f /usr/lib/x86_64-linux-gnu/librtlsdr.so 2>/dev/null

# Reload udev rules after package removal
echo "Reloading udev rules..."
udevadm control --reload-rules
udevadm trigger

echo ""
echo "FM/DAB Radio plugin uninstalled"
echo ""
echo "Removed components:"
echo "- RTL-SDR and DAB decoder processes"
echo "- Web management interface (port 3456)"
echo "- Sudoers entry"
echo "- Kernel module blacklist"
echo "- ALSA loopback configuration"
echo "- foonerd-rtlsdr package"
echo "- libfn-rtlsdr0 package"
echo "- DAB binaries (fn-dab, fn-dab-scanner)"
echo ""
echo "pluginuninstallend"
