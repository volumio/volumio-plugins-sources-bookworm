#!/bin/sh
scriptpath=`readlink -f "$0"`
dirpath=`dirname "$scriptpath"`
configpath="$dirpath"/config.json

case $1 in
"")
        printf "
\033[32m rdmlcd\033[0m sleep_delay 0 ... (seconds)
\033[32m rdmlcd\033[0m blank 
"
;;
"sleep_delay")
	curl -m 0.5 localhost:4153/deep_sleep_after=$2
	jq '.sleep_after.value = '"$2" "$configpath" > /tmp/lcdcconf.tmp && mv /tmp/lcdcconf.tmp "$configpath"
;;
blank)
	nodebin=""
	uname -a | grep -q volumio && nodebin=`which node12` || nodebin=`which node`
	echo $nodebin
	$nodebin "$dirpath"/blank.js
;;
esac
