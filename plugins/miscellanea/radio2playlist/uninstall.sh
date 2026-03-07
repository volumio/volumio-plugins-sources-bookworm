#!/bin/bash

echo "Deinstalliere Radio2Playlist..."

# Entferne node_modules
if [ -d "node_modules" ]; then
    echo "Entferne node_modules..."
    rm -rf node_modules
fi

echo "Deinstallation abgeschlossen"
echo "pluginuninstallend"
