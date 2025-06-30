# Touch Display plugin

**NOTE: The plugin cannot be installed on systems that already have the option to display the Volumio UI via the HDMI video output in the system settings ex works.**

The plugin enables the Volumio user interface to be displayed on locally connected screens. If the screen offers touch control, the UI can also be operated via the screen in addition to keyboard input. The plugin focuses on the original Raspberry Pi Foundation 7" display (and compatible DSI displays), but can in principle also be used with displays connected via HDMI or GPIO. Depending on the display and any touch controller present, additional user actions may be necessary that require advanced knowledge.

The following functions are available on the configuration page of the plugin (depending on the screen, not all functions may be available):

## Screen saver
The options allow you to set the time span in seconds until the screen saver is called up. A value of 0 seconds deactivates the screen saver.
It is also possible to block the screen saver as long as Volumio is in playback status.

## Screen brightness
The screen brightness can be set for screens where a backlight is detected via the ACPI interface of the kernel. If the currently set screen brightness is above 14 and is then set to a value below 15, a modal appears to warn of a screen that is too dark. The modal offers to test the new (low) value by applying it for 5 seconds before restoring the previous brightness. The user can then decide whether to keep the new or the previous setting.

It is possible to define two different brightness values ("Brightness 1" and "Brightness 2") and to specify the time of day at which each brightness value should be set (for example a higher brightness value during the day from 6:00 and a lower brightness at night from 21:00). The time values must correspond to the 24-hour clock system and the time format hh:mm. If both time values are identical, the screen brightness does not change, only brightness 1 is used. With regard to the time information, please note that the plugin uses the system time.

The plugin is also prepared for automatic brightness control. The option for automatic brightness control is only displayed on the configuration page of the plugin if a file named "/etc/als" exists.

Additional hardware in the form of an ambient light sensor is required for automatic brightness control. This is typically an LDR with a voltage divider connected to an ADC such as the TI ADS1115. For example, if the LDR is connected to the input AIN0 of an ADS1115 that measures single-ended signals in continuous conversion mode, the current converted LDR value would appear on a Raspberry Pi in "/sys/devices/platform/soc/fe804000.i2c/i2c-1/1-0048/iio:device0/in_voltage0_raw". This file should be symlinked to "/etc/als", as the plugin expects the current value of an ambient light sensor in "/etc/als".

When automatic brightness is activated for the first time, the light sensor must be "calibrated" to the minimum and maximum screen brightness. The calibration process consists of measuring the ambient light in a first setting (e.g. darkness or twilight), in which the lowest screen brightness should be set, and a second setting (e.g. “normal” daylight or bright sunshine), in which the highest screen brightness should be set. The calibration process can be repeated at any time using the “Calibration” button. The range of possible screen brightness values can be adjusted via the settings for minimum and maximum screen brightness.

When using automatic brightness control, it is also possible to define a third "reference point" to form a curve between minimum and maximum screen brightness. The "reference point" is formed from a value to be entered for the screen brightness ("reference brightness") and a measurement of the ambient brightness to be assigned to this screen brightness. This can be useful if the screen brightness is not to be adjusted linearly to the ambient brightness.

## Display orientation
The display can be rotated in 90° increments. The touch orientation is rotated according to the display. Depending on the screen, additional measures may be required if the X and/or Y axes are inverted at the factory and/or the touch function is not aligned with the display.

If the screen orientation setting is changed, a modal window may appear informing the user that a restart is required. The user has the option of initiating the restart or continuing (and restarting later).

## Scale
...

## GPU memory
On Raspberry Pis other than Pi 5, the plugin can control the amount of memory used by the GPU. This setting was introduced because rotating the screen 90° or 270° on a higher resolution screen requires more GPU memory than 32MB, which is the default setting of Volumio on devices with a total memory of only 512MB or less. E.g., for a screen with a resolution of 1980x1080 pixels, a GPU memory of 34MB must be set, otherwise the screen will remain black.

The size of the GPU memory can be adjusted in steps of 1MB in a range from 32 to 512MB. According to the Raspberry Pi documentation, the recommended maximum values for the GPU memory are 128MB if the total RAM memory is 256MB, 384MB if the total RAM memory is 512MB, 512MB if the total RAM memory is 1024MB or more and 76MB on the Raspberry Pi 4. It is possible to set the GPU memory to larger values than the recommended ones, but this can lead to problems such as preventing the system from booting.

**NOTE: The plugin does not check whether the set value makes sense or even exceeds the amount of total RAM!**

## Mouse pointer
The mouse pointer is hidden by default, but can be shown by activating this option.

## Virtual keyboard
A virtual keyboard can be displayed, which is particularly useful for controlling the Volumio UI via a touchscreen. The virtual keyboard is inactive by default.
