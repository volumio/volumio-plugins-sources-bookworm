#!/bin/sh
#
# Remove the plugin-installed tool and every derived file apply wrote.
# Keep /boot/waveshare28.conf (recover, not purge).
#
# Volumio invokes this as `sh uninstall.sh` (dash). No bashisms.

set -eu

echo "Uninstalling Waveshare 2.8 SPI Panel plugin"

BIN_DIR="/usr/local/bin"
SUDOERS_FILE="/etc/sudoers.d/volumio-waveshare28"

if [ -x "${BIN_DIR}/waveshare28-config" ]; then
    echo "recovering derived files (durable conf kept)"
    "${BIN_DIR}/waveshare28-config" recover || true
fi

rm -f "${BIN_DIR}/waveshare28-config" "${BIN_DIR}/waveshare28-panel"
rm -f "$SUDOERS_FILE" /etc/sudoers.d/volumio-user-waveshare28

# Named settings backups in /data/INTERNAL/waveshare28/backups are left
# alone so a later install can restore them.

echo "Waveshare 2.8 SPI Panel plugin uninstalled"
echo "pluginuninstallend"
