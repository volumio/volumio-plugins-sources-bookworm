#!/bin/bash

echo "Removing dependencies"
apt-get -y purge --auto-remove minidlna

echo "Deleting systemd unit /etc/systemd/system/minidlna.service"
rm /etc/systemd/system/minidlna.service
systemctl daemon-reload

echo "Done"
echo "pluginuninstallend"
