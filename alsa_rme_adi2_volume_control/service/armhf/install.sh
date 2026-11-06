#!/bin/bash
#
# This file is part of the alsa-rme-adi2-volume-control project
#
# To print the usage message, run: bash install.sh --help
#
set -euo pipefail

# Name of the service
SERVICE_NAME="alsa-rme-adi2-volume-control"

# Remote repository which the pre-built executable is downloaded from
REMOTE_REPOSITORY_URL_PREFIX="https://www.albertopettarin.it/$SERVICE_NAME"

# ###########################################################################
# DO NOT MODIFY BELOW THIS LINE!
# ###########################################################################

# Architecture of the current machine,
# used to determine the pre-built executable to download
#
# Supported values:
# - amd64, x86_64              -> x86_64
# - arm, armhf, armv7l, armv8l -> arm
# - aarch64, arm64             -> aarch64
ARCHITECTURE="$(arch)"

# Script and project directory absolute paths
SCRIPT_DIRECTORY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY_PATH="$SCRIPT_DIRECTORY_PATH"

# File names
SERVICE_SYSTEMD_UNIT_FILE_NAME="$SERVICE_NAME.service"
SERVICE_EXECUTABLE_FILE_NAME="$SERVICE_NAME"
SERVICE_UDEV_RULES_FILE_NAME="99-$SERVICE_NAME.rules"

# Absolute source paths
# (they depend on the structure of the source repository)
SERVICE_EXECUTABLE_SOURCE_FILE_PATH="$PROJECT_DIRECTORY_PATH/src/alsa/bin/$SERVICE_EXECUTABLE_FILE_NAME"
SERVICE_SYSTEMD_UNIT_SOURCE_FILE_PATH="$PROJECT_DIRECTORY_PATH/src/systemd/$SERVICE_SYSTEMD_UNIT_FILE_NAME"
SERVICE_UDEV_RULES_SOURCE_FILE_PATH="$PROJECT_DIRECTORY_PATH/src/udev/$SERVICE_UDEV_RULES_FILE_NAME"

# Absolute URLs of the files to be downloaded
SERVICE_EXECUTABLE_SOURCE_URL="$REMOTE_REPOSITORY_URL_PREFIX/$ARCHITECTURE/$SERVICE_EXECUTABLE_FILE_NAME"
SERVICE_SYSTEMD_UNIT_SOURCE_URL="$REMOTE_REPOSITORY_URL_PREFIX/repo/$SERVICE_NAME/src/systemd/$SERVICE_SYSTEMD_UNIT_FILE_NAME"
SERVICE_UDEV_RULES_SOURCE_URL="$REMOTE_REPOSITORY_URL_PREFIX/repo/$SERVICE_NAME/src/udev/$SERVICE_UDEV_RULES_FILE_NAME"

# Absolute destination paths
# (they do NOT depend on the structure of the source repository)
SERVICE_EXECUTABLE_DESTINATION_FILE_PATH="/usr/local/bin/$SERVICE_EXECUTABLE_FILE_NAME"
SERVICE_SYSTEMD_UNIT_DESTINATION_FILE_PATH="/lib/systemd/system/$SERVICE_SYSTEMD_UNIT_FILE_NAME"
SERVICE_UDEV_RULES_DESTINATION_FILE_PATH="/etc/udev/rules.d/$SERVICE_UDEV_RULES_FILE_NAME"

# Keep track if a downloader is present
DOWNLOADER=""
DOWNLOADER_COMMAND_LINE=""

# Keep track if a package manager is present
PACKAGE_MANAGER=""
PACKAGE_MANAGER_COMMAND_LINE=""
PACKAGE_MANAGER_BUILD_DEPENDENCIES=""
PACKAGE_MANAGER_RUN_DEPENDENCIES=""

