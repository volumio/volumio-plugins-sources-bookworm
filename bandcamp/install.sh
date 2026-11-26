#!/bin/bash
echo "Installing extra dependencies..."
apt update
apt install -y unzip tar bzip2 gzip
# This will install the optional puppeteer dependency used by bandcamp-fetch.
# Note we disable puppeteer's automatic download of Chromium, since it does not provide an armhf executable.
# Instead, we will install chromium-headless-shell, which is compatible with armhf and can be used by bandcamp-fetch.
sudo -u volumio -H -i sh -c "export PUPPETEER_SKIP_DOWNLOAD=true && cd /data/plugins/music_service/bandcamp/ && npm i bandcamp-fetch --omit=dev"
apt install -y --no-install-recommends chromium-headless-shell
echo "Bandcamp Discover plugin installed"
echo "plugininstallend"
