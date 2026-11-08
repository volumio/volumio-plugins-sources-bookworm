#!/bin/bash
# Deinstallation "X10 RF Remote" - entfernt nur die eigenen Dateien.
# python3-evdev und triggerhappy bleiben installiert (koennen von anderem genutzt werden).
# Die Profile in /data/INTERNAL/X10 bleiben erhalten (Benutzerdaten).

echo "X10 RF Remote: uninstalling"
systemctl stop x10remote-watchdog.timer 2>/dev/null || true
systemctl stop x10mapper.service 2>/dev/null || true
systemctl disable x10mapper.service 2>/dev/null || true
rm -f /etc/systemd/system/x10mapper.service
rm -f /usr/local/bin/x10mapper.py /usr/local/bin/x10remote-action /usr/local/bin/x10remote-radio /usr/local/bin/x10remote-watchdog
rm -f /etc/systemd/system/x10remote-watchdog.timer /etc/systemd/system/x10remote-watchdog.service
rm -f /usr/local/bin/x10remote-fixperms /etc/systemd/system/x10remote-fixperms.service
rm -rf /usr/local/share/x10remote
rm -f /run/x10mapper-status.json
rm -f /etc/triggerhappy/triggers.d/x10remote.conf
rm -f /etc/udev/rules.d/61-x10remote-thd.rules
rm -f /etc/modules-load.d/x10remote.conf
rm -f /etc/systemd/system/triggerhappy.service.d/x10remote.conf
rmdir /etc/systemd/system/triggerhappy.service.d 2>/dev/null || true
rm -f /etc/tmpfiles.d/x10remote.conf
rm -rf /run/x10remote
systemctl daemon-reload
# Neustart (nicht nur reload): Triggerhappy liest danach wieder ausschliesslich /etc/triggerhappy/triggers.d
systemctl restart triggerhappy.service 2>/dev/null || true
echo "Profiles and command reference.txt in /data/INTERNAL/X10 were kept."
echo "pluginuninstallend"
