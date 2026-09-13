#! /bin/bash

INSTALLING=1

[ -z "${BASE_DIR}" ] && . common.sh

check_url() {
  if curl --head --silent --fail --max-time 5 "$1" > /dev/null; then
    echo_dt "Check URL: \"$1\" OK"
    return 0 # Reachable
  else
    echo_dt "Check URL: \"$1\" FAILED"
    return 1 # Unreachable
  fi
}

install_pkg() {
    if [ "${ARCH}" == "armhf" ]; then
        TARGET_VERSION=$TARGET_VERSION_ARMHF
    elif [ "${ARCH}" == "amd64" ]; then
        TARGET_VERSION=$TARGET_VERSION_AMD64
    else
        echo_dt "Installation cannot proceed: Unsupported architecture \"${ARCH}\""
        (exit 1)
    fi

    BIN_DIR="${BASE_DIR}/jellyfin_${TARGET_VERSION}"

    if [ -d "${BIN_DIR}" ]; then
        echo_dt "${BIN_DIR} already exists. Skipping package download and installation."
        return 0
    fi

    echo_dt "Preparing to install Jellyfin Server v${TARGET_VERSION} for ${ARCH}..."

    PKG_NAME="jellyfin_${TARGET_VERSION}-${ARCH}.tar.gz"
    PKG_URL_1="https://repo.jellyfin.org/files/server/linux/stable/v${TARGET_VERSION}/${ARCH}/${PKG_NAME}"
    PKG_URL_2="https://repo.jellyfin.org/archive/server/linux/stable/v${TARGET_VERSION}/${ARCH}/${PKG_NAME}"
    if check_url "$PKG_URL_1"; then
        PKG_URL=$PKG_URL_1
    elif check_url "$PKG_URL_2"; then
        PKG_URL=$PKG_URL_2
    else
        echo_dt "Installation cannot proceed: No downloadable URL found for package \"${PKG_NAME}\""
        (exit 1)
    fi

    PKG_TMP="$(mktemp --suffix ".tar.gz")"
    echo_dt "Downloading package from ${PKG_URL}; saving to ${PKG_TMP}..."
    wget -O "${PKG_TMP}" "${PKG_URL}"

    mkdir -p "${BASE_DIR}"
    chmod 755 "${BASE_DIR}"

    echo_dt "Uncompressing package to ${BASE_DIR}..."
    tar xzf "${PKG_TMP}" -C "${BASE_DIR}"

    rm "${PKG_TMP}"

    echo_dt "Setting up directories..."
    mkdir -p "${DATA_DIR}" "${CACHE_DIR}" "${CONFIG_DIR}" "${LOG_DIR}"

    echo_dt "Checking directories..."
    if [ -d "${BIN_DIR}" ]; then
        return 0
    fi
    if [ -d "${BASE_DIR}/jellyfin" ]; then
        echo_dt "Rename \"${BASE_DIR}/jellyfin\" to \"${BIN_DIR}\""
        mv "${BASE_DIR}/jellyfin" "${BIN_DIR}"
    fi
}

install_ffmpeg() {
    set +eE
    trap - ERR
    dpkg-query -W -f='${Status}' jellyfin-ffmpeg6 2>/dev/null | grep -q "install ok installed"
    if [ $? -ne 0 ]; then
        FFMPEG_INSTALLED=false;
    else
        CURRENT_FFMPEG_VERSION=$(dpkg-query -f='${Version}' --show jellyfin-ffmpeg6)
        if $(dpkg --compare-versions "${CURRENT_FFMPEG_VERSION}" lt "${FFMPEG_TARGET_VERSION}"); then
            FFMPEG_INSTALLED=false;
        else
            FFMPEG_INSTALLED=true;
        fi
    fi
    set -eE
    trap 'on_error' ERR
    if [ $FFMPEG_INSTALLED == true ]; then
        echo_dt "jellyfin-ffmpeg v${FFMPEG_TARGET_VERSION} already installed"
    else
        PKG_TMP="$(mktemp --suffix ".deb")"
        echo_dt "Downloading jellyfin-ffmpeg package from ${FFMPEG_PKG_URL}; saving to ${PKG_TMP}..."
        wget -O "${PKG_TMP}" "${FFMPEG_PKG_URL}"
        echo_dt "Installing jellyfin-ffmpeg dependencies..."
        apt-get update && apt-get install -y ocl-icd-libopencl1 libllvm13 libllvm16 libxcb-randr0
        echo_dt "Installing jellyfin-ffmpeg..."
        dpkg -i "${PKG_TMP}"
    fi    
}

create_systemd_service() {
    echo_dt "Setting up systemd service..."

    DEST_FILE="/etc/systemd/system/jellyfin.service"
    WORK_FILE="$(mktemp)"

    cp jellyfin.service.template "${WORK_FILE}"
    
    sed -i 's|${BIN_DIR}|'"${BIN_DIR}"'|' "${WORK_FILE}"
    sed -i 's|${DATA_DIR}|'"${DATA_DIR}"'|' "${WORK_FILE}"
    sed -i 's|${CACHE_DIR}|'"${CACHE_DIR}"'|' "${WORK_FILE}"
    sed -i 's|${CONFIG_DIR}|'"${CONFIG_DIR}"'|' "${WORK_FILE}"
    sed -i 's|${LOG_DIR}|'"${LOG_DIR}"'|' "${WORK_FILE}"

    cp "${WORK_FILE}" "${DEST_FILE}"
    systemctl daemon-reload
}

install_pkg
install_ffmpeg
create_systemd_service
