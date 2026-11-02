#!/bin/sh
# pi-screen-setup-root: the few things the Pi Screen Setup plugin needs root for,
# each a fixed verb with validated arguments. Installed to /usr/local/bin by
# install.sh (root-owned, so the volumio user cannot change what it is allowed to
# run) and named alone in /etc/sudoers.d/volumio-user-pi_screen_setup.
#
#   write-boot <name>        stdin -> /boot/<name>.txt, atomically; name is one of
#                            videoconfig config cmdline volumioconfig userconfig
#   remove-boot videoconfig  the plugin's own file removed (no other name)
#   clean-exit               the plugin's lines taken out of the boot files, the
#                            lines it stripped from Volumio's files put back (below),
#                            its pss-*.dtbo files removed from /boot/overlays and its
#                            pss-*.bin files from /lib/firmware/edid
#   install-overlay <name>   stdin -> /boot/overlays/<name>.dtbo, name ^pss-[a-z0-9-]+$,
#                            content a flattened device tree (magic d00dfeed)
#   remove-overlay <name>    that file removed
#   install-edid <name>      stdin -> /lib/firmware/edid/<name>.bin, name ^pss-[a-z0-9-]+$,
#                            content an EDID block (header 00ffffffffffff00)
#   remove-edid <name>       that file removed
#
# PSS_ROOT prefixes every path, for the test suite, which runs this script directly;
# sudo does not pass environment variables, so it has no effect through the sudoers entry.
set -eu

die() { echo "pi-screen-setup-root: $*" >&2; exit 2; }

ROOT="${PSS_ROOT:-}"
BOOT="$ROOT/boot"
OVERLAYS="$BOOT/overlays"
EDID="$ROOT/lib/firmware/edid"
STRIP="$ROOT/data/INTERNAL/pi_screen_setup/strip"
LIMIT=65536

# stdin -> $1, through a temporary file beside it (same filesystem, so the rename is
# atomic even on the FAT boot partition), capped, never empty unless $2 says so.
# $3 names what the content must be: text (no NUL byte), dtb or edid (that magic).
write_from_stdin() {
  target="$1"; allow_empty="${2:-no}"; kind="${3:-text}"
  dir=$(dirname "$target")
  [ -d "$dir" ] || die "no directory $dir"
  tmp=$(mktemp "$dir/.pss.XXXXXX")
  head -c "$LIMIT" > "$tmp"
  if [ "$(wc -c < "$tmp")" -ge "$LIMIT" ]; then rm -f "$tmp"; die "input larger than $LIMIT bytes"; fi
  if [ "$allow_empty" = no ] && [ ! -s "$tmp" ]; then rm -f "$tmp"; die "refusing to write an empty file to $target"; fi
  case "$kind" in
    text)
      if [ "$(tr -d '\000' < "$tmp" | wc -c)" -ne "$(wc -c < "$tmp")" ]; then rm -f "$tmp"; die "input holds a NUL byte"; fi ;;
    dtb)
      if [ "$(od -An -tx1 -N4 "$tmp" | tr -d ' \n')" != d00dfeed ]; then rm -f "$tmp"; die "input is not a flattened device tree"; fi ;;
    edid)
      if [ "$(od -An -tx1 -N8 "$tmp" | tr -d ' \n')" != 00ffffffffffff00 ]; then rm -f "$tmp"; die "input is not an EDID block"; fi ;;
  esac
  chmod 644 "$tmp"
  sync -f "$tmp" 2>/dev/null || sync
  mv -f "$tmp" "$target"
  sync -f "$target" 2>/dev/null || sync
}

check_name() {
  case "$1" in
    pss-*) ;;
    *) die "$2: name must start with pss-" ;;
  esac
  case "$1" in
    *[!a-z0-9-]*) die "$2: name may hold lower-case letters, digits and dashes only" ;;
  esac
}

