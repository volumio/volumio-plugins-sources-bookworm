#!/bin/sh
# MPDantic installer. Volumio runs it as root through its plugin manager; its output is
# shown in the install dialog and a non-zero exit fails the install. POSIX sh only. What
# it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing MPDantic"

PLUGIN_DIR=/data/plugins/system_controller/mpdantic
DATA_DIR=/data/INTERNAL/mpdantic
UNIT=/etc/systemd/system/mpdantic.service
SUDOERS=/etc/sudoers.d/volumio-user-mpdantic

# A refused install leaves nothing behind, so the next attempt starts clean.
refuse() {
  echo ""
  echo "$1"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

# VOLUMIO_ARCH is the os-release value, which is also the folder the binaries are in.
ARCH=$(sed -n 's/^VOLUMIO_ARCH="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' /etc/os-release)
[ -n "$ARCH" ] || refuse "ERROR: could not detect the Volumio architecture"
case "$ARCH" in
  aarch64) ARCH=armv8 ;;
  amd64) ARCH=x64 ;;
esac
echo "Architecture: $ARCH"

# =============================================================================
# CHECK: the core for this machine. The unzip keeps no modes, and a binary for the
# wrong machine fails here rather than at the first use.
# =============================================================================
chmod +x "$PLUGIN_DIR"/bin/*/mpdantic 2>/dev/null || true
[ -x "$PLUGIN_DIR/bin/$ARCH/mpdantic" ] || refuse "ERROR: no core binary for architecture $ARCH (available: $(ls "$PLUGIN_DIR/bin" 2>/dev/null | tr '\n' ' '))"
"$PLUGIN_DIR/bin/$ARCH/mpdantic" --version >/dev/null 2>&1 || refuse "ERROR: the core binary for $ARCH does not run on this machine"
echo "Core: $("$PLUGIN_DIR/bin/$ARCH/mpdantic" --version)"

# One name for the binary, whatever the architecture: the unit names it.
ln -sf "$PLUGIN_DIR/bin/$ARCH/mpdantic" "$PLUGIN_DIR/bin/mpdantic"

# The mount helper sudo runs: only cifs/nfs under /run/mpdantic/mounts.
chmod +x "$PLUGIN_DIR/bin/mpdantic-mount" 2>/dev/null || true
[ -x "$PLUGIN_DIR/bin/mpdantic-mount" ] || refuse "ERROR: the mount helper is missing"

# =============================================================================
# SETUP: the folders. The data folder is for what the user can undo and is never
# removed by an uninstall.
# =============================================================================
mkdir -p "$DATA_DIR"
chown -R volumio:volumio "$PLUGIN_DIR" "$DATA_DIR"

# =============================================================================
# SETUP: the core's unit. Not enabled: the plugin starts and stops it.
# =============================================================================
install -m 644 "$PLUGIN_DIR/mpdantic.service" "$UNIT"
systemctl daemon-reload

# =============================================================================
# SETUP: sudo for what the plugin runs as the volumio user: the core's service, and
# nothing wider. Named volumio-user-* so it sorts after Volumio's own rules.
# =============================================================================
# Self-contained, as the family's plugins are: every command the plugin runs through
# sudo is here, whatever Volumio's own rule for the volumio user lists. The name sorts
# after /etc/sudoers.d/volumio-user, as the convention has it.
cat > "$SUDOERS" <<'EOF'
# mpdantic plugin: the core's service; the mount helper (cifs/nfs under
# /run/mpdantic/mounts only); the announcement file where the Avahi folder is closed
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start mpdantic.service, /bin/systemctl stop mpdantic.service, /bin/systemctl restart mpdantic.service, /bin/systemctl is-active mpdantic.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl start mpdantic.service, /usr/bin/systemctl stop mpdantic.service, /usr/bin/systemctl restart mpdantic.service, /usr/bin/systemctl is-active mpdantic.service
volumio ALL=(ALL) NOPASSWD: /data/plugins/system_controller/mpdantic/bin/mpdantic-mount
volumio ALL=(ALL) NOPASSWD: /usr/bin/tee /etc/avahi/services/mpdantic.service, /bin/rm -f /etc/avahi/services/mpdantic.service, /usr/bin/rm -f /etc/avahi/services/mpdantic.service
EOF
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

echo "MPDantic installed"
echo "plugininstallend"
