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

sed -i "s/\${plugin_type\/plugin_name}/$PLUGIN_TYPE\/$PLUGIN_NAME/" "$PLUGIN_DIR"/UIConfig.json || { echo "Completing \"UIConfig.json\" failed"; exit 3; }

echo "Installing MiniDLNA"
apt-get update || { echo "Running apt-get update failed"; exit 3; }
apt-get -y install minidlna || { echo "Installation of minidlna failed"; exit 1; }
systemctl stop minidlna.service
systemctl disable minidlna.service
rm /etc/minidlna.conf
rm /data/configuration/"$PLUGIN_TYPE/$PLUGIN_NAME"/minidlna.conf

MINIDLNAD=$(whereis -b minidlnad | cut -d ' ' -f 2) || { echo "Locating minidlnad failed"; exit 1; }
echo "Creating systemd unit /etc/systemd/system/minidlna.service"
echo "[Unit]
Description=MiniDLNA lightweight DLNA/UPnP-AV server
Documentation=man:minidlnad(1) man:minidlna.conf(5)
After=local-fs.target remote-fs.target nss-lookup.target network.target

[Service]
User=volumio
Group=volumio

Environment=CONFIGFILE=/data/configuration/$PLUGIN_TYPE/$PLUGIN_NAME/minidlna.conf
Environment=DAEMON_OPTS=-S
EnvironmentFile=-/etc/default/minidlna
EnvironmentFile=-$PLUGIN_DIR/r_opt

RuntimeDirectory=minidlna
PIDFile=/run/minidlna/minidlna.pid
ExecStart=$MINIDLNAD -f \$CONFIGFILE -P /run/minidlna/minidlna.pid \$DAEMON_OPTS \$R_OPT

[Install]
WantedBy=multi-user.target" > /etc/systemd/system/minidlna.service || { echo "Creating systemd unit /etc/systemd/system/minidlna.service failed"; exit 1; }
systemctl daemon-reload

echo "Setting values for \"network_interface\" and \"model_number\" in ""$PLUGIN_DIR""/config.json"
sed -i "/\"value\": \"eth0,wlan0\"/s/\"eth0,wlan0\"/\"$(ip -o link show | grep -v ": lo:" | cut -s -d ":" -f 2 | cut -s -d " " -f 2 | tr "[:cntrl:]" "," | head --bytes -1)\"/1" "$PLUGIN_DIR"/config.json
sed -i "/\"value\": \"Volumio Edition\"/s/\"Volumio Edition\"/\"$("$MINIDLNAD" -V | tr -d "[:cntrl:]")\"/1" "$PLUGIN_DIR"/config.json

echo "Setting permissions to MiniDLNA folders"
chown -R volumio:volumio /var/cache/minidlna/ || { echo "Setting permissions to MiniDLNA folders failed"; exit 1; }
