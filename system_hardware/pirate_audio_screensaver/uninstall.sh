#!/bin/sh
set -eu

APP_NAME="volumio-screensaver"
PLUGIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VENV_DIR="${PLUGIN_DIR}/venv"
ENV_FILE="${PLUGIN_DIR}/${APP_NAME}.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    exec sudo -E sh "$0" "$@"
  fi

  echo "This plugin needs privileged setup, but sudo is not available non-interactively."
  exit 1
fi

systemctl stop "${APP_NAME}.service" || true
systemctl disable "${APP_NAME}.service" || true
rm -f "${SERVICE_FILE}"
systemctl daemon-reload

rm -rf "${VENV_DIR}"
rm -f "${ENV_FILE}"

echo "Uninstallation completed."
echo "pluginuninstallend"
