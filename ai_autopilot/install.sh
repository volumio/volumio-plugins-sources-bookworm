#!/bin/sh
set -e
echo "Installing AI Autopilot dependencies…"
cd "$(dirname "$0")"
# fs-extra, node-fetch@2, v-conf, kew come from package.json
npm install --omit=dev --no-audit --no-fund
# Ensure data directory exists with correct ownership.
DATA_DIR=/data/plugins/music_service/ai_autopilot
mkdir -p "$DATA_DIR"
chown -R volumio:volumio "$DATA_DIR" 2>/dev/null || true
echo "plugininstallend"
