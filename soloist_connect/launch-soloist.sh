#!/bin/bash
# Launcher for the Soloist daemon on Volumio 4.
# Reads settings from /data/soloist/soloist.env (written by the plugin).
# Routes audio through the in-tree Pulse shim (libpulse.so.0) onto pcm.volumio.
# Environment names APULSE_* are historical; the launcher still exports them.
# Handles the glibc sideload when the system glibc is older than Soloist.
set -e

ENV_FILE="/data/soloist/soloist.env"
PLUGIN_DIR="/data/plugins/music_service/soloist_connect"
BIN="/data/soloist/bin/soloist"
if [ ! -x "$BIN" ]; then
  BIN="$PLUGIN_DIR/bin/soloist"
fi
SYSROOT="/data/soloist/sysroot"
PATCHELF="/usr/bin/patchelf"
[ -x "$PATCHELF" ] || PATCHELF="$(command -v patchelf || true)"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE - save the plugin settings in Volumio first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "$API_KEY" ]; then
  echo "API_KEY is empty - set it in the plugin settings." >&2
  exit 1
fi

# Do not put the sideloaded glibc on LD_LIBRARY_PATH in this shell.
# On a 64-bit Pi that briefly had an armhf sysroot, bash/patchelf then
# load 32-bit libc and die ("symbol lookup error ... libc.so.6").
unset LD_LIBRARY_PATH

APULSE_ARCH="$("$PLUGIN_DIR/detect-arch.sh")"
APULSE_DIR="$PLUGIN_DIR/alsa-lib/$APULSE_ARCH"

# Diagnostic override. APULSE_DIR_OVERRIDE points the daemon at a different
# shim build, used without installing it into the plugin payload.
#
# It has to be an explicit variable: this script unsets LD_LIBRARY_PATH above,
# to keep the sideloaded 32-bit glibc away from bash and patchelf, and then sets
# it again on the exec line. Anything the caller exports is discarded in
# between, so passing LD_LIBRARY_PATH on the command line silently has no
# effect and the payload shim runs instead. That cost a capture.
if [ -n "${APULSE_DIR_OVERRIDE:-}" ]; then
  if [ ! -f "$APULSE_DIR_OVERRIDE/libpulse.so.0" ]; then
    echo "APULSE_DIR_OVERRIDE=$APULSE_DIR_OVERRIDE has no libpulse.so.0" >&2
    exit 1
  fi
  APULSE_DIR="$APULSE_DIR_OVERRIDE"
  echo "SoloistConnect: USING OVERRIDE SHIM $APULSE_DIR (diagnostic build)" >&2
fi

if [ ! -f "$APULSE_DIR/libpulse.so.0" ]; then
  echo "Pulse shim missing at $APULSE_DIR (userspace $APULSE_ARCH, uname=$(uname -m))." >&2
  exit 1
fi

# pcm.volumio includes softvolume. LocalPlayback does not: it aborted
# in snd1_pcm_hw_param_get_min and left the DAC at full scale.
if [ -n "${PLAYBACK_DEVICE:-}" ]; then
  export APULSE_PLAYBACK_DEVICE="$PLAYBACK_DEVICE"
else
  export APULSE_PLAYBACK_DEVICE="${APULSE_PLAYBACK_DEVICE:-plug:volumio}"
fi
# One-shot close. Cork does not free the device; unsetVolatile/stop create
# this file and the shim closes on it, then unlinks.
export APULSE_YIELD_PATH="${APULSE_YIELD_PATH:-/data/soloist/alsa.yield}"
# Caps the buffer the shim requests, and the Pulse latency it
# reports. volumioswitch delay is local + target and can sit at ~1.5 s
# even when the slider has already shrunk the hardware PCM. Unset or 0
# on an old env file would leave that uncapped.
case "${TLENGTH_MS:-}" in
  ''|0|*[!0-9]*) TLENGTH_MS=500 ;;
esac
export APULSE_MAX_TLENGTH_MS="$TLENGTH_MS"
# SoftMaster (or a hardware mixer) is the attenuator. Pulse sink-input
# volume still tracks the Connect slider; the shim must not multiply
# samples or peppyalsa sees the knob. Mixer type None leaves this unset
# so the shim remains the only gain.
if [ "${EXTERNAL_VOLUME:-}" = "true" ]; then
  export APULSE_EXTERNAL_VOLUME=1
else
  unset APULSE_EXTERNAL_VOLUME
fi
# Integer dB only. A generic [0-9]* case treats "-6" as invalid because of
# the leading minus, so the list is explicit. Missing or 0 leaves the
# stream unscaled; SoftMaster remains the volume knob.
TRIM=0
case "${OUTPUT_TRIM_DB:-}" in
  -12|-11|-10|-9|-8|-7|-6|-5|-4|-3|-2|-1|1|2|3|4|5|6|7|8|9|10|11|12)
    TRIM="$OUTPUT_TRIM_DB"
    ;;
esac
if [ "$TRIM" != 0 ]; then
  export APULSE_OUTPUT_TRIM_DB="$TRIM"
else
  unset APULSE_OUTPUT_TRIM_DB
fi
unset PULSE_SERVER
unset PIPEWIRE_RUNTIME_DIR

