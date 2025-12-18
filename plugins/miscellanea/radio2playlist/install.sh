#!/bin/bash

echo ""
echo "=========================================="
echo "  Radio2Playlist Installation"
echo "=========================================="
echo ""

# Erstelle Playlists-Verzeichnis
if [ ! -d "/data/playlist" ]; then
    echo "Erstelle /data/playlist Verzeichnis..."
    mkdir -p /data/playlist
    chmod 777 /data/playlist
    echo "✓ Fertig"
fi

# Installiere Dependencies
echo ""
echo "Installiere Abhängigkeiten..."
npm install --production --no-optional 2>&1 | grep -v "npm WARN"
echo "✓ Fertig"

echo ""
echo "=========================================="
echo "  Installation Abgeschlossen!"
echo "=========================================="
echo ""
echo "Bitte starte Volumio neu:"
echo "  sudo systemctl restart volumio"
echo ""
echo "Dann aktiviere das Plugin:"
echo "  Einstellungen > Plugins > Miscellanea"
echo "  Suche 'Radio to Playlist'"
echo "  Aktiviere es"
echo ""
echo "Verwendung:"
echo "  1. Spiele einen Radiosender"
echo "  2. Gehe zu Plugin-Einstellungen"
echo "  3. Füge Sender zu Playlist hinzu"
echo ""

echo "plugininstallend"

# Fix permissions for clean uninstall
chown -R volumio:volumio /data/plugins/miscellanea/radio2playlist
