ALLO RELAY ATTENUATOR - TECHNICAL DOCUMENTATION
=================================================

Source: Volumio archives (original Allo CloudDrive links are dead)
- Tech Manual: https://volumio.com/wp-content/uploads/2017/08/Relay-Attenuator-Tech-Manual.pdf
- User Manual: https://volumio.com/wp-content/uploads/2017/08/Relay-Attenuator-User-Manual.pdf


================================================================================
TECHNICAL SPECIFICATIONS
================================================================================

Features:
- Constant Input resistor: 10K
- Load resistance: 60K
- Resistance standard: E192
- Step Size: 1dB
- No. of relays: 6
- No. of Steps: 64dB (0-63)

PCB Dimension: 85 x 67.8 x 22.2mm (W x L x H)
Weight: 42gm
Operating Temperature: 0C to 70C

Audio Connectivity:
- Input: Stereo through on-board RCA Connectors
  - Left In: White RCA connector
  - Right In: Red RCA connector
- Output: Stereo through on-board RCA Connectors
  - Left Out: White RCA connector
  - Right Out: Red RCA connector


================================================================================
I2C INTERFACE
================================================================================

I2C Addresses:
- 0x20: PCF8574 I2C Expander (switch input buttons)
- 0x21: PCF8574 I2C Expander (relay control via ULN2803 driver)

I2C Bus: 1 (standard Raspberry Pi I2C)


================================================================================
CONNECTOR PINOUTS
================================================================================

*** WARNING: J8 IS NOT RASPBERRY PI GPIO COMPATIBLE! ***
*** The pinout is designed for Allo DAC boards, not direct Pi connection ***


J8 - 16-PIN HEADER (To DAC / From Pi via DAC)
---------------------------------------------
Pin   Function (RA side)    Function (Piano DAC side)
---   ------------------    -------------------------
1     5V                    5V
2     5V                    5V
3     NC                    NC
4     NC                    NC
5     SDA (I2C Data)        TWI2_SDA
6     NC                    GPIOB14
7     SCK (I2C Clock)       TWI2_SCK
8     GPIOB15               GPIOB15  <-- ACTIVE LOW INTERRUPT
9     NC                    NC
10    NC                    GPIOB16
11    NC                    NC
12    NC                    GPIOB30
13    NC                    SDZ_AMP
14    NC                    MUTE_AMP
15    GND                   GND
16    GND                   GND


J9 - 16-PIN AUDIO HEADER (From DAC)
-----------------------------------
Pin   Function
---   --------
1     5V
2     5V
3     AUDIO RIGHT
4     AUDIO LEFT
5     AUDIO RIGHT
6     AUDIO LEFT
15    GND
16    GND


J7 - 16-PIN HEADER (To VOLT Amplifier)
--------------------------------------
Pin   Function (RA side)    Function (VOLT side)
---   ------------------    --------------------
1     5V                    5V
2     5V                    5V
3     NC                    NC
4     NC                    NC
5     SDA (I2C Data)        TWI2_SDA
6     NC                    GPIOB14
7     SCK (I2C Clock)       TWI2_SCK
8     GPIOB15               GPIOB15
9     NC                    NC
10    NC                    GPIOB16
11    NC                    NC
12    NC                    GPIOB30
13    NC                    SDZ_AMP
14    NC                    MUTE_AMP
15    GND                   GND
16    GND                   GND


J4 - 16-PIN AUDIO HEADER (To VOLT Amplifier)
--------------------------------------------
Pin   Function
---   --------
1     5V
2     5V
3     AUDIO RIGHT
4     AUDIO LEFT
5     AUDIO RIGHT
6     AUDIO LEFT
15    GND
16    GND


J10 - PUSH BUTTON SWITCHES (directly on PCB)
--------------------------------------------
5-pin header for push-button switches:
- Pin 1: Volume Up
- Pin 2: Volume Down
- Pin 3: Play/Pause
- Pin 4: Mute
- Pin 5: GND


IR SENSOR CONNECTOR (on J7)
---------------------------
For HS0038 or VS1838B IR sensor:
- Pin 1 (OUT): Connect to J7 Pin 8
- Pin 2 (GND): Connect to J7 Pin 16
- Pin 3 (VCC): Connect to J7 Pin 2

** WARNING: The Allo documentation drawing is INCORRECT! **
The drawing shows IR VOUT connected to Pin 10, but this is wrong.
Correct connection is J7 Pin 8 (GPIOB15 = Pi GPIO17).


IR GPIO OPTIONS
---------------
Different DAC boards route IR to different GPIO pins:

GPIO17: Allo Piano DAC (via J7 Pin 8 -> GPIOB15 -> Pi GPIO17)
        Config: dtoverlay=gpio-ir,gpio_pin=17

GPIO26: Audiophonics ES9023, PiFi Digi+, InnoMaker DAC HAT/PRO,
        and most generic Chinese DAC HATs with onboard IR receiver
        Config: dtoverlay=gpio-ir,gpio_pin=26

GPIO5:  Direct wiring to Pi (no DAC pass-through)
        Config: dtoverlay=gpio-ir,gpio_pin=5


================================================================================
DIRECT RASPBERRY PI WIRING (Without Allo DAC)
================================================================================

If connecting directly to Raspberry Pi GPIO header (NOT using Allo DAC),
you need jumper wires:

