#!/bin/sh

# RaspDacMini LCD Plugin Installation Script
# For Volumio 4.x (Debian Bookworm)
# POSIX sh compatible

echo "Installing RaspDacMini LCD plugin..."

# Plugin directory - Volumio executes from plugin directory
PLUGIN_DIR="/data/plugins/system_hardware/raspdac_mini_lcd"
COMPOSITOR_DIR="$PLUGIN_DIR/compositor"
NATIVE_DIR="$PLUGIN_DIR/native/rgb565"

# Detect Volumio architecture from /etc/os-release
VOLUMIO_ARCH=$(grep ^VOLUMIO_ARCH /etc/os-release | tr -d 'VOLUMIO_ARCH="')
if [ -z "$VOLUMIO_ARCH" ]; then
    echo "Error: Could not detect Volumio architecture from /etc/os-release"
    echo "plugininstallend"
    exit 1
fi

# Map Volumio arch to prebuilt filename arch
case "$VOLUMIO_ARCH" in
    arm|armv7)
        PREBUILT_ARCH="armv7l"
        ;;
    armv8)
        PREBUILT_ARCH="aarch64"
        ;;
    *)
        echo "Error: Unsupported architecture: $VOLUMIO_ARCH"
        echo "Supported: arm, armv7, armv8"
        echo "plugininstallend"
        exit 1
        ;;
esac

echo "Detected Volumio architecture: $VOLUMIO_ARCH (prebuilt: $PREBUILT_ARCH)"

# Create installation lock file
INSTALLING="/home/volumio/raspdac_mini_lcd.installing"
if [ -f "$INSTALLING" ]; then
    echo "Error: Installation already in progress"
    echo "If you're sure no installation is running, remove $INSTALLING and try again"
    echo "plugininstallend"
    exit 1
fi
touch "$INSTALLING"

# Idempotent reinstall: stop plugin services and remove stale activation before rewriting units
echo "Resetting previous plugin service state..."
PLUGIN_SERVICES="rdmlcd.service rdmlcd-splash.service rdmlcd-shutdown.service rdm_remote.service rdm_irexec.service"
for svc in $PLUGIN_SERVICES; do
    systemctl stop "$svc" 2>/dev/null
    systemctl disable "$svc" 2>/dev/null
done
rm -f /etc/systemd/system/multi-user.target.wants/rdmlcd-shutdown.service
systemctl daemon-reload 2>/dev/null
systemctl reset-failed rdmlcd.service rdmlcd-splash.service rdmlcd-shutdown.service 2>/dev/null

# Function to cleanup on error
cleanup_on_error() {
    echo "Installation failed. Cleaning up..."
    rm -f "$INSTALLING"
    echo "plugininstallend"
    exit 1
}

# Detect Node version and check for prebuilt
NODE_MAJOR=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
PREBUILT_FILE="$PLUGIN_DIR/assets/compositor-${PREBUILT_ARCH}-node${NODE_MAJOR}.tar.gz"

# Check if prebuilt exists to determine which packages to install
if [ -f "$PREBUILT_FILE" ]; then
    echo "Found prebuilt compositor for ${PREBUILT_ARCH} Node ${NODE_MAJOR}"
    HAVE_PREBUILT=1
else
    echo "No prebuilt for ${PREBUILT_ARCH} Node ${NODE_MAJOR}, will compile from source"
    HAVE_PREBUILT=0
fi

echo "Installing system dependencies..."

# Update package list
apt-get update
if [ $? -ne 0 ]; then
    echo "Error: Failed to update package list"
    cleanup_on_error
fi

if [ "$HAVE_PREBUILT" = "1" ]; then
    # Prebuilt exists - install only runtime libraries (no -dev packages, no build-essential)
    echo "Installing runtime dependencies only (using prebuilt)..."
    apt-get install -y --no-install-recommends libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 fbset jq
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install runtime dependencies"
        cleanup_on_error
    fi
else
    # No prebuilt - install build tools and development libraries
    echo "Installing build dependencies for compilation..."
    apt-get install -y --no-install-recommends build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev fbset jq
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install build dependencies"
        cleanup_on_error
    fi
