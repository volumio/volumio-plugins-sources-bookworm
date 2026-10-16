#!/bin/bash
# Mount or unmount the Soloist playback cache as tmpfs, to match
# CACHE_LOCATION in /data/soloist/soloist.env.
#
# Run from the unit as ExecStartPre=+, which executes as root regardless of
# User=volumio. That is deliberate: a mount needs root, and the "+" prefix
# avoids a further sudoers rule and a further NOPASSWD binary.
#
# The mount is a normal shared mount at the existing cache path, not a
# systemd TemporaryFileSystem= in the service's own namespace. The plugin
# reads /proc/<pid>/fd from the Volumio process and then stat()s the resolved
# path (openCacheFile / updateQuality). A namespaced mount would leave that
# stat looking at the empty host directory, and the stream quality tier would
# silently stop being reported.
set -e

ENV_FILE="/data/soloist/soloist.env"
CACHE_DIR="/data/soloist/cache"

if [ "$(id -u)" != "0" ]; then
  exec sudo -E bash "$0" "$@"
fi

# Read one KEY="value" line from the env file using shell builtins only.
#
# Not "source": this runs as root and the env file is written by the plugin as
# the volumio user, so sourcing it would execute volumio-owned content with
# root privileges. Not sed either. The file format is fixed by writeEnvFile()
# in index.js, so a literal prefix match and two quote strips are sufficient
# and involve no external process at all.
read_env_value() {
  local key="$1"
  local line
  [ -f "$ENV_FILE" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="*) ;;
      *) continue ;;
    esac
    line="${line#"$key"=}"
    line="${line#\"}"
    line="${line%\"}"
    printf '%s' "$line"
    return 0
  done < "$ENV_FILE"
  return 1
}

CACHE_LOCATION="$(read_env_value CACHE_LOCATION || true)"
CACHE_TMPFS_MB="$(read_env_value CACHE_TMPFS_MB || true)"
[ -n "$CACHE_LOCATION" ] || CACHE_LOCATION="disk"

mkdir -p "$CACHE_DIR"

is_tmpfs() {
  # findmnt answers for this exact mountpoint only, so a tmpfs mounted
  # somewhere above it cannot produce a false positive.
  [ "$(findmnt -no FSTYPE --target "$CACHE_DIR" 2>/dev/null)" = "tmpfs" ] &&
  [ "$(findmnt -no TARGET --target "$CACHE_DIR" 2>/dev/null)" = "$CACHE_DIR" ]
}

if [ "$CACHE_LOCATION" = "ram" ]; then
  # Size is written by the plugin, which clamps it against MemTotal. Refuse a
  # missing or non-numeric value rather than guessing: an unsized tmpfs
  # defaults to half of RAM, which on a 512 MB board is not a cache, it is an
  # out-of-memory kill waiting for a lossless album.
  case "$CACHE_TMPFS_MB" in
    ''|*[!0-9]*)
      echo "cache-location: CACHE_LOCATION=ram but CACHE_TMPFS_MB is '$CACHE_TMPFS_MB'; staying on disk" >&2
      exit 0
      ;;
  esac
  if [ "$CACHE_TMPFS_MB" -lt 100 ]; then
    echo "cache-location: CACHE_TMPFS_MB=$CACHE_TMPFS_MB is below the daemon minimum of 100; staying on disk" >&2
    exit 0
  fi

  if is_tmpfs; then
    # Already mounted. Remounting would discard a cache the running system is
    # about to use, and this script runs at every daemon start, including the
    # restarts the plugin issues when settings are saved.
    exit 0
  fi

  # Anything already on disk under the mountpoint would be shadowed and
  # stranded, occupying the data partition with no way to reach it. Clear it
  # before the tmpfs goes over the top.
  rm -rf "${CACHE_DIR:?}/"* 2>/dev/null || true

  echo "cache-location: mounting ${CACHE_TMPFS_MB}M tmpfs on $CACHE_DIR" >&2
  mount -t tmpfs -o "size=${CACHE_TMPFS_MB}m,uid=1000,gid=1000,mode=0755" tmpfs "$CACHE_DIR"
  exit 0
fi

# Disk mode. Unmount if a previous run left a tmpfs here.
if is_tmpfs; then
  echo "cache-location: unmounting tmpfs from $CACHE_DIR" >&2
  umount "$CACHE_DIR" || true
fi
mkdir -p "$CACHE_DIR"
chown volumio:volumio "$CACHE_DIR"
