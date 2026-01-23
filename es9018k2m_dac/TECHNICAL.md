# ES9018K2M Plugin - Technical Reference

This document covers the internal architecture and implementation details of the ES9018K2M DAC Control plugin. For installation and usage, see README.md.

## Architecture Overview

The plugin uses multiple mechanisms for DAC control:

```
+------------------+     +-------------------+     +-------------+
|  Volumio UI      | --> |  alsa_controller  | --> |  Plugin     |
|  Volume Slider   |     |  (Hardware Mode)  |     |  alsavolume |
+------------------+     +-------------------+     +------+------+
                                                          |
+------------------+     +-------------------+            v
|  Volumio State   | --> |  volumioupdate-   | --> +-------------+
|  Machine         |     |  volume callback  |     |  DAC I2C    |
+------------------+     |  (Software Mode)  |     |  Registers  |
                         +-------------------+     +-------------+
                                                         ^
+------------------+     +-------------------+           |
|  Volumio         | --> |  socket.io        | --> +-----+-------+
|  Backend         |     |  pushState        |     |  State      |
|  (localhost:3000)|     |  events           |     |  Handler    |
+------------------+     +-------------------+     +-------------+
                                                         ^
+------------------+     +-------------------+           |
|  commandRouter   | --> |  Seek Intercept   | --> +-----+-------+
|  volumioSeek()   |     |  Wrapper          |     |  Pre-emptive|
+------------------+     +-------------------+     |  Mute       |
                                                   +-------------+
```

## Volume Control Modes

### Hardware Mode (Override)

Registers with Volumio's alsa_controller to become the hardware volume handler:

```javascript
self.commandRouter.executeOnPlugin(
  'audio_interface',
  'alsa_controller',
  'setDeviceVolumeOverride',
  {
    card: cardNumber,
    pluginType: 'system_hardware',
    pluginName: 'es9018k2m',
    overrideMixerType: 'Hardware',
    overrideAvoidSoftwareMixer: true
  }
);
```

When registered:
- Volumio's volumecontrol.js routes volume commands to plugin
- Plugin's `alsavolume(vol)` method receives volume changes
- Plugin sets DAC registers then pushes state back via `volumioupdatevolume()`

### Software Mode (Callback)

Uses Volumio's internal callback system:

```javascript
self.commandRouter.addCallback('volumioupdatevolume', self.volumeCallback);
```

- Lower overhead than hardware mode
- Requires Volumio to already have a volume slider visible
- Volume callback receives `{vol, mute}` object

## Startup Volume Logic (Hardware Mode)

The plugin applies startup volume settings AFTER Volumio completes its own startup sequence.

### The Problem

Volumio's `volumiosetStartupVolume` runs ~5 seconds after plugins start, calling our `alsavolume()` and overwriting any volume we set during `onStart()`.

### The Solution

Wait for `process.env.VOLUMIO_SYSTEM_STATUS === 'ready'` before applying startup volume. This pattern is borrowed from the autostart plugin.

```javascript
ControllerES9018K2M.prototype.applyStartupVolume = function() {
  var self = this;
  
  function checkSystemReady() {
    var systemStatus = process.env.VOLUMIO_SYSTEM_STATUS;
    
    if (systemStatus === 'ready') {
      self.doApplyStartupVolume();
    } else {
      setTimeout(checkSystemReady, 1000);
    }
  }
  
  checkSystemReady();
};
```

### Priority Order

```
1. Start Muted (highest priority)
   - Mute DAC immediately
   - If rememberLastVolume also enabled: set slider to lastSavedVolume
   - Otherwise: keep system volume for slider position
   
2. Remember Last Volume
   - Restore lastSavedVolume from config
   - Overrides safe startup
   
3. Safe Startup Volume
   - Only caps DOWN (never increases volume)
   - Applied only if systemVolume > safeStartupVolume
   
4. System Default (lowest priority)
   - Use current system volume as-is
```

### Implementation