fi

echo "System dependencies installed successfully"

# Install prebuilt or compile from source
if [ "$HAVE_PREBUILT" = "1" ]; then
    echo "Using prebuilt version (fast installation, no compilation needed)..."

    # Extract into a clean temp dir first, then merge into the compositor dir.
    # Extracting the prebuilt directly over the existing compositor tree triggers
    # GNU tar "Directory renamed before its status could be extracted" on some
    # targets (directory-over-directory). Staging in an empty dir avoids that.
    PREBUILT_TMP=$(mktemp -d)
    if tar --delay-directory-restore -xzf "$PREBUILT_FILE" -C "$PREBUILT_TMP" && cp -a "$PREBUILT_TMP"/. "$COMPOSITOR_DIR"/; then
        echo "Prebuilt compositor installed successfully"
        USING_PREBUILT=1
    else
        echo "Warning: Failed to extract prebuilt, will compile from source"
    fi
    rm -rf "$PREBUILT_TMP"
fi

# If no prebuilt or extraction failed, compile from source
if [ -z "$USING_PREBUILT" ]; then
    echo "Compiling compositor from source (this may take 15+ minutes on slower systems)..."
    cd "$COMPOSITOR_DIR"
    if [ $? -ne 0 ]; then
        echo "Error: Failed to change to compositor directory"
        cleanup_on_error
    fi

    # The prebuilt branch installs only runtime libraries. If we are compiling
    # (no prebuilt present, or its extraction failed) the build toolchain and
    # -dev libraries must be installed first, or node-gyp fails with "not found:
    # make". apt-get is idempotent, so this is a no-op when already present.
    echo "Ensuring build toolchain and dev libraries are installed..."
    apt-get install -y --no-install-recommends build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev fbset jq
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install build dependencies"
        cd "$PLUGIN_DIR"
        cleanup_on_error
    fi

    # Clear any partial files left by a failed prebuilt extraction.
    rm -rf "$COMPOSITOR_DIR/node_modules" "$NATIVE_DIR/build"

    # Install compositor dependencies (this will also compile native module via preinstall)
    npm install --omit=dev
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install compositor packages or compile native module"
        cd "$PLUGIN_DIR"
        cleanup_on_error
    fi
    
    echo "Compositor packages installed successfully"
    
    # Verify native module was compiled
    if [ ! -f "$COMPOSITOR_DIR/utils/rgb565.node" ]; then
        echo "Warning: Native module not found at expected location"
        echo "Attempting manual compilation..."
        cd "$NATIVE_DIR"
        if [ $? -ne 0 ]; then
            echo "Error: Failed to change to native module directory"
            cd "$PLUGIN_DIR"
            cleanup_on_error
        fi
        
        npm run install_rdmlcd
        if [ $? -ne 0 ]; then
            echo "Error: Native module compilation failed"
            cd "$PLUGIN_DIR"
            cleanup_on_error
        fi
    fi
    
    echo "Native module compiled successfully"
fi

cd "$PLUGIN_DIR"

echo "Verifying splash frames..."

MISSING_SPLASH=0
for FRAME in boot starting shutdown reboot; do
    if [ ! -f "$PLUGIN_DIR/assets/splash/${FRAME}.raw" ]; then
        echo "Error: Missing required splash frame: assets/splash/${FRAME}.raw"
        MISSING_SPLASH=1
    fi
done

if [ "$MISSING_SPLASH" -ne 0 ]; then
    echo "Splash frames must be shipped with the plugin (see scripts/build-splash-frames.py)."
    cleanup_on_error
fi

if [ ! -f "$PLUGIN_DIR/assets/splash/volumio-logo.png" ]; then
    echo "Warning: assets/splash/volumio-logo.png not found (splash .raw files are still used)"
fi

echo "Splash frames verified"

echo "Installing device tree overlay..."

