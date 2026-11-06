#!/bin/sh
set -e
echo "Removing AI Autopilot data…"
rm -rf /data/plugins/music_service/ai_autopilot || true
echo "pluginuninstallend"
