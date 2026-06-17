#!/bin/sh
# Sync systemd units with Volumio plugin state (run via sudo from plugin).

PLUGIN_SERVICES="rdmlcd-splash.service rdmlcd-shutdown.service rdmlcd.service rdm_remote.service rdm_irexec.service"
SPLASH_SERVICES="rdmlcd-splash.service rdmlcd-shutdown.service"

disable_all() {
    for svc in $PLUGIN_SERVICES; do
        systemctl stop "$svc" 2>/dev/null
        systemctl disable "$svc" 2>/dev/null
    done
    if [ -x /usr/local/bin/rdmlcd-overlay.sh ]; then
        /usr/local/bin/rdmlcd-overlay.sh unload
    fi
}

service_exists() {
    [ -f "/etc/systemd/system/$1" ]
}

sync_lirc() {
    for svc in rdm_remote.service rdm_irexec.service; do
        if service_exists "$svc"; then
            systemctl enable "$svc" 2>/dev/null
            systemctl start "$svc" 2>/dev/null
        fi
    done
}

case "$1" in
disable-all)
    disable_all
    exit 0
    ;;
sync)
    BOOT_SPLASH="$2"
    LCD_ACTIVE="$3"
    ;;
*)
    echo "Usage: rdmlcd-plugin-services.sh disable-all" >&2
    echo "       rdmlcd-plugin-services.sh sync <boot_splash 0|1> <lcd_active 0|1>" >&2
    exit 1
    ;;
esac

sync_lirc

if [ "$BOOT_SPLASH" = "1" ]; then
    if service_exists "rdmlcd-splash.service"; then
        systemctl enable rdmlcd-splash.service 2>/dev/null
    fi
    if service_exists "rdmlcd-shutdown.service"; then
        systemctl enable rdmlcd-shutdown.service 2>/dev/null
    fi
else
    systemctl stop rdmlcd-splash.service 2>/dev/null
    for svc in $SPLASH_SERVICES; do
        if service_exists "$svc"; then
            systemctl disable "$svc" 2>/dev/null
        fi
    done
fi

if [ "$LCD_ACTIVE" = "1" ]; then
    if service_exists "rdmlcd.service"; then
        systemctl start rdmlcd.service 2>/dev/null
    fi
else
    systemctl stop rdmlcd.service 2>/dev/null
fi

exit 0
