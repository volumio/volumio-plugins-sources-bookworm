#!/bin/bash

# Argon ONE Power & Fan: remove only the block this plugin may have added to
# /boot/userconfig.txt. Any other line (including an enable_uart=1 that someone
# else wrote) is left alone.
#
# The block is removed only when it is complete (every BEGIN line closed by an END
# line). Without the END line, sed would delete everything after the BEGIN line, so
# an incomplete block is left in place and reported.

USERCONFIG="/boot/userconfig.txt"
BEGIN_RE="^[[:space:]]*#[[:space:]]*BEGIN argon_one_power_fan"
END_RE="^[[:space:]]*#[[:space:]]*END argon_one_power_fan"

if [ -f "$USERCONFIG" ] && [ -w "$USERCONFIG" ]; then
    if grep -q "$BEGIN_RE" "$USERCONFIG"; then
        if awk -v b="$BEGIN_RE" -v e="$END_RE" '
            $0 ~ b { if (open) bad = 1; open = 1; next }
            $0 ~ e { open = 0; next }
            END { exit (open || bad) ? 1 : 0 }
        ' "$USERCONFIG"; then
            sed -i "/$BEGIN_RE/,/$END_RE/d" "$USERCONFIG"
            echo "Removed the plugin's UART setting from $USERCONFIG (reboot to apply)"
        else
            echo "The plugin's block in $USERCONFIG is incomplete (BEGIN or END line missing or doubled); left it unchanged. Remove the lines from '# BEGIN argon_one_power_fan' on by hand if wanted"
        fi
    fi
fi

echo "Argon ONE Power & Fan uninstalled"
echo "pluginuninstallend"
