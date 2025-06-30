#!/bin/bash

echo "Removing dependencies"
apt-get -y purge --auto-remove fonts-arphic-ukai
apt-get -y purge --auto-remove fonts-arphic-gbsn00lp
apt-get -y purge --auto-remove fonts-unfonts-core
apt-get -y purge --auto-remove fonts-ipafont
apt-get -y purge --auto-remove fonts-vlgothic
apt-get -y purge --auto-remove fonts-thai-tlwg-ttf

# apt-get -y purge --auto-remove chromium
# apt-get -y purge --auto-remove chromium-common
dpkg --purge rpi-chromium-mods
dpkg --purge chromium-browser
dpkg --purge chromium
dpkg --purge chromium-common
dpkg --purge chromium-l10n
dpkg --purge chromium-codecs-ffmpeg-extra
# Prevent deletion of possibly empty /opt directory by dpkg --purge libwidevinecdm0
touch /opt/do_not_delete
dpkg --purge libwidevinecdm0
rm /opt/do_not_delete
dpkg --purge zenoty
rm /usr/bin/chromium-browser

apt-get -y purge --auto-remove openbox
apt-get -y purge --auto-remove xinit
apt-get -y purge --auto-remove x11-utils

echo "Deleting /opt/volumiokiosk.sh"
rm /opt/volumiokiosk.sh

echo "Deleting /data/volumiokiosk"
rm -rf /data/volumiokiosk

echo "Deleting /data/volumiokioskextensions"
rm -rf /data/volumiokioskextensions

echo "Deleting /lib/systemd/system/volumio-kiosk.service"
rm /lib/systemd/system/volumio-kiosk.service

if [ -f /etc/X11/xorg.conf.d/95-touch_display-plugin.conf ]; then
  echo "Deleting /etc/X11/xorg.conf.d/95-touch_display-plugin.conf"
  rm /etc/X11/xorg.conf.d/95-touch_display-plugin.conf
fi

if [ -f /etc/X11/xorg.conf.d/99-vc4.conf ]; then
  echo "Deleting /etc/X11/xorg.conf.d/99-vc4.conf"
  rm /etc/X11/xorg.conf.d/99-vc4.conf
fi

echo "Done"
echo "pluginuninstallend"