# Check if dtoverlay file exists in assets
if [ ! -f "$PLUGIN_DIR/assets/raspdac-mini-lcd.dtbo" ]; then
    echo "=========================================="
    echo "WARNING: Device tree overlay not found"
    echo "=========================================="
    echo ""
    echo "The file raspdac-mini-lcd.dtbo is missing from assets/"
    echo "Display will NOT work until you:"
    echo "  1. Download from: https://github.com/foonerd/zjy240s0800tg02-ili9341-dtoverlay"
    echo "  2. Place raspdac-mini-lcd.dtbo in the assets/ folder"
    echo "  3. Reinstall or manually copy to /boot/overlays/"
    echo ""
    echo "Continuing installation without display overlay..."
    echo "=========================================="
else
    # Copy dtoverlay to /boot/overlays/
    cp "$PLUGIN_DIR/assets/raspdac-mini-lcd.dtbo" /boot/overlays/
    if [ $? -ne 0 ]; then
        echo "Error: Failed to copy device tree overlay"
        cleanup_on_error
    fi
    
    echo "Device tree overlay installed successfully"
    
    # Add dtoverlay to /boot/userconfig.txt if not already present
    if ! grep -q "dtoverlay=raspdac-mini-lcd" /boot/userconfig.txt 2>/dev/null; then
        echo "" >> /boot/userconfig.txt
        echo "# RaspDacMini LCD Display" >> /boot/userconfig.txt
        echo "dtoverlay=raspdac-mini-lcd" >> /boot/userconfig.txt
        echo "Boot configuration updated"
    else
        echo "Boot configuration already contains dtoverlay"
    fi
fi

# Install and configure LIRC for remote control
echo "Installing LIRC for remote control..."

# Install LIRC package
apt-get install -y --no-install-recommends lirc
if [ $? -ne 0 ]; then
    echo "Warning: Failed to install lirc, remote control will not work"
else
    echo "LIRC installed successfully"
    
    # Disable AND mask system LIRC services to prevent conflicts
    systemctl disable lircd.service irexec.service lircd.socket 2>/dev/null
    systemctl stop lircd.service irexec.service lircd.socket 2>/dev/null
    systemctl mask lircd.service lircd.socket 2>/dev/null
    echo "System LIRC services disabled and masked"
    
    # Create LIRC directory in plugin
    mkdir -p "$PLUGIN_DIR/lirc"
    
    # Copy LIRC configuration files to plugin directory
    cp "$PLUGIN_DIR/assets/lircd.conf" "$PLUGIN_DIR/lirc/lircd.conf"
    cp "$PLUGIN_DIR/assets/lircrc" "$PLUGIN_DIR/lirc/lircrc"
    cp "$PLUGIN_DIR/assets/lirc_options.conf" "$PLUGIN_DIR/lirc/lirc_options.conf"
    
    # Detect library path based on Volumio architecture
    case "$VOLUMIO_ARCH" in
        arm|armv7)
            LIRC_PLUGIN_DIR="/usr/lib/arm-linux-gnueabihf/lirc/plugins"
            ;;
        armv8)
            LIRC_PLUGIN_DIR="/usr/lib/aarch64-linux-gnu/lirc/plugins"
            ;;
    esac
    
    # Update lirc_options.conf with correct plugin path
    sed -i "s|plugindir = .*|plugindir = $LIRC_PLUGIN_DIR|" "$PLUGIN_DIR/lirc/lirc_options.conf"
    
    # Add GPIO IR overlay to boot config
    if ! grep -q "dtoverlay=gpio-ir" /boot/userconfig.txt 2>/dev/null; then
        echo "# IR Remote Control (GPIO 4)" >> /boot/userconfig.txt
        echo "dtoverlay=gpio-ir,gpio_pin=4" >> /boot/userconfig.txt
        echo "IR overlay configured"
    fi
    
    # Create custom LIRC service (rdm_remote.service)
    cat > /etc/systemd/system/rdm_remote.service << EOF
[Unit]
Description=RaspDacMini LIRC Remote Service
After=network.target lircd-setup.service

