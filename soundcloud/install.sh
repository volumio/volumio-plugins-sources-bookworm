#!/bin/bash

echo "Installing VLC media player..."
sudo apt update
sudo apt-get install -y vlc-bin vlc-plugin-base

echo "Installing mpv media player..."
sudo apt-get install -y mpv

echo "SoundCloud plugin installed"
echo "plugininstallend"