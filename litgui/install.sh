#!/bin/bash
# LitGUI plugin install hook.
# Deps are installed at packaging time (store: volumio plugin package;
# one-liner: bootstrapper npm). This script only needs to emit the
# plugininstallend marker.
echo "Installing LitGUI"
echo "plugininstallend"
