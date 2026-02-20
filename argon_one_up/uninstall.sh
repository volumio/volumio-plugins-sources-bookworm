#!/bin/bash

echo "Uninstalling Argon ONE UP plugin"

# Remove sudoers entry
rm -f /etc/sudoers.d/volumio-user-argon_one_up 2>/dev/null

# Remove Argon ONE UP boot options from userconfig.txt
USERCONFIG="/boot/userconfig.txt"
if [ -f "$USERCONFIG" ] && [ -w "$USERCONFIG" ]; then
    grep -v "^dtparam=uart0=on$" "$USERCONFIG" 2>/dev/null | \
    grep -v "^dtoverlay=dwc2,dr_mode=host$" | \
    grep -v "^dtparam=pciex1_gen=3$" | \
    grep -v "^usb_max_current_enable=1$" | \
    grep -v "^dtparam=ant2$" > "${USERCONFIG}.tmp" && mv "${USERCONFIG}.tmp" "$USERCONFIG"
fi

# Stop and remove keyboard handler service
SERVICE_NAME="argon-one-up-keyboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
if [ -f "$SERVICE_FILE" ]; then
    systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
    systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    echo "Keyboard handler service removed."
fi

# Remove keyboard notify / volume request / ups log files (plugin-owned)
rm -f /dev/shm/argon_keyboard_notify.txt /dev/shm/argon_volume_request.txt /dev/shm/argononeupkeyboardlock.txt /dev/shm/argononeupkeyboardlock.txt.a 2>/dev/null || true
# upslog.txt may be recreated by plugin; optional: rm -f /dev/shm/upslog.txt

# Note: We do not disable I2C as other plugins may depend on it
# Note: We do not remove i2c-tools or python3-evdev as other plugins may depend on them

echo "Argon ONE UP plugin uninstalled"
echo "pluginuninstallend"
