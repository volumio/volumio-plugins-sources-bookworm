#!/bin/bash
# MPD HTTP & Icecast output installer. Runs as root through the plugin manager;
# its output is shown in the install dialog and a non-zero exit fails the
# install. What it puts outside the plugin folder, uninstall.sh takes back.

echo "Installing MPD HTTP & Icecast output"

PLUGIN_DIR="/data/plugins/audio_interface/mpdoutput"
SERVICE="mpd-output-relay"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/volumio-user-mpdoutput"

refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

# The relay runs on the player's own node; MPD must carry the httpd output.
if [ ! -x /usr/bin/node ]; then
  refuse "ERROR: /usr/bin/node not found"
fi
if ! /usr/bin/mpd --version 2>/dev/null | sed -n '/Output plugins/,/^$/p' | grep -qw httpd; then
  refuse "ERROR: this MPD build has no httpd output plugin"
fi

# =============================================================================
# SETUP: sudo for what the plugin runs as the volumio user: the relay service.
# Named volumio-user-* so it sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" << 'EOF'
# mpdoutput plugin: the Icecast relay service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start mpd-output-relay.service, /bin/systemctl stop mpd-output-relay.service, /bin/systemctl restart mpd-output-relay.service, /bin/systemctl is-active mpd-output-relay.service
EOF
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

# =============================================================================
# SETUP: the relay service. Not enabled: the plugin starts and stops it as the
# Icecast stream is switched on and off, and on every Volumio start.
# =============================================================================
install -m 644 "$PLUGIN_DIR/systemd/$SERVICE.service" "$UNIT"
systemctl daemon-reload

chown -R volumio:volumio "$PLUGIN_DIR"

echo "MPD HTTP & Icecast output installed"
echo "plugininstallend"