# Script CLI defaults
COMPILE=1
FROM_SOURCE=0
INSTALL_BUILD_DEPENDENCIES=0
INSTALL_RUN_DEPENDENCIES=1
INSTALL_SYSTEMD=1
INSTALL_UDEV=1
RUN_ARGUMENTS=""
UNINSTALL=1
UNINSTALL_ONLY=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --architecture)
            ARCHITECTURE="$2"
            shift 2
            ;;
        --from-source)
            FROM_SOURCE=1
            shift
            ;;
        --install-build-dependencies)
            INSTALL_BUILD_DEPENDENCIES=1
            shift
            ;;
        --no-compile)
            COMPILE=0
            shift
            ;;
        --no-install-run-dependencies)
            INSTALL_RUN_DEPENDENCIES=0
            shift
            ;;
        --no-install-systemd)
            INSTALL_SYSTEMD=0
            shift
            ;;
        --no-install-udev)
            INSTALL_UDEV=0
            shift
            ;;
        --no-uninstall-first)
            UNINSTALL=0
            shift
            ;;
        --run-arguments)
            RUN_ARGUMENTS="$2"
            shift 2
            ;;
        --uninstall)
            UNINSTALL=1
            UNINSTALL_ONLY=1
            shift
            ;;
        -h|--help)
            echo "Usage: bash $0 [options]"
            echo ""
            echo "Options:"
            echo "  --architecture STRING           Replace the architecture detected by command 'arch' with the provided STRING"
            echo "  --from-source                   Install from source, instead of downloading a released package"
            echo "  --install-build-dependencies    Install build dependencies"
            echo "  --no-compile                    Do not compile the service executable"
            echo "  --no-install-systemd            Do not install the systemd service"
            echo "  --no-install-udev               Do not install the udev rules definition file"
            echo "  --no-install-run-dependencies   Do not install run dependencies"
            echo "  --no-uninstall-first            Do not remove a previous installation before installing"
            echo "  --run-arguments STRING          Append the provided STRING to the ExecStart command line of the systemd service"
            echo "  --uninstall                     Remove a previous installation and exit"
            echo ""
            echo "Note: this script must be executed as root, for instance with sudo"
            exit 0
            ;;
        *)
            echo "[ERRO] Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "[ERRO] This script must be executed as root, for instance with sudo."
    exit 2
fi

# Check that the architecture is supported, if not compiling the service
if [[ $COMPILE -ne 1 ]]; then
    if [[ $ARCHITECTURE == "amd64" ]] || [[ $ARCHITECTURE == "x86_64" ]]; then
        # 64-bit OS on Intel/AMD 64-bit CPU (PC)
        ARCHITECTURE="x86_64"
    elif [[ $ARCHITECTURE == "arm" ]] || [[ $ARCHITECTURE == "armhf" ]] || [[ $ARCHITECTURE == "armv7l" ]] || [[ $ARCHITECTURE == "armv8l" ]]; then
        # 32-bit OS, even on a 64-bit CPU (e.g., Raspberry Pi 3)
        ARCHITECTURE="arm"
    elif [[ $ARCHITECTURE == "aarch64" ]] || [[ $ARCHITECTURE == "arm64" ]]; then
        # 64-bit OS on ARM 64-bit CPU (e.g., Raspberry Pi 5)
        ARCHITECTURE="aarch64"
    else
        echo "[ERRO] Architecture $ARCHITECTURE has no pre-built executable."
        echo "[ERRO] Supported architectures are: 'arm', 'arm64', 'x86_64'."
        echo "[ERRO] Please try running this script again compiling from source (remove --no-compile) or overriding the detected architecture with --architecture."
        exit 3
    fi

    # update the URL accordingly
    SERVICE_EXECUTABLE_SOURCE_URL="$REMOTE_REPOSITORY_URL_PREFIX/$ARCHITECTURE/$SERVICE_EXECUTABLE_FILE_NAME"
fi

echo "[INFO] Running as:      '$EUID' (root)"
echo "[INFO] Run arguments:   '$RUN_ARGUMENTS'"
echo "[INFO] Architecture:    '$ARCHITECTURE'"

