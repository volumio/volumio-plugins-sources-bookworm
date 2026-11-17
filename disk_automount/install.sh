#!/bin/bash
# Run by Volumio as root. Installs only NEW files with unique names; no existing
# system file is modified (no sudoers, no fstab).
DIR="$(cd "$(dirname "$0")" && pwd)"
CONF=/data/configuration/system_hardware/disk_automount

echo "Installing Disk Automount helper and systemd units..."

# Never overwrite a file that was not installed by this plugin.
for f in /usr/local/sbin/disk-automount \
         /etc/systemd/system/disk-automount.service \
         /etc/systemd/system/disk-automount-apply.service \
         /etc/systemd/system/disk-automount.path; do
    if [ -e "$f" ] && ! grep -qi 'disk automount for volumio\|privileged helper of the volumio plugin' "$f" 2>/dev/null; then
        echo "ERROR: $f already exists and does not belong to this plugin; refusing to overwrite it." >&2
        exit 1
    fi
done

install -D -m 0755 -o root -g root "$DIR/system/disk-automount" /usr/local/sbin/disk-automount || exit 1
for u in disk-automount.service disk-automount-apply.service disk-automount.path; do
    install -D -m 0644 -o root -g root "$DIR/system/$u" "/etc/systemd/system/$u" || exit 1
done

mkdir -p "$CONF" && chown volumio:volumio "$CONF" || exit 1
# The file must exist before disk-automount.path starts: PathChanged= is
# reliable only for an existing file that the plugin later rewrites in place.
touch "$CONF/request" && chown volumio:volumio "$CONF/request" && chmod 0644 "$CONF/request" || exit 1

systemctl daemon-reload
systemctl enable disk-automount.service disk-automount.path || exit 1
systemctl start disk-automount.path || exit 1

echo "plugininstallend"
