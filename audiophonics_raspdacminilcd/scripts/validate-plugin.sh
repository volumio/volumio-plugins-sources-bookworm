#!/bin/sh
# Pre-release validation (run on build host only — NOT installed on device).
# Catches trivial errors before packaging the plugin.

set -e

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0

fail() {
    echo "VALIDATE FAIL: $1" >&2
    FAIL=1
}

pass() {
    echo "VALIDATE OK: $1"
}

echo "=== RaspDacMini plugin validation ==="

# JavaScript syntax
if command -v node >/dev/null 2>&1; then
    for js in index.js compositor/index.js compositor/utils/volumiolistener.js; do
        if node --check "$js" 2>/dev/null; then
            pass "syntax $js"
        else
            fail "syntax $js"
        fi
    done
else
    echo "VALIDATE SKIP: node not available (JS syntax not checked)"
fi

# Shell scripts
for sh in install.sh uninstall.sh scripts/*.sh; do
    if sh -n "$sh" 2>/dev/null; then
        pass "shell $sh"
    else
        fail "shell $sh"
    fi
done

# Splash assets (architecture-independent, must ship complete)
SPLASH_SIZE=153600
for frame in boot starting shutdown reboot; do
    raw="assets/splash/${frame}.raw"
    if [ ! -f "$raw" ]; then
        fail "missing $raw"
        continue
    fi
    size=$(wc -c < "$raw" | tr -d ' ')
    if [ "$size" != "$SPLASH_SIZE" ]; then
        fail "$raw size $size (expected $SPLASH_SIZE)"
    else
        pass "$raw ($size bytes)"
    fi
done

if [ ! -f assets/splash/volumio-logo.png ]; then
    fail "missing assets/splash/volumio-logo.png"
else
    pass "assets/splash/volumio-logo.png"
fi

# Boot splash service must show boot frame only (not starting)
if grep -q 'rdmlcd-show-splash.sh boot' compositor/service/rdmlcd-splash.service 2>/dev/null; then
    pass "rdmlcd-splash.service uses boot frame"
else
    fail "rdmlcd-splash.service must ExecStart rdmlcd-show-splash.sh boot"
fi

if grep -q 'rdmlcd-show-splash.sh starting' compositor/service/rdmlcd-splash.service 2>/dev/null; then
    fail "rdmlcd-splash.service must not use starting frame"
fi

# dev-fb1.device never activates on Volumio/Pi despite /dev/fb1 existing — use ExecStartPre only
if grep -q 'dev-fb1\.device' compositor/service/rdmlcd-splash.service 2>/dev/null; then
    fail "rdmlcd-splash.service must not use dev-fb1.device (wait on /dev/fb1 in ExecStartPre)"
else
    pass "rdmlcd-splash.service does not depend on dev-fb1.device"
fi

if ! grep -q 'TimeoutStartSec=30' compositor/service/rdmlcd-splash.service 2>/dev/null; then
    fail "rdmlcd-splash.service must set TimeoutStartSec=30"
else
    pass "rdmlcd-splash.service TimeoutStartSec"
fi

# Plugin sync must not write starting splash (compositor owns Starting phase)
if grep -q 'rdmlcd-show-splash.sh starting' scripts/rdmlcd-plugin-services.sh 2>/dev/null; then
    fail "rdmlcd-plugin-services.sh must not call show-splash starting"
else
    pass "rdmlcd-plugin-services.sh does not write starting splash"
fi

# Compositor early splash must use starting.raw only
if grep -q 'starting\.raw' compositor/index.js 2>/dev/null; then
    pass "compositor early splash uses starting.raw"
else
    fail "compositor/index.js must paint starting.raw at compositor load"
fi

if grep -q 'boot\.raw' compositor/index.js 2>/dev/null; then
    fail "compositor must not write boot.raw (boot service owns Booting phase)"
fi

if ! grep -q 'first-frame-written' compositor/index.js 2>/dev/null; then
    fail "compositor must log first-frame-written after initial UI paint"
else
    pass "compositor first-frame-written log"
fi

if ! grep -q 'loop-start' compositor/index.js 2>/dev/null; then
    fail "compositor must log loop-start when UI interval begins"
else
    pass "compositor display loop-start log"
fi

# UI handoff must be gated on backend readiness (/status), not first pushState
if grep -q 'uiReady' compositor/index.js 2>/dev/null && grep -q '/status' compositor/index.js 2>/dev/null; then
    pass "compositor gates UI on backend /status readiness"
else
    fail "compositor must hold Starting splash until backend /status=ready"
fi

if grep -q 'if(bufwrite_interval) updateFB' compositor/index.js 2>/dev/null; then
    fail "compositor must not gate updateFB on bufwrite_interval in ready handler"
fi

# Shutdown splash must NOT activate at boot
if grep -q 'WantedBy=multi-user.target' compositor/service/rdmlcd-shutdown.service 2>/dev/null; then
    fail "rdmlcd-shutdown.service must not use WantedBy=multi-user.target"
else
    pass "rdmlcd-shutdown.service install target"
fi

if ! grep -q 'WantedBy=shutdown.target' compositor/service/rdmlcd-shutdown.service 2>/dev/null; then
    fail "rdmlcd-shutdown.service must WantedBy shutdown.target"
else
    pass "rdmlcd-shutdown.service shutdown.target"
fi

# Shutdown/reboot splash: canonical owner is the plugin's Volumio hooks
if grep -q 'onVolumioShutdown' index.js 2>/dev/null && grep -q 'onVolumioReboot' index.js 2>/dev/null; then
    pass "plugin implements onVolumioShutdown/onVolumioReboot hooks"
else
    fail "plugin must implement onVolumioShutdown and onVolumioReboot"
fi

if [ -f scripts/rdmlcd-shutdown-splash.sh ]; then
    pass "scripts/rdmlcd-shutdown-splash.sh present"
else
    fail "missing scripts/rdmlcd-shutdown-splash.sh"
fi

# Shutdown splash helper must stop the compositor before painting (single owner)
if grep -q 'stop rdmlcd.service' scripts/rdmlcd-shutdown-splash.sh 2>/dev/null; then
    pass "shutdown-splash helper stops compositor first"
else
    fail "rdmlcd-shutdown-splash.sh must stop rdmlcd.service before painting"
fi

# Shutdown splash helper must reuse the shared splash writer (no duplicate write path)
if grep -q 'rdmlcd-show-splash.sh' scripts/rdmlcd-shutdown-splash.sh 2>/dev/null; then
    pass "shutdown-splash helper reuses rdmlcd-show-splash.sh"
else
    fail "rdmlcd-shutdown-splash.sh must reuse rdmlcd-show-splash.sh writer"
fi

# Compositor must NOT paint shutdown splash on SIGINT (retired duplicate painter)
if grep -q 'printShutDownAndDie(false)' compositor/index.js 2>/dev/null; then
    fail "compositor SIGINT must not call printShutDownAndDie (hook owns shutdown splash)"
else
    pass "compositor SIGINT does not repaint shutdown splash"
fi

if grep -q 'handleStopSignal' compositor/index.js 2>/dev/null; then
    pass "compositor uses clean stop-signal handler"
else
    fail "compositor must use clean SIGINT/SIGTERM handler"
fi

# install.sh must install helper and authorize it via sudoers
if grep -q 'rdmlcd-shutdown-splash.sh' install.sh 2>/dev/null; then
    pass "install.sh installs shutdown-splash helper + sudoers"
else
    fail "install.sh must install and authorize rdmlcd-shutdown-splash.sh"
fi

# Plymouth splash painters must be masked on install and restored on uninstall
if grep -q 'systemctl mask' install.sh 2>/dev/null && grep -q 'plymouth-poweroff.service' install.sh 2>/dev/null && grep -q 'plymouth-start.service' install.sh 2>/dev/null; then
    pass "install.sh masks plymouth splash painters"
else
    fail "install.sh must mask plymouth splash painters (start/poweroff/reboot/halt/kexec)"
fi

if grep -q 'systemctl unmask' uninstall.sh 2>/dev/null && grep -q 'plymouth-poweroff.service' uninstall.sh 2>/dev/null && grep -q 'plymouth-start.service' uninstall.sh 2>/dev/null; then
    pass "uninstall.sh restores plymouth splash painters"
else
    fail "uninstall.sh must unmask plymouth splash painters"
fi

# Must not mask plymouth infrastructure units (boot ordering / initramfs handoff)
for infra in plymouth-quit-wait.service plymouth-read-write.service plymouth-switch-root.service; do
    if grep -q "mask .*$infra" install.sh 2>/dev/null; then
        fail "install.sh must NOT mask infrastructure unit $infra"
    fi
done
pass "install.sh leaves plymouth infrastructure units intact"

# Install must be able to compile if the prebuilt is missing/unextractable:
# the compile path must install the build toolchain (else node-gyp: "not found: make")
if grep -q 'Ensuring build toolchain' install.sh 2>/dev/null && grep -q 'build-essential' install.sh 2>/dev/null; then
    pass "install.sh compile fallback installs build toolchain"
else
    fail "install.sh compile fallback must install build-essential (node-gyp needs make)"
fi

# Prebuilt must be staged via a clean temp dir (avoids tar directory-over-directory error)
if grep -q 'PREBUILT_TMP' install.sh 2>/dev/null; then
    pass "install.sh stages prebuilt via clean temp dir"
else
    fail "install.sh must extract prebuilt into a clean temp dir before merging"
fi

# Compositor must not use path before require
if head -25 compositor/index.js | grep -q 'require("path")'; then
    pass "compositor/index.js path require order"
else
    fail "compositor/index.js must require path before SPLASH_DIR"
fi

# Native module source present
if [ ! -f native/rgb565/rgb565.cpp ]; then
    fail "missing native/rgb565/rgb565.cpp"
else
    pass "native rgb565 source"
fi

# Service templates present
for unit in rdmlcd.service rdmlcd-splash.service rdmlcd-shutdown.service; do
    if [ -f "compositor/service/$unit" ]; then
        pass "compositor/service/$unit"
    else
        fail "missing compositor/service/$unit"
    fi
done

echo "=== Validation complete ==="
if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
exit 0
