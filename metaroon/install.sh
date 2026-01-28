#!/bin/bash

echo "================================================"
echo "Installing MetaRoon plugin dependencies"
echo "================================================"

# Get the absolute plugin directory
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_CATEGORY=$(cat "$PLUGIN_DIR"/package.json | jq -r ".volumio_info.plugin_type")
PACKAGE_NAME=$(cat "$PLUGIN_DIR"/package.json | jq -r ".name")
PACKAGE_NAME_LOWER=$(echo "$PACKAGE_NAME" | tr "[A-Z]" "[a-z]")
INSTALL_DIR="/data/plugins/$PLUGIN_CATEGORY/$PACKAGE_NAME"
echo "Plugin directory: $PLUGIN_DIR"

cd "$PLUGIN_DIR" || exit 1

# Remove existing node_modules if present
if [ -d "node_modules" ]; then
    echo "Removing existing node_modules..."
    rm -rf node_modules
    rm -f package-lock.json
fi

# Install dependencies
echo "Installing npm packages..."
npm install --omit 'dev' --no-save 2>&1

# Check if npm install was successful
if [ $? -ne 0 ]; then
    echo "ERROR: npm install failed"
    exit 1
fi

echo ""
echo "Verifying installation..."

# Verify critical modules are installed
MISSING=""

if [ ! -d "node_modules/node-roon-api" ]; then
    echo "ERROR: node-roon-api not installed"
    MISSING="$MISSING node-roon-api"
fi

if [ ! -d "node_modules/node-roon-api-transport" ]; then
    echo "ERROR: node-roon-api-transport not installed"
    MISSING="$MISSING node-roon-api-transport"
fi

if [ ! -d "node_modules/node-roon-api-image" ]; then
    echo "ERROR: node-roon-api-image not installed"
    MISSING="$MISSING node-roon-api-image"
fi

if [ ! -d "node_modules/node-roon-api-browse" ]; then
    echo "ERROR: node-roon-api-browse not installed"
    MISSING="$MISSING node-roon-api-browse"
fi

if [ -n "$MISSING" ]; then
    echo ""
    echo "Missing packages:$MISSING"
    echo ""
    echo "Attempting manual installation from GitHub..."
    
    for package in $MISSING; do
        echo "Installing $package..."
        npm install "github:RoonLabs/$package" --production --no-save
    done
fi

echo ""
echo "Installation verification:"
ls -la node_modules/ | grep roon

echo ""
echo "================================================"
echo "Installing RoonBridge for audio output"
echo "================================================"

# Check if RoonBridge is already installed
if [ -f "/opt/roonbridge/start.sh" ]; then
    echo "RoonBridge already installed, skipping..."
else
    echo "Installing RoonBridge..."
    
    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)
            ROON_ARCH="x64"
            ;;
        armv7l)
            ROON_ARCH="armv7hf"
            ;;
        aarch64)
            ROON_ARCH="armv8"
            ;;
        *)
            echo "Unsupported architecture: $ARCH"
            echo "Skipping RoonBridge installation"
            ROON_ARCH=""
            ;;
    esac
    
    if [ -n "$ROON_ARCH" ]; then
        # Create temp directory for download
        TMPDIR=$(mktemp -d)
        PACKAGE_FILE="RoonBridge_linux${ROON_ARCH}.tar.bz2"
        DOWNLOAD_URL="http://download.roonlabs.com/builds/${PACKAGE_FILE}"
        
        echo "Downloading RoonBridge from $DOWNLOAD_URL..."
        
        # Download to temp directory
        DL_STATUSCODE=$(curl --write-out '%{http_code}' -sLfo "$TMPDIR/$PACKAGE_FILE" "$DOWNLOAD_URL")
        R=$?

        if [ $R -ne 0 ] || [ "$DL_STATUSCODE" -ne 200 ]; then
            echo "Download of RoonBridge failed!"
            echo "URL: $DOWNLOAD_URL"
            echo "HTTP Status Code: $DL_STATUSCODE"
            # Clean up temp directory
            rm -rf "$TMPDIR"
            exit 1
        fi
        
        # Extract in temp directory
        cd "$TMPDIR" || exit 1
        
        if [ -f "$PACKAGE_FILE" ]; then
            echo "Unpacking package file..."
            tar xf "$PACKAGE_FILE"
            
            # Install to /opt
            if [ -d "RoonBridge" ]; then
                sudo mkdir -p /opt/roonbridge
                sudo cp -r RoonBridge/* /opt/roonbridge/
                sudo chmod +x /opt/roonbridge/start.sh
                sudo chmod +x /opt/roonbridge/Bridge/RoonBridge
                sudo chmod +x /opt/roonbridge/Bridge/RoonBridgeHelper
                
                echo "RoonBridge installed to /opt/roonbridge"
                
                # Create systemd service
                sudo tee /etc/systemd/system/roonbridge.service > /dev/null <<EOF
[Unit]
Description=Roon Bridge
After=network.target

[Service]
Type=simple
User=volumio
ExecStart=/opt/roonbridge/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
                
                sudo systemctl daemon-reload
                sudo systemctl enable roonbridge
                sudo systemctl start roonbridge
                
                echo "RoonBridge service created and started"
            else
                echo "ERROR: RoonBridge directory not found after extraction"
            fi
        else
            echo "ERROR: Package file not found after download"
        fi
        
        # Clean up temp directory completely
        echo "Cleaning up temporary files..."
        cd "$PLUGIN_DIR" || exit 1
        rm -rf "$TMPDIR"
    fi
fi

# Change Owner of files to volumio
chown -R volumio:volumio "$INSTALL_DIR" 2>/dev/null || true
if [ -d "/opt/roonbridge" ]; then
    sudo chown -R volumio:volumio "/opt/roonbridge/"
fi

echo ""
echo "================================================"
echo "MetaRoon plugin installed successfully"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Restart Volumio to load the plugin"
echo "2. Go to Roon Settings > Extensions"
echo "3. Authorize 'Volumio MetaRoon'"
echo "4. Your Volumio device should appear as a Roon output"
