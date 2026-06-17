#!/bin/sh
# Write a pre-rendered RGB565 splash frame to the LCD framebuffer.

PLUGIN_DIR="/data/plugins/system_hardware/raspdac_mini_lcd"
FRAME="$1"
FB="${2:-/dev/fb1}"
RAW="$PLUGIN_DIR/assets/splash/${FRAME}.raw"
FRAME_SIZE=153600

if [ -z "$FRAME" ]; then
    echo "Usage: rdmlcd-show-splash.sh <boot|starting|shutdown|reboot> [/dev/fb1]" >&2
    exit 1
fi

if [ ! -e "$FB" ]; then
    echo "Framebuffer not found: $FB" >&2
    exit 1
fi

if [ ! -f "$RAW" ]; then
    echo "Splash frame not found: $RAW" >&2
    exit 1
fi

if [ ! -s "$RAW" ]; then
    echo "Splash frame is empty: $RAW" >&2
    exit 1
fi

dd if="$RAW" of="$FB" bs="$FRAME_SIZE" count=1 2>/dev/null || cat "$RAW" > "$FB"
exit 0
