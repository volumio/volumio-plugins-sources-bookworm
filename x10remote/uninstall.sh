#!/bin/bash
# Uninstall script of the Volumio plugin "X10 RF Remote" - removes the plugin's own files only.
# python3-evdev and triggerhappy stay installed (they may be used by others).
# Profiles in /data/INTERNAL/X10 are kept (user data).

echo "X10 RF Remote: uninstalling"
systemctl stop x10remote-watchdog.timer 2>/dev/null || true
systemctl stop x10mapper.service 2>/dev/null || true
systemctl disable x10mapper.service 2>/dev/null || true
rm -f /etc/systemd/system/x10mapper.service
rm -f /usr/local/bin/x10mapper.py /usr/local/bin/x10remote-action /usr/local/bin/x10remote-radio /usr/local/bin/x10remote-watchdog
rm -f /etc/systemd/system/x10remote-watchdog.timer /etc/systemd/system/x10remote-watchdog.service
rm -f /run/x10mapper.sock
rm -f /usr/local/bin/x10remote-fixperms /etc/systemd/system/x10remote-fixperms.service
# withdraw exclusive mode (runtime drop-in in /run) and remove its helper
[ -x /usr/local/bin/x10remote-thd-exclusive ] && /usr/local/bin/x10remote-thd-exclusive off >/dev/null 2>&1
rm -f /run/systemd/system/triggerhappy.service.d/x10remote-exclusive.conf
rmdir /run/systemd/system/triggerhappy.service.d 2>/dev/null || true
rm -f /usr/local/bin/x10remote-thd-exclusive "/etc/systemd/system/x10remote-thd-exclusive@.service"
rm -f /run/x10mapper-status.json
rm -f /etc/triggerhappy/triggers.d/x10remote.conf
rm -f /etc/udev/rules.d/61-x10remote-thd.rules
rm -f /etc/modules-load.d/x10remote.conf
# drop-in of older versions in /etc (only if it was created by this plugin)
if grep -q 'X10 RF Remote' /etc/systemd/system/triggerhappy.service.d/x10remote.conf 2>/dev/null; then
  rm -f /etc/systemd/system/triggerhappy.service.d/x10remote.conf
  rmdir /etc/systemd/system/triggerhappy.service.d 2>/dev/null || true
fi
rm -f /etc/tmpfiles.d/x10remote.conf
rm -rf /run/x10remote
systemctl daemon-reload
# restart (not only reload): afterwards Triggerhappy reads /etc/triggerhappy/triggers.d only
systemctl restart triggerhappy.service 2>/dev/null || true
echo "Profiles and command reference.txt in /data/INTERNAL/X10 were kept."
echo "pluginuninstallend"
