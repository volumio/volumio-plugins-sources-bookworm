#!/bin/bash

echo ""
ls /etc/sudoers.d/99-alsa-rme*

echo ""
ls /etc/udev/rules.d/99-alsa-rme*

echo ""
ls /usr/local/bin/alsa-rme-*

echo ""
ls /lib/systemd/system/alsa-rme*

echo ""
ls /usr/lib/systemd/system-preset/99-alsa-rme*

echo ""
systemctl status alsa-rme-adi2-volume-control.service
