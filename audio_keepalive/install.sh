#!/bin/sh
# Audio Keepalive installer. Volumio runs it as root through its plugin manager; its
# output is shown in the install dialog and a non-zero exit fails the install. POSIX sh
# only. What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing Audio Keepalive"

PLUGIN_DIR=/data/plugins/audio_interface/audio_keepalive
UNIT=/etc/systemd/system/audio-keepalive.service
SUDOERS=/etc/sudoers.d/volumio-user-audio_keepalive
DAEMON=audio-keepalive-daemon
MODULE=libasound_module_pcm_keepalive.so

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
# CHECK: the daemon and the ALSA client for this machine. The unzip keeps no
# modes, and a binary for the wrong machine fails here rather than at playback.
# =============================================================================
chmod +x "$PLUGIN_DIR"/bin/*/"$DAEMON" 2>/dev/null || true
[ -x "$PLUGIN_DIR/bin/$ARCH/$DAEMON" ] || refuse "ERROR: no daemon for architecture $ARCH (available: $(ls "$PLUGIN_DIR/bin" 2>/dev/null | tr '\n' ' '))"
[ -f "$PLUGIN_DIR/asound/$ARCH/$MODULE" ] || refuse "ERROR: no ALSA client for architecture $ARCH"
"$PLUGIN_DIR/bin/$ARCH/$DAEMON" --version >/dev/null 2>&1 || refuse "ERROR: the daemon for $ARCH does not run on this machine"
echo "Daemon: $("$PLUGIN_DIR/bin/$ARCH/$DAEMON" --version)"

# One name for each binary, whatever the architecture: the unit names the daemon
# in bin/, the ALSA contribution names the client in asound/.
ln -sf "$PLUGIN_DIR/bin/$ARCH/$DAEMON" "$PLUGIN_DIR/bin/$DAEMON"
ln -sf "$PLUGIN_DIR/asound/$ARCH/$MODULE" "$PLUGIN_DIR/asound/$MODULE"
chown -R volumio:volumio "$PLUGIN_DIR"

# =============================================================================
# CLEANUP: what 2.0.x put outside the plugin folder.
# =============================================================================
systemctl stop audio-keepalive.service 2>/dev/null || true
rm -f /lib/systemd/system/audio-keepalive.service /usr/bin/audio-keepalive-daemon
for dir in /usr/lib/arm-linux-gnueabihf/alsa-lib /usr/lib/aarch64-linux-gnu/alsa-lib /usr/lib/x86_64-linux-gnu/alsa-lib; do
  rm -f "$dir/$MODULE"
done

# =============================================================================
# SETUP: the daemon's unit. Not enabled: the plugin starts and stops it.
# =============================================================================
install -m 644 "$PLUGIN_DIR/systemd/audio-keepalive.service" "$UNIT"
systemctl daemon-reload

# =============================================================================
# SETUP: sudo for what the plugin runs as the volumio user: the daemon's service,
# and nothing wider. Named volumio-user-* so it sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" <<'RULES'
# audio_keepalive plugin: the daemon's service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start audio-keepalive.service, /bin/systemctl stop audio-keepalive.service, /bin/systemctl restart audio-keepalive.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl start audio-keepalive.service, /usr/bin/systemctl stop audio-keepalive.service, /usr/bin/systemctl restart audio-keepalive.service
RULES
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

echo "Audio Keepalive installed"
echo "plugininstallend"
