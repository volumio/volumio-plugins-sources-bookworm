#!/bin/sh
# Outcast Uplink installer. Volumio runs it as root through its plugin manager; its
# output is shown in the install dialog and a non-zero exit fails the install. POSIX sh
# only. What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing Outcast Uplink"

PLUGIN_DIR=/data/plugins/audio_interface/outcast
DATA_DIR=/data/INTERNAL/outcast
UNIT=/etc/systemd/system/outcast.service
SUDOERS=/etc/sudoers.d/volumio-user-outcast

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
  # Volumio's universal Raspberry Pi image calls itself arm and runs ARMv7 code: the armv7
  # files serve it, the same build it had under its own name until 0.1.27, shipped once.
  arm) ARCH=armv7 ;;
  aarch64) ARCH=armv8 ;;
  amd64) ARCH=x64 ;;
esac
echo "Architecture: $ARCH"

# =============================================================================
# CHECK: the binaries and the library for this machine. The unzip keeps no modes, and
# a binary for the wrong machine fails here rather than at the first stream.
# =============================================================================
chmod +x "$PLUGIN_DIR"/bin/*/outcast "$PLUGIN_DIR"/bin/*/evopeg "$PLUGIN_DIR"/bin/*/evotap-cat 2>/dev/null || true
[ -x "$PLUGIN_DIR/bin/$ARCH/outcast" ] || refuse "ERROR: no core binary for architecture $ARCH (available: $(ls "$PLUGIN_DIR/bin" 2>/dev/null | tr '\n' ' '))"
[ -x "$PLUGIN_DIR/bin/$ARCH/evopeg" ] || refuse "ERROR: no encoder binary for architecture $ARCH"
[ -f "$PLUGIN_DIR/lib/$ARCH/libevotap.so" ] || refuse "ERROR: no tap library for architecture $ARCH"
"$PLUGIN_DIR/bin/$ARCH/outcast" --version >/dev/null 2>&1 || refuse "ERROR: the core binary for $ARCH does not run on this machine"
"$PLUGIN_DIR/bin/$ARCH/evopeg" -version >/dev/null 2>&1 || refuse "ERROR: the encoder binary for $ARCH does not run on this machine"
echo "Core: $("$PLUGIN_DIR/bin/$ARCH/outcast" --version)"
echo "Encoder: $("$PLUGIN_DIR/bin/$ARCH/evopeg" -version | head -n 1)"

# One name per binary and for the library, whatever the architecture: the unit, the
# ALSA snippet and the plugin name these.
ln -sf "$PLUGIN_DIR/bin/$ARCH/outcast" "$PLUGIN_DIR/bin/outcast"
ln -sf "$PLUGIN_DIR/bin/$ARCH/evopeg" "$PLUGIN_DIR/bin/evopeg"
ln -sf "$PLUGIN_DIR/bin/$ARCH/evotap-cat" "$PLUGIN_DIR/bin/evotap-cat"
mkdir -p "$PLUGIN_DIR/lib"
ln -sf "$PLUGIN_DIR/lib/$ARCH/libevotap.so" "$PLUGIN_DIR/lib/libevotap.so"
echo "Tap: $PLUGIN_DIR/lib/$ARCH/libevotap.so"

# =============================================================================
# SETUP: the node modules. The zip carries none: the plugin store wants them made on the
# player, as Volumio's own plugin tool makes them, so the install makes them here from
# the npm registry at the versions package-lock.json pins. The player needs the internet
# for this, as it did to fetch the plugin.
# =============================================================================
command -v npm >/dev/null 2>&1 || refuse "ERROR: npm is not on this player; the plugin's modules cannot be installed"
echo "Modules: installing from the npm registry"
( cd "$PLUGIN_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error --fetch-retries=3 ) \
  || refuse "ERROR: the plugin's modules could not be installed from the npm registry; is the player online?"
for module in $(sed -n '/"dependencies"/,/}/p' "$PLUGIN_DIR/package.json" | sed -n 's/^ *"\([^"]*\)": *"[^"]*",*$/\1/p'); do
  [ -f "$PLUGIN_DIR/node_modules/$module/package.json" ] || refuse "ERROR: the module $module did not install"
done
echo "Modules: $(find "$PLUGIN_DIR/node_modules" -mindepth 1 -maxdepth 1 -type d | wc -l) installed"

# =============================================================================
# SETUP: the folders. The ALSA contribution is written by the plugin when it starts,
# after it has proved the tap loads; the data folder is for recordings and is never
# removed by an uninstall.
# =============================================================================
mkdir -p "$PLUGIN_DIR/asound" "$DATA_DIR"
chown -R volumio:volumio "$PLUGIN_DIR" "$DATA_DIR"

# =============================================================================
# SETUP: the core's unit. Not enabled: the plugin starts and stops it.
# =============================================================================
install -m 644 "$PLUGIN_DIR/outcast.service" "$UNIT"
systemctl daemon-reload

# =============================================================================
# SETUP: sudo for what the plugin runs as the volumio user: the core's service, and
# nothing wider. Named volumio-user-* so it sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" <<'EOF'
# outcast plugin: the core's service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start outcast.service, /bin/systemctl stop outcast.service, /bin/systemctl restart outcast.service, /bin/systemctl is-active outcast.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl start outcast.service, /usr/bin/systemctl stop outcast.service, /usr/bin/systemctl restart outcast.service, /usr/bin/systemctl is-active outcast.service
EOF
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

echo "Outcast Uplink installed"
echo "plugininstallend"
