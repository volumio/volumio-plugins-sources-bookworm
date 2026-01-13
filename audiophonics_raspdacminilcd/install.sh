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
    
    # Extract prebuilt to compositor directory
    cd "$COMPOSITOR_DIR"
    tar -xzf "$PREBUILT_FILE"
    if [ $? -eq 0 ]; then
        echo "Prebuilt compositor installed successfully"
        USING_PREBUILT=1
    else
        echo "Warning: Failed to extract prebuilt, will compile from source"
    fi
fi

# If no prebuilt or extraction failed, compile from source
if [ -z "$USING_PREBUILT" ]; then
    echo "Compiling compositor from source (this may take 15+ minutes on slower systems)..."
    cd "$COMPOSITOR_DIR"
    if [ $? -ne 0 ]; then
        echo "Error: Failed to change to compositor directory"
        cleanup_on_error
    fi
    
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

    # Enable custom LIRC services
    systemctl daemon-reload
    systemctl enable rdm_remote.service rdm_irexec.service
    
    echo "LIRC configured with custom services"
fi

echo "Creating systemd service file..."

# Create service file
cat > /etc/systemd/system/rdmlcd.service << 'EOF'
[Unit]
Description=RaspDacMini LCD Display Service
After=volumio.service
Requires=volumio.service

[Service]
Type=simple
User=root
WorkingDirectory=/data/plugins/system_hardware/raspdac_mini_lcd/compositor
Environment="SLEEP_AFTER=900"
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
    echo "Error: Failed to create service file"
    cleanup_on_error
fi

echo "Service file created successfully"

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

echo "Enabling and starting service..."

# Reload systemd to pick up new service
systemctl daemon-reload
if [ $? -ne 0 ]; then
    echo "Error: Failed to reload systemd"
    cleanup_on_error
fi

# Note: Service is NOT enabled at boot level
# Plugin onStart/onStop methods control service lifecycle
# This ensures service only runs when plugin is enabled in Volumio UI

# Check if LCD is enabled in config
LCD_ACTIVE=$(jq -r '.lcd_active.value' "$PLUGIN_DIR/config.json" 2>/dev/null)
if [ -z "$LCD_ACTIVE" ] || [ "$LCD_ACTIVE" = "null" ]; then
    LCD_ACTIVE="true"
fi

if [ "$LCD_ACTIVE" = "true" ]; then
    echo "Starting LCD service..."
    systemctl start rdmlcd.service
    
    if [ $? -ne 0 ]; then
        echo "Warning: Failed to start service (may require reboot for dtoverlay)"
    else
        echo "Service started successfully"
    fi
else
    echo "LCD is disabled in configuration, service not started"
fi

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
echo "IMPORTANT: A reboot is required for the device tree overlay to load."
echo "After reboot, the LCD display should be active at /dev/fb1"
echo ""
echo "To verify after reboot:"
echo "  - Check framebuffer: ls -la /dev/fb1"
echo "  - Check service: systemctl status rdmlcd.service"
echo "  - View logs: journalctl -u rdmlcd.service -f"
echo ""

echo "plugininstallend"
