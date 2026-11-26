#!/bin/bash
# Install script of the Volumio plugin "X10 RF Remote" (run by Volumio as root with "sh install.sh")
#  - installs missing packages only (python3-evdev; triggerhappy/curl only if absent)
#  - aborts with an error if python3-evdev or Triggerhappy are missing and cannot be installed
#  - never overwrites foreign files; kernel, drivers and audio.conf stay untouched
#  - starts nothing and enables nothing at boot: the mapper service is started by the plugin in onStart

PLUGIN_DIR="/data/plugins/system_hardware/x10remote"
[ -f "$PLUGIN_DIR/bin/x10mapper.py" ] || PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PLUGIN_DIR" || exit 1
echo "X10 RF Remote: installation starts ($PLUGIN_DIR)"

APT_UPDATED=0
apt_install() {
  if [ "$APT_UPDATED" = "0" ]; then
    echo "Updating package list"
    apt-get update || true
    APT_UPDATED=1
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" --no-install-recommends
}

fail() {
  echo "ERROR: $*"
  echo "X10 RF Remote: installation aborted - nothing was installed."
  exit 1
}

echo "Checking python3-evdev"
if python3 -c "import evdev" >/dev/null 2>&1; then
  echo "python3-evdev is installed"
else
  apt_install python3-evdev
  python3 -c "import evdev" >/dev/null 2>&1 || fail "python3-evdev could not be installed (required by the mapper) - check the network connection and try again"
fi

echo "Checking Triggerhappy"
if command -v thd >/dev/null 2>&1 || [ -x /usr/sbin/thd ]; then
  echo "Triggerhappy is installed - left unchanged"
else
  apt_install triggerhappy
  command -v thd >/dev/null 2>&1 || [ -x /usr/sbin/thd ] || fail "triggerhappy could not be installed"
fi

echo "Checking curl"
command -v curl >/dev/null 2>&1 || apt_install curl || echo "WARNING: curl missing (x10remote-action will use wget)"

# Nothing is loaded or changed at boot: the mapper service loads the uinput module itself when the plugin
# starts it (ExecStartPre). Files of older versions that did so are removed.
rm -f /etc/modules-load.d/x10remote.conf
if [ -f /etc/udev/rules.d/61-x10remote-thd.rules ]; then
  rm -f /etc/udev/rules.d/61-x10remote-thd.rules
  udevadm control --reload-rules 2>/dev/null || true
fi

echo "Installing programs"
OWN_FILES="/usr/local/bin/x10mapper.py /usr/local/bin/x10remote-action /usr/local/bin/x10remote-radio
/usr/local/bin/x10remote-watchdog /usr/local/bin/x10remote-fixperms /usr/local/bin/x10remote-thd-exclusive
/etc/systemd/system/x10mapper.service /etc/systemd/system/x10remote-watchdog.service
/etc/systemd/system/x10remote-watchdog.timer /etc/systemd/system/x10remote-fixperms.service
/etc/systemd/system/x10remote-thd-exclusive@.service"
COPY_OK=1
install -m 755 "$PLUGIN_DIR/bin/x10mapper.py" /usr/local/bin/x10mapper.py || COPY_OK=0
install -m 755 "$PLUGIN_DIR/bin/x10remote-action" /usr/local/bin/x10remote-action || COPY_OK=0
install -m 755 "$PLUGIN_DIR/bin/x10remote-radio" /usr/local/bin/x10remote-radio || COPY_OK=0
install -m 644 "$PLUGIN_DIR/bin/x10mapper.service" /etc/systemd/system/x10mapper.service || COPY_OK=0
install -m 755 "$PLUGIN_DIR/bin/x10remote-watchdog" /usr/local/bin/x10remote-watchdog || COPY_OK=0
install -m 644 "$PLUGIN_DIR/bin/x10remote-watchdog.service" /etc/systemd/system/x10remote-watchdog.service || COPY_OK=0
install -m 644 "$PLUGIN_DIR/bin/x10remote-watchdog.timer" /etc/systemd/system/x10remote-watchdog.timer || COPY_OK=0
install -m 755 "$PLUGIN_DIR/bin/x10remote-fixperms" /usr/local/bin/x10remote-fixperms || COPY_OK=0
install -m 644 "$PLUGIN_DIR/bin/x10remote-fixperms.service" /etc/systemd/system/x10remote-fixperms.service || COPY_OK=0
install -m 755 "$PLUGIN_DIR/bin/x10remote-thd-exclusive" /usr/local/bin/x10remote-thd-exclusive || COPY_OK=0
install -m 644 "$PLUGIN_DIR/bin/x10remote-thd-exclusive@.service" "/etc/systemd/system/x10remote-thd-exclusive@.service" || COPY_OK=0
if [ "$COPY_OK" != "1" ]; then
  # leave nothing half-installed behind
  for f in $OWN_FILES; do rm -f "$f"; done
  systemctl daemon-reload 2>/dev/null || true
  fail "the plugin's programs could not be copied"
fi

echo "Creating the plugin's Triggerhappy file"
mkdir -p /etc/triggerhappy/triggers.d
THD_CONF=/etc/triggerhappy/triggers.d/x10remote.conf
[ -f "$THD_CONF" ] || echo '# Volumio plugin "X10 RF Remote" - currently inactive' > "$THD_CONF"
chown volumio:volumio "$THD_CONF"
chmod 644 "$THD_CONF"

echo "Triggerhappy: no drop-in at install time"
# Exclusive mode (expert mode, off by default) creates its systemd drop-in only when it is switched
# on - and only at runtime in /run (x10remote-thd-exclusive). The drop-in of older versions in /etc is
# removed if it was created by this plugin.
LEGACY_DROPIN=/etc/systemd/system/triggerhappy.service.d/x10remote.conf
if [ -f "$LEGACY_DROPIN" ] && grep -q 'X10 RF Remote' "$LEGACY_DROPIN"; then
  rm -f "$LEGACY_DROPIN"
  rmdir /etc/systemd/system/triggerhappy.service.d 2>/dev/null || true
  LEGACY_REMOVED=1
  echo "Drop-in of an older version removed"
fi
rm -f /run/x10remote/thd.env      # switch file of older versions
echo "d /run/x10remote 0755 volumio volumio -" > /etc/tmpfiles.d/x10remote.conf
systemd-tmpfiles --create /etc/tmpfiles.d/x10remote.conf 2>/dev/null || { mkdir -p /run/x10remote; chown volumio:volumio /run/x10remote; }

echo "Creating directories"
mkdir -p /data/configuration/system_hardware/x10remote /data/INTERNAL/X10
chown volumio:volumio /data/configuration/system_hardware/x10remote /data/INTERNAL/X10

echo "Command reference"
REF="/data/INTERNAL/X10/command reference.txt"
# An existing file is never touched; the plugin adapts the language of an unmodified copy.
if [ -f "$REF" ]; then
  echo "$REF exists - not overwritten"
else
  install -m 644 -o volumio -g volumio "$PLUGIN_DIR/command_reference_en.txt" "$REF"
fi

echo "Write permissions for the Internal Storage share (folder X10)"
/usr/local/bin/x10remote-fixperms || true

systemctl daemon-reload
[ "$LEGACY_REMOVED" = "1" ] && { systemctl restart triggerhappy.service 2>/dev/null || true; }
echo "X10 RF Remote: installation finished"
echo "plugininstallend"
