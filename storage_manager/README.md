# Storage Manager

Manage storage for your Volumio system: maintain the boot device (e.g. MicroSD), recover or resize another Volumio installation (USB, SSD, NVMe, HDD), and manage additional data disks for your music library. Operations run in the background with a progress indicator and unmount/remount as needed.

**Author:** Just a Nerd

## Community guide

For the full step-by-step guide (identify boot disk, label system, preparing the disk from Windows/Mac/Linux/SSH, connect and rescan, troubleshooting), see:

**[Beginner's Guide: Adding Storage Disk to Volumio (HDD, SSD, NVMe, SD CARD)](https://community.volumio.com/t/beginners-guide-adding-storage-disk-to-volumio-hdd-ssd-nvme-sd-card/75700/)**

## What this plugin does

### Boot device and disk list

- **Detects the actual boot device** (where the system booted from, e.g. MicroSD). Only that disk is excluded from the general disk list.
- **All other disks are listed**, including any other drive that has a Volumio installation (USB, SSD, NVMe, HDD). You can repair, label, or manage those like any other disk.

### Volumio OS storage maintenance

- **Check and fix partitions** on the Volumio boot device (e.g. after power loss on MicroSD). Shows Clean/Dirty status per partition and runs fsck on all.
- **Recovery:** Boot from a good medium (e.g. MicroSD), plug in a damaged Volumio USB/SSD, select “Another Volumio installation” in the target dropdown, and run “Check and fix all” to repair that installation’s partitions.

### Data partition resize

- **Resize the data partition to 100%** when automatic resize did not complete (e.g. on larger disks). Available for the boot device or, via the target dropdown, for another Volumio installation.

### Additional-disk management (labels, repair, init, format)

- **Init disk** – Create a new partition table (destroys all data; confirmation required).
- **Create partition & format** – Single partition with ext4, FAT32, exFAT, or NTFS, labeled for Volumio.
- **Set label** – Apply a Volumio-recognized label (issd, ihdd, Internal SSD, Internal HDD) to an existing partition; only labels not already in use are offered.
- **Check/repair filesystem** – Run fsck (or equivalent) on a selected partition; the disk is unmounted during the operation and remounted afterward when applicable.

Do not use a disk while an operation is in progress.

## Dependencies

ext4, FAT32, and NTFS tools (parted, util-linux, e2fsprogs, dosfstools, ntfs-3g) are usually already on Volumio. At install time the plugin checks whether exFAT tools (`mkfs.exfat`, `exfatlabel`, `exfatfsck`) are present; if not, it tries to install **exfatprogs** (Bookworm) or **exfat-utils** (Buster) when the package is available in your repos. If exFAT cannot be installed, the plugin still works for ext4, FAT32, and NTFS. To add exFAT support later: `sudo apt-get install -y exfatprogs` (or `exfat-utils`).
