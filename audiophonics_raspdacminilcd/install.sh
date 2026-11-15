#!/bin/sh
# RaspDacMini LCD installer. Runs as root through the plugin manager; its
# output is shown in the install dialog and a non-zero exit fails the
# install. What it puts outside the plugin folder, uninstall.sh takes back.
# Volumio runs this with sh, so it keeps to what sh has.

echo "Installing RaspDacMini LCD"

PLUGIN_DIR="/data/plugins/system_hardware/raspdac_mini_lcd"
BIN="$PLUGIN_DIR/bin/raspdacmini-panel"
SERVICE="raspdacmini-panel"
UNIT="/etc/systemd/system/$SERVICE.service"
RULES="/etc/udev/rules.d/70-raspdacmini-remote.rules"
SUDOERS="/etc/sudoers.d/volumio-user-raspdac_mini_lcd"
USERCONFIG="/boot/userconfig.txt"
PLUGINS="/data/configuration/plugins.json"
SETTINGS="/data/configuration/system_hardware/raspdac_mini_lcd/config.json"
BOOT_HELPER="/usr/local/bin/raspdacmini-boot"
LEAVING_HELPER="/usr/local/bin/raspdacmini-leaving"
# The display's SPI device, and where the kernel lists its framebuffers. The
# installer's own tests stand a file and a folder in for them.
SPI_DEVICE="${RASPDACMINI_SPI_DEVICE:-/dev/spidev0.0}"
GRAPHICS="${RASPDACMINI_GRAPHICS:-/sys/class/graphics}"

# A refused install leaves nothing behind, so the next attempt starts clean.
refuse() {
  echo ""
  echo "$@"
  rm -rf "$PLUGIN_DIR"
  exit 1
}

# =============================================================================
# CHECK: the display's program runs on this machine. The unzip does not keep
# modes. It is one static 32-bit ARM binary, for the userland Volumio runs on
# every Raspberry Pi.
# =============================================================================
chmod +x "$BIN" 2>/dev/null || true
if [ ! -x "$BIN" ]; then
  refuse "ERROR: the display's program is missing from the package ($BIN)"
fi
if ! VERSION=$("$BIN" --version 2>/dev/null); then
  refuse "ERROR: the display's program does not run on this machine ($(uname -m)); the RaspDac Mini is a Raspberry Pi"
fi
echo "Program: $VERSION"

# =============================================================================
# CHECK: whether this is an update of a plugin in use. Volumio's own record
# says whether the plugin is enabled, and the plugin's settings whether the
# display is switched on; version 1's display service, still running, says
# the same of it. Each file is read with its layout taken out, so it does not
# matter how it was written.
# =============================================================================
flat() {
  tr -d ' \t\r\n' < "$1" 2>/dev/null
}
IN_USE=0
if [ -f "$PLUGINS" ] && flat "$PLUGINS" | grep -q '"raspdac_mini_lcd":{"enabled":{[^}]*"value":"\{0,1\}true'; then
  IN_USE=1
fi
if systemctl is-active --quiet rdmlcd.service 2>/dev/null; then
  IN_USE=1
fi
DISPLAY_ON=1
if [ -f "$SETTINGS" ] && flat "$SETTINGS" | grep -q '"lcd_active":{[^}]*"value":"\{0,1\}false'; then
  DISPLAY_ON=0
fi

# =============================================================================
# REPLACE: what version 1 of this plugin installed. It drew the display from
# Node through the kernel's framebuffer and read the remote through lirc;
# this version needs neither. Its five services, the folder of settings for
# one of them, its five helper scripts and its sudoers entry go. It masked
# the system's lirc services and the units that paint the boot splash, and
# they are given back. The packages it installed are left alone: another
# plugin may use them.
# =============================================================================
VERSION_1=0
for old in rdmlcd rdmlcd-splash rdmlcd-shutdown rdm_remote rdm_irexec; do
  if [ -e "/etc/systemd/system/$old.service" ] || [ -L "/etc/systemd/system/$old.service" ]; then
    VERSION_1=1
    systemctl stop "$old.service" 2>/dev/null || true
    systemctl disable "$old.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/$old.service"
    echo "Removed the version 1 service $old"
  fi
