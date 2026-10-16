#!/bin/bash
# Downloads the Spotify Soloist binary for this device's architecture from the
# official Spotify CDN. Spotify does not allow redistributing the binary, so it
# is always fetched directly from developer.spotify.com's published URLs:
# https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates
#
# Must run as root: the plugin tree is root-owned after `volumio plugin install`,
# and patchelf needs write access to the ELF. The UI updater calls this via sudo
# (see volumio-user-soloist_connect). Stage+patch first; only then replace the
# live binary, so a failed patch cannot leave an unpatched ARM build (that
# path is instant play→pause). This script never reboots; install and the
# expiry path start the daemon afterwards, and the settings button reboots.
set -e

if [ "$(id -u)" != "0" ]; then
  exec sudo -E bash "$0" "$@"
fi

PLUGIN_DIR="/data/plugins/music_service/soloist_connect"
BIN_DIR="/data/soloist/bin"
STAGING="/data/soloist/staging"
mkdir -p "$BIN_DIR" "$STAGING"

# Userspace arch, not kernel uname. Official Volumio 4 Pi is armhf
# (recipes/devices/pi.sh) even on a 64-bit kernel; the stock Spotify
# plugin only ships armhf+amd64.
HERE="$(cd "$(dirname "$0")" && pwd)"
ARCH="$("$HERE/detect-arch.sh")"
case "$ARCH" in
  arm64)
    URL="https://soloist-builds.spotifycdn.com/soloist_release_arm64.tar.gz"
    ;;
  armhf)
    URL="https://soloist-builds.spotifycdn.com/soloist_release_arm32.tar.gz"
    ;;
  amd64)
    URL="https://soloist-builds.spotifycdn.com/soloist_release_x86_64.tar.gz"
    ;;
  *)
    echo "Unsupported architecture: $ARCH (need armhf, arm64, or amd64)"
    exit 1
    ;;
esac

echo "Downloading Spotify Soloist for userspace $ARCH (uname=$(uname -m) dpkg=$(dpkg --print-architecture 2>/dev/null || echo ?) bits=$(getconf LONG_BIT 2>/dev/null || echo ?)) ..."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# --http1.1 is required. On Volumio 4 armhf the CDN's HTTP/2 stream aborts
# mid-transfer with curl (92) PROTOCOL_ERROR, reproducibly at ~2 MB.
# Write to a sibling first so a dropped transfer cannot be mistaken for
# a finished archive. List the tarball before extracting: a truncated
# gzip often fails here instead of unpacking a partial ELF.
ARCHIVE="$TMP/soloist.tar.gz"
curl --http1.1 -fSL --retry 3 --retry-delay 2 -o "$ARCHIVE.partial" "$URL"
if [ ! -s "$ARCHIVE.partial" ]; then
  echo "ERROR: download was empty" >&2
  exit 1
fi
mv -f "$ARCHIVE.partial" "$ARCHIVE"
if ! tar -tzf "$ARCHIVE" >/dev/null; then
  echo "ERROR: archive is corrupt or incomplete" >&2
  exit 1
fi
tar -xzf "$ARCHIVE" -C "$TMP"

SOLOIST_BIN=$(find "$TMP" -type f -name soloist | head -n 1)
if [ -z "$SOLOIST_BIN" ]; then
  echo "soloist executable not found in archive"
  exit 1
fi

STAGE="$STAGING/soloist"
rm -f "$STAGE"
cp -f "$SOLOIST_BIN" "$STAGE"
chmod 0755 "$STAGE"

# Fresh CDN binary is unpatched. Bookworm glibc 2.36 cannot run ARM Soloist
# (needs >= 2.38). Always rebuild/repair the matching sysroot and patch
# *the staged file* before touching the live binary. A previous aarch64
# sysroot plus a new armhf download is why launch then says "not ELF-patched".
bash "$HERE/setup-glibc.sh" "$STAGE"

PATCHELF="/usr/bin/patchelf"
[ -x "$PATCHELF" ] || PATCHELF="$(command -v patchelf || true)"
if [ -d /data/soloist/sysroot ]; then
  INTERP=$("$PATCHELF" --print-interpreter "$STAGE" 2>/dev/null || true)
  case "$INTERP" in
    /data/soloist/sysroot*)
      echo "Patched interpreter: $INTERP"
      ;;
    *)
      echo "ERROR: staged interpreter is '${INTERP:-unknown}', not under /data/soloist/sysroot" >&2
      exit 1
      ;;
  esac
fi

# --version can exit 10 on an expired build and still print a line. A
# half-written or unpatched ELF prints nothing.
VER=$("$STAGE" --version 2>/dev/null | head -n 1 || true)
if [ -z "$VER" ]; then
  echo "ERROR: staged soloist did not print a version; leaving the live binary alone" >&2
  exit 1
fi
echo "Staged: $VER"

# Write dest.new, fsync, keep the previous dest as .bak, then rename.
# Same-directory mv is atomic on the data partition.
install_live() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  install -m 0755 -o volumio -g volumio "$STAGE" "$dest.new"
  sync "$dest.new" || sync
  if [ -f "$dest" ]; then
    cp -f "$dest" "$dest.bak"
    sync "$dest.bak" || true
  fi
  mv -f "$dest.new" "$dest"
}

# Stop only after the staged ELF is known-good, so a failed download
# does not take a working speaker down.
systemctl stop soloist.service 2>/dev/null || true

install_live "$BIN_DIR/soloist"
mkdir -p "$PLUGIN_DIR/bin"
install_live "$PLUGIN_DIR/bin/soloist"
rm -f "$STAGE"
sync

echo "Installed: $("$BIN_DIR/soloist" --version 2>/dev/null | head -n 1 || echo 'soloist')"
echo "Start with: sudo systemctl start soloist.service"
