#!/bin/sh
# Audiophonics Evo Sabre installer. Runs as root through the plugin manager;
# its output is shown in the install dialog and a non-zero exit fails the
# install. What it puts outside the plugin folder, uninstall.sh takes back.
# Volumio runs this with sh, so it keeps to what sh has.

echo "Installing Audiophonics Evo Sabre"

PLUGIN_DIR="/data/plugins/system_hardware/audiophonics_evo_sabre"
BIN="$PLUGIN_DIR/bin/evosabre-panel"
SERVICE="evosabre-panel"
UNIT="/etc/systemd/system/$SERVICE.service"
KEEPALIVE="$PLUGIN_DIR/keepalive/audio-keepalive-daemon"
KEEPALIVE_SERVICE="evosabre-keepalive"
KEEPALIVE_UNIT="/etc/systemd/system/$KEEPALIVE_SERVICE.service"
RULES="/etc/udev/rules.d/70-evosabre-remote.rules"
SUDOERS="/etc/sudoers.d/volumio-user-audiophonics_evo_sabre"
USERCONFIG="/boot/userconfig.txt"
MARK_BEGIN="# >>> audiophonics_evo_sabre"
MARK_END="# <<< audiophonics_evo_sabre"
PLUGINS="/data/configuration/plugins.json"
SETTINGS="/data/configuration/system_hardware/audiophonics_evo_sabre/config.json"
# Where the kernel lists the GPIO lines taken through sysfs. The installer's
# own tests stand a directory in for it.
GPIO_SYS="${EVOSABRE_GPIO_SYS:-/sys/class/gpio}"

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
  refuse "ERROR: the display's program does not run on this machine ($(uname -m)); the EVO Sabre is a Raspberry Pi"
fi
echo "Program: $VERSION"

# The program behind Click prevention is a second one, linked against the
# player's own ALSA library. The plugin is of use without it, so a player it
# does not run on is told, not refused.
chmod +x "$KEEPALIVE" 2>/dev/null || true
if KEEPALIVE_VERSION=$("$KEEPALIVE" --version 2>/dev/null); then
  echo "Click prevention: $KEEPALIVE_VERSION"
else
  echo "WARNING: the click prevention program does not run on this machine; its switch will have no effect"
fi

# =============================================================================
# CHECK: whether this is an update of a plugin in use. Volumio's own record
# says whether the plugin is enabled, and the plugin's settings whether the
# display is switched on; version 2's display service, still running, says
# the same of it. Each file is read with its layout taken out, so it does not
# matter how it was written.
# =============================================================================
flat() {
  tr -d ' \t\r\n' < "$1" 2>/dev/null
}
IN_USE=0
if [ -f "$PLUGINS" ] && flat "$PLUGINS" | grep -q '"audiophonics_evo_sabre":{"enabled":{[^}]*"value":"\{0,1\}true'; then
  IN_USE=1
fi
if systemctl is-active --quiet evo_oled2.service 2>/dev/null; then
  IN_USE=1
fi
# Click prevention's program, where it is running, is running the previous
# version's file and is started again on this one's.
KEEPALIVE_ON=0
if systemctl is-active --quiet "$KEEPALIVE_SERVICE.service" 2>/dev/null; then
  KEEPALIVE_ON=1
fi
DISPLAY_ON=1
if [ -f "$SETTINGS" ] && flat "$SETTINGS" | grep -q '"oled_active":{[^}]*"value":"\{0,1\}false'; then
  DISPLAY_ON=0
fi

# =============================================================================
# REPLACE: what version 2 of this plugin installed. Its three services ran
# the display and the remote through Node and lirc; this version needs
# neither. The lirc package is left alone: another plugin may use it.
# =============================================================================
for old in evo_oled2 evo_remote evo_irexec; do
  if [ -e "/etc/systemd/system/$old.service" ] || [ -L "/etc/systemd/system/$old.service" ]; then
    systemctl stop "$old.service" 2>/dev/null || true
    systemctl disable "$old.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/$old.service"
    echo "Removed the version 2 service $old"
  fi
done
rm -rf "$PLUGIN_DIR/apps" "$PLUGIN_DIR/service"

# =============================================================================
# REPLACE: the GPIO lines version 2's display left taken. It took the
# display's two lines, D/C on GPIO 27 and reset on GPIO 24, through
# /sys/class/gpio and did not give them back when it stopped. The kernel
# keeps such a line taken until the player restarts, and refuses it to this
# version's display. They are given back here: those two lines on the SoC's
# own pin controller, where they are taken that way, and no others. The
# controller is found by its label, as the display finds it, since its
# numbering differs between the Pi 4 and the Pi 5 families.
# =============================================================================
HELD=0
if [ -w "$GPIO_SYS/unexport" ]; then
  for chip in "$GPIO_SYS"/gpiochip*; do
    if [ ! -r "$chip/label" ] || [ ! -r "$chip/base" ]; then
      continue
    fi
    case "$(cat "$chip/label")" in
      pinctrl-*) ;;
      *) continue ;;
    esac
    base=$(cat "$chip/base")
    case "$base" in
      '' | *[!0-9]*) continue ;;
    esac
    for offset in 27 24; do
      line=$((base + offset))
      if [ ! -d "$GPIO_SYS/gpio$line" ]; then
        continue
      fi
      if echo "$line" > "$GPIO_SYS/unexport" 2>/dev/null; then
        echo "Released GPIO $offset, left taken by version 2's display"
      else
        HELD=1
        echo "WARNING: GPIO $offset is still taken and could not be released"
      fi
    done
  done
