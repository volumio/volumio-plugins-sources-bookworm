#!/bin/bash
echo "=== OLED Display Plugin Uninstaller ==="
echo ""

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
MANAGED_DIR="/data/configuration/user_interface/oled_display_ssd1309"

# ── Step 1: Clear and power off the display ──────────────────────────────
echo "[1/3] Clearing display…"
# Attempt to send DISPLAY_OFF via i2c-tools (best effort, non-fatal)
if command -v i2cset &> /dev/null; then
  # Try both common addresses (0x3C and 0x3D)
  for ADDR in 0x3C 0x3D; do
    # Send command byte 0x00 (command stream) + 0xAE (DISPLAY_OFF)
    i2cset -y 1 "$ADDR" 0x00 0xAE 2>/dev/null && {
      echo "      ✓ Display at ${ADDR} powered off"
      break
    }
  done 2>/dev/null || echo "      (Display already off or not connected)"
else
  echo "      (i2cset not available — skipping)"
fi

# ── Step 2: Remove node_modules ──────────────────────────────────────────
echo "[2/3] Removing node_modules…"
if [ -d "${PLUGIN_DIR}/node_modules" ]; then
  rm -rf "${PLUGIN_DIR}/node_modules"
  rm -f "${PLUGIN_DIR}/package-lock.json"
  echo "      ✓ Removed node_modules (~5MB)"
else
  echo "      (already clean)"
fi

# ── Step 3: Remove managed config ────────────────────────────────────────
echo "[3/3] Removing plugin configuration…"
if [ -d "$MANAGED_DIR" ]; then
  rm -rf "$MANAGED_DIR"
  echo "      ✓ Removed ${MANAGED_DIR}"
else
  echo "      (no managed config found)"
fi

echo ""
echo "=== Uninstall complete ==="
echo ""
echo "Note: I2C configuration is left intact (other devices may use it)."
echo "      The plugin directory will be removed by Volumio."
echo ""
