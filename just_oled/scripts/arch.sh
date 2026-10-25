#!/bin/bash
# The userland architecture the shipped binaries must match, printed as
# Debian names it: armhf, arm64 or amd64. Sourced by run.sh and install.sh.
#
# VOLUMIO_ARCH in /etc/os-release is the image's label, not the running
# ABI: the 32-bit Raspberry Pi image says "arm" under an aarch64 kernel,
# and uname -m answers for the kernel. dpkg knows the userland; LONG_BIT
# tells 32 from 64 where dpkg is missing; the label is the last resort.

userland_arch() {
  local dpkg_arch long_bit machine label
  dpkg_arch=$(dpkg --print-architecture 2>/dev/null || true)
  case "$dpkg_arch" in
    amd64 | arm64 | armhf) echo "$dpkg_arch"; return 0 ;;
  esac
  long_bit=$(getconf LONG_BIT 2>/dev/null || echo 0)
  machine=$(uname -m)
  if [ "$long_bit" = 64 ]; then
    case "$machine" in
      x86_64) echo amd64; return 0 ;;
      aarch64) echo arm64; return 0 ;;
    esac
  fi
  if [ "$long_bit" = 32 ]; then
    echo armhf
    return 0
  fi
  label=$(sed -n 's/^VOLUMIO_ARCH="\(.*\)"/\1/p' /etc/os-release 2>/dev/null | head -n1)
  case "$label" in
    x64 | amd64 | x86_64) echo amd64; return 0 ;;
    armv8 | arm64) echo arm64; return 0 ;;
    arm | armv7 | armhf) echo armhf; return 0 ;;
  esac
  case "$machine" in
    x86_64) echo amd64 ;;
    aarch64) echo arm64 ;;
    *) echo armhf ;;
  esac
}
