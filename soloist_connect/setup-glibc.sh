#!/bin/bash
# The official Soloist binaries are built against a recent glibc (>= 2.38).
# Volumio's Debian base is older, so this script sideloads a newer glibc from
# Debian trixie into /data/soloist/sysroot and ELF-patches soloist against it.
# The system glibc is NOT touched.
set -e

if [ "$(id -u)" != "0" ]; then
  exec sudo -E bash "$0" "$@"
fi

PLUGIN_DIR="/data/plugins/music_service/soloist_connect"
BIN_DIR="/data/soloist/bin"
SYSROOT="/data/soloist/sysroot"
REQUIRED_MAJOR=2
REQUIRED_MINOR=38
BIN="${1:-$BIN_DIR/soloist}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ARCH="$("$HERE/detect-arch.sh")"
case "$ARCH" in
  amd64) DEB_ARCH="amd64"; TRIPLET="x86_64-linux-gnu"; LOADER_NAME="ld-linux-x86-64.so.2" ;;
  arm64) DEB_ARCH="arm64"; TRIPLET="aarch64-linux-gnu"; LOADER_NAME="ld-linux-aarch64.so.1" ;;
  armhf) DEB_ARCH="armhf"; TRIPLET="arm-linux-gnueabihf"; LOADER_NAME="ld-linux-armhf.so.3" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# If the system glibc is already new enough, no sideload is needed.
CUR=$(ldd --version | head -n1 | grep -oE '[0-9]+\.[0-9]+' | tail -n1)
CUR_MAJOR=${CUR%%.*}
CUR_MINOR=${CUR##*.}
if [ "$CUR_MAJOR" -gt "$REQUIRED_MAJOR" ] || { [ "$CUR_MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$CUR_MINOR" -ge "$REQUIRED_MINOR" ]; }; then
  echo "System glibc $CUR is new enough; no sideload needed."
  rm -f "$BIN_DIR/soloist-run" "$PLUGIN_DIR/bin/soloist-run"
  exit 0
fi

have_loader() {
  [ -n "$(find "$SYSROOT" -name "$LOADER_NAME" 2>/dev/null | head -n 1)" ]
}

if [ -d "$SYSROOT" ] && ! have_loader; then
  echo "Sysroot exists but has no $LOADER_NAME (need $ARCH). Rebuilding."
  rm -rf "$SYSROOT"
fi

if [ -d "$SYSROOT" ] && have_loader; then
  echo "Sysroot already has $ARCH glibc ($LOADER_NAME)."
else
  echo "System glibc is $CUR; sideloading $ARCH glibc from Debian trixie..."
  mkdir -p "$SYSROOT"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  MIRROR="http://deb.debian.org/debian"
  echo "Fetching trixie package index for $DEB_ARCH..."
  curl -fsSL --retry 3 -o "$TMP/Packages.gz" \
    "$MIRROR/dists/trixie/main/binary-$DEB_ARCH/Packages.gz"

  for PKG in libc6 libgcc-s1 libstdc++6 libatomic1; do
    FILE=$(zcat "$TMP/Packages.gz" | awk -v p="$PKG" '
      $1=="Package:" { found = ($2==p) }
      found && $1=="Filename:" { print $2; exit }')
    if [ -z "$FILE" ]; then
      echo "Could not locate package $PKG in trixie index"
      exit 1
    fi
    echo "Downloading $PKG ..."
    curl -fsSL --retry 3 -o "$TMP/$PKG.deb" "$MIRROR/$FILE"
    dpkg-deb -x "$TMP/$PKG.deb" "$SYSROOT"
  done
  trap - EXIT
  rm -rf "$TMP"
fi

if ! have_loader; then
  echo "ERROR: $LOADER_NAME still missing from $SYSROOT after sideload." >&2
  exit 1
fi

if ! command -v patchelf >/dev/null 2>&1 && [ ! -x /usr/bin/patchelf ]; then
  echo "Installing patchelf..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y patchelf
fi

if [ ! -f "$BIN" ]; then
  echo "No soloist binary at $BIN yet; sysroot is ready."
  exit 0
fi

if ! bash "$HERE/patch-soloist.sh" "$BIN"; then
  echo "ERROR: patchelf failed; refusing to leave an unpatched ARM binary." >&2
  exit 1
fi
rm -f "$BIN_DIR/soloist-run" "$PLUGIN_DIR/bin/soloist-run"

chown -R volumio:volumio "$SYSROOT" "$BIN_DIR"

echo "Sideload complete. Test with: $BIN --version"