```javascript
ControllerES9018K2M.prototype.doApplyStartupVolume = function() {
  var self = this;
  
  // Get current system volume (Volumio has now set its startup volume)
  var state = self.commandRouter.volumioGetState();
  var systemVolume = (state && typeof state.volume === 'number') ? state.volume : 100;
  
  var targetVolume = systemVolume;
  var shouldMute = false;

  // Priority 1: Start muted
  if (self.startMuted) {
    shouldMute = true;
    // If rememberLastVolume also enabled, use that for slider position
    if (self.rememberLastVolume && self.lastSavedVolume >= 0) {
      targetVolume = self.lastSavedVolume;
    } else {
      targetVolume = systemVolume;
    }
  }
  // Priority 2: Remember last volume
  else if (self.rememberLastVolume && self.lastSavedVolume >= 0) {
    targetVolume = self.lastSavedVolume;
  }
  // Priority 3: Safe startup (cap down only)
  else if (self.safeStartupEnabled && systemVolume > self.safeStartupVolume) {
    targetVolume = self.safeStartupVolume;
  }

  // Apply to DAC directly
  self.currentVolume = targetVolume;
  self.setVolumeImmediate(targetVolume);

  if (shouldMute) {
    self.setMuteSync(true);
    self.currentMute = true;
  }

  // Push state to Volumio so UI reflects our override
  self.commandRouter.volumioupdatevolume({
    vol: targetVolume,
    mute: shouldMute
  });
};
```

### Volume Persistence

Last volume is saved to config on plugin stop/shutdown/reboot:

```javascript
if (self.volumeMode === 'hardware' && self.rememberLastVolume) {
  if (self.currentVolume !== self.lastSavedVolume) {
    self.config.set('lastSavedVolume', self.currentVolume);
    // Force flush to disk - config may not be saved before shutdown otherwise
    self.config.save();
  }
}
```

**Important:** `config.save()` must be called to force flush to disk. Without it, config changes may be lost during shutdown.

## Graceful Volume Ramping

Volume transitions use linear interpolation to prevent audible artifacts.

### Mute Sequence (3 steps example, volume at 50%)

```
Current Register (0x31) -> 0x76 -> 0xBA -> 0xFF -> hw mute bit set
```

### Unmute Sequence

```
hw mute bit clear -> 0xBA -> 0x76 -> Target Register (0x31)
```

### Volume Change Sequence (30% to 80%)

```
0x45 -> 0x38 -> 0x2B -> 0x1E (target)
```

Each step writes both left and right channel registers with balance offset applied.

### Step Calculation

```javascript
for (var i = 1; i <= steps; i++) {
  var ratio = i / steps;
  var stepVol = Math.round(fromVol + (volDiff * ratio));
  // Write to DAC
}
```

## Seek Pop Prevention

Audio pops during seeks occur because:

1. User releases seek slider
2. MPD executes seek immediately (audio discontinuity = pop)
3. pushState event fires ~30ms AFTER the pop already happened
4. Reactive mute arrives too late

### Solution: Intercept Before Execution

```javascript
// Save original
self.originalSeek = self.commandRouter.volumioSeek.bind(self.commandRouter);

// Install wrapper
self.commandRouter.volumioSeek = function(position) {
  self.gracefulMuteSync(true);    // Synchronous - blocks until complete
  var result = self.originalSeek(position);  // Original seek executes
  setTimeout(function() {
    self.gracefulMuteSync(false);  // Unmute after delay
  }, self.seekMuteMs);
  return result;
};
```

This adds ~30-50ms latency to seeks but guarantees pop-free operation.

## Register Configuration

### Initialization Sequence

| Register | Value | Function |
|----------|-------|----------|
| 0x00 | 0x00 | System settings |
| 0x01 | 0xC4 | 32-bit I2S, auto-detect serial/DSD |
| 0x04 | 0x10 | Automute time |
| 0x05 | 0x68 | Automute level (-104dB) |
| 0x06 | 0x47 | De-emphasis and volume ramp rate (fastest) |
| 0x07 | 0x80 | General settings (mute, filters) - shadow register |
| 0x08 | 0x01 | GPIO configuration |
| 0x0C | 0x5F | DPLL/ASRC settings - shadow register |
| 0x0E | 0x8A | **Soft-start** - KEY for pop prevention |
| 0x15 | 0x00 | GPIO and OSF bypass - shadow register |
| 0x1B | 0xD4 | ASRC and volume latch |

### Register 0x0E - Soft Start Configuration

Value 0x8A configures:
- Soft-start enabled
- Ramp to AVCC/2 on DPLL lock changes
- Handles sample rate and format changes at hardware level

This is the primary mechanism for preventing pops on track changes with different formats.

### Volume Registers

| Register | Function |
|----------|----------|
| 0x0F | Left channel volume (0x00 = 0dB, 0x63 = -49.5dB, 0xFF = mute) |
| 0x10 | Right channel volume (same scale) |

