# Pirate Audio Plugin for Volumio 4

This project is a **Volumio 4 (Bookworm) port** of the original plugin by **[Ax-LED](https://github.com/Ax-LED/volumio-pirate-audio)**, based on the code from:  
https://github.com/volumio/volumio-plugins-sources/tree/master/pirateaudio

Port adapted for **Volumio 4 (Bookworm)** by **[Faster3ck](https://github.com/Faster3ck/)**.

The plugin enables full support for the **Pimoroni Pirate Audio** module on Raspberry Pi devices running Volumio.

## Features
- Support for the Pirate Audio display  
- Button handling  
- SPI-based display communication  

## How to Configure the Pirate Audio DAC

1. In Volumio, go to **Menu → Playback Options**.  
2. Under **Audio Output**, enable **I2S DAC**.  
3. For **DAC Model**, select **HiFiBerry DAC**.

## Additional Configuration

On some older **Pirate Audio DAC** models, you may need to change the **Y** button pin from **24** to **20** using the plugin options.


## Installation (Manual)
To install the plugin manually on Volumio 4:

```
git clone https://github.com/volumio/volumio-plugins-sources-bookworm.git --depth=1
cd volumio-plugins-sources-bookworm/pirateaudio
volumio plugin install
```

## Notes
- Please wait a few seconds for the plugin to fully activate.
- After enabling the **SPI interface**, Volumio may need to be **restarted** for the display to function correctly.

## Changelog 
**Version 0.1.5 - 2025-11-29**

- Changed the default GPIO pin for button Y from 20 to 24
- Fixed a minor formatting issue in `package.json`
- Added configuration instructions for the Pirate Audio DAC in `README.md`

**Version 0.1.4 (Volumio 4 Bookworm Port)  - 2025-11-28**

- Updated and integrated all dependencies for Bookworm compatibility  
- Added the `libopenblas0` dependency  
- Python pip dependencies are now installed inside a local `venv` within the plugin directory instead of system-wide  
- Updated `display.py` to use the latest PIL APIs  
- Added an informational message prompting the user to restart Volumio after activating the plugin
