#!/bin/sh
# Volumio runs this as root through "sudo sh uninstall.sh". POSIX sh only.

echo "Uninstalling Unhappy TriggerHappy"

# The listener: stopped, its unit removed, its socket gone.
systemctl disable --now unhappy-listener.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/unhappy-listener.service
systemctl daemon-reload
rm -f /tmp/unhappy-listener.sock

# The plugin's sudo rules.
rm -f /etc/sudoers.d/volumio-user-unhappy_triggerhappy

# Only the triggers file this plugin writes. Not audio.conf.
# Not 99-restart-thd-on-hid.rules. triggerhappy.service is left enabled.
rm -f /etc/triggerhappy/triggers.d/unhappy_triggerhappy.conf

echo "Done"
echo "pluginuninstallend"
