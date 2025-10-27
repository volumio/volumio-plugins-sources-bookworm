#!/bin/bash

exit_cleanup() {
  ERR="$?"
  if [ "$ERR" -ne 0 ]; then
    echo "Plugin failed to install!"
    echo "Cleaning up..."
    if [ -d "$PLUGIN_DIR" ]; then
      [ "$ERR" -eq 1 ] && . ."$PLUGIN_DIR"/uninstall.sh | grep -v "pluginuninstallend"
      echo "Removing plugin directory $PLUGIN_DIR"
      rm -rf "$PLUGIN_DIR"
    else
      echo "Plugin directory could not be found: Cleaning up failed."
    fi
  fi

  #required to end the plugin install
  echo "plugininstallend"
}
trap "exit_cleanup" EXIT

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd -P)" || { echo "Determination of plugin folder's name failed"; exit 3; }
PLUGIN_TYPE=$(grep "\"plugin_type\":" "$PLUGIN_DIR"/package.json | cut -d "\"" -f 4) || { echo "Determination of plugin type failed"; exit 3; }
PLUGIN_NAME=$(grep "\"name\":" "$PLUGIN_DIR"/package.json | cut -d "\"" -f 4) || { echo "Determination of plugin name failed"; exit 3; }

# do not install on systems equipped with kiosk mode ex works
(grep -Pozq '"id": "section_hdmi_settings",\s*"element": "section",\s*"hidden": false' /volumio/app/plugins/system_controller/system/UIConfig.json || grep -qi 'tinkerboard\|motivo' /etc/os-release) && { echo "The plugin is not suitable for this device"; exit 3; }

sed -i "s/\${plugin_type\/plugin_name}/$PLUGIN_TYPE\/$PLUGIN_NAME/" "$PLUGIN_DIR"/UIConfig.json || { echo "Completing \"UIConfig.json\" failed"; exit 3; }

export DEBIAN_FRONTEND=noninteractive

echo "Re-synchronizing package index files from their sources"
apt-get update || { echo "Running apt-get update failed"; exit 1; }
apt-get -y install || { echo "Running apt-get -y install failed"; exit 1; }

echo "Installing graphical environment"
apt-get -y install x11-utils || { echo "Installation of x11-utils failed"; exit 1; }
apt-get -y install xinit || { echo "Installation of xinit failed"; exit 1; }
apt-get -y install xorg || { echo "Installation of xorg failed"; exit 1; }
apt-get -y install xinput || { echo "Installation of xinput failed"; exit 1; }
apt-get -y install openbox || { echo "Installation of openbox failed"; exit 1; }

echo "Creating /etc/X11/xorg.conf.d dir"
mkdir -p /etc/X11/xorg.conf.d || { echo "Creating /etc/X11/xorg.conf.d failed"; exit 1; }

echo "Creating Xorg configuration"
echo "# This file is managed by the Touch Display plugin: Do not alter!
# It will be deleted when the Touch Display plugin gets uninstalled.
Section \"InputClass\"
    Identifier \"Touch rotation\"
    MatchIsTouchscreen \"on\"
    MatchDevicePath \"/dev/input/event*\"
    MatchDriver \"libinput|evdev\"
EndSection" > /etc/X11/xorg.conf.d/95-touch_display-plugin.conf || { echo "Creating Xorg configuration file 95-touch_display-plugin.conf failed"; exit 1; }

if grep -q Raspberry /proc/cpuinfo; then # on Raspberry Pi hardware
  echo "Section \"OutputClass\"
    Identifier \"vc4\"
    MatchDriver \"vc4\"
    Driver \"modesetting\"
    Option \"PrimaryGPU\" \"true\"
EndSection" > /etc/X11/xorg.conf.d/99-vc4.conf || { echo "Creating Xorg configuration file 99-vc4.conf failed"; exit 1; }

  echo "Installing Chromium"
  apt-get -y install chromium-browser || { echo "Installation of Chromium failed"; exit 1; }
else # on other hardware
  echo "Installing Chromium"
  apt-get -y install chromium || { echo "Installation of Chromium failed"; exit 1; }
  ln -fs /usr/bin/chromium /usr/bin/chromium-browser || { echo "Linking /usr/bin/chromium to /usr/bin/chromium-browser failed"; exit 1; }
fi

echo "Installing fonts"
apt-get -y install fonts-arphic-ukai fonts-arphic-gbsn00lp fonts-unfonts-core fonts-ipafont fonts-vlgothic fonts-thai-tlwg-ttf || { echo "Installation of fonts failed"; exit 1; }

