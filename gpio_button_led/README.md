# GPIO Button LED Plugin for Volumio 4

Power button with LED indicator using Raspberry Pi GPIO.
Mimics Audiophonics on/off behavior without external MCU.

## Features

- Software shutdown via configurable GPIO pin
- Dual-pin LED control with configurable polarity
- Supports NO (Normally Open) and NC (Normally Closed) buttons
- Automatic dtoverlay management in /boot/userconfig.txt
- Optional wake-from-halt with GPIO3 diode circuit

## Important: Wake from Halt Limitation

**GPIO3 is the ONLY pin that can wake Pi from halt state** (hardware level).

Without additional circuitry:
- Button triggers shutdown when Pi is running (works)
- Button does NOT wake Pi from halt state (won't work)

To enable wake-from-halt, you need a diode circuit connecting your button
to both GPIO3 (hardware wake) and your shutdown GPIO (software shutdown).
See "Advanced: Wake from Halt Circuit" section below.

## Compatibility

- Volumio 4 (Bookworm)
- 32-bit armhf only
- All Raspberry Pi models including Pi 5, CM5, Pi 500

## LED Behavior

| State          | LED Pattern               |
|----------------|---------------------------|
| Booting        | Slow blink (500ms)        |
| Running        | Solid ON                  |
| Button pressed | Fast blink + shutdown     |
| Shutting down  | Fast blink 3s, then OFF   |
| Halted         | OFF                       |

## Default GPIO Assignment

| Function | GPIO | Physical Pin |
|----------|------|--------------|
| LED-     | 4    | 7            |
| Button   | 17   | 11           |
| LED+     | 22   | 15           |
| GND      | -    | 9 (or any)   |

## 40-Pin Header Layout

```
                   Raspberry Pi 40-Pin GPIO Header
                   (Pin 1 at top left)

                        +-----+-----+
                    3V3 |  1  |  2  | 5V
                  GPIO2 |  3  |  4  | 5V
       [I2C/WAKE] GPIO3 |  5  |  6  | GND
       * [LED-]   GPIO4 |  7  |  8  | GPIO14
                    GND |  9  | 10  | GPIO15
       * [BTN]   GPIO17 | 11  | 12  | GPIO18
                 GPIO27 | 13  | 14  | GND
       * [LED+]  GPIO22 | 15  | 16  | GPIO23
                    3V3 | 17  | 18  | GPIO24
                 GPIO10 | 19  | 20  | GND
                  GPIO9 | 21  | 22  | GPIO25
                 GPIO11 | 23  | 24  | GPIO8
                    GND | 25  | 26  | GPIO7
                  GPIO0 | 27  | 28  | GPIO1
                  GPIO5 | 29  | 30  | GND
                  GPIO6 | 31  | 32  | GPIO12
                 GPIO13 | 33  | 34  | GND
                 GPIO19 | 35  | 36  | GPIO16
                 GPIO26 | 37  | 38  | GPIO20
                    GND | 39  | 40  | GPIO21
                        +-----+-----+

      * = Default plugin pins
```

## Basic Wiring (Shutdown Only)

Simple setup - button triggers shutdown but cannot wake from halt.

### 4-Pin Header

```
    4-Pin Header              Pi Physical Pins
    +---------+
    | 1  LED- |-------------> Pin 7  (GPIO 4)
    | 2  GND  |-------------> Pin 9  (GND)
    | 3  BTN  |-------------> Pin 11 (GPIO 17)
    | 4  LED+ |-------------> Pin 15 (GPIO 22)
    +---------+
```

### Button Wiring (NO - Normally Open)

```
    Button             Raspberry Pi
    +-------+
    |   C   |--------> GND (Pin 9)
    |  NO   |--------> GPIO17 (Pin 11)
    |  NC   | (not connected)
    +-------+
```

### Button Wiring (NC - Normally Closed)

```
    Button             Raspberry Pi
    +-------+
    |   C   |--------> GND (Pin 9)
    |  NO   | (not connected)
    |  NC   |--------> GPIO17 (Pin 11)
    +-------+
```

Set "Button Type" to "NC" in plugin settings.

## LED Wiring

**IMPORTANT: YOU MUST USE A RESISTOR IN SERIES WITH THE LED!**

Recommended value: 330-470 ohm

```
    GPIO22 (Pin 15) ---[330R]---(+)LED(-)--- GPIO4 (Pin 7)
       LED+              resistor              LED-
```

### Why the resistor is mandatory

Without a resistor:
1. **LED burns out** - excessive current destroys the LED
2. **GPIO damage** - Pi GPIO can source ~16mA safely, LED without resistor draws 100mA+
3. **Pi damage** - excessive current can permanently damage the SoC

The math:
- GPIO voltage: 3.3V
- LED forward voltage: ~2V (red) to ~3V (blue/white)
- Safe current: 10-20mA
- Resistor needed: (3.3V - 2V) / 15mA = 87 ohm minimum
- Recommended: 330-470 ohm for safety margin

**No resistor = dead LED + possibly dead Pi**

### LED Polarity

Normal (default):
- LED ON:  GPIO22=HIGH, GPIO4=LOW
- LED OFF: Both LOW

Reversed:
- LED ON:  GPIO22=LOW, GPIO4=HIGH
- LED OFF: Both LOW

Use "Reversed" if LED lights when it should be off.

## Advanced: Wake from Halt Circuit

To enable single-button shutdown AND wake-from-halt, use Schottky diodes
to connect one button to both GPIO3 (hardware wake) and GPIO4 (software shutdown).

**Why GPIO3?**
- GPIO3 is the ONLY pin that can wake Pi from halt (hardware level)
- GPIO3 is also I2C SCL - used by most DAC HATs
- Diodes isolate GPIO3 from GPIO4, preventing I2C interference

### Schottky Diode Circuit

```
                    +3.3V
                      |
                   [10k]  R50 (optional but recommended)
                      |
    GPIO4 >----|>|----+-------|<|----< GPIO3
               D1     |       D2
          Schottky    |   Schottky
                      |
                     SW1
                      |
                     GND
```

Components:
- D1, D2: Schottky diodes (e.g., 1N5817, BAT85)
- R50: 10k pull-up resistor (optional but recommended)
- SW1: Momentary push button

### How it works

1. Button pressed: Both GPIO3 and GPIO4 pulled LOW through diodes
2. Pi halted + button: GPIO3 LOW triggers hardware wake
3. Pi running + button: GPIO4 LOW triggers software shutdown (dtoverlay)
4. Diodes prevent GPIO3 and GPIO4 from shorting together
5. Pull-up resistor ensures clean HIGH state when button released

### Plugin configuration for diode circuit

- Button GPIO: 4 (not 17)
- dtoverlay handles GPIO4 for shutdown
- GPIO3 wake is automatic (hardware level, no config needed)

## Configuration

### Button Settings (require reboot)

| Setting     | Options  | Description                              |
|-------------|----------|------------------------------------------|
| Button GPIO | 0-27     | GPIO pin for shutdown (0 = disabled)     |
| Button Type | NO / NC  | NO = Normally Open, NC = Normally Closed |
| Debounce    | 1-1000   | Debounce time in ms (default 100)        |

### LED Settings (apply immediately)

| Setting      | Options          | Description                         |
|--------------|------------------|-------------------------------------|
| LED+ GPIO    | 0-27             | Positive drive pin (0 = disabled)   |
| LED- GPIO    | 0-27             | Negative drive pin (0 = disabled)   |
| LED Polarity | Normal / Reversed | Swap if LED behaves backwards      |

## How the Plugin Works

### Button (Kernel Level)

Plugin manages /boot/userconfig.txt with:

```
dtoverlay=gpio-shutdown,gpio_pin=17,active_low=1,gpio_pull=up,debounce=100
```

This triggers clean shutdown when button GPIO goes LOW.

Note: This only works when Pi is running. For wake-from-halt,
GPIO3 with diode circuit is required.

### LED (Plugin Level)

Software-controlled blinking using setInterval.
Both LED+ and LED- pins toggle together for blink effect.

## Troubleshooting

### Button not triggering shutdown
1. Check GPIO pin matches wiring
2. Verify button type (NO vs NC)
3. Reboot after changing button settings
4. Check /boot/userconfig.txt for gpio-shutdown line

### Button doesn't wake from halt
This is expected without diode circuit. GPIO3 is the only
hardware wake pin. See "Advanced: Wake from Halt Circuit".

### LED not working
1. Check GPIO pins match wiring
2. Verify resistor is installed (330-470 ohm)
3. Try "Reversed" polarity setting

### LED is on when it should be off
Change "LED Polarity" to "Reversed"

## License

GPL-3.0

## Credits

- Inspired by Audiophonics power management
- Diode circuit design from Volumio community (Dario)
- Author: just a Nerd
- Platform: Volumio 4 (Bookworm)
