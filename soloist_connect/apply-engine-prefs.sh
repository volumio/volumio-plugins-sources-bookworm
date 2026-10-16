#!/bin/bash
# Merge loudness and crossfade into Soloist's data-dir prefs before spawn.
# Called from launch-soloist.sh as volumio. Never fails the launch.
#
# The engine has no CLI or WebSocket for these keys. It reads the desktop-client
# prefs store at startup. Per-user files override the global store per key, so
# both are updated when they exist. Other lines are left alone.
# Quality prefs are not written here.

DATA_DIR="${SOLOIST_DATA_DIR:-/data/soloist/data}"
KEY_NORMALIZE="audio.normalize_v2"
KEY_CROSSFADE="audio.crossfade_v2"
KEY_CROSSFADE_TIME="audio.crossfade.time_v2"

case "${LOUDNESS_NORMALIZATION:-}" in
  true) NORM=true; NORM_LABEL=on ;;
  false) NORM=false; NORM_LABEL=off ;;
  *) NORM=true; NORM_LABEL=on ;;
esac

FADE=false
FADE_LABEL=off
FADE_MS=""
if [ "${CROSSFADE:-}" = true ]; then
  raw="${CROSSFADE_MS:-}"
  if ! [[ "$raw" =~ ^[0-9]+$ ]] || [ "$raw" -lt 1000 ]; then
    FADE_MS=2000
  elif [ "$raw" -gt 12000 ]; then
    FADE_MS=12000
  else
    FADE_MS="$raw"
  fi
  FADE=true
  FADE_LABEL="${FADE_MS}ms"
fi

STORES=0

is_managed() {
  case "$1" in
    "$KEY_NORMALIZE"=*|"$KEY_CROSSFADE"=*|"$KEY_CROSSFADE_TIME"=*) return 0 ;;
  esac
  return 1
}

merge_one() {
  local dest="$1"
  local dir tmp line
  dir=$(dirname "$dest")
  if ! mkdir -p "$dir"; then
    echo "SoloistConnect: engine_prefs: cannot create $dir" >&2
    return 1
  fi
  tmp="$dest.tmp.$$"
  {
    if [ -f "$dest" ]; then
      while IFS= read -r line || [ -n "$line" ]; do
        if is_managed "$line"; then
          continue
        fi
        printf '%s\n' "$line"
      done < "$dest"
    fi
    printf '%s\n' "$KEY_NORMALIZE=$NORM"
    printf '%s\n' "$KEY_CROSSFADE=$FADE"
    if [ "$FADE" = true ]; then
      printf '%s\n' "$KEY_CROSSFADE_TIME=$FADE_MS"
    fi
  } > "$tmp" || {
    rm -f "$tmp"
    echo "SoloistConnect: engine_prefs: cannot write $tmp" >&2
    return 1
  }
  if ! mv -f "$tmp" "$dest"; then
    rm -f "$tmp"
    echo "SoloistConnect: engine_prefs: cannot replace $dest" >&2
    return 1
  fi
  return 0
}

if merge_one "$DATA_DIR/settings/prefs"; then
  STORES=$((STORES + 1))
fi

USERS="$DATA_DIR/settings/Users"
if [ -d "$USERS" ]; then
  for user_dir in "$USERS"/*; do
    [ -d "$user_dir" ] || continue
    [ -f "$user_dir/prefs" ] || continue
    if merge_one "$user_dir/prefs"; then
      STORES=$((STORES + 1))
    fi
  done
fi

echo "SoloistConnect: engine_prefs loudness=$NORM_LABEL crossfade=$FADE_LABEL stores=$STORES" >&2
exit 0