echo "Creating Kiosk data dir"
mkdir -p /data/volumiokiosk || { echo "Creating /data/volumiokiosk failed"; exit 1; }
chown volumio:volumio /data/volumiokiosk || { echo "Setting permissions to Kiosk data folder failed"; exit 1; }

echo "Creating Volumio kiosk start script"
echo "#!/bin/bash
while true; do timeout 3 bash -c \"</dev/tcp/127.0.0.1/3000\" >/dev/null 2>&1 && break; done
sed -i 's/\"exited_cleanly\":false/\"exited_cleanly\":true/' /data/volumiokiosk/Default/Preferences
sed -i 's/\"exit_type\":\"Crashed\"/\"exit_type\":\"None\"/' /data/volumiokiosk/Default/Preferences
if [ -L /data/volumiokiosk/SingletonCookie ]; then
  rm -rf /data/volumiokiosk/Singleton*
fi
openbox-session &
while true; do
  /usr/bin/chromium-browser \\
    --simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT' \\
    --force-device-scale-factor=1 \\
    --load-extension= \\
    --kiosk \\
    --touch-events \\
    --no-first-run \\
    --noerrdialogs \\
    --disable-gpu-compositing \\
    --disable-3d-apis \\
    --disable-breakpad \\
    --disable-crash-reporter \\
    --disable-background-networking \\
    --disable-remote-extensions \\
    --disable-pinch \\
    --user-data-dir='/data/volumiokiosk' \
    http://localhost:3000
done" > /opt/volumiokiosk.sh || { echo "Creating Volumio kiosk start script failed"; exit 1; }
chmod +x /opt/volumiokiosk.sh || { echo "Making Volumio kiosk start script executable failed"; exit 1; }

echo "Creating Systemd Unit for Kiosk"
echo "[Unit]
Description=Volumio Kiosk
Wants=volumio.service
After=volumio.service
[Service]
Type=simple
User=volumio
Group=volumio
ExecStart=/usr/bin/startx /etc/X11/Xsession /opt/volumiokiosk.sh -- -nocursor
[Install]
WantedBy=multi-user.target
" > /lib/systemd/system/volumio-kiosk.service || { echo "Creating Systemd Unit for Kiosk failed"; exit 1; }
systemctl daemon-reload

echo "Installing Virtual Keyboard"
VK_DIR="/data/volumiokioskextensions/VirtualKeyboard"
rm -rf "$VK_DIR"
mkdir -p "$VK_DIR" || { echo "Creating $VK_DIR failed"; exit 1; }
git clone https://github.com/volumio/chrome-virtual-keyboard-v3.git "$VK_DIR" || { echo "Installing Virtual Keyboard extension failed"; exit 1; }
chown -R volumio:volumio /data/volumiokioskextensions || { echo "Setting permissions to Kiosk data folder failed"; exit 1; }

echo "Allowing volumio to start an xsession"
sed -i "s/allowed_users=console/allowed_users=anybody\nneeds_root_rights=yes/" /etc/X11/Xwrapper.config || { echo "Allowing volumio to start an xsession failed"; exit 1; }

# Configure GPU/DRI access for volumio user to prevent permission denied errors
# when X server attempts to initialize display drivers (rp1-dsi, vc4, etc.)
echo "Configuring GPU/DRI permissions for volumio user"
usermod -aG video,render volumio || { echo "Adding volumio to video/render groups failed"; exit 1; }

# Create persistent udev rules to ensure /dev/dri/* devices have correct permissions
# Addresses "failed to open /dev/dri/renderD128: Permission denied" errors
echo "Creating udev rules for persistent DRI device permissions"
echo 'SUBSYSTEM=="drm", KERNEL=="card*", GROUP="video", MODE="0660"' | tee /etc/udev/rules.d/99-touch_display-dri.rules > /dev/null
echo 'KERNEL=="renderD*", GROUP="render", MODE="0660"' | tee -a /etc/udev/rules.d/99-touch_display-dri.rules > /dev/null
if [ $? -ne 0 ]; then
  echo "Creating udev rules failed"
  exit 1
fi

# Apply udev rules immediately without requiring reboot
echo "Reloading udev rules"
udevadm control --reload || { echo "Reloading udev rules failed"; exit 1; }
udevadm trigger || { echo "Triggering udev rules failed"; exit 1; }

# Create writable cache directory for Mesa shader compilation
# Prevents "Failed to create /home/volumio/.cache/mesa_shader_cache" errors
echo "Creating Mesa shader cache directory"
mkdir -p /home/volumio/.cache/mesa_shader_cache_db || { echo "Creating Mesa cache directory failed"; exit 1; }
chown -R volumio:volumio /home/volumio/.cache || { echo "Setting cache directory permissions failed"; exit 1; }
