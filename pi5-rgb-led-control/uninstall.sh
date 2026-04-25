#!/bin/bash
echo "Removing Pi5 RGB Status Link"

# 1. Kill the engine process if it's running
# We use -15 (SIGTERM) to allow the Singularity Shutdown to run one last time
sudo pkill -15 -f led_engine.py

# Give it a few seconds to finish the animation
sleep 6

# 2. Hard kill if it's still hanging
sudo pkill -9 -f led_engine.py

echo "done"