done
if [ -d /etc/systemd/system/rdmlcd.service.d ]; then
  VERSION_1=1
  rm -rf /etc/systemd/system/rdmlcd.service.d
fi
for helper in rdmlcd-update-env.sh rdmlcd-show-splash.sh rdmlcd-shutdown-splash.sh rdmlcd-plugin-services.sh rdmlcd-overlay.sh; do
  if [ -e "/usr/local/bin/$helper" ]; then
    VERSION_1=1
    rm -f "/usr/local/bin/$helper"
  fi
done
if [ -e /etc/sudoers.d/volumio-user-raspdac-mini-lcd ]; then
  VERSION_1=1
  rm -f /etc/sudoers.d/volumio-user-raspdac-mini-lcd
fi
if [ "$VERSION_1" = 1 ]; then
  for unit in lircd.service lircd.socket plymouth-start.service plymouth-kexec.service plymouth-poweroff.service plymouth-reboot.service plymouth-halt.service; do
    systemctl unmask "$unit" 2>/dev/null || true
  done
  rm -f /data/.rdmlcd-shutdown.log
  echo "Gave back what version 1 had masked: the system's lirc services and the boot splash"
fi
rm -rf "$PLUGIN_DIR/compositor" "$PLUGIN_DIR/native" "$PLUGIN_DIR/scripts" "$PLUGIN_DIR/lirc"

# =============================================================================
# SETUP: the boot configuration, for the way the display is driven. As a
# framebuffer, which is how it is driven unless the settings say otherwise,
# the kernel has the panel from the start of the boot, through its own
# overlay for such panels; over SPI, the plugin's program has it. The
# receiver is the gpio-ir overlay on GPIO 4 either way. A helper keeps the
# plugin's block of userconfig.txt to that, and takes out what version 1
# wrote there; the plugin runs the same helper when the setting changes.
# Version 1's own overlay file is not needed by either way and goes.
# =============================================================================
DRIVER=framebuffer
if [ -f "$SETTINGS" ] && flat "$SETTINGS" | grep -q '"display_driver":{[^}]*"value":"spi"'; then
  DRIVER=spi
fi
install -m 755 "$PLUGIN_DIR/boot/raspdacmini-boot" "$BOOT_HELPER"
REBOOT=0
if [ -f /boot/config.txt ]; then
  if [ "$("$BOOT_HELPER" "$DRIVER")" = changed ]; then
    REBOOT=1
    echo "Boot configuration updated: $USERCONFIG"
  fi
  rm -f /boot/overlays/raspdac-mini-lcd.dtbo
else
  echo "WARNING: no /boot/config.txt here; the display and the gpio-ir overlay are not set up"
fi
# Version 1 also loaded its overlay while the player ran, where it had not
# been loaded at boot. As a framebuffer the panel it gives is the one this
# version draws on, so it stays until the player restarts on the new boot
# configuration. Over SPI it is in the way, and one loaded that way can be
# taken out again.
if [ "$DRIVER" = spi ] && command -v dtoverlay >/dev/null 2>&1 && dtoverlay -l 2>/dev/null | grep -q "raspdac-mini-lcd"; then
  if dtoverlay -r raspdac-mini-lcd 2>/dev/null; then
    echo "Unloaded version 1's display overlay"
  fi
fi

# =============================================================================
# SETUP: the receiver decodes the handset's frames and the display's service
# may read them. The rules ask for the NEC decoder and for the receiver's
# device to belong to the input group whenever the receiver appears; the
# trigger asks for both now, on a player whose receiver is already there.
# =============================================================================
install -m 644 "$PLUGIN_DIR/udev/70-raspdacmini-remote.rules" "$RULES"
udevadm control --reload 2>/dev/null || true
udevadm trigger --action=change --subsystem-match=rc --subsystem-match=lirc 2>/dev/null || true

