#!/bin/sh
set -eu

APP_NAME="volumio-screensaver"
PLUGIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VENV_DIR="${PLUGIN_DIR}/venv"
PYTHON_DIR="${PLUGIN_DIR}/python"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
ENV_FILE="${PLUGIN_DIR}/${APP_NAME}.env"

if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    exec sudo -E sh "$0" "$@"
  fi

  echo "This plugin needs privileged setup, but sudo is not available non-interactively."
  echo "Run once manually from this directory: sudo sh install.sh"
  echo "Then run again: volumio plugin install"
  exit 1
fi

if [ ! -d "${PYTHON_DIR}/volumio_screensaver" ]; then
  echo "Missing embedded Python source: ${PYTHON_DIR}/volumio_screensaver"
  exit 1
fi

python3 -m venv --system-site-packages "${VENV_DIR}"

"${VENV_DIR}/bin/python" -m pip install --no-cache-dir --no-deps gpiodevice==0.0.5 st7789==1.0.1 gpiod==2.5.0
"${VENV_DIR}/bin/python" -m pip install --no-cache-dir --force-reinstall --no-build-isolation --no-deps "${PYTHON_DIR}"

cat > "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Volumio Pirate Audio screen saver
After=network-online.target volumio.service
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=-${ENV_FILE}
ExecStart=${VENV_DIR}/bin/volumio-screensaver
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

if [ ! -f "${ENV_FILE}" ]; then
  cat > "${ENV_FILE}" <<ENV
VOLUMIO_URL=http://127.0.0.1:3000
POLL_SECONDS=2.0
HTTP_TIMEOUT_SECONDS=1.5
IDLE_DELAY_SECONDS=300

BUTTONS_ENABLED=false
BUTTON_PINS=5,6,16,24
BUTTON_BOUNCE_MS=100

DISPLAY_WIDTH=240
DISPLAY_HEIGHT=240
DISPLAY_ROTATION=90
DISPLAY_PORT=0
DISPLAY_CS=1
DISPLAY_DC=9
DISPLAY_BACKLIGHT=13
DISPLAY_SPI_SPEED=80000000
DISPLAY_OFFSET_LEFT=0
DISPLAY_OFFSET_TOP=0

FONT_SIZE=58
FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf
SCREEN_PADDING=8
BLANK_TURNS_BACKLIGHT_OFF=true
LOG_LEVEL=INFO
ENV
fi

systemctl daemon-reload

# Remove build artifacts created by pip/setuptools during local installation.
# These can be owned by root and prevent Volumio from uninstalling the plugin cleanly.
rm -rf "${PYTHON_DIR}/build"
rm -rf "${PYTHON_DIR}"/*.egg-info

# Keep the plugin folder removable by Volumio after install.
if id volumio >/dev/null 2>&1; then
  chown -R volumio:volumio "${PLUGIN_DIR}" || true
fi

echo "Installation completed. The service will be started when the plugin is enabled."
echo "plugininstallend"
