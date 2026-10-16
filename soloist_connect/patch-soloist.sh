#!/bin/bash
# ELF-patches a soloist binary to use the sideloaded glibc directly
# (interpreter + rpath), instead of launching it through an explicit
# "ld-linux --library-path" invocation.
#
# Why this matters: Soloist re-executes itself to spawn subprocesses
# (crashpad handler, and Chromium-style "--type=..." children). When the
# process was started via an explicit loader, the self-exec resolves to the
# LOADER, not the soloist binary, so every subprocess spawn fails with
# "ld-linux: unrecognized option '--type=...'" - and playback aborts
# immediately (instant play->pause at a frozen position).
#
# Usage: patch-soloist.sh [path-to-binary]
# Default: /data/soloist/bin/soloist
set -e

BIN="${1:-/data/soloist/bin/soloist}"
SYSROOT="/data/soloist/sysroot"
PATCHELF="${PATCHELF:-/usr/bin/patchelf}"
command -v "$PATCHELF" >/dev/null 2>&1 || PATCHELF="$(command -v patchelf || true)"

if [ ! -f "$BIN" ]; then
  echo "patch-soloist: binary not found at $BIN" >&2
  exit 1
fi

if [ ! -d "$SYSROOT" ]; then
  echo "patch-soloist: no sysroot present (system glibc in use); nothing to patch."
  exit 0
fi

if [ -z "$PATCHELF" ] || [ ! -x "$PATCHELF" ]; then
  echo "patch-soloist: patchelf is not installed" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ARCH="$("$HERE/detect-arch.sh")"
case "$ARCH" in
  amd64) TRIPLET="x86_64-linux-gnu"; LOADER_NAME="ld-linux-x86-64.so.2" ;;
  arm64) TRIPLET="aarch64-linux-gnu"; LOADER_NAME="ld-linux-aarch64.so.1" ;;
  armhf) TRIPLET="arm-linux-gnueabihf"; LOADER_NAME="ld-linux-armhf.so.3" ;;
  *) echo "patch-soloist: unsupported architecture $ARCH" >&2; exit 1 ;;
esac

# Must match the binary's userspace arch. A leftover aarch64 sysroot from
# an older uname -m install plus a new armhf Soloist is why launch then
# reports "not ELF-patched" (or patches with the wrong loader).
LOADER=$(find "$SYSROOT" -name "$LOADER_NAME" 2>/dev/null | head -n 1)
if [ -z "$LOADER" ]; then
  echo "patch-soloist: $LOADER_NAME not in $SYSROOT (userspace $ARCH)." >&2
  echo "patch-soloist: sysroot is the wrong architecture or incomplete." >&2
  echo "patch-soloist: run: sudo /bin/bash $HERE/setup-glibc.sh" >&2
  exit 1
fi

LIBPATH="$SYSROOT/lib/$TRIPLET:$SYSROOT/usr/lib/$TRIPLET:$SYSROOT/lib:$SYSROOT/usr/lib"

# --force-rpath: use RPATH (not RUNPATH) so the sideloaded libs win for the
# whole dependency tree, matching what --library-path used to do.
"$PATCHELF" --set-interpreter "$LOADER" --force-rpath --set-rpath "$LIBPATH" "$BIN"

echo "patch-soloist: patched $BIN"
echo "  interpreter: $("$PATCHELF" --print-interpreter "$BIN")"
echo "  rpath:       $("$PATCHELF" --print-rpath "$BIN")"
