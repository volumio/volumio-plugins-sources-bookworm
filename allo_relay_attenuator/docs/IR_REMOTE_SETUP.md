# IR Remote Control Setup

This guide covers configuring IR remote control for the Allo Relay Attenuator.

## Prerequisites

- IR sensor connected (see HARDWARE.md for wiring)
- Plugin installed and enabled
- IR Remote enabled in plugin settings
- Reboot after enabling IR (for gpio-ir overlay)

## Quick Test

After reboot, verify IR sensor is receiving signals:

```bash
mode2 -d /dev/lirc0
```

Point remote at sensor and press buttons. You should see pulse/space output:

```
pulse 9217
space 4286
pulse 565
space 1675
...
```

If no output: check wiring, GPIO pin setting, and that gpio-ir overlay is loaded.

## Default Remote

The plugin ships with codes for a common LG remote. If your remote uses the same
protocol, it may work out of the box. Test with:

```bash
irw
```

Press buttons. If decoded correctly you see:

```
0000000020df40bf 00 KEY_VOLUMEUP allo_relay_attenuator
0000000020dfc03f 00 KEY_VOLUMEDOWN allo_relay_attenuator
```

## Recording Your Remote

If the default codes do not work, record your own remote:

### Step 1: Stop LIRC daemon

```bash
sudo systemctl stop lircd
```

### Step 2: Test raw signal

```bash
mode2 -d /dev/lirc0
```

Press a button. Note the approximate timing values for:
- header pulse (first large pulse, typically 8000-9500)
- header space (first large space, typically 4000-4500)
- one pulse/space (short pulse ~500-600, long space ~1600-1700)
- zero pulse/space (short pulse ~500-600, short space ~500-600)

### Step 3: Record remote

```bash
irrecord -d /dev/lirc0 ~/my_remote.conf
```

Follow the prompts:
1. Press buttons randomly to analyze protocol
2. Enter remote name when prompted
3. Record each button (KEY_VOLUMEUP, KEY_VOLUMEDOWN, KEY_MUTE minimum)

### Step 4: If irrecord fails with "Cannot decode data"

Some remotes use protocols irrecord cannot auto-detect. Use raw mode:

```bash
irrecord -f -d /dev/lirc0 ~/my_remote.conf
```

The -f flag records raw timing data instead of decoded protocol.

### Step 5: Install configuration

```bash
sudo cp ~/my_remote.conf /etc/lirc/lircd.conf
sudo systemctl start lircd
```

### Step 6: Test

```bash
irw
```

## Timing Troubleshooting

If irw shows no output but mode2 works, the timing values may be wrong.

### Compare actual vs configured timing

Get actual timing from mode2:

```bash
mode2 -d /dev/lirc0 | head -20
```

Press one button. Note the header timing (first pulse and space).

Check configured timing:

```bash
grep -E "header|zero|one" /etc/lirc/lircd.conf
```

### Common issue: zero timing

The "zero" line must match actual signal. Example:

Actual from mode2:
```
pulse 565
space 565
```

Config must have:
```
zero 565 565
```

NOT:
```
zero 565 567
```

Even small differences can prevent decoding.

### Fix timing manually

Edit /etc/lirc/lircd.conf and adjust header, one, zero values to match mode2 output.
Restart lircd after changes:

```bash
sudo systemctl restart lircd
```

## Button Mapping (lircrc)

The lircrc file maps remote buttons to daemon commands:

```
begin
    remote = allo_relay_attenuator
    button = KEY_VOLUMEUP
    prog = fn-rattenu
    config = volume_up
end
```

Supported commands:
- volume_up - increase volume by 1
- volume_down - decrease volume by 1
- mute - toggle mute

If your remote has a different name, update the "remote = " line in /etc/lirc/lircrc
to match the name in your lircd.conf.

## Verification Checklist

1. mode2 shows pulse/space data when pressing buttons
2. irw shows decoded button names
3. Daemon running without -l flag: `systemctl status fn-rattenu`
4. Relays click when pressing volume buttons

## Files Reference

- /etc/lirc/lirc_options.conf - LIRC daemon options (driver=default required)
- /etc/lirc/lircd.conf - Remote control codes and timing
- /etc/lirc/lircrc - Button to command mapping
- /boot/userconfig.txt - gpio-ir overlay configuration