# =============================================================================
# SETUP: the groups the service takes for the SPI bus, the GPIO lines, the
# receiver's input device, the DAC's mixer and the framebuffer. Volumio's
# Raspberry Pi image has all five; one that is missing is made, so the
# service starts and says what it cannot open.
# =============================================================================
for group in spi gpio input audio video; do
  if ! getent group "$group" >/dev/null 2>&1; then
    groupadd -f "$group"
    echo "WARNING: the group $group was missing and has been made; its devices may not be open to it"
  fi
done

# =============================================================================
# SETUP: sudo for what the plugin asks of the service as the volumio user.
# Named volumio-user-* so it sorts after Volumio's own rules.
# =============================================================================
cat > "$SUDOERS" << 'SUDO'
# raspdac_mini_lcd plugin: the display's service, switched with the plugin's Display setting
volumio ALL=(ALL) NOPASSWD: /bin/systemctl enable --now raspdacmini-panel.service, /bin/systemctl disable --now raspdacmini-panel.service
# and the plugin's lines in the boot configuration, which follow its Display driver setting
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/raspdacmini-boot framebuffer, /usr/local/bin/raspdacmini-boot spi
SUDO
chmod 0440 "$SUDOERS"
if ! visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  rm -f "$SUDOERS"
  refuse "ERROR: the sudoers entry did not validate"
fi

# =============================================================================
# SETUP: the display's service. The plugin enables it when it starts and
# disables it when it stops, so the display greets from boot only while the
# plugin is on.
# =============================================================================
systemctl stop "$SERVICE.service" 2>/dev/null || true
# What the service runs as it is stopped, to tell the display's program
# when the stop is the whole system going down, and which way.
install -m 755 "$PLUGIN_DIR/boot/raspdacmini-leaving" "$LEAVING_HELPER"
install -m 644 "$PLUGIN_DIR/systemd/$SERVICE.service" "$UNIT"
systemctl daemon-reload

chown -R volumio:volumio "$PLUGIN_DIR"

# An update of a plugin in use: Volumio goes on running the previous
# version's code until the player restarts and starts nothing of the new
# one, so the display is started here rather than left dark until then.
# That needs the panel to be there the way this version is set to drive it:
# as a framebuffer, which version 1's overlay gives as well, or as the SPI
# device, which that overlay holds until the player restarts. systemd
# counts the service started as soon as its program is run; a display that
# cannot be opened ends it a moment later, so it is looked at again before
# anything is said of it.
panel_there() {
  if [ "$DRIVER" = spi ]; then
    [ -e "$SPI_DEVICE" ]
    return
  fi
  for name in "$GRAPHICS"/fb*/name; do
    if [ -r "$name" ] && [ "$(cat "$name")" = fb_ili9341 ]; then
      return 0
    fi
  done
  return 1
}
WAITING=0
if [ "$IN_USE" = 1 ] && [ "$DISPLAY_ON" = 1 ]; then
  if panel_there; then
    systemctl enable --now "$SERVICE.service" 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet "$SERVICE.service" 2>/dev/null; then
      echo "The display is running the new version"
    else
      echo "WARNING: the display did not stay up; 'journalctl -u $SERVICE' says why"
    fi
  else
    systemctl enable "$SERVICE.service" 2>/dev/null || true
    WAITING=1
  fi
fi

echo "RaspDacMini LCD installed"
if [ "$WAITING" = 1 ]; then
  echo "Restart the player: the display comes up on the new boot configuration, and stays dark until then"
elif [ "$IN_USE" = 1 ]; then
  echo "Restart the player to finish the update: until then the plugin's settings page is the previous version's"
elif [ "$REBOOT" = 1 ]; then
  echo "Restart the player once: the display and the remote come up on the new boot configuration"
fi
echo "plugininstallend"
