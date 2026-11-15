#!/bin/bash

# Version of the mausberry-switch daemon installed by this plugin.
# Bump it together with "version" in package.json.
VERSION=0.9.5
DEB="mausberry-switch_${VERSION}_armhf.deb"
URL="https://github.com/tomcek42/mausberry-switch-libgpiod/releases/download/v${VERSION}/${DEB}"
TMPDIR=$(mktemp -d)

echo "Installing mausberry-switch ${VERSION}"

if wget -q -O "${TMPDIR}/${DEB}" "${URL}"; then
  sudo apt-get update
  # apt (not dpkg) resolves the libgpiod2 dependency.
  if ! sudo apt-get install -y "${TMPDIR}/${DEB}"; then
    echo "ERROR: installing ${DEB} failed"
  fi
else
  echo "ERROR: downloading ${URL} failed"
fi

rm -rf "${TMPDIR}"

# Required by Volumio to finish the plugin installation
echo "plugininstallend"
