# Argon ONE Power & Fan (beta)

Volumio 4 (Bookworm) plugin for Argon ONE cases that use Argon's `argon1.sh`.

Argon's `argon1.sh` installer breaks Volumio 4, so this plugin replaces its power
button and fan handling. It is less capable than Argon's scripts but minimally
invasive: it installs nothing, and its only change outside the plugin is an
optional marked block in `/boot/userconfig.txt` (see *Install footprint*).

**Beta.** Tested: Argon ONE V2 on a Pi 4. The V1, the V3 and the V5 (Pi 5) should work the
same way but are untested. M.2 cases are unconfirmed.

## Requirements

- Volumio 4 (Bookworm) on an ARMHF Raspberry Pi, with Node.js 20 or newer (as shipped).
- An Argon ONE case (V2 on a Pi 4 tested).
- I2C enabled, so that `/dev/i2c-1` exists and the `volumio` user can use it. The
  plugin logs a warning when it cannot reach the case controller.
- Nothing else using GPIO4. If the plugin cannot watch the pin it shows an error.
- Argon's own service stopped and disabled (`sudo systemctl disable --now argononed`;
  `argononeoledd` on the V5). It also drives the fan and the power button, so the two
  would fight. The plugin logs a warning at start-up when it finds one running.

## What it does

**Power**

- Case power button (GPIO4): a double tap reboots the system, or (setting) restarts
  only the Volumio app, like `volumio vrestart`. A press and hold (about 3 s) shuts
  down. The case itself also acts on a long press,
  with or without the plugin: holding 3 s or more switches the power off after a
  timeout (about 15 s). Holding more than 5 s may cut the power immediately, but
  this behavior may not be implemented in every case firmware; the case's timeout
  still applies.
- Optional **power-off signal over the UART**: tells the case when Volumio has
  halted so it switches off right away. The switch enables the UART (a marked block
  in `/boot/userconfig.txt`, reboot asked for) and makes the plugin arm the case
  (0xFF over I2C) when a shutdown starts through Volumio. Both are needed: without
  the UART, arming does little and the case's 15 s timeout still applies. Without
  the switch, a button shutdown switches the case off 15 s after the press, and a
  shutdown from the Volumio screen leaves the case powered on. A shutdown typed over
  SSH bypasses Volumio, so the case is not armed and ignores the UART signal. If
  another setting already enables the UART the plugin reports it and writes nothing.
- *Test mode (log only)*: logs and announces button presses without acting.

**Fan control**

- Copies Argon's algorithm: CPU temperature read every 30 s, lowering delayed by a
  further 30 s (then the temperature is read again, and the fan is only lowered if
  it is still low), 100% spin-up before a new speed, speeds 1-24 raised to 25.
- **Mode** dropdown: Off, On/off by temperature, or Speed steps by
  temperature. Choosing Off switches the fan off once and
  the plugin then leaves it alone (a failed write is only logged, Off is still
  saved). Off is not applied again at start-up, so Argon's own fan service can
  be used instead.
- **On/off (default):** one temperature setpoint (default 55 C). The case is sent
  100% at or above it and 0% below it.
- **Speed steps:** three setpoints (defaults 55 C =
  30%, 60 C = 55%, 65 C = 100%). Fan speed steps may not be supported by your
  case: the case controller sends the speed as 20 kHz PWM, but the case's fan
  switch and filter smooth it, so on the V2 anything above 0 runs the fan at full
  speed.
- A button shows the current CPU temperature and fan speed in a popup.
- The detected case firmware (register or legacy) is in the Volumio log only.

## Settings

Open the plugin settings under **System Hardware**.

| Setting | What it does | Default |
| --- | --- | --- |
| Enable power button | Handles the case power button. When off, the case still acts on a long press. | On |
| Double tap action | Reboot the system, or restart only the Volumio app. | Reboot the system |
| Test mode (log only) | Announces every button press with its pulse width, without acting. | Off |
| Power-off signal (UART) | Enables the Pi serial port and arms the case when Volumio shuts down. Needs a reboot. | Off |
| UART status | Read-only: Enabled or Disabled, with "reboot needed" when the change is not active yet, or blocked by another setting. | - |
| Mode | Fan control: Off, On/off by temperature, or Speed steps by temperature. | On/off by temperature |
| Fan on at (°C) | On/off mode: the fan is on at or above this temperature. | 55 |
| Setpoints 1 to 3 (°C and %) | Speed steps mode: temperature and fan speed pairs. | 55 °C = 30%, 60 °C = 55%, 65 °C = 100% |
| Show temperature now | Popup with the CPU temperature, fan state and mode. | - |

Temperatures and speeds are whole numbers from 0 to 100. In Speed steps mode the
temperatures must rise and the speeds must not fall from setpoint 1 to 3. The
double tap, test mode and UART settings are shown only while *Enable power button*
is on, and the fan fields only for the chosen mode.

## Install footprint

No packages, no sudoers entry, no service and no boot change at install time
(`install.sh` only prints a message). The only npm dependency is
`@iiot2k/gpiox` (prebuilt). It uses `/usr/sbin/i2cset` and `/usr/sbin/i2cget`
(already in the Volumio image) as the `volumio` user. `uninstall.sh` removes only
the plugin's own marked block from `/boot/userconfig.txt`, if present. A block
missing its END line (or with a doubled BEGIN) is never removed, by the plugin or by
`uninstall.sh`, because that would delete the lines after it: the file is left
untouched and the plugin reports it, so fix such a block by hand.

## Trying it on the device

```bash
# on the PC: copy the folder, then on the Pi
cd argon_one_power_fan
volumio plugin install
```

Then enable **Argon ONE Power & Fan** under Plugins > Installed plugins.

Suggested first steps: switch on *Test mode*, press the button, and check that the
notification shows the pulse width (about 20 ms for a double tap, about 40 ms for
a hold - hold will power down case even in test mode) before turning test mode off. Every pulse is also in the Volumio log.
Enable Power-off signal (UART) for faster power down.

## Development

`node test/selftest.js` runs the self-test with stand-ins for GPIO, I2C and
Volumio; it touches no hardware.

## Files

`index.js` (lifecycle, settings page), `lib/button.js`, `lib/fan.js`,
`lib/argon.js` (case protocol), `lib/i2c.js`, `lib/uartconfig.js`,
`lib/platform.js`, `lib/constants.js` (plugin name and log prefix), `UIConfig.json`,
`config.json`, `requiredConf.json`, `i18n/strings_en.json`.
