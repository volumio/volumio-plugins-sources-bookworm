#!/bin/bash
# Pi Screen Setup installer. Volumio's plugin manager runs it as root with sh; its
# output is shown in the install dialog and a non-zero exit fails the install.
# What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing Pi Screen Setup"

PLUGIN_DIR="/data/plugins/system_hardware/pi_screen_setup"
HELPER_SRC="$PLUGIN_DIR/scripts/pi-screen-setup-root.sh"
HELPER="/usr/local/bin/pi-screen-setup-root"
SUDOERS="/etc/sudoers.d/volumio-user-pi_screen_setup"
DATA_DIR="/data/INTERNAL/pi_screen_setup"

refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

MODEL=$(tr -d '\000' < /proc/device-tree/model 2>/dev/null || echo "unknown")
echo "Board: $MODEL"
case "$MODEL" in
  *"Raspberry Pi"*) ;;
  *) echo "WARNING: this does not look like a Raspberry Pi; the plugin configures Raspberry Pi boot files" ;;
esac
[ -d /boot ] && [ -f /boot/config.txt ] || refuse "ERROR: /boot/config.txt not found"

# =============================================================================
# The root helper: a root-owned copy, so the volumio user runs exactly these
# verbs and nothing else, and sudo for it alone. Replaces the cp/chmod/rm grants
# of releases before 1.0.
# =============================================================================
[ -f "$HELPER_SRC" ] || refuse "ERROR: the plugin's root helper is missing"
install -o root -g root -m 755 "$HELPER_SRC" "$HELPER"
cat > "$SUDOERS" << 'SUDO'
# pi_screen_setup plugin: the boot files it manages, through its root helper only
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/pi-screen-setup-root *
SUDO
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS" "$HELPER"
  refuse "ERROR: the sudoers entry did not validate"
fi

# =============================================================================
# Backups, restore points, the presets the user authored or fetched, and the record of
# what was stripped from Volumio's files live on the Internal Storage share, outside the plugin folder (which an update
# replaces and an uninstall removes), so they survive both.
# =============================================================================
mkdir -p "$DATA_DIR/backups/factory" "$DATA_DIR/backups/restore_points" "$DATA_DIR/strip" "$DATA_DIR/presets_cache"
OLD_BACKUPS="$PLUGIN_DIR/backups"
if [ -d "$OLD_BACKUPS" ] && [ ! -f "$DATA_DIR/backups/factory/config.txt" ]; then
  cp -a "$OLD_BACKUPS/." "$DATA_DIR/backups/" 2>/dev/null || true
fi

# The boot files as found the first time the plugin is installed on this system.
if [ ! -f "$DATA_DIR/backups/factory/config.txt" ]; then
  for f in config.txt cmdline.txt volumioconfig.txt userconfig.txt; do
    [ -f "/boot/$f" ] && cp "/boot/$f" "$DATA_DIR/backups/factory/$f"
  done
  date -Iseconds > "$DATA_DIR/backups/factory/backup_date.txt"
  echo "Boot files saved as found"
fi
chown -R volumio:volumio "$DATA_DIR"

# Display settings already in Volumio's files: the plugin offers to take them over.
if grep -qE "^dtoverlay=vc4-(f?)kms|^dtoverlay=.*(dsi|dpi|hyperpixel|vga666)|^hdmi_|^config_hdmi_boost|^max_framebuffer_|^sdtv_|^framebuffer_|^enable_tvout|^display_auto_detect|^display_default_lcd" /boot/volumioconfig.txt /boot/userconfig.txt 2>/dev/null; then
  echo "Existing display settings found in the boot files; the plugin will offer to take them over"
fi

# A placeholder, so an include line left from an earlier install points at a file.
if [ ! -f /boot/videoconfig.txt ]; then
  printf '# Pi Screen Setup - configuration pending\n# Run the plugin in Volumio to configure the display\n' > /boot/videoconfig.txt
  chmod 644 /boot/videoconfig.txt
fi

chmod +x "$PLUGIN_DIR"/scripts/*.sh 2>/dev/null || true
chown -R volumio:volumio "$PLUGIN_DIR"

echo "Pi Screen Setup installed"
echo "plugininstallend"
