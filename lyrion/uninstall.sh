#!/bin/bash

if [ -z "$BASH_VERSION" ]; then
    exec bash "$0" "$@"
fi

set -e
pushd "$(dirname "$0")"/dist/scripts > /dev/null
./uninstall_lms.sh
popd > /dev/null
echo "Lyrion Music Server plugin uninstalled"
