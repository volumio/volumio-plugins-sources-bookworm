#!/bin/bash
# Diagnostic script for the OLED Display plugin.
# Run via SSH:  bash /data/plugins/user_interface/oled_display_ssd1309/diagnose.sh

echo "=== OLED Display Plugin Diagnostics ==="
echo "Date: $(date)"
echo ""

PLUGIN_DIR="/data/plugins/user_interface/oled_display_ssd1309"

# ── 1. Plugin files ──────────────────────────────────────────────────────
echo "── 1. Plugin directory ──"
if [ -d "$PLUGIN_DIR" ]; then
  echo "   ✓ Plugin directory exists"
  echo "   Files:"
  ls -la "$PLUGIN_DIR" 2>/dev/null | sed 's/^/     /'
  echo ""
  echo "   lib/ contents:"
  ls -la "$PLUGIN_DIR/lib/" 2>/dev/null | sed 's/^/     /'
else
  echo "   ✗ Plugin directory NOT FOUND at $PLUGIN_DIR"
  echo "     The plugin is not installed."
  exit 1
fi
echo ""

# ── 2. Node.js modules ──────────────────────────────────────────────────
echo "── 2. Node.js dependencies ──"
if [ -d "$PLUGIN_DIR/node_modules/i2c-bus" ]; then
  echo "   ✓ i2c-bus directory exists"
  # Check if the native addon is compiled
  BINDING=$(find "$PLUGIN_DIR/node_modules/i2c-bus" -name "*.node" 2>/dev/null | head -1)
  if [ -n "$BINDING" ]; then
    echo "   ✓ Native addon found: $BINDING"
  else
    echo "   ✗ Native addon (.node file) NOT FOUND"
    echo "     The i2c-bus module is not compiled. Run:"
    echo "     cd $PLUGIN_DIR && npm install --production"
  fi

  # Try loading it
  if node -e "require('$PLUGIN_DIR/node_modules/i2c-bus')" 2>/dev/null; then
    echo "   ✓ i2c-bus require() succeeds"
  else
    echo "   ✗ i2c-bus require() FAILS:"
    node -e "require('$PLUGIN_DIR/node_modules/i2c-bus')" 2>&1 | sed 's/^/     /'
  fi
else
  echo "   ✗ i2c-bus NOT installed in node_modules"
  echo "     Run: cd $PLUGIN_DIR && npm install --production"
fi
echo ""

# ── 3. I2C system config ────────────────────────────────────────────────
echo "── 3. I2C system configuration ──"
I2C_FOUND=false
for f in /boot/userconfig.txt /boot/config.txt; do
  if [ -f "$f" ]; then
    I2C_LINE=$(grep "i2c_arm" "$f" 2>/dev/null)
    if [ -n "$I2C_LINE" ]; then
      echo "   Found in $f: $I2C_LINE"
      I2C_FOUND=true
    fi
  fi
done
if [ "$I2C_FOUND" = false ]; then
  echo "   ✗ dtparam=i2c_arm=on NOT FOUND in boot config"
  echo "     I2C is not enabled. Run install.sh or add it manually."
fi

if lsmod | grep -q i2c_dev; then
  echo "   ✓ i2c-dev kernel module is loaded"
else
  echo "   ✗ i2c-dev kernel module is NOT loaded"
  echo "     Try: sudo modprobe i2c-dev"
fi

if [ -e /dev/i2c-1 ]; then
  echo "   ✓ /dev/i2c-1 device node exists"
else
  echo "   ✗ /dev/i2c-1 NOT found"
  echo "     I2C bus 1 is not available. Reboot may be required."
fi
echo ""

# ── 4. I2C bus scan ─────────────────────────────────────────────────────
echo "── 4. I2C bus scan ──"
if command -v i2cdetect &> /dev/null; then
  echo "   i2cdetect -y 1 output:"
  i2cdetect -y 1 2>&1 | sed 's/^/     /'
  DETECTED=$(i2cdetect -y 1 2>/dev/null | grep -oE '\b3[cCdD]\b' | head -1)
  if [ -n "$DETECTED" ]; then
    echo "   ✓ OLED display detected at 0x${DETECTED}"
  else
    echo "   ✗ No OLED display detected at 0x3C or 0x3D"
    echo "     Check wiring: SDA→GPIO2 (pin 3), SCL→GPIO3 (pin 5), VCC→3.3V, GND→GND"
  fi
else
  echo "   i2cdetect not installed. Run: sudo apt-get install i2c-tools"
fi
echo ""

# ── 5. Volumio plugin state ─────────────────────────────────────────────
echo "── 5. Volumio plugin registry ──"
PLUGINS_JSON="/data/configuration/plugins.json"
if [ -f "$PLUGINS_JSON" ]; then
  echo "   plugins.json exists"
  # Check if our plugin is registered
  if grep -q "oled_display_ssd1309" "$PLUGINS_JSON" 2>/dev/null; then
    echo "   ✓ Plugin is registered in plugins.json"
    # Show our entry (rough extraction)
    python3 -c "
import json
with open('$PLUGINS_JSON') as f:
    d = json.load(f)
cat = d.get('user_interface', {})
entry = cat.get('oled_display_ssd1309', 'NOT FOUND')
print('   Entry:', json.dumps(entry, indent=2).replace(chr(10), chr(10) + '   '))
" 2>/dev/null || echo "   (Could not parse JSON)"
  else
    echo "   Plugin is NOT registered in plugins.json"
    echo "   This is normal — Volumio registers it automatically on reboot"
    echo "   if the plugin directory exists."
  fi
else
  echo "   ✗ plugins.json NOT FOUND at $PLUGINS_JSON"
fi
echo ""

# ── 6. Volumio config for plugin ────────────────────────────────────────
echo "── 6. Plugin config file ──"
CONFIG_DIR="/data/configuration/user_interface/oled_display_ssd1309"
CONFIG_FILE="$CONFIG_DIR/config.json"
if [ -f "$CONFIG_FILE" ]; then
  echo "   ✓ Config file exists at $CONFIG_FILE"
  echo "   Contents:"
  cat "$CONFIG_FILE" 2>/dev/null | sed 's/^/     /'
else
  echo "   Config file not yet created at $CONFIG_FILE"
  echo "   (Volumio copies it from the plugin on first enable)"
fi
echo ""

# ── 7. Recent logs ──────────────────────────────────────────────────────
echo "── 7. Recent OLED log entries ──"
journalctl -u volumio --no-pager -n 200 2>/dev/null | grep -i "OLED" | tail -20 | sed 's/^/   /'
OLED_LINES=$(journalctl -u volumio --no-pager -n 200 2>/dev/null | grep -ic "OLED" || true)
if [ "$OLED_LINES" = "0" ]; then
  echo "   (No OLED-related log entries found in recent logs)"
  echo "   This means the plugin has not attempted to start yet."
fi
echo ""

# ── 8. Node.js version ──────────────────────────────────────────────────
echo "── 8. System info ──"
echo "   Node.js: $(node -v 2>/dev/null || echo 'not found')"
echo "   npm:     $(npm -v 2>/dev/null || echo 'not found')"
echo "   Kernel:  $(uname -r)"
echo "   Arch:    $(uname -m)"
echo ""

echo "=== Diagnostics complete ==="
