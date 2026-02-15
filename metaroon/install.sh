#!/bin/bash

echo "Installing MetaRoon plugin dependencies"

# Install required system packages
apt-get -qq update
apt-get -qqy install bzip2

# Get machine architecture and plugin paths
MACHINE_ARCH=$(uname -m)
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PLUGIN_CATEGORY=$(cat "$PLUGIN_DIR"/package.json | jq -r ".volumio_info.plugin_type")
PACKAGE_NAME=$(cat "$PLUGIN_DIR"/package.json | jq -r ".name")
PACKAGE_NAME_LOWER=$(echo "$PACKAGE_NAME" | tr "[A-Z]" "[a-z]")
TMPDIR=$(mktemp -d)
INSTALL_DIR="/data/plugins/$PLUGIN_CATEGORY/$PACKAGE_NAME"

# Exit cleanup function - ensures plugininstallend is always called
exit_cleanup() {
    echo "Exit Status: $R"
    if [ "$R" -eq 1 ]; then
        echo "Plugin ${PACKAGE_NAME} failed to install!"
        echo "Cleaning up.."
        if [ -d "$INSTALL_DIR" ]; then
            echo "Removing Install directory.."
            rm -Rf "$INSTALL_DIR"
        fi
    fi
    if [ -d "$TMPDIR" ]; then
        echo "Removing tmp directory.."
        rm -Rf "$TMPDIR"
    fi
    echo "plugininstallend"
}
trap exit_cleanup EXIT

# Install npm dependencies
echo "Installing npm packages..."
cd "$PLUGIN_DIR" || exit 1

if [ -d "node_modules" ]; then
    echo "Removing existing node_modules..."
    rm -rf node_modules
    rm -f package-lock.json
fi

npm install --omit 'dev' --no-save 2>&1
R=$?

if [ $R -ne 0 ]; then
    echo "ERROR: npm install failed"
    exit 1
fi

# Verify critical modules
echo "Verifying installation..."
MISSING=""

for module in node-roon-api node-roon-api-transport node-roon-api-image node-roon-api-browse; do
    if [ ! -d "node_modules/$module" ]; then
        echo "WARNING: $module not installed"
        MISSING="$MISSING $module"
    fi
done

if [ -n "$MISSING" ]; then
    echo "Attempting manual installation from GitHub..."
    for package in $MISSING; do
        echo "Installing $package..."
        npm install "github:RoonLabs/$package" --production --no-save
    done
fi

echo "Installation verification:"
ls -la node_modules/ | grep roon

# Install RoonBridge for audio output
echo ""
echo "================================================"
echo "Installing RoonBridge for audio output"
echo "================================================"

if [ -f "/opt/roonbridge/start.sh" ]; then
    echo "RoonBridge already installed, skipping..."
else
    echo "Installing RoonBridge..."
    
    case "$MACHINE_ARCH" in
        armv7*)
            ARCH="armv7hf"
            ;;
        aarch64*)
            ARCH="armv7hf"
            ;;
        x86_64*)
            ARCH="x64"
            ;;
        *)
            echo "Platform $MACHINE_ARCH is not supported!"
            R=1
            exit 1
            ;;
    esac
    
    PACKAGE_FILE="RoonBridge_linux${ARCH}.tar.bz2"
    PACKAGE_URL="http://download.roonlabs.com/builds/${PACKAGE_FILE}"
    
    echo "Downloading $PACKAGE_FILE to $TMPDIR/$PACKAGE_FILE"
    
    DL_STATUSCODE=$(curl --write-out '%{http_code}' -sLfo "$TMPDIR/$PACKAGE_FILE" "$PACKAGE_URL")
    R=$?
    
    if [ $R -ne 0 ] || [ "$DL_STATUSCODE" -ne 200 ]; then
        R=1
        echo "Download of RoonBridge for your volumio architecture failed!"
        echo "URL: $PACKAGE_URL"
        echo "HTTP Status Code: $DL_STATUSCODE"
        exit 1
    fi
    
    echo "Unpacking ${PACKAGE_FILE}..."
    cd "$TMPDIR" || exit 1
    tar xf "$PACKAGE_FILE"
    R=$?
    
    if [ $R -ne 0 ]; then
        echo "An error occurred while decompressing ${PACKAGE_FILE}."
        exit 1
    fi
    
    echo "Moving Files into /opt/roonbridge."
    mkdir -p /opt/roonbridge
    cp -r "$TMPDIR/RoonBridge/"* /opt/roonbridge/
    chmod +x /opt/roonbridge/start.sh
    chmod +x /opt/roonbridge/Bridge/RoonBridge
    chmod +x /opt/roonbridge/Bridge/RoonBridgeHelper
    
    echo "Creating service file."
    SERVICE_FILE=/lib/systemd/system/roonbridge.service
    cat > $SERVICE_FILE << END_SYSTEMD
[Unit]
Description=Roon Bridge
After=network.target dynamicswap.service

[Service]
Type=simple
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=RoonBridge
User=volumio
Environment=ROON_DATAROOT=/data/configuration/$PLUGIN_CATEGORY/$PACKAGE_NAME/roonbridge
Environment=ROON_ID_DIR=/data/configuration/$PLUGIN_CATEGORY/$PACKAGE_NAME/roonbridge
ExecStart=/opt/roonbridge/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
END_SYSTEMD
    
    # Create data directory
    mkdir -p "/data/configuration/$PLUGIN_CATEGORY/$PACKAGE_NAME/roonbridge"
    
    systemctl daemon-reload
    systemctl enable roonbridge
    systemctl start roonbridge
    
    echo "RoonBridge service created and started"
fi

# Change Owner of files to volumio
chown -R volumio:volumio "$INSTALL_DIR"
if [ -d "/opt/roonbridge" ]; then
    chown -R volumio:volumio /opt/roonbridge
fi
if [ -d "/data/configuration/$PLUGIN_CATEGORY/$PACKAGE_NAME" ]; then
    chown -R volumio:volumio "/data/configuration/$PLUGIN_CATEGORY/$PACKAGE_NAME"
fi

R=0
echo ""
echo "MetaRoon plugin installed successfully"
echo ""
echo "Next steps:"
echo "1. Restart Volumio to load the plugin"
echo "2. Go to Roon Settings > Extensions"
echo "3. Authorize 'Volumio MetaRoon'"
echo "4. Your Volumio device should appear as a Roon output"

# plugininstallend is called by exit_cleanup trap
