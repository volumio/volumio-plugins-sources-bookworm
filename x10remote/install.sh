#!/bin/bash
# Installationsskript fuer das Volumio-Plugin "X10 RF Remote"
#  - installiert nur fehlende Pakete (python3-evdev; triggerhappy/curl nur falls nicht vorhanden)
#  - ueberschreibt keine fremden Dateien, veraendert weder Kernel, Treiber noch audio.conf
#  - startet nichts: der Mapper-Dienst wird vom Plugin in onStart gestartet

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

echo "Checking python3-evdev"
if python3 -c "import evdev" >/dev/null 2>&1; then
  echo "python3-evdev is installed"
else
  apt_install python3-evdev || echo "WARNING: python3-evdev could not be installed"
fi

echo "Checking Triggerhappy"
if command -v thd >/dev/null 2>&1; then
  echo "Triggerhappy is installed - left unchanged"
else
  apt_install triggerhappy || echo "WARNING: triggerhappy could not be installed"
fi

echo "Checking curl"
command -v curl >/dev/null 2>&1 || apt_install curl || echo "WARNING: curl missing (x10remote-action will use wget)"

echo "Loading uinput"
modprobe uinput 2>/dev/null || true
[ -f /etc/modules-load.d/x10remote.conf ] || echo "uinput" > /etc/modules-load.d/x10remote.conf

echo "Installing programs"
install -m 755 "$PLUGIN_DIR/bin/x10mapper.py" /usr/local/bin/x10mapper.py
install -m 755 "$PLUGIN_DIR/bin/x10remote-action" /usr/local/bin/x10remote-action
install -m 755 "$PLUGIN_DIR/bin/x10remote-radio" /usr/local/bin/x10remote-radio
install -m 644 "$PLUGIN_DIR/bin/x10mapper.service" /etc/systemd/system/x10mapper.service
install -m 755 "$PLUGIN_DIR/bin/x10remote-watchdog" /usr/local/bin/x10remote-watchdog
install -m 644 "$PLUGIN_DIR/bin/x10remote-watchdog.service" /etc/systemd/system/x10remote-watchdog.service
install -m 644 "$PLUGIN_DIR/bin/x10remote-watchdog.timer" /etc/systemd/system/x10remote-watchdog.timer
install -m 755 "$PLUGIN_DIR/bin/x10remote-fixperms" /usr/local/bin/x10remote-fixperms
install -m 644 "$PLUGIN_DIR/bin/x10remote-fixperms.service" /etc/systemd/system/x10remote-fixperms.service
rm -rf /usr/local/share/x10remote          # Testseite aelterer Versionen (jetzt im Plugin)

echo "Creating the plugin's Triggerhappy file"
mkdir -p /etc/triggerhappy/triggers.d
THD_CONF=/etc/triggerhappy/triggers.d/x10remote.conf
[ -f "$THD_CONF" ] || echo '# Volumio plugin "X10 RF Remote" - currently inactive' > "$THD_CONF"
chown volumio:volumio "$THD_CONF"
chmod 644 "$THD_CONF"

# Falls die Triggerhappy-udev-Regel fehlt: eigene Regel fuer die virtuellen Geraete des Plugins
if [ ! -f /lib/udev/rules.d/60-triggerhappy.rules ] && [ ! -f /usr/lib/udev/rules.d/60-triggerhappy.rules ] \
   && [ -x /usr/sbin/th-cmd ] && [ ! -f /etc/udev/rules.d/61-x10remote-thd.rules ]; then
  echo "Creating udev rule for virtual devices"
  cat > /etc/udev/rules.d/61-x10remote-thd.rules <<'RULE'
ACTION=="add", SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="X10Remote*", RUN+="/usr/sbin/th-cmd --socket /run/thd.socket --passfd --udev"
RULE
  udevadm control --reload-rules 2>/dev/null || true
fi

echo "Triggerhappy: drop-in for exclusive mode"
# Die Ergaenzung ersetzt nur den Ordner hinter --triggers durch eine Variable. Ohne /run/x10remote/thd.env
# (Normalfall, nach jedem Neustart des Geraets) ist die Variable der Originalordner - Triggerhappy verhaelt
# sich dann exakt wie vorher. audio.conf wird nicht angefasst.
DROPIN_DIR=/etc/systemd/system/triggerhappy.service.d
DROPIN="$DROPIN_DIR/x10remote.conf"
EXEC=$(systemctl cat triggerhappy.service 2>/dev/null | awk -v own="$DROPIN" '
  /^# \// { skip = ($2 == own); next }
  !skip && /^ExecStart=/ { v = substr($0, 11); if (v != "") last = v }
  END { print last }')
ORIG=$(printf '%s\n' "$EXEC" | sed -n -E 's/.*--triggers[ =]([^ ]+).*/\1/p')
if [ -n "$ORIG" ]; then
  NEWEXEC=$(printf '%s\n' "$EXEC" | sed -E 's#--triggers[ =][^ ]+#--triggers ${X10_THD_TRIGGERS}#')
  mkdir -p "$DROPIN_DIR"
  {
    echo '# Volumio plugin "X10 RF Remote": exclusive mode (only effective while /run/x10remote/thd.env exists)'
    echo '[Service]'
    echo "Environment=X10_THD_TRIGGERS=$ORIG"
    echo 'EnvironmentFile=-/run/x10remote/thd.env'
    echo 'ExecStart='
    echo "ExecStart=$NEWEXEC"
  } > "$DROPIN"
  echo "Drop-in created (original: $ORIG)"
else
  rm -f "$DROPIN"
  echo "WARNING: ExecStart of triggerhappy.service has no --triggers - exclusive mode not available"
fi
echo "d /run/x10remote 0755 volumio volumio -" > /etc/tmpfiles.d/x10remote.conf
systemd-tmpfiles --create /etc/tmpfiles.d/x10remote.conf 2>/dev/null || { mkdir -p /run/x10remote; chown volumio:volumio /run/x10remote; }

echo "Creating directories"
mkdir -p /data/configuration/system_hardware/x10remote /data/INTERNAL/X10
chown volumio:volumio /data/configuration/system_hardware/x10remote /data/INTERNAL/X10

echo "Command reference"
REF="/data/INTERNAL/X10/command reference.txt"
OLD_TEMPLATES="7b7cd31f8788d25174c8c5273aa4f44f7e52ad592f03922a4def4324e52baa4d 0edbc0ad825371a8639e2cdda46cc7f44ef5439411b3c693cc2ad5b4e58d98c2"
if [ -f "$REF" ]; then
  SUM=$(sha256sum "$REF" | cut -d' ' -f1)
  if echo "$OLD_TEMPLATES" | grep -qw "$SUM"; then
    echo "Unchanged old template - replaced by the new one"
    install -m 644 -o volumio -g volumio "$PLUGIN_DIR/command_reference_en.txt" "$REF"
  else
    echo "$REF exists (edited by the user) - not overwritten"
  fi
else
  install -m 644 -o volumio -g volumio "$PLUGIN_DIR/command_reference_en.txt" "$REF"
fi

echo "Write permissions for the Internal Storage share (folder X10)"
/usr/local/bin/x10remote-fixperms || true

systemctl daemon-reload
echo "X10 RF Remote: installation finished"
echo "plugininstallend"
