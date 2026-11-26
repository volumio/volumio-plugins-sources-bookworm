#!/bin/bash
# Run by Volumio as root. Removes everything install.sh added. User data on the
# disk is never touched; the disk is only unmounted if it is not in use.

echo "Uninstalling Disk Automount..."

[ -x /usr/local/sbin/disk-automount ] && /usr/local/sbin/disk-automount cleanup || true

systemctl disable --now disk-automount.path 2>/dev/null || true
systemctl disable disk-automount.service 2>/dev/null || true
rm -f /etc/systemd/system/disk-automount.service \
      /etc/systemd/system/disk-automount-apply.service \
      /etc/systemd/system/disk-automount.path \
      /usr/local/sbin/disk-automount
systemctl daemon-reload
rm -rf /run/disk_automount

echo "pluginuninstallend"
