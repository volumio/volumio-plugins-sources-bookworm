#!/bin/bash
# Display Configuration installer. Runs as root through the plugin manager; its
# output is shown in the install dialog and a non-zero exit fails the install.
# What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing Display Configuration"

PLUGIN_DIR="/data/plugins/user_interface/display_configuration"
HELPER_SRC="$PLUGIN_DIR/scripts/display-configuration-root.sh"
HELPER="/usr/local/bin/display-configuration-root"
SUDOERS="/etc/sudoers.d/volumio-user-display_configuration"
DATA_DIR="/data/INTERNAL/display_configuration"

refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

# =============================================================================
# The root helper: a root-owned copy, so the volumio user runs exactly these
# verbs and nothing else, and sudo for it alone.
# =============================================================================
[ -f "$HELPER_SRC" ] || refuse "ERROR: the plugin's root helper is missing"
install -o root -g root -m 755 "$HELPER_SRC" "$HELPER"
cat > "$SUDOERS" << 'EOF'
# display_configuration plugin: the X cookie, the Xorg snippets, the console turn, the backlight, the kiosk service, the syslinux kernel line
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/display-configuration-root *
EOF
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS" "$HELPER"
  refuse "ERROR: the sudoers entry did not validate"
fi

# =============================================================================
# Backups live outside the plugin and its configuration, on the Internal Storage
# share, so they survive uninstall and reinstall.
# =============================================================================
mkdir -p "$DATA_DIR/backups"
chown -R volumio:volumio "$DATA_DIR"

# =============================================================================
# The screensaver and cursor tools. The image carries unclutter and xset;
# unclutter-xfixes and xscreensaver are installed where missing. A failure here
# is not fatal: the plugin runs with what is present and says so.
# =============================================================================
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
missing=""
for p in unclutter-xfixes xscreensaver xscreensaver-data-extra; do installed "$p" || missing="$missing $p"; done
if [ -n "$missing" ]; then
  echo "Installing:$missing"
  # shellcheck disable=SC2086
  if apt-get update >/dev/null 2>&1 && apt-get install -y $missing >/dev/null 2>&1; then
    echo "Installed:$missing"
  else
    echo "WARNING: could not install$missing; the screen-off screensaver works without them"
  fi
fi

chmod +x "$PLUGIN_DIR"/scripts/*.sh 2>/dev/null || true
chown -R volumio:volumio "$PLUGIN_DIR"

echo "Display Configuration installed"
echo "plugininstallend"
