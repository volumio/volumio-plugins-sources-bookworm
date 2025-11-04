# Creating Prebuilt Compositor Archives

This document explains how to create prebuilt compositor archives to speed up installation on slow systems (1GB RAM Pi boards).

## Why Prebuilt Archives?

Compiling the compositor from source takes:
- 8GB RAM Pi 4: ~15 minutes
- 1GB RAM Pi: 30+ minutes (or fails due to memory)

Using prebuilt archives reduces installation time to ~10 seconds.

## Requirements

You need a working installation on the target architecture to create a prebuilt:
- Raspberry Pi 3/4/5 with the plugin fully installed and working
- Same Node.js major version as target systems (Node 20)

## Creating a Prebuilt Archive

### Step 1: Verify Working Installation

Ensure the plugin is working correctly:

```bash
# Check service is running
sudo systemctl status rdmlcd.service

# Verify display is working
ls -la /dev/fb1
```

### Step 2: Navigate to Compositor Directory

```bash
cd /data/plugins/system_hardware/raspdac_mini_lcd/compositor
```

### Step 3: Verify Required Files Exist

```bash
# Check node_modules
ls -ld node_modules/
# Should show: drwxr-xr-x ... volumio volumio ... node_modules/

# Check package-lock.json
ls -l package-lock.json
# Should exist

# Check native module
ls -l utils/rgb565.node
# Should exist and be executable
```

### Step 4: Create Archive

```bash
# Detect architecture
ARCH=$(uname -m)

# Create compressed archive
tar -czf compositor-${ARCH}-node20.tar.gz \
    node_modules/ \
    package-lock.json \
    utils/rgb565.node

# Verify archive was created
ls -lh compositor-${ARCH}-node20.tar.gz
# Should be ~8-10MB
```

### Step 5: Move to Assets Folder

```bash
# Move to plugin assets folder
sudo mv compositor-${ARCH}-node20.tar.gz ../assets/

# Verify it's there
ls -l ../assets/compositor-${ARCH}-node20.tar.gz
```

### Step 6: Fix Ownership (Important!)

```bash
# Fix ownership so plugin can access it
cd /data/plugins/system_hardware/raspdac_mini_lcd
sudo chown volumio:volumio assets/compositor-${ARCH}-node20.tar.gz
```

## Supported Architectures

Create separate prebuilts for each architecture:

| Architecture | Detected as | Raspberry Pi Models |
|--------------|-------------|---------------------|
| ARMv7 32-bit | `armv7l`    | Pi 2, Pi 3, Pi 4 (32-bit OS) |
| ARMv8 64-bit | `aarch64`   | Pi 3, Pi 4, Pi 5 (64-bit OS) |

## Naming Convention

Archives must follow this exact naming pattern:

```
compositor-{ARCH}-node{MAJOR}.tar.gz
```

Examples:
- `compositor-armv7l-node20.tar.gz`
- `compositor-aarch64-node20.tar.gz`

The install script automatically detects:
- Architecture: `uname -m`
- Node version: First digit from `node --version`

## Archive Contents

The prebuilt archive contains:

```
compositor-armv7l-node20.tar.gz
├── node_modules/           # All npm dependencies
│   ├── canvas/
│   ├── socket.io-client/
│   ├── stackblur-canvas/
│   └── ... (all others)
├── package-lock.json       # Exact dependency versions
└── utils/
    └── rgb565.node         # Compiled native module
```

## Installation Behavior

When `volumio plugin install` runs:

1. **Prebuilt exists**: 
   - Extracts archive (~10 seconds)
   - Skips build-essential installation
   - No compilation needed

2. **No prebuilt**:
   - Installs build-essential
   - Compiles from source (~15+ minutes)

## Testing the Prebuilt

After creating a prebuilt, test it:

```bash
# Uninstall plugin
cd /data/plugins/system_hardware/raspdac_mini_lcd
volumio plugin uninstall

# Reinstall with prebuilt
cd /path/to/RaspDacMini
volumio plugin install

# Watch for prebuilt message in output:
# "Found prebuilt compositor for armv7l Node 20"
# "Using prebuilt version (fast installation, no compilation needed)"
```

## Troubleshooting

### Archive extraction fails

```bash
# Test extraction manually
cd /tmp
tar -tzf /path/to/compositor-armv7l-node20.tar.gz | head
# Should list: node_modules/..., package-lock.json, utils/rgb565.node
```

### Wrong ownership

```bash
# Check ownership
ls -l /data/plugins/system_hardware/raspdac_mini_lcd/assets/

# Fix if needed
sudo chown volumio:volumio /data/plugins/system_hardware/raspdac_mini_lcd/assets/*.tar.gz
```

### Native module not working

The native module is architecture-specific. You cannot:
- Use armv7l prebuilt on aarch64
- Use Node 18 prebuilt with Node 20
- Mix architectures

Each combination needs its own prebuilt.

## Contributing Prebuilts

If you create prebuilts for your architecture:

1. Test thoroughly on your system
2. Verify the prebuilt installs correctly
3. Create a GitHub issue or pull request with the prebuilt attached
4. Include: Architecture, Node version, Pi model tested on

## Size Optimization

If archive is larger than expected (>15MB):

```bash
# Check what's taking space
tar -tzf compositor-armv7l-node20.tar.gz | \
    xargs -I {} du -sh /data/plugins/system_hardware/raspdac_mini_lcd/compositor/{} 2>/dev/null | \
    sort -rh | head -20
```

Common large files:
- `node_modules/canvas/` - Expected (~5-6MB)
- Build artifacts (*.o, *.a files) - Can be excluded

## Updating Prebuilts

Prebuilts need updating when:
- Node.js major version changes (20 → 21)
- Dependencies change in package.json
- Native module code changes

After any code changes, recreate all prebuilts.
