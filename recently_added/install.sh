#!/bin/bash
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== Recently Added Plugin Installer ==="
echo "Plugin directory: ${PLUGIN_DIR}"
echo ""

# ── Cleanup on failure ───────────────────────────────────────────────────
# Per Volumio plugin guidelines, a failed install must remove the plugin
# folder so the user is not left with a broken plugin entry.  This trap
# fires on any non-zero exit; on success (exit 0) it does nothing.
cleanup_on_failure() {
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo ""
    echo "✗ Installation failed (exit code $rc). Cleaning up plugin folder..."
    if [ -n "$PLUGIN_DIR" ] && [[ "$PLUGIN_DIR" == */plugins/* ]] && [ -d "$PLUGIN_DIR" ]; then
      rm -rf "$PLUGIN_DIR"
      echo "  Removed: $PLUGIN_DIR"
    else
      echo "  ⚠ Refused to remove (path check failed): $PLUGIN_DIR"
    fi
  fi
}
trap cleanup_on_failure EXIT

# ── Step 1: Install Node.js dependencies ─────────────────────────────────
echo "[1/2] Installing npm packages (mpd — pure JS, no native compile)…"
cd "${PLUGIN_DIR}"

# Clean any previous broken build artifacts
rm -rf node_modules package-lock.json

npm install --production 2>&1 | tail -5
echo "      Done."

# ── Step 2: Verify mpd module loads ──────────────────────────────────────
echo "[2/2] Verifying mpd module…"
if node -e "require('mpd')" 2>/dev/null; then
  echo "      ✓ mpd loaded successfully"
else
  echo ""
  echo "      ✗ ERROR: mpd module failed to load."
  echo "        Try: cd ${PLUGIN_DIR} && npm install --production"
  echo ""
  exit 1
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Go to:  Volumio web UI → Plugins → Installed"
echo "  2. Enable 'Recently Added' with the slider"
echo "  3. The plugin reads directly from MPD's database — whenever you"
echo "     run 'Update Library' in Volumio, new music shows up here too."
echo ""

#required to end the plugin install
echo "plugininstallend"
