# MQTT Client Plugin for Volumio

MQTT client plugin for Volumio 4.x enabling home automation integration with Home Assistant, OpenHAB, Node-RED, and other MQTT-based systems.

## Features

- **Bi-directional communication**: Publish Volumio state and receive playback commands
- **Universal compatibility**: Works with any MQTT broker (Mosquitto, HiveMQ, etc.)
- **Home automation ready**: Compatible with Home Assistant, OpenHAB, Node-RED
- **TLS/SSL support**: Secure connections with optional client certificates
- **Multi-room support**: Group topic subscriptions for synchronized control
- **Configurable topics**: Customizable base topic and device ID
- **Debug logging**: Toggle detailed logging for troubleshooting

## Installation

1. Download the plugin zip file
2. In Volumio, go to Plugins > Install Plugin
3. Upload the zip file
4. Enable the plugin and configure settings

## MQTT Topics

### Published State Topics

All state topics are published under: `{base_topic}/{device_id}/`

| Topic | Description | Example Value |
|-------|-------------|---------------|
| `status` | Full JSON state object | `{"status":"play","title":"Song",...}` |
| `status/state` | Playback state | `play`, `pause`, `stop` |
| `status/title` | Current track title | `My Song` |
| `status/artist` | Current artist | `Artist Name` |
| `status/album` | Current album | `Album Name` |
| `status/albumart` | Album art URL | `http://...` |
| `status/volume` | Volume level | `0` - `100` |
| `status/mute` | Mute state | `true`, `false` |
| `status/repeat` | Repeat state | `true`, `false` |
| `status/random` | Random/shuffle state | `true`, `false` |
| `status/seek` | Current position (ms) | `45000` |
| `status/duration` | Track duration (ms) | `180000` |
| `status/samplerate` | Sample rate | `44100` |
| `status/bitdepth` | Bit depth | `16` |
| `status/service` | Current service | `mpd`, `spop`, `webradio` |
| `available` | Online/offline status | `online`, `offline` |

### Command Topics

Commands are received on: `{base_topic}/{device_id}/set/{command}`

| Command | Payload | Description |
|---------|---------|-------------|
| `play` | (none) | Start playback |
| `pause` | (none) | Pause playback |
| `toggle` | (none) | Toggle play/pause |
| `stop` | (none) | Stop playback |
| `next` | (none) | Next track |
| `previous` | (none) | Previous track |
| `volume` | `0-100` | Set volume level |
| `volumeup` | (none) | Increase volume |
| `volumedown` | (none) | Decrease volume |
| `mute` | `true`/`false`/`toggle` | Control mute |
| `unmute` | (none) | Unmute |
| `seek` | milliseconds | Seek to position |
| `repeat` | `true`/`false`/toggle | Set repeat mode |
| `random` | `true`/`false`/toggle | Set shuffle mode |
| `clear` | (none) | Clear queue |

**Command aliases:**
- `volumeup`: also `volup`, `volume_up`
- `volumedown`: also `voldown`, `volume_down`
- `previous`: also `prev`
- `random`: also `shuffle`

**Note:** Avoid using `+` or `-` characters in topic names as they are MQTT reserved wildcards. Use `volumeup`/`volumedown` instead of `vol+`/`vol-`.

### JSON Command Format

Send JSON commands to: `{base_topic}/{device_id}/command`

```json
{"command": "volume", "value": 50}
{"command": "play"}
{"cmd": "next"}
```

### Group Topics

When group topics are enabled, commands can be sent to:
`{base_topic}/group/{group_id}/set/{command}`

This allows controlling multiple Volumio instances simultaneously.

## Configuration Options

### Connection Settings
- **Broker Host**: MQTT broker hostname or IP
- **Broker Port**: MQTT broker port (default: 1883, TLS: 8883)
- **Username/Password**: Broker authentication credentials

### Topic Configuration
- **Base Topic**: Root topic prefix (default: `volumio`)
- **Device ID**: Unique identifier (default: hostname)
- **Publish Full State**: Enable JSON state publishing
- **Publish Individual Topics**: Enable per-attribute topics
- **State Update Interval**: Periodic publish interval in seconds
- **Retain State**: Set retain flag on state messages

### TLS/SSL Security
- **Enable TLS**: Use encrypted connection
- **CA Certificate**: Path to CA certificate file
- **Client Certificate**: Path to client certificate
- **Client Key**: Path to client private key
- **Verify Server Certificate**: Reject invalid certificates

### Advanced Settings
- **Client ID**: MQTT client identifier
- **Keep-Alive**: Connection keep-alive interval
- **Reconnect Interval**: Time between reconnection attempts
- **QoS Levels**: Quality of Service for state and commands

### Group/Multi-Room
- **Enable Group Topic**: Subscribe to group commands
- **Group ID**: Group identifier for multi-room control

### Diagnostics
- **Enable Debug Logging**: Log detailed MQTT messages

## Home Assistant Example

```yaml
mqtt:
  sensor:
    - name: "Volumio Status"
      state_topic: "volumio/living-room/status/state"
      
    - name: "Volumio Volume"
      state_topic: "volumio/living-room/status/volume"
      unit_of_measurement: "%"
      
    - name: "Volumio Now Playing"
      state_topic: "volumio/living-room/status"
      value_template: "{{ value_json.artist }} - {{ value_json.title }}"

# Control buttons
script:
  volumio_play:
    sequence:
      - service: mqtt.publish
        data:
          topic: "volumio/living-room/set/play"
          
  volumio_volume_50:
    sequence:
      - service: mqtt.publish
        data:
          topic: "volumio/living-room/set/volume"
          payload: "50"
```

## OpenHAB Example

```
Thing mqtt:topic:volumio "Volumio" (mqtt:broker:mosquitto) {
    Channels:
        Type string : status [stateTopic="volumio/living-room/status/state"]
        Type number : volume [stateTopic="volumio/living-room/status/volume", commandTopic="volumio/living-room/set/volume"]
        Type string : title [stateTopic="volumio/living-room/status/title"]
        Type switch : playback [commandTopic="volumio/living-room/set/toggle"]
}
```

## Troubleshooting

1. **Enable Debug Logging** in plugin settings to see detailed MQTT activity
2. Check Volumio logs: `journalctl -f -u volumio`
3. Verify broker connectivity with mosquitto_sub/pub tools
4. Ensure firewall allows MQTT port (1883 or 8883)

## License

MIT License

## Author

Just a Nerd
