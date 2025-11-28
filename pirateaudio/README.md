# Pirate Audio Plugin for Volumio 4

This project is a **Volumio 4 (Bookworm) port** of the original plugin by **[Ax-LED](https://github.com/Ax-LED/volumio-pirate-audio)**, based on the code from:  
https://github.com/volumio/volumio-plugins-sources/tree/master/pirateaudio

Port maintained and adapted for **Volumio 4 (Bookworm)** by **[Faster3ck](https://github.com/Faster3ck/)**.

The plugin enables full support for the **Pimoroni Pirate Audio** module on Raspberry Pi devices running Volumio.

## Features
- Support for the Pirate Audio display  
- Button handling  
- SPI-based display communication  

## Installation (Manual)
To install the plugin manually on Volumio 4:

```
git clone https://github.com/volumio/volumio-plugins-sources-bookworm.git --depth=1
cd volumio-plugins-sources-bookworm/pirateaudio
volumio plugin install
```

## Notes

After enabling the **SPI interface**, Volumio may need to be **restarted** for the display to function correctly.