[Service]
ExecStart=/usr/sbin/lircd -O $PLUGIN_DIR/lirc/lirc_options.conf -o /var/run/lirc/lircd -H default -d /dev/lirc0 -n $PLUGIN_DIR/lirc/lircd.conf
Type=simple
User=root
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

    # Create custom irexec service (rdm_irexec.service)
    cat > /etc/systemd/system/rdm_irexec.service << EOF
[Unit]
Description=RaspDacMini LIRC Button Handler
After=network.target lircd-setup.service rdm_remote.service

[Service]
ExecStart=/usr/bin/irexec $PLUGIN_DIR/lirc/lircrc
Type=simple
User=root
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

    # LIRC services are enabled when the plugin starts (rdmlcd-plugin-services.sh)
    systemctl daemon-reload
    
    echo "LIRC configured with custom services"
fi

echo "Creating systemd service files..."

# Main compositor service
cat > /etc/systemd/system/rdmlcd.service << 'EOF'
[Unit]
Description=RaspDacMini LCD Display Service
After=volumio.service
Wants=volumio.service

[Service]
Type=simple
User=root
WorkingDirectory=/data/plugins/system_hardware/raspdac_mini_lcd/compositor
Environment="SLEEP_AFTER=900"
ExecStartPre=/bin/sh -c 'until [ -e /dev/fb1 ]; do sleep 1; done'
ExecStartPre=/bin/sh -c 'for i in $(seq 1 90); do curl -sf -o /dev/null --connect-timeout 1 http://127.0.0.1:3000/ && exit 0; sleep 1; done; echo "Volumio API not ready"; exit 1'
TimeoutStartSec=0
ExecStart=/usr/bin/node index.js volumio /dev/fb1
StandardOutput=journal
StandardError=journal
KillSignal=SIGINT
Restart=on-failure
RestartSec=5
StartLimitInterval=200
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
EOF

if [ $? -ne 0 ]; then
    echo "Error: Failed to create compositor service file"
    cleanup_on_error
fi

# Boot splash service (fb1 early)
cp "$PLUGIN_DIR/compositor/service/rdmlcd-splash.service" /etc/systemd/system/rdmlcd-splash.service
if [ $? -ne 0 ]; then
    echo "Error: Failed to install rdmlcd-splash.service"
    cleanup_on_error
fi

# Shutdown / reboot splash service
cp "$PLUGIN_DIR/compositor/service/rdmlcd-shutdown.service" /etc/systemd/system/rdmlcd-shutdown.service
if [ $? -ne 0 ]; then
    echo "Error: Failed to install rdmlcd-shutdown.service"
    cleanup_on_error
fi

# Reset shutdown splash activation (older versions incorrectly used multi-user.target)
systemctl disable rdmlcd-shutdown.service 2>/dev/null

# Volumio's plymouth draws the system splash on the SPI framebuffer (/dev/fb1) at
# boot and during shutdown/reboot, overwriting our splash and leaving a backlit
# blank. Mask only the plymouth units that PAINT a splash so the plugin is the
# sole owner of the LCD across all phases. Infrastructure units (quit, quit-wait,
# read-write, rotation, switch-root, ask-password) are left intact. Restored on
# uninstall.
PLYMOUTH_SPLASH_UNITS="plymouth-start.service plymouth-kexec.service plymouth-poweroff.service plymouth-reboot.service plymouth-halt.service"
echo "Masking plymouth splash services so the plugin owns the LCD..."
for unit in $PLYMOUTH_SPLASH_UNITS; do
    systemctl mask "$unit" 2>/dev/null
done

echo "Service files created successfully"

echo "Creating service environment override..."

# Create override directory
mkdir -p /etc/systemd/system/rdmlcd.service.d

# Read sleep_after from config.json
SLEEP_AFTER=900
if [ -f "$PLUGIN_DIR/config.json" ]; then
    SLEEP_AFTER=$(jq -r '.sleep_after.value' "$PLUGIN_DIR/config.json" 2>/dev/null)
    if [ -z "$SLEEP_AFTER" ] || [ "$SLEEP_AFTER" = "null" ]; then
        SLEEP_AFTER=900
    fi
