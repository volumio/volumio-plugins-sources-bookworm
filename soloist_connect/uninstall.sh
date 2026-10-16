#!/bin/bash
# Invoked by Volumio as: sudo -S sh uninstall.sh
# It runs under /bin/sh, not bash, so keep this POSIX.
if [ "$(id -u)" != "0" ]; then
  exec sudo -E bash "$0" "$@"
fi
echo "Uninstalling Spotify Soloist Connect..."

ENV_FILE="/data/soloist/soloist.env"

# Read one KEY="value" line from the env file using shell builtins only.
# No sed, and no source: this runs as root while the env file is written by
# the plugin as the volumio user, so sourcing it would execute volumio-owned
# content with root privileges. The format is fixed by writeEnvFile() in
# index.js, so a literal prefix match and two quote strips are sufficient.
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

systemctl stop soloist.service 2>/dev/null || true
systemctl disable soloist.service 2>/dev/null || true
rm -f /etc/systemd/system/soloist.service
systemctl daemon-reload

rm -f /etc/sudoers.d/soloist_connect
rm -f /etc/sudoers.d/volumio-user-soloist_connect

# "Retain my API key". Volumio deletes the plugin's own configuration after this
# script runs (removePluginFromConfiguration does rm -rf on
# /data/configuration/music_service/soloist_connect), so the key cannot survive
# there. The plugin therefore writes the setting into the env file, which is the
# only thing left that can be consulted here.
#
# Default is to retain. An unreadable or missing env file means there is nothing
# worth keeping anyway, so the full removal path is taken.
RETAIN="false"
if [ -f "$ENV_FILE" ]; then
  RETAIN="$(read_env_value RETAIN_API_KEY || true)"
fi

if [ "$RETAIN" = "true" ]; then
  echo "Retaining API key and paired session in /data/soloist"
  # The cache may be a tmpfs (CACHE_LOCATION=ram). rm -rf on a live mount
  # empties it and leaves the mount behind, so drop it first. || true because
  # disk mode has nothing mounted, which is the normal case.
  umount /data/soloist/cache 2>/dev/null || true
  # Removed: the downloaded binary, its staging copy, the sideloaded glibc and
  # the playback cache. All are re-created on install.
  rm -rf /data/soloist/bin
  rm -rf /data/soloist/staging
  rm -rf /data/soloist/sysroot
  rm -rf /data/soloist/cache
  # Kept: soloist.env (holds API_KEY, mode 0600) and data/ (device identity and
  # the stored Spotify Connect session). Removing data/ would force re-pairing.
else
  echo "Removing all Soloist data including the API key"
  umount /data/soloist/cache 2>/dev/null || true
  rm -rf /data/soloist
fi

echo "pluginuninstallend"
