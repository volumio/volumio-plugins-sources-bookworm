#! /bin/bash

UNINSTALLING=1

[ -z "${PKG_URL}" ] && . common.sh

dpkg --purge ${PKG_NAME}
