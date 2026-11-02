#!/bin/sh
# display-configuration-root: the few things the Display Configuration plugin needs
# root for, each a fixed verb with validated arguments. Installed to
# /usr/local/bin by install.sh (root-owned, so the volumio user cannot change what
# it is allowed to run) and named in /etc/sudoers.d/volumio-user-display_configuration.
#
#   xauth                         the X server's cookie into /home/volumio/.Xauthority
#   xorg-conf write <name>        stdin -> /etc/X11/xorg.conf.d/9x-display-configuration-<name>.conf
#   xorg-conf remove <name>       that file removed
#   fbcon <0-3>                   the console turned now (rotate_all)
#   backlight <device> <value>    /sys/class/backlight/<device>/brightness
#   kiosk <start|stop|restart|is-active>   volumio-kiosk.service
set -eu

die() { echo "display-configuration-root: $*" >&2; exit 2; }

XORG_DIR=/etc/X11/xorg.conf.d
VOLUMIO_HOME=/home/volumio

case "${1:-}" in
  xauth)
    # xinit starts the server with "-auth <file>"; that file holds the cookie.
    auth=""
    for pid in $(pidof Xorg X 2>/dev/null || true); do
      args=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null || true)
      a=$(printf '%s\n' "$args" | awk 'p{print; exit} $0=="-auth"{p=1}')
      if [ -n "$a" ] && [ -r "$a" ]; then auth="$a"; break; fi
    done
    [ -n "$auth" ] || auth=/root/.Xauthority
    [ -r "$auth" ] || die "no X authority file found"
    install -o volumio -g volumio -m 600 "$auth" "$VOLUMIO_HOME/.Xauthority"
    ;;

  xorg-conf)
    sub="${2:-}"; name="${3:-}"
    case "$name" in
      touch) file="$XORG_DIR/95-display-configuration-touch.conf" ;;
      resolution) file="$XORG_DIR/90-display-configuration-resolution.conf" ;;
      *) die "xorg-conf: name must be touch or resolution" ;;
    esac
    case "$sub" in
      write)
        mkdir -p "$XORG_DIR"
        tmp=$(mktemp "$XORG_DIR/.dc.XXXXXX")
        head -c 16384 > "$tmp"
        # Only the lines an InputClass or Monitor/Screen section is made of.
        if grep -nvE '^[[:space:]]*(#.*|Section "(InputClass|Monitor|Screen|Device)"|EndSection|SubSection "Display"|EndSubSection|Identifier[[:space:]].*|Monitor[[:space:]].*|Driver[[:space:]].*|Match(Product|IsTouchscreen|IsPointer|IsTablet|Vendor|Devicepath)[[:space:]].*|Option[[:space:]].*|HorizSync[[:space:]].*|VertRefresh[[:space:]].*|DefaultDepth[[:space:]].*|Depth[[:space:]].*|Modes[[:space:]].*)?[[:space:]]*$' "$tmp" >/dev/null; then
          rm -f "$tmp"; die "xorg-conf: refused a line that is not part of a Monitor, Screen or InputClass section"
        fi
        chmod 644 "$tmp"; mv -f "$tmp" "$file"
        ;;
      remove) rm -f "$file" ;;
      *) die "xorg-conf: write or remove" ;;
    esac
    ;;

  fbcon)
    v="${2:-}"
    case "$v" in 0|1|2|3) ;; *) die "fbcon: value must be 0, 1, 2 or 3" ;; esac
    [ -w /sys/class/graphics/fbcon/rotate_all ] || die "fbcon: no rotate_all on this kernel"
    echo "$v" > /sys/class/graphics/fbcon/rotate_all
    ;;

  backlight)
    dev="${2:-}"; v="${3:-}"
    case "$dev" in *[!A-Za-z0-9_.-]*|"") die "backlight: bad device name" ;; esac
    case "$v" in *[!0-9]*|"") die "backlight: value must be an integer" ;; esac
    d="/sys/class/backlight/$dev"
    [ -f "$d/max_brightness" ] || die "backlight: no such device"
    max=$(cat "$d/max_brightness")
    [ "$v" -le "$max" ] || die "backlight: value above $max"
    echo "$v" > "$d/brightness"
    ;;

  kiosk)
    case "${2:-}" in
      start|stop|restart|is-active) systemctl "$2" volumio-kiosk.service ;;
      *) die "kiosk: start, stop, restart or is-active" ;;
    esac
    ;;

  *) die "usage: xauth | xorg-conf write|remove touch|resolution | fbcon N | backlight DEV VALUE | kiosk VERB" ;;
esac
