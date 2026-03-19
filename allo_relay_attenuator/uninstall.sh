#!/bin/bash
echo "Uninstalling Allo Relay Attenuator plugin"

# Stop daemon
echo "Stopping daemon..."
systemctl stop fn-rattenu.service 2>/dev/null
systemctl disable fn-rattenu.service 2>/dev/null

# Remove service file
rm -f /lib/systemd/system/fn-rattenu.service 2>/dev/null
systemctl daemon-reload

# Remove foonerd packages
echo "Removing packages..."
if dpkg -l | grep -q "^ii  foonerd-rattenu "; then
  dpkg --purge foonerd-rattenu 2>/dev/null
  echo "Removed foonerd-rattenu"
fi

if dpkg -l | grep -q "^ii  libfn-lgpio0 "; then
  dpkg --purge libfn-lgpio0 2>/dev/null
  echo "Removed libfn-lgpio0"
fi

# Remove LIRC config files installed by plugin
echo "Removing LIRC configuration..."
rm -f /etc/lirc/lircd.conf 2>/dev/null
rm -f /etc/lirc/lircrc 2>/dev/null

# Remove sudoers entry
rm -f /etc/sudoers.d/volumio-user-allo_relay_attenuator 2>/dev/null
rm -f /etc/sudoers.d/volumio-allo-relay-attenuator 2>/dev/null

# Remove gpio-ir overlay from userconfig.txt
sed -i '/^dtoverlay=gpio-ir/d' /boot/userconfig.txt 2>/dev/null

# Remove volume persistence file
rm -f /etc/r_attenu.conf 2>/dev/null
rm -f /etc/fn-rattenu.conf 2>/dev/null

echo ""
echo "Allo Relay Attenuator uninstalled"
echo ""
echo "Removed components:"
echo "  - fn-rattenu daemon and service"
echo "  - foonerd-rattenu package"
echo "  - libfn-lgpio0 package"
echo "  - LIRC configuration files"
echo ""
echo "NOTE: lirc and liblirc-client0 packages were not removed"
echo "      as they may be used by other plugins"
echo ""

echo "pluginuninstallend"
