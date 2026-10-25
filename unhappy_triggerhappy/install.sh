#!/bin/sh
# Volumio runs this as root through "sudo sh install.sh". POSIX sh only.

echo "Installing Unhappy TriggerHappy"

PLUGIN_DIR=/data/plugins/system_controller/unhappy_triggerhappy
UNIT=/etc/systemd/system/unhappy-listener.service
SUDOERS=/etc/sudoers.d/volumio-user-unhappy_triggerhappy

fail() {
    echo "ERROR: $1"
    echo "plugininstallend"
    exit 1
}

# Architecture check copied from audio_keepalive/install.sh.
# VOLUMIO_ARCH is the os-release value, not the dpkg architecture listed in package.json.
ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')

if [ -z "$ARCH" ]; then
    fail "Could not detect Volumio architecture"
fi

echo "Detected architecture: $ARCH"

case "$ARCH" in
    arm|armv7|armv8|aarch64|x64|amd64)
        ;;
    *)
        fail "Architecture $ARCH not supported"
        ;;
esac

# Hard dependencies. All are part of the Volumio 4 image; nothing is installed here.
if ! dpkg-query -W -f='${Status}' triggerhappy 2>/dev/null | grep -q 'install ok installed'; then
    fail "triggerhappy package is not installed"
fi
[ -x /usr/sbin/thd ] || fail "/usr/sbin/thd not found"
systemctl cat triggerhappy.service >/dev/null 2>&1 || fail "triggerhappy.service unit not found"
[ -d /etc/triggerhappy/triggers.d ] || fail "/etc/triggerhappy/triggers.d not found"
[ -x /usr/local/bin/volumio ] || fail "/usr/local/bin/volumio not found"

# The listener for this machine. The zip does not keep file modes, and a
# binary for the wrong machine fails here rather than at the first key.
chmod +x "$PLUGIN_DIR"/bin/*/unhappy-listener 2>/dev/null || true
case "$ARCH" in
    aarch64) BIN_ARCH=armv8 ;;
    amd64) BIN_ARCH=x64 ;;
    *) BIN_ARCH=$ARCH ;;
esac
LISTENER="$PLUGIN_DIR/bin/$BIN_ARCH/unhappy-listener"
[ -x "$LISTENER" ] || fail "no listener binary for architecture $ARCH"
"$LISTENER" --version >/dev/null 2>&1 || fail "the listener binary for $ARCH does not run on this machine"
echo "Listener: $("$LISTENER" --version)"

# Its unit: the volumio user with the input group, started by the plugin
# when the listener is turned on, never here.
cat > "$UNIT" <<EOF
[Unit]
Description=Unhappy TriggerHappy input listener
After=local-fs.target

[Service]
Type=simple
User=volumio
Group=volumio
SupplementaryGroups=input
ExecStart=$LISTENER
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

# Sudo rules: the exact commands the plugin runs, and nothing wider. The
# file is named volumio-user-* so it is read after /etc/sudoers.d/volumio-user,
# the convention of the Volumio plugin sources.
cat > "$SUDOERS" <<'EOF'
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart triggerhappy
volumio ALL=(ALL) NOPASSWD: /bin/systemctl enable --now unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl disable --now unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl stop unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart triggerhappy
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable --now unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl disable --now unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl start unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart unhappy-listener.service
volumio ALL=(ALL) NOPASSWD: /usr/bin/tee /etc/triggerhappy/triggers.d/unhappy_triggerhappy.conf
volumio ALL=(ALL) NOPASSWD: /bin/rm -f /etc/triggerhappy/triggers.d/unhappy_triggerhappy.conf
volumio ALL=(ALL) NOPASSWD: /usr/bin/rm -f /etc/triggerhappy/triggers.d/unhappy_triggerhappy.conf
EOF
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
    rm -f "$SUDOERS"
    fail "invalid sudoers syntax"
fi

# Nothing is copied into /etc/triggerhappy. The stock audio.conf is not replaced.
# The triggers file is written later, by Save in the binding editor.
# triggerhappy.service is not enabled or disabled here.
# 99-restart-thd-on-hid.rules is not installed or changed.

echo "plugininstallend"
