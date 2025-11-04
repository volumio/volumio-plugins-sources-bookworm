ASSETS DIRECTORY
----------------

This directory contains binary assets required for the plugin.

Required File:
* raspdac-mini-lcd.dtbo - Device tree overlay for the LCD display

Source: https://github.com/foonerd/zjy240s0800tg02-ili9341-dtoverlay

To add the dtbo file:
1. Download from the repository above
2. Place raspdac-mini-lcd.dtbo in this directory
3. Remove this README.txt file

The dtbo file provides:
* Framebuffer device /dev/fb1
* Configuration: buswidth=8, rotate=1, MADCTL 0xe8
* GPIO: DC=27, RESET=24, LED=18