# Verbose Logging in the plugin settings. Turns on the diagnostics in the
# shim. APULSE_DIAG is read once; when it is unset the shim stays quiet,
# so setting this changes no behaviour, only what is written to stderr.
#
# It has to be set here rather than exported by the caller, for the same reason
# as APULSE_DIR_OVERRIDE above: this script unsets and rebuilds the environment
# before the exec line, so anything inherited is discarded in between.
#
# What it makes visible, none of which reaches the journal without it:
#
#   pcm unrecovered (N), reopening   the shim gave up on recover/prepare and
#                                    is closing and reopening the device
#   writei failed (N), reopening     a write failed outside the avail path
#   1s wake=.. wr=.. xrun=..         per-second write-loop counters
#   connect / release / reacquire    device lifecycle and negotiated params
#
# Without those, an ALSA fault shows only as the SNDERR line emitted by
# volumioswitch itself, with no record of what the shim did about it.
if [ "${VERBOSE_LOGGING:-}" = "true" ]; then
  export APULSE_DIAG=1
else
  unset APULSE_DIAG
fi

# Crashpad leaves lock files behind when the daemon does not exit cleanly, and
# the next start cannot take them:
#
#   ERROR file_io_posix.cc:153] open /data/soloist/data/crashpad/pending/
#   <uuid>.lock: File exists (17)
#
# Two of those at every start, from a process that no longer exists. We stop
# the daemon on yield, on plugin stop and on restart, so this is routine rather
# than a sign of a crash. Clear them; a genuine pending report is a .dmp, which
# is left alone.
rm -f /data/soloist/data/crashpad/pending/*.lock 2>/dev/null || true

# Always. A pasted journal has to name the plugin and the .so that ran,
# including when Verbose logging is off. package.json / SOURCE.md are the
# shipped labels; SOURCE_REVISION is the git that built the library in
# APULSE_DIR (the override dir when APULSE_DIR_OVERRIDE is set).
PLUGIN_VER=unknown
if [ -f "$PLUGIN_DIR/package.json" ]; then
  PLUGIN_VER=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_DIR/package.json" | head -n 1)
  [ -n "$PLUGIN_VER" ] || PLUGIN_VER=unknown
fi
SHIM_VER=unknown
if [ -f "$PLUGIN_DIR/alsa-lib/SOURCE.md" ]; then
  SHIM_VER=$(sed -n 's/.*Library version is \*\*\([^*]*\)\*\*.*/\1/p' "$PLUGIN_DIR/alsa-lib/SOURCE.md" | head -n 1)
  [ -n "$SHIM_VER" ] || SHIM_VER=unknown
fi
SHIM_REV=missing
if [ -f "$APULSE_DIR/SOURCE_REVISION" ]; then
  SHIM_REV=$(tr -d '[:space:]' < "$APULSE_DIR/SOURCE_REVISION")
  [ -n "$SHIM_REV" ] || SHIM_REV=missing
fi

echo "SoloistConnect: plugin=$PLUGIN_VER shim=$SHIM_VER rev=$SHIM_REV userspace=$APULSE_ARCH device=$APULSE_PLAYBACK_DEVICE tlength_cap=${APULSE_MAX_TLENGTH_MS}ms external_volume=${EXTERNAL_VOLUME:-false} trim=${OUTPUT_TRIM_DB:-0}dB diag=${APULSE_DIAG:-off} uname=$(uname -m)" >&2

# Engine prefs, startup only. Failure here must not block exec.
bash "$PLUGIN_DIR/apply-engine-prefs.sh" || true

# writeEnvFile() always emits API_KEY, DEVICE_NAME, INITIAL_VOLUME,
# CACHE_SIZE and EXTERNAL_VOLUME, and validates them before writing.
#
# Soloist has no --api-key-file and no env. The real key has to be on argv
# at exec. The shim overwrites that slot two seconds after load (and on
# the first pa_* call) so `ps` and logsubmit see SHIM_API_KEY_DECOY, not
# the secret. Drop API_KEY from the inherited environment so
# /proc/PID/environ is clean too.
ARGS=(
  --device-name "$DEVICE_NAME"
  --api-key "$API_KEY"
  --data-dir /data/soloist/data
  --cache-dir /data/soloist/cache
  --ws 127.0.0.1:9878
  --initial-volume "$INITIAL_VOLUME"
  --cache-size "$CACHE_SIZE"
)
# No --verbose here. Soloist has no such option: it prints
# "unrecognized option '--verbose'" and carries on, so the setting produced
# nothing. Verbose logging is now every WebSocket event, logged by the plugin
# from the connection it already holds, which is what `soloist ctl trace`
# would show.

if [ -d "$SYSROOT" ]; then
  INTERP=$("$PATCHELF" --print-interpreter "$BIN" 2>/dev/null || true)
  echo "SoloistConnect: interpreter=${INTERP:-unknown}" >&2
  case "$INTERP" in
    "$SYSROOT"*)
      ;;
    *)
      if [ -w "$BIN" ]; then
        echo "SoloistConnect: binary not patched; trying patch-soloist.sh" >&2
        bash "$PLUGIN_DIR/patch-soloist.sh" "$BIN"
        INTERP=$("$PATCHELF" --print-interpreter "$BIN" 2>/dev/null || true)
      fi
      case "$INTERP" in
        "$SYSROOT"*)
          ;;
        *)
          echo "soloist binary is not ELF-patched against $SYSROOT." >&2
          echo "interpreter was: ${INTERP:-unknown}" >&2
          echo "Run: sudo /bin/bash $PLUGIN_DIR/download-soloist.sh" >&2
          exit 1
          ;;
      esac
      ;;
  esac
fi

# Shim directory only. Soloist's RPATH already points at the sideloaded glibc.
# Putting sysroot on LD_LIBRARY_PATH here would poison nothing (we exec),
# but keep it off so a mistaken wrapper cannot break 64-bit helpers.
exec env -u API_KEY LD_LIBRARY_PATH="$APULSE_DIR" \
  "$BIN" "${ARGS[@]}"
