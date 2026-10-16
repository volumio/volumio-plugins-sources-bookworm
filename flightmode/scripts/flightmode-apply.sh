#!/bin/bash
# Apply or release per-radio rfkill policy.
# Enumerates by type (bluetooth, wlan), never by index.
#
# wifi.state / bluetooth.state: on = radio allowed, off = plugin holds a block.
# wifi.persist: on = keep WiFi off across reboot even without LAN.
# /run/flightmode-wifi-session: this-boot session hold (tmpfs, dies on reboot).
# /data/flightmode: empty file = test mode, pretend no LAN.
# Empty file named wifi in /boot or on a USB mount = sentinel, force WiFi on.

set -eu

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WIFI_STATE_FILE="${PLUGIN_DIR}/wifi.state"
BT_STATE_FILE="${PLUGIN_DIR}/bluetooth.state"
PERSIST_FILE="${PLUGIN_DIR}/wifi.persist"
MODE_FILE="${PLUGIN_DIR}/flightmode.mode"
PATH_IN="${PLUGIN_DIR}/units/volumio-flightmode.path.in"
PATH_GEN="${PLUGIN_DIR}/units/volumio-flightmode.path"
RFKILL_CLASS="/sys/class/rfkill"
NET_CLASS="/sys/class/net"
SESSION_FILE="/run/flightmode-wifi-session"
TEST_FILE="/data/flightmode"

GENERATE_ONLY=0
if [ "${1:-}" = "--generate-path" ]; then
  GENERATE_ONLY=1
fi

is_watched_type() {
  case "$1" in
    bluetooth|wlan) return 0 ;;
    *) return 1 ;;
  esac
}

list_watched() {
  local d t
  if [ ! -d "${RFKILL_CLASS}" ]; then
    return 0
  fi
  for d in "${RFKILL_CLASS}"/rfkill*; do
    [ -e "${d}/type" ] || continue
    t="$(cat "${d}/type" 2>/dev/null || true)"
    if is_watched_type "${t}"; then
      printf '%s\n' "${d}"
    fi
  done
}

device_type() {
  cat "${1}/type" 2>/dev/null || true
}

is_empty_file() {
  local f="$1"
  [ -f "${f}" ] && [ ! -s "${f}" ]
}

has_test_nolan() {
  is_empty_file "${TEST_FILE}"
}

has_wired_carrier() {
  local name carrier
  if has_test_nolan; then
    return 1
  fi
  if [ ! -d "${NET_CLASS}" ]; then
    return 1
  fi
  for name in "${NET_CLASS}"/*; do
    name="${name##*/}"
    case "${name}" in
      lo|wlan*|wl*|wwan*|wwp*|docker*|br-*|veth*|tun*|tap*|virbr*|cni*) continue ;;
    esac
    case "${name}" in
      eth*|enp*|ens*|eno*|enx*|usb*|en[0-9]*)
        carrier="$(cat "${NET_CLASS}/${name}/carrier" 2>/dev/null || true)"
        if [ "${carrier}" = "1" ]; then
          return 0
        fi
        ;;
    esac
  done
  return 1
}