# Check that either curl or wget is present, if not installing from source
if [[ $FROM_SOURCE -ne 1 ]]; then
    if command -v curl &>/dev/null; then
        DOWNLOADER="curl"
        DOWNLOADER_COMMAND_LINE="curl -s -o"
    elif command -v wget &>/dev/null; then
        DOWNLOADER="wget"
        DOWNLOADER_COMMAND_LINE="wget -q -O"
    else
        echo "[ERRO] Unable to find curl nor wget to download a released package."
        echo "[ERRO] Please install curl or wget, and try running this script again."
        exit 3
    fi
    echo "[INFO] Downloader:      '$DOWNLOADER'"
fi

# Check that a package manager is present, if installing dependencies
if [[ $INSTALL_BUILD_DEPENDENCIES -eq 1 ]] || [[ $INSTALL_RUN_DEPENDENCIES -eq 1 ]]; then
    if command -v apt &>/dev/null; then
        PACKAGE_MANAGER="apt"
        PACKAGE_MANAGER_COMMAND_LINE="apt install -y -qq"
        PACKAGE_MANAGER_BUILD_DEPENDENCIES="gcc cmake make libasound2-dev pkg-config"
        PACKAGE_MANAGER_RUN_DEPENDENCIES="libasound2-dev"
    elif command -v dnf &>/dev/null; then
        PACKAGE_MANAGER="dnf"
        PACKAGE_MANAGER_COMMAND_LINE="dnf install -y"
        PACKAGE_MANAGER_BUILD_DEPENDENCIES="alsa-lib-devel"
        PACKAGE_MANAGER_RUN_DEPENDENCIES="gcc cmake make alsa-lib-devel pkgconfig"
    elif command -v pacman &>/dev/null; then
        PACKAGE_MANAGER="pacman"
        PACKAGE_MANAGER_COMMAND_LINE="pacman -S --noconfirm"
        PACKAGE_MANAGER_BUILD_DEPENDENCIES="alsa-lib"
        PACKAGE_MANAGER_RUN_DEPENDENCIES="gcc cmake make alsa-lib pkgconf"
    else
        echo "[ERRO] Unable to find a package manager."
        echo "[ERRO] Refer to the documentation to learn how to install the build and/or run dependencies."
        exit 3
    fi
    echo "[INFO] Package manager: '$PACKAGE_MANAGER'"
fi

# Uninstall
if [[ $UNINSTALL -eq 1 ]]; then
    echo "[INFO] Uninstalling service $SERVICE_NAME ..."

    # remove udev rules definition file
    rm -f "$SERVICE_UDEV_RULES_DESTINATION_FILE_PATH"
    udevadm control --reload-rules 2>/dev/null || true

    # stop, disable and remove systemd unit file
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_SYSTEMD_UNIT_DESTINATION_FILE_PATH"
    systemctl daemon-reload

    # remove the executable
    rm -f "$SERVICE_EXECUTABLE_DESTINATION_FILE_PATH"

    echo "[INFO] Uninstalling service $SERVICE_NAME ... done"

    if [[ $UNINSTALL_ONLY -eq 1 ]]; then
        echo "[INFO] Option --uninstall specified: exit without installing service $SERVICE_NAME"
        exit 0
    fi
fi

# Install run dependencies
if [[ $INSTALL_RUN_DEPENDENCIES -eq 1 ]]; then
    echo "[INFO] Installing run dependencies ..."
    eval "$PACKAGE_MANAGER_COMMAND_LINE $PACKAGE_MANAGER_RUN_DEPENDENCIES"
    echo "[INFO] Installing run dependencies ... done"
fi

