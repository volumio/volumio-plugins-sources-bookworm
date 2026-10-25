#!/bin/bash
# Runs the display daemon shipped for this machine: bin/<arch>/just-oled,
# where <arch> is the userland's Debian name (armhf, arm64, amd64), found as
# arch.sh says. Any arguments are passed on, so `scripts/run.sh --list` and
# `scripts/run.sh --probe` work too.

HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
# shellcheck source=arch.sh
. "$HERE/arch.sh"
ARCH=$(userland_arch)

BIN="$ROOT/bin/$ARCH/just-oled"
if [ ! -x "$BIN" ]; then
  echo "just-oled: no binary for architecture $ARCH under $ROOT/bin" >&2
  exit 126
fi
if ! "$BIN" --version >/dev/null 2>&1; then
  echo "just-oled: the binary for $ARCH does not run on this machine" >&2
  exit 126
fi

exec "$BIN" "$@"
