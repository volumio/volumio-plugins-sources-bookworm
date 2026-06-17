#!/bin/sh
# Load or unload the RaspDacMini LCD device tree overlay at runtime.

OVERLAY_NAME="raspdac-mini-lcd"
DTBO="/boot/overlays/${OVERLAY_NAME}.dtbo"
FB="/dev/fb1"
MAX_WAIT=20

overlay_loaded() {
    dtoverlay -l 2>/dev/null | grep -q "$OVERLAY_NAME"
}

wait_for_fb() {
    _i=0
    while [ "$_i" -lt "$MAX_WAIT" ]; do
        if [ -e "$FB" ]; then
            return 0
        fi
        sleep 1
        _i=$((_i + 1))
    done
    return 1
}

case "$1" in
load)
    if [ -e "$FB" ]; then
        echo "Framebuffer already present: $FB"
        exit 0
    fi

    if ! [ -f "$DTBO" ]; then
        echo "Device tree overlay not installed: $DTBO" >&2
        exit 1
    fi

    if overlay_loaded; then
        echo "Overlay already loaded, waiting for $FB"
        if wait_for_fb; then
            exit 0
        fi
        echo "Overlay loaded but $FB did not appear" >&2
        exit 1
    fi

    echo "Loading overlay: $OVERLAY_NAME"
    if ! dtoverlay "$OVERLAY_NAME"; then
        echo "Failed to load overlay: $OVERLAY_NAME" >&2
        exit 1
    fi

    if wait_for_fb; then
        echo "Overlay loaded, $FB ready"
        exit 0
    fi

    echo "Overlay loaded but $FB did not appear within ${MAX_WAIT}s" >&2
    exit 1
    ;;

unload)
    if overlay_loaded; then
        echo "Removing overlay: $OVERLAY_NAME"
        dtoverlay -r "$OVERLAY_NAME" 2>/dev/null || true
    fi
    exit 0
    ;;

status)
    if [ -e "$FB" ]; then
        echo "ready"
        exit 0
    fi
    if overlay_loaded; then
        echo "overlay-loaded"
        exit 2
    fi
    echo "not-loaded"
    exit 1
    ;;

*)
    echo "Usage: rdmlcd-overlay.sh load|unload|status" >&2
    exit 1
    ;;
esac
