#!/bin/sh

DIR="/data/plugins/user_interface/now_playing/node_modules"

if [ -d "$DIR" ]; then
  # Check if any subdirectory under DIR is owned by root.
  # If so, this indicates incorrect ownership caused by install.sh
  # in previous versions of the plugin. In such case, remove node_modules
  # instead of letting Volumio do it, as that would fail due to permission issues.
  if find "$DIR" -mindepth 1 -type d -exec stat -c %U {} \; | grep -q "^root$"; then
    echo "Detected root-owned subdirectory in $DIR. Removing \"node_modules\" directly..."
    rm -rf "$DIR"
  fi
fi

echo "Now Playing plugin uninstalled"
