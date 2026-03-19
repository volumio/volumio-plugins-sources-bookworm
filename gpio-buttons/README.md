# GPIO Buttons Plugin for Volumio 4

Control Volumio playback using physical GPIO buttons on your Raspberry Pi.

## Features

- **6 configurable buttons** - Each can be assigned to any GPIO pin
- **Standard playback actions** - Play/Pause, Volume Up/Down, Previous/Next, Shutdown
- **Custom Emit** - Call any plugin method via WebSocket for advanced integrations

## Hardware Setup

### Wiring

Connect buttons between GPIO pins and GND (Ground):

```
GPIO Pin ----[Button]---- GND
```

The plugin enables internal pull-up resistors, so no external resistors are needed.

### Example Setup

| Function     | GPIO Pin | Physical Pin |
|-------------|----------|--------------|
| Play/Pause  | GPIO 17  | Pin 11       |
| Volume Up   | GPIO 18  | Pin 12       |
| Volume Down | GPIO 22  | Pin 15       |
| Previous    | GPIO 23  | Pin 16       |
| Next        | GPIO 24  | Pin 18       |
| Shutdown    | GPIO 3   | Pin 5        |

**Note:** GPIO 3 (Pin 5) is special - it can also wake the Pi from halt state.

## Configuration

### Basic Setup

1. Open Volumio web interface
2. Go to Plugins > Installed Plugins > GPIO Buttons > Settings
3. For each button:
   - Enable the button
   - Select GPIO pin
   - Choose action

### Standard Actions

| Action       | Description                                      |
|-------------|--------------------------------------------------|
| Play/Pause  | Toggle playback (stops webradio instead of pause)|
| Volume Up   | Increase volume by one step                      |
| Volume Down | Decrease volume by one step                      |
| Previous    | Go to previous track                             |
| Next        | Go to next track                                 |
| Shutdown    | Safely shutdown Volumio                          |

## Custom Emit Feature

The **Custom Emit** action allows buttons to call any plugin method via WebSocket.
This enables integration with any Volumio plugin.

### Configuration Fields

When you select "Custom Emit" as the action, four additional fields appear:

| Field           | Description                                    | Example                      |
|----------------|------------------------------------------------|------------------------------|
| Socket Command | WebSocket event name                           | `callMethod`                 |
| Plugin Endpoint| Plugin path (category/name)                    | `user_interface/randomizer`  |
| Method Name    | Method to call on the plugin                   | `randomAlbum`                |
| Data (JSON)    | Additional data as JSON string                 | `{}`                         |

### How It Works

When the button is pressed, the plugin emits:

```javascript
socket.emit('callMethod', {
    endpoint: 'user_interface/randomizer',
    method: 'randomAlbum',
    data: {}
});
```

### Examples

#### Random Album (Randomizer Plugin)

Play a random album from your library:

- **Action:** Custom Emit
- **Socket Command:** `callMethod`
- **Plugin Endpoint:** `user_interface/randomizer`
- **Method Name:** `randomAlbum`
- **Data (JSON):** `{}`

#### Clear Queue

Clear the current playback queue:

- **Action:** Custom Emit
- **Socket Command:** `callMethod`
- **Plugin Endpoint:** `music_service/mpd`
- **Method Name:** `clearQueue`
- **Data (JSON):** `{}`

#### Toggle FusionDSP Effect

Enable/disable audio effects:

- **Action:** Custom Emit
- **Socket Command:** `callMethod`
- **Plugin Endpoint:** `audio_interface/fusiondsp`
- **Method Name:** `enableeffect` (or `disableeffect`)
- **Data (JSON):** `[]`

#### Play Specific Playlist

Start playing a saved playlist:

- **Action:** Custom Emit
- **Socket Command:** `playPlaylist`
- **Plugin Endpoint:** (leave empty)
- **Method Name:** (leave empty)
- **Data (JSON):** `{"name":"My Playlist"}`

**Note:** For direct socket commands like `playPlaylist`, leave endpoint and method empty,
and the plugin will emit: `socket.emit('playPlaylist', {"name":"My Playlist"})`

### Finding Plugin Endpoints

To find available plugin endpoints and methods:

1. Check the plugin source code on GitHub
2. Look at `index.js` for method names
3. The endpoint format is: `plugin_type/plugin_name`

Common plugin types:
- `music_service` - Music sources (mpd, spotify, etc.)
- `user_interface` - UI plugins (randomizer, etc.)
- `audio_interface` - Audio processing (fusiondsp, etc.)
- `system_hardware` - Hardware plugins

## Troubleshooting

### Buttons Not Working

1. Check wiring - button should connect GPIO to GND
2. Verify GPIO pin number matches configuration
3. Check Volumio logs: `journalctl -u volumio -f`

### Custom Emit Not Working

1. Verify plugin endpoint path is correct
2. Check method name matches plugin source
3. Ensure JSON data is valid (use `{}` for empty)
4. Check logs for error messages

### Socket Connection Issues

If you see "Socket connection error" in logs:
- Restart Volumio: `volumio vrestart`
- Ensure socket.io-client version is 1.7.4 (critical for Volumio 4)

## Technical Notes

### Socket.IO Version

Volumio 4 uses socket.io server v1.7.4. This plugin MUST use socket.io-client v1.7.4.
Higher versions cause protocol mismatch and silent failures.

### GPIO Library

Uses `@iiot2k/gpiox` for Raspberry Pi 5 compatibility (Bookworm/Volumio 4).

### Debounce

Hardware debounce of 1ms is applied to prevent multiple triggers from button bounce.

## Changelog

### 1.9.0
- Added Custom Emit action for calling any plugin method
- Restructured configuration (button1-6 instead of named actions)
- Added comprehensive documentation

### 1.8.5
- Fixed socket.io-client version mismatch (critical bug fix)
- Added socket connection event handlers

## Credits

- Original authors: tomatpasser, Darmur
- Custom emit feature: foonerd
- Volumio 4 compatibility fixes: community contributions

## License

ISC License