case "${1:-}" in
  write-boot)
    name="${2:-}"
    case "$name" in
      videoconfig|config|cmdline|volumioconfig|userconfig) ;;
      *) die "write-boot: name must be videoconfig, config, cmdline, volumioconfig or userconfig" ;;
    esac
    allow_empty=no
    [ "$name" = userconfig ] && allow_empty=yes
    write_from_stdin "$BOOT/$name.txt" "$allow_empty"
    ;;

  remove-boot)
    [ "${2:-}" = videoconfig ] || die "remove-boot: only videoconfig"
    rm -f "$BOOT/videoconfig.txt"
    ;;

  clean-exit)
    # 1. the include line the plugin added to config.txt
    if [ -f "$BOOT/config.txt" ] && grep -q '^include videoconfig\.txt$' "$BOOT/config.txt"; then
      grep -v '^include videoconfig\.txt$' "$BOOT/config.txt" | write_from_stdin "$BOOT/config.txt"
      echo "config.txt: include line removed"
    fi
    # 2. the plugin's own file
    if [ -f "$BOOT/videoconfig.txt" ]; then
      rm -f "$BOOT/videoconfig.txt"
      echo "videoconfig.txt: removed"
    fi
    # 3. the lines stripped from Volumio's files, when the file is as the plugin left it
    for f in volumioconfig userconfig; do
      file="$BOOT/$f.txt"
      [ -f "$file" ] || continue
      if [ ! -f "$STRIP/$f.txt.original" ] || [ ! -f "$STRIP/$f.txt.sha256" ]; then
        # A release before 1.0 stripped without a record: say so when the file looks stripped.
        if [ "$f" = volumioconfig ] && ! grep -qE '^(dtoverlay=vc4-f?kms|hdmi_|display_auto_detect)' "$file"; then
          echo "NOTE: volumioconfig.txt holds no display lines and there is no record of what an earlier release removed; Volumio's next update rewrites the file"
        fi
        continue
      fi
      now=$(sha256sum "$file" | cut -d' ' -f1)
      if [ "$now" = "$(tr -d '\n' < "$STRIP/$f.txt.sha256")" ]; then
        allow_empty=no; [ "$f" = userconfig ] && allow_empty=yes
        write_from_stdin "$file" "$allow_empty" < "$STRIP/$f.txt.original"
        rm -f "$STRIP/$f.txt.original" "$STRIP/$f.txt.sha256"
        echo "$f.txt: the lines the plugin removed are back"
      else
        echo "WARNING: $f.txt changed since the plugin stripped it; left as it is. The original is kept at $STRIP/$f.txt.original"
      fi
    done
    # 4. the rotation and EDID tokens the plugin adds to cmdline.txt
    if [ -f "$BOOT/cmdline.txt" ]; then
      cleaned=$(sed -E 's/ video=[^ ]*//g; s/ plymouth=[0-9]+//g; s/ fbcon=rotate:[0-3]//g; s/ drm\.edid_firmware=[^ ]*//g' "$BOOT/cmdline.txt")
      if [ "$cleaned" != "$(cat "$BOOT/cmdline.txt")" ]; then
        printf '%s\n' "$cleaned" | write_from_stdin "$BOOT/cmdline.txt"
        echo "cmdline.txt: plugin parameters removed"
      fi
    fi
    # 5. the vendor overlay files the plugin installed, ours by prefix
    n=0
    for f in "$OVERLAYS"/pss-*.dtbo; do
      [ -f "$f" ] || continue
      rm -f "$f"; n=$((n + 1))
    done
    [ "$n" -eq 0 ] || echo "overlays: $n plugin-installed file(s) removed"
    # 6. the EDID files the plugin generated
    n=0
    for f in "$EDID"/pss-*.bin; do
      [ -f "$f" ] || continue
      rm -f "$f"; n=$((n + 1))
    done
    [ "$n" -eq 0 ] || echo "edid: $n plugin-generated file(s) removed"
    ;;

  install-overlay)
    name="${2:-}"; check_name "$name" install-overlay
    [ -d "$OVERLAYS" ] || die "install-overlay: no $OVERLAYS"
    write_from_stdin "$OVERLAYS/$name.dtbo" no dtb
    ;;

  remove-overlay)
    name="${2:-}"; check_name "$name" remove-overlay
    rm -f "$OVERLAYS/$name.dtbo"
    ;;

  install-edid)
    name="${2:-}"; check_name "$name" install-edid
    mkdir -p "$EDID"
    write_from_stdin "$EDID/$name.bin" no edid
    ;;

  remove-edid)
    name="${2:-}"; check_name "$name" remove-edid
    rm -f "$EDID/$name.bin"
    ;;

  *)
    die "verbs: write-boot <name>, remove-boot videoconfig, clean-exit, install-overlay <name>, remove-overlay <name>, install-edid <name>, remove-edid <name>"
    ;;
esac
