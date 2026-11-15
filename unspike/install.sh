#!/bin/sh
# Unspike installer. Runs as root through the plugin manager; its output is
# shown in the install dialog and a non-zero exit fails the install. What it
# puts outside the plugin folder, uninstall.sh takes back. Volumio runs this
# with sh, so it keeps to what sh has.

echo "Installing Unspike"

PLUGIN_DIR="/data/plugins/system_controller/unspike"
SERVICE="unspike"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-unspike"
PLUGINS="/data/configuration/plugins.json"
# The kernel's name. The installer's own tests give one.
KERNEL="${UNSPIKE_KERNEL:-$(uname -r)}"

# A refused install leaves nothing behind, so the next attempt starts clean.
refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

if [ ! -f "$PLUGIN_DIR/systemd/$SERVICE.service" ]; then
  refuse "ERROR: the unit is missing from the package ($PLUGIN_DIR/systemd/$SERVICE.service)"
fi

# =============================================================================
# SETUP: sudo for what the plugin asks of its unit as the volumio user.
# Named volumio-user-* so it sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" << 'SUDO'
# unspike plugin: its unit, switched on and off with the plugin
volumio ALL=(ALL) NOPASSWD: /bin/systemctl enable unspike.service, /bin/systemctl disable unspike.service
SUDO
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

# =============================================================================
# SETUP: the unit. It runs before the player's services, on the 32-bit
# kernel of the Raspberry Pi 4 family only, and has Node do without
# io_uring unless the system already says how Node is to use it. The plugin
# enables it when it is switched on and disables it when it is switched
# off; an update of a plugin in use keeps it enabled.
# =============================================================================
install -m 644 "$PLUGIN_DIR/systemd/$SERVICE.service" "$UNIT"
systemctl daemon-reload
if [ -f "$PLUGINS" ] && tr -d ' \t\r\n' < "$PLUGINS" | grep -q '"unspike":{"enabled":{[^}]*"value":"\{0,1\}true'; then
  systemctl enable "$SERVICE.service" 2>/dev/null || true
fi

chown -R volumio:volumio "$PLUGIN_DIR"

echo "Unspike installed"
case "$KERNEL" in
  *-v7l+)
    echo "This player's kernel is $KERNEL: switch the plugin on and restart the player once; Unspike works from the next start"
    ;;
  *)
    echo "This player's kernel is $KERNEL, not the one Unspike is for (its name ends in -v7l+): the plugin will do nothing here"
    ;;
esac
echo "plugininstallend"
