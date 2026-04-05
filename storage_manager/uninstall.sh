#!/bin/bash
echo "Uninstalling Storage Manager"

# Remove sudoers entry (self-contained uninstall)
if [ -f /etc/sudoers.d/volumio-user-storage_manager ]; then
  echo "Removing sudoers entry..."
  rm -f /etc/sudoers.d/volumio-user-storage_manager
fi

echo "pluginuninstallend"
