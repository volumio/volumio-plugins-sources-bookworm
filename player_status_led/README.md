# Player Status LED

Volumio 4/bookworm system-hardware plugin that uses a GPIO-connected LED to show player status:

- On while playing
- Blinking while paused
- Off for stopped or other states

## Requirements

- Volumio 4 running on bookworm (will run on earlier versions with package.json adjustment)
- ARMHF architecture
- Node.js 20 or newer
- An LED with a suitable current-limiting resistor
- A GPIO pin that is not reserved by another service or hardware device

GPIO access is provided by `@iiot2k/gpiox`.

## Installation

Install the plugin through Volumio's normal plugin installation workflow. The installer does not install operating-system packages.

## Configuration

Open the plugin under **System Hardware**.

| Setting | Description | Default |
| --- | --- | --- |
| GPIO number | GPIO pin connected to the LED | `22` |
| Active state | Use `0` when the LED is on at a low GPIO level, or `1` when it is on at a high GPIO level | `0` |
| Blink period | Milliseconds for one full on/off cycle while paused | `1000` |

Valid ranges:

- GPIO number: `2` to `27`
- Active state: `0` or `1`
- Blink period: `200` to `4000` milliseconds

## Wiring

Use a current-limiting resistor appropriate for the LED and connect the LED according to the selected active state. Confirm the selected GPIO numbering scheme for the target device before wiring it.

Do not share the selected GPIO with another plugin, HAT, serial interface, or system service.

## Troubleshooting

- Check the Volumio log for `Player Status LED` messages.
- Confirm the GPIO number and active state setting.
- Check LED polarity, resistor placement, and wiring.
- Stop other GPIO plugins that may be using the same pin.
- Restart the plugin after changing settings so the GPIO resource is reinitialized.

## License

ISC
