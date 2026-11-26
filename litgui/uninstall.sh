#!/bin/bash
# LitGUI plugin uninstall hook.
# No persistent state outside the plugin directory itself; Volumio
# removes the directory after this script runs. Browser-side state
# (localStorage preferences) stays on the user's device and is
# harmless once LitGUI is no longer served.
echo "Uninstalling LitGUI"
