#!/bin/bash
echo "Installing Storage Manager"

# exFAT: install only if tools are missing (ext4/FAT32/NTFS tools are usually present on Volumio)
# Use --no-install-recommends to avoid pulling extra packages
if ! command -v mkfs.exfat >/dev/null 2>&1 && ! command -v exfatlabel >/dev/null 2>&1; then
  if apt-get install -s exfatprogs >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends exfatprogs || true
  elif apt-get install -s exfat-utils >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends exfat-utils || true
  fi
fi

# Create sudoers entry for volumio user (self-contained; base volumio-os may not list these commands)
# Note: File must be named volumio-user-* to come AFTER volumio-user alphabetically
SUDOERS_FILE="/etc/sudoers.d/volumio-user-storage_manager"
echo "Creating sudoers entry for storage_manager..."
cat > "${SUDOERS_FILE}" << 'EOF'
# Storage Manager plugin - disk and partition operations
#
# Query / inspect
volumio ALL=(ALL) NOPASSWD: /usr/bin/lsblk
volumio ALL=(ALL) NOPASSWD: /usr/sbin/blkid
volumio ALL=(ALL) NOPASSWD: /usr/sbin/blockdev
volumio ALL=(ALL) NOPASSWD: /usr/sbin/tune2fs
#
# Mount / unmount
volumio ALL=(ALL) NOPASSWD: /bin/mount
volumio ALL=(ALL) NOPASSWD: /usr/bin/mount
volumio ALL=(ALL) NOPASSWD: /bin/umount
volumio ALL=(ALL) NOPASSWD: /usr/bin/umount
#
# Partition table
volumio ALL=(ALL) NOPASSWD: /usr/sbin/parted
#
# ext2/3/4
volumio ALL=(ALL) NOPASSWD: /usr/sbin/mkfs.ext4
volumio ALL=(ALL) NOPASSWD: /usr/sbin/e2label
volumio ALL=(ALL) NOPASSWD: /usr/sbin/e2fsck
volumio ALL=(ALL) NOPASSWD: /usr/sbin/resize2fs
volumio ALL=(ALL) NOPASSWD: /usr/sbin/fsck
#
# FAT / vfat
volumio ALL=(ALL) NOPASSWD: /usr/sbin/mkfs.vfat
volumio ALL=(ALL) NOPASSWD: /usr/sbin/fatlabel
volumio ALL=(ALL) NOPASSWD: /usr/sbin/fsck.vfat
#
# NTFS
volumio ALL=(ALL) NOPASSWD: /usr/sbin/mkfs.ntfs
volumio ALL=(ALL) NOPASSWD: /usr/sbin/ntfslabel
volumio ALL=(ALL) NOPASSWD: /usr/bin/ntfsfix
#
# exFAT
volumio ALL=(ALL) NOPASSWD: /usr/sbin/mkfs.exfat
volumio ALL=(ALL) NOPASSWD: /usr/sbin/exfatlabel
volumio ALL=(ALL) NOPASSWD: /usr/sbin/exfatfsck
EOF

chmod 0440 "${SUDOERS_FILE}"

# Validate sudoers syntax
visudo -c -f "${SUDOERS_FILE}"
if [ $? -ne 0 ]; then
  echo "ERROR: Invalid sudoers syntax"
  rm -f "${SUDOERS_FILE}"
else
  echo "Sudoers configuration complete."
fi

echo "plugininstallend"
