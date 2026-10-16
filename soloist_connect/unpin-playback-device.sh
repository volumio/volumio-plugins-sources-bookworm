#!/bin/bash
# Remove a leftover systemd pin of APULSE_PLAYBACK_DEVICE so the env file
# PLAYBACK_DEVICE (written by the plugin) is what the launcher uses.
set -e

if [ "$(id -u)" != "0" ]; then
  exec sudo -E bash "$0" "$@"
fi

UNIT=/etc/systemd/system/soloist.service
if [ ! -f "$UNIT" ]; then
  exit 0
fi
if ! grep -q '^Environment=APULSE_PLAYBACK_DEVICE=' "$UNIT"; then
  exit 0
fi

tmp=$(mktemp)
# Filter with shell builtins, not sed. This rewrites a file under
# /etc/systemd/system as root, which is exactly the class of edit that must not
# be delegated to an in-place stream editor on a deployed system: a bad pattern
# or a partial write leaves an unbootable unit. Read every line, drop the one
# match, write the rest verbatim.
#
# read returns non-zero at EOF without a terminating newline, leaving the
# partial line in $line. The remainder is handled after the loop so a unit that
# lacks a final newline is reproduced byte for byte rather than gaining one.
line=""
while IFS= read -r line; do
  case "$line" in
    'Environment=APULSE_PLAYBACK_DEVICE='*) continue ;;
  esac
  printf '%s\n' "$line"
done < "$UNIT" > "$tmp"
if [ -n "$line" ]; then
  case "$line" in
    'Environment=APULSE_PLAYBACK_DEVICE='*) ;;
    *) printf '%s' "$line" >> "$tmp" ;;
  esac
fi
mv "$tmp" "$UNIT"
chmod 644 "$UNIT"
systemctl daemon-reload
