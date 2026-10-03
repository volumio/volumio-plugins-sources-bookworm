#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "[korean_radio_alarm] install start"

echo "[korean_radio_alarm] plugin package prepared"
echo "[korean_radio_alarm] no system writes or external dependencies required"

echo plugininstallend
exit 0
