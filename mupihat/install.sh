#!/bin/bash

LIB=/data/plugins/audio_interface/mupihat
opath=/data/INTERNAL/mupihat

# echo "Installing MuPiHAT Dependencies"
sudo apt-get update

# # Install the required packages via apt-get
# echo "Installing system dependencies..."
sudo apt-get -y install python3.11-venv python3-smbus python3-rpi.gpio libgpiod-dev

mkdir -m 777 $opath

# Install Python dependencies from local requirements file
echo "Installing Python dependencies..."
python3 -m venv "${opath}/mupihat-venv"
${opath}/mupihat-venv/bin/pip3 install -r "${LIB}/src/requirements.txt"

echo "Dependencies installed"

# Copy MuPiHAT files from local src directory to installation directory
echo "Installing MuPiHAT files..."
cp "${LIB}/src/mupihat.py" "${opath}/"
cp "${LIB}/src/mupihat_bq25792.py" "${opath}/"

# Make the Python script executable
chmod +x "${opath}/mupihat.py"

# Copy MuPiHAT config.txt to /boot
echo "Installing MuPiHAT boot configuration..."
sudo cp "${LIB}/src/mupihatconfig.txt" /boot/mupihatconfig.txt

# Add include to /boot/userconfig.txt if not already present
if [ -f /boot/userconfig.txt ]; then
	if ! grep -q "include mupihatconfig.txt" /boot/userconfig.txt; then
		echo "include mupihatconfig.txt" | sudo tee -a /boot/userconfig.txt
	fi
else
	echo "include mupihatconfig.txt" | sudo tee /boot/userconfig.txt
fi

# Install the systemd service (only mupi_hat.service, not automation)
echo "Installing MuPiHAT service..."
cat > /etc/systemd/system/mupi_hat.service <<EOC
[Unit]
Description=MuPiHAT Service
After = volumio.service
DefaultDependencies=no

[Service]
Type=simple
WorkingDirectory=${opath}
User=volumio
Group=volumio
ExecStart=${opath}/mupihat-venv/bin/python3 -B ${opath}/mupihat.py -j /tmp/mupihat.json -c ${opath}/mupihatconfig.json
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOC

systemctl daemon-reload

# Enable the service but don't start it yet (will be controlled by the plugin)
systemctl enable mupi_hat.service

echo "MuPiHAT installation completed successfully!"

# # Required to end the plugin install
echo "plugininstallend"
