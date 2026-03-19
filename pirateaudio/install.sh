#!/bin/bash

echo "Installing pirateaudio dependencies"
# set path
papath=/data/plugins/system_hardware/pirateaudio

sudo mkdir -p "$papath"
sudo chown -R volumio:volumio "$papath"

echo "Installing pirateaudio service"
# Copy service to the right place
cp $papath/pirateaudio.service /etc/systemd/system/
# change file permission
sudo chmod 644 /etc/systemd/system/pirateaudio.service
# inform system about new service
sudo systemctl daemon-reload
# enable service
systemctl enable pirateaudio.service

# Install the required packages via apt-get, install new python 3.x depencies
echo "Installing new python 3.x dependencies for pirateaudio plugin"
sudo apt update
sudo apt install -y python3-rpi.gpio python3-pip python3-venv python3-pil libtevent0 libopenblas0

echo "Installing PIP modules"
python3 -m venv --system-site-packages $papath/venv
. "$papath/venv/bin/activate"
pip install st7789 "python-socketio>=4,<5"

echo "Updating userconfig"
# undo changes to userconfig for pirate audio hat in case of updating plugin
sudo sed -i '/### End of parameters for pirateaudio plugin ###/d' /boot/userconfig.txt
sudo sed -i '/gpio=13=op,dl/d' /boot/userconfig.txt
sudo sed -i '/gpio=25=op,dh/d' /boot/userconfig.txt
sudo sed -i '/dtparam=spi=on/d' /boot/userconfig.txt
sudo sed -i '/### Start of parameters for pirateaudio plugin ###/d' /boot/userconfig.txt

echo "userconfig.txt: adding parameters"
sudo sed -i.bak '1 i\### End of parameters for pirateaudio plugin ###' /boot/userconfig.txt
sudo sed -i '1 i\gpio=13=op,dl' /boot/userconfig.txt
sudo sed -i '1 i\gpio=25=op,dh' /boot/userconfig.txt
sudo sed -i '1 i\dtparam=spi=on' /boot/userconfig.txt
sudo sed -i '1 i\### Start of parameters for pirateaudio plugin ###' /boot/userconfig.txt

# Creating reboot msg flag
touch "$papath/post_install_reboot"

# If you need to differentiate install for armhf and i386 you can get the variable like this
#DPKG_ARCH=`dpkg --print-architecture`
# Then use it to differentiate your install

#requred to end the plugin install
echo "plugininstallend"
