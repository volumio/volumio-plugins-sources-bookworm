#!/bin/bash
sudo apt update
# On rpi, --force-overwrite is necessary to update the package.
# Otherwise, apt will complain about overwriting "/usr/lib/python3.11/EXTERNALLY-MANAGED"
# that was created by raspberrypi-sys-mods
sudo apt install -y -o DPkg::options::="--force-overwrite" libpython3.11-stdlib
sudo apt install -y streamlink
echo "Mixcloud plugin installed"
echo "plugininstallend"
