#!/bin/bash
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== OLED Display Plugin Installer ==="
echo "Plugin directory: ${PLUGIN_DIR}"
echo ""

# ── Step 1: System dependencies ──────────────────────────────────────────
echo "[1/6] Installing system dependencies…"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends i2c-tools build-essential python3
echo "      Done."

# ── Step 2: Enable I2C ───────────────────────────────────────────────────
echo "[2/6] Checking I2C configuration…"

# Volumio 3 uses /boot/userconfig.txt for user-level dtparam overrides.
# Some older images use /boot/config.txt directly.
I2C_ENABLED=false
for f in /boot/userconfig.txt /boot/config.txt; do
  if [ -f "$f" ] && grep -q "^dtparam=i2c_arm=on" "$f" 2>/dev/null; then
    I2C_ENABLED=true
    echo "      I2C already enabled in $f"
    break
  fi
done

if [ "$I2C_ENABLED" = false ]; then
  CONF_FILE="/boot/userconfig.txt"
  [ ! -f "$CONF_FILE" ] && CONF_FILE="/boot/config.txt"
  echo "      Enabling I2C in $CONF_FILE …"
  echo "dtparam=i2c_arm=on" | sudo tee -a "$CONF_FILE" > /dev/null
  echo "      ⚠  I2C was just enabled — a REBOOT is required."
fi

# Load kernel module now (non-fatal if it fails)
sudo modprobe i2c-dev 2>/dev/null || true
if ! grep -q "^i2c-dev" /etc/modules 2>/dev/null; then
  echo "i2c-dev" | sudo tee -a /etc/modules > /dev/null
fi

# Set I2C baudrate to 400kHz (fast mode) for smooth display updates.
# At the default 100kHz, flushing the 1024-byte framebuffer takes ~100ms,
# causing uneven colon blink and position counter timing.  400kHz is within
# the SSD1309 spec and reduces flush time to ~25ms.
BAUDRATE_SET=false
for f in /boot/userconfig.txt /boot/config.txt; do
  if [ -f "$f" ] && grep -q "i2c_arm_baudrate" "$f" 2>/dev/null; then
    BAUDRATE_SET=true
    echo "      I2C baudrate already configured in $f"
    break
  fi
done

if [ "$BAUDRATE_SET" = false ]; then
  # Use the same config file as the I2C enable setting
  BAUD_FILE="/boot/userconfig.txt"
  [ ! -f "$BAUD_FILE" ] && BAUD_FILE="/boot/config.txt"
  echo "dtparam=i2c_arm_baudrate=400000" | sudo tee -a "$BAUD_FILE" > /dev/null
  echo "      ✓ I2C baudrate set to 400kHz (fast mode) in $BAUD_FILE"
  echo "        Note: if you have other I2C devices that only support 100kHz,"
  echo "        you can remove this line from $BAUD_FILE."
fi
echo "      Done."

# ── Step 3: Install Node.js dependencies ─────────────────────────────────
echo "[3/6] Installing npm packages (i2c-bus native addon)…"
cd "${PLUGIN_DIR}"

# Clean any previous broken build artifacts
rm -rf node_modules package-lock.json

npm install --production 2>&1 | tail -5
echo "      Done."

# ── Step 4: Verify native addon compiled correctly ───────────────────────
echo "[4/6] Verifying i2c-bus native addon…"
if node -e "require('i2c-bus')" 2>/dev/null; then
  echo "      ✓ i2c-bus module loaded successfully"
else
  echo ""
  echo "      ✗ ERROR: i2c-bus native addon failed to compile."
  echo "        This usually means a build tool is missing."
  echo "        Try: sudo apt-get install -y build-essential python3 gcc g++ make"
  echo "        Then re-run: cd ${PLUGIN_DIR} && npm install --production"
  echo ""
  exit 1
fi

# ── Step 5: Detect display on I2C bus ────────────────────────────────────
echo "[5/6] Scanning I2C bus 1 for OLED display…"
DETECTED_ADDR=""
if command -v i2cdetect &> /dev/null; then
  DETECTED=$(i2cdetect -y 1 2>/dev/null | grep -oE '\b3[cCdD]\b' | head -1)
  if [ -n "$DETECTED" ]; then
    # Normalise to uppercase hex (3c → 3C, 3d → 3D)
    DETECTED_ADDR="0x$(echo "$DETECTED" | tr '[:lower:]' '[:upper:]')"
    echo "      ✓ Display found at address ${DETECTED_ADDR}"
  else
    echo "      ⚠  No device found at 0x3C or 0x3D."
    echo "         Check wiring: SDA→GPIO2, SCL→GPIO3, VCC→3.3V, GND→GND"
    echo "         (The plugin will still install — fix wiring before enabling.)"
  fi
else
  echo "      (i2cdetect not available — skipping bus scan)"
fi

# ── Step 6: Write detected address to config ─────────────────────────────
echo "[6/6] Configuring plugin…"
MANAGED_DIR="/data/configuration/user_interface/oled_display_ssd1309"
MANAGED_CFG="${MANAGED_DIR}/config.json"

if [ -n "$DETECTED_ADDR" ] && [ "$DETECTED_ADDR" != "0x3C" ]; then
  echo "      Detected address ${DETECTED_ADDR} differs from default 0x3C."
  echo "      Writing detected address to config…"

  # Ensure the managed config directory exists
  mkdir -p "$MANAGED_DIR"

  if [ -f "$MANAGED_CFG" ]; then
    # Update existing managed config — replace the i2c_address value
    # Uses python3 for reliable JSON manipulation
    python3 -c "
import json, sys
try:
    with open('${MANAGED_CFG}') as f:
        cfg = json.load(f)
    # Handle both plain and v-conf wrapped format
    if isinstance(cfg.get('i2c_address'), dict):
        cfg['i2c_address']['value'] = '${DETECTED_ADDR}'
    else:
        cfg['i2c_address'] = {'type': 'string', 'value': '${DETECTED_ADDR}'}
    with open('${MANAGED_CFG}', 'w') as f:
        json.dump(cfg, f, indent=2)
    print('      ✓ Updated managed config with address ${DETECTED_ADDR}')
except Exception as e:
    print('      ⚠  Could not update managed config: ' + str(e))
"
  else
    # No managed config yet — copy bundled config and update the address
    cp "${PLUGIN_DIR}/config.json" "$MANAGED_CFG"
    python3 -c "
import json
try:
    with open('${MANAGED_CFG}') as f:
        cfg = json.load(f)
    if isinstance(cfg.get('i2c_address'), dict):
        cfg['i2c_address']['value'] = '${DETECTED_ADDR}'
    else:
        cfg['i2c_address'] = {'type': 'string', 'value': '${DETECTED_ADDR}'}
    with open('${MANAGED_CFG}', 'w') as f:
        json.dump(cfg, f, indent=2)
    print('      ✓ Created managed config with address ${DETECTED_ADDR}')
except Exception as e:
    print('      ⚠  Could not write managed config: ' + str(e))
"
  fi
else
  echo "      Using default address 0x3C"
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Reboot:               sudo reboot"
echo "  2. After reboot, go to:  Volumio web UI → Plugins → Installed"
echo "  3. Enable 'OLED Display (SSD1309)' with the slider"
echo ""

#required to end the plugin install
echo "plugininstallend"
