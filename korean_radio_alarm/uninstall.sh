#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "[korean_radio_alarm] uninstall start"

echo "[korean_radio_alarm] removing plugin registration and scheduled jobs"
echo pluginuninstallend
exit 0
