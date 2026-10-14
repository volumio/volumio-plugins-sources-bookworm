#!/bin/sh
# A removable systemd override keeps Pirate Audio as the sole screen owner.
set -eu

PLUGIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
NATIVE_DIR="/data/plugins/system_hardware/pirateaudio"
DROPIN_DIR="/etc/systemd/system/pirateaudio.service.d"
DROPIN_FILE="${DROPIN_DIR}/50-volumio-screensaver.conf"
MARKER="# Managed by Pirate Audio Screensaver"
SOCKET_FILE="/run/volumio-screensaver/pirateaudio.sock"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n /bin/sh "$0" "$@"
fi

# Never replace or remove an unrelated service override.
if [ -f "${DROPIN_FILE}" ] && ! grep -qFx "${MARKER}" "${DROPIN_FILE}"; then
  echo "An unrelated override already exists at ${DROPIN_FILE}."
  exit 1
fi

case "${1:-}" in
  enable)
    if [ ! -x "${NATIVE_DIR}/venv/bin/python" ] || [ ! -f "${NATIVE_DIR}/display.py" ]; then
      echo "Install and enable the Pirate Audio hardware plugin first."
      exit 1
    fi
    # Volumio starts the hardware plugin asynchronously during startup.
    attempts=0
    while ! systemctl is-active --quiet pirateaudio.service && [ "${attempts}" -lt 10 ]; do
      sleep 0.5
      attempts=$((attempts + 1))
    done
    if ! systemctl is-active --quiet pirateaudio.service; then
      echo "Enable the Pirate Audio hardware plugin before enabling its screensaver."
      exit 1
    fi
    mkdir -p "${DROPIN_DIR}"
    temporary_file="$(mktemp "${DROPIN_FILE}.XXXXXX")"
    trap 'rm -f "${temporary_file}"' EXIT HUP INT TERM
    cat > "${temporary_file}" <<BRIDGE
${MARKER}
[Service]
ExecStart=
ExecStart=${NATIVE_DIR}/venv/bin/python ${PLUGIN_DIR}/python/volumio_screensaver/pirateaudio_wrapper.py --native-script ${NATIVE_DIR}/display.py --socket /run/volumio-screensaver/pirateaudio.sock
RuntimeDirectory=volumio-screensaver
RuntimeDirectoryMode=0700
BRIDGE
    if ! cmp -s "${temporary_file}" "${DROPIN_FILE}"; then
      chmod 644 "${temporary_file}"
      mv "${temporary_file}" "${DROPIN_FILE}"
      systemctl daemon-reload
    fi
    # Reload Python sources even when the override path has not changed.
    if ! systemctl restart pirateaudio.service; then
      rm -f "${DROPIN_FILE}"
      systemctl daemon-reload
      systemctl restart pirateaudio.service || true
      echo "Cannot activate the shared display; restored the native service."
      exit 1
    fi
    # Type=simple being active does not mean the wrapper has initialized. Probe
    # the actual protocol before reporting successful plugin activation.
    attempts=0
    bridge_ready=false
    while [ "${attempts}" -lt 10 ]; do
      if PYTHONPATH="${PLUGIN_DIR}/python" "${PLUGIN_DIR}/venv/bin/python" -c '
from volumio_screensaver.bridge import SharedDisplay
import sys
client = SharedDisplay(sys.argv[1])
try:
    client.consume_activity()
finally:
    client.close()
' "${SOCKET_FILE}" >/dev/null 2>&1; then
        bridge_ready=true
        break
      fi
      sleep 0.5
      attempts=$((attempts + 1))
    done
    if [ "${bridge_ready}" != true ]; then
      rm -f "${DROPIN_FILE}"
      systemctl daemon-reload
      systemctl restart pirateaudio.service || true
      echo "The shared display did not become ready; restored the native service."
      exit 1
    fi
    ;;
  disable)
    if [ -f "${DROPIN_FILE}" ]; then
      rm -f "${DROPIN_FILE}"
      systemctl daemon-reload
      # Preserve a hardware plugin that the user has stopped separately.
      if systemctl is-active --quiet pirateaudio.service; then
        systemctl restart pirateaudio.service
      fi
    fi
    ;;
  *)
    echo "Usage: sh display-bridge.sh enable|disable"
    exit 2
    ;;
esac