if [[ $FROM_SOURCE -eq 1 ]]; then

    # Install build dependencies
    if [[ $INSTALL_BUILD_DEPENDENCIES -eq 1 ]]; then
        echo "[INFO] Installing build dependencies ..."
        eval "$PACKAGE_MANAGER_COMMAND_LINE $PACKAGE_MANAGER_BUILD_DEPENDENCIES"
        echo "[INFO] Installing build dependencies ... done"
    fi

    if [[ $COMPILE -eq 1 ]]; then
        echo "[INFO] Compiling service executable from source ..."
        cd "$PROJECT_DIRECTORY_PATH/src/alsa"
        cmake .
        make
        echo "[INFO] Compiling service executable from source ... done"

        echo "[INFO] Installing service executable ..."
        make install
        echo "[INFO] Installing service executable ... done"
    else

        if [[ ! -f $SERVICE_EXECUTABLE_SOURCE_FILE_PATH ]]; then
            echo "[ERRO] File '$SERVICE_EXECUTABLE_SOURCE_FILE_PATH' does not exist."
            echo "[ERRO] Please try running this script again compiling from source (remove --no-compile)."
            exit 3
        fi
        echo "[INFO] Copying service executable ..."
        cp "$SERVICE_EXECUTABLE_SOURCE_FILE_PATH" "$SERVICE_EXECUTABLE_DESTINATION_FILE_PATH"
        echo "[INFO] Copying service executable ... done"
    fi

else

    echo "[INFO] Downloading pre-built service executable ..."
    echo "[INFO] Pre-built service executable URL: '$SERVICE_EXECUTABLE_SOURCE_URL'"
    eval "$DOWNLOADER_COMMAND_LINE '$SERVICE_EXECUTABLE_DESTINATION_FILE_PATH' '$SERVICE_EXECUTABLE_SOURCE_URL'"
    echo "[INFO] Downloading pre-built service executable ... done"
fi

# Make sure the service executable has the execution permission
chmod +x "$SERVICE_EXECUTABLE_DESTINATION_FILE_PATH"

if [[ $INSTALL_SYSTEMD -eq 1 ]]; then
    echo "[INFO] Installing systemd service ..."
    if [[ $FROM_SOURCE -eq 1 ]]; then
        cp "$SERVICE_SYSTEMD_UNIT_SOURCE_FILE_PATH" "$SERVICE_SYSTEMD_UNIT_DESTINATION_FILE_PATH"
    else
        echo "[INFO] Systemd service URL: '$SERVICE_SYSTEMD_UNIT_SOURCE_URL'"
        eval "$DOWNLOADER_COMMAND_LINE '$SERVICE_SYSTEMD_UNIT_DESTINATION_FILE_PATH' '$SERVICE_SYSTEMD_UNIT_SOURCE_URL'"
    fi

    if [[ $RUN_ARGUMENTS != "" ]]; then
        echo "[INFO] Injecting additional run arguments ..."
        echo "[INFO] Run arguments: '$RUN_ARGUMENTS'"
        export RUN_ARGUMENTS_EXPORTED="$RUN_ARGUMENTS"
        sed -i -e "s/\(ExecStart=.*\)$/\1 $RUN_ARGUMENTS_EXPORTED/" "$SERVICE_SYSTEMD_UNIT_DESTINATION_FILE_PATH"
        echo "[INFO] Injecting additional run arguments ... done"
    fi

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"
    echo "[INFO] Installing systemd service ... done"
fi

if [[ $INSTALL_UDEV -eq 1 ]]; then
echo "[INFO] Installing udev rules ..."
    if [[ $FROM_SOURCE -eq 1 ]]; then
        cp "$SERVICE_UDEV_RULES_SOURCE_FILE_PATH" "$SERVICE_UDEV_RULES_DESTINATION_FILE_PATH"
    else
        echo "[INFO] Udev rules URL: '$SERVICE_UDEV_RULES_SOURCE_URL'"
        eval "$DOWNLOADER_COMMAND_LINE '$SERVICE_UDEV_RULES_DESTINATION_FILE_PATH' '$SERVICE_UDEV_RULES_SOURCE_URL'"
    fi
    udevadm control --reload-rules
    udevadm trigger
    echo "[INFO] Installing udev rules ... done"
fi

echo "[INFO] Installation of $SERVICE_NAME complete"
exit 0

