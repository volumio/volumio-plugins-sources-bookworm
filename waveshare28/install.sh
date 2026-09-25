#!/bin/sh
#
# Install the Waveshare 2.8 tool from this plugin's payload.
# Files only: binaries and sudoers. Do not apply, start, or enable the
# panel unit. That happens when the user enables the plugin (onStart).
# Same shape as peppy_screensaver: the plugin directory carries the
# binaries; this script puts them on the system. Volumio's plugin
# installer packages the directory. It does not edit volumioconfig.txt.
#
# Volumio invokes this as `sh install.sh` (dash). No bashisms.

set -eu

echo "Installing Waveshare 2.8 SPI Panel plugin"

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="/usr/local/bin"
REPO="foonerd/rpi-waveshare28"
RELEASE_BASE="https://github.com/${REPO}/releases/download"
RUNTIME_TAG="runtime-v1.6.0"
# Volumio requires /etc/sudoers.d/volumio-<plugin_name>
SUDOERS_FILE="/etc/sudoers.d/volumio-waveshare28"

log()  { printf '[waveshare28-plugin] %s\n' "$*"; }
warn() { printf '[waveshare28-plugin] WARNING: %s\n' "$*" >&2; }
die()  { printf '[waveshare28-plugin] ERROR: %s\n' "$*" >&2; exit 1; }

# Pi 1 / original Zero / CM1. An armv7 binary dies with SIGILL there.
if [ -r /proc/device-tree/compatible ] && grep -q bcm2835 /proc/device-tree/compatible; then
    die "armv6 boards (Pi 1, original Pi Zero, CM1) are not supported"
fi
if [ "$(uname -m)" = armv6l ]; then
    die "armv6 boards (Pi 1, original Pi Zero, CM1) are not supported"
fi

# Same mapping as scripts/install.sh. Pi 5 Volumio 4 is a 64-bit kernel
# on 32-bit userland: VOLUMIO_ARCH=arm wants the armhf artefact.
runtime_arch() {
    varch="$(sed -n 's/^VOLUMIO_ARCH=//p' /etc/os-release 2>/dev/null | tr -d '"')"
    dpkg="$(dpkg --print-architecture 2>/dev/null || true)"

    case "$varch" in
        arm|armv7) printf 'armv7-unknown-linux-musleabihf'; return 0 ;;
        armv6)     die "armv6 is not supported" ;;
        aarch64|arm64) printf 'aarch64-unknown-linux-musl'; return 0 ;;
    esac
    case "$dpkg" in
        armhf|armel)
            case "$(uname -m)" in
                armv6l) die "armv6 is not supported" ;;
                *)      printf 'armv7-unknown-linux-musleabihf' ;;
            esac
            return 0
            ;;
        arm64) printf 'aarch64-unknown-linux-musl'; return 0 ;;
    esac
    case "$(uname -m)" in
        armv6l)  die "armv6 is not supported" ;;
        armv7l)  printf 'armv7-unknown-linux-musleabihf' ;;
        aarch64) printf 'aarch64-unknown-linux-musl' ;;
        *)       die "unsupported architecture: $(uname -m) (VOLUMIO_ARCH=${varch:-?} dpkg=${dpkg:-?})" ;;
    esac
}

payload_panel() {
    triple="$1"
    case "$triple" in
        armv7-unknown-linux-musleabihf) printf '%s/payload/bin/armhf/waveshare28-panel' "$PLUGIN_DIR" ;;
        aarch64-unknown-linux-musl)     printf '%s/payload/bin/aarch64/waveshare28-panel' "$PLUGIN_DIR" ;;
        *)                              printf '' ;;
    esac
}

CONFIG_SRC="${PLUGIN_DIR}/payload/waveshare28-config"
[ -f "$CONFIG_SRC" ] || die "payload is missing waveshare28-config"

log "installing configurator from plugin payload"
install -m 0755 "$CONFIG_SRC" "${BIN_DIR}/waveshare28-config"

ARCH="$(runtime_arch)"
PANEL_SRC="$(payload_panel "$ARCH")"
if [ -n "$PANEL_SRC" ] && [ -f "$PANEL_SRC" ]; then
    log "installing renderer from plugin payload (${ARCH})"
    if [ -f "${PANEL_SRC}.sha256" ]; then
        (cd "$(dirname "$PANEL_SRC")" && sha256sum -c "$(basename "$PANEL_SRC").sha256")
    fi
    install -m 0755 "$PANEL_SRC" "${BIN_DIR}/waveshare28-panel"
elif [ "$ARCH" = armv7-unknown-linux-musleabihf ]; then
    die "payload is missing waveshare28-panel (armhf)"
else
    log "payload has no renderer for ${ARCH}; fetching ${RUNTIME_TAG}"
    command -v curl >/dev/null 2>&1 || die "curl is required to fetch the renderer"
    tmp="$(mktemp -d)"
    url="${RELEASE_BASE}/${RUNTIME_TAG}/waveshare28-panel-${ARCH}"
    curl -fsSL "$url" -o "${tmp}/waveshare28-panel"
    curl -fsSL "${url}.sha256" -o "${tmp}/waveshare28-panel.sha256"
    (cd "$tmp" && sha256sum -c waveshare28-panel.sha256)
    install -m 0755 "${tmp}/waveshare28-panel" "${BIN_DIR}/waveshare28-panel"
    rm -rf "$tmp"
fi

log "installing sudoers ${SUDOERS_FILE}"
rm -f /etc/sudoers.d/volumio-user-waveshare28
cat > "$SUDOERS_FILE" <<'EOF'
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/waveshare28-config
EOF
chmod 0440 "$SUDOERS_FILE"
if ! visudo -c -f "$SUDOERS_FILE"; then
    rm -f "$SUDOERS_FILE"
    die "invalid sudoers syntax"
fi

echo "Waveshare 2.8 SPI Panel plugin installed"
echo "plugininstallend"
