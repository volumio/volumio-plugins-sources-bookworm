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

# Remove possible build artifacts created during pip installation.
rm -rf "${PLUGIN_DIR}/python/build"
rm -rf "${PLUGIN_DIR}/python"/*.egg-info

# Make sure Volumio can remove the remaining plugin folder.
if id volumio >/dev/null 2>&1; then
  chown -R volumio:volumio "${PLUGIN_DIR}" || true
fi

echo "Uninstallation completed."
echo "pluginuninstallend"