fi

# Create override file with current config
cat > /etc/systemd/system/rdmlcd.service.d/override.conf << EOF
[Service]
Environment="SLEEP_AFTER=$SLEEP_AFTER"
EOF

echo "Service environment configured: SLEEP_AFTER=$SLEEP_AFTER"

echo "Creating helper script for runtime configuration..."

# Create helper script for updating service environment at runtime
cat > /usr/local/bin/rdmlcd-update-env.sh << 'HELPER'
#!/bin/sh
# RaspDacMini LCD - Service environment update helper
# Called by plugin to update SLEEP_AFTER setting

SLEEP_AFTER="$1"

if [ -z "$SLEEP_AFTER" ]; then
    echo "Usage: rdmlcd-update-env.sh <sleep_after_seconds>"
    exit 1
fi

# Validate numeric input
case "$SLEEP_AFTER" in
    ''|*[!0-9]*) echo "Error: SLEEP_AFTER must be numeric"; exit 1 ;;
esac

# Create override directory and file
mkdir -p /etc/systemd/system/rdmlcd.service.d
cat > /etc/systemd/system/rdmlcd.service.d/override.conf << EOF
[Service]
Environment="SLEEP_AFTER=$SLEEP_AFTER"
EOF

# Reload systemd
/bin/systemctl daemon-reload

echo "Service environment updated: SLEEP_AFTER=$SLEEP_AFTER"
HELPER

chmod 755 /usr/local/bin/rdmlcd-update-env.sh

echo "Installing splash and plugin service helpers..."

cp "$PLUGIN_DIR/scripts/rdmlcd-show-splash.sh" /usr/local/bin/rdmlcd-show-splash.sh
cp "$PLUGIN_DIR/scripts/rdmlcd-shutdown-splash.sh" /usr/local/bin/rdmlcd-shutdown-splash.sh
cp "$PLUGIN_DIR/scripts/rdmlcd-plugin-services.sh" /usr/local/bin/rdmlcd-plugin-services.sh
cp "$PLUGIN_DIR/scripts/rdmlcd-overlay.sh" /usr/local/bin/rdmlcd-overlay.sh
chmod 755 /usr/local/bin/rdmlcd-show-splash.sh /usr/local/bin/rdmlcd-shutdown-splash.sh /usr/local/bin/rdmlcd-plugin-services.sh /usr/local/bin/rdmlcd-overlay.sh

echo "Validating plugin before completing install..."

if ! node --check "$PLUGIN_DIR/index.js"; then
    echo "Error: Plugin index.js failed syntax check"
    cleanup_on_error
fi

if ! node --check "$COMPOSITOR_DIR/index.js"; then
    echo "Error: Compositor index.js failed syntax check"
    cleanup_on_error
fi

if ! node --check "$COMPOSITOR_DIR/utils/volumiolistener.js"; then
    echo "Error: Compositor volumiolistener.js failed syntax check"
    cleanup_on_error
fi

if grep -q 'WantedBy=multi-user.target' /etc/systemd/system/rdmlcd-shutdown.service 2>/dev/null; then
    echo "Error: rdmlcd-shutdown.service has invalid WantedBy=multi-user.target"
    cleanup_on_error
fi

for FRAME in boot starting shutdown reboot; do
    RAW="$PLUGIN_DIR/assets/splash/${FRAME}.raw"
    if [ ! -f "$RAW" ] || [ "$(wc -c < "$RAW" | tr -d ' ')" != "153600" ]; then
        echo "Error: Invalid or missing splash frame: $RAW"
        cleanup_on_error
    fi
done

if ! grep -q 'rdmlcd-show-splash.sh boot' /etc/systemd/system/rdmlcd-splash.service 2>/dev/null; then
    echo "Error: rdmlcd-splash.service must use boot splash frame"
    cleanup_on_error
fi

if grep -q 'rdmlcd-show-splash.sh starting' /usr/local/bin/rdmlcd-plugin-services.sh 2>/dev/null; then
    echo "Error: rdmlcd-plugin-services.sh must not write starting splash on sync"
    cleanup_on_error
