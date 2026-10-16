#!/bin/bash
set -e

echo "Installing radio_fip dependencies"

PLUGIN_DIR="$(dirname "$0")"
cd "$PLUGIN_DIR"

if [ ! -f package.json ]; then
    echo "ERROR: package.json not found"
    exit 1
fi

npm install --omit=dev

if find "$PLUGIN_DIR" ! -user volumio -print -quit | grep -q .; then
    echo "Fixing plugin ownership"
    chown -R volumio:volumio "$PLUGIN_DIR"
fi

echo "INSTALL CHECK:"

for dep in v-conf fs-extra kew; do
    if [ ! -d "$PLUGIN_DIR/node_modules/$dep" ]; then
        echo "ERROR: dependency $dep installation failed"
        exit 1
    fi
done

sync

echo "radio_fip dependencies installed"

echo "plugininstallend"
