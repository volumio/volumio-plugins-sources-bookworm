#!/bin/bash

echo "Uninstalling ReplayGain plugin"

# registerConfigCallback() has no unregister counterpart, so the callback
# outlives the uninstall; once Volumio drops the plugin instance it resolves to
# undefined and mpd.conf gets the literal string. Restarting the backend clears
# it. The delay matters: this script runs midway through the uninstall sequence,
# and restarting straight away would kill the backend before the plugin is fully
# removed. The redirect keeps the subshell off the pipe Volumio waits on.
echo "Volumio will restart in a few seconds to complete the uninstall"
( sleep 20; /bin/systemctl restart volumio.service ) >/dev/null 2>&1 &

echo "Done"
echo "pluginuninstallend"