Pi GPIO Header    Relay Attenuator J8
--------------    -------------------
Pin 2  (5V)       Pin 1 or 2 (5V)
Pin 3  (SDA1)     Pin 5 (SDA)
Pin 5  (SCL1)     Pin 7 (SCK)
Pin 29 (GPIO5)    Pin 8 (GPIOB15 - Interrupt, directly or level shifted)
Pin 6  (GND)      Pin 15 or 16 (GND)

Note: GPIO5 is for DIRECT wiring only (no DAC in between)


================================================================================
GPIO MAPPING THROUGH PIANO 2.1 DAC
================================================================================

When using Piano 2.1 DAC (stacked: Pi -> Piano -> Relay Attenuator):

The Piano DAC J19 header connects to Relay Attenuator J8.
Pin 8 mapping: J8 Pin 8 (GPIOB15) -> Piano J19 Pin 8 -> Pi GPIO17

Therefore: IR sensor on J7 Pin 8 = Pi GPIO17 (not GPIO5!)

Use: dtoverlay=gpio-ir,gpio_pin=17


================================================================================
BLOCK DIAGRAM
================================================================================

                    +------------------+
                    |   Raspberry Pi   |
                    |    or Sparky     |
                    +--------+---------+
                             |
                         I2C Bus
                             |
              +--------------+---------------+
              |                              |
     +--------v--------+          +----------v---------+
     | PCF8574 @ 0x20  |          |  PCF8574 @ 0x21    |
     | (Button Input)  |          |  (Relay Control)   |
     +--------+--------+          +----------+---------+
              |                              |
              |                     +--------v--------+
    [Push Buttons]                  |    ULN2803      |
    [IR Sensor via LIRC]            | (Relay Driver)  |
                                    +--------+--------+
                                             |
                                    +--------v--------+
                                    |   6 Relays      |
                                    | (6-bit binary   |
                                    |  attenuation)   |
                                    +--------+--------+
                                             |
                          Audio In --->[Resistor Ladder]---> Audio Out
                          (RCA)                              (RCA)


================================================================================
SOFTWARE COMMANDS (fn-rattenuc client)
================================================================================

Usage: fn-rattenuc [options]
  -h              Display usage summary
  -c              Command to execute

Commands:
  GET_VOLUME              Get current volume (returns 0-63)
  SET_VOLUME=[value]      Set volume (value = 0 to 63)
  GET_MUTE                Get mute status (returns 0 or 1)
  SET_MUTE=[value]        Set mute (value = 0=unmute, 1=mute)

Examples:
  fn-rattenuc -c SET_VOLUME=50
  fn-rattenuc -c GET_VOLUME
  fn-rattenuc -c SET_MUTE=1
  fn-rattenuc -c GET_MUTE


================================================================================
DAEMON OPTIONS (fn-rattenu)
================================================================================

Usage: fn-rattenu [options] [config_file]
  -d --daemon         Run in background
  -h --help           Display usage summary
  -v --version        Display version
  -l --withoutLIRC    Program will work without IR control
  -n --name=progname  Use this program name for lircrc matching
  -c --lircdconfig    LIRCD config file


================================================================================
VOLUME PERSISTENCE
================================================================================

Volume level is saved to: /etc/r_attenu.conf
Format: Single hex byte (00-3F representing 0-63)

On daemon restart, volume is restored from this file.


================================================================================
ATTENUATION TABLE (6-bit binary weighted)
================================================================================

The 6 relays provide binary-weighted attenuation:
- Relay 1: 1dB
- Relay 2: 2dB
- Relay 3: 4dB
- Relay 4: 8dB
- Relay 5: 16dB
- Relay 6: 32dB

Volume 0  = All relays active = 63dB attenuation (quietest)
Volume 63 = No relays active  = 0dB attenuation (loudest)

Resistors: SUSUMU thin film 0.1% 25ppm audio grade


================================================================================
KNOWN ISSUES
================================================================================

1. Volume "pop" noise when changing multiple steps at once
   - Especially audible at 2^x boundaries (31->32, 15->16, etc.)
   - Recommendation: Change volume gradually, 1 step at a time

2. J8 pinout incompatible with Raspberry Pi GPIO header
   - Must use jumper wires if not using Allo DAC

3. Ground plane design
   - Audio and digital grounds are tied on PCB
   - May cause ground noise in some configurations



CONNECTOR J8 (16-pin) - WARNING: NOT Pi GPIO COMPATIBLE!
---------------------------------------------------------
Pin 1,2:   5V
Pin 5:     SDA (I2C Data)
Pin 7:     SCK (I2C Clock)
Pin 8:     GPIOB15 (Interrupt - Active LOW)
Pin 15,16: GND

DIRECT PI WIRING (bypassing Allo DAC):
--------------------------------------
Pi Pin 2  (5V)    --> J8 Pin 1/2
Pi Pin 3  (SDA1)  --> J8 Pin 5
Pi Pin 5  (SCL1)  --> J8 Pin 7
Pi Pin 29 (GPIO5) --> J8 Pin 8
Pi Pin 6  (GND)   --> J8 Pin 15/16

I2C ADDRESSES:
--------------
0x20: PCF8574 - Button input
0x21: PCF8574 - Relay control (via ULN2803 driver)

PUSH BUTTONS (J10):
-------------------
Pin 1: Volume Up
Pin 2: Volume Down
Pin 3: Play/Pause
Pin 4: Mute
Pin 5: GND

ATTENUATION:
------------
6 relays, binary weighted: 1dB, 2dB, 4dB, 8dB, 16dB, 32dB
Volume 0 = 63dB attenuation (quietest)
Volume 63 = 0dB attenuation (loudest)