find_sentinel() {
  local dir
  if is_empty_file /boot/wifi; then
    printf '%s\n' /boot/wifi
    return 0
  fi
  if is_empty_file /boot/firmware/wifi; then
    printf '%s\n' /boot/firmware/wifi
    return 0
  fi
  for dir in /media /mnt; do
    [ -d "${dir}" ] || continue
    for candidate in "${dir}"/*/wifi; do
      if is_empty_file "${candidate}"; then
        printf '%s\n' "${candidate}"
        return 0
      fi
    done
  done
  return 1
}

generate_path_unit() {
  local tmp insert d
  if [ ! -f "${PATH_IN}" ]; then
    echo "flightmode-apply: missing ${PATH_IN}" >&2
    return 1
  fi
  tmp="${PATH_GEN}.tmp"
  insert="PathChanged=${RFKILL_CLASS}"$'\n'
  while IFS= read -r d; do
    [ -n "${d}" ] || continue
    if [ -e "${d}/soft" ]; then
      insert="${insert}PathChanged=${d}/soft"$'\n'
    fi
    if [ -e "${d}/hard" ]; then
      insert="${insert}PathChanged=${d}/hard"$'\n'
    fi
  done < <(list_watched)

  awk -v insert="${insert}" '
    $0 == "# FLIGHTMODE_PATHS" { printf "%s", insert; next }
    { print }
  ' "${PATH_IN}" > "${tmp}"

  if [ -f "${PATH_GEN}" ] && cmp -s "${tmp}" "${PATH_GEN}"; then
    rm -f "${tmp}"
    return 1
  fi
  mv "${tmp}" "${PATH_GEN}"
  return 0
}

soft_write() {
  local d="$1"
  local value="$2"
  local hard soft
  hard="$(cat "${d}/hard" 2>/dev/null || echo 1)"
  soft="$(cat "${d}/soft" 2>/dev/null || echo "${value}")"
  if [ "${hard}" != "0" ]; then
    return 0
  fi
  if [ "${soft}" = "${value}" ]; then
    return 0
  fi
  echo "${value}" > "${d}/soft" 2>/dev/null || true
}

read_trimmed() {
  local file="$1"
  local fallback="$2"
  if [ -f "${file}" ]; then
    tr -d '[:space:]' < "${file}"
  else
    printf '%s' "${fallback}"
  fi
}

apply_type() {
  local want="$1"
  local value="$2"
  local d t
  while IFS= read -r d; do
    [ -n "${d}" ] || continue
    t="$(device_type "${d}")"
    if [ "${t}" = "${want}" ]; then
      soft_write "${d}" "${value}"
    fi
  done < <(list_watched)
}

apply_release_type() {
  local want="$1"
  local d t
  while IFS= read -r d; do
    [ -n "${d}" ] || continue
    t="$(device_type "${d}")"
    if [ "${want}" = "all" ] || [ "${t}" = "${want}" ]; then
      soft_write "${d}" 0
    fi
  done < <(list_watched)
}

clear_persist() {
  printf '%s\n' 'off' > "${PERSIST_FILE}" || true
}

honour_sentinel() {
  if find_sentinel >/dev/null; then
    apply_type wlan 0
    printf '%s\n' 'on' > "${WIFI_STATE_FILE}" || true
    clear_persist
    rm -f "${SESSION_FILE}" || true
    return 0
  fi
  return 1
}

should_block_wifi_across_reboot() {
  local persist
  persist="$(read_trimmed "${PERSIST_FILE}" off)"
  if [ "${persist}" = "on" ]; then
    return 0
  fi
  if has_wired_carrier; then
    return 0
  fi
  return 1
}

apply_bluetooth() {
  local bt
  bt="$(read_trimmed "${BT_STATE_FILE}" on)"
  if [ "${bt}" = "off" ]; then
    apply_type bluetooth 1
  fi
}

apply_session() {
  local wifi
  : > "${SESSION_FILE}" || true
  apply_bluetooth
  if honour_sentinel; then
    return 0
  fi
  wifi="$(read_trimmed "${WIFI_STATE_FILE}" on)"
  if [ "${wifi}" = "off" ]; then
    apply_type wlan 1
  fi
}

apply_reconcile() {
  local wifi
  apply_bluetooth
  if honour_sentinel; then
    return 0
  fi
  wifi="$(read_trimmed "${WIFI_STATE_FILE}" on)"
  if [ "${wifi}" != "off" ]; then
    return 0
  fi
  if [ -f "${SESSION_FILE}" ] || should_block_wifi_across_reboot; then
    apply_type wlan 1
  fi
}

PATH_CHANGED=0
if generate_path_unit; then
  PATH_CHANGED=1
fi

if [ "${GENERATE_ONLY}" -eq 1 ]; then
  exit 0
fi

MODE="$(read_trimmed "${MODE_FILE}" reconcile)"

if [ "${MODE}" = "session" ] && [ ! -f "${SESSION_FILE}" ]; then
  MODE=reconcile
fi

case "${MODE}" in
  release)
    apply_release_type all
    rm -f "${SESSION_FILE}" || true
    printf '%s\n' 'reconcile' > "${MODE_FILE}" || true
    ;;
  release-wifi)
    apply_release_type wlan
    rm -f "${SESSION_FILE}" || true
    printf '%s\n' 'reconcile' > "${MODE_FILE}" || true
    ;;
  release-bluetooth)
    apply_release_type bluetooth
    printf '%s\n' 'reconcile' > "${MODE_FILE}" || true
    ;;
  session)
    apply_session
    ;;
  *)
    apply_reconcile
    ;;
esac

if [ "${PATH_CHANGED}" -eq 1 ]; then
  /bin/systemctl daemon-reload >/dev/null 2>&1 || true
  if /bin/systemctl is-enabled --quiet volumio-flightmode.path 2>/dev/null; then
    /bin/systemctl restart volumio-flightmode.path >/dev/null 2>&1 || true
  fi
fi

exit 0
