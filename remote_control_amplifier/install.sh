#!/bin/bash
# parse flags
NO_REBOOT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-reboot|-n)
      NO_REBOOT=1
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--no-reboot|-n]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Ensure script runs as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

echo "Checking for LIRC"
if command -v lircd >/dev/null 2>&1 || dpkg -s lirc >/dev/null 2>&1; then
  echo "LIRC is already installed"
else
  echo "Installing LIRC"
  apt-get update
  apt-get -y install lirc
fi


# locate sampleworkingconfig relative to this install script
SAMPLE_DIR="$(cd "$(dirname "$0")" && pwd)/sampleworkingconfig"

if [ ! -d "$SAMPLE_DIR" ]; then
  echo "Sample config directory not found: $SAMPLE_DIR"
  exit 1
fi

timestamp=$(date +"%Y%m%d%H%M%S")
# Track whether /boot/userconfig.txt was changed so we only reboot when needed
BOOT_CHANGED=0

backup_and_copy(){
  src="$1"
  dest="$2"
  echo "Considering update for $dest from $src"

  # If destination exists, check whether an update is necessary
  if [ -e "$dest" ]; then
    if [ -f "$src" ] && [ -f "$dest" ]; then
      if cmp -s "$src" "$dest"; then
        echo "No changes for $dest; skipping"
        return 0
      fi
    elif [ -d "$src" ] && [ -d "$dest" ]; then
      # If directories are identical, skip
      if diff -qr "$src" "$dest" >/dev/null 2>&1; then
        echo "No changes in directory $dest; skipping"
        return 0
      fi
    fi

    echo "Backing up $dest to ${dest}.bak.$timestamp"
    # Try to preserve attributes when backing up, fall back if necessary
    if ! cp -a "$dest" "${dest}.bak.$timestamp" 2>/tmp/cp_err.log; then
      echo "Warning: backup cp -a failed, retrying without preserving ownership"
      cp -r "$dest" "${dest}.bak.$timestamp" 2>/dev/null || true
      rm -f /tmp/cp_err.log
    fi
  fi

  mkdir -p "$(dirname "$dest")"

  # Copy files or directory contents appropriately
  if [ -d "$src" ]; then
    mkdir -p "$dest"
    if ! cp -a "$src/." "$dest/" 2>/tmp/cp_err.log; then
      echo "Warning: cp -a failed copying directory $src -> $dest, retrying without preserving ownership"
      cp -a --no-preserve=ownership "$src/." "$dest/" 2>/dev/null || cp -r "$src/." "$dest/" || true
      rm -f /tmp/cp_err.log
    fi
  else
    if ! cp -a "$src" "$dest" 2>/tmp/cp_err.log; then
      echo "Warning: cp -a failed copying file $src -> $dest, retrying without preserving ownership"
      cp -a --no-preserve=ownership "$src" "$dest" 2>/dev/null || cp -r "$src" "$dest" || true
      rm -f /tmp/cp_err.log
    fi

    # If this was the /boot/userconfig.txt destination and copy succeeded (files match), mark it changed
    if [ "$dest" = "/boot/userconfig.txt" ] && [ -f "$dest" ] && cmp -s "$src" "$dest"; then
      echo "Detected update to /boot/userconfig.txt"
      BOOT_CHANGED=1
    fi
  fi
}

# Copy asound.conf if present
if [ -f "$SAMPLE_DIR/asound.conf" ]; then
  backup_and_copy "$SAMPLE_DIR/asound.conf" "/etc/asound.conf"
fi

# Copy /boot files
if [ -f "$SAMPLE_DIR/boot/userconfig.txt" ]; then
  backup_and_copy "$SAMPLE_DIR/boot/userconfig.txt" "/boot/userconfig.txt"
fi

# Copy files under sampleworkingconfig/etc into /etc
if [ -d "$SAMPLE_DIR/etc" ]; then
  echo "Updating /etc/ from $SAMPLE_DIR/etc/"
  cd "$SAMPLE_DIR/etc"
  for item in *; do
    src_item="$SAMPLE_DIR/etc/$item"
    dest="/etc/$item"
    backup_and_copy "$src_item" "$dest"
  done
fi

# Fix ownership and permissions for /etc/lirc
if [ -d "/etc/lirc" ]; then
  echo "Setting permissions for /etc/lirc"
  chown -R root:root /etc/lirc || true
  find /etc/lirc -type f -exec chmod 644 {} \; || true
  find /etc/lirc -type d -exec chmod 755 {} \; || true
fi

# Restart lircd or lirc service if present
echo "Restarting lircd/lirc service if present"
if systemctl list-units --full -all | grep -q -E "lircd|lirc"; then
  systemctl daemon-reload || true
  systemctl restart lircd.service 2>/dev/null || systemctl restart lirc.service 2>/dev/null || true
fi

# Signal end of plugin install
echo "plugininstallend"

if [ "$NO_REBOOT" -eq 1 ]; then
  echo "Skipping reboot due to --no-reboot flag"
elif [ "$BOOT_CHANGED" -eq 1 ]; then
  # Trigger a reboot to apply changes to /boot/userconfig.txt
  echo "Changes detected in /boot/userconfig.txt — rebooting to apply changes..."
  sleep 3
  reboot
else
  echo "No changes to /boot/userconfig.txt — skipping reboot"
fi
