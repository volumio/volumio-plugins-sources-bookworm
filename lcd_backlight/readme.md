# <img src="./images/logo.png" alt="Logo" width="25" style="vertical-align: text-bottom;">   LCD Backlight Control Plugin for Volumio 3

![Python](https://img.shields.io/badge/python-3.x-blue.svg)
![Raspberry Pi](https://img.shields.io/badge/platform-Raspberry%20Pi%203B%2B-red.svg)
![Volumio](https://img.shields.io/badge/Volumio-3.0+-orange.svg)


A Volumio 3 plugin for automatic LCD backlight control based on ambient light levels using the VEML7700 light sensor.

## Overview

This plugin automatically adjusts the brightness of LCD displays with backlight control based on ambient light conditions. It uses the VEML7700 ambient light sensor to measure lux levels and dynamically adjusts the display brightness for optimal viewing in any lighting environment.

## Features

- **Automatic Brightness Control**: Adjusts LCD backlight based on ambient light readings from VEML7700 sensor
- **Configurable Brightness Range**: Set minimum and maximum brightness levels to suit your preferences
- **Smooth Transitions**: Adjustable smoothing factor for gradual brightness changes
- **Customizable Sensor Calibration**: Fine-tune the sensor response with a lux multiplier
- **Flexible Measurement Interval**: Configure how often the sensor reads ambient light (0.1 - 10 seconds)
- **Multi-language Support**: Includes English and all  translations supported by Volumio (de,fr,pl,cz, ...)

## 🔧 Hardware Components

| Component | Model/Type | Description |
|-----------|------------|-------------|
| **Main Unit** | Raspberry Pi 3B+ | Control unit |
| **Display** | 7" LCD DPI (OFI009) | Touch display connected via DPI interface |
| **Encoder** | KY-040 | Rotary encoder for volume control |
| **Light Sensor** | VEML7700 (BH-014PA) | 16-bit I2C ambient light sensor |

## 🔌 Wiring Diagram

### I2C Bus (VEML7700 Sensor)

![Wiring diagram for raspberrypi 3b+](images/veml7700_schema.png)
```
Raspberry Pi 3B+          VEML7700 (WL7700)
─────────────────         ──────────────────
Pin 1  (3.3V)    ──────── Pin 5 (+3.3V)
Pin 3  (GPIO 2)  ──────── Pin 2 (SDA)
Pin 5  (GPIO 3)  ──────── Pin 1 (SCL)
Pin 6  (GND)     ──────── Pin 4 (GND)
```

### GPIO Pinout Reference

```
+-----+-----+---------+------+---+---Pi 3B+-+---+------+---------+-----+-----+
| BCM | wPi |   Name  | Mode | V | Physical | V | Mode | Name    | wPi | BCM |
+-----+-----+---------+------+---+----++----+---+------+---------+-----+-----+
|     |     |    3.3v |      |   |  1 || 2  |   |      | 5v      |     |     |
|   2 |   8 |   SDA.1 | ALT0 | 1 |  3 || 4  |   |      | 5v      |     |     |
|   3 |   9 |   SCL.1 | ALT0 | 1 |  5 || 6  |   |      | 0v      |     |     |
|   4 |   7 | GPIO. 7 |   IN | 1 |  7 || 8  | 1 | IN   | TxD     |  15 |  14 |
+-----+-----+---------+------+---+----++----+---+------+---------+-----+-----+
```

### Rotary Encoder (KY-040)

- **CLK**: GPIO pin (BCM numbering from `gpio readall`)
- **DT**: GPIO pin (BCM numbering)
- **SW**: GPIO pin (button)
- **+**: 3.3V
- **GND**: Ground

> **Note**: Configure encoder pins in Volumio's Rotary Encoder plugin using **BCM** pin numbers.<br>
>           **No KY-040 rotary encoder connection is needed for the plugin to function properly.**
### Display Connection

- **Power**: +5V and GND from connector X1
- **DPI Signals**: Connected according to `/boot/config.txt` DPI configuration


## Installation

1. Manual Plugin Installation
   - download lcd_backlight.zip from download section , or from github
   - unzip downladed zip file, to the lcd_backlight directory and run following comands from shell 
      'cd ../lcd_backlight'
      'sudo sudo chmod +x install.sh'
      'sudo ./install.sh'
      'volumio refresh'
   - The plugin will appear among the installed plugins.
![Volumio Plugin install screen](images/volumio_plugins.png)

If it does not, it is necessary to delete the file /data/configuration/plugins.json and restart Volumio using the command  volumio vrestart

2. Install the plugin through the Volumio web interface:
   - Navigate to **Plugins** → **Install Plugins**
   - Search for "LCD Backlight Control" or upload the plugin package
   
2.1 The installation script will:
   - Install Python dependencies (`python3-smbus`)
   - Copy the Python control script to `/usr/local/bin/`
   - Create configuration directory at `/etc/lcd_backlight/`
   - Install and enable the systemd service
   - Set appropriate permissions

## Configuration

Access the plugin settings through the Volumio web interface under **Plugins** → **LCD Backlight Control** button **Settings** .
![plugin settings](images/plugin_settings.png)

### Available Settings

#### Measurement Interval
- **Range**: 0.1 - 10 seconds
- **Default**: 1 second
- **Description**: Time between light sensor readings. Lower values provide more responsive brightness changes but may increase CPU usage.

#### Minimum Brightness
- **Range**: 0 - 255
- **Default**: 12
- **Description**: The lowest brightness level the display will reach. Prevents the screen from becoming too dark or turning off completely.

#### Maximum Brightness
- **Range**: 0 - 255
- **Default**: 255
- **Description**: The highest brightness level the display will reach. Can be reduced to save power or limit maximum brightness.

#### Lux Multiplier
- **Range**: 0.01 - 10
- **Default**: 0.75
- **Description**: Calibration multiplier for the VEML7700 sensor. Increase for brighter response to ambient light, decrease for darker response. Use this to fine-tune the sensor's sensitivity to your environment.

#### Smoothing Factor
- **Range**: 0.0 - 1.0
- **Default**: 0.3
- **Description**: Controls how quickly brightness transitions occur. Lower values create slower, smoother transitions. Higher values make brightness changes more immediate and responsive.

## How It Works

1. The plugin reads ambient light levels from the VEML7700 sensor at regular intervals
2. The lux reading is multiplied by the configured lux multiplier for calibration
3. The brightness value is calculated and constrained within the min/max range
4. A smoothing algorithm gradually adjusts the backlight to the target brightness
5. The new brightness value is written to the display's backlight control interface

## Technical Details

### File Structure

```
lcd_backlight/
├── index.js                    # Main plugin controller
├── backlight_control.py        # Python script for hardware control
├── lcd_backlight.service       # Systemd service file
├── install.sh                  # Installation script
├── uninstall.sh               # Uninstallation script
├── UIConfig.json              # Web UI configuration
├── package.json               # Plugin metadata
└── i18n/                      # Translations
    ├── strings_en.json        # English strings
    └── strings_sk.json        # Slovak strings
/usr/local/bin/
└── backlight_control.py        # Main Python skript
```

### Configuration Files

The plugin stores configuration in two locations:

1. **Persistent Config**: `/data/plugins/system_hardware/lcd_backlight/config.json`
   - Stores all plugin settings
   - Managed by Volumio's configuration system

2. **Runtime Config**: `/etc/lcd_backlight/`
   - Individual files for each setting (e.g., `lcd_enabled`, `lcd_int_time`)
   - Read by the Python control script
   - Allows real-time configuration updates without restarting the service

### Service Management

The plugin uses a systemd service (`lcd_backlight.service`) that:
- Runs the Python control script as a daemon
- Starts automatically on boot when the plugin is enabled
- Restarts automatically on failure
- Logs to systemd journal

#### Log Output Example

for debug purpose uncomment two lines 294 - 295 in backlight_control.py:
        # Uncomment for debug
        # if success:
        #     print(f"[{time.strftime('%H:%M:%S')}] Lux: {lux:6.1f} | Brightness: {self.current_brightness:3d}/{self.max_backlight}")

console output will be:
```
[12:34:56] Lux:  245.3 | Brightness: 145/255
[12:34:57] Lux:  248.1 | Brightness: 147/255
[12:34:58] Lux:  251.7 | Brightness: 149/255
```


## Troubleshooting

### Plugin doesn't start
- Check if the VEML7700 sensor is properly connected via I²C
- Verify I²C is enabled on your system (`sudo i2cdetect -y 1`)
- Check systemd service status: `systemctl status lcd_backlight.service`
- Review logs: `journalctl -u lcd_backlight.service -f`

### Brightness not changing
- Verify the backlight device exists: `ls /sys/class/backlight/`
- Check configuration files in `/etc/lcd_backlight/`
- Ensure `lcd_enabled` is set to `1`
- Test sensor readings manually

### Brightness changes too quickly/slowly
- Adjust the **Smoothing Factor** setting
- Lower values = slower transitions
- Higher values = faster transitions

### Display too bright/dark
- Adjust the **Lux Multiplier** to calibrate sensor response
- Modify **Minimum Brightness** and **Maximum Brightness** ranges
- Test in different lighting conditions

## Uninstallation

The plugin can be uninstalled through the Volumio web interface. The uninstallation process will:
- Stop and disable the systemd service
- Remove the service file
- Remove the Python control script
- Clean up configuration files

## Version

**Current Version**: 1.0.0

## License

This project is open-source and available under the ISC License. You may use and modify it freely. You may use the program as is at your own risk, no updates or modifications to the code will be made, no planed, and no warranties or claims for damages will be made in connection with any use of this code.

## Author

lubomirkarlik60@gmail.com

## Support

For issues, questions, or contributions, please visit the plugin's repository or contact through the e-mail.

---

**Note**: This plugin requires appropriate hardware (VEML7700 sensor and compatible LCD display) and may need system-level permissions to access I²C and backlight control interfaces.
