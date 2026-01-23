#! /bin/bash

INSTALLING=1

[ -z "${PKG_URL}" ] && . common.sh

install_pkg() {
    set +eE
    trap - ERR
    dpkg-query -W -f='${Status}' ${PKG_NAME} 2>/dev/null | grep -q "install ok installed"
    if [ $? -ne 0 ]; then
        ALREADY_INSTALLED=false;
    else
        CURRENT_VERSION=$(dpkg-query -f='${Version}' --show ${PKG_NAME})
        if $(dpkg --compare-versions "${CURRENT_VERSION}" lt "${TARGET_VERSION}"); then
            ALREADY_INSTALLED=false;
        else
            ALREADY_INSTALLED=true;
        fi
    fi
    set -eE
    trap 'on_error' ERR
    if [ $ALREADY_INSTALLED == true ]; then
        echo_dt "${PKG_NAME} v${TARGET_VERSION} already installed"
    else
        PKG_TMP="$(mktemp --suffix ".deb")"
        echo_dt "Downloading ${PKG_NAME} package from ${PKG_URL}; saving to ${PKG_TMP}..."
        wget -O "${PKG_TMP}" "${PKG_URL}"
        echo_dt "Installing ${PKG_NAME} dependencies..."
        apt-get update && apt-get install -y libcrypt-openssl-rsa-perl libcrypt-openssl-bignum-perl libcrypt-openssl-random-perl
        echo_dt "Installing ${PKG_NAME}..."
        dpkg -i "${PKG_TMP}"
    fi    
}

install_pkg
systemctl stop ${PKG_NAME}
systemctl disable ${PKG_NAME}
