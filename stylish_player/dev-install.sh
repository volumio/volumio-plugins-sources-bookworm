#!/bin/bash

cd ~/volumio-plugins-sources-bookworm/stylish_player/
git pull
volumio plugin refresh
volumio plugin update
cd /data/plugins/user_interface/stylish_player/
rm -Rf node_modules/
npm install --production
volumio vrestart

