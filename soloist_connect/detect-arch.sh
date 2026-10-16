#!/bin/bash
# Userspace arch for Soloist + the Pulse shim.
#
# VOLUMIO_ARCH is an image label, not the running ABI. Official 32-bit Pi
# images set VOLUMIO_ARCH=arm even when the kernel is aarch64 (uname -m
# from a 32-bit process is armv7l). 64-bit Pi 5 images still sometimes
# leave VOLUMIO_ARCH=arm in os-release while bash/dpkg are aarch64.
# Trust dpkg / LONG_BIT first.
#
# Prints: armhf | arm64 | amd64
set -e

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi

LONG_BIT="$(getconf LONG_BIT 2>/dev/null || echo 0)"
DPKG_ARCH="$(dpkg --print-architecture 2>/dev/null || true)"
UNAME="$(uname -m)"

case "$DPKG_ARCH" in
  amd64) echo amd64; exit 0 ;;
  arm64) echo arm64; exit 0 ;;
  armhf) echo armhf; exit 0 ;;
esac

if [ "$LONG_BIT" = 64 ]; then
  case "$UNAME" in
    x86_64) echo amd64; exit 0 ;;
    aarch64) echo arm64; exit 0 ;;
  esac
fi

if [ "$LONG_BIT" = 32 ]; then
  echo armhf
  exit 0
fi

case "${VOLUMIO_ARCH:-}" in
  x64|amd64|x86_64) echo amd64; exit 0 ;;
  armv8) echo arm64; exit 0 ;;
  arm|armv7) echo armhf; exit 0 ;;
esac

case "$UNAME" in
  x86_64) echo amd64 ;;
  aarch64) echo arm64 ;;
  *) echo armhf ;;
esac