Volume formula:
```javascript
var DAC_MIN_GAIN = 0x63;  // -49.5dB
var attenuation = Math.round(DAC_MIN_GAIN - (volumePercent * DAC_MIN_GAIN / 100));
```

### Shadow Registers

The plugin maintains shadow copies of registers that control multiple settings:

- **reg7 (0x07)** - Mute bit, FIR filter, IIR filter
- **reg12 (0x0C)** - I2S DPLL (upper nibble), DSD DPLL (lower nibble)
- **reg21 (0x15)** - GPIO, OSF bypass

This allows modifying individual bits without read-modify-write cycles.

## Socket.io Connection

### Connection Management

```javascript
self.volumioSocket = io.connect('http://localhost:3000', {
  reconnection: false,  // Manual reconnection handling
  timeout: 5000
});
```

### Reconnection Strategy

Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)

```javascript
var delay = Math.min(
  1000 * Math.pow(2, self.reconnectAttempts - 1),
  self.maxReconnectDelay
);
```

### Fallback Poller

If socket unavailable for >5 minutes, starts 60-second polling:

```javascript
self.fallbackPoller = setInterval(function() {
  var state = self.commandRouter.volumioGetState();
  if (state) {
    self.handleStateChange(state);
  }
}, 60000);
```

## I2C Communication

### Synchronous Writes (Critical Path)

Used for seek intercept where blocking is required:

```javascript
execSync('i2cset -y 1 0x48 0x0F 0x31', { timeout: 100 });
```

### Asynchronous Writes (Normal Path)

Used for non-critical operations with 30ms throttling:

```javascript
var delay = Math.max(0, self.I2C_THROTTLE_MS - (now - self.lastI2cWrite));
setTimeout(function() {
  exec('i2cset -y ' + bus + ' 0x' + addr + ' 0x' + reg + ' 0x' + val, callback);
}, delay);
```

### Device Detection

Reads register 64 and checks chip ID bits:

```javascript
var isES9018K2M = (status & 0x1C) === 0x10;
```

## Filter Configuration

### FIR Filter (Register 0x07, bits 5-6)

| Mode | Bits | Description |
|------|------|-------------|
| Slow Roll-Off | 01 | Gentler cutoff |
| Fast Roll-Off | 00 | Sharp cutoff (default) |
| Minimum Phase | 10 | No pre-ringing |
| Bypass | - | Uses reg21 bit 0 |

### IIR Filter (Register 0x07, bits 2-3)

| Mode | Bits | Bandwidth |
|------|------|-----------|
| 47K | 00 | PCM recommended |
| 50K | 01 | DSD option |
| 60K | 10 | DSD option |
| 70K | 11 | DSD option |
| Bypass | - | Uses reg21 bit 2 |

## UI Configuration

### Dynamic Visibility with visibleIf

The plugin uses Volumio's `visibleIf` for client-side field visibility:

```json
{
  "id": "cardNumber",
  "element": "input",
  "visibleIf": {
    "field": "volumeMode",
    "value": "hardware"
  }
}
```

Fields show/hide dynamically without page refresh when the referenced field changes.

### Cascading Visibility

For nested visibility (e.g., safeStartupVolume visible only when hardware mode AND safeStartupEnabled):

```json
{
  "id": "safeStartupEnabled",
  "visibleIf": { "field": "volumeMode", "value": "hardware" }
},
{
  "id": "safeStartupVolume",
  "visibleIf": { "field": "safeStartupEnabled", "value": true }
}
```

When volumeMode is "software", safeStartupEnabled is hidden, so user cannot enable it, therefore safeStartupVolume also stays hidden.

## Why No Custom Overlay?

The plugin uses standard i2s-dac overlay because:

1. **Onboard Oscillators** - All ES9018K2M HATs have local clocks, no MCLK from Pi needed

2. **Hardware Soft-Start** - Register 0x0E handles sample rate changes at DAC level

3. **No Kernel Driver** - I2C control via i2c-tools is sufficient for all operations

4. **Hardware Volume Override** - Provides volume slider without custom ALSA mixer

5. **Simpler Deployment** - No overlay compilation, works with stock Volumio

## Dependencies

- **socket.io-client ^2.3.0** - Volumio backend communication
- **fs-extra** - File system utilities (Volumio provided)
- **kew** - Promise library (Volumio provided)
- **v-conf** - Configuration management (Volumio provided)
- **i2c-tools** - System package for I2C access (Volumio base image)
