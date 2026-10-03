#!/bin/sh
# Grant only the two privileged display bridge operations used by this plugin.
set -eu

PLUGIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BRIDGE_SCRIPT="${PLUGIN_DIR}/display-bridge.sh"
SUDOERS_DIR="/etc/sudoers.d"
# Read after Volumio's general authentication rule in volumio-user.
SUDOERS_FILE="${SUDOERS_DIR}/volumio-user-pirate-audio-screensaver"
LEGACY_SUDOERS_FILE="${SUDOERS_DIR}/pirate-audio-screensaver"
MARKER="# Managed by Pirate Audio Screensaver (display bridge permissions)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Display bridge permissions must be installed or removed as root."
  echo "Run: sudo /bin/sh bridge-permissions.sh install|remove"
  exit 1
fi

case "${1:-}" in
  install|remove) ;;
  *)
    echo "Usage: sh bridge-permissions.sh install|remove"
    exit 2
    ;;
esac

# The installed Volumio path contains only these characters. Refuse other
# paths instead of interpreting spaces, sudoers separators or wildcards.
case "${PLUGIN_DIR}" in
  *[!A-Za-z0-9_./-]*)
    echo "Unsupported plugin path for display bridge permissions: ${PLUGIN_DIR}"
    exit 1
    ;;
esac

# Check both entries before changing either one. A legacy entry is migrated
# only when it is a regular file carrying this plugin's ownership marker.
for policy_file in "${SUDOERS_FILE}" "${LEGACY_SUDOERS_FILE}"; do
  if [ -L "${policy_file}" ] || { [ -e "${policy_file}" ] && [ ! -f "${policy_file}" ]; }; then
    echo "Refusing an unrelated permissions entry at ${policy_file}."
    exit 1
  fi
  if [ -f "${policy_file}" ] && ! grep -qFx "${MARKER}" "${policy_file}"; then
    echo "An unrelated permissions entry already exists at ${policy_file}."
    exit 1
  fi
done

case "${1}" in
  install)
    if [ ! -f "${BRIDGE_SCRIPT}" ]; then
      echo "Missing display bridge helper: ${BRIDGE_SCRIPT}"
      exit 1
    fi
    if ! command -v visudo >/dev/null 2>&1; then
      echo "Cannot validate display bridge permissions: visudo is unavailable."
      exit 1
    fi
    if [ ! -d "${SUDOERS_DIR}" ]; then
      echo "Cannot install display bridge permissions: ${SUDOERS_DIR} is missing."
      exit 1
    fi
    temporary_file="$(mktemp "${SUDOERS_FILE}.XXXXXX")"
    trap 'rm -f "${temporary_file}"' EXIT HUP INT TERM
    cat > "${temporary_file}" <<PERMISSIONS
${MARKER}
volumio ALL=(root) NOPASSWD: /bin/sh ${BRIDGE_SCRIPT} enable
volumio ALL=(root) NOPASSWD: /bin/sh ${BRIDGE_SCRIPT} disable
PERMISSIONS
    # Validate before replacing a working policy. The temporary filename has
    # a dot, so sudo's directory include ignores it until the atomic rename.
    visudo -c -f "${temporary_file}"
    chown root:root "${temporary_file}"
    chmod 0440 "${temporary_file}"
    mv -f "${temporary_file}" "${SUDOERS_FILE}"
    # Preserve the legacy entry until the replacement has passed validation
    # and is installed under its effective name.
    rm -f "${LEGACY_SUDOERS_FILE}"
    ;;
  remove)
    rm -f "${SUDOERS_FILE}" "${LEGACY_SUDOERS_FILE}"
    ;;
esac
