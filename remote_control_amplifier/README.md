# Remote Control Amplifier Plugin — Functionality Overview 🔧

**Short:** This plugin integrates Volumio with an external amplifier using LIRC (IR remote control). It listens to Volumio playback state and synchronizes the amplifier power and volume via IR key presses.

---

## Features ✅

- Detects Volumio playback state (play, pause, stop) and reacts:
  - MUSIC_PLAY → turn amplifier on and sync volume.
  - MUSIC_PAUSE / MUSIC_STOP → schedule amplifier power off after a delay.
- Volume synchronization:
  - Listens to Volumio state via socket.io and sends repeated IR volume up/down key presses to reach desired volume.
  - Uses incremental key presses with a delay between steps to avoid sending them too quickly.
- IR control via LIRC:
  - Sends `KEY_POWER`, `KEY_POWER2`, `KEY_VOLUMEUP`, `KEY_VOLUMEDOWN` by default.
  - Device name defaults to `receiver` (configurable via UI file `config.json`).
- Graceful behavior:
  - Backoff/safe retries are used for external operations and errors are logged.

---

## How it works (implementation details) 🧠

- onVolumioStart: loads plugin config and initializes internal state.
- volumeListener: connects to Volumio (`http://localhost:3000`) and listens for `pushState` events to detect volume/mute/status changes.
- statusChanged/handleEvent: maps Volumio statuses to actions (turn on/off amps, set volume).
- setVolume: compares desired volume and sends repeated LIRC keypresses (volume up/down) until target is reached.
- turnOffAmplifierWithDelay: schedules amplifier power-off after `stopToTurnOffDelay` seconds (default 60s) unless cancelled by playback resuming.

> Important constants in code:
> - `start_button = 'KEY_POWER'`
> - `stop_button = 'KEY_POWER2'`
> - `vol_up_button = 'KEY_VOLUMEUP'`
> - `vol_down_button = 'KEY_VOLUMEDOWN'`
> - `stopToTurnOffDelay = 60` (seconds)
> - `keypressTimeOut = 300` (ms between volume keypress bursts)

---

## Configuration & UI ⚙️

The plugin provides a concise UI to configure how it talks to your amplifier. Settings are saved to the plugin `config.json` as plain key/value pairs (a backup of previous config is created on each save) and are applied immediately when saved.

UI fields and their behavior:

- **Device** (`deviceName`) — LIRC device name to which commands are sent (default: `receiver` or `RAV300` in example UI).
- **Start Button** (`startButton`) — LIRC key name used to turn the device on (default: `KEY_POWER`).
- **Stop Button** (`stopButton`) — LIRC key name used to turn the device off (default: `KEY_POWER2`).
- **Volume Up / Down Buttons** (`volUpButton`, `volDownButton`) — LIRC key names used for incremental volume control (defaults: `KEY_VOLUMEUP` / `KEY_VOLUMEDOWN`).
- **Power on on Play** (`powerOnOnPlay`) — boolean: automatically power on the amplifier when playback starts.
- **Power off on Stop** (`powerOffOnStop`) — boolean: power off when playback stops.
- **Power off on Pause** (`powerOffOnPause`) — boolean: power off when playback is paused.
- **Power-off Delay (s)** (`powerOffDelay`) — number of seconds to wait before powering off (default: `60`).

Notes:
- The UI accepts both plain values and UI widget objects; the plugin normalizes and stores primitive values in `config.json`.

---

## Requirements 📋

- Volumio (tested with version 4.0.0+).
- Infrared (IR) transmitter hardware connected to your Volumio device - trasmitter must be connected to GPIO pin number 18  PWM (default for LIRC on Volumio).

---

## IR board setup 📡

- Parts list (example):
    - 1x IR LED (e.g., TSAL6200)
    - 1x NPN Transistor (e.g., 2N2222)
    - 1x Resistor 100-220 Ohm (for LED current limiting)
    - 1x Resistor 4.7k Ohm (for transistor base)
    - 1x Diode (e.g., 1N4148) (optional, for back-EMF protection)
    - Breadboard and jumper wires
- Wiring:
  - Connect the IR LED anode (longer leg) to the PWM GPIO pin (GPIO18).
  - Connect the IR LED cathode (shorter leg) to the collector of the NPN transistor.
  - Connect the emitter of the NPN transistor to ground (GND).
  - Connect a resistor (100-220 Ohm) between the GPIO pin and the base of the NPN transistor.
  - Connect a resistor (4.7k Ohm) between the base of the NPN transistor and 3.3V power supply.
  - (Optional) Connect a diode across the IR LED (cathode to anode) for back-EMF protection.
- LIRC configuration:
    - The lircd daeamon is configured upon installation of the plugin to use GPIO18 for IR transmission.
    - The plugin comes with the default LIRC configuration for a Yamaha RAV300 remote; modify as needed for your amplifier. New remote definitions need to be copied to the LIRC config directory (usually `/etc/lirc/lircd.conf.d/`).
---


## Installation (short) ▶️

Follow the standard Volumio plugin installation process: https://developers.volumio.com/plugins/plugins-overview


---

## Testing & Debugging 🧪

- Verify LIRC:
  - `sudo systemctl status lircd`
  - Check `/var/log/syslog` or plugin logs for LIRC send errors.
- Verify state listener works:
  - Trigger playback in Volumio UI and check plugin logs (`volumio logs` or via the Volumio UI) — you should see `volumeListener` and `pushState` log lines.
- Verify IR actions:
  - Observing the amplifier, start playback → amplifier should power on and respond to volume changes.
  - Stop/pause → amplifier should power off after the configured delay.

---

## Development notes 🧰

- Main logic lives in `index.js`.
- UI definitions live in `UIConfig.json` and i18n strings are in `i18n/`.
- To extend behavior (different keys, delays, or more UI options), update `index.js` and add UI bindings in `UIConfig.json`.

---

## Troubleshooting Tips ⚠️

- If volume changes aren't applied, check that `lircd` is running and that the configured device and key names match your LIRC configuration.
- If the plugin doesn't react to playback, confirm socket.io is available and that `pushState` events are received by the plugin (check logs).

---


**Author:** Lengyel Csongor

