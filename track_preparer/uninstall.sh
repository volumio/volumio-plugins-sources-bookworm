#!/bin/sh
echo "Uninstalling Track Preparer..."
# ReplayGain: the lines in /etc/mpd.conf are added through the MPD plugin's config
# callback, not written by the plugin. Stopping the plugin removes the callback and
# rebuilds the file, so nothing is left behind; the switch setting stays in the
# plugin's own config folder. Input and output folders are NOT touched.
echo "pluginuninstallend"
