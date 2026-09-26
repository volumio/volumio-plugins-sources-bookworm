# IR Activity LED

Volumio 4 (bookworm) plugin that blinks an LED when a valid IR remote command is received.

The plugin supports the Raspberry Pi built-in `PWR` and `ACT` LEDs, or an external LED connected to a GPIO pin.

## Requirements

- Volumio 4 running on bookworm (will run on earlier versions with package.json adjustment)
- ARMHF architecture
- Node.js 20 or newer
- The Volumio IR Remote Controller plugin installed and enabled
- For GPIO mode, an LED and suitable current-limiting resistor connected to the selected GPIO pin

The plugin listens for IR activity through the LIRC socket at `/var/run/lirc/lircd`. It does not provide IR receiver support itself.

## Installation

Install the plugin through Volumio's plugin manager, or install it from the plugin source tree using Volumio's normal plugin installation workflow.

The plugin installer does not install native operating-system packages. GPIO access is provided by the `@iiot2k/gpiox` dependency.

## Configuration

Open the plugin settings under **System Hardware**.

| Setting | Description | Default |
| --- | --- | --- |
| LED output | Select the built-in `PWR` LED, built-in `ACT` LED, or `GPIO` | `PWR` |
| GPIO pin | GPIO number used in GPIO mode | `21` |
| Blink period | Complete on/off blink period in milliseconds | `70` |
| Blink cycles | Number of blink cycles per IR command | `3` |

The valid ranges are:

- GPIO pin: `0` to `200`
- Blink period: `10` to `500` milliseconds
- Blink cycles: `1` to `50`

The GPIO pin setting is only used when `GPIO` is selected. Avoid selecting a pin already used by another hardware function.

## Behavior

- Each valid received IR command starts a short blink sequence.
- A new command does not interrupt an active blink sequence.
- The selected built-in LED's brightness and trigger mode are restored when the plugin stops or the LED configuration changes.
- GPIO resources are released when the plugin stops or the GPIO configuration changes.

## Troubleshooting

### The LED does not blink

1. Confirm that the IR Remote Controller plugin is installed and enabled.
2. Check that the LIRC service is running and that `/var/run/lirc/lircd` exists.
3. Confirm that the selected built-in LED exists on the device, or verify the GPIO wiring and pin number.
4. Review the Volumio log for `IR Activity LED` messages.

### The GPIO LED does not work

- Confirm the LED polarity and current-limiting resistor.
- Check that the selected GPIO is available and is not reserved by another service or HAT.
- Verify that the configured GPIO number matches the numbering expected by the `gpiox` library and the device.

### Built-in LED permissions or state are not restored

Stop the plugin and restart Volumio. The plugin restores the LED brightness, trigger mode, and file permissions during normal shutdown and configuration changes. A power interruption during a write may require manual inspection of the corresponding path under `/sys/class/leds/`.

## License

ISC
