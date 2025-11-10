#!/bin/bash

echo "Uninstalling FM/DAB Radio plugin"

# Stop any running decoder processes
pkill -f rtl_fm
pkill -f dab-rtlsdr

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

echo ""
echo "FM/DAB Radio plugin uninstalled"
echo ""
echo "Removed components:"
echo "- RTL-SDR and DAB decoder processes"
echo "- Web management interface (port 3456)"
echo "- Sudoers entry"
echo "- Kernel module blacklist"
echo "- ALSA loopback configuration"
echo ""
echo "Note: RTL-SDR libraries and DAB binaries were NOT removed"
echo "To remove them manually, run:"
echo "  apt-get remove rtl-sdr librtlsdr0"
echo "  rm -f /usr/local/bin/dab-rtlsdr-3"
echo "  rm -f /usr/local/bin/dab-scanner-3"
echo ""
echo "pluginuninstallend"
