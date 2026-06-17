#!/bin/bash

# RaspDacMini LCD Plugin Uninstallation Script

echo "Uninstalling RaspDacMini LCD plugin..."

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PLUGIN_SERVICES="rdmlcd.service rdmlcd-splash.service rdmlcd-shutdown.service rdm_remote.service rdm_irexec.service"

echo "Stopping and disabling plugin services..."

for svc in $PLUGIN_SERVICES; do
    systemctl stop "$svc" 2>/dev/null
    systemctl disable "$svc" 2>/dev/null
done

if [ -x /usr/local/bin/rdmlcd-overlay.sh ]; then
    /usr/local/bin/rdmlcd-overlay.sh unload
fi

echo "Removing service files..."

for svc in $PLUGIN_SERVICES; do
    if [ -f "/etc/systemd/system/$svc" ]; then
        rm -f "/etc/systemd/system/$svc"
        echo "Removed /etc/systemd/system/$svc"
    fi
done

if [ -d /etc/systemd/system/rdmlcd.service.d ]; then
    rm -rf /etc/systemd/system/rdmlcd.service.d
    echo "Service override directory removed"
fi

rm -f /etc/systemd/system/multi-user.target.wants/rdmlcd-shutdown.service

echo "Restoring plymouth splash services..."
for unit in plymouth-start.service plymouth-kexec.service plymouth-poweroff.service plymouth-reboot.service plymouth-halt.service; do
    systemctl unmask "$unit" 2>/dev/null
done

systemctl daemon-reload
systemctl reset-failed rdmlcd.service rdmlcd-splash.service rdmlcd-shutdown.service rdm_remote.service rdm_irexec.service 2>/dev/null

echo "Removing LIRC configuration..."

systemctl unmask lircd.service lircd.socket 2>/dev/null

if [ -d "$PLUGIN_DIR/lirc" ]; then
    rm -rf "$PLUGIN_DIR/lirc"
    echo "LIRC config directory removed"
fi

if [ -f /usr/local/bin/volumio-browse-source ]; then
    rm -f /usr/local/bin/volumio-browse-source
    echo "Source browser script removed"
fi

if [ -f /usr/local/bin/option-handler.sh ]; then
    rm -f /usr/local/bin/option-handler.sh
    echo "Option handler script removed"
fi

rm -f /tmp/volumio_source_index /tmp/volumio_sources_list 2>/dev/null
rm -f /tmp/option_press.lock /tmp/option_long_press 2>/dev/null

echo "Removing helper scripts..."

for helper in rdmlcd-update-env.sh rdmlcd-show-splash.sh rdmlcd-shutdown-splash.sh rdmlcd-plugin-services.sh rdmlcd-overlay.sh; do
    if [ -f "/usr/local/bin/$helper" ]; then
        rm -f "/usr/local/bin/$helper"
        echo "Removed /usr/local/bin/$helper"
    fi
done

if [ -f /etc/sudoers.d/volumio-user-raspdac-mini-lcd ]; then
    rm -f /etc/sudoers.d/volumio-user-raspdac-mini-lcd
    echo "Sudoers entry removed"
fi

systemctl daemon-reload

echo "Removing boot configuration..."

if [ -f /boot/userconfig.txt ]; then
    cp /boot/userconfig.txt /boot/userconfig.txt.backup

    sed -i '/# RaspDacMini LCD Display/d' /boot/userconfig.txt
    sed -i '/dtoverlay=raspdac-mini-lcd/d' /boot/userconfig.txt

    sed -i '/# IR Remote Control/d' /boot/userconfig.txt
    sed -i '/dtoverlay=gpio-ir,gpio_pin=4/d' /boot/userconfig.txt

    echo "Boot configuration cleaned"
else
    echo "Boot configuration file not found"
fi

if [ -f /home/volumio/raspdac_mini_lcd.installing ]; then
    rm -f /home/volumio/raspdac_mini_lcd.installing
    echo "Lock file removed"
fi

echo ""
echo "=========================================="
echo "RaspDacMini LCD Plugin Uninstallation Complete"
echo "=========================================="
echo ""
echo "IMPORTANT: A reboot is recommended to fully remove the device tree overlay."
echo ""
echo "Preserved (by design):"
echo "  - Device tree overlay file (/boot/overlays/raspdac-mini-lcd.dtbo)"
echo ""

echo "pluginuninstallend"
