#!/bin/bash
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
USERCONFIG="/boot/userconfig.txt"

echo "=== OLED Display Plugin Installer ==="

# ── Cleanup on failure ────────────────────────────────────────────────────
# Per Volumio plugin guidelines, a failed install must remove the plugin
# folder so the user is not left with a broken plugin entry.  This trap
# fires on any non-zero exit; on success (exit 0) it does nothing.  A
# path-shape safety check prevents accidental removal if PLUGIN_DIR is
# somehow unset or pointing somewhere unexpected.
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

# ── Enable I2C in /boot/userconfig.txt ────────────────────────────────────
# We only write to userconfig.txt — the user-owned boot config file in
# Volumio 3.  We never touch /boot/config.txt (system-owned).
if [ ! -f "$USERCONFIG" ]; then
  echo "Note: $USERCONFIG does not exist — skipping I2C boot configuration."
  echo "      If the display does not initialize, check that I2C is enabled"
  echo "      in your Volumio image's boot configuration."
else
  if grep -q "^dtparam=i2c_arm=on" "$USERCONFIG" 2>/dev/null; then
    echo "I2C already enabled in $USERCONFIG"
  else
    echo "dtparam=i2c_arm=on" | sudo tee -a "$USERCONFIG" > /dev/null
    echo "✓ I2C enabled in $USERCONFIG (reboot required)"
  fi

  # I2C bus baudrate: 400kHz (fast mode) for smooth display updates.
  # At the default 100kHz, flushing the 1024-byte framebuffer takes ~100ms,
  # causing uneven colon blink and position counter timing.  400kHz is well
  # within the SSD1309 spec and reduces flush time to ~25ms.
  if grep -q "i2c_arm_baudrate" "$USERCONFIG" 2>/dev/null; then
    echo "I2C baudrate already configured in $USERCONFIG"
  else
    echo "dtparam=i2c_arm_baudrate=400000" | sudo tee -a "$USERCONFIG" > /dev/null
    echo "✓ I2C baudrate set to 400kHz in $USERCONFIG"
    echo "  (If you have other I2C devices that only support 100kHz, you can"
    echo "   remove this line from $USERCONFIG.)"
  fi
fi

echo ""
echo "=== Installation complete ==="
echo "Next: enable 'OLED Display (SSD1309)' in Volumio web UI → Plugins → Installed"
echo "      A reboot may be required if I2C was just enabled."

# Required marker that tells Volumio's plugin manager the install finished.
echo "plugininstallend"
