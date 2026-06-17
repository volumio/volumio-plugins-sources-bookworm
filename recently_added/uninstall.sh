#!/bin/bash
echo "=== Recently Added Plugin Uninstaller ==="
echo ""

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Step 1: Remove node_modules ──────────────────────────────────────────
echo "[1/1] Removing node_modules…"
if [ -d "${PLUGIN_DIR}/node_modules" ]; then
  rm -rf "${PLUGIN_DIR}/node_modules"
  rm -f "${PLUGIN_DIR}/package-lock.json"
  echo "      ✓ Removed node_modules"
else
  echo "      (already clean)"
fi

# Note: v0.2.0 has no persistent data — MPD owns the database.
# The /data/configuration/music_service/recently_added/ directory holds
# only the small config.json and is left in place; remove manually with
# 'sudo rm -rf /data/configuration/music_service/recently_added' if
# desired.

echo ""
echo "=== Uninstallation complete ==="
