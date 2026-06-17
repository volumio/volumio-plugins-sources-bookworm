#!/bin/sh
# Paint the shutdown/reboot splash at the exact moment Volumio begins power off.
#
# Invoked as root (via sudo) from the plugin's onVolumioShutdown / onVolumioReboot
# hooks. Volumio calls those hooks and waits for them BEFORE running
# `systemctl poweroff` / `systemctl reboot`, so this is the one correct moment to
# take ownership of /dev/fb1.
#
# Canonical single owner of the shutdown splash for UI-initiated power off / reboot:
#   1. stop the compositor so it stops drawing UI frames over the splash
#   2. write the splash once (reusing the shared splash writer)
# The frame then stays on screen until power is cut (nothing else writes fb1).

FRAME="$1"
LOG="/data/.rdmlcd-shutdown.log"
SHOW="/usr/local/bin/rdmlcd-show-splash.sh"

log_msg() {
    _ts=$(date -Iseconds 2>/dev/null || date)
    echo "$_ts rdmlcd-shutdown-splash: $*" >> "$LOG" 2>/dev/null || true
}

case "$FRAME" in
    shutdown|reboot) ;;
    *)
        echo "Usage: rdmlcd-shutdown-splash.sh <shutdown|reboot>" >&2
        exit 1
        ;;
esac

log_msg "hook start frame=$FRAME"

# Stop the compositor first: while rdmlcd.service runs it rewrites fb1 every 20ms
# and would immediately overwrite the splash.
systemctl stop rdmlcd.service 2>/dev/null
log_msg "compositor stopped"

if [ ! -x "$SHOW" ]; then
    log_msg "splash writer missing: $SHOW"
    exit 1
fi

"$SHOW" "$FRAME"
log_msg "splash written rc=$?"

exit 0
