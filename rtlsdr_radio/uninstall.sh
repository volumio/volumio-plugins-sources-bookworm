#!/bin/bash

echo "Uninstalling FM/DAB Radio plugin"

# Stop any running decoder processes
pkill -f fn-rtl_fm
pkill -f fn-rtl_power
pkill -f fn-rtl-gain
pkill -f fn-dab
pkill -f fn-dab-scanner
pkill -f fn-redsea

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

# Remove DAB and RDS binaries
rm -f /usr/local/bin/fn-dab
rm -f /usr/local/bin/fn-dab-scanner
rm -f /usr/local/bin/fn-redsea
rm -f /usr/local/bin/fn-rtl-gain

# "Auto-backup before uninstall" (Station Manager > Maintenance). Volumio does not tell a
# plugin that it is being uninstalled, so the backup is made here: this script runs
# while the plugin's configuration is still there, and Volumio removes it afterwards.
# With the setting selected, the station list, the block list and the settings are
# copied to the backup folder under the names the Station Manager lists, and the
# station logos are kept. Without it the logos go with the plugin: they can be fetched
# again. The backup folder itself is never removed.
PLUGIN_DATA=/data/configuration/music_service/rtlsdr_radio
BACKUPS=/data/rtlsdr_radio_backups
KEEP_DATA=$(node -e 'try { var c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(c.auto_backup_on_uninstall && c.auto_backup_on_uninstall.value === true ? "yes" : "no"); } catch (e) { process.stdout.write("no"); }' "$PLUGIN_DATA/config.json" 2>/dev/null)
if [ "$KEEP_DATA" = "no" ]; then
  rm -rf /data/rtlsdr_radio_logos
  LOGOS_NOTE="- Station logos"
  echo "Removed station logos"
else
  LOGOS_NOTE=""
  STAMP=$(date -u +%Y-%m-%dT%H-%M-%S-000Z)
  for kind in stations blocklist config; do
    if [ -f "$PLUGIN_DATA/$kind.json" ]; then
      mkdir -p "$BACKUPS/$kind"
      cp "$PLUGIN_DATA/$kind.json" "$BACKUPS/$kind/$kind-$STAMP.json" && echo "Backed up $kind to $BACKUPS/$kind/$kind-$STAMP.json"
    fi
  done
  # This script runs as root; the backups belong to the player's user, who lists and prunes them
  chown -R volumio:volumio "$BACKUPS" 2>/dev/null
  echo "Station logos kept in /data/rtlsdr_radio_logos"
fi

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
echo "- RTL-SDR, DAB decoder, and RDS decoder processes"
echo "- Web management interface (port 3456)"
echo "- Sudoers entry"
echo "- Kernel module blacklist"
echo "- ALSA loopback configuration"
echo "- foonerd-rtlsdr package"
echo "- libfn-rtlsdr0 package"
echo "- DAB binaries (fn-dab, fn-dab-scanner)"
echo "- RDS binary (fn-redsea)"
[ -n "$LOGOS_NOTE" ] && echo "$LOGOS_NOTE"
echo ""
echo "pluginuninstallend"
