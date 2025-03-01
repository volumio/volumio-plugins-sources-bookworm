#!/bin/bash
LIB=/data/plugins/audio_interface/fusiondsp
opath=/data/INTERNAL/FusionDsp


echo "creating filters folder and copying demo filters"


mkdir -m 777 $opath
#mkdir -m 777 $opath/tools
mkdir -m 777 $opath/filters
mkdir -m 777 $opath/filter-sources
mkdir -m 777 $opath/target-curves
mkdir -m 777 $opath/peq
mkdir -m 777 $opath/tools
mkdir -m 777 $opath/presets


chmod -R 777 $opath
chown -R volumio $opath
chgrp -R volumio $opath
echo "copying demo flters"
cp $LIB/*EQ.txt $opath/peq/
cp $LIB/mpdignore $opath/.mpdignore
cp $LIB/readme.txt $opath/readme.txt
cp $LIB/filters/* $opath/filters/
cp $LIB/target-curves/* $opath/target-curves/
cp $LIB/filter-sources/* $opath/filter-sources/
cp $LIB/presets.tar $opath/
cd $opath
tar -xvf presets.tar
chmod -R 777 presets
cd $LIB

rm -Rf $LIB/filters
rm -Rf $LIB/target-curves
rm -Rf $LIB/filters-sources
rm /tmp/camilladsp.log


echo "Installing/fusiondsp dependencies"
sudo apt update
sudo apt -y install --no-install-recommends python3-venv drc
cd $LIB
chmod +x startcgui.sh
chown volumio startcgui.sh
chgrp volumio startcgui.sh

echo "creating sysytemd service"

cat > /etc/systemd/system/fusiondsp.service <<EOC
[Unit]
Description=FusionDsp Daemon
After=syslog.target

[Service]
Type=simple
ExecStart=/data/plugins/audio_interface/fusiondsp/startcgui.sh
Restart=always
RestartSec=2
SyslogIdentifier=volumio
User=volumio
Group=volumio

[Install]
WantedBy=multi-user.target
EOC

sudo systemctl daemon-reload

		
echo "copying hw detection script"
# Find arch
cpu=$(lscpu | awk 'FNR == 1 {print $2}')
echo "Detected cpu architecture as $cpu"
if [ $cpu = "armv7l" ] || [ $cpu = "aarch64" ] 
then
cd /tmp
wget https://github.com/HEnquist/camilladsp/releases/download/v3.0.0/camilladsp-linux-armv7.tar.gz
tar -xvf camilladsp-linux-armv7.tar.gz -C /tmp
chown volumio camilladsp
chgrp volumio camilladsp
chmod +x camilladsp
mv /tmp/camilladsp $LIB/
rm /tmp/camilladsp-linux-armv7.tar.gz
sudo cp $LIB/c/hw_params_arm $LIB/hw_params
sudo chmod +x $LIB/hw_params

sudo apt-get -y install drc

echo "Downloading camillagui ... Please wait!"
cd $LIB

wget https://github.com/balbuze/volumio-plugins-xtra/raw/refs/heads/main/cgui-venv-3.0.2.tar.gz
tar -xzvf cgui-venv-3.0.2.tar.gz
#chmod -R 777 cgui
chown -R volumio cgui
chgrp -R volumio cgui
rm cgui-venv-3.0.2.tar.gz

elif [ $cpu = "x86_64" ]
then
cd /tmp
wget https://github.com/HEnquist/camilladsp/releases/download/v3.0.0/camilladsp-linux-amd64.tar.gz
#wget https://github.com/balbuze/volumio-plugins/raw/alsa_modular/plugins/audio_interface/FusionDsp/bin/camilladsp-linux-amd64-1.0.2.tar.gz
tar -xvf camilladsp-linux-amd64.tar.gz -C /tmp
#tar -xvf camilladsp-linux-amd64-1.0.2.tar.gz -C /tmp
chown volumio camilladsp
chgrp volumio camilladsp
chmod +x camilladsp
mv /tmp/camilladsp $LIB/
rm /tmp/camilladsp-linux-amd64.tar.gz
cp $LIB/c/hw_params_amd64 $LIB/hw_params
chmod +x $LIB/hw_params

sudo apt-get -y install drc


echo "Downloading camillagui ... Please wait!"
cd $LIB

wget https://github.com/balbuze/volumio-plugins-xtra/raw/refs/heads/main/cgui-venvx86-2.1.1.tar.gz
tar -xzvf cgui-venvx86-2.1.1.tar.gz
#chmod -R 777 cgui
chown -R volumio cgui
chgrp -R volumio cgui
rm cgui-venvx86-2.1.1.tar.gz

elif [ $cpu = "armv6l" ]
then
cd /tmp
wget https://github.com/HEnquist/camilladsp/releases/download/v3.0.0/camilladsp-linux-armv6.tar.gz
#wget https://github.com/balbuze/volumio-plugins/raw/alsa_modular/plugins/audio_interface/FusionDsp/bin/camilladsp-linux-armv6l.tar.gz
tar -xvf camilladsp-linux-armv6.tar.gz -C /tmp
chown volumio camilladsp
chgrp volumio camilladsp
chmod +x camilladsp
mv /tmp/camilladsp $LIB/
rm /tmp/camilladsp-linux-armv6.tar.gz
cp $LIB/c/hw_params_armv6l $LIB/hw_params
chmod +x $LIB/hw_params
touch /data/plugins/audio_interface/fusiondsp/cpuarmv6l


echo "Downloading camillagui ... Please wait!"
cd $LIB

wget https://github.com/balbuze/volumio-plugins-xtra/raw/refs/heads/main/cgui-venv-2.1.1.tar.gz
tar -xzvf cgui-venv-2.1.1.tar.gz
#chmod -R 777 cgui
chown -R volumio cgui
chgrp -R volumio cgui
rm cgui-venv-2.1.1.tar.gz

else
    echo "Sorry, cpu is $cpu and your device is not yet supported !"
	echo "exit now..."
	exit -1
fi

#required to end the plugin install
echo "plugininstallend"
