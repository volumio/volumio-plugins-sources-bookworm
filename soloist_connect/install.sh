#!/bin/bash
set -e

# Everything below needs root (apt, /etc, systemd). Volumio's plugin manager
# may run this as the volumio user, which has passwordless sudo.
if [ "$(id -u)" != "0" ]; then
  exec sudo -E bash "$0" "$@"
fi

echo "Installing Spotify Soloist Connect (Volumio 4 ALSA)..."

PLUGIN_DIR="/data/plugins/music_service/soloist_connect"

# ---------------------------------------------------------------------------
# Userspace arch (VOLUMIO_ARCH / dpkg / LONG_BIT), not kernel uname -m.
# Official Pi image is armhf (volumio-os/recipes/devices/pi.sh). The stock
# Spotify plugin only ships armhf+amd64. audio_keepalive installs the armhf
# ALSA .so even when VOLUMIO_ARCH=armv8.
# ---------------------------------------------------------------------------
chmod +x "$PLUGIN_DIR/detect-arch.sh"
APULSE_ARCH="$("$PLUGIN_DIR/detect-arch.sh")"
case "$APULSE_ARCH" in
  amd64|arm64|armhf) ;;
  *)
    echo "Unsupported architecture: $APULSE_ARCH (need armhf, arm64, or amd64)"
    echo "plugininstallend"
    exit 1
    ;;
esac
echo "Detected userspace $APULSE_ARCH (uname=$(uname -m))"

APULSE_SRC="$PLUGIN_DIR/alsa-lib/$APULSE_ARCH"
if [ ! -f "$APULSE_SRC/libpulse.so.0" ]; then
  echo "ERROR: Pulse shim for $APULSE_ARCH is not in the plugin package."
  echo "Build it on the development host:"
  echo "  cd alsa_soloist_connect && ./build-matrix.sh"
  echo "  cp -a out/$APULSE_ARCH/. soloist_connect/alsa-lib/$APULSE_ARCH/"
  echo "plugininstallend"
  exit 1
fi

# Runtime library required by the soloist binary
if ! ldconfig -p | grep -q libatomic.so.1; then
  echo "Installing libatomic1..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y libatomic1
fi

# Needed to ELF-patch the soloist binary against the sideloaded glibc.
if ! command -v patchelf >/dev/null 2>&1; then
  echo "Installing patchelf..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y patchelf
fi

# ---------------------------------------------------------------------------
# Data, cache and env directories
# ---------------------------------------------------------------------------
mkdir -p /data/soloist/data /data/soloist/cache /data/soloist/bin /data/soloist/staging
chown -R volumio:volumio /data/soloist

# ---------------------------------------------------------------------------
# Static systemd unit. No Pulse. Device comes from PLAYBACK_DEVICE in the env file.
# ---------------------------------------------------------------------------
chmod +x "$PLUGIN_DIR/launch-soloist.sh" "$PLUGIN_DIR/cache-location.sh"

cat > /etc/systemd/system/soloist.service << 'EOF'
[Unit]
Description=Spotify Soloist daemon (Volumio 4 ALSA)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=volumio
Group=volumio
# "+" runs this as root regardless of User=, which a mount requires. Keeping
# it here rather than in a sudoers rule means no further NOPASSWD binary.
# It reconciles the tmpfs cache with CACHE_LOCATION in the env file and is a
# no-op in disk mode, so it is safe on every start.
ExecStartPre=+/data/plugins/music_service/soloist_connect/cache-location.sh
ExecStart=/data/plugins/music_service/soloist_connect/launch-soloist.sh
Restart=on-failure
RestartSec=5
# Exit code 10 = build expired; don't loop, the plugin re-downloads on next start
RestartPreventExitStatus=10
EOF
systemctl daemon-reload
# Plugin onStart / onStop are the only start and stop. No [Install]
# WantedBy: an enabled unit would come back at boot with the plugin disabled
# and still be a Connect endpoint. Clear a leftover enable from an older
# install. Start is systemctl restart from the plugin, which works while
# disabled.
systemctl disable --now soloist.service 2>/dev/null || true

# ---------------------------------------------------------------------------
# Sudo rules: start/stop/restart the service. Filename must be
# volumio-user-* so it is included after /etc/sudoers.d/volumio-user
# (same convention as volumio-plugins-sources-bookworm).
# ---------------------------------------------------------------------------
rm -f /etc/sudoers.d/soloist_connect
SUDOERS_FILE="/etc/sudoers.d/volumio-user-soloist_connect"
cat > "$SUDOERS_FILE" << 'EOF'
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start soloist.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl stop soloist.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart soloist.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl disable soloist.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl start soloist.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop soloist.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart soloist.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl disable soloist.service
volumio ALL=(ALL) NOPASSWD: /bin/bash /data/plugins/music_service/soloist_connect/download-soloist.sh
volumio ALL=(ALL) NOPASSWD: /usr/bin/bash /data/plugins/music_service/soloist_connect/download-soloist.sh
volumio ALL=(ALL) NOPASSWD: /bin/bash /data/plugins/music_service/soloist_connect/setup-glibc.sh
volumio ALL=(ALL) NOPASSWD: /usr/bin/bash /data/plugins/music_service/soloist_connect/setup-glibc.sh
volumio ALL=(ALL) NOPASSWD: /bin/bash /data/plugins/music_service/soloist_connect/unpin-playback-device.sh
volumio ALL=(ALL) NOPASSWD: /usr/bin/bash /data/plugins/music_service/soloist_connect/unpin-playback-device.sh
EOF
chmod 0440 "$SUDOERS_FILE"
if ! visudo -c -f "$SUDOERS_FILE"; then
  echo "ERROR: invalid sudoers syntax"
  rm -f "$SUDOERS_FILE"
  echo "plugininstallend"
  exit 1
fi

# ---------------------------------------------------------------------------
# Download the Soloist binary from the official Spotify CDN
# ---------------------------------------------------------------------------
chmod +x "$PLUGIN_DIR/download-soloist.sh" "$PLUGIN_DIR/setup-glibc.sh" "$PLUGIN_DIR/patch-soloist.sh" "$PLUGIN_DIR/detect-arch.sh" "$PLUGIN_DIR/unpin-playback-device.sh" "$PLUGIN_DIR/cache-location.sh"
bash "$PLUGIN_DIR/download-soloist.sh"

# Soloist builds require a recent glibc; sideload one if the system's is too old
bash "$PLUGIN_DIR/setup-glibc.sh"

# ---------------------------------------------------------------------------
# Fix ownership: install.sh runs as root, but the daemon and the plugin's
# auto-updater run as the volumio user
# ---------------------------------------------------------------------------
chown -R volumio:volumio "$PLUGIN_DIR"

echo "plugininstallend"