fi

# =============================================================================
# SETUP: the boot configuration. The display is on the SPI bus and the
# receiver is the gpio-ir overlay on GPIO 4. Each line goes into this
# plugin's own block of userconfig.txt, unless the boot configuration already
# carries it: a line written twice loads the overlay twice.
# =============================================================================
REBOOT=0
if [ -f /boot/config.txt ]; then
  outside=$(mktemp)
  block=$(mktemp)
  touch "$USERCONFIG"
  sed "/^$MARK_BEGIN\$/,/^$MARK_END\$/d" "$USERCONFIG" > "$outside"
  : > "$block"
  if ! cat /boot/config.txt /boot/volumioconfig.txt "$outside" 2>/dev/null | grep -qx "dtparam=spi=on"; then
    echo "dtparam=spi=on" >> "$block"
  fi
  if ! cat /boot/config.txt /boot/volumioconfig.txt "$outside" 2>/dev/null | grep -qE "^dtoverlay=gpio-ir(,|\$)"; then
    echo "dtoverlay=gpio-ir,gpio_pin=4" >> "$block"
  fi
  if [ -s "$block" ]; then
    # A file whose last line has no end would have the mark joined to it.
    if [ -s "$outside" ] && [ -n "$(tail -c 1 "$outside")" ]; then
      echo >> "$outside"
    fi
    {
      echo "$MARK_BEGIN"
      cat "$block"
      echo "$MARK_END"
    } >> "$outside"
  fi
  if ! cmp -s "$outside" "$USERCONFIG"; then
    cat "$outside" > "$USERCONFIG"
    REBOOT=1
    echo "Boot configuration updated: $USERCONFIG"
  fi
  rm -f "$outside" "$block"
else
  echo "WARNING: no /boot/config.txt here; the SPI bus and the gpio-ir overlay are not set up"
fi

# =============================================================================
# SETUP: the receiver decodes the handset's frames and the display's service
# may read them. The rules ask for the NEC decoder and for the receiver's
# device to belong to the input group whenever the receiver appears; the
# trigger asks for both now, on a player whose receiver is already there.
# =============================================================================
install -m 644 "$PLUGIN_DIR/udev/70-evosabre-remote.rules" "$RULES"
udevadm control --reload 2>/dev/null || true
udevadm trigger --action=change --subsystem-match=rc --subsystem-match=lirc 2>/dev/null || true

# =============================================================================
# SETUP: the groups the service takes for the SPI bus, the GPIO lines and the
# receiver's input device. Volumio's Raspberry Pi image has all three; one
# that is missing is made, so the service starts and says what it cannot
# open.
# =============================================================================
for group in spi gpio input; do
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
# audiophonics_evo_sabre plugin: the display's service, switched with the plugin's Display setting
volumio ALL=(ALL) NOPASSWD: /bin/systemctl enable --now evosabre-panel.service, /bin/systemctl disable --now evosabre-panel.service
# and the service behind Click prevention
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart evosabre-keepalive.service, /bin/systemctl stop evosabre-keepalive.service
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
install -m 644 "$PLUGIN_DIR/systemd/$SERVICE.service" "$UNIT"
# Click prevention's service is not enabled either: the plugin starts it
# when its switch is on and stops it when it is off.
systemctl stop "$KEEPALIVE_SERVICE.service" 2>/dev/null || true
install -m 644 "$PLUGIN_DIR/systemd/$KEEPALIVE_SERVICE.service" "$KEEPALIVE_UNIT"
systemctl daemon-reload

chown -R volumio:volumio "$PLUGIN_DIR"

# An update of a plugin in use: Volumio goes on running the previous
# version's code until the player restarts and starts nothing of the new
# one, so the display is started here rather than left dark until then.
# systemd counts the service started as soon as its program is run; a
# display that cannot be opened ends it a moment later, so it is looked at
# again before anything is said of it.
if [ "$IN_USE" = 1 ] && [ "$DISPLAY_ON" = 1 ]; then
  systemctl enable --now "$SERVICE.service" 2>/dev/null || true
  sleep 2
  if systemctl is-active --quiet "$SERVICE.service" 2>/dev/null; then
    echo "The display is running the new version"
  else
    echo "WARNING: the display did not stay up; 'journalctl -u $SERVICE' says why"
  fi
fi

# Click prevention is in the player's audio path until the player restarts,
# whatever this update replaced: without its program nothing would play.
if [ "$KEEPALIVE_ON" = 1 ]; then
  systemctl start "$KEEPALIVE_SERVICE.service" 2>/dev/null || true
  sleep 2
  if systemctl is-active --quiet "$KEEPALIVE_SERVICE.service" 2>/dev/null; then
    echo "Click prevention is running the new version"
  else
    echo "WARNING: click prevention did not start again; nothing will play until the player has restarted"
  fi
fi

echo "Audiophonics Evo Sabre installed"
if [ "$REBOOT" = 1 ]; then
  echo "Restart the player once: the display and the remote come up on the new boot configuration"
elif [ "$HELD" = 1 ]; then
  echo "Restart the player: the display's GPIO lines are free again once it has"
elif [ "$IN_USE" = 1 ]; then
  echo "Restart the player to finish the update: until then the plugin's settings page is the previous version's"
fi
echo "plugininstallend"