fi

if grep -q 'dev-fb1\.device' /etc/systemd/system/rdmlcd-splash.service 2>/dev/null; then
    echo "Error: rdmlcd-splash.service must not depend on dev-fb1.device"
    cleanup_on_error
fi

if [ ! -x /usr/local/bin/rdmlcd-shutdown-splash.sh ]; then
    echo "Error: rdmlcd-shutdown-splash.sh missing or not executable"
    cleanup_on_error
fi

if ! grep -q 'onVolumioShutdown' "$PLUGIN_DIR/index.js" 2>/dev/null || ! grep -q 'onVolumioReboot' "$PLUGIN_DIR/index.js" 2>/dev/null; then
    echo "Error: plugin must implement onVolumioShutdown/onVolumioReboot hooks"
    cleanup_on_error
fi

echo "Install validation passed"

echo "Creating sudoers entry for runtime configuration..."

# Create sudoers entry for volumio user to run helper script
cat > /etc/sudoers.d/volumio-user-raspdac-mini-lcd << 'SUDOERS'
# RaspDacMini LCD plugin - allow volumio user to manage display services
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/rdmlcd-update-env.sh
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/rdmlcd-plugin-services.sh
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/rdmlcd-overlay.sh
volumio ALL=(ALL) NOPASSWD: /usr/local/bin/rdmlcd-shutdown-splash.sh
volumio ALL=(ALL) NOPASSWD: /bin/systemctl start rdmlcd.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl stop rdmlcd.service
volumio ALL=(ALL) NOPASSWD: /bin/systemctl restart rdmlcd.service
SUDOERS

chmod 0440 /etc/sudoers.d/volumio-user-raspdac-mini-lcd
visudo -c -f /etc/sudoers.d/volumio-user-raspdac-mini-lcd
if [ $? -ne 0 ]; then
    echo "Warning: Invalid sudoers syntax, runtime config updates may fail"
    rm -f /etc/sudoers.d/volumio-user-raspdac-mini-lcd
else
    echo "Sudoers configuration complete"
fi

echo "Enabling and starting service..."

# Reload systemd to pick up new service
systemctl daemon-reload
if [ $? -ne 0 ]; then
    echo "Error: Failed to reload systemd"
    cleanup_on_error
fi

# Services are enabled/started by the plugin onStart when the plugin is enabled in Volumio.
# Optional: sync once after install if the plugin will be enabled immediately.
BOOT_SPLASH=$(jq -r '.boot_splash.value // true' "$PLUGIN_DIR/config.json" 2>/dev/null)
LCD_ACTIVE=$(jq -r '.lcd_active.value // true' "$PLUGIN_DIR/config.json" 2>/dev/null)
if [ "$BOOT_SPLASH" = "true" ] || [ "$BOOT_SPLASH" = "1" ]; then
    BOOT_SPLASH_FLAG=1
else
    BOOT_SPLASH_FLAG=0
fi
if [ "$LCD_ACTIVE" = "true" ] || [ "$LCD_ACTIVE" = "1" ]; then
    LCD_ACTIVE_FLAG=1
else
    LCD_ACTIVE_FLAG=0
fi

echo "Plugin services will sync on enable (boot_splash=$BOOT_SPLASH_FLAG, lcd_active=$LCD_ACTIVE_FLAG)"

# Remove lock file
rm -f "$INSTALLING"

# Fix ownership of all plugin files (install runs as root)
echo "Setting correct file ownership..."
chown -R volumio:volumio "$PLUGIN_DIR"
if [ $? -ne 0 ]; then
    echo "Warning: Failed to set ownership, but plugin should still work"
fi

echo ""
echo "=========================================="
echo "RaspDacMini LCD Plugin Installation Complete"
echo "=========================================="
echo ""
echo "Enable the plugin in Volumio: Plugins -> RaspDacMini LCD"
echo "A reboot is recommended for earliest boot splash; enable works without reboot."
echo ""

echo "plugininstallend"
